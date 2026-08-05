export const SIGNAL_LAB_V4_CALIBRATION_VERSION = "signal-lab-v4-cascade-calibration-v1-2026-08";

export const CASCADE_CALIBRATION_CLASSES = Object.freeze({
  CANONICAL: "canonical",
  WEAK: "weak",
  FALSE: "false",
  AMBIGUOUS: "ambiguous",
  UNAVAILABLE: "unavailable",
});

export const CASCADE_CALIBRATION_CHECKS = Object.freeze([
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
]);

export const CASCADE_CHECK_STATES = Object.freeze({
  UNKNOWN: "unknown",
  PASS: "pass",
  FAIL: "fail",
  UNAVAILABLE: "unavailable",
});

export const CASCADE_REASON_CODES = Object.freeze([
  "PRIMARY_LEVEL_WRONG",
  "LEVEL_COUNT_WRONG",
  "LEVEL_ORDER_WRONG",
  "LEVEL_GAPS_WRONG",
  "TOUCH_COUNT_WRONG",
  "SETUP_LATE",
  "SETUP_TOO_EARLY",
  "TRIGGER_EARLY",
  "TRIGGER_LATE",
  "CONFIRM_EARLY",
  "CONFIRM_LATE",
  "FAILURE_REASON_WRONG",
  "DUPLICATE_EVENT",
  "DATA_GAP",
  "INSUFFICIENT_CONTEXT",
  "WRONG_DIRECTION",
  "OTHER",
]);

const CASCADE_MACHINE_STATES = new Set([
  "SETUP",
  "TRIGGERED",
  "CONFIRMED",
  "EXTENDED",
  "PARTIAL",
  "FAILED",
]);

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const safeText = (value, maximum = 500) => String(value ?? "").trim().slice(0, maximum);
const unique = (rows) => [...new Set(rows)];

function normalizeCheckState(value) {
  const state = safeText(value, 24).toLowerCase();
  return Object.values(CASCADE_CHECK_STATES).includes(state) ? state : CASCADE_CHECK_STATES.UNKNOWN;
}

function normalizeDirection(value) {
  const direction = safeText(value, 12).toUpperCase();
  return direction === "UP" || direction === "DOWN" ? direction : null;
}

function normalizeMachineState(value) {
  const state = safeText(value, 24).toUpperCase();
  return CASCADE_MACHINE_STATES.has(state) ? state : null;
}

function normalizeNumbers(values, maximum = 12) {
  const source = Array.isArray(values)
    ? values
    : safeText(values, 500).split(/[;,\s]+/g);
  return source
    .map(finite)
    .filter((value) => value !== null && value > 0)
    .slice(0, maximum);
}

function normalizeIntegers(values, maximum = 12) {
  return normalizeNumbers(values, maximum).map((value) => Math.max(1, Math.round(value)));
}

export function normalizeCascadeCalibration(calibration = {}, now = Date.now()) {
  const allowedClasses = new Set(Object.values(CASCADE_CALIBRATION_CLASSES));
  const classification = safeText(calibration.classification ?? calibration.class, 24).toLowerCase();
  const checks = {};
  for (const key of CASCADE_CALIBRATION_CHECKS) {
    checks[key] = normalizeCheckState(calibration?.checks?.[key]);
  }
  const confidence = Math.max(1, Math.min(5, Math.round(finite(calibration.confidence) ?? 3)));
  const levelCount = finite(calibration?.corrections?.levelCount);
  return Object.freeze({
    schemaVersion: 1,
    entity: "SignalLabCascadeCalibrationReview",
    formulaVersion: SIGNAL_LAB_V4_CALIBRATION_VERSION,
    classification: allowedClasses.has(classification) ? classification : null,
    confidence,
    checks: Object.freeze(checks),
    corrections: Object.freeze({
      direction: normalizeDirection(calibration?.corrections?.direction),
      expectedState: normalizeMachineState(calibration?.corrections?.expectedState),
      levelCount: levelCount === null ? null : Math.max(2, Math.min(12, Math.round(levelCount))),
      levelPrices: Object.freeze(normalizeNumbers(calibration?.corrections?.levelPrices)),
      touchCounts: Object.freeze(normalizeIntegers(calibration?.corrections?.touchCounts)),
      note: safeText(calibration?.corrections?.note, 1_000),
    }),
    reasonCodes: Object.freeze(unique((Array.isArray(calibration.reasonCodes) ? calibration.reasonCodes : [])
      .map((value) => safeText(value, 48).toUpperCase())
      .filter((value) => CASCADE_REASON_CODES.includes(value))).slice(0, 16)),
    updatedAt: finite(calibration.updatedAt) ?? now,
  });
}

export function isCascadeV4Episode(episode) {
  return ["cascade_v4_up", "cascade_v4_down"].includes(episode?.candidateType)
    || Boolean(episode?.latest?.evidence?.cascadeV4)
    || Boolean(episode?.evidencePack?.cascadeMapLatest)
    || Boolean(episode?.evidencePack?.cascadeMap);
}

