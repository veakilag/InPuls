import test from "node:test";
import assert from "node:assert/strict";
import { enrichSignalLabReportV2 } from "../signal-lab-v2-store.js";

const event = (id, at, price = 100) => ({
  id,
  symbol: "BTCUSDT",
  signalType: "cascade",
  direction: "up",
  triggeredAt: at,
  price,
  detectorEvidence: {
    extremaCount: 3,
    zoneWidthPercent: 2.1,
    breakoutDistancePercent: 0.25,
  },
  context: { quality: { state: "live" } },
  observation: { horizon: "1m", mfePercent: 1.4, maePercent: 0.2 },
  review: null,
});

const report = (events) => ({
  schemaVersion: 1,
  source: { storageState: "available" },
  definitions: {},
  limitations: [],
  windows: [{ key: "7d", events, counts: {}, signalGroups: [], symbolGroups: [] }],
});

test("enriches current events with canonical pattern and facts", () => {
  const result = enrichSignalLabReportV2(report([event("e1", 1000)]), []);
  const row = result.windows[0].events[0];
  assert.equal(result.schemaVersion, 2);
  assert.equal(row.patternId, "cascade_breakout");
  assert.equal(row.patternState, "triggered");
  assert.equal(row.duplicateEpisode, false);
  assert.equal(row.explanation.facts.length, 3);
});

test("groups repeated events into one market episode", () => {
  const result = enrichSignalLabReportV2(report([
    event("e1", 1000),
    event("e2", 2000, 100.2),
  ]), []);
  const [first, second] = result.windows[0].events;
  assert.equal(first.episodeId, second.episodeId);
  assert.equal(second.duplicateEpisode, true);
  assert.equal(result.windows[0].episodes.length, 1);
});

test("stored V2 review overrides event review", () => {
  const source = event("e1", 1000);
  source.review = { eventId: "e1", verdict: "good" };
  const stored = [{
    entity: "SignalLabReview",
    reviewVersion: 2,
    eventId: "e1",
    verdict: "duplicate_episode",
    patternId: "cascade_breakout",
    reviewedState: "completed",
    episodeId: "episode:manual",
    referencePrice: 100,
    invalidationPrice: 98,
    confirmedAt: null,
    completedAt: 2000,
    extrema: [],
    reasonCodes: ["same_market_episode"],
    comment: "Повтор",
    reviewedAt: 3000,
    source: "manual-signal-lab",
  }];
  const row = enrichSignalLabReportV2(report([source]), stored).windows[0].events[0];
  assert.equal(row.review.verdict, "duplicate_episode");
  assert.equal(row.episodeId, "episode:manual");
  assert.equal(row.patternState, "completed");
});
