import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./runtime-boot-recovery.js", import.meta.url), "utf8");

test("lite shell disables removed first-screen modules before app startup", () => {
  assert.match(source, /document\.querySelector\("#event-radar-beta-toggle"\)\?\.remove\(\)/);
  assert.match(source, /if \(primary\) primary\.hidden = true/);
  assert.match(source, /if \(activity\) activity\.hidden = true/);
  assert.match(source, /settings\.maxRows = 0/);
  assert.match(source, /primaryChart: false/);
  assert.match(source, /activityTable: false/);
  assert.match(source, /eventRadarBeta: false/);
});

test("lite shell preserves user-created workspace panels", () => {
  assert.match(source, /if \(!Array\.isArray\(workspace\.extras\)\) workspace\.extras = \[\]/);
  assert.match(source, /writeJson\(localStorage, WORKSPACE_KEY, workspace\)/);
});

test("hidden primary chart no longer performs heavy history requests or kline streaming", () => {
  assert.match(source, /limit === 120 \|\| limit === 1500/);
  assert.match(source, /new Response\("\[\]"/);
  assert.match(source, /class InPulsLiteWebSocket extends EventTarget/);
  assert.match(source, /value\.includes\("@kline_"\)/);
  assert.match(source, /hasVisibleUserChartForKlineUrl/);
});

test("first market render is immediate and subsequent renders are paced", () => {
  assert.match(source, /marketRenderCount\+\+ === 0 \? 0 : LIVE_RENDER_DELAY_MS/);
  assert.match(source, /const LIVE_RENDER_DELAY_MS = 500/);
  assert.match(source, /const PERIODIC_RENDER_DELAY_MS = 1_500/);
});

test("lite shell never clears user settings or Signal Lab storage", () => {
  assert.doesNotMatch(source, /localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase/);
});
