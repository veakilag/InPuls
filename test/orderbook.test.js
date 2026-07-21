import test from "node:test";
import assert from "node:assert/strict";
import { adaptiveBookScaleIndex, aggregateDepthBands, aggregateTradeClusters, aggregateTradePath, applyDepthUpdates, bookScaleLabel, buildDepthLadder, depthView, inferPriceTick, normalizeMarketTrade, OrderBookFeed, partialDepthView, priceStepForScale } from "../orderbook.js";

test("depth updates add, replace and remove price levels", () => {
  const levels = new Map([[100, 2], [99, 4]]);
  applyDepthUpdates(levels, [["100", "3.5"], ["99", "0"], ["101", "1"]]);
  assert.deepEqual([...levels.entries()].sort((a, b) => a[0] - b[0]), [[100, 3.5], [101, 1]]);
});

test("order book view keeps best bids and asks first", () => {
  const view = depthView(new Map([[99, 1], [101, 2], [100, 3]]), new Map([[104, 1], [102, 2], [103, 3]]), 2);
  assert.deepEqual(view.bids, [[101, 2], [100, 3]]);
  assert.deepEqual(view.asks, [[102, 2], [103, 3]]);
});

test("partial depth stream becomes a ready top-20 book without REST snapshot", () => {
  const view = partialDepthView({
    b: [["101", "2"], ["100", "4"]],
    a: [["103", "3"], ["102", "1"]],
  });
  assert.deepEqual(view.bids, [[101, 2], [100, 4]]);
  assert.deepEqual(view.asks, [[102, 1], [103, 3]]);
});

test("depth range is aggregated into stable price bands", () => {
  const bands = aggregateDepthBands([[100.1, 2], [100.4, 3], [101.2, 8]], 100, 1, 2, "ask");
  assert.equal(bands.length, 2);
  assert.equal(bands[0].quantity, 5);
  assert.equal(bands[1].quantity, 0);
});

test("aggregate trade identifies the aggressive market side", () => {
  assert.equal(normalizeMarketTrade({ a: 1, p: "100", q: "3", T: 5, m: false }).side, "buy");
  assert.equal(normalizeMarketTrade({ a: 2, p: "100", q: "2", T: 6, m: true }).side, "sell");
});

test("price ladder keeps the market row visible and fills both sides", () => {
  const tick = inferPriceTick([[100, 2], [99.5, 3]], [[100.5, 4], [101, 5]], 100.25);
  assert.equal(tick, .5);
  assert.equal(priceStepForScale(tick, 3), 5);
  assert.equal(bookScaleLabel(3), "×10");
  const rows = buildDepthLadder([[100, 2]], [[101, 3]], 100.5, 100.5, .5, 7);
  assert.equal(rows.length, 7);
  assert.equal(rows.filter((row) => row.isMarket).length, 1);
  assert.ok(rows.some((row) => row.bidQuote > 0));
  assert.ok(rows.some((row) => row.askQuote > 0));
});

test("trade clusters respect the minimum quote filter", () => {
  const clusters = aggregateTradeClusters([
    { price: 100, quote: 500, side: "buy", time: 1 },
    { price: 100.1, quote: 2_000, side: "sell", time: 2 },
    { price: 100.1, quote: 3_000, side: "buy", time: 3 },
  ], 1_000, .5);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].quote, 5_000);
});

test("aggregated trade path groups executions by time and price before applying the filter", () => {
  const path = aggregateTradePath([
    { price: 100, quantity: 4, quote: 400, side: "buy", time: 1_010 },
    { price: 100.02, quantity: 7, quote: 700, side: "sell", time: 1_090 },
    { price: 101, quantity: 2, quote: 202, side: "buy", time: 2_000 },
  ], 1_000, .1, 20, 500);
  assert.equal(path.length, 1);
  assert.equal(path[0].count, 2);
  assert.equal(path[0].quote, 1_100);
  assert.equal(path[0].executions.length, 2);
});

test("impulse adaptation enlarges the effective price step without changing the user minimum", () => {
  const next = adaptiveBookScaleIndex(.01, 3, 20, 21);
  assert.ok(next > 3);
  assert.ok(priceStepForScale(.01, next) * 10 >= 20 / .7);
});

test("order book separates public depth and market trade streams", () => {
  class FakeSocket {
    static instances = [];
    constructor(url) { this.url = url; this.listeners = new Map(); this.sent = []; FakeSocket.instances.push(this); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    send(value) { this.sent.push(value); }
    emit(type, data = {}) { this.listeners.get(type)?.(type === "message" ? { data: JSON.stringify(data) } : data); }
    close() { this.emit("close"); }
  }
  let latest = null;
  const statuses = [];
  const feed = new OrderBookFeed({ WebSocketImpl: FakeSocket, fetchImpl: null, onData: (data) => { latest = data; }, onStatus: (status) => statuses.push(status) });
  feed.select("BTCUSDT");
  const depthSocket = FakeSocket.instances[0];
  const tradeSocket = FakeSocket.instances[1];
  assert.equal(depthSocket.url, "wss://fstream.binance.com/public/stream?streams=btcusdt@depth20@100ms");
  assert.equal(tradeSocket.url, "wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade");
  depthSocket.emit("open");
  tradeSocket.emit("open");
  assert.equal(depthSocket.sent.length, 0);
  assert.equal(tradeSocket.sent.length, 0);
  depthSocket.emit("message", { stream: "btcusdt@depth20@100ms", data: { E: 123, u: 44, b: [["100", "2"]], a: [["101", "3"]] } });
  assert.deepEqual(latest.bids, [[100, 2]]);
  tradeSocket.emit("message", { stream: "btcusdt@aggTrade", data: { e: "aggTrade", a: 7, p: "100.5", q: "4", T: 125, m: false } });
  assert.equal(latest.trades[0].quote, 402);
  assert.equal(statuses.at(-1).text, "LIVE 100ms");
  feed.destroy();
});
