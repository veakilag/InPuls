from pathlib import Path

APP = Path("app.js")
INSTALL = Path("install-cta.js")
INDEX = Path("index.html")
TEST = Path("test-comfort-slider-smooth-v1.mjs")

app = APP.read_text(encoding="utf-8")
start = app.index("function applyComfort(rawValue) {")
end = app.index("\n\nfunction applyFontScale", start)
replacement = r'''function buildComfortTheme(rawValue) {
  const value = Math.max(0, Math.min(100, Number(rawValue) || 0));
  const amount = value / 100;
  const turquoise = "#42d9b1";
  const cyan = "#42d9cf";
  const blue = "#65b7ff";
  const violet = "#aa86ff";
  const red = "#ff7181";
  const palette = {
    bg: mixColor("#24272c", "#080a0d", amount),
    panel: mixColor("#2d3137", "#111419", amount),
    panel2: mixColor("#383d44", "#181c22", amount),
    line: mixColor("#656d76", "#303740", amount),
    text: mixColor("#f7f9fa", "#e2e7eb", amount),
    muted: mixColor("#c0c6cc", "#87919b", amount),
    chart: mixColor("#1f2227", "#090b0e", amount),
    bull: turquoise,
    bear: mixColor("#454b52", "#1b1f25", amount),
    bearStroke: red,
    grid: mixColor("#727981", "#3a424b", amount),
    crosshair: mixColor("#e0e4e7", "#9aa4ad", amount),
    crosshairFill: mixColor("#505861", "#252b32", amount),
    crosshairText: "#f7f9fa",
  };
  return { value, amount, turquoise, cyan, blue, violet, red, palette };
}

function applyComfortPreview(rawValue) {
  const theme = buildComfortTheme(rawValue);
  const { value, amount, palette } = theme;
  const root = document.documentElement;
  root.style.setProperty("--bg", palette.bg);
  root.style.setProperty("--panel", palette.panel);
  root.style.setProperty("--panel-2", palette.panel2);
  root.style.setProperty("--line", palette.line);
  root.style.setProperty("--line-soft", `${palette.line}55`);
  root.style.setProperty("--text", palette.text);
  root.style.setProperty("--muted", palette.muted);
  root.style.setProperty("--chart-bg", palette.chart);
  root.style.setProperty("--chart-bear-fill", palette.bear);
  root.style.setProperty("--theme-level", String(amount));
  root.style.setProperty("--comfort-position", `${value}%`);
  const moonProgress = Math.max(0, Math.min(1, (amount - .2) / .7));
  root.style.setProperty("--comfort-sun-opacity", String(1 - moonProgress));
  root.style.setProperty("--comfort-moon-opacity", String(moonProgress));
  root.style.setProperty("--comfort-sun-rotate", `${moonProgress * 38}deg`);
  root.style.setProperty("--comfort-moon-rotate", `${(1 - moonProgress) * -24}deg`);
  root.style.colorScheme = "dark";
  root.dataset.comfortPreview = String(Math.round(value));
  return theme;
}

function applyComfort(rawValue) {
  const theme = applyComfortPreview(rawValue);
  const { value, turquoise, cyan, blue, violet, red, palette } = theme;
  const root = document.documentElement;
  root.style.setProperty("--accent", cyan);
  root.style.setProperty("--cyan", cyan);
  root.style.setProperty("--violet", violet);
  root.style.setProperty("--green", turquoise);
  root.style.setProperty("--blue", blue);
  root.style.setProperty("--red", red);
  root.style.setProperty("--chart-bull-fill", palette.bull);
  root.style.setProperty("--chart-bull-stroke", palette.bull);
  root.style.setProperty("--chart-bear-stroke", palette.bearStroke);
  root.dataset.comfort = String(Math.round(value));
  delete root.dataset.comfortPreview;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = palette.bg;
  activeChartTheme = {
    background: palette.chart,
    bullFill: palette.bull,
    bullStroke: palette.bull,
    bearFill: palette.bear,
    bearStroke: palette.bearStroke,
    grid: palette.grid,
    text: palette.muted,
    crosshair: palette.crosshair,
    crosshairFill: palette.crosshairFill,
    crosshairText: palette.crosshairText,
    session: violet,
  };
  priceChart.setTheme(activeChartTheme);
  for (const panel of extraCharts.values()) panel.chart.setTheme(activeChartTheme);
  globalThis.dispatchEvent(new CustomEvent("inpuls:theme-change"));
}

globalThis.addEventListener("inpuls:comfort-preview", (event) => {
  const value = Number(event.detail?.value);
  if (Number.isFinite(value)) applyComfortPreview(value);
});'''
app = app[:start] + replacement + app[end:]
APP.write_text(app, encoding="utf-8")

install = INSTALL.read_text(encoding="utf-8")
old_flush = '''  function flushThumbPosition() {
    thumbFrame = null;
    root.style.setProperty("--comfort-position", `${pendingValue}%`);
  }
'''
new_flush = '''  function flushThumbPosition() {
    thumbFrame = null;
    root.style.setProperty("--comfort-position", `${pendingValue}%`);
    globalThis.dispatchEvent(new CustomEvent("inpuls:comfort-preview", {
      detail: { value: pendingValue },
    }));
  }
'''
if old_flush not in install:
    raise SystemExit("Unexpected comfort thumb implementation")
install = install.replace(old_flush, new_flush, 1)
INSTALL.write_text(install, encoding="utf-8")

index = INDEX.read_text(encoding="utf-8")
old_script = '<script src="./install-cta.js?v=pwa-install-cta-v2"></script>'
new_script = '<script src="./install-cta.js?v=comfort-live-preview-v1"></script>'
if old_script not in index:
    raise SystemExit("Unexpected install-cta cache key")
index = index.replace(old_script, new_script, 1)
INDEX.write_text(index, encoding="utf-8")

TEST.write_text(r'''import assert from "node:assert/strict";
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
});
''', encoding="utf-8")
