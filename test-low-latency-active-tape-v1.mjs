import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The selected symbol gets a fast path; background feeds keep protective batching.
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("priority Worker Tape uses a 4 ms micro-batch", () => {
  const source = read("./orderbook-worker.js");
  assert.match(source, /const PRIORITY_TAPE_FLUSH_MS = 4/);
  assert.match(source, /const TAPE_FLUSH_MS = 25/);
  assert.match(source, /this\.priorityRank\(\) === 0/);
  assert.match(source, /\? PRIORITY_TAPE_FLUSH_MS\n\s+: TAPE_FLUSH_MS/);
  assert.match(source, /this\.tapeFlushDelayMs\(\)/);
});

test("legacy fallback uses the same 4 ms target", () => {
  const source = read("./orderbook.js");
  const block = source.match(/#queueTradeDispatch\(trade\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(block, /\}, 4\);/);
  assert.doesNotMatch(block, /\}, 16\);/);
});

test("new Worker build is consistent across runtime", () => {
  const orderbook = read("./orderbook.js");
  const serviceWorker = read("./sw.js");
  assert.match(orderbook, /orderbook-worker\.js\?v=26-117-chart-interaction-performance-v1/);
  assert.match(serviceWorker, /orderbook-worker\.js\?v=26-117-chart-interaction-performance-v1/);
});
