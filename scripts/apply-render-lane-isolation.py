from pathlib import Path

runtime_path = Path("runtime-boot-recovery.js")
source = runtime_path.read_text(encoding="utf-8")

old_build = '  const APP_BUILD = "26-95-lite-shell-pr90-speed-v1";'
new_build = '  const APP_BUILD = "26-96-independent-tape-chart-lanes-v1";'
if old_build not in source:
    raise SystemExit("Unexpected runtime build marker")
source = source.replace(old_build, new_build, 1)

marker = "  function installRenderPacing() {\n"
if marker not in source:
    raise SystemExit("Render pacing marker not found")

lane_runtime = r'''  function installRenderLaneIsolation() {
    const revision = "26-96-independent-tape-chart-lanes-v1";
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
source = source.replace(marker, lane_runtime + marker, 1)

call_marker = "    installPrimaryChartSocketGate();\n    installRenderPacing();"
call_replacement = "    installPrimaryChartSocketGate();\n    installRenderLaneIsolation();\n    installRenderPacing();"
if call_marker not in source:
    raise SystemExit("Lite shell install marker not found")
source = source.replace(call_marker, call_replacement, 1)

runtime_path.write_text(source, encoding="utf-8")

Path("test-render-lane-isolation-v1.mjs").write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./runtime-boot-recovery.js", import.meta.url), "utf8");

test("chart and Tape use explicit independent render lanes", () => {
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

test("render lane isolation preserves native callbacks and cancellation", () => {
  assert.match(source, /if \(!lane\) return nativeRequestFrame\(callback\)/);
  assert.match(source, /nativeCancelFrame\(handle\)/);
  assert.match(source, /tasks\.delete\(handle\)/);
  assert.doesNotMatch(source, /localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase/);
});
''', encoding="utf-8")

Path("docs/render-lane-isolation.md").write_text(r'''# Independent Tape and chart render lanes

Build: `26-96-independent-tape-chart-lanes-v1`.

## Goal

Prevent a busy Tape or footprint frame from consuming the same browser render turn as candlestick charts.

## Contract

- Candlestick callbacks are queued in a dedicated high-priority chart lane.
- The chart lane runs before paint, renders at most two charts per frame, and stops after a 7 ms budget.
- Tape drawing, Tape ingest, and footprint drawing use a separate flow lane.
- The flow lane runs after the browser paint opportunity, handles one heavy callback per task, and targets a 4 ms budget.
- Cancellation remains compatible with existing `cancelAnimationFrame` calls.
- Unrelated animation callbacks still use the browser-native scheduler.

## Data safety

This change affects visual scheduling only. It does not change Binance streams, Worker processing, depth `U/u/pu` sequencing, stored trades, Signal Lab, or user workspace data.

## Limitation

Both lanes still execute on the browser main thread. The separation reserves chart time and bounds flow work, but it is not the same as moving Canvas rendering to an `OffscreenCanvas` Worker. That larger migration should be justified by measured frame and long-task data.
''', encoding="utf-8")
