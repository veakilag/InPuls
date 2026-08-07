import test from "node:test";
import assert from "node:assert/strict";
import {
  structuralLocalWorkingSetPivotDecision,
  structuralLocalWorkingSetVisible,
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

const volatility = {
  currentPrice: 100,
  currentNatrPct: 0.20,
  baseNatrPct: 0.20,
  compressionRatio: 1,
  volatilityState: "NORMAL",
  times: [],
  natrs: [],
};

function level(price, time, extra = {}) {
  return {
    id: `5m:HIGH:${time}:${price}`,
    side: "HIGH",
    price,
    extremeAt: time,
    nativeExtremeAt: time,
    sourceTimeframe: "5m",
    sources: ["5m"],
    attackCount: 1,
    active: true,
    ...extra,
  };
}

test("V4.13 filters a 5m HIGH whose incoming rise is below 3 base NATR", () => {
  const candles = [
    candle(0, 99.82, 99.70),
    candle(1, 99.88, 99.76),
    candle(2, 99.92, 99.80),
    candle(3, 99.96, 99.84),
    candle(4, 99.99, 99.88),
    candle(5, 100.00, 99.92),
    candle(6, 100.00, 99.90),
  ];
  const target = level(100.00, candles[5].time);
  const decision = structuralLocalWorkingSetPivotDecision(target, candles, volatility);
  assert.equal(decision.visible, false);
  assert.equal(decision.reason, "HIGH_WORKING_PIVOT_WEAK_INCOMING_FILTERED");
  assert.ok(decision.incomingBaseNatr < 3);
  assert.equal(structuralLocalWorkingSetVisible(target, volatility, candles), false);
});

test("V4.13 keeps a 5m HIGH with a standalone incoming rise above 3 base NATR", () => {
  const candles = [
    candle(0, 99.30, 99.10),
    candle(1, 99.50, 99.25),
    candle(2, 99.70, 99.45),
    candle(3, 99.85, 99.65),
    candle(4, 99.95, 99.78),
    candle(5, 100.00, 99.90),
    candle(6, 100.00, 99.88),
  ];
  const target = level(100.00, candles[5].time);
  const decision = structuralLocalWorkingSetPivotDecision(target, candles, volatility);
  assert.equal(decision.visible, true);
  assert.equal(decision.reason, "HIGH_WORKING_PIVOT_PASS");
  assert.ok(decision.incomingBaseNatr >= 3);
  assert.equal(structuralLocalWorkingSetVisible(target, volatility, candles), true);
});

test("V4.13 preserves senior confluence and x2+ attack bypasses for weak HIGH", () => {
  const candles = [
    candle(0, 99.82, 99.70),
    candle(1, 99.88, 99.76),
    candle(2, 99.92, 99.80),
    candle(3, 99.96, 99.84),
    candle(4, 99.99, 99.88),
    candle(5, 100.00, 99.92),
  ];
  const weak = level(100.00, candles[5].time);
  assert.equal(structuralLocalWorkingSetPivotDecision(weak, candles, volatility).visible, false);
  assert.equal(structuralLocalWorkingSetVisible(level(100.00, candles[5].time, { sources: ["5m", "1h"] }), volatility, candles), true);
  assert.equal(structuralLocalWorkingSetVisible(level(100.00, candles[5].time, { attackCount: 2 }), volatility, candles), true);
});

test("V4.13 does not calibrate 1m HIGH yet", () => {
  const candles = [candle(0, 100, 99.9), candle(1, 100.01, 99.95)];
  const target = { ...level(100.01, candles[1].time), sourceTimeframe: "1m", sources: ["1m"] };
  const decision = structuralLocalWorkingSetPivotDecision(target, candles, volatility);
  assert.equal(decision.visible, true);
  assert.equal(decision.reason, "HIGH_WORKING_PIVOT_NOT_CALIBRATED");
});
