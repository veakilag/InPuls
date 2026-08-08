import test from "node:test";
import assert from "node:assert/strict";
import {
  binanceFuturesMarketForSymbol,
  binanceFuturesTickSize,
  createSymbolScopedExchangeInfoFetch,
} from "../signal-lab-v7-binance-market-metadata.js";

const payload = {
  timezone: "UTC",
  symbols: [
    {
      symbol: "BTCUSDT",
      filters: [{ filterType: "PRICE_FILTER", tickSize: "0.10000000" }],
    },
    {
      symbol: "UBUSDT",
      filters: [{ filterType: "PRICE_FILTER", tickSize: "0.00001000" }],
    },
  ],
};

test("selects the exact requested futures symbol instead of symbols[0]", () => {
  assert.equal(binanceFuturesMarketForSymbol(payload, "ubusdt")?.symbol, "UBUSDT");
  assert.equal(binanceFuturesTickSize(payload, "UBUSDT"), 0.00001);
  assert.notEqual(binanceFuturesTickSize(payload, "UBUSDT"), 0.1);
});

test("exchangeInfo fetch wrapper returns only the requested market", async () => {
  const fakeFetch = async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const wrapped = createSymbolScopedExchangeInfoFetch(fakeFetch);
  const response = await wrapped("https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=UBUSDT");
  const scoped = await response.json();
  assert.equal(scoped.symbols.length, 1);
  assert.equal(scoped.symbols[0].symbol, "UBUSDT");
  assert.equal(binanceFuturesTickSize(scoped, "UBUSDT"), 0.00001);
});

test("non-exchangeInfo requests pass through untouched", async () => {
  const original = new Response(JSON.stringify([[1, 2, 3]]), { status: 200 });
  const wrapped = createSymbolScopedExchangeInfoFetch(async () => original);
  const response = await wrapped("https://fapi.binance.com/fapi/v1/klines?symbol=UBUSDT&interval=15m");
  assert.equal(response, original);
});
