from pathlib import Path


def replace_once(path, old, new, label):
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, got {count}")
    file.write_text(source.replace(old, new, 1))


replace_once(
    "signal-lab-v4-extremes.js",
    "      rearmed: true,\n",
    "      rearmed: false,\n      outsideBars: 0,\n",
    "new extreme starts disarmed",
)

replace_once(
    "signal-lab-v4-extremes.js",
    '''      const movedAway = row.side === "HIGH"
        ? row.priceTicks - lowTicks >= rearmTicks
        : highTicks - row.priceTicks >= rearmTicks;
      if (movedAway || barIndex - row.lastTouchBarIndex >= this.config.rearmBars) row.rearmed = true;
      if (touched && row.rearmed && barIndex > row.lastTouchBarIndex) {
        row.touchCount += 1;
        row.lastTestedAt = at;
        row.lastTouchBarIndex = barIndex;
        row.rearmed = false;
        row.state = EXTREME_STATES.RETESTED;
        this.eventLog.push({ type: "EXTREME_RETESTED", at, extremeId: row.id, touchCount: row.touchCount });
      }
''',
    '''      const movedAway = row.side === "HIGH"
        ? row.priceTicks - lowTicks >= rearmTicks
        : highTicks - row.priceTicks >= rearmTicks;
      if (touched) {
        if (row.rearmed && barIndex > row.lastTouchBarIndex) {
          row.touchCount += 1;
          row.lastTestedAt = at;
          row.lastTouchBarIndex = barIndex;
          row.state = EXTREME_STATES.RETESTED;
          this.eventLog.push({ type: "EXTREME_RETESTED", at, extremeId: row.id, touchCount: row.touchCount });
        }
        row.rearmed = false;
        row.outsideBars = 0;
        continue;
      }
      row.outsideBars = Math.max(0, Number(row.outsideBars) || 0) + 1;
      if (
        movedAway
        || row.outsideBars >= Math.max(1, Math.round(Number(this.config.rearmBars) || 1))
      ) row.rearmed = true;
''',
    "separate attack rearm lifecycle",
)

Path("test/signal-lab-v4-extremes.test.js").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTREME_STATES,
  SignalLabV4ExtremeRegistry,
  TimeframeExtremeEngine,
  priceToTicks,
} from "../signal-lab-v4-extremes.js";

const minute = 60_000;

function candle(index, open, high, low, close) {
  return {
    time: index * minute,
    closeTime: (index + 1) * minute - 1,
    open,
    high,
    low,
    close,
    closed: true,
  };
}

function engine(options = {}) {
  return new TimeframeExtremeEngine({
    symbol: "TESTUSDT",
    timeframe: "1m",
    tickSize: 0.01,
    config: {
      minReversalPct: 0.2,
      atrMultiplier: 0,
      minTicks: 2,
      ...options,
    },
  });
}

test("high is confirmed only after a later observable reversal", () => {
  const subject = engine();
  subject.ingestCandle(candle(0, 99.96, 100, 99.95, 99.98));
  assert.equal(subject.snapshot().active.length, 0);
  subject.ingestCandle(candle(1, 99.98, 99.99, 99.70, 99.75));
  const high = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.ok(high);
  assert.equal(high.price, 100);
  assert.equal(high.extremeTime, 0);
  assert.equal(high.confirmedAt, 2 * minute - 1);
  assert.equal(high.confirmationDelayBars, 1);
});

test("low is confirmed symmetrically", () => {
  const subject = engine();
  subject.ingestCandle(candle(0, 100.04, 100.05, 100, 100.02));
  subject.ingestCandle(candle(1, 100.02, 100.30, 100.01, 100.25));
  const low = subject.snapshot().active.find((row) => row.side === "LOW");
  assert.ok(low);
  assert.equal(low.price, 100);
  assert.equal(low.extremeTime, 0);
  assert.equal(low.confirmedAt, 2 * minute - 1);
});

test("candidate moves to a new high before confirmation but confirmed extreme never repaints", () => {
  const subject = engine({ minReversalPct: 0.6 });
  subject.ingestCandle(candle(0, 99.98, 100, 99.95, 99.99));
  subject.ingestCandle(candle(1, 100, 100.4, 100.1, 100.35));
  assert.equal(subject.snapshot().candidates.high.price, 100.4);
  subject.ingestCandle(candle(2, 100.35, 100.35, 99.75, 99.8));
  const confirmed = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.ok(confirmed);
  assert.equal(confirmed.price, 100.4);
  assert.equal(confirmed.extremeTime, minute);
  const originalId = confirmed.id;
  subject.ingestCandle(candle(3, 99.8, 100.1, 99.7, 99.9));
  const historical = subject.snapshot().history.find((row) => row.id === originalId);
  assert.equal(historical.price, 100.4);
  assert.equal(historical.extremeTime, minute);
});

