import { buildEvidenceExplanation, normalizePatternId } from "./signal-lab-v2-catalog.js";
import { migrateLegacyReview, normalizeReviewV2 } from "./signal-lab-v2-review.js";

export const SIGNAL_LAB_V2_TRAINING_VERSION = 1;

export const READINESS_LEVELS = Object.freeze({
  HYPOTHESIS: "hypothesis",
  LABELING: "labeling",
  EXPLORATORY: "exploratory",
  BETA_ELIGIBLE: "beta_eligible",
  RADAR_REVIEW_REQUIRED: "radar_review_required",
});

const finiteOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function preferredObservation(observations) {
  const rank = new Map([["5m", 5], ["3m", 4], ["1m", 3], ["30s", 2], ["15s", 1]]);
  return [...(Array.isArray(observations) ? observations : [])]
    .sort((left, right) => (
      Number(right?.state === "observed") - Number(left?.state === "observed")
      || (rank.get(right?.horizon) ?? 0) - (rank.get(left?.horizon) ?? 0)
    ))[0] ?? null;
}

function qualityFlags(event, context, observation) {
  const flags = [];
  const dataState = event?.quality?.state ?? context?.quality?.state ?? observation?.quality?.state;
  if (dataState && dataState !== "live") flags.push(`data-${dataState}`);
  if (!Array.isArray(context?.chartContext?.seconds) || context.chartContext.seconds.length < 2) {
    flags.push("seconds-context-missing");
  }
  if (!Array.isArray(observation?.pricePath) || observation.pricePath.length < 2) {
    flags.push("post-event-path-missing");
  }
  if (observation?.state !== "observed") flags.push("outcome-not-observed");
  if (context?.quality?.complete === false) flags.push("context-partial");
  return [...new Set(flags)];
}

export function createTrainingSample({
  event,
  context = null,
  observations = [],
  review,
  episode = null,
} = {}) {
  if (!event?.id) throw new TypeError("event is required");
  const normalizedReview = review?.reviewVersion === 2
    ? normalizeReviewV2(review)
    : migrateLegacyReview({
      ...review,
      eventId: review?.eventId ?? event.id,
      signalType: review?.signalType ?? event.signalType,
    });
  const observation = preferredObservation(observations);
  const patternId = normalizedReview.patternId
    ?? normalizePatternId(event.patternId ?? event.signalType);
  const explanation = buildEvidenceExplanation({ ...event, patternId, context });
  return Object.freeze({
    entity: "SignalTrainingSample",
    trainingVersion: SIGNAL_LAB_V2_TRAINING_VERSION,
    eventId: event.id,
    episodeId: normalizedReview.episodeId ?? episode?.id ?? null,
    symbol: event.symbol,
    patternId,
    direction: event.direction,
    triggeredAt: event.triggeredAt,
    formula: Object.freeze({
      name: String(event?.formula?.name ?? "unknown"),
      version: String(event?.formula?.version ?? "unknown"),
      settings: event?.formula?.settings ?? null,
    }),
    detectorEvidence: event.detectorEvidence ?? null,
    explanation,
    review: normalizedReview,
    outcome: observation ? Object.freeze({
      horizon: observation.horizon ?? null,
      directionalReturnPercent: finiteOrNull(observation.directionalReturnPercent),
      mfePercent: finiteOrNull(observation.mfePercent),
      maePercent: finiteOrNull(observation.maePercent),
      effectDurationMs: finiteOrNull(observation.effectDurationMs),
      state: observation.state ?? null,
    }) : null,
    qualityFlags: Object.freeze(qualityFlags(event, context, observation)),
    interpretation: "reviewed-market-episode-not-profitability-proof",
  });
}

export function assessPatternReadiness(samples = [], {
  minimumReviewed = 30,
  minimumValidOrWeak = 15,
  minimumCounterexamples = 10,
  minimumLiveCoveragePercent = 70,
} = {}) {
  const reviewed = samples.filter((sample) => sample?.review?.verdict);
  const accepted = reviewed.filter((sample) => ["valid", "weak"].includes(sample.review.verdict));
  const counterexamples = reviewed.filter((sample) => [
    "false_positive",
    "wrong_pattern",
    "duplicate_episode",
  ].includes(sample.review.verdict));
  const live = reviewed.filter((sample) => sample.qualityFlags.length === 0);
  const liveCoveragePercent = reviewed.length
    ? Math.round((live.length / reviewed.length) * 1_000) / 10
    : 0;
  const formulaVersions = [...new Set(reviewed.map((sample) => sample?.formula?.version ?? "unknown"))];
  const limitations = [];
  if (reviewed.length < minimumReviewed) limitations.push("reviewed-sample-below-gate");
  if (accepted.length < minimumValidOrWeak) limitations.push("accepted-examples-below-gate");
  if (counterexamples.length < minimumCounterexamples) limitations.push("counterexamples-below-gate");
  if (liveCoveragePercent < minimumLiveCoveragePercent) limitations.push("live-data-coverage-below-gate");
  if (formulaVersions.length > 1) limitations.push("multiple-formula-versions-mixed");

  let level = READINESS_LEVELS.HYPOTHESIS;
  if (reviewed.length > 0) level = READINESS_LEVELS.LABELING;
  if (reviewed.length >= minimumReviewed && accepted.length >= minimumValidOrWeak) {
    level = READINESS_LEVELS.EXPLORATORY;
  }
  if (
    limitations.length === 0
    && counterexamples.length >= minimumCounterexamples
    && liveCoveragePercent >= minimumLiveCoveragePercent
  ) {
    level = READINESS_LEVELS.BETA_ELIGIBLE;
  }

  return Object.freeze({
    level,
    counts: Object.freeze({
      samples: samples.length,
      reviewed: reviewed.length,
      valid: reviewed.filter((sample) => sample.review.verdict === "valid").length,
      weak: reviewed.filter((sample) => sample.review.verdict === "weak").length,
      falsePositive: reviewed.filter((sample) => sample.review.verdict === "false_positive").length,
      wrongPattern: reviewed.filter((sample) => sample.review.verdict === "wrong_pattern").length,
      duplicateEpisode: reviewed.filter((sample) => sample.review.verdict === "duplicate_episode").length,
      insufficientData: reviewed.filter((sample) => sample.review.verdict === "insufficient_data").length,
      counterexamples: counterexamples.length,
      cleanLive: live.length,
    }),
    liveCoveragePercent,
    formulaVersions: Object.freeze(formulaVersions),
    limitations: Object.freeze(limitations),
    interpretation: "workflow-readiness-not-statistical-edge",
    nextGate: level === READINESS_LEVELS.BETA_ELIGIBLE
      ? READINESS_LEVELS.RADAR_REVIEW_REQUIRED
      : READINESS_LEVELS.BETA_ELIGIBLE,
  });
}
