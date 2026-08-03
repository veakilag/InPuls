import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
const resetPage = readFileSync(new URL("./reset-v26.html", import.meta.url), "utf8");
const resetScript = readFileSync(new URL("./reset.js", import.meta.url), "utf8");

function tapePainter() {
  const start = orderbook.indexOf("function drawTapeCard(card) {");
  const end = orderbook.indexOf("\nfunction drawAllTapes()", start);
  assert.ok(start >= 0 && end > start);
  return orderbook.slice(start, end);
}

test("Tape keeps RAW default and AGG explicit", () => {
  assert.match(orderbook, /mode: localStorage\.getItem\(TAPE_MODE_KEY\) === "agg" \? "agg" : "raw"/);
  assert.match(orderbook, /button\.textContent = aggregated/);
  assert.match(orderbook, /TAPE_AGGREGATION_PERIOD_MS = 0/);
  assert.doesNotMatch(orderbook, /TAPE_AGGREGATION_LEVELS|data-inpuls-agg-step/);
});

test("water renderer owns stable event geometry", () => {
  const painter = tapePainter();
  assert.match(orderbook, /export function advanceWaterTapeClock\(/);
  assert.match(orderbook, /export function tapeViewportFromRows\(/);
  assert.match(orderbook, /export function projectTapePrice\(/);
  assert.match(orderbook, /function refreshTapeRenderModel\(/);
  assert.match(orderbook, /Object\.freeze\(\{/);
  assert.match(painter, /projectWaterTapeNodes/);
  assert.match(painter, /const baseX = tapeTimeX\(item\.time, window, rect\.width\)/);
  assert.doesNotMatch(painter, /layoutTapeSequence|buildReadableTapeLayout|nearestVisibleRow|tapePricePosition/);
  assert.doesNotMatch(painter, /adaptiveRawDiameter\(strength, item\.density/);
  assert.match(orderbook, /function activeTapeCards\(\)/);
  assert.match(orderbook, /requestAnimationFrame\(runTapeDrawFrame\)/);
  assert.match(orderbook, /const TAPE_MAX_RAW_VISIBLE = TAPE_MAX_STORED/);
  assert.match(orderbook, /card\.dataset\.inpulsPriceWidthPx/);
  assert.match(orderbook, /left: 0 !important;/);
  assert.match(orderbook, /width: var\(--size\) !important/);
  assert.match(orderbook, />ЛЕНТА<\/button>/);
  assert.match(orderbook, />КЛАСТЕРЫ<\/button>/);
});

test("Flow Workspace cache and reset page point to water runtime", () => {
  assert.match(orderbook, /inpuls-orderbook-runtime-26-91-runtime-boot-cache-feed-v1/);
  assert.match(orderbook, /orderbook-flow-workspace\.js\?v=26-91-runtime-boot-cache-feed-v1/);
  assert.match(serviceWorker, /inpuls-26-91-runtime-boot-cache-feed-v1/);
  assert.match(serviceWorker, /orderbook\.js\?v=26-102-tape-live-edge-minute-boundary-v1/);
  assert.match(serviceWorker, /render-scheduler\.js\?v=render-scheduler-v1/);
  assert.match(serviceWorker, /orderbook-worker\.js\?v=26-101-binance-clock-sync-v1/);
  assert.match(serviceWorker, /orderbook-tape-layout\.js\?v=stable-tape-v4/);
  assert.match(serviceWorker, /orderbook-tape-latency\.js\?v=worker-bp-v1/);
  assert.match(serviceWorker, /orderbook-flow-workspace\.js\?v=26-91-runtime-boot-cache-feed-v1/);
  assert.match(resetPage, /Resume v2/);
  assert.match(resetPage, /reset\.js\?v=26-91-runtime-boot-cache-feed-v1/);
  assert.match(resetScript, /sw\.js\?v=\$\{BUILD\}/);
  assert.match(resetScript, /26-91-runtime-boot-cache-feed-v1/);
});

test("production TAPE accepts only live packets and starts from an empty frame", () => {
  assert.match(orderbook, /if \(!detail\?\.replace && !detail\?\.live\) return;/);
  assert.match(orderbook, /const incoming = detail\?\.live && Array\.isArray\(detail\?\.trades\)/);
});
