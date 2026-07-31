import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { aggregateTapeZeroMs } from "./orderbook.js";

const worker = readFileSync(new URL("./orderbook-worker.js", import.meta.url), "utf8");
const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

const raw = (id, time, side, quote, price = 100) => ({
  id,
  firstTradeId: id,
  lastTradeId: id,
  source: "raw",
  time,
  tradeTime: time,
  eventTime: time,
  side,
  price,
  quantity: quote / price,
  quote,
});

test("Worker keeps production Tape and AGG on documented aggTrade", () => {
  assert.match(worker, /return \[`\$\{name\}@aggTrade`\]/);
  assert.doesNotMatch(worker, /`\$\{name\}@trade`/);
  assert.match(worker, /if \(aggregateEvent && this\.insertTrade\(trade, true\)\)/);
  assert.match(worker, /if \(decision\.emit && this\.insertAggregationTrade\(trade, true\)\)/);
  assert.match(worker, /aggregationTrades,/);
  assert.match(worker, /aggregationSource: guard\.mode/);
});

test("Main renders AGG from the selected source and keeps fallback", () => {
  assert.match(orderbook, /const tapeAggregationTradesBySymbol = new Map\(\)/);
  assert.match(orderbook, /aggregationInput = aggregationStored\?\.length \? aggregationStored : stored/);
  assert.match(orderbook, /aggregationSource: message\.aggregationSource === "raw" \? "raw" : "agg"/);
  assert.match(orderbook, /@trade RAW/);
  assert.match(orderbook, /@aggTrade fallback/);
});

test("Tiger-style zero-ms aggregation joins individual same-time same-side executions", () => {
  const groups = aggregateTapeZeroMs([
    raw(10, 1_000, "buy", 100),
    raw(11, 1_000, "buy", 200),
    raw(12, 1_000, "sell", 50),
    raw(13, 1_001, "sell", 70),
  ]);
  assert.deepEqual(groups.map((item) => [item.eventTime, item.side, item.count, item.quote]), [
    [1_000, "buy", 2, 300],
    [1_000, "sell", 1, 50],
    [1_001, "sell", 1, 70],
  ]);
});

test("Tape marker threshold remains available", () => {
  assert.match(orderbook, /data-inpuls-trade-min/);
  assert.match(orderbook, /TAPE_MIN_FILTER_KEY/);
});
