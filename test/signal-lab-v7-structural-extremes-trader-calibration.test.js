import test from "node:test";
import assert from "node:assert/strict";
import {
  StructuralExtremeEngine,
  StructuralExtremeRegistry,
  STRUCTURAL_DIRECTIONS,
  STRUCTURAL_EXTREME_STATUSES,
  STRUCTURAL_TIMEFRAME_STRENGTH,
  structuralAtrPercent,
} from "../signal-lab-v7-structural-extremes.js";

const STEP = 60_000;
const BASE = Date.UTC(2026, 7, 1);

function candle(index, open, high, low, close) {
  return {
    time: BASE + index * STEP,
    closeTime: BASE + (index + 1) * STEP - 1,
    open,
    high,
    low,
    close,
    volume: 1,
    closed: true,
  };
}

function engine(extra = {}) {
  return new StructuralExtremeEngine({
    symbol: "TESTUSDT",
    timeframe: "1m",
    tickSize: 0.1,
    config: {
      minimumPercent: 0.5,
      maximumPercent: 2,
      atrMultiplier: 0,
      minimumSwingPercent: 0.5,
      minimumBarsAfterCandidate: 2,
      tickSizeBufferTicks: 1,
      touchZoneTicks: 1,
      rearmDistanceFactor: 0.5,
      ...extra,
    },
  });
}

function risingToConfirmedHigh() {
  return [
    candle(0, 100, 100, 100, 100),
    candle(1, 100, 101, 100, 100.8),
    candle(2, 100.8, 103, 100.7, 102.7),
    candle(3, 102.7, 104, 102.5, 103.6),
    candle(4, 103.6, 105, 103.5, 104.7),
    candle(5, 104.7, 104.9, 104.6, 104.8),
    candle(6, 104.8, 104.8, 104.2, 104.3),
  ];
}

function fallingToConfirmedLow() {
  return [
    candle(0, 100, 100, 100, 100),
    candle(1, 100, 100, 99, 99.2),
    candle(2, 99.2, 99.3, 97, 97.3),
    candle(3, 97.3, 97.5, 96, 96.4),
    candle(4, 96.4, 96.5, 95, 95.3),
    candle(5, 95.3, 95.4, 95.1, 95.2),
    candle(6, 95.2, 95.8, 95.2, 95.7),
  ];
}

test("trader calibration confirms a moving high on close reversal", () => {
  const snapshot = engine().ingestCandles(risingToConfirmedHigh());
  assert.equal(snapshot.history.length, 1);
  assert.equal(snapshot.history[0].side, "HIGH");
  assert.equal(snapshot.history[0].price, 105);
  assert.equal(snapshot.history[0].confirmedAt, risingToConfirmedHigh()[6].closeTime);
});

test("trader calibration confirms a moving low on close reversal", () => {
  const snapshot = engine().ingestCandles(fallingToConfirmedLow());
  assert.equal(snapshot.history.length, 1);
  assert.equal(snapshot.history[0].side, "LOW");
  assert.equal(snapshot.history[0].price, 95);
});

test("wick-only reversal does not confirm by default", () => {
  const subject = engine({ minimumBarsAfterCandidate: 1 });
  risingToConfirmedHigh().slice(0, 5).forEach((row) => subject.ingestCandle(row));
  const snapshot = subject.ingestCandle(candle(5, 104.7, 104.9, 103.5, 104.8));
  assert.equal(snapshot.history.length, 0);
  assert.equal(snapshot.direction, STRUCTURAL_DIRECTIONS.TRACKING_UP);
});

test("wick confirmation remains available for shadow comparison", () => {
  const subject = engine({ minimumBarsAfterCandidate: 1, confirmationSource: "wick" });
  risingToConfirmedHigh().slice(0, 5).forEach((row) => subject.ingestCandle(row));
  const snapshot = subject.ingestCandle(candle(5, 104.7, 104.9, 103.5, 104.8));
  assert.equal(snapshot.history.length, 1);
});

