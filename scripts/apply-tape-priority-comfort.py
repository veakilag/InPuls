from pathlib import Path

BUILD = "26-99-tape-priority-comfort-v1"
APP = Path("app.js")
BOOT = Path("runtime-boot-recovery.js")
INSTALL = Path("install-cta.js")
INDEX = Path("index.html")
STYLES = Path("styles.css")

boot = BOOT.read_text(encoding="utf-8")
boot = boot.replace(
    'const APP_BUILD = "26-95-lite-shell-pr90-speed-v1";',
    f'const APP_BUILD = "{BUILD}";',
    1,
)
if "function installRenderLaneIsolation()" in boot:
    raise SystemExit("Render lane isolation already exists")

lane_code = r'''
  function installRenderLaneIsolation() {
    const revision = "26-99-tape-priority-comfort-v1";
    if (globalThis.__INPULS_RENDER_LANES__?.revision === revision) return;
    if (typeof window.requestAnimationFrame !== "function"
      || typeof window.cancelAnimationFrame !== "function") return;

    const nativeRequestFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelFrame = window.cancelAnimationFrame.bind(window);
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeNow = () => performance.now();
    const chartQueue = [];
    const flowQueue = [];
    const tasks = new Map();
    const stats = {
      chartFrames: 0,
      chartCallbacks: 0,
      chartMaxFrameMs: 0,
      flowFrames: 0,
      flowCallbacks: 0,
      flowMaxTaskMs: 0,
      cancelled: 0,
    };
    const CHART_BUDGET_MS = 7;
    const CHART_MAX_PER_FRAME = 2;
    const FLOW_BUDGET_MS = 4;
    const FLOW_MAX_PER_TASK = 1;
    let nextVirtualHandle = -1;
    let chartFrame = 0;
    let flowFrame = 0;
    let flowTaskPending = false;
    let pendingFlowTimestamp = 0;
    let pendingFlowFlush = null;

    const channel = typeof MessageChannel === "function" ? new MessageChannel() : null;
    if (channel) {
      channel.port1.onmessage = () => {
        const flush = pendingFlowFlush;
        pendingFlowFlush = null;
        flowTaskPending = false;
        flush?.();
      };
    }

    function classifyRenderLane(callback) {
      if (typeof callback !== "function") return null;
      const name = String(callback.name || "");
      let body = "";
      try { body = Function.prototype.toString.call(callback); } catch {}

      if (
        name === "runTapeDrawFrame"
        || name === "drainTapeIngest"
        || (name === "runDrawFrame" && body.includes("dirtyCards"))
      ) return "flow";

      if (
        body.includes("this.renderFrame = null")
        && body.includes("this.render()")
      ) return "chart";

      return null;
    }

    function takeNext(queue, lane) {
      while (queue.length) {
        const handle = queue.shift();
        const task = tasks.get(handle);
        if (!task || task.lane !== lane) continue;
        tasks.delete(handle);
        return task;
      }
      return null;
    }

    function pendingIn(queue, lane) {
      return queue.some((handle) => tasks.get(handle)?.lane === lane);
    }

    function invoke(task, timestamp) {
      try {
        task.callback(timestamp);
      } catch (error) {
        nativeSetTimeout(() => { throw error; }, 0);
      }
    }

    function ensureChartFrame() {
      if (chartFrame || !pendingIn(chartQueue, "chart")) return;
      chartFrame = nativeRequestFrame((timestamp) => {
        chartFrame = 0;
        const startedAt = nativeNow();
        let processed = 0;
        while (processed < CHART_MAX_PER_FRAME) {
          const task = takeNext(chartQueue, "chart");
          if (!task) break;
          invoke(task, timestamp);
          processed += 1;
          if (nativeNow() - startedAt >= CHART_BUDGET_MS) break;
        }
        const duration = nativeNow() - startedAt;
        stats.chartFrames += 1;
        stats.chartCallbacks += processed;
        stats.chartMaxFrameMs = Math.max(stats.chartMaxFrameMs, duration);
        ensureChartFrame();
      });
    }

    function flushFlowLane(timestamp) {
      const startedAt = nativeNow();
      let processed = 0;
      while (processed < FLOW_MAX_PER_TASK) {
        const task = takeNext(flowQueue, "flow");
        if (!task) break;
        invoke(task, timestamp);
        processed += 1;
        if (nativeNow() - startedAt >= FLOW_BUDGET_MS) break;
      }
      const duration = nativeNow() - startedAt;
      stats.flowFrames += 1;
      stats.flowCallbacks += processed;
      stats.flowMaxTaskMs = Math.max(stats.flowMaxTaskMs, duration);
      ensureFlowFrame();
    }

    function queuePostPaintFlow(timestamp) {
      pendingFlowTimestamp = timestamp;
      if (flowTaskPending) return;
      flowTaskPending = true;
      const flush = () => flushFlowLane(pendingFlowTimestamp || nativeNow());
      if (channel) {
        pendingFlowFlush = flush;
        channel.port2.postMessage(0);
      } else {
        nativeSetTimeout(() => {
          flowTaskPending = false;
          flush();
        }, 0);
      }
    }

    function ensureFlowFrame() {
      if (flowFrame || flowTaskPending || !pendingIn(flowQueue, "flow")) return;
      flowFrame = nativeRequestFrame((timestamp) => {
        flowFrame = 0;
        queuePostPaintFlow(timestamp);
      });
    }

    window.requestAnimationFrame = function inpulsLaneRequestAnimationFrame(callback) {
      const lane = classifyRenderLane(callback);
      if (!lane) return nativeRequestFrame(callback);
      const handle = nextVirtualHandle--;
      tasks.set(handle, { handle, lane, callback });
      if (lane === "chart") {
        chartQueue.push(handle);
        ensureChartFrame();
      } else {
        flowQueue.push(handle);
        ensureFlowFrame();
      }
      return handle;
    };

    window.cancelAnimationFrame = function inpulsLaneCancelAnimationFrame(handle) {
      if (Number(handle) < 0 && tasks.delete(handle)) {
        stats.cancelled += 1;
        return;
      }
      nativeCancelFrame(handle);
    };

    globalThis.__INPULS_RENDER_LANES__ = {
      revision,
      chart: Object.freeze({ budgetMs: CHART_BUDGET_MS, maxPerFrame: CHART_MAX_PER_FRAME }),
      flow: Object.freeze({ budgetMs: FLOW_BUDGET_MS, maxPerTask: FLOW_MAX_PER_TASK, phase: "post-paint" }),
      stats,
      pending() {
        return {
          chart: [...tasks.values()].filter((task) => task.lane === "chart").length,
          flow: [...tasks.values()].filter((task) => task.lane === "flow").length,
        };
      },
    };
  }
'''
anchor = "\n  function installRenderPacing() {"
if anchor not in boot:
    raise SystemExit("Render pacing anchor not found")
