import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  acceleratedHistoryDelay,
  isBinanceCoreMiniTickerUrl,
  normalizeBinanceRestMiniTickerRows,
} from "./binance-stream-routing.js";

const source = fs.readFileSync(new URL("./binance-stream-routing.js", import.meta.url), "utf8");

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

test("history warmup delay remains bounded", () => {
  assert.equal(acceleratedHistoryDelay("warmupRadarHistory", 1_500, "timeout"), 1_200);
  assert.equal(acceleratedHistoryDelay("warmupRadarHistory", 5_000, "interval"), 1_500);
  assert.equal(acceleratedHistoryDelay("render", 1_000, "interval"), 1_000);
  assert.equal(acceleratedHistoryDelay("warmupRadarHistory", 2_000, "timeout"), 2_000);
});

test("Binance routing is side-effect free and does not install global runtime shims", () => {
  assert.doesNotMatch(source, /window\.WebSocket\s*=/);
  assert.doesNotMatch(source, /globalThis\.WebSocket\s*=/);
  assert.doesNotMatch(source, /setTimeout\s*=|setInterval\s*=/);
  assert.doesNotMatch(source, /class InPulsFastStartWebSocket/);
  assert.doesNotMatch(source, /localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase/);
});
