import test from "node:test";
import assert from "node:assert/strict";

import { buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, buildStackRouteResearchContext, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";

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


test("V6.1 far-away confluence and attacks do not manufacture current relevance outside 5%", () => {
  const farStrong = {
    ...base,
    id: "far-strong",
    price: 120,
    attackCount: 5,
    sources: ["5m", "15m", "1h"],
    confluenceCount: 3,
  };
  const [row] = buildLevelResearchContexts([farStrong], {
    candlesByTimeframe: { "5m": candles },
    viewTimeframe: "5m",
    endAt: 40 * STEP - 1,
    currentPrice: 100,
  });
  assert.equal(row.relevance.inFivePercentWindow, false);
  assert.equal(row.relevance.score, 0);
  assert.equal(row.relevance.attackComponent, 100);
  assert.equal(row.relevance.confluenceComponent, 100);
});

test("V6.1 research pool adds hidden source-qualified candidates without duplicating visible members", () => {
  const visible = [{
    ...base,
    id: "senior-primary",
    memberIds: ["native-visible"],
    price: 102,
    sources: ["15m", "5m"],
    sourceTimeframe: "15m",
  }];
  const hidden = [
    { ...base, id: "native-visible", price: 102 },
    { ...base, id: "hidden-near", price: 101 },
  ];
  const pool = mergeLevelResearchCandidatePool(visible, hidden);
  assert.equal(pool.length, 2);
  assert.equal(pool.find((row) => row.id === "senior-primary")?.researchCandidateState, "VISIBLE_MAP");
  assert.equal(pool.find((row) => row.id === "hidden-near")?.researchCandidateState, "SOURCE_QUALIFIED_HIDDEN");
  assert.equal(pool.some((row) => row.id === "native-visible"), false);
});


test("V6.2 separates nearest execution bracket from strongest structural bracket", () => {
  const contexts = [
    { id: "low", side: "LOW", price: 98, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 45 }, relevance: { score: 36 } },
    { id: "near-high", side: "HIGH", price: 101, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 20 }, relevance: { score: 48 } },
    { id: "strong-high", side: "HIGH", price: 104, currentPrice: 100, candidateState: "VISIBLE_MAP", quality: { score: 90 }, relevance: { score: 12 } },
  ];
  const row = buildLocalStructureResearchContext(contexts, { currentPrice: 100, currentNatrPct: 2 });
  assert.equal(row.nearestBracket.low.id, "low");
  assert.equal(row.nearestBracket.high.id, "near-high");
  assert.equal(row.strongestBracket.low.id, "low");
  assert.equal(row.strongestBracket.high.id, "strong-high");
  assert.equal(row.researchOnly, true);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "score"), false);
});

test("V6.2 reports local density and ignores levels outside the 0-5% window", () => {
  const contexts = [
    { id: "h1", side: "HIGH", price: 100.5, currentPrice: 100, candidateState: "VISIBLE_MAP", quality: { score: 50 }, relevance: { score: 50 } },
    { id: "l1", side: "LOW", price: 98.5, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 50 }, relevance: { score: 50 } },
    { id: "far", side: "HIGH", price: 108, currentPrice: 100, candidateState: "VISIBLE_MAP", quality: { score: 100 }, relevance: { score: 0 } },
  ];
  const row = buildLocalStructureResearchContext(contexts, { currentPrice: 100, currentNatrPct: 1 });
  assert.equal(row.counts.within1Pct, 1);
  assert.equal(row.counts.within2Pct, 2);
  assert.equal(row.counts.within5Pct, 2);
  assert.equal(row.counts.visible, 1);
  assert.equal(row.counts.shadow, 1);
  assert.ok(row.nearestBracket.widthPct > 0);
  assert.ok(row.nearestBracket.widthNatr > 0);
});

test("V6.2 exposes side-mismatch candidates without interpreting them as support/resistance", () => {
  const contexts = [
    { id: "low-above", side: "LOW", price: 101, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 40 }, relevance: { score: 40 } },
    { id: "high-below", side: "HIGH", price: 99, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 40 }, relevance: { score: 40 } },
  ];
  const row = buildLocalStructureResearchContext(contexts, { currentPrice: 100, currentNatrPct: 1 });
  assert.equal(row.counts.sideMismatch, 2);
  assert.equal(row.nearestBracket, null);
  assert.equal(row.sideMismatch.length, 2);
});