boot = boot.replace(anchor, lane_code + anchor, 1)
old_install = "    installPrimaryChartSocketGate();\n    installRenderPacing();"
new_install = "    installPrimaryChartSocketGate();\n    installRenderLaneIsolation();\n    installRenderPacing();"
if old_install not in boot:
    raise SystemExit("Lite shell install anchor not found")
boot = boot.replace(old_install, new_install, 1)
BOOT.write_text(boot, encoding="utf-8")

install = INSTALL.read_text(encoding="utf-8")
second_iife = install.index("\n\n(() => {", 1)
new_guard = r'''(() => {
  const slider = document.querySelector("#comfort-slider");
  if (!slider) return;

  const root = document.documentElement;
  const control = slider.closest(".comfort-control");
  const thumb = control?.querySelector(".comfort-thumb-icon") ?? null;
  const sun = thumb?.querySelector(".comfort-sun") ?? null;
  const moon = thumb?.querySelector(".comfort-moon") ?? null;
  const PREVIEW_INTERVAL_MS = 34;
  const PREVIEW_MAX_DEFER_MS = 102;
  let pointerDragging = false;
  let committingTheme = false;
  let pendingValue = Number(slider.value || 55);
  let thumbFrame = null;
  let previewTimer = null;
  let lastPreviewAt = Number.NEGATIVE_INFINITY;
  let previewDeferredAt = 0;

  function normalizedValue() {
    return Math.max(0, Math.min(100, Number(slider.value) || 0));
  }

  function clockNow() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function pendingFlowWork() {
    try {
      return Number(globalThis.__INPULS_RENDER_LANES__?.pending?.().flow) || 0;
    } catch {
      return 0;
    }
  }

  function applyThumbVisual() {
    const amount = pendingValue / 100;
    const moonProgress = Math.max(0, Math.min(1, (amount - .2) / .7));
    thumb?.style.setProperty("left", `${pendingValue}%`);
    sun?.style.setProperty("opacity", String(1 - moonProgress));
    sun?.style.setProperty("transform", `scale(${1 - moonProgress}) rotate(${moonProgress * 38}deg)`);
    moon?.style.setProperty("opacity", String(moonProgress));
    moon?.style.setProperty("transform", `scale(${moonProgress}) rotate(${(1 - moonProgress) * -24}deg)`);
  }

  function clearThumbVisual() {
    thumb?.style.removeProperty("left");
    sun?.style.removeProperty("opacity");
    sun?.style.removeProperty("transform");
    moon?.style.removeProperty("opacity");
    moon?.style.removeProperty("transform");
  }

  function flushPalettePreview() {
    previewTimer = null;
    if (!pointerDragging) return;
    const now = clockNow();
    if (pendingFlowWork() > 0 && now - previewDeferredAt < PREVIEW_MAX_DEFER_MS) {
      schedulePalettePreview(16);
      return;
    }
    lastPreviewAt = now;
    previewDeferredAt = now;
    globalThis.dispatchEvent(new CustomEvent("inpuls:comfort-preview", {
      detail: { value: pendingValue },
    }));
  }

  function schedulePalettePreview(delayOverride = null) {
    if (previewTimer !== null) return;
    const elapsed = clockNow() - lastPreviewAt;
    const delay = delayOverride ?? Math.max(0, PREVIEW_INTERVAL_MS - elapsed);
    previewTimer = globalThis.setTimeout(flushPalettePreview, delay);
  }

  function flushThumbPosition() {
    thumbFrame = null;
    applyThumbVisual();
    schedulePalettePreview();
  }

  function scheduleThumbPosition() {
    if (thumbFrame !== null) return;
    thumbFrame = requestAnimationFrame(flushThumbPosition);
  }

  function cancelPendingPreview() {
    if (thumbFrame !== null) {
      cancelAnimationFrame(thumbFrame);
      thumbFrame = null;
    }
    if (previewTimer !== null) {
      globalThis.clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function commitThemeOnce() {
    cancelPendingPreview();
    pendingValue = normalizedValue();
    applyThumbVisual();
    committingTheme = true;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    committingTheme = false;
    clearThumbVisual();
  }

  slider.addEventListener("pointerdown", (event) => {
    pointerDragging = true;
    pendingValue = normalizedValue();
    previewDeferredAt = clockNow();
    root.dataset.comfortDragging = "true";
    thumb?.style.setProperty("transition", "none");
    try { slider.setPointerCapture(event.pointerId); } catch {}
  }, { passive: true });

  slider.addEventListener("input", (event) => {
    if (committingTheme || !pointerDragging) return;
    event.stopImmediatePropagation();
    pendingValue = normalizedValue();
    scheduleThumbPosition();
  });

  function finishPointerDrag(event) {
    if (!pointerDragging) return;
    pointerDragging = false;
    try {
      if (slider.hasPointerCapture?.(event.pointerId)) slider.releasePointerCapture(event.pointerId);
    } catch {}
    commitThemeOnce();
    delete root.dataset.comfortDragging;
    thumb?.style.removeProperty("transition");
  }

  slider.addEventListener("pointerup", finishPointerDrag);
  slider.addEventListener("pointercancel", finishPointerDrag);
  slider.addEventListener("lostpointercapture", finishPointerDrag);
})();'''
install = new_guard + install[second_iife:]
INSTALL.write_text(install, encoding="utf-8")

