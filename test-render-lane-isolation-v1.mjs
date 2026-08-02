import assert from "node:assert/strict";
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
