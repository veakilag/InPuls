import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./runtime-boot-recovery.js", import.meta.url), "utf8");

test("runtime recovery no longer contains the retired Lite Shell", () => {
  assert.doesNotMatch(source, /__INPULS_LITE_MODE__/);
  assert.doesNotMatch(source, /primary\.hidden\s*=\s*true/);
  assert.doesNotMatch(source, /activity\.hidden\s*=\s*true/);
  assert.doesNotMatch(source, /settings\.maxRows\s*=\s*0/);
  assert.doesNotMatch(source, /installPrimaryChartNetworkGate/);
  assert.doesNotMatch(source, /installPrimaryChartSocketGate/);
  assert.doesNotMatch(source, /installRenderPacing/);
});

test("runtime recovery never mutates workspace or user settings", () => {
  assert.doesNotMatch(source, /WORKSPACE_KEY/);
  assert.doesNotMatch(source, /SETTINGS_KEY/);
  assert.doesNotMatch(source, /writeJson\(localStorage/);
  assert.doesNotMatch(source, /localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase/);
});

test("runtime recovery never gates chart history or kline streaming", () => {
  assert.doesNotMatch(source, /new Response\("\[\]"/);
  assert.doesNotMatch(source, /class InPulsLiteWebSocket/);
  assert.doesNotMatch(source, /@kline_/);
  assert.doesNotMatch(source, /window\.fetch\s*=/);
  assert.doesNotMatch(source, /window\.WebSocket\s*=/);
});

test("runtime recovery never installs global render pacing", () => {
  assert.doesNotMatch(source, /window\.setTimeout\s*=/);
  assert.doesNotMatch(source, /window\.setInterval\s*=/);
  assert.doesNotMatch(source, /LIVE_RENDER_DELAY_MS|PERIODIC_RENDER_DELAY_MS/);
});

test("runtime recovery keeps the watchdog and scoped cache recovery", () => {
  assert.match(source, /WATCHDOG_DELAY_MS/);
  assert.match(source, /scheduleRuntimeWatchdog\(\)/);
  assert.match(source, /performScopedRecovery\("watchdog", true\)/);
  assert.match(source, /isInPulsRegistration/);
  assert.match(source, /caches\.keys\(\)/);
  assert.match(source, /key\.startsWith\("inpuls-"\)/);
});