app = APP.read_text(encoding="utf-8")
preview_start = app.index("function applyComfortPreview(rawValue) {")
preview_end = app.index("\n\nfunction applyComfort(rawValue)", preview_start)
preview_block = r'''function applyComfortPreview(rawValue) {
  const theme = buildComfortTheme(rawValue);
  const { value, palette } = theme;
  const root = document.documentElement;
  root.style.setProperty("--bg", palette.bg);
  root.style.setProperty("--panel", palette.panel);
  root.style.setProperty("--panel-2", palette.panel2);
  root.style.setProperty("--line", palette.line);
  root.style.setProperty("--line-soft", `${palette.line}55`);
  root.dataset.comfortPreview = String(Math.round(value));
  return theme;
}'''
app = app[:preview_start] + preview_block + app[preview_end:]
commit_start = app.index("function applyComfort(rawValue) {")
commit_end = app.index("\n\nglobalThis.addEventListener(\"inpuls:comfort-preview\"", commit_start)
commit_block = r'''function applyComfort(rawValue) {
  const theme = buildComfortTheme(rawValue);
  const { value, amount, turquoise, cyan, blue, violet, red, palette } = theme;
  const root = document.documentElement;
  root.style.setProperty("--bg", palette.bg);
  root.style.setProperty("--panel", palette.panel);
  root.style.setProperty("--panel-2", palette.panel2);
  root.style.setProperty("--line", palette.line);
  root.style.setProperty("--line-soft", `${palette.line}55`);
  root.style.setProperty("--text", palette.text);
  root.style.setProperty("--muted", palette.muted);
  root.style.setProperty("--chart-bg", palette.chart);
  root.style.setProperty("--accent", cyan);
  root.style.setProperty("--cyan", cyan);
  root.style.setProperty("--violet", violet);
  root.style.setProperty("--green", turquoise);
  root.style.setProperty("--blue", blue);
  root.style.setProperty("--red", red);
  root.style.setProperty("--chart-bull-fill", palette.bull);
  root.style.setProperty("--chart-bull-stroke", palette.bull);
  root.style.setProperty("--chart-bear-fill", palette.bear);
  root.style.setProperty("--chart-bear-stroke", palette.bearStroke);
  root.style.setProperty("--theme-level", String(amount));
  root.style.setProperty("--comfort-position", `${value}%`);
  const moonProgress = Math.max(0, Math.min(1, (amount - .2) / .7));
  root.style.setProperty("--comfort-sun-opacity", String(1 - moonProgress));
  root.style.setProperty("--comfort-moon-opacity", String(moonProgress));
  root.style.setProperty("--comfort-sun-rotate", `${moonProgress * 38}deg`);
  root.style.setProperty("--comfort-moon-rotate", `${(1 - moonProgress) * -24}deg`);
  root.style.colorScheme = "dark";
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
}'''
app = app[:commit_start] + commit_block + app[commit_end:]
APP.write_text(app, encoding="utf-8")

