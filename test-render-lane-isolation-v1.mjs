import assert from "node:assert/strict";
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
