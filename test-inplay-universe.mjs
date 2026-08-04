import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateCandles,
  calculateNatr,
  fetchCurrentInPlayUniverse,
  matchesInPlayRules,
  normalizeInPlayRules,
  selectInPlayMetrics,
} from "./inplay-universe.js";

test("normalizes current InPuls defaults", () => {
  assert.deepEqual(normalizeInPlayRules({}), {
    minV24: 100,
    minNatr1: null,
    minNatr5: null,
    minGrowth24: null,
  });
});

test("matches the InPuls V24, NATR and growth rules", () => {
  const metric = { quoteVolume24h: 150_000_000, natr1m: 0.7, natr5m: 1.1, change24h: 4 };
  assert.equal(matchesInPlayRules(metric, { minV24: 100, minNatr1: 0.5, minNatr5: 1, minGrowth24: 3 }), true);
  assert.equal(matchesInPlayRules(metric, { minV24: 200 }), false);
});

test("keeps existing order and sorts newcomers like InPuls", () => {
  const metrics = [
    { symbol: "AAAUSDT", quoteVolume24h: 200_000_000, change24h: 7 },
    { symbol: "BBBUSDT", quoteVolume24h: 300_000_000, change24h: 2 },
    { symbol: "CCCUSDT", quoteVolume24h: 250_000_000, change24h: 9 },
  ];
  const result = selectInPlayMetrics(metrics, { previousOrder: ["BBBUSDT"], limit: 3 });
  assert.deepEqual(result.matches.map((item) => item.symbol), ["BBBUSDT", "CCCUSDT", "AAAUSDT"]);
});

test("aggregates minute candles and calculates NATR", () => {
  const candles = Array.from({ length: 30 }, (_, index) => ({
    time: index * 60_000,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 1,
  }));
  const fiveMinute = aggregateCandles(candles, 5);
  assert.equal(fiveMinute.length, 6);
  assert.equal(fiveMinute[0].volume, 5);
  assert.ok(calculateNatr(candles) > 0);
});

test("fetches a current INPLAY snapshot and skips NATR calls when unused", async () => {
  const responses = new Map([
    ["exchangeInfo", { symbols: [
      { symbol: "AAAUSDT", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDT" },
      { symbol: "OLDUSDT", status: "BREAK", contractType: "PERPETUAL", quoteAsset: "USDT" },
    ] }],
    ["ticker/24hr", [
      { symbol: "AAAUSDT", quoteVolume: "200000000", priceChangePercent: "5" },
      { symbol: "OLDUSDT", quoteVolume: "999000000", priceChangePercent: "99" },
    ]],
  ]);
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => responses.get(url.includes("exchangeInfo") ? "exchangeInfo" : "ticker/24hr"),
  });
  let klineCalls = 0;
  const result = await fetchCurrentInPlayUniverse({
    fetchImpl,
    fetchKlines: async () => { klineCalls += 1; return []; },
    rules: { minV24: 100 },
    now: 123,
  });
  assert.equal(klineCalls, 0);
  assert.deepEqual(result.matches.map((item) => item.symbol), ["AAAUSDT"]);
  assert.equal(result.capturedAt, 123);
});

test("calculates NATR before applying current INPLAY volatility filters", async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => url.includes("exchangeInfo")
      ? { symbols: [{ symbol: "AAAUSDT", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDT" }] }
      : [{ symbol: "AAAUSDT", quoteVolume: "200000000", priceChangePercent: "5" }],
  });
  const candles = Array.from({ length: 120 }, (_, index) => ({
    time: index * 60_000,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1,
  }));
  const result = await fetchCurrentInPlayUniverse({
    fetchImpl,
    fetchKlines: async () => candles,
    rules: { minV24: 100, minNatr1: 1 },
    now: 120 * 60_000,
  });
  assert.equal(result.matches.length, 1);
  assert.ok(result.matches[0].natr1m >= 1);
});
