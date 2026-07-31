import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildBinanceChannelStreams,
  buildBinanceChannelTransports,
  isBinanceSubscriptionError,
  isCoreMiniTickerPacket,
  nextBinanceTransportIndex,
} from "./binance-stream-routing.js?v=26-88-split-market-public-feed-v1";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("global feed separates Binance market and public namespaces", () => {
  const market = buildBinanceChannelStreams("market", ["BTCUSDT", "ETHUSDT"]);
  const publicStreams = buildBinanceChannelStreams("public", ["BTCUSDT"]);
  assert.deepEqual(market.slice(0, 3), ["!miniTicker@arr", "!markPrice@arr@1s", "!forceOrder@arr"]);
  assert.ok(market.includes("btcusdt@aggTrade"));
  assert.ok(market.includes("ethusdt@aggTrade"));
  assert.ok(!market.some((stream) => stream.includes("bookTicker")));
  assert.deepEqual(publicStreams, ["!bookTicker"]);

  const marketTransports = buildBinanceChannelTransports("market", market);
  const publicTransports = buildBinanceChannelTransports("public", publicStreams);
  assert.match(marketTransports[0].url, /fstream\.binance\.com\/market\/stream\?streams=/);
  assert.match(publicTransports[0].url, /fstream\.binance\.com\/public\/stream\?streams=/);
  assert.equal(marketTransports[1].url, "wss://fstream.binance.com/market/ws");
  assert.equal(publicTransports[1].url, "wss://fstream.binance.com/public/ws");
  assert.equal(marketTransports[1].subscribeOnOpen, true);
  assert.equal(publicTransports[1].subscribeOnOpen, true);
});

test("fallback transport advances exactly once before required data", () => {
  assert.equal(nextBinanceTransportIndex(0, 2, false), 1);
  assert.equal(nextBinanceTransportIndex(1, 2, false), 0);
  assert.equal(nextBinanceTransportIndex(1, 2, true), 1);
});

test("online requires a real miniTicker batch and subscription errors stay visible", () => {
  assert.equal(isCoreMiniTickerPacket([{ e: "markPriceUpdate", s: "BTCUSDT", p: "1" }]), false);
  assert.equal(isCoreMiniTickerPacket([{ e: "24hrMiniTicker", s: "BTCUSDT", c: "65000" }]), true);
  assert.equal(isBinanceSubscriptionError({ code: 2, msg: "Invalid request", id: 4 }), true);
});

test("runtime no longer mixes market and public streams on root endpoints", async () => {
  const [app, worker] = await Promise.all([source("app.js"), source("orderbook-worker.js")]);
  assert.match(app, /#connectChannel\("market"\)/);
  assert.match(app, /#connectChannel\("public"\)/);
  assert.doesNotMatch(app, /fstream\.binance\.com\/(?:stream|ws)(?:\?|"|`)/);
  const workerRouting = worker.match(/function tradeStreams[\s\S]*?function trimSide/)?.[0] ?? "";
  assert.match(workerRouting, /return \[`\${name}@aggTrade`\]/);
  assert.doesNotMatch(workerRouting, /@trade`/);
  assert.match(workerRouting, /market\/ws\/\${stream}/);
  assert.doesNotMatch(workerRouting, /market\/ws\/\${joined}/);
});

test("Event Radar Beta assets are removed from runtime and PWA cache", async () => {
  const [html, app, worker] = await Promise.all([
    source("index.html"), source("app.js"), source("sw.js"),
  ]);
  for (const text of [html, app, worker]) {
    assert.doesNotMatch(text, /event-radar-beta/);
    assert.doesNotMatch(text, /inpuls:event-radar-/);
  }
});
