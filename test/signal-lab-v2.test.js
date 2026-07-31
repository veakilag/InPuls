import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEvidenceExplanation,
  getPatternDefinition,
  normalizePatternId,
  validatePatternCandidate,
} from "../signal-lab-v2-catalog.js";
import {
  migrateLegacyReview,
  normalizeReviewV2,
  reviewCompleteness,
} from "../signal-lab-v2-review.js";
import {
  appendEpisodeEvent,
  belongsToEpisode,
  createEpisode,
  groupEventsIntoEpisodes,
  transitionEpisode,
} from "../signal-lab-v2-episodes.js";
import {
  assessPatternReadiness,
  createTrainingSample,
  READINESS_LEVELS,
} from "../signal-lab-v2-training.js";

const baseEvent = (overrides = {}) => ({
  id: overrides.id ?? "evt-1",
  symbol: overrides.symbol ?? "TESTUSDT",
  signalType: overrides.signalType ?? "cascade",
  patternId: overrides.patternId,
  patternState: overrides.patternState ?? "candidate",
  direction: overrides.direction ?? "up",
  triggeredAt: overrides.triggeredAt ?? 1_000,
  price: overrides.price ?? 100,
  formula: overrides.formula ?? { name: "scanner", version: "v1" },
  detectorEvidence: overrides.detectorEvidence ?? {
    extremaCount: 3,
    zoneWidthPercent: 2.1,
    breakoutDistancePercent: 0.3,
  },
  quality: overrides.quality ?? { state: "live", limitations: [] },
});

test("team aliases resolve to canonical pattern ids", () => {
  assert.equal(normalizePatternId("Пробой каскадов"), "cascade_breakout");
  assert.equal(normalizePatternId("ПРОБОЙ УС"), "level_breakout");
  assert.equal(normalizePatternId("Заточка"), "sharpening_rejection");
  assert.equal(normalizePatternId("unknown setup"), null);
});

test("catalog keeps ambiguous team terminology as an explicit limitation", () => {
  const definition = getPatternDefinition("заточка");
  assert.ok(definition.limitations.includes("team-term-may-also-describe-execution-method"));
});

test("candidate validation requires factual identity and direction", () => {
  const valid = validatePatternCandidate(baseEvent());
  assert.equal(valid.valid, true);
  const invalid = validatePatternCandidate({ id: "x", signalType: "unknown" });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes("unknown-pattern"));
  assert.ok(invalid.errors.includes("symbol-required"));
});

test("cascade explanation contains observable facts only", () => {
  const explanation = buildEvidenceExplanation(baseEvent());
  assert.equal(explanation.patternId, "cascade_breakout");
  assert.deepEqual(explanation.facts, [
    "3 последовательных экстремума",
    "диапазон конструкции 2.10%",
    "выход за ближайшую ступень 0.30%",
  ]);
  const text = JSON.stringify(explanation).toLowerCase();
  assert.equal(text.includes("крупный игрок"), false);
  assert.equal(text.includes("спуф"), false);
  assert.equal(text.includes("покупай"), false);
});

test("liquidity explanation does not accuse spoofing", () => {
  const explanation = buildEvidenceExplanation(baseEvent({
    signalType: "size_supporter",
    patternId: "liquidity_hold",
    detectorEvidence: { quoteUsd: 120_000, sizeMultiple: 7.2, touchCount: 3, removed: true },
  }));
  assert.ok(explanation.facts.includes("объём был снят"));
  assert.ok(explanation.limitations.includes("spoofing-must-not-be-asserted"));
});

test("legacy reviews migrate without losing the manual comment", () => {
  const review = migrateLegacyReview({
    eventId: "evt-1",
    verdict: "good",
    signalType: "cascade",
    reason: "weak-extremes",
    comment: "Третий экстремум правильный",
  }, { now: 10 });
  assert.equal(review.verdict, "valid");
  assert.equal(review.patternId, "cascade_breakout");
  assert.deepEqual(review.reasonCodes, ["weak_extrema"]);
  assert.equal(review.comment, "Третий экстремум правильный");
});

test("valid review preserves trader markup", () => {
  const review = normalizeReviewV2({
    eventId: "evt-1",
    verdict: "valid",
    patternId: "cascade",
    reviewedState: "confirmed",
    referencePrice: 100,
    invalidationPrice: 98.7,
    extrema: [
      { at: 100, price: 96, kind: "high" },
      { at: 200, price: 98, kind: "high" },
      { at: 300, price: 100, kind: "high" },
    ],
  }, { now: 500 });
  assert.equal(review.extrema.length, 3);
  assert.equal(review.referencePrice, 100);
  assert.equal(review.invalidationPrice, 98.7);
  assert.equal(reviewCompleteness(review).complete, true);
});

