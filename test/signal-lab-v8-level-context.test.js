import test from "node:test";
import assert from "node:assert/strict";

import { buildLevelResearchContexts } from "../signal-lab-v8-level-context.js";

const STEP = 300_000;
const candles = Array.from({ length: 40 }, (_, index) => ({
  time: index * STEP,
  closeTime: (index + 1) * STEP - 1,
  open: 100 + index * 0.05,
  high: 101 + index * 0.05,
  low: 99 + index * 0.05,
  close: 100 + index * 0.05,
  volume: 1,
  closed: true,
}));

const base = {
  side: "HIGH",
  sourceTimeframe: "5m",
  sources: ["5m"],
  confluenceCount: 1,
  attackCount: 1,
  active: true,
  extremeAt: 10 * STEP,
  nativeExtremeAt: 10 * STEP,
  swingAmplitudePct: 4,
  confirmingReversalPct: 2,
};

test("V6 relevance is higher for a closer level and exposes the 0-5% working window", () => {
  const levels = [
    { ...base, id: "near", price: 102 },
    { ...base, id: "far", price: 115, extremeAt: 8 * STEP, nativeExtremeAt: 8 * STEP },
  ];
  const rows = buildLevelResearchContexts(levels, {
    candlesByTimeframe: { "5m": candles },
    viewTimeframe: "5m",
    endAt: 40 * STEP - 1,
    currentPrice: 100,
  });
  const near = rows.find((row) => row.id === "near");
  const far = rows.find((row) => row.id === "far");
  assert.ok(near.relevance.score > far.relevance.score);
  assert.equal(near.relevance.inFivePercentWindow, true);
  assert.equal(far.relevance.inFivePercentWindow, false);
});

test("V6 repeated attacks and confluence add relevance evidence without changing structure history", () => {
  const plain = { ...base, id: "plain", price: 102 };
  const validated = {
    ...base,
    id: "validated",
    price: 102.1,
    attackCount: 3,
    sources: ["5m", "15m", "1h"],
    confluenceCount: 3,
  };
  const rows = buildLevelResearchContexts([plain, validated], {
    candlesByTimeframe: { "5m": candles },
    viewTimeframe: "5m",
    endAt: 40 * STEP - 1,
    currentPrice: 100,
  });
  const a = rows.find((row) => row.id === "plain");
  const b = rows.find((row) => row.id === "validated");
  assert.ok(b.relevance.score > a.relevance.score);
  assert.equal(b.relevance.attackComponent, 100);
  assert.equal(b.relevance.confluenceComponent, 100);
});

test("V6 exposes density, own-timeframe age, time boundaries and missing market-data coverage", () => {
  const rows = buildLevelResearchContexts([
    { ...base, id: "a", price: 101 },
    { ...base, id: "b", price: 103, extremeAt: 20 * STEP, nativeExtremeAt: 20 * STEP },
    { ...base, id: "c", price: 120, extremeAt: 30 * STEP, nativeExtremeAt: 30 * STEP },
  ], {
    candlesByTimeframe: { "5m": candles },
    viewTimeframe: "5m",
    endAt: 40 * STEP - 1,
    currentPrice: 100,
  });
  const a = rows.find((row) => row.id === "a");
  assert.equal(a.relevance.neighborsWithin5PctOfLevel, 1);
  assert.equal(a.relevance.activeLevelsWithin5PctOfCurrent, 2);
  assert.ok(a.ageBars > 20);
  assert.ok(a.timeContext["30m"]);
  assert.equal(a.coverage.orderBookSizes, "UNAVAILABLE");
  assert.equal(a.coverage.marketMemory, "UNAVAILABLE");
  assert.equal(a.researchOnly, true);
});

test("V6 quality is normalized only from available structural geometry and stays research-only", () => {
  const strong = { ...base, id: "strong", price: 103, swingAmplitudePct: 8, confirmingReversalPct: 4 };
  const weak = { ...base, id: "weak", price: 104, swingAmplitudePct: 0.5, confirmingReversalPct: 0.2 };
  const rows = buildLevelResearchContexts([strong, weak], {
    candlesByTimeframe: { "5m": candles },
    viewTimeframe: "5m",
    endAt: 40 * STEP - 1,
    currentPrice: 100,
  });
  const strongRow = rows.find((row) => row.id === "strong");
  const weakRow = rows.find((row) => row.id === "weak");
  assert.ok(strongRow.quality.score > weakRow.quality.score);
  assert.equal(strongRow.quality.state, "RESEARCH_ONLY");
});
