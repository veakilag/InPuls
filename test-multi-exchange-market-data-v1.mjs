import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildCandleStream,
  buildOrderBookStream,
  fetchExchangeCandles,
  nativeInterval,
} from "./exchange-market-data.js?v=26-124-multi-exchange-v1";
import { fetchExchangeTickers } from "./exchange-radar-feed.js?v=26-124-multi-exchange-v1";
import {
  EXCHANGE_IDS,
  marketSourceKey,
  toVenueSymbol,
} from "./exchange-registry.js?v=26-124-multi-exchange-v1";

const jsonResponse = (payload) => ({ ok: true, status: 200, json: async () => payload });

test("all public venues expose spot and futures through one canonical symbol contract", () => {
  assert.deepEqual(EXCHANGE_IDS, ["binance", "bybit", "okx", "bitget", "gate", "hyperliquid"]);
  assert.equal(toVenueSymbol("okx", "futures", "BTCUSDT"), "BTC-USDT-SWAP");
  assert.equal(toVenueSymbol("gate", "spot", "BTCUSDT"), "BTC_USDT");
  assert.equal(toVenueSymbol("hyperliquid", "futures", "BTCUSDT"), "BTC");
  assert.equal(marketSourceKey({ exchange: "bybit", market: "spot", symbol: "BTCUSDT" }), "bybit:spot:BTCUSDT");
});

test("radar adapters normalize venue tickers without leaking non-USDT pairs", async () => {
  const bybit = await fetchExchangeTickers({ exchange: "bybit", market: "spot" }, {
    fetchImpl: async () => jsonResponse({ retCode: 0, result: { list: [
      { symbol: "BTCUSDT", lastPrice: "65000", prevPrice24h: "64000", turnover24h: "12000000" },
      { symbol: "BTCUSDC", lastPrice: "65000", prevPrice24h: "64000", turnover24h: "100" },
    ] } }),
  });
  assert.deepEqual(bybit.map((row) => row.s), ["BTCUSDT"]);
  assert.equal(bybit[0].q, 12_000_000);

  const okx = await fetchExchangeTickers({ exchange: "okx", market: "futures" }, {
    fetchImpl: async () => jsonResponse({ code: "0", data: [{ instId: "ETH-USDT-SWAP", last: "3200", open24h: "3000", volCcy24h: "2500" }] }),
  });
  assert.equal(okx[0].s, "ETHUSDT");
  assert.equal(okx[0].q, 8_000_000);

  const gate = await fetchExchangeTickers({ exchange: "gate", market: "spot" }, {
    fetchImpl: async () => jsonResponse([{ currency_pair: "SOL_USDT", last: "150", change_percentage: "5", quote_volume: "9000000" }]),
  });
  assert.equal(gate[0].s, "SOLUSDT");
  assert.equal(Math.round(gate[0].o), 143);
});

test("candles preserve OHLC order and aggregate unsupported native intervals", async () => {
  let requestedUrl = "";
  const rows = await fetchExchangeCandles({ exchange: "bitget", market: "spot", symbol: "BTCUSDT" }, "3m", 30, {
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return jsonResponse({ code: "00000", data: [
        ["0", "10", "12", "9", "11", "2"],
        ["60000", "11", "13", "10", "12", "3"],
        ["120000", "12", "14", "8", "13", "4"],
      ] });
    },
  });
  assert.match(requestedUrl, /granularity=1min/);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { open: rows[0].open, high: rows[0].high, low: rows[0].low, close: rows[0].close, volume: rows[0].volume },
    { open: 10, high: 14, low: 8, close: 13, volume: 9 },
  );
  assert.equal(nativeInterval("bitget", "3m", "spot"), null);
});

test("every non-Binance venue builds official public candle and book transports", async () => {
  const fixtures = [
    ["bybit", "wss://stream.bybit.com/"],
    ["okx", "wss://ws.okx.com:8443/"],
    ["bitget", "wss://ws.bitget.com/"],
    ["gate", "wss://fx-ws.gateio.ws/"],
    ["hyperliquid", "wss://api.hyperliquid.xyz/"],
  ];
  const metadataFetch = async (url, options) => {
    const href = String(url);
    if (href.includes("public/instruments")) return jsonResponse({ code: "0", data: [{ ctVal: "1", tickSz: "0.1" }] });
    if (href.includes("mix/market/contracts")) return jsonResponse({ code: "00000", data: [{ pricePlace: "1", priceEndStep: "1" }] });
    if (href.includes("futures/usdt/contracts")) return jsonResponse({ quanto_multiplier: "1", order_price_round: "0.1" });
    if (href.includes("hyperliquid.xyz/info") && options?.body?.includes("spotMeta")) return jsonResponse({ tokens: [], universe: [] });
    return jsonResponse({});
  };
  for (const [exchange, prefix] of fixtures) {
    const source = { exchange, market: "futures", symbol: "BTCUSDT" };
    const candle = await buildCandleStream(source, "1m", { fetchImpl: metadataFetch });
    const book = await buildOrderBookStream(source, { fetchImpl: metadataFetch });
    assert.ok(candle.url.startsWith(prefix), `${exchange} candle transport`);
    assert.ok(book.url.startsWith(prefix), `${exchange} book transport`);
  }
});

test("browser and server CSP authorize only the implemented public market hosts", async () => {
  const [html, server, serviceWorker] = await Promise.all([
    readFile(new URL("./index.html", import.meta.url), "utf8"),
    readFile(new URL("./server.js", import.meta.url), "utf8"),
    readFile(new URL("./sw.js", import.meta.url), "utf8"),
  ]);
  for (const host of ["api.bybit.com", "www.okx.com", "api.bitget.com", "api.gateio.ws", "api.hyperliquid.xyz"]) {
    assert.match(html, new RegExp(host.replaceAll(".", "\\.")));
    assert.match(server, new RegExp(host.replaceAll(".", "\\.")));
  }
  for (const moduleName of ["exchange-registry.js", "exchange-market-data.js", "exchange-radar-feed.js", "exchange-orderbook-feed.js"]) {
    assert.match(serviceWorker, new RegExp(moduleName.replaceAll(".", "\\.")));
  }
});
