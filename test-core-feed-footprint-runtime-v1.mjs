import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeBinanceRestMiniTicker } from "./binance-stream-routing.js";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("Footprint live handler redraws from the selected batch without an undefined variable", async () => {
  const flow = await source("orderbook-flow-workspace.js");
  const accept = flow.match(/function acceptTape\(event\)[\s\S]*?function acceptBookStatus/)?.[0] ?? "";
  assert.match(accept, /batch\.trades\.length/);
  assert.doesNotMatch(accept, /incoming\.length/);
  assert.match(accept, /ingestFootprintTrades/);
  assert.match(accept, /requestDraw\(card\)/);
});

test("market table reuses symbol rows instead of recreating every row on each ticker batch", async () => {
  const app = await source("app.js");
  assert.match(app, /const marketRowsBySymbol = new Map\(\)/);
  assert.match(app, /let row = marketRowsBySymbol\.get\(item\.symbol\)/);
  assert.match(app, /updateRow\(row, item\)/);
  assert.match(app, /function updateRow\(row, item\)/);
  assert.doesNotMatch(app, /for \(const item of filtered\) fragment\.append\(createRow\(item\)\)/);
});

test("critical market discovery has a REST bootstrap while WebSocket reconnects", async () => {
  const app = await source("app.js");
  assert.match(app, /#scheduleMarketBootstrap\(3_500\)/);
  assert.match(app, /#bootstrapMarketFromRest\(\)/);
  assert.match(app, /fapi1\.binance\.com/);
  assert.match(app, /fapi2\.binance\.com/);
  assert.match(app, /normalizeBinanceRestMiniTicker\(ticker, now\)/);
  assert.match(app, /setConnection\("online", "Онлайн"\)/);
});

test("REST 24h ticker fields are converted to the miniTicker contract used by SymbolState", () => {
  const normalized = normalizeBinanceRestMiniTicker({
    symbol: "BTCUSDT",
    closeTime: 1_725_000_000_000,
    lastPrice: "64000.5",
    openPrice: "62500.0",
    highPrice: "64500.0",
    lowPrice: "62000.0",
    volume: "123.45",
    quoteVolume: "7890000.25",
  }, 99);
  assert.deepEqual(normalized, {
    e: "24hrMiniTicker",
    E: 1_725_000_000_000,
    s: "BTCUSDT",
    c: "64000.5",
    o: "62500.0",
    h: "64500.0",
    l: "62000.0",
    v: "123.45",
    q: "7890000.25",
  });

  const compactFallback = normalizeBinanceRestMiniTicker({
    E: 123,
    s: "ethusdt",
    c: "3500.25",
    o: "3400",
    h: "3550",
    l: "3350",
    v: "10",
    q: "35000",
  }, 99);
  assert.equal(compactFallback?.E, 123);
  assert.equal(compactFallback?.s, "ETHUSDT");
  assert.equal(compactFallback?.c, "3500.25");
  assert.equal(normalizeBinanceRestMiniTicker({ symbol: "BROKEN", lastPrice: "0" }, 99), null);
});
