import test from "node:test";
import assert from "node:assert/strict";

import {
  CandidateEpisodeTracker,
  CANDIDATE_TYPES,
  detectExpertCandidates,
  SIGNAL_LAB_V3_FORMULA_VERSION,
} from "../signal-lab-v3-candidates.js";
import { rowsToCsv, SignalLabV3Store } from "../signal-lab-v3-store.js";

function baseMetrics(overrides = {}) {
  return {
    symbol: "TESTUSDT",
    price: 100,
    updatedAt: 100_000,
    quoteVolume24h: 50_000_000,
    turnoverPerMinute: 100_000,
    warmupSeconds: 120,
    change15s: 0,
    change1m: 0,
    change5m: 0,
    volumeBoost: 1,
    natr1m: 0.25,
    natr5m: 0.4,
    range60s: { min: 99.9, max: 100.1, percent: 0.2 },
    range5m: { min: 99, max: 101, percent: 2 },
    trades: { tps: 0, buy: 0, sell: 0, buyShare: null },
    liquidation: { longs: 0, shorts: 0, total: 0 },
    priceHistory: [
      { at: 40_000, price: 100 },
      { at: 60_000, price: 100 },
      { at: 80_000, price: 100 },
      { at: 100_000, price: 100 },
    ],
    minuteCandles: [],
    ...overrides,
  };
}

function types(rows) {
  return new Set(rows.map((row) => row.candidateType));
}

test("candidate-first engine ignores unprepared or illiquid symbols", () => {
  assert.deepEqual(detectExpertCandidates(baseMetrics({ warmupSeconds: 10 }), 100_000), []);
  assert.deepEqual(detectExpertCandidates(baseMetrics({ quoteVolume24h: 1_000_000 }), 100_000), []);
});

test("relative displacement threshold collects a broad market episode without declaring a final pattern", () => {
  const rows = detectExpertCandidates(baseMetrics({
    change15s: 0.2,
    volumeBoost: 1.2,
    range60s: { min: 99.8, max: 100.2, percent: 0.4 },
  }), 100_000);
  assert.ok(types(rows).has(CANDIDATE_TYPES.UP_DISPLACEMENT));
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.UP_DISPLACEMENT);
  assert.ok(item.patternHypotheses.includes("sharpening_rejection"));
  assert.ok(item.patternHypotheses.includes("continuation_breakout"));
  assert.equal(item.quality.limitations.includes("candidate-not-trade-signal"), true);
  assert.equal(item.formulaVersion, SIGNAL_LAB_V3_FORMULA_VERSION);
});

test("high-volatility symbol requires a larger displacement than a quiet symbol", () => {
  const quiet = detectExpertCandidates(baseMetrics({ natr1m: 0.12, change15s: 0.13 }), 100_000);
  const volatile = detectExpertCandidates(baseMetrics({ natr1m: 0.8, change15s: 0.2 }), 100_000);
  assert.ok(types(quiet).has(CANDIDATE_TYPES.UP_DISPLACEMENT));
  assert.equal(types(volatile).has(CANDIDATE_TYPES.UP_DISPLACEMENT), false);
});

test("fast reclaim is stored as a reversal attempt, not as a proven knife", () => {
  const rows = detectExpertCandidates(baseMetrics({
    price: 99.75,
    priceHistory: [
      { at: 30_000, price: 100 },
      { at: 50_000, price: 100 },
      { at: 75_000, price: 99.8 },
      { at: 85_000, price: 99.5 },
      { at: 92_000, price: 99.62 },
      { at: 100_000, price: 99.75 },
    ],
  }), 100_000);
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.DOWN_REVERSAL_ATTEMPT);
  assert.ok(item);
  assert.equal(item.stage, "forming");
  assert.ok(item.patternHypotheses.includes("knife_reclaim"));
  assert.ok(item.quality.limitations.includes("reversal-needs-flow-or-liquidity-confirmation"));
});

test("two independent tests create a level-pressure candidate before breakout", () => {
  const candles = [
    { time: 1, open: 99.3, high: 99.7, low: 99.1, close: 99.5 },
    { time: 2, open: 99.5, high: 100, low: 99.4, close: 99.7 },
    { time: 3, open: 99.7, high: 99.8, low: 99.3, close: 99.5 },
    { time: 4, open: 99.5, high: 99.96, low: 99.4, close: 99.7 },
    { time: 5, open: 99.7, high: 99.82, low: 99.5, close: 99.6 },
    { time: 6, open: 99.6, high: 99.9, low: 99.5, close: 99.8 },
    { time: 7, open: 99.8, high: 99.92, low: 99.7, close: 99.88 },
    { time: 8, open: 99.88, high: 99.91, low: 99.8, close: 99.9 },
  ];
  const rows = detectExpertCandidates(baseMetrics({ price: 99.9, minuteCandles: candles }), 100_000);
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.LEVEL_PRESSURE_UP);
  assert.ok(item);
  assert.equal(item.stage, "forming");
  assert.ok(item.evidence.touchCount >= 2);
  assert.ok(item.quality.limitations.includes("touches-are-geometric-evidence-not-proof-of-stop-liquidity"));
});

