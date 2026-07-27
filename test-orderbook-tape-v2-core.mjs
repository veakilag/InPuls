import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
const resetPage = readFileSync(new URL("./reset-v26.html", import.meta.url), "utf8");

test("Tape v2.1 keeps RAW default and AGG explicit", () => {
  assert.match(orderbook, /mode: localStorage\.getItem\(TAPE_MODE_KEY\) === "agg" \? "agg" : "raw"/);
  assert.match(orderbook, /button\.textContent = aggregated \? "AGG" : "RAW"/);
});

test("renderer uses readable layout and removes RAW labels", () => {
  assert.match(orderbook, /from "\.\/orderbook-tape-layout\.js\?v=26-25-tape-v2-1"/);
  assert.match(orderbook, /buildReadableTapeLayout/);
  assert.match(orderbook, /adaptiveRawDiameter/);
  assert.match(orderbook, /selectReadableAggLabels/);
  assert.match(orderbook, /drawTapeTimeline\(context, rect, window\)/);
  assert.match(orderbook, /context\.fillText\("NOW",/);
  assert.doesNotMatch(orderbook, /rawLabelThreshold/);
  assert.doesNotMatch(orderbook, /item\.quote >= rawLabelThreshold/);
  assert.match(orderbook, /const showLabel = aggLabels\.has\(item\.key\)/);
});

test("Flow Workspace cache and reset page point to the new runtime", () => {
  assert.match(orderbook, /inpuls-orderbook-runtime-26-28-resume-v2/);
  assert.match(orderbook, /orderbook-flow-workspace\.js\?v=render-scheduler-v1/);
  assert.match(serviceWorker, /inpuls-26-33-orderbook-contracts-v1/);
  assert.match(serviceWorker, /orderbook\.js\?v=orderbook-contracts-v1/);
  assert.match(serviceWorker, /render-scheduler\.js\?v=render-scheduler-v1/);
  assert.match(serviceWorker, /orderbook-worker\.js\?v=worker-bp-v1/);
  assert.match(serviceWorker, /orderbook-tape-layout\.js\?v=26-25-tape-v2-1/);
  assert.match(serviceWorker, /orderbook-tape-latency\.js\?v=worker-bp-v1/);
  assert.match(serviceWorker, /orderbook-flow-workspace\.js\?v=render-scheduler-v1/);
  assert.match(resetPage, /Resume v2/);
  assert.match(resetPage, /sw\.js\?v=26-33-orderbook-contracts-v1/);
  assert.match(resetPage, /build=26-33-orderbook-contracts-v1/);
});