export function resolveCascadeMachineEvent(episode) {
  const initial = episode?.latest?.evidence?.cascadeV4 ?? null;
  const id = safeText(initial?.id, 240);
  const map = episode?.evidencePack?.cascadeMapLatest ?? episode?.evidencePack?.cascadeMap ?? null;
  const history = Array.isArray(map?.history) ? map.history : [];
  const active = Array.isArray(map?.active) ? map.active : [];
  if (id) {
    const latest = [...history, ...active].find((event) => event?.id === id);
    if (latest) return latest;
  }
  return initial ?? history.at(-1) ?? active.at(-1) ?? null;
}

function outcomeCoverage(machineEvent) {
  const anchors = machineEvent?.anchors ?? {};
  const anchorNames = ["setup", "trigger", "confirm", "complete"];
  const horizons = ["15s", "1m", "3m", "5m"];
  const coverage = {};
  for (const anchorName of anchorNames) {
    const outcomes = anchors?.[anchorName]?.outcomes ?? {};
    coverage[anchorName] = Object.fromEntries(horizons.map((horizon) => [
      horizon,
      outcomes?.[horizon]?.state ?? "MISSING",
    ]));
  }
  return coverage;
}

function qualityState(episode, machineEvent) {
  return safeText(
    machineEvent?.dataQuality
      ?? episode?.latest?.quality?.state
      ?? episode?.evidencePack?.quality?.state
      ?? "UNKNOWN",
    24,
  ).toUpperCase();
}

function calibrationBlockers(episode, calibration, machineEvent) {
  const blockers = [];
  if (!isCascadeV4Episode(episode)) blockers.push("NOT_CASCADE_V4");
  if (!machineEvent) blockers.push("MISSING_MACHINE_EVENT");
  if (!calibration.classification) blockers.push("CLASS_NOT_SET");
  if (calibration.classification === CASCADE_CALIBRATION_CLASSES.AMBIGUOUS) blockers.push("AMBIGUOUS_CLASS");
  if (calibration.classification === CASCADE_CALIBRATION_CLASSES.UNAVAILABLE) blockers.push("UNAVAILABLE_CLASS");
  const quality = qualityState(episode, machineEvent);
  if (["GAP", "STALE", "ERROR"].includes(quality)) blockers.push(`QUALITY_${quality}`);
  if ((episode?.review?.errorLabels ?? []).includes("LOOKAHEAD_ERROR")) blockers.push("LOOKAHEAD_FLAG");
  for (const key of CASCADE_CALIBRATION_CHECKS.filter((value) => value !== "OUTCOMES_SUFFICIENT")) {
    const state = calibration.checks[key];
    if (state === CASCADE_CHECK_STATES.UNKNOWN) blockers.push(`CHECK_UNKNOWN_${key}`);
    if (state === CASCADE_CHECK_STATES.UNAVAILABLE) blockers.push(`CHECK_UNAVAILABLE_${key}`);
  }
  return unique(blockers);
}

export function buildCascadeCalibrationSample(episode, now = Date.now()) {
  if (!isCascadeV4Episode(episode)) return null;
  const calibration = normalizeCascadeCalibration(episode?.review?.calibration ?? {}, now);
  const machineEvent = resolveCascadeMachineEvent(episode);
  const blockers = calibrationBlockers(episode, calibration, machineEvent);
  const outcomeState = calibration.checks.OUTCOMES_SUFFICIENT;
  const geometryEligible = blockers.length === 0;
  const outcomeEligible = geometryEligible && outcomeState === CASCADE_CHECK_STATES.PASS;
  return Object.freeze({
    schemaVersion: 1,
    entity: "SignalLabCascadeCalibrationSample",
    formulaVersion: SIGNAL_LAB_V4_CALIBRATION_VERSION,
    exportedAt: now,
    episodeId: safeText(episode?.id ?? episode?.episodeId, 240),
    symbol: safeText(episode?.symbol, 32).toUpperCase(),
    candidateType: safeText(episode?.candidateType, 80),
    direction: episode?.direction ?? null,
    firstSeenAt: finite(episode?.firstSeenAt),
    lastSeenAt: finite(episode?.lastSeenAt),
    reviewVerdict: episode?.review?.verdict ?? episode?.reviewState ?? "unreviewed",
    finalPatternId: episode?.review?.finalPatternId ?? null,
    calibration,
    machine: machineEvent ? Object.freeze({
      id: machineEvent.id ?? null,
      formulaVersion: machineEvent.formulaVersion ?? null,
      state: machineEvent.state ?? null,
      geometricState: machineEvent.geometricState ?? null,
      direction: machineEvent.direction ?? null,
      setupDetectedAt: finite(machineEvent.setupDetectedAt),
      triggeredAt: finite(machineEvent.triggeredAt),
      confirmedAt: finite(machineEvent.confirmedAt),
      completedAt: finite(machineEvent.completedAt),
      failedAt: finite(machineEvent.failedAt),
      levelIds: Object.freeze([...(machineEvent.levelIds ?? [])]),
      levelPrices: Object.freeze([...(machineEvent.levelPrices ?? [])]),
      touchCounts: Object.freeze([...(machineEvent.touchCounts ?? [])]),
      adjacentGapPct: Object.freeze([...(machineEvent.adjacentGapPct ?? [])]),
      totalSpanPct: finite(machineEvent.totalSpanPct),
      levelsBroken: finite(machineEvent.levelsBroken),
      variants: Object.freeze([...(machineEvent.variants ?? [])]),
      failureReasons: Object.freeze([...(machineEvent.failureReasons ?? [])]),
      dataQuality: qualityState(episode, machineEvent),
      confirmationBlockedByDataQuality: Boolean(machineEvent.confirmationBlockedByDataQuality),
      outcomeCoverage: Object.freeze(outcomeCoverage(machineEvent)),
    }) : null,
    evidenceCoverage: Object.freeze({
      pricePoints: finite(episode?.evidencePack?.coverage?.pricePoints) ?? 0,
      bookSnapshots: finite(episode?.evidencePack?.coverage?.bookSnapshots) ?? 0,
      trades: finite(episode?.evidencePack?.coverage?.trades) ?? 0,
      depthDiffs: finite(episode?.evidencePack?.coverage?.depthDiffs) ?? 0,
      activeLevelZones: finite(episode?.evidencePack?.coverage?.activeLevelZones) ?? 0,
      activeBreakoutEvents: finite(episode?.evidencePack?.coverage?.activeBreakoutEvents) ?? 0,
      activeCascadeEvents: finite(episode?.evidencePack?.coverage?.activeCascadeEvents) ?? 0,
    }),
    geometryEligible,
    outcomeEligible,
    blockers: Object.freeze(blockers),
  });
}

