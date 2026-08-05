import test from "node:test";
import assert from "node:assert/strict";

import {
  CandidateEpisodeTracker,
  CANDIDATE_TYPES,
  detectExpertCandidates,
  isEligibleForSignalLabV3,
  SIGNAL_LAB_V3_FORMULA_VERSION,
} from "../signal-lab-v3-candidates.js";
import { rowsToCsv, SignalLabV3Store } from "../signal-lab-v3-store.js";

function baseMetrics(overrides = {}) {
  return {
    symbol: "TESTUSDT",
    price: 100,
    updatedAt: 100_000,
    quoteVolume24h: 150_000_000,
    turnoverPerMinute: 500_000,
    warmupSeconds: 120,
    change15s: 0,
    change1m: 0,
    change5m: 0,
    volumeBoost: 1.5,
    natr1m: 0.8,
    natr5m: 1.2,
    range60s: { min: 99.8, max: 100.2, percent: 0.4 },
    range5m: { min: 98, max: 102, percent: 4 },
    trades: { tps: 2, buy: 60_000, sell: 40_000, buyShare: 60 },
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

function breakoutCandles() {
  return [
    { time: 1, open: 99.3, high: 99.7, low: 99.1, close: 99.5 },
    { time: 2, open: 99.5, high: 100, low: 99.4, close: 99.7 },
    { time: 3, open: 99.7, high: 99.8, low: 99.3, close: 99.5 },
    { time: 4, open: 99.5, high: 99.96, low: 99.4, close: 99.7 },
    { time: 5, open: 99.7, high: 99.82, low: 99.5, close: 99.6 },
    { time: 6, open: 99.6, high: 99.9, low: 99.5, close: 99.8 },
    { time: 7, open: 99.8, high: 99.92, low: 99.7, close: 99.88 },
    { time: 8, open: 99.88, high: 99.91, low: 99.8, close: 99.9 },
  ];
}

function cascadeCandles() {
  const highs = [99, 100, 99.5, 101, 100.5, 102, 101.5, 101.95];
  return highs.map((high, index) => ({
    time: index + 1,
    open: high - 0.4,
    high,
    low: high - 0.8,
    close: high - 0.2,
  }));
}

function types(rows) {
  return new Set(rows.map((row) => row.candidateType));
}

test("eligibility is strictly above $100m quote volume and NATR5 above 1%", () => {
  assert.equal(isEligibleForSignalLabV3(baseMetrics()), true);
  assert.equal(isEligibleForSignalLabV3(baseMetrics({ quoteVolume24h: 100_000_000 })), false);
  assert.equal(isEligibleForSignalLabV3(baseMetrics({ quoteVolume24h: 99_999_999 })), false);
  assert.equal(isEligibleForSignalLabV3(baseMetrics({ natr5m: 1 })), false);
  assert.equal(isEligibleForSignalLabV3(baseMetrics({ natr5m: 0.99 })), false);
  assert.equal(isEligibleForSignalLabV3(baseMetrics({ natr5m: null })), false);
});

test("a generic impulse no longer creates a standalone episode", () => {
  const rows = detectExpertCandidates(baseMetrics({
    change15s: 0.9,
    range60s: { min: 99, max: 101, percent: 2 },
    minuteCandles: [],
  }), 100_000);
  assert.deepEqual(rows, []);
});

test("repeated level creates one breakout candidate that evolves from forming to triggered", () => {
  const forming = detectExpertCandidates(baseMetrics({
    price: 99.9,
    minuteCandles: breakoutCandles(),
  }), 100_000).find((row) => row.candidateType === CANDIDATE_TYPES.BREAKOUT_UP);
  assert.ok(forming);
  assert.equal(forming.stage, "forming");
  assert.deepEqual(forming.patternHypotheses, ["level_breakout"]);

  const triggered = detectExpertCandidates(baseMetrics({
    price: 100.15,
    minuteCandles: breakoutCandles(),
  }), 100_000).find((row) => row.candidateType === CANDIDATE_TYPES.BREAKOUT_UP);
  assert.ok(triggered);
  assert.equal(triggered.stage, "triggered");
  assert.equal(triggered.evidence.possibleReactionPattern, "sharpening_rejection");
});

test("three ordered extrema create only a cascade candidate", () => {
  const rows = detectExpertCandidates(baseMetrics({
    price: 101.95,
    minuteCandles: cascadeCandles(),
  }), 100_000);
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.CASCADE_UP);
  assert.ok(item);
  assert.equal(item.evidence.extremaCount, 3);
  assert.ok(item.evidence.zoneWidthPercent >= 1);
  assert.deepEqual(item.patternHypotheses, ["cascade_breakout"]);
});

test("sharpening records a level breakout as the origin of the reverse move", () => {
  const rows = detectExpertCandidates(baseMetrics({
    price: 100.35,
    minuteCandles: breakoutCandles(),
    priceHistory: [
      { at: 30_000, price: 99.5 },
      { at: 50_000, price: 99.7 },
      { at: 75_000, price: 100.1 },
      { at: 85_000, price: 100.8 },
      { at: 92_000, price: 100.55 },
      { at: 100_000, price: 100.35 },
    ],
  }), 100_000);
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.SHARPENING);
  assert.ok(item);
  assert.ok(item.evidence.originPatterns.includes("level_breakout"));
  assert.deepEqual(item.patternHypotheses, ["sharpening_rejection"]);
});