test("V6.3 HIGH approach measures higher floor and shrinking target gap symmetrically without a signal score", () => {
  const path = Array.from({ length: 12 }, (_, index) => {
    const close = 100 + index * 0.75;
    return {
      time: index * STEP,
      open: close - 0.2,
      high: close + (index >= 9 ? 1.2 : 0.8),
      low: close - 1.0,
      close,
    };
  });
  const target = { id: "h", side: "HIGH", price: 109, candidateState: "SOURCE_QUALIFIED_HIDDEN", qualityScore: 60, relevanceScore: 40 };
  const structure = { currentPrice: path.at(-1).close, currentNatrPct: 2, nearestHigh: target, strongestHigh: target };
  const context = buildApproachCompressionResearchContext(path, structure, { currentNatrPct: 2, lookbackBars: 12 });
  assert.equal(context.targets.length, 1);
  const row = context.targets[0];
  assert.deepEqual(row.roles, ["NEAREST", "QUALITY"]);
  assert.ok(row.towardDelta12Natr > 0);
  assert.ok(row.progressionNatr > 0);
  assert.equal(row.progressionLabel, "HIGHER_FLOOR");
  assert.ok(row.nearBars3 >= 1);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "score"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "attackCount"), false);
});

test("V6.3 LOW approach mirrors HIGH logic with lower ceiling progression", () => {
  const path = Array.from({ length: 12 }, (_, index) => {
    const close = 100 - index * 0.75;
    return {
      time: index * STEP,
      open: close + 0.2,
      high: close + 1.0,
      low: close - (index >= 9 ? 1.2 : 0.8),
      close,
    };
  });
  const target = { id: "l", side: "LOW", price: 91, candidateState: "SOURCE_QUALIFIED_HIDDEN", qualityScore: 55, relevanceScore: 35 };
  const structure = { currentPrice: path.at(-1).close, currentNatrPct: 2, nearestLow: target, strongestLow: target };
  const context = buildApproachCompressionResearchContext(path, structure, { currentNatrPct: 2, lookbackBars: 12 });
  const row = context.targets[0];
  assert.ok(row.towardDelta12Natr > 0);
  assert.ok(row.progressionNatr > 0);
  assert.equal(row.progressionLabel, "LOWER_CEILING");
  assert.ok(row.nearBars3 >= 1);
});

test("V6.3 keeps nearest and quality targets separate when structure points to different levels", () => {
  const path = Array.from({ length: 12 }, (_, index) => ({
    time: index * STEP,
    open: 100 + index * 0.1,
    high: 101 + index * 0.1,
    low: 99 + index * 0.1,
    close: 100 + index * 0.1,
  }));
  const structure = {
    currentPrice: path.at(-1).close,
    currentNatrPct: 1.5,
    nearestHigh: { id: "near", side: "HIGH", price: 102, candidateState: "SOURCE_QUALIFIED_HIDDEN", qualityScore: 20, relevanceScore: 50 },
    strongestHigh: { id: "strong", side: "HIGH", price: 104, candidateState: "VISIBLE_MAP", qualityScore: 90, relevanceScore: 20 },
  };
  const context = buildApproachCompressionResearchContext(path, structure, { currentNatrPct: 1.5 });
  assert.equal(context.targets.length, 2);
  assert.deepEqual(context.targets.map((row) => row.roles[0]), ["NEAREST", "QUALITY"]);
  assert.equal(context.researchOnly, true);
});