styles = STYLES.read_text(encoding="utf-8")
transition = "body, .topbar, .chart-card, .top-card, .workspace-panel, .timeframes, .search-box, thead, .detail-panel, .settings-dialog { transition: color .16s ease, background-color .16s ease, border-color .16s ease; }"
if transition not in styles:
    raise SystemExit("Theme transition rule not found")
styles = styles.replace(
    transition,
    transition + "\nhtml[data-comfort-dragging=\"true\"] body, html[data-comfort-dragging=\"true\"] .topbar, html[data-comfort-dragging=\"true\"] .chart-card, html[data-comfort-dragging=\"true\"] .top-card, html[data-comfort-dragging=\"true\"] .workspace-panel, html[data-comfort-dragging=\"true\"] .timeframes, html[data-comfort-dragging=\"true\"] .search-box, html[data-comfort-dragging=\"true\"] thead, html[data-comfort-dragging=\"true\"] .detail-panel, html[data-comfort-dragging=\"true\"] .settings-dialog { transition: none; }",
    1,
)
STYLES.write_text(styles, encoding="utf-8")

index = INDEX.read_text(encoding="utf-8")
replacements = [
    ('styles.css?v=26-91-runtime-boot-cache-feed-v1', f'styles.css?v={BUILD}'),
    ('runtime-boot-recovery.js?v=26-91-runtime-boot-cache-feed-v1', f'runtime-boot-recovery.js?v={BUILD}'),
    ('install-cta.js?v=comfort-live-preview-v1', 'install-cta.js?v=comfort-tape-priority-v1'),
    ('app.js?v=26-98-live-comfort-preview-v1', f'app.js?v={BUILD}'),
]
for old, new in replacements:
    if old not in index:
        raise SystemExit(f"Index marker missing: {old}")
    index = index.replace(old, new, 1)
