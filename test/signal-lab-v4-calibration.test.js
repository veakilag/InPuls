import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCascadeCalibrationSample,
  CASCADE_CALIBRATION_CHECKS,
  CASCADE_CALIBRATION_CLASSES,
  CASCADE_CHECK_STATES,
  cascadeCalibrationCsvRow,
  normalizeCascadeCalibration,
  resolveCascadeMachineEvent,
  summarizeCascadeCalibration,
} from "../signal-lab-v4-calibration.js";

function checks(state = CASCADE_CHECK_STATES.PASS) {
  return Object.fromEntries(CASCADE_CALIBRATION_CHECKS.map((key) => [key, state]));
}

function episode(overrides = {}) {
  const machine = {
    id: "cascade-1",
    formulaVersion: "signal-lab-v4-cascade-v1-2026-08",
    state: "CONFIRMED",
    geometricState: "CONFIRMED",
    direction: "UP",
    setupDetectedAt: 1_000,
    triggeredAt: 2_000,
    confirmedAt: 3_000,
    completedAt: 3_000,
    failedAt: null,
    levelIds: ["h1", "h2"],
    levelPrices: [100, 102],
    touchCounts: [2, 1],
    adjacentGapPct: [2],
    totalSpanPct: 2,
    levelsBroken: 2,
    variants: ["MULTI_TOUCH_LEVEL"],
    failureReasons: [],
    dataQuality: "LIVE",
    anchors: {
      setup: { outcomes: { "15s": { state: "OBSERVED" }, "1m": { state: "OBSERVED" } } },
      trigger: { outcomes: { "15s": { state: "OBSERVED" }, "1m": { state: "OBSERVED" } } },
      confirm: { outcomes: { "15s": { state: "OBSERVED" }, "1m": { state: "OBSERVED" } } },
      complete: null,
    },
  };
  return {
    id: "episode-1",
    symbol: "TESTUSDT",
    candidateType: "cascade_v4_up",
    direction: "up",
    firstSeenAt: 1_000,
    lastSeenAt: 4_000,
    reviewState: "valid",
    latest: {
      evidence: { cascadeV4: machine },
      quality: { state: "LIVE" },
    },
    evidencePack: {
      coverage: {
        pricePoints: 100,
        bookSnapshots: 10,
        trades: 80,
        depthDiffs: 120,
        activeLevelZones: 2,
        activeBreakoutEvents: 2,
        activeCascadeEvents: 1,
      },
      cascadeMapLatest: { history: [machine], active: [machine] },
    },
    review: {
      verdict: "valid",
      finalPatternId: "cascade_breakout",
      errorLabels: [],
      calibration: {
        classification: CASCADE_CALIBRATION_CLASSES.CANONICAL,
        confidence: 5,
        checks: checks(),
        corrections: {},
        reasonCodes: [],
      },
    },
    ...overrides,
  };
}

test("normalizes calibration class, checks, corrections and reason codes", () => {
  const review = normalizeCascadeCalibration({
    classification: "canonical",
    confidence: 8,
    checks: { EXTREMES_CORRECT: "pass", LEVEL_ZONES_CORRECT: "fail" },
    corrections: {
      direction: "down",
      expectedState: "failed",
      levelCount: 20,
      levelPrices: "100, 98; 96",
      touchCounts: "2 3 1",
      note: "manual correction",
    },
    reasonCodes: ["LEVEL_COUNT_WRONG", "unknown", "LEVEL_COUNT_WRONG"],
  }, 10_000);
  assert.equal(review.classification, "canonical");
  assert.equal(review.confidence, 5);
  assert.equal(review.checks.EXTREMES_CORRECT, "pass");
  assert.equal(review.checks.LEVEL_ZONES_CORRECT, "fail");
  assert.equal(review.checks.TRIGGER_CORRECT, "unknown");
  assert.equal(review.corrections.direction, "DOWN");
  assert.equal(review.corrections.expectedState, "FAILED");
  assert.equal(review.corrections.levelCount, 12);
  assert.deepEqual(review.corrections.levelPrices, [100, 98, 96]);
  assert.deepEqual(review.corrections.touchCounts, [2, 3, 1]);
  assert.deepEqual(review.reasonCodes, ["LEVEL_COUNT_WRONG"]);
  assert.equal(review.updatedAt, 10_000);
});

