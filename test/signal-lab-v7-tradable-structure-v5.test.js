import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStructuralVAnchorExtremes,
  structuralLocalVRejectionDecision,
  structuralTrendLegQualificationDecision,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const five = 5 * 60_000;
const candle = (index, high, low, close = (high + low) / 2) => ({
  time: index * five,
  closeTime: (index + 1) * five - 1,
  open: close,
  high,
  low,
  close,
  volume: 1,
  closed: true,
});
const level = (id, side, price, index, extra = {}) => ({
  id,
  side,
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
  ...extra,
});

function volatilityFor(candles, natr = 2) {
  return {
    baseNatrPct: natr,
    currentNatrPct: natr,
    times: candles.map((row) => row.time),
    natrs: candles.map(() => natr),
  };
}

function cleanLowCandles() {
  return [
    candle(0, 101, 97),
    candle(1, 100, 96),
    candle(2, 99, 95),
    candle(3, 98, 94),
    candle(4, 97, 93),
    candle(5, 95, 92),
    candle(6, 93, 90, 91),
    candle(7, 96, 92, 95),
    candle(8, 97, 94, 96),
    candle(9, 98, 95, 97),
    candle(10, 99, 95, 98),
    candle(11, 100, 96, 99),
    candle(12, 101, 97, 100),
    candle(13, 102, 98, 101),
  ];
}

test("V5.4 accepts a clean balanced 5m V rejection", () => {
  const candles = cleanLowCandles();
  const decision = structuralLocalVRejectionDecision(
    level("good-low", "LOW", 90, 6),
    "5m",
    candles,
    volatilityFor(candles),
  );
  assert.equal(decision.qualified, true);
  assert.equal(decision.reason, "V_REJECTION_PASS");
  assert.ok(decision.immediateBalanceNatr >= 1);
  assert.ok(decision.sustainedBalanceNatr >= 2);
  assert.equal(decision.defenseReturns, 0);
});

test("V5.4 rejects a turn that returns into the level zone", () => {
  const candles = cleanLowCandles();
  candles[9] = candle(9, 98, 90.4, 97);
  const decision = structuralLocalVRejectionDecision(
    level("retested-low", "LOW", 90, 6),
    "5m",
    candles,
    volatilityFor(candles),
  );
  assert.equal(decision.qualified, false);
  assert.equal(decision.reason, "V_REJECTION_ZONE_RETESTED");
  assert.ok(decision.defenseReturns > 0);
});

test("V5.4 rejects weak immediate V geometry even if price later runs", () => {
  const candles = cleanLowCandles();
  candles[5] = candle(5, 91, 90.5, 90.8);
  const decision = structuralLocalVRejectionDecision(
    level("weak-low", "LOW", 90, 6),
    "5m",
    candles,
    volatilityFor(candles),
  );
  assert.equal(decision.qualified, false);
  assert.equal(decision.reason, "V_REJECTION_WEAK_IMMEDIATE_TURN");
});

test("V5.4 candle scanner creates a missing 5m V anchor without 1m data", () => {
  const candles = cleanLowCandles();
  const anchors = buildStructuralVAnchorExtremes(
    candles,
    "5m",
    volatilityFor(candles),
    { tickSize: 0.01, endAt: candles.at(-1).closeTime },
  );
  const anchor = anchors.find((row) => row.side === "LOW" && row.extremeAt === 6 * five);
  assert.ok(anchor);
  assert.equal(anchor.price, 90);
  assert.equal(anchor.syntheticStructuralAnchor, true);
  assert.equal(anchor.structuralReason, "V_REJECTION_5M");
});

test("V5.4 continuation level must prove V rejection, while repeated attack bypass remains", () => {
  const candles = cleanLowCandles();
  const prior = level("prior-low", "LOW", 80, 0);
  const current = level("current-low", "LOW", 90, 6);
  const decision = structuralTrendLegQualificationDecision(
    current,
    prior,
    "5m",
    candles,
    volatilityFor(candles),
  );
  assert.equal(decision.qualified, true);
  assert.equal(decision.reason, "TREND_LEG_V_REJECTION_PASS");

  const bypass = structuralTrendLegQualificationDecision(
    { ...current, id: "x2", attackCount: 2 },
    prior,
    "5m",
    [],
    volatilityFor(candles),
  );
  assert.equal(bypass.qualified, true);
  assert.equal(bypass.reason, "TREND_LEG_REPEATED_ATTACK_BYPASS");
});

test("1m no longer runs tradable structural qualification", () => {
  const decision = structuralTrendLegQualificationDecision(
    { ...level("legacy", "LOW", 90, 6), sourceTimeframe: "1m", sources: ["1m"] },
    null,
    "1m",
    [],
  );
  assert.equal(decision.qualified, true);
  assert.equal(decision.reason, "TREND_LEG_QUALIFICATION_NOT_APPLICABLE");
});