INDEX.write_text(index, encoding="utf-8")

for filename in [
    "test-orderbook-resume-v2.mjs",
    "test-orderbook-runtime-stability.mjs",
    "test-smooth-chart-first-v1.mjs",
]:
    path = Path(filename)
    source = path.read_text(encoding="utf-8")
    source = source.replace("app\\.js\\?v=26-98-live-comfort-preview-v1", f"app\\.js\\?v={BUILD}")
    path.write_text(source, encoding="utf-8")

runtime_test = Path("test-runtime-boot-cache-feed-v1.mjs")
runtime_source = runtime_test.read_text(encoding="utf-8")
runtime_source = runtime_source.replace(
    'const APP_BUILD = "26-91-runtime-boot-cache-feed-v1";',
    f'const APP_BUILD = "{BUILD}";',
    1,
)
runtime_test.write_text(runtime_source, encoding="utf-8")

Path("test-render-lane-isolation-v1.mjs").write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./runtime-boot-recovery.js", import.meta.url), "utf8");

function laneInstallerSource() {
  const start = source.indexOf("  function installRenderLaneIsolation() {");
  const end = source.indexOf("\n  function installRenderPacing()", start);
  assert.ok(start >= 0 && end > start, "render lane installer must be extractable");
  return source.slice(start, end);
}

function createLaneHarness() {
  const nativeFrames = [];
  const postPaintTasks = [];
  const cancelledNative = [];
  let nextNativeHandle = 1;
  let now = 0;

  class FakeMessageChannel {
    constructor() {
      this.port1 = { onmessage: null };
      this.port2 = {
        postMessage: () => postPaintTasks.push(() => this.port1.onmessage?.({ data: 0 })),
      };
    }
  }

  const window = {
    requestAnimationFrame(callback) {
      const handle = nextNativeHandle++;
      nativeFrames.push({ handle, callback });
      return handle;
    },
    cancelAnimationFrame(handle) {
      cancelledNative.push(handle);
    },
    setTimeout(callback) {
      postPaintTasks.push(callback);
      return 1;
    },
  };

  const context = vm.createContext({
    window,
    MessageChannel: FakeMessageChannel,
    performance: { now: () => now += 0.25 },
    console,
    setTimeout: window.setTimeout,
  });
  vm.runInContext(`${laneInstallerSource()}\ninstallRenderLaneIsolation();`, context);

  return {
    context,
    nativeFrames,
    postPaintTasks,
    cancelledNative,
    runNativeFrame(timestamp = 16) {
      const frame = nativeFrames.splice(0);
      frame.forEach(({ callback }) => callback(timestamp));
    },
    runPostPaintTask() {
      postPaintTasks.shift()?.();
    },
  };
}

test("chart and Tape use explicit independent render lanes", () => {
  assert.match(source, /26-99-tape-priority-comfort-v1/);
  assert.match(source, /function installRenderLaneIsolation\(\)/);
  assert.match(source, /name === "runTapeDrawFrame"/);
  assert.match(source, /name === "drainTapeIngest"/);
  assert.match(source, /body\.includes\("this\.renderFrame = null"\)/);
  assert.match(source, /body\.includes\("this\.render\(\)"\)/);
  assert.match(source, /const chartQueue = \[\]/);
  assert.match(source, /const flowQueue = \[\]/);
});

test("charts keep a reserved pre-paint budget and flow is post-paint", () => {
  assert.match(source, /const CHART_BUDGET_MS = 7/);
  assert.match(source, /const CHART_MAX_PER_FRAME = 2/);
  assert.match(source, /const FLOW_BUDGET_MS = 4/);
  assert.match(source, /const FLOW_MAX_PER_TASK = 1/);
  assert.match(source, /channel\.port2\.postMessage\(0\)/);
  assert.match(source, /phase: "post-paint"/);
});