test("knife may follow a strong impulse even when no breakout structure is proven", () => {
  const rows = detectExpertCandidates(baseMetrics({
    price: 99.55,
    priceHistory: [
      { at: 30_000, price: 100.4 },
      { at: 50_000, price: 100.2 },
      { at: 75_000, price: 99.8 },
      { at: 85_000, price: 99.1 },
      { at: 92_000, price: 99.3 },
      { at: 100_000, price: 99.55 },
    ],
  }), 100_000);
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.KNIFE);
  assert.ok(item);
  assert.deepEqual(item.evidence.originPatterns, ["strong_impulse"]);
  assert.deepEqual(item.patternHypotheses, ["knife_reclaim"]);
});

test("detector emits only breakout, cascade, knife and sharpening types", () => {
  const allowed = new Set([
    CANDIDATE_TYPES.KNIFE,
    CANDIDATE_TYPES.SHARPENING,
    CANDIDATE_TYPES.BREAKOUT_UP,
    CANDIDATE_TYPES.BREAKOUT_DOWN,
    CANDIDATE_TYPES.CASCADE_UP,
    CANDIDATE_TYPES.CASCADE_DOWN,
  ]);
  const rows = [
    ...detectExpertCandidates(baseMetrics({ price: 100.15, minuteCandles: breakoutCandles() }), 100_000),
    ...detectExpertCandidates(baseMetrics({ price: 101.95, minuteCandles: cascadeCandles() }), 100_000),
  ];
  assert.ok(rows.length > 0);
  assert.equal(rows.every((row) => allowed.has(row.candidateType)), true);
  assert.equal(rows.every((row) => row.formulaVersion === SIGNAL_LAB_V3_FORMULA_VERSION), true);
});

test("episode tracker updates one pattern episode instead of creating duplicate cards", () => {
  const tracker = new CandidateEpisodeTracker();
  const metrics = baseMetrics({ price: 100.15, minuteCandles: breakoutCandles() });
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

test("candidate output contains eligibility facts but no trade command", () => {
  const rows = detectExpertCandidates(baseMetrics({ price: 100.15, minuteCandles: breakoutCandles() }), 100_000);
  const text = JSON.stringify(rows).toLowerCase();
  assert.match(text, /natr5/);
  assert.equal(text.includes("покупай"), false);
  assert.equal(text.includes("продавай"), false);
  assert.equal(text.includes("гарант"), false);
});

test("V3 store works in memory mode and preserves four-pattern manual review", async () => {
  const store = new SignalLabV3Store({ indexedDB: null });
  const status = await store.initialize();
  assert.equal(status.mode, "memory");
  await store.upsertEpisodes([{
    id: "episode-1",
    symbol: "TESTUSDT",
    candidateType: CANDIDATE_TYPES.KNIFE,
    label: "Нож",
    direction: "up",
    stage: "forming",
    firstSeenAt: 100,
    lastSeenAt: 110,
    observations: 2,
    peakEvidenceScore: 70,
    latest: {
      facts: ["вынос вниз -0.8%"],
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
