import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const installCta = readFileSync(new URL("./install-cta.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const comfortGuard = installCta.slice(0, installCta.indexOf("\n\n(() => {", 1));

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.pointerId = init.pointerId ?? 1;
    this.detail = init.detail ?? null;
    this.immediateStopped = false;
  }
  stopImmediatePropagation() { this.immediateStopped = true; }
}

class FakeTarget {
  constructor() { this.listeners = new Map(); }
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

function styleStore() {
  const values = new Map();
  return {
    values,
    style: {
      setProperty(name, value) { values.set(name, value); },
      removeProperty(name) { values.delete(name); },
    },
  };
}

function buildHarness() {
  const thumbStore = styleStore();
  const sunStore = styleStore();
  const moonStore = styleStore();
  const animationFrames = new Map();
  const timers = new Map();
  const previewValues = [];
  let nextFrameId = 1;
  let nextTimerId = 1;
  let capturedPointer = null;
  let now = 0;
  let flowPending = 0;

  const sun = { style: sunStore.style };
  const moon = { style: moonStore.style };
  const thumb = {
    style: thumbStore.style,
    querySelector(selector) {
      if (selector === ".comfort-sun") return sun;
      if (selector === ".comfort-moon") return moon;
      return null;
    },
  };
  const control = { querySelector: () => thumb };
  const slider = new FakeTarget();
  slider.value = "55";
  slider.closest = () => control;
  slider.setPointerCapture = (pointerId) => { capturedPointer = pointerId; };
  slider.hasPointerCapture = (pointerId) => capturedPointer === pointerId;
  slider.releasePointerCapture = (pointerId) => {
    if (capturedPointer === pointerId) capturedPointer = null;
  };

  const rootDataset = {};
  const context = {
    document: {
      documentElement: { dataset: rootDataset },
      querySelector(selector) { return selector === "#comfort-slider" ? slider : null; },
    },
    Event: FakeEvent,
    CustomEvent: FakeEvent,
    Date,
    performance: { now: () => now },
    __INPULS_RENDER_LANES__: { pending: () => ({ chart: 0, flow: flowPending }) },
    dispatchEvent(event) {
      if (event.type === "inpuls:comfort-preview") previewValues.push(event.detail?.value);
      return true;
    },
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { animationFrames.delete(id); },
    setTimeout(callback, delay = 0) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };

  vm.runInNewContext(comfortGuard, context);

  return {
    slider,
    rootDataset,
    thumbValues: thumbStore.values,
    previewValues,
    setFlowPending(value) { flowPending = value; },
    flushFrames() {
      const pending = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of pending) callback(now);
    },
    flushOneTimer(advance = 34) {
      now += advance;
      const first = timers.entries().next().value;
      if (!first) return;
      const [id, task] = first;
      timers.delete(id);
      task.callback();
    },
    timerCount() { return timers.size; },
  };
}

test("thumb stays frame-smooth while palette preview is throttled", () => {
  const harness = buildHarness();
  let commits = 0;
  harness.slider.addEventListener("input", () => { commits += 1; });

  harness.slider.dispatchEvent(new FakeEvent("pointerdown", { pointerId: 7 }));
  harness.slider.value = "68";
  harness.slider.dispatchEvent(new FakeEvent("input", { pointerId: 7 }));
  harness.slider.value = "82";
  harness.slider.dispatchEvent(new FakeEvent("input", { pointerId: 7 }));

  assert.equal(commits, 0);
  harness.flushFrames();
  assert.equal(harness.thumbValues.get("left"), "82%");
  assert.deepEqual(harness.previewValues, []);
  assert.equal(harness.timerCount(), 1);

  harness.flushOneTimer();
  assert.deepEqual(harness.previewValues, [82]);

  harness.slider.dispatchEvent(new FakeEvent("pointerup", { pointerId: 7 }));
  assert.equal(commits, 1);
  assert.equal(harness.thumbValues.has("left"), false);
  assert.equal(harness.rootDataset.comfortDragging, undefined);
});

test("palette preview yields while Tape has pending flow work", () => {
  const harness = buildHarness();
  harness.setFlowPending(1);
  harness.slider.dispatchEvent(new FakeEvent("pointerdown", { pointerId: 5 }));
  harness.slider.value = "73";
  harness.slider.dispatchEvent(new FakeEvent("input", { pointerId: 5 }));
  harness.flushFrames();
  harness.flushOneTimer(34);
  assert.deepEqual(harness.previewValues, []);
  assert.equal(harness.timerCount(), 1);

  harness.setFlowPending(0);
  harness.flushOneTimer(16);
  assert.deepEqual(harness.previewValues, [73]);
});

test("drag preview updates the complete site palette and Canvas theme", () => {
  const start = app.indexOf("function applyComfortPreview(rawValue) {");
  const end = app.indexOf("\n\nfunction applyComfort(rawValue)", start);
  const preview = app.slice(start, end);
  assert.match(preview, /--bg/);
  assert.match(preview, /--panel/);
  assert.match(preview, /--panel-2/);
  assert.match(preview, /--line/);
  assert.match(preview, /--text/);
  assert.match(preview, /--muted/);
  assert.match(preview, /--chart-bg/);
  assert.match(preview, /--chart-bear-fill/);
  assert.match(preview, /priceChart\.setTheme\(previewChartTheme\)/);
  assert.match(preview, /inpuls:theme-change/);
  assert.doesNotMatch(preview, /localStorage/);
  assert.match(comfortGuard, /PREVIEW_INTERVAL_MS = 34/);
  assert.match(comfortGuard, /pendingFlowWork\(\)/);
  assert.match(styles, /data-comfort-dragging/);
});

test("release applies the complete palette and heavy visual modules once", () => {
  const start = app.indexOf("function applyComfort(rawValue) {");
  const end = app.indexOf("\n\nglobalThis.addEventListener(\"inpuls:comfort-preview\"", start);
  const commit = app.slice(start, end);
  assert.match(commit, /--text/);
  assert.match(commit, /--muted/);
  assert.match(commit, /--chart-bg/);
  assert.match(commit, /priceChart\.setTheme\(activeChartTheme\)/);
  assert.match(commit, /panel\.chart\.setTheme\(activeChartTheme\)/);
  assert.match(commit, /inpuls:theme-change/);
});

test("Tape-priority comfort build ships fresh cache keys", () => {
  assert.match(index, /styles\.css\?v=26-125-aster-alpha-v1/);
  assert.match(index, /runtime-boot-recovery\.js\?v=26-99-tape-priority-comfort-v1/);
  assert.match(index, /install-cta\.js\?v=26-125-aster-alpha-v1/);
  assert.match(index, /app\.js\?v=26-125-aster-alpha-v1/);
});