test("V6.3.1 causal approach excludes pre-confirmation candles and reports sample sufficiency", () => {
  const path = Array.from({ length: 8 }, (_, index) => {
    const beforeConfirmation = index <= 4;
    return {
      time: index * STEP,
      open: beforeConfirmation ? 105.2 : 100,
      high: beforeConfirmation ? 106 : 101,
      low: beforeConfirmation ? 104.8 : 99,
      close: beforeConfirmation ? 105.5 : 100,
    };
  });
  const confirmedAt = 5 * STEP - 1;
  const target = {
    id: "causal-high",
    side: "HIGH",
    price: 105,
    candidateState: "SOURCE_QUALIFIED_HIDDEN",
    qualityScore: 70,
    relevanceScore: 50,
    originAt: STEP,
    confirmedAt,
  };
  const structure = {
    currentPrice: 100,
    currentNatrPct: 1,
    nearestHigh: target,
    strongestHigh: target,
  };
  const context = buildApproachCompressionResearchContext(path, structure, {
    currentPrice: 100,
    currentNatrPct: 1,
    lookbackBars: 12,
  });
  const row = context.targets[0];
  assert.equal(row.causalBasis, "CONFIRMED_AT");
  assert.equal(row.causalFromAt, confirmedAt);
  assert.equal(row.causalBarsAvailable, 3);
  assert.equal(row.sampleBars, 3);
  assert.equal(row.requestedLookbackBars, 12);
  assert.equal(row.sampleState, "LIMITED");
  assert.equal(row.nearBars3, 0);
  assert.equal(row.nearBars6, null);
  assert.equal(row.nearBarsWindow, 0);
  assert.equal(row.proximityGroups, 0);
  assert.equal(row.closeBeyondBars, 0);
  assert.equal(row.extremeBeyondBars, 0);
  assert.equal(row.towardDelta6Natr, null);
  assert.equal(row.towardDelta12Natr, null);
});

test("V6.3.1 causal approach labels origin fallback and does not invent evidence with one bar", () => {
  const path = [
    { time: 0, open: 100, high: 101, low: 99, close: 100 },
    { time: STEP, open: 100, high: 101, low: 99, close: 100 },
    { time: 2 * STEP, open: 100, high: 101, low: 99, close: 100 },
  ];
  const target = {
    id: "origin-fallback",
    side: "HIGH",
    price: 105,
    candidateState: "VISIBLE_MAP",
    qualityScore: 80,
    relevanceScore: 40,
    originAt: STEP,
  };
  const structure = { currentPrice: 100, currentNatrPct: 1, nearestHigh: target, strongestHigh: target };
  const context = buildApproachCompressionResearchContext(path, structure, {
    currentPrice: 100,
    currentNatrPct: 1,
    lookbackBars: 12,
  });
  const row = context.targets[0];
  assert.equal(row.causalBasis, "ORIGIN_AT_FALLBACK");
  assert.equal(row.causalFromAt, STEP);
  assert.equal(row.sampleBars, 1);
  assert.equal(row.sampleState, "INSUFFICIENT");
  assert.equal(row.startGapNatr, null);
  assert.equal(row.nearBarsWindow, null);
  assert.equal(row.proximityGroups, null);
  assert.equal(row.closeBeyondBars, null);
  assert.equal(row.extremeBeyondBars, null);
});



test("V6.4 evidence vector reports observable facts without a combined score", () => {
  const context = buildApproachEvidenceResearchContext({
    state: "PATH_CONTEXT_AVAILABLE",
    timeframe: "5m",
    targets: [{
      side: "HIGH",
      targetPrice: 105,
      roles: ["QUALITY"],
      candidateState: "VISIBLE_MAP",
      sampleBars: 6,
      requestedLookbackBars: 12,
      currentDistanceNatr: 1.08,
      towardDelta3Natr: 0.26,
      towardDelta6Natr: 0.15,
      towardDelta12Natr: null,
      medianGapCompressionNatr: 0.05,
      progressionNatr: 0.10,
      progressionLabel: "HIGHER_FLOOR",
      nearBarsWindow: 0,
      proximityGroups: 0,
      closeBeyondBars: 0,
      extremeBeyondBars: 0,
      rangeContractionRatio3v3: 0.90,
    }],
  });
  assert.equal(context.state, "EVIDENCE_AVAILABLE");
  const row = context.targets[0];
  assert.equal(row.readiness, "OBSERVABLE_6B");
  assert.ok(row.facts.includes("TOWARD_3B"));
  assert.ok(row.facts.includes("TOWARD_6B"));
  assert.ok(row.facts.includes("MEDIAN_GAP_SHRINKING"));
  assert.ok(row.facts.includes("FLOOR_RISING"));
  assert.ok(row.facts.includes("RANGE_CONTRACTING"));
  assert.ok(row.facts.includes("NO_NEAR_ZONE"));
  assert.equal(Object.prototype.hasOwnProperty.call(row, "score"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "breakoutProbability"), false);
  assert.equal(row.researchOnly, true);
});

