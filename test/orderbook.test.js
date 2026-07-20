import test from "node:test";
import assert from "node:assert/strict";
import { applyDepthUpdates, depthView, OrderBookFeed, partialDepthView } from "../orderbook.js";

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

test("order book uses combined subscription and unwraps stream payload", () => {
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
  const feed = new OrderBookFeed({ WebSocketImpl: FakeSocket, onData: (data) => { latest = data; }, onStatus: (status) => statuses.push(status) });
  feed.select("BTCUSDT");
  const socket = FakeSocket.instances[0];
  assert.equal(socket.url, "wss://fstream.binance.com/public/stream");
  socket.emit("open");
  assert.match(socket.sent[0], /btcusdt@depth20@100ms/);
  socket.emit("message", { stream: "btcusdt@depth20@100ms", data: { E: 123, u: 44, b: [["100", "2"]], a: [["101", "3"]] } });
  assert.deepEqual(latest.bids, [[100, 2]]);
  assert.equal(statuses.at(-1).text, "LIVE 100ms");
  feed.destroy();
});
