import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync(new URL("./orderbook-worker.js", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const server = readFileSync(new URL("./server.js", import.meta.url), "utf8");

test("Binance Spot uses independent market-qualified Worker feeds", () => {
  assert.match(worker, /feedKey\(market, symbol\)/);
  assert.match(worker, /new SymbolFeed\(symbol, market\)/);
  assert.match(runtime, /const key = `\$\{market\}:\$\{symbol\}`/);
  assert.match(runtime, /market: this\.market/);
  assert.match(worker, /post\(\s*"tape",\s*this\.symbol,\s*\{\s*market: this\.market,\s*replace: false,\s*live: true,/s);
  assert.match(runtime, /detail: \{ symbol: key, market, status \}/);
  assert.match(runtime, /normalizeOrderBookMarketKey\(detail\?\.symbol, detail\?\.market\)/);
});

test("Spot tape hotfix invalidates the full browser runtime chain", () => {
  const build = "26-120-burgundy-workspace-v1";
  const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const serviceWorker = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  assert.match(index, new RegExp(`app\\.js\\?v=${build}`));
  assert.match(runtime, new RegExp(`orderbook-worker\\.js\\?v=${build}`));
  assert.match(readFileSync(new URL("./app.js", import.meta.url), "utf8"), new RegExp(`orderbook\\.js\\?v=${build}`));
  assert.match(serviceWorker, new RegExp(`const BUILD = "${build}"`));
  for (const asset of ["app.js", "orderbook.js", "orderbook-worker.js"]) {
    assert.match(serviceWorker, new RegExp(`${asset.replace(".", "\\.")}\\?v=${build}`));
  }
  assert.match(serviceWorker, new RegExp(`orderbook-market-key\\.js\\?v=${build}`));
});

test("Spot depth and trades use official Spot endpoints", () => {
  assert.match(worker, /stream\.binance\.com:9443\/stream/);
  assert.match(worker, /api\/v3.*fapi\/v1/);
  assert.match(runtime, /stream\.binance\.com:9443\/ws/);
});

test("Futures card checks pair availability and opens Spot on the right", () => {
  assert.match(app, /api\.binance\.com\/api\/v3\/exchangeInfo/);
  assert.match(app, /СПОТА НЕТ/);
  assert.match(app, /x: model\.x \+ model\.w/);
  assert.match(app, /market: "spot", spotOf: model\.id/);
});

test("browser and server CSP allow only the required Binance Spot transports", () => {
  for (const source of [index, server]) {
    assert.match(source, /https:\/\/api\.binance\.com/);
    assert.match(source, /wss:\/\/stream\.binance\.com:9443/);
  }
});
