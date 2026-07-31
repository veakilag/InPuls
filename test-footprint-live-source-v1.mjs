import assert from "node:assert/strict";
import test from "node:test";
import {
  createFootprintAccumulator,
  footprintIntervalSnapshot,
  ingestFootprintTrades,
  normalizeFlowTrade,
  selectFootprintTapeBatch,
  selectFootprintTapeTrades,
} from "./orderbook-flow-workspace.js?v=26-87-market-feed-footprint-series-v1";

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

test("footprint bootstraps from stable Tape and locks to guarded flow after promotion", () => {
  const stable = [{ id: "stable" }];
  const guarded = [{ id: "guarded" }];

  assert.deepEqual(
    selectFootprintTapeBatch({ live: true, trades: stable, aggregationTrades: [] }, null),
    { trades: stable, source: "stable", replace: false },
  );
  assert.deepEqual(
    selectFootprintTapeBatch({ live: true, trades: stable, aggregationTrades: guarded }, "stable"),
    { trades: guarded, source: "guarded", replace: true },
  );
  assert.deepEqual(
    selectFootprintTapeBatch({ live: true, trades: stable, aggregationTrades: [] }, "guarded"),
    { trades: [], source: "guarded", replace: false },
  );
  assert.deepEqual(
    selectFootprintTapeBatch({ live: false, trades: stable, aggregationTrades: guarded }, "guarded"),
    { trades: [], source: "guarded", replace: false },
  );

  assert.equal(
    selectFootprintTapeTrades({ live: true, trades: stable, aggregationTrades: guarded }),
    guarded,
  );
});

test("promotion replaces stable bootstrap volume instead of duplicating it", () => {
  const intervalStart = Math.floor(Date.now() / 1_000) * 1_000;
  const accumulator = createFootprintAccumulator();
  ingestFootprintTrades(accumulator, [{
    id: 1,
    price: 100,
    quantity: 1,
    quote: 100,
    tradeTime: intervalStart - 9_000,
    receivedAt: intervalStart + 100,
    side: "buy",
  }]);

  const promoted = selectFootprintTapeBatch({
    live: true,
    trades: [],
    aggregationTrades: [{
      id: 2,
      price: 100,
      quantity: 2,
      quote: 200,
      tradeTime: intervalStart - 8_990,
      receivedAt: intervalStart + 200,
      side: "buy",
    }],
  }, "stable");
  ingestFootprintTrades(accumulator, promoted.trades, { replace: promoted.replace });

  const snapshot = footprintIntervalSnapshot(accumulator, "1s", intervalStart + 500);
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.quote, 200);
});

test("empty guarded packets never fall back or duplicate accumulated volume", () => {
  const intervalStart = Math.floor(Date.now() / 1_000) * 1_000;
  const accumulator = createFootprintAccumulator();
  ingestFootprintTrades(accumulator, [{
    id: 1,
    price: 100,
    quantity: 1,
    quote: 100,
    tradeTime: intervalStart - 9_000,
    receivedAt: intervalStart + 100,
    side: "buy",
  }]);

  const batch = selectFootprintTapeBatch({
    live: true,
    trades: [{
      id: 2,
      price: 100,
      quantity: 5,
      quote: 500,
      tradeTime: intervalStart - 8_990,
      receivedAt: intervalStart + 200,
      side: "buy",
    }],
    aggregationTrades: [],
  }, "guarded");
  ingestFootprintTrades(accumulator, batch.trades, { replace: batch.replace });

  const snapshot = footprintIntervalSnapshot(accumulator, "1s", intervalStart + 500);
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.quote, 100);
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
