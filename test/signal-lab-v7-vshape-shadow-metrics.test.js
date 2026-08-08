import test from "node:test";
import assert from "node:assert/strict";

import { structuralVShapeShadowMetrics } from "../signal-lab-v7-multi-timeframe-review-runtime.js";

const STEP = 300_000;
const candle = (index, high, low, close = (high + low) / 2) => ({
  time: index * STEP,
  closeTime: (index + 1) * STEP - 1,
  open: close,
  high,
  low,
  close,
  volume: 1,
  closed: true,
});

const volatilityContext = {
  baseNatrPct: 2,
  times: [0, STEP, 2 * STEP, 3 * STEP, 4 * STEP],
  natrs: [2, 2, 2, 2, 2],
};

test("V-shape shadow metric measures LOW arrival and separation symmetrically in NATR", () => {
  const candles = [
    candle(0, 100, 96),
    candle(1, 96, 90, 92),
    candle(2, 98, 91),
    candle(3, 99, 94),
    candle(4, 100, 95),
  ];
  const metric = structuralVShapeShadowMetrics({
    side: "LOW",
    price: 90,
    extremeAt: STEP,
    confirmedAt: 3 * STEP - 1,
    confirmingReversalPct: 4,
    candles,
    volatilityContext,
    intervalMs: STEP,
  });
  assert.ok(metric);
  assert.equal(metric.scaleNatrPct, 2);
  assert.ok(metric.windows[1].incomingNatr > 5);
  assert.ok(metric.windows[1].outgoingNatr > 4);
  assert.equal(metric.confirmationBars, 1);
  assert.equal(metric.confirmingReversalNatr, 2);
});

test("V-shape shadow metric mirrors HIGH geometry", () => {
  const candles = [
    candle(0, 104, 100),
    candle(1, 110, 104, 108),
    candle(2, 109, 102),
    candle(3, 106, 100),
    candle(4, 105, 99),
  ];
  const metric = structuralVShapeShadowMetrics({
    side: "HIGH",
    price: 110,
    extremeAt: STEP,
    candles,
    volatilityContext,
    intervalMs: STEP,
  });
  assert.ok(metric);
  assert.ok(metric.windows[1].incomingNatr > 4);
  assert.ok(metric.windows[1].outgoingNatr > 3);
});