test("duplicate review requires an episode id", () => {
  const review = normalizeReviewV2({
    eventId: "evt-2",
    verdict: "duplicate_episode",
    patternId: "cascade",
  });
  assert.deepEqual(reviewCompleteness(review).missing, ["episodeId"]);
});

test("same market move is grouped into one episode", () => {
  const first = baseEvent({ id: "a", triggeredAt: 1_000, price: 100 });
  const second = baseEvent({ id: "b", triggeredAt: 20_000, price: 100.2 });
  const grouped = groupEventsIntoEpisodes([first, second]);
  assert.equal(grouped.episodes.length, 1);
  assert.deepEqual(grouped.episodes[0].eventIds, ["a", "b"]);
  assert.deepEqual(grouped.episodes[0].duplicateEventIds, ["b"]);
});

test("distant or late event starts a new episode", () => {
  const first = baseEvent({ id: "a", triggeredAt: 1_000, price: 100 });
  const second = baseEvent({ id: "b", triggeredAt: 200_000, price: 103 });
  const grouped = groupEventsIntoEpisodes([first, second]);
  assert.equal(grouped.episodes.length, 2);
});

test("episode state machine blocks impossible resurrection", () => {
  const episode = createEpisode(baseEvent());
  const confirmed = transitionEpisode(episode, "confirmed", { at: 2_000 });
  const completed = transitionEpisode(confirmed, "completed", { at: 3_000 });
  assert.equal(completed.state, "completed");
  assert.throws(() => transitionEpisode(completed, "confirmed"), /Invalid episode transition/);
});

test("terminal episode rejects duplicate events", () => {
  const confirmed = transitionEpisode(createEpisode(baseEvent()), "confirmed", { at: 1_500 });
  const completed = transitionEpisode(confirmed, "completed", { at: 2_000 });
  assert.equal(belongsToEpisode(completed, baseEvent({ id: "b", triggeredAt: 2_500 })), false);
  assert.throws(() => appendEpisodeEvent(completed, baseEvent({ id: "b", triggeredAt: 2_500 })));
});

test("training sample preserves formula version, outcome and data limitations", () => {
  const event = baseEvent();
  const review = normalizeReviewV2({
    eventId: event.id,
    verdict: "valid",
    patternId: "cascade",
    extrema: [{ at: 100, price: 99, kind: "high" }],
  });
  const sample = createTrainingSample({
    event,
    context: {
      chartContext: { seconds: [{ at: 900, price: 99 }, { at: 1_000, price: 100 }] },
      quality: { state: "live", complete: true },
    },
    observations: [{
      state: "observed",
      horizon: "5m",
      directionalReturnPercent: 2,
      mfePercent: 4,
      maePercent: 0.4,
      effectDurationMs: 40_000,
      pricePath: [{ at: 1_000, price: 100 }, { at: 2_000, price: 102 }],
      quality: { state: "live" },
    }],
    review,
  });
  assert.equal(sample.formula.version, "v1");
  assert.equal(sample.outcome.mfePercent, 4);
  assert.deepEqual(sample.qualityFlags, []);
});

test("readiness gate never treats a few pretty examples as sufficient", () => {
  const sample = {
    review: { verdict: "valid" },
    qualityFlags: [],
    formula: { version: "v1" },
  };
  const result = assessPatternReadiness(Array.from({ length: 5 }, () => sample));
  assert.equal(result.level, READINESS_LEVELS.LABELING);
  assert.ok(result.limitations.includes("reviewed-sample-below-gate"));
});

test("beta eligibility needs positives, counterexamples, live coverage and one formula version", () => {
  const accepted = Array.from({ length: 20 }, (_, index) => ({
    review: { verdict: index < 15 ? "valid" : "weak" },
    qualityFlags: [],
    formula: { version: "v2" },
  }));
  const negatives = Array.from({ length: 10 }, () => ({
    review: { verdict: "false_positive" },
    qualityFlags: [],
    formula: { version: "v2" },
  }));
  const result = assessPatternReadiness([...accepted, ...negatives]);
  assert.equal(result.level, READINESS_LEVELS.BETA_ELIGIBLE);
  assert.equal(result.interpretation, "workflow-readiness-not-statistical-edge");
});
