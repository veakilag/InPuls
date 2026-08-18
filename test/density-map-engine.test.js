import assert from "node:assert/strict";
import test from "node:test";

import {
  DensityLifetimeTracker,
  findSnapshotDensities,
  interleaveDensityUniverse,
  normalizeDensityFilters,
} from "../density-map-engine.js";

test("density filters accept an immediate lifetime and clamp unsafe size values", () => {
  assert.deepEqual(normalizeDensityFilters({ minQuote: 500, minLifetimeMs: 0 }), {
    minQuote: 1_000,
    minLifetimeMs: 0,
  });
});

test("snapshot detector finds bid and ask levels by quote size", () => {
  const rows = findSnapshotDensities({
    bids: [[100, 2_000], [99, 500]],
    asks: [[101, 2_500], [102, 100]],
  }, 150_000);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.side), ["bid", "ask"]);
  assert.equal(rows[0].quote, 200_000);
  assert.equal(rows[1].quote, 252_500);
  assert.ok(rows[0].distancePercent < 0);
  assert.ok(rows[1].distancePercent > 0);
});

test("lifetime tracker confirms persistence and removes a vanished level after grace", () => {
  const source = { exchange: "binance", market: "futures", symbol: "BTCUSDT" };
  const tracker = new DensityLifetimeTracker({ minQuote: 100_000, absenceGraceMs: 1_000 });
  const snapshot = { bids: [[100, 2_000]], asks: [[101, 10]] };

  tracker.updateMarket(source, snapshot, 1_000);
  tracker.updateMarket(source, snapshot, 6_000);
  assert.equal(tracker.active({ minLifetimeMs: 5_000, at: 6_000 }).length, 1);
  assert.equal(tracker.active({ minLifetimeMs: 5_001, at: 6_000 }).length, 0);

  tracker.updateMarket(source, { bids: [[100, 10]], asks: [[101, 10]] }, 7_000);
  assert.equal(tracker.size, 1);
  tracker.updateMarket(source, { bids: [[100, 10]], asks: [[101, 10]] }, 8_001);
  assert.equal(tracker.size, 0);
});

test("universe is interleaved across venues and deduplicated within a market", () => {
  const universe = interleaveDensityUniverse([
    {
      exchange: "binance",
      market: "futures",
      rows: [
        { s: "BTCUSDT", q: 10 },
        { s: "ETHUSDT", q: 8 },
        { s: "BTCUSDT", q: 9 },
        { s: "ETHBTC", q: 100 },
      ],
    },
    {
      exchange: "bybit",
      market: "spot",
      rows: [{ s: "SOLUSDT", q: 7 }, { s: "XRPUSDT", q: 6 }],
    },
  ]);

  assert.deepEqual(universe.map((item) => `${item.exchange}:${item.symbol}`), [
    "binance:BTCUSDT",
    "bybit:SOLUSDT",
    "binance:ETHUSDT",
    "bybit:XRPUSDT",
  ]);
});
