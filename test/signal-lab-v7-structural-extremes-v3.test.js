import test from "node:test";
import assert from "node:assert/strict";
import {
  StructuralExtremeEngine,
  STRUCTURAL_DIRECTIONS,
  STRUCTURAL_EXTREME_STATUSES,
} from "../signal-lab-v7-structural-extremes.js";
import {
  fixedReviewUrl,
  manualLevelLifecycle,
} from "../signal-lab-v7-review-level-lifecycle.js";

const BASE = Date.UTC(2026, 7, 1, 0, 0, 0);
const STEP = 60_000;

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
      minimumPercent: 2,
      maximumPercent: 2,
      atrMultiplier: 0,
      minimumSwingPercent: 1,
      minimumBarsAfterCandidate: 1,
      tickSizeBufferTicks: 1,
      crossingToleranceTicks: 1,
      touchZoneTicks: 2,
      touchZoneFactor: 0.15,
      maximumTouchZonePercent: 0.25,
      ...extra,
    },
  });
}

test("opposite low formed before high confirmation becomes next candidate", () => {
  const subject = engine();
  const rows = [
    candle(0, 100, 100, 100, 100),
    candle(1, 100, 106, 100, 105),
    candle(2, 105, 110, 104, 109),
    candle(3, 109, 109, 101, 108.5),
    candle(4, 108.5, 109, 103, 107),
  ];
  const snapshot = subject.ingestCandles(rows);
  assert.equal(snapshot.history.length, 1);
  assert.equal(snapshot.history[0].side, "HIGH");
  assert.equal(snapshot.direction, STRUCTURAL_DIRECTIONS.TRACKING_DOWN);
  assert.equal(snapshot.candidate.side, "LOW");
  assert.equal(snapshot.candidate.price, 101);
  assert.equal(snapshot.candidate.extremeAt, rows[3].time);
  assert.equal(snapshot.oppositeCandidate, null);
  assert.equal(snapshot.history[0].diagnostic.oppositeCandidatePreserved, true);
});

test("new higher high resets a stale opposite low", () => {
  const subject = engine();
  subject.ingestCandle(candle(0, 100, 100, 100, 100));
  subject.ingestCandle(candle(1, 100, 106, 100, 105));
  subject.ingestCandle(candle(2, 105, 110, 104, 109));
  subject.ingestCandle(candle(3, 109, 109, 101, 108.5));
  assert.equal(subject.snapshot().oppositeCandidate.price, 101);
  const snapshot = subject.ingestCandle(candle(4, 108.5, 112, 106, 111));
  assert.equal(snapshot.candidate.price, 112);
  assert.equal(snapshot.oppositeCandidate, null);
});

test("manual level counts two independent attacks and stops at break", () => {
  const rows = [
    candle(0, 100, 100, 99, 99.5),
    candle(1, 99.5, 99.6, 97, 97.5),
    candle(2, 97.5, 99.95, 97.4, 99.7),
    candle(3, 99.5, 99.6, 97, 97.4),
    candle(4, 97.4, 100, 97.3, 99.8),
    candle(5, 99.8, 100.3, 99.7, 100.2),
  ];
  const result = manualLevelLifecycle({
    candles: rows,
    side: "HIGH",
    price: 100,
    extremeAt: rows[0].time,
    tickSize: 0.1,
    reversalThresholdPct: 1,
    crossingToleranceTicks: 1,
    touchZoneTicks: 2,
    touchZoneFactor: 0.15,
    maximumTouchZonePct: 0.25,
    rearmDistanceFactor: 0.7,
  });
  assert.equal(result.touchCount, 2);
  assert.equal(result.status, "CROSSED");
  assert.equal(result.active, false);
  assert.equal(result.crossedAt, rows[5].closeTime);
  assert.deepEqual(result.attacks.map((row) => row.number), [1, 2]);
});

test("continuous candles in the level zone remain one attack", () => {
  const rows = [
    candle(0, 100, 100, 99, 99.5),
    candle(1, 99.5, 99.6, 97, 97.5),
    candle(2, 97.5, 99.95, 97.4, 99.7),
    candle(3, 99.7, 100, 99.5, 99.8),
    candle(4, 99.8, 99.95, 99.6, 99.7),
  ];
  const result = manualLevelLifecycle({
    candles: rows,
    side: "HIGH",
    price: 100,
    extremeAt: rows[0].time,
    tickSize: 0.1,
    reversalThresholdPct: 1,
  });
  assert.equal(result.touchCount, 1);
  assert.equal(result.active, true);
});

test("fixed review URL keeps exact symbol timeframe and end time", () => {
  const result = fixedReviewUrl({
    locationHref: "https://example.com/review?old=1",
    symbol: "ubusdt",
    timeframe: "15m",
    endAt: 1786043340000,
  });
  const url = new URL(result);
  assert.equal(url.searchParams.get("symbol"), "UBUSDT");
  assert.equal(url.searchParams.get("tf"), "15m");
  assert.equal(url.searchParams.get("endAt"), "1786043340000");
  assert.equal(url.searchParams.get("fixed"), "1");
  assert.equal(url.searchParams.get("old"), "1");
});

test("algorithm level uses adaptive zone and counts two attacks", () => {
  const subject = engine({
    minimumPercent: 1,
    maximumPercent: 1,
    rearmDistanceFactor: 0.5,
  });
  const rows = [
    candle(0, 100, 100, 100, 100),
    candle(1, 100, 104, 100, 103.5),
    candle(2, 103.5, 105, 103, 104.5),
    candle(3, 104.5, 104.8, 101.5, 102),
    candle(4, 102, 103, 101, 102),
    candle(5, 102, 104.9, 101.8, 104.7),
    candle(6, 104.7, 104.7, 101.5, 102),
    candle(7, 102, 105, 101.9, 104.8),
  ];
  const snapshot = subject.ingestCandles(rows);
  const high = snapshot.history.find((row) => row.side === "HIGH");
  assert.ok(high);
  assert.equal(high.status, STRUCTURAL_EXTREME_STATUSES.TOUCHED);
  assert.equal(high.touchCount, 2);
});
