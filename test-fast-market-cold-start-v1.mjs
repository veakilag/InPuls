import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  acceleratedHistoryDelay,
  isBinanceCoreMiniTickerUrl,
  normalizeBinanceRestMiniTickerRows,
} from "./binance-stream-routing.js";

const source = fs.readFileSync(new URL("./binance-stream-routing.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("full-market bootstrap only targets the Binance core miniTicker stream", () => {
  assert.equal(isBinanceCoreMiniTickerUrl("wss://fstream.binance.com/market/stream?streams=!miniTicker@arr"), true);
  assert.equal(isBinanceCoreMiniTickerUrl("wss://fstream.binance.com/market/ws/!miniTicker@arr"), true);
  assert.equal(isBinanceCoreMiniTickerUrl("wss://fstream.binance.com/public/ws/!bookTicker"), false);
  assert.equal(isBinanceCoreMiniTickerUrl("wss://example.com/market/ws/!miniTicker@arr"), false);
});

test("REST rows become one valid miniTicker market batch", () => {
  const rows = normalizeBinanceRestMiniTickerRows([
    {
      symbol: "BTCUSDT",
      lastPrice: "64000",
      openPrice: "63000",
      highPrice: "65000",
      lowPrice: "62000",
      volume: "100",
      quoteVolume: "6400000",
      count: 2_345_678,
      closeTime: 123456,
    },
    { symbol: "INVALID", lastPrice: "1" },
  ], 999);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].s, "BTCUSDT");
  assert.equal(rows[0].e, "24hrMiniTicker");
  assert.equal(rows[0].n, 2_345_678);
});

test("history warmup waits for the base list and then advances in bounded batches", () => {
  assert.equal(acceleratedHistoryDelay("warmupRadarHistory", 1_500, "timeout"), 1_200);
  assert.equal(acceleratedHistoryDelay("warmupRadarHistory", 5_000, "interval"), 1_500);
  assert.equal(acceleratedHistoryDelay("render", 1_000, "interval"), 1_000);
  assert.equal(acceleratedHistoryDelay("warmupRadarHistory", 2_000, "timeout"), 2_000);
});

test("market bootstrap uses sequential fallback instead of three duplicate downloads", () => {
  assert.match(source, /for \(const host of FAST_MARKET_BOOTSTRAP_HOSTS\)/);
  assert.match(source, /await fetchJsonWithTimeout\(`https:\/\/\$\{host\}\/fapi\/v1\/ticker\/24hr`\)/);
  assert.doesNotMatch(source, /Promise\.any\(FAST_MARKET_BOOTSTRAP_HOSTS/);
});

test("browser shim is bounded and does not touch user storage", () => {
  assert.match(app, /binance-stream-routing\.js\?v=26-123-chart-polish-v2/);
  assert.match(source, /class InPulsFastStartWebSocket extends NativeWebSocket/);
  assert.match(source, /new MessageEvent\("message"/);
  assert.match(source, /!seenSymbols\.has\(ticker\.s\) \|\| Number\.isFinite\(Number\(ticker\.n\)\)/);
  assert.match(source, /nativeSetTimeout\(restore, 30_000\)/);
  assert.doesNotMatch(source, /localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase/);
});
