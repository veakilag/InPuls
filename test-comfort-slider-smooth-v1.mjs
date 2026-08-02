import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const installCta = readFileSync(new URL("./install-cta.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const comfortGuard = installCta.slice(0, installCta.indexOf("\n\n(() => {", 1));

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.pointerId = init.pointerId ?? 1;
    this.detail = init.detail ?? null;
    this.immediateStopped = false;
  }

  stopImmediatePropagation() {
    this.immediateStopped = true;
  }
}

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target = this;
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
      if (event.immediateStopped) break;
    }
    return true;
  }
}

function buildHarness() {
  const rootValues = new Map();
  const thumbValues = new Map();
  const animationFrames = new Map();
  const previewValues = [];
  let nextFrameId = 1;
  let capturedPointer = null;

  const thumb = {
    style: {
      setProperty(name, value) { thumbValues.set(name, value); },
      removeProperty(name) { thumbValues.delete(name); },
    },
  };

  const slider = new FakeTarget();
  slider.value = "55";
  slider.closest = () => ({ querySelector: () => thumb });
  slider.setPointerCapture = (pointerId) => { capturedPointer = pointerId; };
  slider.hasPointerCapture = (pointerId) => capturedPointer === pointerId;
  slider.releasePointerCapture = (pointerId) => {
    if (capturedPointer === pointerId) capturedPointer = null;
  };

  const context = {
    document: {
      documentElement: {
        style: {
          setProperty(name, value) { rootValues.set(name, value); },
        },
      },
      querySelector(selector) {
        return selector === "#comfort-slider" ? slider : null;
      },
    },
    Event: FakeEvent,
    CustomEvent: FakeEvent,
    dispatchEvent(event) {
      if (event.type === "inpuls:comfort-preview") previewValues.push(event.detail?.value);
      return true;
    },
    requestAnimationFrame(callback) {
      const id = nextFrameId;
      nextFrameId += 1;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
  };

  vm.runInNewContext(comfortGuard, context);

  return {
    slider,
    rootValues,
    thumbValues,
    previewValues,
    flushFrames() {
      const pending = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of pending) callback();
    },
  };
}

test("comfort drag updates its thumb and live palette preview per frame", () => {
  assert.match(comfortGuard, /let pointerDragging = false;/);
  assert.match(comfortGuard, /event\.stopImmediatePropagation\(\);/);
  assert.match(comfortGuard, /new CustomEvent\("inpuls:comfort-preview"/);
  assert.doesNotMatch(comfortGuard, /localStorage|render\(|applyComfort/);

  const harness = buildHarness();
  let committedUpdates = 0;
  harness.slider.addEventListener("input", () => { committedUpdates += 1; });

  harness.slider.dispatchEvent(new FakeEvent("pointerdown", { pointerId: 7 }));
  harness.slider.value = "68";
  harness.slider.dispatchEvent(new FakeEvent("input", { pointerId: 7 }));
  harness.slider.value = "82";
  harness.slider.dispatchEvent(new FakeEvent("input", { pointerId: 7 }));

  assert.equal(committedUpdates, 0);
  assert.equal(harness.thumbValues.get("transition"), "none");
  harness.flushFrames();
  assert.equal(harness.rootValues.get("--comfort-position"), "82%");
  assert.deepEqual(harness.previewValues, [82]);

  harness.slider.dispatchEvent(new FakeEvent("pointerup", { pointerId: 7 }));
  assert.equal(committedUpdates, 1);
  assert.equal(harness.rootValues.get("--comfort-position"), "82%");
  assert.equal(harness.previewValues.at(-1), 82);
  assert.equal(harness.thumbValues.has("transition"), false);
});

test("lightweight preview changes visible palette without repainting canvases", () => {
  const previewStart = app.indexOf("function applyComfortPreview(rawValue) {");
  const previewEnd = app.indexOf("\n\nfunction applyComfort(rawValue)", previewStart);
  const preview = app.slice(previewStart, previewEnd);
  assert.ok(previewStart >= 0 && previewEnd > previewStart);
  assert.match(preview, /--bg/);
  assert.match(preview, /--panel/);
  assert.match(preview, /--panel-2/);
  assert.match(preview, /--chart-bg/);
  assert.match(preview, /--comfort-position/);
  assert.doesNotMatch(preview, /setTheme|localStorage|inpuls:theme-change/);
  assert.match(app, /addEventListener\("inpuls:comfort-preview"/);
});

test("release persists and repaints heavy visual modules exactly once", () => {
  const handler = app.match(
    /els\.comfortSlider\.addEventListener\("input", \(\) => \{([\s\S]*?)\n  \}\);/,
  )?.[1] ?? "";
  assert.match(handler, /state\.comfort = Number\(els\.comfortSlider\.value\);/);
  assert.match(handler, /localStorage\.setItem\(STORAGE_KEYS\.comfort/);
  assert.match(handler, /applyComfort\(state\.comfort\);/);
  assert.doesNotMatch(handler, /render\(/);

  const commitStart = app.indexOf("function applyComfort(rawValue) {");
  const commitEnd = app.indexOf("\n\nglobalThis.addEventListener(\"inpuls:comfort-preview\"", commitStart);
  const commit = app.slice(commitStart, commitEnd);
  assert.match(commit, /priceChart\.setTheme\(activeChartTheme\)/);
  assert.match(commit, /panel\.chart\.setTheme\(activeChartTheme\)/);
  assert.match(commit, /inpuls:theme-change/);
});

test("comfort preview ships with a fresh browser cache key", () => {
  assert.match(index, /install-cta\.js\?v=comfort-live-preview-v1/);
  assert.match(index, /app\.js\?v=26-98-live-comfort-preview-v1/);
});
