import test from "node:test";
import assert from "node:assert/strict";
import {
  BREAKOUT_ACCEPTANCE_MODES,
  BREAKOUT_EVENT_STATES,
  LEVEL_ZONE_STATES,
  LevelZoneEngine,
} from "../signal-lab-v4-levels-breakouts.js";

function extremeMap(rows) {
  const timeframes = {};
  for (const row of rows) {
    timeframes[row.timeframe] ??= { active: [] };
    timeframes[row.timeframe].active.push({
      id: row.id,
      side: row.side,
      price: row.price,
      priceTicks: String(Math.round(row.price / 0.01)),
      extremeTime: row.extremeTime ?? 1_000,
      confirmedAt: row.confirmedAt ?? 2_000,
      touchCount: row.touchCount ?? 1,
    });
  }
  return { timeframes };
}

function engine(config = {}) {
  return new LevelZoneEngine({
    symbol: "TESTUSDT",
    tickSize: 0.01,
    config: {
      mergeTicks: 4,
      mergePct: 0,
      mergeAtrFactor: 0,
      rearmTicks: 5,
      rearmPct: 0,
      rearmAtrFactor: 0,
      rearmBars: 2,
      rearmTimeMs: 1_000,
      nearLevelPct: 0.2,
      nearLevelAtrFactor: 0,
      acceptanceTicks: 2,
      acceptancePct: 0,
      acceptanceAtrFactor: 0,
      acceptanceMs: 1_000,
      reclaimWindowMs: 5_000,
      ...config,
    },
  });
}

test("close high extremes merge into one zone and preserve source points", () => {
  const subject = engine();
  const snapshot = subject.syncExtremeMap(extremeMap([
    { id: "h1", side: "HIGH", timeframe: "1m", price: 100, extremeTime: 1_000 },
    { id: "h2", side: "HIGH", timeframe: "5m", price: 100.03, extremeTime: 3_000 },
  ]), { at: 4_000 });
  assert.equal(snapshot.activeZones.length, 1);
  const zone = snapshot.activeZones[0];
  assert.equal(zone.lowerPrice, 100);
  assert.equal(zone.upperPrice, 100.03);
  assert.deepEqual(zone.extremeIds, ["h1", "h2"]);
  assert.deepEqual([...zone.timeframes].sort(), ["1m", "5m"]);
  assert.equal(zone.touchCount, 2);
});

test("adjacent contacts count as one attack until real rearm", () => {
  const subject = engine();
  subject.syncExtremeMap(extremeMap([
    { id: "h1", side: "HIGH", timeframe: "1m", price: 100 },
  ]), { at: 2_000 });
  subject.ingestPrice(100, 3_000);
  subject.ingestPrice(100, 3_100);
  assert.equal(subject.snapshot().activeZones[0].touchCount, 1);
  subject.ingestPrice(99.90, 4_000);
  subject.ingestPrice(99.90, 5_500);
  subject.ingestPrice(100, 6_000);
  assert.equal(subject.snapshot().activeZones[0].touchCount, 2);
});

test("equal touch does not trigger breakout; one tick above does", () => {
  const subject = engine({ acceptanceMode: BREAKOUT_ACCEPTANCE_MODES.DISTANCE_CONFIRM });
  subject.syncExtremeMap(extremeMap([
    { id: "h1", side: "HIGH", timeframe: "1m", price: 100 },
  ]), { at: 2_000 });
  subject.ingestPrice(100, 3_000);
  assert.equal(subject.snapshot().activeEvents.length, 0);
  subject.ingestPrice(100.01, 3_100);
  const event = subject.snapshot().activeEvents[0];
  assert.ok(event);
  assert.equal(event.state, BREAKOUT_EVENT_STATES.TRIGGERED);
  assert.equal(event.triggerPrice, 100.01);
});

test("distance confirmation accepts only after configured distance", () => {
  const subject = engine({ acceptanceMode: BREAKOUT_ACCEPTANCE_MODES.DISTANCE_CONFIRM });
  subject.syncExtremeMap(extremeMap([
    { id: "h1", side: "HIGH", timeframe: "1m", price: 100 },
  ]), { at: 2_000 });
  subject.ingestPrice(100.01, 3_000);
  assert.equal(subject.snapshot().activeEvents[0].state, BREAKOUT_EVENT_STATES.TRIGGERED);
  subject.ingestPrice(100.02, 3_100);
  assert.equal(subject.snapshot().activeEvents[0].state, BREAKOUT_EVENT_STATES.ACCEPTED);
  assert.equal(subject.snapshot().activeZones[0].state, LEVEL_ZONE_STATES.BROKEN_ACCEPTED);
});

test("hybrid confirmation requires distance plus time, close or flow", () => {
  const subject = engine({ acceptanceMode: BREAKOUT_ACCEPTANCE_MODES.HYBRID_CONFIRM });
  subject.syncExtremeMap(extremeMap([
    { id: "h1", side: "HIGH", timeframe: "1m", price: 100 },
  ]), { at: 2_000 });
  subject.ingestPrice(100.02, 3_000);
  assert.equal(subject.snapshot().activeEvents[0].state, BREAKOUT_EVENT_STATES.TRIGGERED);
  subject.ingestPrice(100.02, 4_100);
  assert.equal(subject.snapshot().activeEvents[0].state, BREAKOUT_EVENT_STATES.ACCEPTED);
});

