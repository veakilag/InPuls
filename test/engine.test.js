import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  SymbolState,
  classifySignals,
  filterUsdtPerpetualTicker,
  percentChange,
} from "../engine.js";

test("percentChange returns a percentage", () => {
  assert.equal(percentChange(101, 100), 1);
  assert.equal(percentChange(99, 100), -1);
  assert.equal(percentChange(1, 0), null);
});

test("ticker filter keeps UM USDT pairs", () => {
  assert.equal(filterUsdtPerpetualTicker({ s: "BTCUSDT", st: 1 }), true);
  assert.equal(filterUsdtPerpetualTicker({ s: "BTCUSD", st: 2 }), false);
  assert.equal(filterUsdtPerpetualTicker({ s: "BTCUSDT_260925", st: 1 }), false);
});

test("SymbolState calculates 15 second move", () => {
  const start = 1_700_000_000_000;
  const symbol = new SymbolState("TESTUSDT", start);
  symbol.updateTicker({ c: "100", q: "1000000", E: start }, start);
  symbol.updateTicker({ c: "101", q: "1010000", E: start + 16_000 }, start + 16_000);
  const metrics = symbol.metrics(DEFAULT_SETTINGS, start + 16_000);
  assert.equal(metrics.change15s, 1);
  assert.equal(metrics.volumeBoost, null, "volume acceleration stays muted during warm-up");
});

test("book ticker updates the live midpoint without waiting for mini ticker", () => {
  const start = 1_700_000_000_000;
  const symbol = new SymbolState("TESTUSDT", start);
  symbol.updateTicker({ c: "100", q: "1000000", E: start }, start);
  symbol.updateBookTicker({ b: "100.4", a: "100.6", E: start + 250 }, start + 250);
  assert.equal(symbol.price, 100.5);
  assert.equal(symbol.lastUpdate, start + 250);
});

test("trade flow counts fills and aggressive side", () => {
  const start = 1_700_000_000_000;
  const symbol = new SymbolState("TESTUSDT", start);
  symbol.updateTrade({ p: "100", q: "20", f: 10, l: 14, m: false, T: start + 1000 });
  symbol.updateTrade({ p: "100", q: "10", f: 15, l: 16, m: true, T: start + 2000 });
  const flow = symbol.tradeFlow(start + 5000);
  assert.equal(flow.tps, 0.7);
  assert.equal(Math.round(flow.buyShare), 67);
});

test("funding is exposed for radar sorting", () => {
  const start = 1_700_000_000_000;
  const symbol = new SymbolState("TESTUSDT", start);
  symbol.updateTicker({ c: "100", q: "10000000", E: start }, start);
  symbol.updateFunding({ r: "0.00025", T: start + 3_600_000 });
  const metrics = symbol.metrics(DEFAULT_SETTINGS, start + 1000);
  assert.equal(metrics.fundingRate, 0.00025);
  assert.equal(metrics.nextFundingTime, start + 3_600_000);
});

test("historical minutes warm up NATR without waiting", () => {
  const start = 1_700_000_000_000;
  const symbol = new SymbolState("TESTUSDT", start);
  const candles = Array.from({ length: 90 }, (_, index) => ({
    time: start + index * 60_000,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
  }));
  symbol.hydrateMinuteCandles(candles);
  symbol.updateTicker({ c: "190", q: "10000000", E: start + 90 * 60_000 }, start + 90 * 60_000);
  const metrics = symbol.metrics(DEFAULT_SETTINGS, start + 90 * 60_000);
  assert.ok(metrics.natr1m > 0);
  assert.ok(metrics.natr5m > 0);
  assert.ok(metrics.minuteReturns.length >= 89);
});

test("liquidation snapshots are deduplicated", () => {
  const start = 1_700_000_000_000;
  const symbol = new SymbolState("TESTUSDT", start);
  const event = { E: start, o: { T: start, S: "SELL", ap: "100", z: "1000" } };
  symbol.updateLiquidation(event);
  symbol.updateLiquidation(event);
  assert.deepEqual(symbol.liquidationFlow(start + 1000), { longs: 100_000, shorts: 0, total: 100_000 });
});

test("cascade needs aligned liquidation and movement", () => {
  const metrics = {
    price: 99,
    change15s: -0.8,
    volumeBoost: 3,
    range5m: { min: 98, max: 101, percent: 3 },
    range60s: { min: 98, max: 101, percent: 3 },
    liquidation: { longs: 120_000, shorts: 5_000, total: 125_000 },
  };
  const signals = classifySignals(metrics, DEFAULT_SETTINGS);
  assert.equal(signals[0].type, "cascade");
  assert.equal(signals[0].direction, "down");
});

test("compression is classified after a quiet range with rising volume", () => {
  const metrics = {
    price: 100,
    change15s: 0.08,
    volumeBoost: 2,
    range5m: { min: 99.9, max: 100.1, percent: 0.2 },
    range60s: { min: 99.9, max: 100.1, percent: 0.2 },
    liquidation: { longs: 0, shorts: 0, total: 0 },
  };
  const signals = classifySignals(metrics, DEFAULT_SETTINGS);
  assert.equal(signals[0].type, "compression");
});
