import test from "node:test";
import assert from "node:assert/strict";
import {
  structuralLocalPivotProminenceDecision,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const STEP = 5 * 60_000;
const candle = (index, high, low, close = (high + low) / 2) => ({
  time: index * STEP,
  closeTime: (index + 1) * STEP - 1,
  open: close,
  high,
  low,
  close,
  closed: true,
});

function context(candles, baseNatrPct = 0.20) {
  return {
    currentPrice: candles.at(-1)?.close ?? 100,
    currentNatrPct: baseNatrPct,
    baseNatrPct,
    compressionRatio: 1,
    volatilityState: "NORMAL",
    times: candles.map((row) => row.time),
    natrs: candles.map(() => baseNatrPct),
  };
}

test("V4.8 filters a shallow LOW pause inside one larger rising impulse", () => {
  const candles = [
    candle(0, 99.10, 98.90),
    candle(1, 99.45, 99.05),
    candle(2, 99.90, 99.35),
    candle(3, 100.35, 99.80),
    candle(4, 100.75, 100.25),
    candle(5, 101.05, 100.65),
    candle(6, 101.10, 100.84),
    candle(7, 101.08, 100.80), // shallow candidate LOW after a ~2.2 point impulse
    candle(8, 101.12, 100.86),
    candle(9, 101.18, 100.92),
  ];
  const extreme = {
    side: "LOW",
    price: 100.80,
    extremeAt: candles[7].time,
    confirmedAt: candles[9].time,
  };
  const decision = structuralLocalPivotProminenceDecision(extreme, "5m", candles, context(candles));
  assert.equal(decision.incomingPassed, true);
  assert.equal(decision.outgoingPassed, true);
  assert.equal(decision.retracementApplicable, true);
  assert.ok(decision.retracementRatio < 0.30);
  assert.equal(decision.minimumRetracementRatio, 0.30);
  assert.equal(decision.admitted, false);
  assert.equal(decision.reason, "LOW_PIVOT_SHALLOW_RETRACEMENT_FILTERED");
});

test("V4.8 keeps a meaningful LOW retracement after a real prior impulse", () => {
  const candles = [
    candle(0, 99.10, 98.90),
    candle(1, 99.50, 99.00),
    candle(2, 100.00, 99.40),
    candle(3, 100.50, 99.90),
    candle(4, 101.00, 100.40),
    candle(5, 101.10, 100.70),
    candle(6, 100.95, 100.30),
    candle(7, 100.55, 99.95), // meaningful pullback LOW
    candle(8, 100.65, 100.05),
    candle(9, 100.90, 100.30),
  ];
  const extreme = {
    side: "LOW",
    price: 99.95,
    extremeAt: candles[7].time,
    confirmedAt: candles[9].time,
  };
  const decision = structuralLocalPivotProminenceDecision(extreme, "5m", candles, context(candles));
  assert.equal(decision.incomingPassed, true);
  assert.equal(decision.outgoingPassed, true);
  assert.equal(decision.retracementApplicable, true);
  assert.ok(decision.retracementRatio >= 0.30);
  assert.equal(decision.minimumRetracementRatio, 0.30);
  assert.equal(decision.admitted, true);
});

test("V4.8 still bypasses HIGH so BTC compression highs cannot regress", () => {
  const candles = [candle(0, 100.2, 99.8), candle(1, 100.4, 100.0)];
  const decision = structuralLocalPivotProminenceDecision({
    side: "HIGH",
    price: 100.4,
    extremeAt: candles[1].time,
    confirmedAt: candles[1].time,
  }, "5m", candles, context(candles));
  assert.equal(decision.admitted, true);
  assert.equal(decision.reason, "HIGH_CALIBRATION_BYPASS");
});