test("robust ATR percent ignores one extreme outlier", () => {
  const rows = [];
  for (let index = 0; index < 14; index += 1) rows.push(candle(index, 100, 101, 99, 100));
  rows.push(candle(14, 100, 500, 1, 100));
  const percent = structuralAtrPercent(rows, 14, 0.2);
  assert.ok(percent < 10, `percent=${percent}`);
});

test("ATR contribution is capped for listing-like volatility", () => {
  const subject = new StructuralExtremeEngine({
    symbol: "ALTUSDT",
    timeframe: "1h",
    tickSize: 0.00001,
    config: {
      minimumPercent: 0.45,
      maximumPercent: 4,
      atrMultiplier: 1,
      minimumSwingPercent: 0.7,
    },
  });
  const rows = [];
  let price = 0.1;
  for (let index = 0; index < 40; index += 1) {
    const high = index === 20 ? price * 8 : price * 1.1;
    const low = index === 20 ? price * 0.2 : price * 0.9;
    rows.push({
      time: BASE + index * 3_600_000,
      closeTime: BASE + (index + 1) * 3_600_000 - 1,
      open: price,
      high,
      low,
      close: price * (index % 2 ? 1.02 : 0.98),
      volume: 1,
      closed: true,
    });
    price = rows.at(-1).close;
  }
  const snapshot = subject.ingestCandles(rows);
  assert.ok(snapshot.diagnostics.requiredReversalPct <= 4.00000001);
});

test("timeframe structural strength grows monotonically", () => {
  const ranks = ["1m", "5m", "15m", "1h", "4h", "1d"]
    .map((timeframe) => STRUCTURAL_TIMEFRAME_STRENGTH[timeframe].rank);
  assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6]);
});

test("equal touch remains active and an actual pass crosses", () => {
  const subject = engine();
  subject.ingestCandles(risingToConfirmedHigh());
  subject.ingestCandle(candle(7, 104.3, 104.5, 103, 103.5));
  let snapshot = subject.ingestCandle(candle(8, 103.5, 105, 103.4, 104.8));
  assert.equal(snapshot.history[0].status, STRUCTURAL_EXTREME_STATUSES.TOUCHED);
  snapshot = subject.ingestCandle(candle(9, 104.8, 105.2, 104.7, 105.1));
  assert.equal(snapshot.history[0].status, STRUCTURAL_EXTREME_STATUSES.CROSSED);
});

test("serialize and restore remain deterministic", () => {
  const rows = [
    ...risingToConfirmedHigh(),
    candle(7, 104.3, 104.4, 103, 103.5),
    candle(8, 103.5, 103.8, 102, 102.2),
  ];
  const continuous = engine();
  continuous.ingestCandles(rows);
  const partial = engine();
  partial.ingestCandles(rows.slice(0, 5));
  const restored = StructuralExtremeEngine.restore(partial.serialize());
  restored.ingestCandles(rows.slice(5));
  assert.deepEqual(restored.snapshot(), continuous.snapshot());
});

test("registry keeps timeframe state isolated", () => {
  const registry = new StructuralExtremeRegistry({
    config: {
      common: {
        minimumPercent: 0.5,
        maximumPercent: 2,
        atrMultiplier: 0,
        minimumSwingPercent: 0.5,
        minimumBarsAfterCandidate: 2,
        tickSizeBufferTicks: 1,
      },
    },
  });
  registry.ingest("TESTUSDT", "1m", 0.1, risingToConfirmedHigh());
  registry.ingest("TESTUSDT", "5m", 0.1, fallingToConfirmedLow().map((row, index) => ({
    ...row,
    time: BASE + index * 300_000,
    closeTime: BASE + (index + 1) * 300_000 - 1,
  })));
  const snapshot = registry.snapshot("TESTUSDT");
  assert.equal(snapshot.timeframes["1m"].history[0].side, "HIGH");
  assert.equal(snapshot.timeframes["5m"].history[0].side, "LOW");
});
