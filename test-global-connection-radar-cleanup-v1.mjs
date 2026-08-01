import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildBinanceChannelStreams,
  buildBinanceChannelTransports,
  isBinanceSubscriptionError,
  isCoreMiniTickerPacket,
  nextBinanceTransportIndex,
} from "./binance-stream-routing.js?v=26-89-core-feed-footprint-runtime-v1";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("global feed isolates the critical miniTicker stream", () => {
  const core = buildBinanceChannelStreams("core");
  const auxiliary = buildBinanceChannelStreams("auxiliary", ["BTCUSDT", "ETHUSDT"]);
  const publicStreams = buildBinanceChannelStreams("public");
  assert.deepEqual(core, ["!miniTicker@arr"]);
  assert.deepEqual(auxiliary.slice(0, 2), ["!markPrice@arr@1s", "!forceOrder@arr"]);
  assert.ok(auxiliary.includes("btcusdt@aggTrade"));
  assert.ok(auxiliary.includes("ethusdt@aggTrade"));
  assert.deepEqual(publicStreams, ["!bookTicker"]);

  const coreTransports = buildBinanceChannelTransports("core", core);
  const publicTransports = buildBinanceChannelTransports("public", publicStreams);
  assert.match(coreTransports[0].url, /fstream\.binance\.com\/market\/stream\?streams=!miniTicker@arr/);
  assert.equal(coreTransports[1].url, "wss://fstream.binance.com/market/ws/!miniTicker@arr");
  assert.equal(coreTransports[1].subscribeOnOpen, false);
  assert.equal(publicTransports[1].url, "wss://fstream.binance.com/public/ws/!bookTicker");
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

test("runtime keeps core, auxiliary and public sockets independent", async () => {
  const [app, worker] = await Promise.all([source("app.js"), source("orderbook-worker.js")]);
  assert.match(app, /#connectChannel\("core"\)/);
  assert.match(app, /#connectChannel\("auxiliary"\)/);
  assert.match(app, /#connectChannel\("public"\)/);
  assert.match(app, /fapi\/v1\/ticker\/24hr/);
  assert.match(app, /REST-резерв · WS переподключается/);
  assert.match(app, /marketRowsBySymbol/);
  assert.match(app, /updateRow\(row, item\)/);
  const workerRouting = worker.match(/function tradeStreams[\s\S]*?function trimSide/)?.[0] ?? "";
  assert.match(workerRouting, /return \[`\${name}@aggTrade`\]/);
  assert.doesNotMatch(workerRouting, /@trade`/);
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
