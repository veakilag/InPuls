import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_WORKING_SET_POLICY,
  structuralLocalRightEdgeMaturityDecision,
  structuralLocalWorkingSetVisible,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const ctx = {
  currentPrice: 100,
  baseNatrPct: 0.20,
};

function level(overrides = {}) {
  return {
    sourceTimeframe: "5m",
    side: "LOW",
    price: 99.8,
    active: true,
    attackCount: 1,
    confluenceCount: 1,
    sources: ["5m"],
    swingAmplitudePct: 1.5,
    ...overrides,
  };
}

test("V4.6 hides distant local-only single-touch 5m levels even when swing was large", () => {
  assert.equal(LOCAL_WORKING_SET_POLICY["5m"].maxDistanceBaseNatr, 6);
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 98.0 }), ctx), false);
});

test("V4.14 keeps nearby valid locals, repeated attacks, and true senior-primary confluence", () => {
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 99.2 }), ctx), true);
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 97.0, attackCount: 2 }), ctx), true);
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 97.0, sourceTimeframe: "1h", confluenceCount: 2, sources: ["1h", "5m"] }), ctx), true);
});


test("V4.15 child confluence retains a pivot after quality gate even outside local distance radius", () => {
  const distantConfluent = level({
    price: 97.0,
    sourceTimeframe: "5m",
    confluenceCount: 2,
    sources: ["5m", "1m"],
  });
  assert.equal(structuralLocalWorkingSetVisible(distantConfluent, ctx), true);
});


test("V4.16 retains the latest valid native 1m frontier outside distance radius without widening all locals", () => {
  const oneMinute = level({
    sourceTimeframe: "1m",
    side: "HIGH",
    price: 102.0,
    sources: ["1m"],
    confluenceCount: 1,
  });
  assert.equal(structuralLocalWorkingSetVisible(oneMinute, ctx), false);
  assert.equal(structuralLocalWorkingSetVisible(oneMinute, ctx, [], { retainAsNativeFrontier: true }), true);
});


test("V4.17 hides unresolved single-touch native 1m pivots at the right edge", () => {
  const oneMinute = level({
    sourceTimeframe: "1m",
    side: "HIGH",
    price: 100.1,
    extremeAt: 120_000,
    nativeExtremeAt: 120_000,
    sources: ["1m"],
  });
  const oneBarRight = [
    { time: 60_000, high: 100, low: 99, close: 99.5 },
    { time: 120_000, high: 100.1, low: 99.4, close: 99.8 },
    { time: 180_000, high: 100, low: 99.5, close: 99.7 },
  ];
  const twoBarsRight = [
    ...oneBarRight,
    { time: 240_000, high: 99.9, low: 99.3, close: 99.6 },
  ];

  assert.equal(LOCAL_WORKING_SET_POLICY["1m"].minimumRightBars, 2);
  assert.equal(structuralLocalRightEdgeMaturityDecision(oneMinute, oneBarRight).mature, false);
  assert.equal(structuralLocalWorkingSetVisible(oneMinute, ctx, oneBarRight), false);
  assert.equal(structuralLocalRightEdgeMaturityDecision(oneMinute, twoBarsRight).mature, true);
  assert.equal(structuralLocalWorkingSetVisible(oneMinute, ctx, twoBarsRight), true);
});

test("V4.17 repeated attacks bypass right-edge maturity because x2+ is already confirmed structure", () => {
  const repeated = level({
    sourceTimeframe: "1m",
    side: "HIGH",
    price: 100.1,
    extremeAt: 120_000,
    nativeExtremeAt: 120_000,
    attackCount: 2,
    sources: ["1m"],
  });
  const edge = [
    { time: 60_000, high: 100, low: 99, close: 99.5 },
    { time: 120_000, high: 100.1, low: 99.4, close: 99.8 },
  ];
  assert.equal(structuralLocalWorkingSetVisible(repeated, ctx, edge), true);
});
