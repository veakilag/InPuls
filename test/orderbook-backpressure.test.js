import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

await import("../orderbook-worker-buffers.js?test");

const { RecentRingBuffer, LatestBatchQueue } = globalThis.InPulsOrderBookBuffers;
const worker = await readFile(new URL("../orderbook-worker.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("../orderbook.js", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

test("recent trade history prepends in O(1) while evicting the oldest trade", () => {
  const history = new RecentRingBuffer(3);
  history.prepend("one");
  history.prepend("two");
  history.prepend("three");
  assert.equal(history.prepend("four"), "one");
  assert.deepEqual(history.toArray(), ["four", "three", "two"]);
});

test("latest TAPE queue drops stale backlog and keeps chronological output", () => {
  const queue = new LatestBatchQueue(4);
  for (let value = 1; value <= 6; value += 1) queue.push(value);
  const latest = queue.takeLatest(3);
  assert.deepEqual(latest.items, [4, 5, 6]);
  assert.equal(latest.dropped, 3);
  assert.equal(queue.length, 0);
  queue.push(7);
  assert.deepEqual(queue.takeLatest(3), { items: [7], dropped: 0 });
});

test("production Worker keeps aggTrade for visual RAW and guards trade for AGG", () => {
  assert.match(worker, /fstream\.binance\.com\/public\/stream\?streams=/);
  assert.match(worker, /fstream\.binance\.com\/market\/stream\?streams=/);
  assert.match(worker, /return \[`\$\{name\}@aggTrade`, `\$\{name\}@trade`\];/);
  assert.match(worker, /aggregationTapeBatch/);
  assert.match(worker, /aggregationSource: guard\.mode/);
  assert.doesNotMatch(worker, /stream\.binancefuture\.com/);
  assert.doesNotMatch(app, /stream\.binancefuture\.com/);
  assert.match(worker, /AGG LIVE|tapeGuard\.label\(\)/);
});

test("backpressure never coalesces or drops depth sequence events", () => {
  const applyStart = worker.indexOf("  applyDepth(");
  const applyEnd = worker.indexOf("\n  bufferDepth(", applyStart);
  const applyBlock = worker.slice(applyStart, applyEnd);
  assert.match(applyBlock, /sequenceDecision\(this\.lastUpdateId, event, first\)/);
  assert.match(applyBlock, /this\.lastUpdateId = Number\(event\.u\)/);
  assert.doesNotMatch(applyBlock, /LatestBatchQueue|takeLatest|drop/);
});

test("Worker reports flow rates, processing cost, queue pressure and source freshness", () => {
  assert.match(worker, /diagnose\(this\.symbol, "worker\.flow"/);
  assert.match(worker, /depthEventsPerSecond/);
  assert.match(worker, /tradeEventsPerSecond/);
  assert.match(worker, /depthProcessMaxMs/);
  assert.match(worker, /tradeProcessMaxMs/);
  assert.match(worker, /tapeQueue/);
  assert.match(worker, /tapeDropped/);
  assert.match(worker, /depth\.freshness/);
  assert.match(worker, /tape\.freshness/);
  assert.match(runtime, /TAPE_LIVE_MAX_PENDING = 900/);
  assert.match(runtime, /tape\.main-dropped/);
});

test("Worker publishes one full-book size scale without expanding UI depth", () => {
  assert.match(worker, /function bookQuoteScale\(bids, asks, sampleLimit = 2_048\)/);
  assert.match(worker, /sizeScaleMaxQuote: fullView\.sizeScaleMaxQuote/);
  assert.match(worker, /sizeAnomalyThresholdQuote: fullView\.sizeAnomalyThresholdQuote/);
  assert.match(worker, /sizeAnomalyThresholdBidQuote: fullView\.sizeAnomalyThresholdBidQuote/);
  assert.match(worker, /sizeAnomalyThresholdAskQuote: fullView\.sizeAnomalyThresholdAskQuote/);
  assert.match(worker, /const sampleStride = Math\.max\(1, Math\.ceil\(totalLevels \/ limit\)\)/);
});

test("multi-book depth keeps distant liquidity through compact projection", () => {
  assert.match(worker, /orderbook-depth-projection\.js\?v=deep-book-v1/);
  assert.match(worker, /InPulsOrderBookDepthProjection\.compactDepthView\(fullView/);
  assert.match(worker, /exactLimit: limit/);
  assert.match(worker, /densityLimit: 96/);
  assert.match(worker, /bandCount: 128/);
  assert.match(worker, /depthProjection: view\.metadata/);
});
