import test from "node:test";
import assert from "node:assert/strict";
import { structuralLocalPivotProminenceDecision } from "../signal-lab-v7-multi-timeframe-levels.js";

const STEP = 5 * 60_000;
const candle = (index, high, low, close = (high + low) / 2) => ({
  time: index * STEP,
  closeTime: (index + 1) * STEP - 1,
  high,
  low,
  close,
});

const volatility = Object.freeze({
  baseNatrPct: 0.20,
  currentNatrPct: 0.20,
  compressionRatio: 1,
  volatilityState: "NORMAL",
  times: Object.freeze([]),
  natrs: Object.freeze([]),
});

test("V4.7 filters a shallow LOW pause inside a rising impulse", () => {
  const candles = [
    candle(0, 100.10, 99.95),
    candle(1, 100.16, 100.00),
    candle(2, 100.22, 100.08),
    candle(3, 100.20, 100.12), // false local LOW: only ~0.10% incoming leg
    candle(4, 100.32, 100.13),
    candle(5, 100.42, 100.24),
  ];
  const decision = structuralLocalPivotProminenceDecision({
    side: "LOW",
    price: 100.12,
    extremeAt: 3 * STEP,
    confirmedAt: 5 * STEP + STEP - 1,
  }, "5m", candles, volatility);

  assert.equal(decision.admitted, false);
  assert.equal(decision.incomingPassed, false);
  assert.equal(decision.outgoingPassed, true);
  assert.equal(decision.reason, "LOW_PIVOT_PROMINENCE_FILTERED");
});

test("V4.7 keeps a genuine LOW with a standalone incoming leg and rebound", () => {
  const candles = [
    candle(0, 100.80, 100.55),
    candle(1, 100.70, 100.35),
    candle(2, 100.48, 100.12),
    candle(3, 100.18, 100.00),
    candle(4, 100.42, 100.05),
    candle(5, 100.78, 100.36),
  ];
  const decision = structuralLocalPivotProminenceDecision({
    side: "LOW",
    price: 100.00,
    extremeAt: 3 * STEP,
    confirmedAt: 5 * STEP + STEP - 1,
  }, "5m", candles, volatility);

  assert.equal(decision.admitted, true);
  assert.equal(decision.incomingPassed, true);
  assert.equal(decision.outgoingPassed, true);
  assert.equal(decision.reason, "LOW_PIVOT_PROMINENCE_PASS");
});

test("V4.7 deliberately leaves HIGH calibration unchanged", () => {
  const decision = structuralLocalPivotProminenceDecision({
    side: "HIGH",
    price: 100.5,
    extremeAt: 3 * STEP,
    confirmedAt: 5 * STEP + STEP - 1,
  }, "5m", [], volatility);
  assert.equal(decision.admitted, true);
  assert.equal(decision.reason, "HIGH_CALIBRATION_BYPASS");
});
