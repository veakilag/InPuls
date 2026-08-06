import test from "node:test";
import assert from "node:assert/strict";
import {
  STRUCTURAL_DIRECTIONS,
  STRUCTURAL_EXTREME_STATUSES,
  StructuralExtremeEngine,
  StructuralExtremeRegistry,
  replayStructuralExtremes,
} from "../signal-lab-v7-structural-extremes.js";

const STEP = 60_000;
const BASE = Date.UTC(2026, 7, 1, 0, 0, 0);

function candle(index, open, high, low, close) {
  return {
    time: BASE + index * STEP,
    closeTime: BASE + (index + 1) * STEP - 1,
    open,
    high,
    low,
    close,
    volume: 1_000,
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
      atrMultiplier: 0,
      minimumSwingPercent: 0.5,
      minimumBarsAfterCandidate: 2,
      tickSizeBufferTicks: 1,
      touchZoneTicks: 1,
      rearmDistanceFactor: 0.5,
      acceptanceBars: 2,
      rejectionBars: 3,
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

test("several higher highs create one moving candidate and one confirmed high", () => {
  const subject = engine();
  const rows = risingToConfirmedHigh();
  const steps = rows.map((row) => subject.ingestCandle(row));
  const final = steps.at(-1);
  assert.equal(final.history.length, 1);
  assert.equal(final.history[0].side, "HIGH");
  assert.equal(final.history[0].price, 105);
  assert.equal(final.history[0].extremeAt, rows[4].time);
  assert.equal(final.history[0].confirmedAt, rows[6].closeTime);
  assert.equal(final.events.filter((row) => row.type === "EXTREME_CONFIRMED").length, 1);
  assert.ok(final.events.filter((row) => row.type === "CANDIDATE_MOVED").length >= 2);
});

test("several lower lows create one moving candidate and one confirmed low", () => {
  const subject = engine();
  const rows = fallingToConfirmedLow();
  const final = subject.ingestCandles(rows);
  assert.equal(final.history.length, 1);
  assert.equal(final.history[0].side, "LOW");
  assert.equal(final.history[0].price, 95);
  assert.equal(final.history[0].extremeAt, rows[4].time);
  assert.equal(final.history[0].confirmedAt, rows[6].closeTime);
});

test("small pullback does not confirm an extreme", () => {
  const subject = engine({ minimumPercent: 1.0 });
  subject.ingestCandles(risingToConfirmedHigh().slice(0, 5));
  const snapshot = subject.ingestCandle(candle(5, 104.7, 104.9, 104.4, 104.6));
  assert.equal(snapshot.history.length, 0);
  assert.equal(snapshot.direction, STRUCTURAL_DIRECTIONS.TRACKING_UP);
  assert.match(snapshot.diagnostics.reason, /WAITING|BELOW_THRESHOLD/);
});

test("significant reversal confirms the extreme only after the minimum bars", () => {
  const subject = engine();
  risingToConfirmedHigh().slice(0, 5).forEach((row) => subject.ingestCandle(row));
  let snapshot = subject.ingestCandle(candle(5, 104.7, 104.8, 103.8, 104.0));
  assert.equal(snapshot.history.length, 0);
  assert.equal(snapshot.diagnostics.reason, "WAITING_MINIMUM_BARS_AFTER_HIGH");
  snapshot = subject.ingestCandle(candle(6, 104.0, 104.2, 103.7, 103.8));
  assert.equal(snapshot.history.length, 1);
});

test("micro movement with insufficient swing amplitude is rejected", () => {
  const subject = engine({ minimumPercent: 0.1, minimumSwingPercent: 1.0 });
  const rows = [
    candle(0, 100, 100, 100, 100),
    candle(1, 100, 100.4, 100, 100.3),
    candle(2, 100.3, 100.45, 100.2, 100.4),
    candle(3, 100.4, 100.4, 99.9, 100),
    candle(4, 100, 100.1, 99.8, 99.9),
  ];
  const snapshot = subject.ingestCandles(rows);
  assert.equal(snapshot.history.length, 0);
  assert.equal(snapshot.direction, STRUCTURAL_DIRECTIONS.UNDEFINED);
});

test("detector switches direction after confirmation", () => {
  const subject = engine();
  const snapshot = subject.ingestCandles(risingToConfirmedHigh());
  assert.equal(snapshot.direction, STRUCTURAL_DIRECTIONS.TRACKING_DOWN);
  assert.equal(snapshot.candidate.side, "LOW");
});

test("confirmed extreme never moves after confirmation", () => {
  const subject = engine();
  subject.ingestCandles(risingToConfirmedHigh());
  const before = subject.snapshot().history[0];
  subject.ingestCandle(candle(7, 104.3, 104.7, 103.0, 103.2));
  subject.ingestCandle(candle(8, 103.2, 103.5, 102.0, 102.2));
  const after = subject.snapshot().history[0];
  assert.equal(after.id, before.id);
  assert.equal(after.price, before.price);
  assert.equal(after.extremeAt, before.extremeAt);
  assert.equal(after.confirmedAt, before.confirmedAt);
});

test("equal touch does not remove an active high", () => {
  const subject = engine();
  subject.ingestCandles(risingToConfirmedHigh());
  subject.ingestCandle(candle(7, 104.3, 104.5, 103.0, 103.5));
  const snapshot = subject.ingestCandle(candle(8, 103.5, 105.0, 103.4, 104.8));
  assert.equal(snapshot.active.length, 1);
  assert.equal(snapshot.active[0].status, STRUCTURAL_EXTREME_STATUSES.TOUCHED);
  assert.equal(snapshot.active[0].touchCount, 1);
  assert.equal(snapshot.active[0].crossedAt, undefined);
});

test("actual pass beyond tick tolerance removes active high", () => {
  const subject = engine();
  subject.ingestCandles(risingToConfirmedHigh());
  subject.ingestCandle(candle(7, 104.3, 104.5, 103.0, 103.5));
  const crossing = candle(8, 103.5, 105.2, 103.4, 105.15);
  const snapshot = subject.ingestCandle(crossing);
  assert.equal(snapshot.active.length, 0);
  assert.equal(snapshot.history[0].status, STRUCTURAL_EXTREME_STATUSES.CROSSED);
  assert.equal(snapshot.history[0].crossedAt, crossing.closeTime);
});

test("continuous candles near a level count as one attack", () => {
  const subject = engine();
  subject.ingestCandles(risingToConfirmedHigh());
  subject.ingestCandle(candle(7, 104.3, 104.4, 103.0, 103.5));
  subject.ingestCandle(candle(8, 103.5, 105.0, 103.4, 104.8));
  subject.ingestCandle(candle(9, 104.8, 105.0, 104.5, 104.9));
  subject.ingestCandle(candle(10, 104.9, 105.0, 104.6, 104.8));
  assert.equal(subject.snapshot().history[0].touchCount, 1);
});

test("two independent approaches count as x2", () => {
  const subject = engine();
  subject.ingestCandles(risingToConfirmedHigh());
  subject.ingestCandle(candle(7, 104.3, 104.4, 103.0, 103.5));
  subject.ingestCandle(candle(8, 103.5, 105.0, 103.4, 104.8));
  subject.ingestCandle(candle(9, 104.8, 104.8, 102.5, 103.0));
  subject.ingestCandle(candle(10, 103.0, 105.0, 102.9, 104.8));
  assert.equal(subject.snapshot().history[0].touchCount, 2);
});

test("all timeframes keep independent engines and state", () => {
  const registry = new StructuralExtremeRegistry({
    config: {
      common: {
        minimumPercent: 0.5,
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
  assert.notEqual(
    snapshot.timeframes["1m"].lastCandleTime,
    snapshot.timeframes["5m"].lastCandleTime,
  );
});

test("confirmed extreme does not exist before confirmedAt and no future candle is used", () => {
  const rows = risingToConfirmedHigh();
  const subject = engine();
  for (const row of rows.slice(0, -1)) subject.ingestCandle(row);
  assert.equal(subject.snapshot().history.length, 0);
  const after = subject.ingestCandle(rows.at(-1));
  assert.equal(after.history.length, 1);
  assert.equal(after.history[0].confirmedAt, rows.at(-1).closeTime);
  assert.ok(after.history[0].confirmedAt > after.history[0].extremeAt);
});

test("one confirmed extreme id is never emitted twice", () => {
  const subject = engine();
  subject.ingestCandles(risingToConfirmedHigh());
  for (let index = 7; index < 20; index += 1) {
    subject.ingestCandle(candle(index, 104, 104.5, 103.5, 104));
  }
  const confirmed = subject.snapshot().events
    .filter((row) => row.type === "EXTREME_CONFIRMED")
    .map((row) => row.extremeId);
  assert.equal(new Set(confirmed).size, confirmed.length);
  const firstHigh = subject.snapshot().history.find((row) => row.side === "HIGH");
  assert.ok(firstHigh);
  assert.equal(confirmed.filter((id) => id === firstHigh.id).length, 1);
});

test("restored state produces the same historical result as uninterrupted processing", () => {
  const rows = [
    ...risingToConfirmedHigh(),
    candle(7, 104.3, 104.4, 103.0, 103.5),
    candle(8, 103.5, 103.8, 102.0, 102.2),
    candle(9, 102.2, 103.0, 101.5, 102.8),
    candle(10, 102.8, 103.4, 101.7, 103.2),
  ];
  const continuous = engine();
  continuous.ingestCandles(rows);

  const partial = engine();
  partial.ingestCandles(rows.slice(0, 8));
  const restored = StructuralExtremeEngine.restore(partial.serialize());
  restored.ingestCandles(rows.slice(8));

  assert.deepEqual(restored.snapshot(), continuous.snapshot());
});

test("full replay and step-by-step live processing are deterministic", () => {
  const rows = [
    ...risingToConfirmedHigh(),
    candle(7, 104.3, 104.4, 103.0, 103.5),
    candle(8, 103.5, 103.8, 102.0, 102.2),
    candle(9, 102.2, 103.0, 101.5, 102.8),
  ];
  const replay = replayStructuralExtremes({
    symbol: "TESTUSDT",
    timeframe: "1m",
    tickSize: 0.1,
    config: {
      minimumPercent: 0.5,
      atrMultiplier: 0,
      minimumSwingPercent: 0.5,
      minimumBarsAfterCandidate: 2,
      tickSizeBufferTicks: 1,
    },
  }, rows);
  const live = engine();
  rows.forEach((row) => live.ingestCandle(row));
  assert.deepEqual(replay.final, live.snapshot());
  assert.equal(replay.steps.length, rows.length);
});
