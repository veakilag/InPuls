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
  subject.ingestCandle(candle(0, 99.8, 100, 99.7, 99.9));
  assert.equal(subject.snapshot().active.length, 0);
  subject.ingestCandle(candle(1, 99.9, 100, 99.85, 99.9));
  assert.equal(subject.snapshot().active.length, 0, "same/equal high must not confirm without enough reversal");
  subject.ingestCandle(candle(2, 99.9, 99.92, 99.70, 99.75));
  const high = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.ok(high);
  assert.equal(high.price, 100);
  assert.equal(high.extremeTime, 0);
  assert.equal(high.confirmedAt, 3 * minute - 1);
  assert.equal(high.confirmationDelayBars, 2);
});

test("low is confirmed symmetrically", () => {
  const subject = engine();
  subject.ingestCandle(candle(0, 100.2, 100.3, 100, 100.1));
  subject.ingestCandle(candle(1, 100.1, 100.35, 100.02, 100.3));
  const low = subject.snapshot().active.find((row) => row.side === "LOW");
  assert.ok(low);
  assert.equal(low.price, 100);
  assert.equal(low.extremeTime, 0);
});

test("candidate moves to a new high before confirmation but confirmed extreme never repaints", () => {
  const subject = engine();
  subject.ingestCandle(candle(0, 99.8, 100, 99.8, 99.9));
  subject.ingestCandle(candle(1, 99.9, 100.4, 99.9, 100.3));
  assert.equal(subject.snapshot().candidates.high.price, 100.4);
  subject.ingestCandle(candle(2, 100.3, 100.35, 100.0, 100.05));
  const confirmed = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.equal(confirmed.price, 100.4);
  const originalId = confirmed.id;
  subject.ingestCandle(candle(3, 100.05, 100.1, 99.8, 99.9));
  const historical = subject.snapshot().history.find((row) => row.id === originalId);
  assert.equal(historical.price, 100.4);
  assert.equal(historical.extremeTime, minute);
});

test("equal touch does not break a high and a new attack increments touchCount once", () => {
  const subject = engine({ rearmBars: 1 });
  subject.ingestCandles([
    candle(0, 99.8, 100, 99.7, 99.9),
    candle(1, 99.9, 99.95, 99.6, 99.7),
  ]);
  let high = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.ok(high);
  subject.ingestCandle(candle(2, 99.7, 99.8, 99.5, 99.7));
  subject.ingestCandle(candle(3, 99.7, 100, 99.65, 99.9));
  high = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.ok(high, "equality is a retest, not a break");
  assert.equal(high.state, EXTREME_STATES.RETESTED);
  assert.equal(high.touchCount, 2);
  subject.ingestCandle(candle(4, 99.9, 100, 99.9, 99.95));
  high = subject.snapshot().active.find((row) => row.side === "HIGH");
  assert.equal(high.touchCount, 2, "adjacent candles from the same attack must not double count");
});

test("one valid tick above a high removes it from the active map but preserves history", () => {
  const subject = engine();
  subject.ingestCandles([
    candle(0, 99.8, 100, 99.7, 99.9),
    candle(1, 99.9, 99.95, 99.6, 99.7),
  ]);
  const id = subject.snapshot().active.find((row) => row.side === "HIGH").id;
  subject.ingestCandle(candle(2, 99.7, 100.01, 99.65, 100));
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
    candle(0, 0.29, 0.30, 0.28, 0.29),
    candle(1, 0.29, 0.29, 0.27, 0.28),
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
    candle(0, 99.8, 100, 99.7, 99.9),
    candle(1, 99.9, 99.95, 99.6, 99.7),
  ]);
  registry.hydrate("TESTUSDT", "5m", [
    { ...candle(0, 199, 200, 198, 199), time: 0, closeTime: 5 * minute - 1 },
    { ...candle(1, 199, 199.5, 197, 198), time: 5 * minute, closeTime: 10 * minute - 1 },
  ], { tickSize: 0.01 });
  const snapshot = registry.snapshot("TESTUSDT");
  assert.equal(snapshot.timeframes["1m"].active[0].price, 100);
  assert.equal(snapshot.timeframes["5m"].active[0].price, 200);
});

test("historical replay produces the same event moment as sequential live ingestion", () => {
  const rows = [
    candle(0, 99.8, 100, 99.7, 99.9),
    candle(1, 99.9, 100.3, 99.9, 100.2),
    candle(2, 100.2, 100.25, 99.8, 99.9),
  ];
  const replay = engine();
  replay.ingestCandles(rows);
  const live = engine();
  rows.forEach((row) => live.ingestCandle(row));
  assert.deepEqual(replay.snapshot().history, live.snapshot().history);
  assert.deepEqual(replay.snapshot().events, live.snapshot().events);
});