test("V6.4 keeps early samples explicitly early and does not invent unavailable facts", () => {
  const context = buildApproachEvidenceResearchContext({
    state: "PATH_CONTEXT_AVAILABLE",
    timeframe: "5m",
    targets: [{
      side: "LOW",
      targetPrice: 95,
      roles: ["NEAREST"],
      candidateState: "SOURCE_QUALIFIED_HIDDEN",
      sampleBars: 1,
      requestedLookbackBars: 12,
      currentDistanceNatr: 0.8,
      towardDelta3Natr: null,
      towardDelta6Natr: null,
      towardDelta12Natr: null,
      medianGapCompressionNatr: null,
      progressionNatr: null,
      progressionLabel: "LOWER_CEILING",
      nearBarsWindow: null,
      proximityGroups: null,
      closeBeyondBars: null,
      extremeBeyondBars: null,
      rangeContractionRatio3v3: null,
    }],
  });
  const row = context.targets[0];
  assert.equal(row.readiness, "INSUFFICIENT");
  assert.deepEqual(row.facts, []);
  assert.equal(row.researchOnly, true);
});



test("V6.5 stack route preserves ordered barrier geometry without a score", () => {
  const contexts = [
    { id: "h1", side: "HIGH", price: 101, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 20 }, relevance: { score: 50 } },
    { id: "h2", side: "HIGH", price: 103, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 40 }, relevance: { score: 30 } },
    { id: "h3", side: "HIGH", price: 103.5, currentPrice: 100, candidateState: "VISIBLE_MAP", quality: { score: 90 }, relevance: { score: 20 } },
    { id: "l1", side: "LOW", price: 98, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 30 }, relevance: { score: 35 } },
  ];
  const structure = buildLocalStructureResearchContext(contexts, { currentPrice: 100, currentNatrPct: 2 });
  const route = buildStackRouteResearchContext(structure);
  assert.equal(route.high.levelCount, 3);
  assert.deepEqual(route.high.levels.map((row) => row.price), [101, 103, 103.5]);
  assert.equal(route.high.currentToFirstNatr, 0.5);
  assert.equal(route.high.gaps[0].gapNatr, 1);
  assert.equal(route.high.gaps[1].gapNatr, 0.25);
  assert.equal(route.high.spanToLastNatr, 1.75);
  assert.equal(route.high.visibleCount, 1);
  assert.equal(route.high.shadowCount, 2);
  assert.equal(route.low.levelCount, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(route, "score"), false);
  assert.equal(route.researchOnly, true);
});

test("V6.5 approach evidence covers every level in the local stack and merges roles", () => {
  const path = Array.from({ length: 18 }, (_, index) => ({
    time: index * STEP,
    open: 100 + index * 0.05,
    high: 100.8 + index * 0.05,
    low: 99.2 + index * 0.05,
    close: 100 + index * 0.05,
  }));
  const mk = (id, price, candidateState = "SOURCE_QUALIFIED_HIDDEN") => ({
    id,
    side: "HIGH",
    price,
    candidateState,
    qualityScore: id === "h3" ? 90 : id === "h2" ? 40 : 20,
    relevanceScore: id === "h1" ? 50 : 25,
    originAt: STEP,
    confirmedAt: 2 * STEP - 1,
  });
  const h1 = mk("h1", 101);
  const h2 = mk("h2", 102);
  const h3 = mk("h3", 103, "VISIBLE_MAP");
  const structure = {
    currentPrice: path.at(-1).close,
    currentNatrPct: 1.5,
    nearestHigh: h1,
    strongestHigh: h3,
    highStack: [h1, h2, h3],
    lowStack: [],
  };
  const approach = buildApproachCompressionResearchContext(path, structure, { currentNatrPct: 1.5, lookbackBars: 12 });
  assert.equal(approach.targets.length, 3);
  const byPrice = new Map(approach.targets.map((row) => [row.targetPrice, row]));
  assert.deepEqual(byPrice.get(101).roles, ["NEAREST", "STACK"]);
  assert.deepEqual(byPrice.get(102).roles, ["STACK"]);
  assert.deepEqual(byPrice.get(103).roles, ["QUALITY", "STACK"]);
  const evidence = buildApproachEvidenceResearchContext(approach);
  assert.equal(evidence.targets.length, 3);
  assert.equal(evidence.targets.every((row) => row.researchOnly), true);
});