test("resolves final machine event from latest evidence history", () => {
  const row = episode();
  row.evidencePack.cascadeMapLatest.history = [{
    ...row.latest.evidence.cascadeV4,
    state: "EXTENDED",
    levelIds: ["h1", "h2", "h3"],
  }];
  assert.equal(resolveCascadeMachineEvent(row).state, "EXTENDED");
});

test("canonical fully checked live episode is eligible for geometry and outcomes", () => {
  const sample = buildCascadeCalibrationSample(episode(), 5_000);
  assert.ok(sample);
  assert.equal(sample.geometryEligible, true);
  assert.equal(sample.outcomeEligible, true);
  assert.deepEqual(sample.blockers, []);
  assert.equal(sample.machine.state, "CONFIRMED");
  assert.equal(sample.machine.levelPrices.length, 2);
});

test("unknown required check blocks geometry calibration", () => {
  const row = episode();
  row.review.calibration.checks = { ...checks(), TRIGGER_CORRECT: "unknown" };
  const sample = buildCascadeCalibrationSample(row);
  assert.equal(sample.geometryEligible, false);
  assert.ok(sample.blockers.includes("CHECK_UNKNOWN_TRIGGER_CORRECT"));
});

test("GAP and look-ahead flags are explicit blockers", () => {
  const row = episode();
  row.latest.evidence.cascadeV4 = { ...row.latest.evidence.cascadeV4, dataQuality: "GAP" };
  row.evidencePack.cascadeMapLatest.history = [row.latest.evidence.cascadeV4];
  row.review.errorLabels = ["LOOKAHEAD_ERROR"];
  const sample = buildCascadeCalibrationSample(row);
  assert.ok(sample.blockers.includes("QUALITY_GAP"));
  assert.ok(sample.blockers.includes("LOOKAHEAD_FLAG"));
  assert.equal(sample.geometryEligible, false);
});

test("false sample remains useful when explicitly reviewed and data is sufficient", () => {
  const row = episode();
  row.review.verdict = "false_positive";
  row.review.calibration.classification = "false";
  row.review.calibration.checks = { ...checks(), TRIGGER_CORRECT: "fail" };
  row.review.calibration.reasonCodes = ["TRIGGER_EARLY"];
  const sample = buildCascadeCalibrationSample(row);
  assert.equal(sample.geometryEligible, true);
  assert.equal(sample.calibration.classification, "false");
  assert.deepEqual(sample.calibration.reasonCodes, ["TRIGGER_EARLY"]);
});

test("ambiguous and unavailable classes cannot enter threshold calibration", () => {
  for (const classification of ["ambiguous", "unavailable"]) {
    const row = episode();
    row.review.calibration.classification = classification;
    const sample = buildCascadeCalibrationSample(row);
    assert.equal(sample.geometryEligible, false);
    assert.ok(sample.blockers.some((value) => value.includes(classification.toUpperCase())));
  }
});

test("summary reports observations and eligibility without calling it win rate", () => {
  const canonical = episode();
  const weak = episode({ id: "episode-2" });
  weak.review.calibration.classification = "weak";
  const unavailable = episode({ id: "episode-3" });
  unavailable.review.calibration.classification = "unavailable";
  const summary = summarizeCascadeCalibration([canonical, weak, unavailable]);
  assert.equal(summary.episodes, 3);
  assert.equal(summary.reviewed, 3);
  assert.equal(summary.canonical, 1);
  assert.equal(summary.weak, 1);
  assert.equal(summary.unavailable, 1);
  assert.equal(summary.geometryEligible, 2);
  assert.equal(summary.outcomeEligible, 2);
  assert.equal(summary.byMachineState.CONFIRMED, 3);
});

test("CSV row contains machine and human labels separately", () => {
  const row = cascadeCalibrationCsvRow(episode());
  assert.equal(row.machineState, "CONFIRMED");
  assert.equal(row.machineLevelCount, 2);
  assert.equal(row.calibrationClass, "canonical");
  assert.equal(row.geometryEligible, "yes");
  assert.match(row.calibrationChecks, /SETUP_BEFORE_TRIGGER:pass/);
});