test("three ordered extrema are collected as a cascade structure before final confirmation", () => {
  const highs = [99, 100, 99.5, 101, 100.5, 102, 101.5, 101.95];
  const candles = highs.map((high, index) => ({
    time: index + 1,
    open: high - 0.4,
    high,
    low: high - 0.8,
    close: high - 0.2,
  }));
  const rows = detectExpertCandidates(baseMetrics({ price: 101.95, minuteCandles: candles }), 100_000);
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.CASCADE_STRUCTURE_UP);
  assert.ok(item);
  assert.equal(item.evidence.extremaCount, 3);
  assert.ok(item.evidence.zoneWidthPercent >= 0.5);
  assert.ok(item.quality.limitations.includes("follow-through-not-confirmed-at-candidate-stage"));
});

test("trade acceleration and aggressor imbalance create participant evidence without identifying a player", () => {
  const rows = detectExpertCandidates(baseMetrics({
    volumeBoost: 1.8,
    trades: { tps: 4.2, buy: 80_000, sell: 20_000, buyShare: 80 },
  }), 100_000);
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.FLOW_ACCELERATION_UP);
  assert.ok(item);
  assert.ok(item.patternHypotheses.includes("participant_activity"));
  assert.ok(item.quality.limitations.includes("aggregated-trade-flow-does-not-identify-a-participant"));
});

test("displayed size is evidence with explicit intent limitation", () => {
  const rows = detectExpertCandidates(baseMetrics({
    bookCandidate: {
      side: "bid",
      price: 99.9,
      quoteUsd: 120_000,
      baselineQuoteUsd: 20_000,
      sizeMultiple: 6,
      touchCount: 3,
      moved: true,
      observedAt: 99_900,
    },
  }), 100_000);
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.LIQUIDITY_EVENT_BID);
  assert.ok(item);
  assert.ok(item.patternHypotheses.includes("liquidity_rearrangement"));
  assert.ok(item.quality.limitations.includes("displayed-liquidity-does-not-prove-intent"));
});

test("episode tracker updates one market episode instead of creating duplicate cards", () => {
  const tracker = new CandidateEpisodeTracker();
  const metrics = baseMetrics({ change15s: 0.25 });
  const first = tracker.ingest([metrics], 100_000);
  const second = tracker.ingest([metrics], 101_000);
  assert.ok(first.created.length >= 1);
  assert.equal(second.created.length, 0);
  assert.ok(second.updated.length >= 1);
  assert.equal(second.updated[0].id, first.created[0].id);
  const expired = tracker.ingest([], 130_000);
  assert.ok(expired.expired.length >= 1);
  assert.equal(expired.expired[0].stage, "completed");
});

test("candidate output contains facts and limitations but no trade command", () => {
  const rows = detectExpertCandidates(baseMetrics({ change15s: -0.3 }), 100_000);
  const text = JSON.stringify(rows).toLowerCase();
  assert.equal(text.includes("покупай"), false);
  assert.equal(text.includes("продавай"), false);
  assert.equal(text.includes("гарант"), false);
});

test("V3 store works in memory mode and preserves manual review", async () => {
  const store = new SignalLabV3Store({ indexedDB: null });
  const status = await store.initialize();
  assert.equal(status.mode, "memory");
  await store.upsertEpisodes([{
    id: "episode-1",
    symbol: "TESTUSDT",
    candidateType: "down_reversal_attempt",
    label: "Попытка выкупа",
    direction: "up",
    stage: "forming",
    firstSeenAt: 100,
    lastSeenAt: 110,
    observations: 2,
    peakEvidenceScore: 70,
    latest: {
      facts: ["вынос вниз 0.5%"],
      patternHypotheses: ["knife_reclaim"],
      formulaVersion: SIGNAL_LAB_V3_FORMULA_VERSION,
      quality: { state: "live", limitations: ["candidate-not-trade-signal"] },
    },
  }]);
  await store.saveReview("episode-1", {
    verdict: "valid",
    finalPatternId: "knife_reclaim",
    comment: "Есть остановка и быстрый возврат",
  }, 200);
  const [row] = await store.list();
  assert.equal(row.reviewState, "valid");
  assert.equal(row.review.finalPatternId, "knife_reclaim");
  const exported = await store.exportRows();
  assert.equal(exported[0].comment, "Есть остановка и быстрый возврат");
  assert.match(rowsToCsv(exported), /episode-1/);
});
