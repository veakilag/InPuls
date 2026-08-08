import test from "node:test";
import assert from "node:assert/strict";

import {
  filterLocalTradableStructure,
  structuralTrendLegQualificationDecision,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const minute = 60_000;
const level = (id, side, price, index, extra = {}) => ({
  id,
  side,
  price,
  extremeAt: index * minute,
  nativeExtremeAt: index * minute,
  displayAt: index * minute,
  sourceTimeframe: "1m",
  sources: ["1m"],
  refinedThroughTimeframe: "1m",
  refinementPath: [{ timeframe: "1m", time: index * minute }],
  active: true,
  attackCount: 1,
  ...extra,
});
const candle = (index, high, low, close = (high + low) / 2) => ({
  time: index * minute,
  high,
  low,
  close,
});

test("V5 filters shallow higher-LOW staircases inside one bullish leg", () => {
  const levels = [
    level("low-base", "LOW", 100, 0),
    level("low-step-1", "LOW", 108, 5),
    level("low-step-2", "LOW", 109, 10),
  ];
  const candles = [
    candle(1, 104, 101), candle(2, 108, 103), candle(3, 110, 106),
    candle(4, 110, 107), candle(5, 109, 108),
    candle(6, 111, 108), candle(7, 112, 109), candle(8, 112, 109),
    candle(9, 112, 109), candle(10, 111, 109),
  ];
  const result = filterLocalTradableStructure(levels, "1m", candles);
  assert.deepEqual(result.map((row) => row.id), ["low-base"]);
});

test("V5 accepts a higher LOW after a meaningful leg reset", () => {
  const prior = level("low-base", "LOW", 100, 0);
  const current = level("low-reset", "LOW", 106, 5);
  const candles = [
    candle(1, 104, 101), candle(2, 108, 103), candle(3, 110, 105),
    candle(4, 109, 106), candle(5, 108, 106),
  ];
  const decision = structuralTrendLegQualificationDecision(current, prior, "1m", candles);
  assert.equal(decision.qualified, true);
  assert.equal(decision.reason, "TREND_LEG_RESET_PASS");
  assert.ok(decision.resetRatio >= 0.30);
});

test("V5 mirrors the rule for lower HIGH staircases inside one bearish leg", () => {
  const levels = [
    level("high-base", "HIGH", 110, 0),
    level("high-step", "HIGH", 102, 5),
  ];
  const candles = [
    candle(1, 109, 106), candle(2, 107, 103), candle(3, 104, 100),
    candle(4, 103, 100), candle(5, 102, 101),
  ];
  const result = filterLocalTradableStructure(levels, "1m", candles);
  assert.deepEqual(result.map((row) => row.id), ["high-base"]);
});

test("V5 never suppresses repeated attacks or multi-TF confluence", () => {
  const levels = [
    level("low-base", "LOW", 100, 0),
    level("low-x2", "LOW", 109, 5, { attackCount: 2 }),
    level("low-confluence", "LOW", 109.5, 6, {
      sourceTimeframe: "15m",
      sources: ["15m", "1m"],
      refinementPath: [
        { timeframe: "15m", time: 0 },
        { timeframe: "1m", time: 6 * minute },
      ],
      displayAt: 6 * minute,
    }),
  ];
  const candles = [
    candle(1, 104, 101), candle(2, 108, 103), candle(3, 110, 106),
    candle(4, 110, 108), candle(5, 110, 109), candle(6, 110, 109.5),
  ];
  const result = filterLocalTradableStructure(levels, "1m", candles);
  assert.deepEqual(result.map((row) => row.id), ["low-base", "low-x2", "low-confluence"]);
});

test("V5.1 keeps a same-side leg anchor alive across a long smooth trend", () => {
  const prior = level("low-old", "LOW", 100, 0);
  const current = level("low-new", "LOW", 109, 61);
  const decision = structuralTrendLegQualificationDecision(current, prior, "1m", [
    candle(30, 106, 103), candle(60, 110, 108), candle(61, 110, 109),
  ]);
  assert.equal(decision.qualified, false);
  assert.equal(decision.reason, "TREND_LEG_SHALLOW_CONTINUATION_FILTERED");
  assert.equal(decision.anchorBars, 61);
  assert.ok(decision.resetRatio < 0.30);
});


test("V5.1 filters a native 5m staircase before it can become hierarchy noise", () => {
  const five = 5 * minute;
  const native = (id, price, index) => ({
    id,
    side: "LOW",
    price,
    extremeAt: index * five,
    nativeExtremeAt: index * five,
    displayAt: index * five,
    sourceTimeframe: "5m",
    sources: ["5m"],
    refinedThroughTimeframe: "5m",
    refinementPath: [{ timeframe: "5m", time: index * five }],
    active: true,
    attackCount: 1,
  });
  const rows = [
    { time: 1 * five, high: 104, low: 101, close: 103 },
    { time: 2 * five, high: 108, low: 103, close: 107 },
    { time: 3 * five, high: 110, low: 106, close: 109 },
    { time: 4 * five, high: 110, low: 107, close: 109 },
    { time: 5 * five, high: 110, low: 108, close: 109 },
    { time: 6 * five, high: 111, low: 108.5, close: 110 },
  ];
  const result = filterLocalTradableStructure([
    native("base", 100, 0),
    native("step-1", 108, 5),
    native("step-2", 108.5, 6),
  ], "5m", rows);
  assert.deepEqual(result.map((row) => row.id), ["base"]);
});
