import test from "node:test";
import assert from "node:assert/strict";

import {
  BINANCE_FUTURES_KLINES_ENDPOINT,
  fetchBinanceFuturesKlines,
} from "./binance-history.js";

const immediateScheduler = (task) => task();

function row(time, price) {
  return [time, String(price), String(price + 1), String(price - 1), String(price + 0.5), "10"];
}

test("historical loader paginates, de-duplicates and normalizes Binance rows", async () => {
  const calls = [];
  const pages = [
    [row(0, 100), row(60_000, 101), row(120_000, 102)],
    [row(120_000, 102), row(180_000, 103)],
  ];
  const fetchImpl = async (url) => {
    calls.push(url);
    const payload = pages.shift() ?? [];
    return { ok: true, status: 200, json: async () => payload, text: async () => "" };
  };

  const candles = await fetchBinanceFuturesKlines({
    symbol: "btcusdt",
    interval: "1m",
    startTime: 0,
    endTime: 240_000,
    pageLimit: 3,
    fetchImpl,
    requestScheduler: immediateScheduler,
  });

  assert.equal(calls.length, 2);
  assert.ok(calls[0].startsWith(BINANCE_FUTURES_KLINES_ENDPOINT));
  assert.match(calls[0], /symbol=BTCUSDT/);
  assert.deepEqual(candles.map((candle) => candle.time), [0, 60_000, 120_000, 180_000]);
});

test("historical loader exposes Binance HTTP errors", async () => {
  await assert.rejects(() => fetchBinanceFuturesKlines({
    symbol: "BTCUSDT",
    interval: "1m",
    startTime: 0,
    endTime: 120_000,
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => "rate limit" }),
    requestScheduler: immediateScheduler,
    maxRetries: 0,
  }), /429.*rate limit/);
});

test("historical loader validates symbol, interval and range", async () => {
  await assert.rejects(() => fetchBinanceFuturesKlines({ symbol: "BTC", interval: "1m", startTime: 0, endTime: 1 }), /USDT futures/);
  await assert.rejects(() => fetchBinanceFuturesKlines({ symbol: "BTCUSDT", interval: "7m", startTime: 0, endTime: 1 }), /unsupported interval/);
  await assert.rejects(() => fetchBinanceFuturesKlines({ symbol: "BTCUSDT", interval: "1m", startTime: 2, endTime: 1 }), /after startTime/);
});
