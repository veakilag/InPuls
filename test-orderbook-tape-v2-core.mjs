import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
const resetPage = readFileSync(new URL("./reset-v26.html", import.meta.url), "utf8");
const resetScript = readFileSync(new URL("./reset.js", import.meta.url), "utf8");

test("Tape v2.1 keeps RAW default and AGG explicit", () => {
  assert.match(orderbook, /mode: localStorage\.getItem\(TAPE_MODE_KEY\) === "agg" \? "agg" : "raw"/);
  assert.match(orderbook, /button\.textContent = aggregated \? "AGG" : "RAW"/);
});

test("renderer uses readable layout and removes RAW labels", () => {
  assert.match(orderbook, /from "\.\/orderbook-tape-layout\.js\?v=stable-tape-v3"/);
  assert.match(orderbook, /buildReadableTapeLayout/);
  assert.match(orderbook, /adaptiveRawDiameter/);
  assert.match(orderbook, /selectReadableAggLabels/);
  assert.match(orderbook, /drawTapeTimeline\(context, rect, window\)/);
  assert.match(orderbook, /const plotRight = safeWidth;/);
  assert.doesNotMatch(orderbook, /fillText\("NOW"/);
  assert.doesNotMatch(orderbook, /TAPE_NOW_GUTTER_PX/);
  assert.doesNotMatch(orderbook, /rawLabelThreshold/);
  assert.doesNotMatch(orderbook, /item\.quote >= rawLabelThreshold/);
  assert.match(orderbook, /const showLabel = aggLabels\.has\(item\.key\)/);
  assert.match(orderbook, /const TAPE_MAX_RAW_VISIBLE = TAPE_MAX_STORED/);
  assert.match(orderbook, /return latest \+ \(frozen \? 1 : TAPE_LIVE_EDGE_LEAD_MS\)/);
  assert.match(orderbook, /card\.dataset\.inpulsPriceWidthPx/);
  assert.match(orderbook, /left: 0 !important;/);
  assert.match(orderbook, /width: var\(--size\) !important/);
  assert.doesNotMatch(orderbook, /book-size-label-space/);
  assert.match(orderbook, />ЛЕНТА<\/button>/);
  assert.match(orderbook, />КЛАСТЕРЫ<\/button>/);
});

test("Flow Workspace cache and reset page point to the new runtime", () => {
  assert.match(orderbook, /inpuls-orderbook-runtime-26-52-signal-lab-analytics-v1/);
  assert.match(orderbook, /orderbook-flow-workspace\.js\?v=26-52-signal-lab-analytics-v1/);
  assert.match(serviceWorker, /inpuls-26-52-signal-lab-analytics-v1/);
  assert.match(serviceWorker, /orderbook\.js\?v=26-52-signal-lab-analytics-v1/);
  assert.match(serviceWorker, /render-scheduler\.js\?v=render-scheduler-v1/);
  assert.match(serviceWorker, /orderbook-worker\.js\?v=26-52-signal-lab-analytics-v1/);
  assert.match(serviceWorker, /orderbook-tape-layout\.js\?v=stable-tape-v3/);
  assert.match(serviceWorker, /orderbook-tape-latency\.js\?v=worker-bp-v1/);
  assert.match(serviceWorker, /orderbook-flow-workspace\.js\?v=26-52-signal-lab-analytics-v1/);
  assert.match(resetPage, /Resume v2/);
  assert.match(resetPage, /reset\.js\?v=26-52-signal-lab-analytics-v1/);
  assert.match(resetScript, /sw\.js\?v=\$\{BUILD\}/);
  assert.match(resetScript, /26-52-signal-lab-analytics-v1/);
});

test("production TAPE accepts only live packets and starts from an empty frame", () => {
  assert.match(orderbook, /if \(!detail\?\.replace && !detail\?\.live\) return;/);
  assert.match(orderbook, /const incoming = detail\?\.live && Array\.isArray\(detail\?\.trades\)/);
});
