import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStructuralVolatilityContext,
  structuralLocalWorkingSetPivotDecision,
  structuralLocalWorkingSetVisible,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const STEP = 5 * 60_000;

function candle(index, open, high, low, close) {
  return { time: index * STEP, closeTime: (index + 1) * STEP - 1, open, high, low, close, closed: true };
}

function level(index, price) {
  return {
    id: `5m:LOW:${index}:${price}`,
    side: "LOW",
    price,
    extremeAt: index * STEP,
    nativeExtremeAt: index * STEP,
    sourceTimeframe: "5m",
    active: true,
    attackCount: 1,
    sources: ["5m"],
    confluenceCount: 1,
  };
}

test("V4.9 hides a shallow local LOW inside a larger rising impulse", () => {
  const rows = [
    candle(0, 100.0, 100.2, 99.8, 100.1),
    candle(1, 100.1, 100.8, 100.0, 100.7),
    candle(2, 100.7, 101.6, 100.6, 101.5),
    candle(3, 101.5, 102.5, 101.4, 102.4),
    candle(4, 102.4, 103.3, 102.3, 103.2),
    candle(5, 103.2, 104.1, 103.1, 104.0),
    candle(6, 104.0, 104.2, 103.75, 103.85),
    candle(7, 103.85, 104.5, 103.8, 104.4),
  ];
  const context = buildStructuralVolatilityContext(rows, { period: 3, baseWindow: 6 });
  const target = level(6, 103.75);
  const decision = structuralLocalWorkingSetPivotDecision(target, rows, context);
  assert.equal(decision.applicable, true);
  assert.ok(decision.retracementRatio < 0.20);
  assert.equal(decision.visible, false);
  assert.equal(structuralLocalWorkingSetVisible(target, context, rows), false);
});

test("V4.9 keeps a meaningful structural LOW pullback", () => {
  const rows = [
    candle(0, 100.0, 100.2, 99.8, 100.1),
    candle(1, 100.1, 101.0, 100.0, 100.9),
    candle(2, 100.9, 102.0, 100.8, 101.9),
    candle(3, 101.9, 103.0, 101.8, 102.9),
    candle(4, 102.9, 104.0, 102.8, 103.9),
    candle(5, 103.9, 104.3, 103.7, 104.1),
    candle(6, 104.1, 104.15, 102.8, 103.0),
    candle(7, 103.0, 103.8, 102.9, 103.7),
  ];
  const context = buildStructuralVolatilityContext(rows, { period: 3, baseWindow: 6 });
  const target = level(6, 102.8);
  const decision = structuralLocalWorkingSetPivotDecision(target, rows, context);
  assert.equal(decision.applicable, true);
  assert.ok(decision.retracementRatio >= 0.20);
  assert.equal(decision.visible, true);
});

test("V4.13 applies the HIGH-specific working-pivot gate to calibrated 5m HIGH", () => {
  const rows = [candle(0, 100, 101, 99, 100), candle(1, 100, 102, 100, 101)];
  const context = buildStructuralVolatilityContext(rows, { period: 2, baseWindow: 2 });
  const high = { ...level(1, 102), side: "HIGH" };
  const decision = structuralLocalWorkingSetPivotDecision(high, rows, context);
  assert.equal(decision.visible, false);
  assert.equal(decision.reason, "HIGH_WORKING_PIVOT_WEAK_INCOMING_FILTERED");
  assert.ok(decision.incomingBaseNatr < decision.minimumHighIncomingBaseNatr);
});