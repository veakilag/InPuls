import test from "node:test";
import assert from "node:assert/strict";
import { structuralLocalWorkingSetVisible } from "../signal-lab-v7-multi-timeframe-levels.js";

const STEP = 5 * 60_000;
const candles = [
  { time: 0 * STEP, high: 99.82, low: 99.75, close: 99.80 },
  { time: 1 * STEP, high: 99.86, low: 99.79, close: 99.84 },
  { time: 2 * STEP, high: 99.89, low: 99.82, close: 99.87 },
  { time: 3 * STEP, high: 99.92, low: 99.85, close: 99.90 },
  { time: 4 * STEP, high: 99.95, low: 99.88, close: 99.93 },
  { time: 5 * STEP, high: 99.98, low: 99.91, close: 99.96 },
  { time: 6 * STEP, high: 100.00, low: 99.94, close: 99.97 },
];

const volatilityContext = {
  currentPrice: 99.97,
  currentNatrPct: 0.10,
  baseNatrPct: 0.10,
};

test("V4.14 1m confluence cannot resurrect a weak 5m HIGH", () => {
  const weakFiveMinutePrimary = {
    side: "HIGH",
    price: 100.00,
    sourceTimeframe: "5m",
    nativeExtremeAt: 6 * STEP,
    extremeAt: 6 * STEP,
    active: true,
    attackCount: 1,
    sources: ["5m", "1m"],
    confluenceCount: 2,
  };

  assert.equal(
    structuralLocalWorkingSetVisible(weakFiveMinutePrimary, volatilityContext, candles),
    false,
  );
});

test("V4.14 real senior primary still bypasses local working-pivot policy", () => {
  const seniorPrimary = {
    side: "HIGH",
    price: 100.00,
    sourceTimeframe: "15m",
    nativeExtremeAt: 6 * STEP,
    extremeAt: 6 * STEP,
    active: true,
    attackCount: 1,
    sources: ["15m", "5m", "1m"],
    confluenceCount: 3,
  };

  assert.equal(
    structuralLocalWorkingSetVisible(seniorPrimary, volatilityContext, candles),
    true,
  );
});

test("V4.14 repeated attacks remain an independent local visibility bypass", () => {
  const repeatedWeakFiveMinutePrimary = {
    side: "HIGH",
    price: 100.00,
    sourceTimeframe: "5m",
    nativeExtremeAt: 6 * STEP,
    extremeAt: 6 * STEP,
    active: true,
    attackCount: 2,
    sources: ["5m", "1m"],
    confluenceCount: 2,
  };

  assert.equal(
    structuralLocalWorkingSetVisible(repeatedWeakFiveMinutePrimary, volatilityContext, candles),
    true,
  );
});