test("equal touch does not break a high and adjacent candles from one attack count once", () => {
  const subject = engine({ rearmBars: 2 });
  subject.ingestCandles([
    candle(0, 99.96, 100, 99.95, 99.98),
    candle(1, 99.98, 99.99, 99.70, 99.75),
  ]);
  let high = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.ok(high);
  assert.equal(high.touchCount, 1);
  subject.ingestCandle(candle(2, 99.75, 99.80, 99.50, 99.70));
  subject.ingestCandle(candle(3, 99.70, 100, 99.65, 99.90));
  high = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.ok(high, "equality is a retest, not a break");
  assert.equal(high.state, EXTREME_STATES.RETESTED);
  assert.equal(high.touchCount, 2);
  subject.ingestCandle(candle(4, 99.90, 100, 99.90, 99.95));
  high = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.equal(high.touchCount, 2, "an adjacent candle from the same attack must not double count");
});

test("one valid tick above a high removes it from the active map but preserves history", () => {
  const subject = engine();
  subject.ingestCandles([
    candle(0, 99.96, 100, 99.95, 99.98),
    candle(1, 99.98, 99.99, 99.70, 99.75),
  ]);
  const active = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.ok(active);
  const id = active.id;
  subject.ingestCandle(candle(2, 99.75, 100.01, 99.65, 100));
  assert.equal(subject.snapshot().active.some((row) => row.id === id), false);
  const history = subject.snapshot().history.find((row) => row.id === id);
  assert.equal(history.state, EXTREME_STATES.BREAK_ATTEMPT);
  assert.equal(history.crossedAt, 3 * minute - 1);
});

test("tick integer representation prevents float noise from creating a false break", () => {
  assert.equal(priceToTicks(0.1 + 0.2, 0.01), 30n);
  const subject = new TimeframeExtremeEngine({
    symbol: "FLOATUSDT",
    timeframe: "1m",
    tickSize: 0.01,
    config: { minReversalPct: 0.2, atrMultiplier: 0, minTicks: 2 },
  });
  subject.ingestCandles([
    candle(0, 0.29, 0.30, 0.29, 0.30),
    candle(1, 0.30, 0.30, 0.27, 0.28),
  ]);
  const high = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.ok(high);
  subject.ingestTrade(0.1 + 0.2, 3 * minute);
  assert.ok(subject.snapshot().active.some((row) => row.id === high.id));
  subject.ingestTrade(0.31, 3 * minute + 1);
  assert.equal(subject.snapshot().active.some((row) => row.id === high.id), false);
});

test("timeframes keep independent extrema maps", () => {
  const registry = new SignalLabV4ExtremeRegistry();
  registry.setTickSize("TESTUSDT", 0.01);
  registry.hydrate("TESTUSDT", "1m", [
    candle(0, 99.96, 100, 99.95, 99.98),
    candle(1, 99.98, 99.99, 99.70, 99.75),
  ]);
  registry.hydrate("TESTUSDT", "5m", [
    { time: 0, closeTime: 5 * minute - 1, open: 199.96, high: 200, low: 199.95, close: 199.98, closed: true },
    { time: 5 * minute, closeTime: 10 * minute - 1, open: 199.98, high: 199.99, low: 199.4, close: 199.5, closed: true },
  ], { tickSize: 0.01 });
  const snapshot = registry.snapshot("TESTUSDT");
  assert.equal(snapshot.timeframes["1m"].active.find((row) => row.side === "HIGH").price, 100);
  assert.equal(snapshot.timeframes["5m"].active.find((row) => row.side === "HIGH").price, 200);
});

test("historical replay produces the same event moment as sequential live ingestion", () => {
  const rows = [
    candle(0, 99.96, 100, 99.95, 99.98),
    candle(1, 99.98, 100.3, 100.1, 100.2),
    candle(2, 100.2, 100.25, 99.8, 99.9),
  ];
  const replay = engine({ minReversalPct: 0.4 });
  replay.ingestCandles(rows);
  const live = engine({ minReversalPct: 0.4 });
  rows.forEach((row) => live.ingestCandle(row));
  assert.deepEqual(replay.snapshot().history, live.snapshot().history);
  assert.deepEqual(replay.snapshot().events, live.snapshot().events);
});
''')

Path("test/signal-lab-v4-orderflow-recorder.test.js").write_text(r'''import test from "node:test";
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
''')

replace_once(
    "test/signal-lab-v3-collector.test.js",
    'ownerHtml.includes("signal-lab-v3-full-chart-review-v1")',
    'ownerHtml.includes("signal-lab-v4-stage1")',
    "collector cache contract",
)
replace_once(
    "test/signal-lab-v3-evidence.test.js",
    '  assert.match(html, /sampled depth20/i);\n',
    '  assert.match(html, /snapshot \\+ diff/i);\n',
    "orderflow contract",
)
replace_once(
    "test/signal-lab-v3-evidence.test.js",
    '  assert.match(source, /MAX_EVIDENCE_PACKS = 500/);\n',
    '  assert.match(source, /MAX_EVIDENCE_PACKS = 120/);\n',
    "bounded V4 evidence packs",
)
replace_once(
    "test/signal-lab-v3-full-chart.test.js",
    '  assert.match(html, /OWNER SIGNAL LAB V3\\.3/);\n',
    '  assert.match(html, /OWNER SIGNAL LAB V4/);\n',
    "owner V4 contract",
)

print("Signal Lab V4 regression fixes applied")
