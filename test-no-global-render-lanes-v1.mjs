import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtime = readFileSync(new URL("./runtime-boot-recovery.js", import.meta.url), "utf8");

test("runtime leaves animation frames and render scheduling native", () => {
  assert.doesNotMatch(runtime, /window\.requestAnimationFrame\s*=/);
  assert.doesNotMatch(runtime, /window\.cancelAnimationFrame\s*=/);
  assert.doesNotMatch(runtime, /__INPULS_RENDER_LANES__/);
  assert.doesNotMatch(runtime, /installRenderLaneIsolation|installRenderPacing/);
  assert.doesNotMatch(runtime, /CHART_BUDGET_MS|FLOW_BUDGET_MS/);
  assert.doesNotMatch(runtime, /window\.setTimeout\s*=/);
  assert.doesNotMatch(runtime, /window\.setInterval\s*=/);
});

test("recovery storage cleanup remains narrowly scoped", () => {
  assert.doesNotMatch(runtime, /localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase/);
  assert.match(runtime, /key\.startsWith\("inpuls-"\)/);
  assert.match(runtime, /isInPulsRegistration/);
});
