import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const installCta = readFileSync(new URL("./install-cta.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const comfortGuard = installCta.slice(0, installCta.indexOf("\n\n(() => {", 1));

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.pointerId = init.pointerId ?? 1;
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
    flushFrames() {
      const pending = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of pending) callback();
    },
  };
}

test("comfort drag updates only its thumb until pointer release", () => {
  assert.match(comfortGuard, /let pointerDragging = false;/);
  assert.match(comfortGuard, /event\.stopImmediatePropagation\(\);/);
  assert.doesNotMatch(comfortGuard, /localStorage|render\(|applyComfort/);

  const harness = buildHarness();
  let paletteUpdates = 0;
  harness.slider.addEventListener("input", () => { paletteUpdates += 1; });

  harness.slider.dispatchEvent(new FakeEvent("pointerdown", { pointerId: 7 }));
  harness.slider.value = "68";
  harness.slider.dispatchEvent(new FakeEvent("input", { pointerId: 7 }));
  harness.slider.value = "82";
  harness.slider.dispatchEvent(new FakeEvent("input", { pointerId: 7 }));

  assert.equal(paletteUpdates, 0);
  assert.equal(harness.thumbValues.get("transition"), "none");
  harness.flushFrames();
  assert.equal(harness.rootValues.get("--comfort-position"), "82%");

  harness.slider.dispatchEvent(new FakeEvent("pointerup", { pointerId: 7 }));
  assert.equal(paletteUpdates, 1);
  assert.equal(harness.rootValues.get("--comfort-position"), "82%");
  assert.equal(harness.thumbValues.has("transition"), false);
});

test("keyboard input still updates the palette immediately", () => {
  const harness = buildHarness();
  let paletteUpdates = 0;
  harness.slider.addEventListener("input", () => { paletteUpdates += 1; });

  harness.slider.value = "61";
  harness.slider.dispatchEvent(new FakeEvent("input"));

  assert.equal(paletteUpdates, 1);
});

test("existing app owns the single persisted palette update", () => {
  const handler = app.match(
    /els\.comfortSlider\.addEventListener\("input", \(\) => \{([\s\S]*?)\n  \}\);/,
  )?.[1] ?? "";
  assert.match(handler, /state\.comfort = Number\(els\.comfortSlider\.value\);/);
  assert.match(handler, /localStorage\.setItem\(STORAGE_KEYS\.comfort/);
  assert.match(handler, /applyComfort\(state\.comfort\);/);
  assert.doesNotMatch(handler, /render\(/);
});
