import { normalizePatternId, PATTERN_STATES } from "./signal-lab-v2-catalog.js";

export const SIGNAL_LAB_V2_REVIEW_VERSION = 2;

export const REVIEW_VERDICTS = Object.freeze([
  "valid",
  "weak",
  "false_positive",
  "missed_pattern",
  "duplicate_episode",
  "wrong_pattern",
  "insufficient_data",
]);

export const REVIEW_REASON_CODES = Object.freeze([
  "wrong_structure",
  "weak_extrema",
  "wrong_level",
  "late_trigger",
  "early_trigger",
  "ordinary_noise",
  "bad_liquidity",
  "missing_context",
  "missing_post_event_path",
  "wrong_direction",
  "same_market_episode",
  "other",
]);

const LEGACY_VERDICT_MAP = Object.freeze({
  good: "valid",
  bad: "false_positive",
  unsure: "insufficient_data",
});

const LEGACY_REASON_MAP = Object.freeze({
  "wrong-structure": "wrong_structure",
  "weak-extremes": "weak_extrema",
  "late-trigger": "late_trigger",
  noise: "ordinary_noise",
  "bad-liquidity": "bad_liquidity",
  other: "other",
});

const finiteOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeText = (value, maximum) => String(value ?? "").trim().slice(0, maximum);

function normalizeExtrema(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => ({
      at: finiteOrNull(item?.at),
      price: finiteOrNull(item?.price),
      kind: ["high", "low"].includes(item?.kind) ? item.kind : null,
    }))
    .filter((item) => item.at !== null && item.price !== null && item.price > 0)
    .sort((left, right) => left.at - right.at)
    .slice(0, 12);
}

function normalizeReasonCodes(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => LEGACY_REASON_MAP[value] ?? value)
    .filter((value) => REVIEW_REASON_CODES.includes(value)))];
}

export function normalizeReviewV2(input = {}, { now = Date.now() } = {}) {
  const eventId = normalizeText(input.eventId, 180);
  if (!eventId) throw new TypeError("eventId is required");

  const verdict = LEGACY_VERDICT_MAP[input.verdict] ?? input.verdict ?? null;
  if (verdict !== null && !REVIEW_VERDICTS.includes(verdict)) {
    throw new TypeError(`Unsupported review verdict: ${verdict}`);
  }

  const patternId = normalizePatternId(input.patternId ?? input.signalType);
  const reviewedState = PATTERN_STATES.includes(input.reviewedState)
    ? input.reviewedState
    : null;
  const referencePrice = finiteOrNull(input.referencePrice);
  const invalidationPrice = finiteOrNull(input.invalidationPrice);
  const confirmedAt = finiteOrNull(input.confirmedAt);
  const completedAt = finiteOrNull(input.completedAt);

  return Object.freeze({
    entity: "SignalLabReview",
    reviewVersion: SIGNAL_LAB_V2_REVIEW_VERSION,
    eventId,
    verdict,
    patternId,
    reviewedState,
    episodeId: normalizeText(input.episodeId, 180) || null,
    referencePrice: referencePrice !== null && referencePrice > 0 ? referencePrice : null,
    invalidationPrice: invalidationPrice !== null && invalidationPrice > 0 ? invalidationPrice : null,
    confirmedAt: confirmedAt !== null && confirmedAt >= 0 ? confirmedAt : null,
    completedAt: completedAt !== null && completedAt >= 0 ? completedAt : null,
    extrema: Object.freeze(normalizeExtrema(input.extrema)),
    reasonCodes: Object.freeze(normalizeReasonCodes(
      input.reasonCodes ?? input.reason ?? [],
    )),
    comment: normalizeText(input.comment, 2_000),
    reviewedAt: finiteOrNull(input.reviewedAt) ?? finiteOrNull(now) ?? Date.now(),
    source: normalizeText(input.source, 80) || "manual-signal-lab",
  });
}

export function migrateLegacyReview(review = {}, options = {}) {
  return normalizeReviewV2({
    ...review,
    patternId: review.patternId ?? review.signalType,
    reasonCodes: review.reasonCodes ?? review.reason,
    source: review.source ?? "legacy-review-v1",
  }, options);
}

export function reviewCompleteness(review = {}) {
  const normalized = review.reviewVersion === SIGNAL_LAB_V2_REVIEW_VERSION
    ? review
    : migrateLegacyReview(review);
  const missing = [];
  if (!normalized.verdict) missing.push("verdict");
  if (!normalized.patternId && !["wrong_pattern", "insufficient_data"].includes(normalized.verdict)) {
    missing.push("patternId");
  }
  if (["valid", "weak"].includes(normalized.verdict) && normalized.extrema.length === 0) {
    missing.push("extrema-or-structure-markup");
  }
  if (normalized.verdict === "duplicate_episode" && !normalized.episodeId) {
    missing.push("episodeId");
  }
  return Object.freeze({
    complete: missing.length === 0,
    missing: Object.freeze(missing),
  });
}

export function reviewToExportRow(review = {}) {
  const normalized = review.reviewVersion === SIGNAL_LAB_V2_REVIEW_VERSION
    ? review
    : migrateLegacyReview(review);
  return Object.freeze({
    eventId: normalized.eventId,
    verdict: normalized.verdict,
    patternId: normalized.patternId,
    reviewedState: normalized.reviewedState,
    episodeId: normalized.episodeId,
    referencePrice: normalized.referencePrice,
    invalidationPrice: normalized.invalidationPrice,
    confirmedAt: normalized.confirmedAt,
    completedAt: normalized.completedAt,
    extremaCount: normalized.extrema.length,
    reasonCodes: normalized.reasonCodes.join("|"),
    comment: normalized.comment,
    reviewedAt: normalized.reviewedAt,
    source: normalized.source,
  });
}
