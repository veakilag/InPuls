import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SignalLabV3Store } from "../signal-lab-v3-store.js";

const page = fs.readFileSync(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
const owner = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");

function allChecks(value = "pass") {
  return Object.fromEntries([
    "EXTREMES_CORRECT",
    "LEVEL_ZONES_CORRECT",
    "TOUCH_COUNT_CORRECT",
    "SETUP_BEFORE_TRIGGER",
    "LEVEL_ORDER_CORRECT",
    "TRIGGER_CORRECT",
    "CONFIRMATION_CORRECT",
    "INVALIDATION_CORRECT",
    "NO_LOOKAHEAD",
    "OUTCOMES_SUFFICIENT",
  ].map((key) => [key, value]));
}

test("owner page exposes machine-versus-human cascade calibration", () => {
  assert.match(page, /Калибровка каскада V4/);
  assert.match(page, /data-calibration-check="EXTREMES_CORRECT"/);
  assert.match(page, /data-calibration-check="SETUP_BEFORE_TRIGGER"/);
  assert.match(page, /data-calibration-check="NO_LOOKAHEAD"/);
  assert.match(page, /export-calibration/);
  assert.match(page, /signal-lab-v4-stage4/);
});

test("owner runtime stores, filters and exports calibration samples", () => {
  assert.match(owner, /readCascadeCalibration/);
  assert.match(owner, /bindCascadeCalibration/);
  assert.match(owner, /summarizeCascadeCalibration/);
  assert.match(owner, /geometryEligible/);
  assert.match(owner, /exportCalibration/);
});

test("memory store persists nested calibration and exposes it in CSV rows", async () => {
  const store = new SignalLabV3Store({ indexedDB: null });
  await store.initialize();
  const machine = {
    id: "cascade-1",
    formulaVersion: "signal-lab-v4-cascade-v1-2026-08",
    state: "CONFIRMED",
    geometricState: "CONFIRMED",
    direction: "UP",
    setupDetectedAt: 1_000,
    triggeredAt: 2_000,
    confirmedAt: 3_000,
    levelIds: ["h1", "h2"],
    levelPrices: [100, 102],
    touchCounts: [2, 1],
    adjacentGapPct: [2],
    dataQuality: "LIVE",
    anchors: {},
  };
  await store.upsertEpisodes([{
    id: "episode-1",
    symbol: "TESTUSDT",
    candidateType: "cascade_v4_up",
    label: "Каскад V4 вверх",
    direction: "up",
    stage: "triggered",
    firstSeenAt: 1_000,
    lastSeenAt: 4_000,
    observations: 3,
    peakEvidenceScore: 80,
    latest: { evidence: { cascadeV4: machine }, quality: { state: "LIVE" } },
    evidencePack: { cascadeMapLatest: { history: [machine] }, coverage: {} },
  }]);
  await store.saveReview("episode-1", {
    verdict: "valid",
    finalPatternId: "cascade_breakout",
    calibration: {
      classification: "canonical",
      confidence: 5,
      checks: allChecks(),
      corrections: {},
      reasonCodes: [],
    },
  });
  const [row] = await store.list({ limit: 10 });
  assert.equal(row.review.calibration.classification, "canonical");
  assert.equal(row.review.calibration.checks.NO_LOOKAHEAD, "pass");
  const [csv] = await store.exportRows({ limit: 10 });
  assert.equal(csv.machineState, "CONFIRMED");
  assert.equal(csv.calibrationClass, "canonical");
  assert.equal(csv.geometryEligible, "yes");
});