test("close confirmation is evaluated from a closed candle", () => {
  const subject = engine({ acceptanceMode: BREAKOUT_ACCEPTANCE_MODES.CLOSE_CONFIRM });
  subject.syncExtremeMap(extremeMap([
    { id: "h1", side: "HIGH", timeframe: "1m", price: 100 },
  ]), { at: 2_000 });
  subject.ingestCandle({ high: 100.05, low: 99.8, close: 100.01, closeTime: 60_000 });
  const event = subject.snapshot().activeEvents[0];
  assert.equal(event.state, BREAKOUT_EVENT_STATES.ACCEPTED);
  assert.equal(event.acceptanceChecks.close, true);
});

test("puncture and quick return is swept reclaimed, not accepted breakout", () => {
  const subject = engine({ acceptanceMode: BREAKOUT_ACCEPTANCE_MODES.HYBRID_CONFIRM });
  subject.syncExtremeMap(extremeMap([
    { id: "h1", side: "HIGH", timeframe: "1m", price: 100 },
  ]), { at: 2_000 });
  subject.ingestPrice(100.01, 3_000);
  subject.ingestPrice(99.99, 3_500);
  const event = subject.snapshot().eventHistory[0];
  assert.equal(event.state, BREAKOUT_EVENT_STATES.SWEPT_RECLAIMED);
  assert.equal(event.classification, "SWEPT_RECLAIMED");
  assert.equal(subject.snapshot().activeZones[0].state, LEVEL_ZONE_STATES.SWEPT_RECLAIMED);
});

test("stale or gap data can record geometry but cannot confirm acceptance", () => {
  const subject = engine({ acceptanceMode: BREAKOUT_ACCEPTANCE_MODES.DISTANCE_CONFIRM });
  subject.syncExtremeMap(extremeMap([
    { id: "h1", side: "HIGH", timeframe: "1m", price: 100 },
  ]), { at: 2_000, dataQuality: "GAP" });
  subject.ingestPrice(100.05, 3_000, { dataQuality: "GAP" });
  const event = subject.snapshot().activeEvents[0];
  assert.equal(event.state, BREAKOUT_EVENT_STATES.TRIGGERED);
  assert.equal(event.blockedByDataQuality, true);
  assert.equal(event.acceptanceChecks.distance, true);
});

test("accepted breakout may be classified as retest only after acceptance", () => {
  const subject = engine({ acceptanceMode: BREAKOUT_ACCEPTANCE_MODES.DISTANCE_CONFIRM });
  subject.syncExtremeMap(extremeMap([
    { id: "h1", side: "HIGH", timeframe: "1m", price: 100 },
  ]), { at: 2_000 });
  subject.ingestPrice(100.02, 3_000);
  subject.ingestPrice(100, 3_500);
  let event = subject.snapshot().activeEvents[0];
  assert.equal(event.state, BREAKOUT_EVENT_STATES.ACCEPTED);
  assert.equal(event.classification, "RETEST");
  assert.equal(event.retestedAt, 3_500);
  subject.ingestPrice(100.03, 4_000);
  event = subject.snapshot().activeEvents[0];
  assert.equal(event.continuedAt, 4_000);
});

test("low breakout works symmetrically", () => {
  const subject = engine({ acceptanceMode: BREAKOUT_ACCEPTANCE_MODES.DISTANCE_CONFIRM });
  subject.syncExtremeMap(extremeMap([
    { id: "l1", side: "LOW", timeframe: "1m", price: 100 },
  ]), { at: 2_000 });
  subject.ingestPrice(100, 3_000);
  assert.equal(subject.snapshot().activeEvents.length, 0);
  subject.ingestPrice(99.99, 3_100);
  assert.equal(subject.snapshot().activeEvents[0].state, BREAKOUT_EVENT_STATES.TRIGGERED);
  subject.ingestPrice(99.98, 3_200);
  assert.equal(subject.snapshot().activeEvents[0].state, BREAKOUT_EVENT_STATES.ACCEPTED);
  assert.equal(subject.snapshot().activeEvents[0].direction, "DOWN");
});

test("same zone keeps one active event instead of duplicating every tick", () => {
  const subject = engine({ acceptanceMode: BREAKOUT_ACCEPTANCE_MODES.TIME_CONFIRM, acceptanceMs: 10_000 });
  subject.syncExtremeMap(extremeMap([
    { id: "h1", side: "HIGH", timeframe: "1m", price: 100 },
  ]), { at: 2_000 });
  subject.ingestPrice(100.01, 3_000);
  subject.ingestPrice(100.02, 3_100);
  subject.ingestPrice(100.03, 3_200);
  assert.equal(subject.snapshot().eventHistory.length, 1);
});

test("removing active extremes inactivates zone but preserves history", () => {
  const subject = engine();
  subject.syncExtremeMap(extremeMap([
    { id: "h1", side: "HIGH", timeframe: "1m", price: 100 },
  ]), { at: 2_000 });
  subject.syncExtremeMap({ timeframes: {} }, { at: 5_000 });
  const snapshot = subject.snapshot();
  assert.equal(snapshot.activeZones.length, 0);
  assert.equal(snapshot.zoneHistory[0].state, LEVEL_ZONE_STATES.INACTIVE);
  assert.equal(snapshot.zoneHistory[0].inactivatedAt, 5_000);
});
