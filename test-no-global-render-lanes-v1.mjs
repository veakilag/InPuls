import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtime = readFileSync(new URL("./runtime-boot-recovery.js", import.meta.url), "utf8");

test("runtime leaves animation frames native and local to each widget", () => {
  assert.doesNotMatch(runtime, /function installRenderLaneIsolation\(/);
  assert.doesNotMatch(runtime, /window\.requestAnimationFrame\s*=/);
  assert.doesNotMatch(runtime, /window\.cancelAnimationFrame\s*=/);
  assert.doesNotMatch(runtime, /__INPULS_RENDER_LANES__/);
  assert.doesNotMatch(runtime, /classifyRenderLane|CHART_BUDGET_MS|FLOW_BUDGET_MS/);
});

test("removing render lanes does not widen recovery storage cleanup", () => {
  assert.doesNotMatch(runtime, /localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase/);
  assert.match(runtime, /function installRenderPacing\(\)/);
  assert.match(runtime, /installRenderPacing\(\)/);
});