test("one browser frame paints charts before executing Tape work", () => {
  const harness = createLaneHarness();
  vm.runInContext(`
    globalThis.executionOrder = [];
    globalThis.chart = {
      renderFrame: null,
      render() { globalThis.executionOrder.push("chart"); },
      request() {
        this.renderFrame = window.requestAnimationFrame(() => {
          this.renderFrame = null;
          this.render();
        });
      },
    };
    function runTapeDrawFrame() { globalThis.executionOrder.push("tape"); }
    chart.request();
    window.requestAnimationFrame(runTapeDrawFrame);
  `, harness.context);

  harness.runNativeFrame();
  assert.deepEqual([...harness.context.executionOrder], ["chart"]);
  assert.equal(harness.postPaintTasks.length, 1);

  harness.runPostPaintTask();
  assert.deepEqual([...harness.context.executionOrder], ["chart", "tape"]);
  assert.equal(harness.context.__INPULS_RENDER_LANES__.stats.chartCallbacks, 1);
  assert.equal(harness.context.__INPULS_RENDER_LANES__.stats.flowCallbacks, 1);
});

test("render lane isolation preserves native callbacks and cancellation", () => {
  const harness = createLaneHarness();
  vm.runInContext(`
    globalThis.nativeRan = false;
    globalThis.flowRan = false;
    function ordinaryAnimation() { globalThis.nativeRan = true; }
    function drainTapeIngest() { globalThis.flowRan = true; }
    globalThis.nativeHandle = window.requestAnimationFrame(ordinaryAnimation);
    globalThis.flowHandle = window.requestAnimationFrame(drainTapeIngest);
    window.cancelAnimationFrame(globalThis.flowHandle);
  `, harness.context);

  assert.ok(harness.context.nativeHandle > 0);
  assert.ok(harness.context.flowHandle < 0);
  harness.runNativeFrame();
  harness.runPostPaintTask();
  assert.equal(harness.context.nativeRan, true);
  assert.equal(harness.context.flowRan, false);
  assert.equal(harness.context.__INPULS_RENDER_LANES__.stats.cancelled, 1);

  assert.match(source, /if \(!lane\) return nativeRequestFrame\(callback\)/);
  assert.match(source, /nativeCancelFrame\(handle\)/);
  assert.match(source, /tasks\.delete\(handle\)/);
  assert.doesNotMatch(source, /localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase/);
});
''', encoding="utf-8")

Path("test-comfort-slider-smooth-v1.mjs").write_text(r'''import assert from "node:assert/strict";
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

test("drag preview updates only surface colors and never Canvas theme", () => {
  const start = app.indexOf("function applyComfortPreview(rawValue) {");
  const end = app.indexOf("\n\nfunction applyComfort(rawValue)", start);
  const preview = app.slice(start, end);
  assert.match(preview, /--bg/);
  assert.match(preview, /--panel/);
  assert.match(preview, /--panel-2/);
  assert.match(preview, /--line/);
  assert.doesNotMatch(preview, /--text|--muted|--chart-bg|--chart-bear-fill/);
  assert.doesNotMatch(preview, /setTheme|inpuls:theme-change|localStorage/);
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
  assert.match(index, /styles\.css\?v=26-99-tape-priority-comfort-v1/);
  assert.match(index, /runtime-boot-recovery\.js\?v=26-99-tape-priority-comfort-v1/);
  assert.match(index, /install-cta\.js\?v=comfort-tape-priority-v1/);
  assert.match(index, /app\.js\?v=26-99-tape-priority-comfort-v1/);
});
''', encoding="utf-8")

Path("docs/tape-priority-comfort-preview.md").write_text("""# Tape priority during comfort slider drag\n\nThe comfort slider keeps its thumb on the native animation-frame path, while palette preview is throttled to roughly 30 FPS and deferred whenever the Tape/Footprint flow lane has pending work. During drag only surface CSS variables change; Canvas themes are committed once on pointer release.\n\nThe chart and flow render lanes from PR 116 are restored: charts use a bounded pre-paint lane and Tape, Tape ingest and Footprint use a bounded post-paint lane. Both remain on the browser main thread.\n""", encoding="utf-8")
