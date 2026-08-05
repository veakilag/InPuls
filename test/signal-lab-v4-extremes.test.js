import test from "node:test";
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
  subject.ingestCandle(candle(1, 100.2, 100.4, 100.1, 100.35));
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
