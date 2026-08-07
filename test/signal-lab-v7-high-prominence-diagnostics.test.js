import test from "node:test";
import assert from "node:assert/strict";
import { structuralLocalPivotProminenceDecision } from "../signal-lab-v7-multi-timeframe-levels.js";

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

test("V4.12 HIGH stays admitted but exposes causal incoming/outgoing prominence diagnostics", () => {
  const candles = [
    candle(0, 99.20, 98.90),
    candle(1, 99.55, 99.10),
    candle(2, 99.90, 99.40),
    candle(3, 100.30, 99.80),
    candle(4, 100.70, 100.20),
    candle(5, 101.00, 100.55),
    candle(6, 101.10, 100.75),
    candle(7, 101.30, 100.95),
    candle(8, 101.10, 100.70),
    candle(9, 100.95, 100.55),
  ];
  const extreme = {
    side: "HIGH",
    price: 101.30,
    extremeAt: candles[7].time,
    confirmedAt: candles[9].time,
  };
  const decision = structuralLocalPivotProminenceDecision(extreme, "5m", candles, context(candles));
  assert.equal(decision.admitted, true);
  assert.equal(decision.reason, "HIGH_CALIBRATION_BYPASS");
  assert.ok(Number.isFinite(decision.incomingBaseNatr) && decision.incomingBaseNatr > 0);
  assert.ok(Number.isFinite(decision.outgoingBaseNatr) && decision.outgoingBaseNatr > 0);
});
