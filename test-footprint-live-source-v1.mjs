import assert from "node:assert/strict";
import test from "node:test";
import {
  createFootprintAccumulator,
  footprintIntervalSnapshot,
  ingestFootprintTrades,
  normalizeFlowTrade,
  selectFootprintTapeTrades,
} from "./orderbook-flow-workspace.js?v=26-85-live-footprint-source-v1";

test("footprint buckets live trades by browser arrival time", () => {
  const normalized = normalizeFlowTrade({
    id: 1,
    price: 100,
    quantity: 2,
    quote: 200,
    time: 1_000,
    tradeTime: 1_000,
    eventTime: 1_010,
    receivedAt: 9_000,
    side: "buy",
  });
  assert.equal(normalized.time, 9_000);
  assert.equal(normalized.sourceTime, 1_000);
});

test("footprint uses the guarded aggregation stream without mixing RAW arrays", () => {
  const stable = [{ id: "stable" }];
  const guarded = [{ id: "guarded" }];
  assert.equal(selectFootprintTapeTrades({ live: true, trades: stable, aggregationTrades: guarded }), guarded);
  assert.deepEqual(selectFootprintTapeTrades({ live: true, trades: stable, aggregationTrades: [] }), []);
  assert.equal(selectFootprintTapeTrades({ live: true, trades: stable }), stable);
  assert.deepEqual(selectFootprintTapeTrades({ live: false, trades: stable, aggregationTrades: guarded }), []);
});

test("current footprint interval accumulates repeated live packets", () => {
  const now = 10_500;
  const accumulator = createFootprintAccumulator();
  ingestFootprintTrades(accumulator, [
    { id: 1, price: 100, quantity: 1, quote: 100, tradeTime: 1_000, receivedAt: 10_100, side: "buy" },
  ]);
  ingestFootprintTrades(accumulator, [
    { id: 2, price: 100, quantity: 2, quote: 200, tradeTime: 1_010, receivedAt: 10_200, side: "sell" },
  ]);
  const snapshot = footprintIntervalSnapshot(accumulator, "1s", now);
  assert.equal(snapshot.count, 2);
  assert.equal(snapshot.quote, 300);
  assert.equal(snapshot.cells[0].buyQuote, 100);
  assert.equal(snapshot.cells[0].sellQuote, 200);
});