export function summarizeCascadeCalibration(episodes, now = Date.now()) {
  const samples = (Array.isArray(episodes) ? episodes : [])
    .map((episode) => buildCascadeCalibrationSample(episode, now))
    .filter(Boolean);
  const summary = {
    episodes: samples.length,
    reviewed: 0,
    canonical: 0,
    weak: 0,
    false: 0,
    ambiguous: 0,
    unavailable: 0,
    geometryEligible: 0,
    outcomeEligible: 0,
    unreviewed: 0,
    byMachineState: {},
    byBlocker: {},
  };
  for (const sample of samples) {
    const classification = sample.calibration.classification;
    if (!classification) summary.unreviewed += 1;
    else {
      summary.reviewed += 1;
      summary[classification] += 1;
    }
    if (sample.geometryEligible) summary.geometryEligible += 1;
    if (sample.outcomeEligible) summary.outcomeEligible += 1;
    const machineState = sample.machine?.state ?? "MISSING";
    summary.byMachineState[machineState] = (summary.byMachineState[machineState] ?? 0) + 1;
    for (const blocker of sample.blockers) {
      summary.byBlocker[blocker] = (summary.byBlocker[blocker] ?? 0) + 1;
    }
  }
  return Object.freeze({
    ...summary,
    byMachineState: Object.freeze(summary.byMachineState),
    byBlocker: Object.freeze(summary.byBlocker),
  });
}

export function cascadeCalibrationCsvRow(episode, now = Date.now()) {
  const sample = buildCascadeCalibrationSample(episode, now);
  if (!sample) return null;
  return {
    calibrationVersion: sample.formulaVersion,
    episodeId: sample.episodeId,
    symbol: sample.symbol,
    candidateType: sample.candidateType,
    machineFormulaVersion: sample.machine?.formulaVersion ?? "",
    machineState: sample.machine?.state ?? "",
    machineGeometricState: sample.machine?.geometricState ?? "",
    machineDirection: sample.machine?.direction ?? "",
    machineLevelCount: sample.machine?.levelIds?.length ?? 0,
    machineLevelPrices: sample.machine?.levelPrices?.join(" | ") ?? "",
    machineTouchCounts: sample.machine?.touchCounts?.join(" | ") ?? "",
    machineGapsPct: sample.machine?.adjacentGapPct?.join(" | ") ?? "",
    machineFailureReasons: sample.machine?.failureReasons?.join(" | ") ?? "",
    dataQuality: sample.machine?.dataQuality ?? "",
    reviewVerdict: sample.reviewVerdict,
    finalPatternId: sample.finalPatternId ?? "",
    calibrationClass: sample.calibration.classification ?? "",
    calibrationConfidence: sample.calibration.confidence,
    calibrationChecks: Object.entries(sample.calibration.checks).map(([key, value]) => `${key}:${value}`).join(" | "),
    correctionDirection: sample.calibration.corrections.direction ?? "",
    correctionExpectedState: sample.calibration.corrections.expectedState ?? "",
    correctionLevelCount: sample.calibration.corrections.levelCount ?? "",
    correctionLevelPrices: sample.calibration.corrections.levelPrices.join(" | "),
    correctionTouchCounts: sample.calibration.corrections.touchCounts.join(" | "),
    reasonCodes: sample.calibration.reasonCodes.join(" | "),
    geometryEligible: sample.geometryEligible ? "yes" : "no",
    outcomeEligible: sample.outcomeEligible ? "yes" : "no",
    blockers: sample.blockers.join(" | "),
  };
}
