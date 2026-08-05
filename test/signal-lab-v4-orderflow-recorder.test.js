import test from "node:test";
import assert from "node:assert/strict";
import {
  SignalLabV4OrderFlowRecorder,
  normalizeAggTrade,
  normalizeDepthDiff,
  reconstructOrderBook,
} from "../signal-lab-v4-orderflow-recorder.js";

class FakeSocket {
  static instances = [];
  static OPEN = 1;
  static CONNECTING = 0;

  constructor(url) {
    this.url = url;
    this.readyState = FakeSocket.CONNECTING;
    this.listeners = new Map();
    FakeSocket.instances.push(this);
  }

  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }

  emit(name, payload = {}) {
    if (name === "open") this.readyState = FakeSocket.OPEN;
    for (const callback of this.listeners.get(name) ?? []) callback(payload);
  }

  close() {
    this.readyState = 3;
  }
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

function diff({ U, u, pu, at, bids = [], asks = [] }) {
  return JSON.stringify({
    stream: "testusdt@depth@100ms",
    data: { e: "depthUpdate", E: at, T: at, s: "TESTUSDT", U, u, pu, b: bids, a: asks },
  });
}

test("normalizers preserve exact event/receipt clocks and aggressor side", () => {
  const depth = normalizeDepthDiff({
    E: 100,
    T: 90,
    s: "TESTUSDT",
    U: 11,
    u: 12,
    pu: 10,
    b: [["100", "2"]],
    a: [["101", "3"]],
  }, 150);
  assert.equal(depth.eventTime, 100);
  assert.equal(depth.transactionTime, 90);
  assert.equal(depth.receivedAt, 150);
  assert.deepEqual(depth.bids, [[100, 2]]);

  const buy = normalizeAggTrade({ s: "TESTUSDT", p: "100", q: "2", T: 200, E: 190, m: false, a: 7 }, 230);
  const sell = normalizeAggTrade({ s: "TESTUSDT", p: "100", q: "1", T: 201, E: 191, m: true, a: 8 }, 231);
  assert.equal(buy.side, "buy");
  assert.equal(sell.side, "sell");
  assert.equal(buy.quote, 200);
});

test("recorder synchronizes REST snapshot with U/u/pu diffs and captures pre-event trades", async () => {
  FakeSocket.instances.length = 0;
  const base = Date.now();
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        lastUpdateId: 10,
        bids: [["100", "5"], ["99", "4"]],
        asks: [["101", "5"], ["102", "4"]],
      };
    },
  });
  const recorder = new SignalLabV4OrderFlowRecorder({
    WebSocketImpl: FakeSocket,
    fetchImpl,
    checkpointIntervalMs: 1_000,
    preEventMs: 120_000,
    retainMs: 180_000,
  });
  recorder.setSymbols(["TESTUSDT"]);
  const socket = FakeSocket.instances[0];
  socket.emit("open");
  socket.emit("message", { data: diff({ U: 11, u: 12, pu: 10, at: base + 1_000, bids: [["100", "0"], ["99.5", "6"]] }) });
  await wait();
  socket.emit("message", { data: diff({ U: 13, u: 13, pu: 12, at: base + 2_000, asks: [["101", "3"], ["100.5", "2"]] }) });
  recorder.ingestTrade({ s: "TESTUSDT", p: "100.4", q: "2", T: base + 1_500, E: base + 1_450, m: false, a: 1 }, base + 1_600);
  recorder.ingestTrade({ s: "TESTUSDT", p: "100.3", q: "1", T: base + 1_800, E: base + 1_750, m: true, a: 2 }, base + 1_900);
  await wait();

  const replay = recorder.capture("TESTUSDT", base - 1_000, base + 3_000);
  assert.ok(replay);
  assert.equal(replay.trades.length, 2);
  assert.equal(replay.events.length >= 1, true);
  const book = reconstructOrderBook(replay, base + 3_000);
  assert.ok(book);
  assert.equal(book.bids.some(([price]) => price === 100), false);
  assert.deepEqual(book.bids[0], [99.5, 6]);
  assert.deepEqual(book.asks[0], [100.5, 2]);
  assert.equal(book.asks.find(([price]) => price === 101)[1], 3);
  recorder.disconnect();
});

test("sequence gap is reported instead of silently corrupting the local book", async () => {
  FakeSocket.instances.length = 0;
  let snapshots = 0;
  const base = Date.now();
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      snapshots += 1;
      return { lastUpdateId: snapshots === 1 ? 10 : 20, bids: [["100", "5"]], asks: [["101", "5"]] };
    },
  });
  const recorder = new SignalLabV4OrderFlowRecorder({ WebSocketImpl: FakeSocket, fetchImpl });
  recorder.setSymbols(["TESTUSDT"]);
  const socket = FakeSocket.instances[0];
  socket.emit("open");
  socket.emit("message", { data: diff({ U: 11, u: 11, pu: 10, at: base + 1_000, bids: [["100", "4"]] }) });
  await wait();
  socket.emit("message", { data: diff({ U: 15, u: 15, pu: 14, at: base + 2_000, bids: [["100", "1"]] }) });
  await wait();
  assert.equal(recorder.status().gaps, 1);
  assert.equal(snapshots >= 2, true, "gap must force a clean REST resync");
  recorder.disconnect();
});

test("replay seeks from the nearest checkpoint and applies only subsequent diffs", () => {
  const replay = {
    requestedTo: 20_000,
    initialCheckpoint: { at: 0, lastUpdateId: 1, bids: [[100, 5]], asks: [[101, 5]], state: "LIVE" },
    checkpoints: [{ at: 10_000, lastUpdateId: 2, bids: [[100, 4]], asks: [[101, 4]], state: "LIVE" }],
    events: [
      { at: 5_000, u: 2, bids: [[100, 4]], asks: [] },
      { at: 15_000, u: 3, bids: [[99, 6]], asks: [[101, 0], [102, 7]], state: "RECOVERED" },
    ],
  };
  const before = reconstructOrderBook(replay, 9_000);
  assert.deepEqual(before.bids[0], [100, 4]);
  const after = reconstructOrderBook(replay, 16_000);
  assert.deepEqual(after.bids, [[100, 4], [99, 6]]);
  assert.deepEqual(after.asks, [[102, 7]]);
  assert.equal(after.state, "RECOVERED");
});
