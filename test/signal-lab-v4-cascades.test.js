import test from "node:test";
import assert from "node:assert/strict";
import {
  CASCADE_GEOMETRIC_STATES,
  CASCADE_STATES,
  CascadeEngine,
} from "../signal-lab-v4-cascades.js";

function zone(id, side, price, options = {}) {
  return {
    id,
    side,
    active: true,
    lowerPrice: options.lowerPrice ?? price,
    upperPrice: options.upperPrice ?? price,
    referencePrice: price,
    touchCount: options.touchCount ?? 1,
    timeframes: options.timeframes ?? ["1m"],
    setupFeatures: {
      compressionType: options.compressionType ?? "NO_COMPRESSION",
      nearLevelShare: options.nearLevelShare ?? 0.2,
      timeNearLevelMs: options.timeNearLevelMs ?? 0,
    },
  };
}

function levelEvent(id, levelId, direction, triggeredAt, options = {}) {
  return {
    id,
    levelId,
    direction,
    triggeredAt,
    acceptedAt: options.acceptedAt ?? null,
    retestedAt: options.retestedAt ?? null,
    triggerPrice: options.triggerPrice ?? null,
    state: options.acceptedAt ? "ACCEPTED" : "TRIGGERED",
    dataQuality: options.dataQuality ?? "LIVE",
  };
}

function map(activeZones, eventHistory = [], dataQuality = "LIVE") {
  return { activeZones, eventHistory, dataQuality };
}

function engine(config = {}) {
  return new CascadeEngine({
    symbol: "TESTUSDT",
    config: {
      maxCascadeGapPct: 5,
      setupDisappearGraceMs: 500,
      maxBarsBetweenLevels: 5,
      maxInterLevelPullbackPct: 1,
      maxInterLevelPullbackAtr: 0,
      fullReturnTolerancePct: 0,
      fullReturnToleranceAtr: 0,
      maxOutcomeGapMs: 20_000,
      maxCascadeDurationMsByTimeframe: { "1m": 5_000 },
      ...config,
    },
  });
}

test("setup exists before any level is broken", () => {
  const subject = engine();
  const snapshot = subject.sync(map([
    zone("h1", "HIGH", 100, { touchCount: 2 }),
    zone("h2", "HIGH", 102),
    zone("h3", "HIGH", 105),
  ]), { currentPrice: 99, at: 1_000 });
  assert.equal(snapshot.active.length, 1);
  const event = snapshot.active[0];
  assert.equal(event.state, CASCADE_STATES.SETUP);
  assert.equal(event.setupDetectedAt, 1_000);
  assert.deepEqual(event.levelIds, ["h1", "h2", "h3"]);
  assert.deepEqual(event.adjacentGapPct.map((value) => Number(value.toFixed(6))), [2, 2.941176]);
  assert.ok(event.variants.includes("MULTI_TOUCH_LEVEL"));
});

test("zero and exactly five percent gaps are valid", () => {
  const subject = engine();
  const snapshot = subject.sync(map([
    zone("h1", "HIGH", 100, { upperPrice: 100, lowerPrice: 99.99 }),
    zone("h2", "HIGH", 100, { upperPrice: 100, lowerPrice: 99.98 }),
    zone("h3", "HIGH", 105),
  ]), { currentPrice: 99, at: 1_000 });
  assert.equal(snapshot.active.length, 1);
  assert.deepEqual(snapshot.active[0].adjacentGapPct, [0, 5]);
});

test("gap above five percent breaks the chain", () => {
  const subject = engine();
  const snapshot = subject.sync(map([
    zone("h1", "HIGH", 100),
    zone("h2", "HIGH", 105.01),
  ]), { currentPrice: 99, at: 1_000 });
  assert.equal(snapshot.active.length, 0);
});

test("first level creates TRIGGERED and second creates CONFIRMED", () => {
  const subject = engine();
  const zones = [zone("h1", "HIGH", 100), zone("h2", "HIGH", 102)];
  subject.sync(map(zones), { currentPrice: 99, at: 1_000 });
  subject.sync(map(zones, [
    levelEvent("b1", "h1", "UP", 2_000, { triggerPrice: 100.01 }),
  ]), { currentPrice: 100.2, at: 2_000 });
  assert.equal(subject.snapshot().active[0].state, CASCADE_STATES.TRIGGERED);
  subject.sync(map(zones, [
    levelEvent("b1", "h1", "UP", 2_000, { triggerPrice: 100.01 }),
    levelEvent("b2", "h2", "UP", 3_000, { triggerPrice: 102.01 }),
  ]), { currentPrice: 102.2, at: 3_000 });
  const event = subject.snapshot().active[0];
  assert.equal(event.state, CASCADE_STATES.CONFIRMED);
  assert.equal(event.geometricState, CASCADE_GEOMETRIC_STATES.CONFIRMED);
  assert.equal(event.levelsBroken, 2);
  assert.equal(event.confirmedAt, 3_000);
  assert.equal(event.completedAt, 3_000);
});

test("third and later levels create EXTENDED", () => {
  const subject = engine();
  const zones = [zone("h1", "HIGH", 100), zone("h2", "HIGH", 101), zone("h3", "HIGH", 102)];
  subject.sync(map(zones), { currentPrice: 99, at: 1_000 });
  subject.sync(map(zones, [
    levelEvent("b1", "h1", "UP", 2_000),
    levelEvent("b2", "h2", "UP", 2_500),
    levelEvent("b3", "h3", "UP", 3_000),
  ]), { currentPrice: 102.2, at: 3_000 });
  const event = subject.snapshot().active[0];
  assert.equal(event.state, CASCADE_STATES.EXTENDED);
  assert.equal(event.geometricState, CASCADE_GEOMETRIC_STATES.EXTENDED);
  assert.equal(event.levelsBroken, 3);
  assert.equal(event.completedAt, 3_000);
});

test("bad data records geometric confirmation but blocks full confirmation", () => {
  const subject = engine();
  const zones = [zone("h1", "HIGH", 100), zone("h2", "HIGH", 101)];
  subject.sync(map(zones), { currentPrice: 99, at: 1_000 });
  subject.sync(map(zones, [
    levelEvent("b1", "h1", "UP", 2_000, { dataQuality: "LIVE" }),
    levelEvent("b2", "h2", "UP", 2_500, { dataQuality: "GAP" }),
  ], "GAP"), { currentPrice: 101.2, at: 2_500, dataQuality: "GAP" });
  const event = subject.snapshot().active[0];
  assert.equal(event.state, CASCADE_STATES.TRIGGERED);
  assert.equal(event.geometricState, CASCADE_GEOMETRIC_STATES.CONFIRMED);
  assert.equal(event.levelsBroken, 2);
  assert.equal(event.confirmationBlockedByDataQuality, true);
});

test("only first level before duration expiry is PARTIAL", () => {
  const subject = engine();
  const zones = [zone("h1", "HIGH", 100), zone("h2", "HIGH", 101)];
  subject.sync(map(zones), { currentPrice: 99, at: 1_000 });
  subject.sync(map(zones, [levelEvent("b1", "h1", "UP", 2_000)]), { currentPrice: 100.2, at: 2_000 });
  subject.ingestPrice(100.3, 7_001);
  const event = subject.snapshot().history[0];
  assert.equal(event.state, CASCADE_STATES.PARTIAL);
  assert.ok(event.failureReasons.includes("SECOND_LEVEL_NOT_REACHED_IN_TIME"));
});

test("deep pullback before next level interrupts cascade", () => {
  const subject = engine({ maxInterLevelPullbackPct: 0.3 });
  const zones = [zone("h1", "HIGH", 100), zone("h2", "HIGH", 102)];
  subject.sync(map(zones), { currentPrice: 99, at: 1_000 });
  subject.sync(map(zones, [levelEvent("b1", "h1", "UP", 2_000)]), { currentPrice: 100.5, at: 2_000 });
  subject.ingestPrice(101, 2_100);
  subject.ingestPrice(100.5, 2_200);
  const event = subject.snapshot().history[0];
  assert.equal(event.state, CASCADE_STATES.FAILED);
  assert.ok(event.failureReasons.includes("INTER_LEVEL_PULLBACK"));
});

test("full return behind first zone interrupts cascade", () => {
  const subject = engine({ maxInterLevelPullbackPct: 10 });
  const zones = [
    zone("h1", "HIGH", 100, { lowerPrice: 99.9, upperPrice: 100 }),
    zone("h2", "HIGH", 101),
  ];
  subject.sync(map(zones), { currentPrice: 99, at: 1_000 });
  subject.sync(map(zones, [levelEvent("b1", "h1", "UP", 2_000)]), { currentPrice: 100.2, at: 2_000 });
  subject.ingestPrice(99.89, 2_500);
  const event = subject.snapshot().history[0];
  assert.equal(event.state, CASCADE_STATES.FAILED);
  assert.ok(event.failureReasons.includes("RETURNED_BEHIND_FIRST_LEVEL"));
});

test("short cascade is symmetric", () => {
  const subject = engine();
  const zones = [zone("l1", "LOW", 100), zone("l2", "LOW", 98), zone("l3", "LOW", 96)];
  subject.sync(map(zones), { currentPrice: 101, at: 1_000 });
  subject.sync(map(zones, [
    levelEvent("b1", "l1", "DOWN", 2_000),
    levelEvent("b2", "l2", "DOWN", 2_500),
    levelEvent("b3", "l3", "DOWN", 3_000),
  ]), { currentPrice: 95.8, at: 3_000 });
  const event = subject.snapshot().active[0];
  assert.equal(event.direction, "DOWN");
  assert.equal(event.state, CASCADE_STATES.EXTENDED);
  assert.deepEqual(event.levelPrices, [100, 98, 96]);
});

test("repeated sync updates one setup instead of duplicating it", () => {
  const subject = engine();
  const zones = [zone("h1", "HIGH", 100), zone("h2", "HIGH", 101)];
  subject.sync(map(zones), { currentPrice: 99, at: 1_000 });
  subject.sync(map(zones), { currentPrice: 99.2, at: 1_100 });
  subject.sync(map(zones), { currentPrice: 99.3, at: 1_200 });
  assert.equal(subject.snapshot().history.length, 1);
  assert.equal(subject.snapshot().active[0].lastSetupSeenAt, 1_200);
});

test("retest of first level before second is preserved as a variant", () => {
  const subject = engine();
  const zones = [zone("h1", "HIGH", 100), zone("h2", "HIGH", 101)];
  subject.sync(map(zones), { currentPrice: 99, at: 1_000 });
  subject.sync(map(zones, [
    levelEvent("b1", "h1", "UP", 2_000, { retestedAt: 2_300 }),
    levelEvent("b2", "h2", "UP", 2_500),
  ]), { currentPrice: 101.2, at: 2_500 });
  assert.ok(subject.snapshot().active[0].variants.includes("RETEST_FIRST_LEVEL"));
});

test("outcomes retain MFE, MAE and horizon observation without look-ahead", () => {
  const subject = engine({ maxCascadeDurationMsByTimeframe: { "1m": 60_000 } });
  const zones = [zone("h1", "HIGH", 100), zone("h2", "HIGH", 101)];
  subject.sync(map(zones), { currentPrice: 99, at: 1_000 });
  subject.sync(map(zones, [levelEvent("b1", "h1", "UP", 2_000, { triggerPrice: 100 })]), {
    currentPrice: 100,
    at: 2_000,
  });
  subject.ingestPrice(101, 10_000);
  subject.ingestPrice(99.5, 16_000);
  subject.ingestPrice(100.5, 17_000);
  const trigger = subject.snapshot().active[0].anchors.trigger;
  assert.equal(trigger.mfePct, 1);
  assert.equal(trigger.maePct, -0.5);
  assert.equal(trigger.outcomes["15s"].state, "OBSERVED");
  assert.equal(trigger.outcomes["15s"].observedAt, 17_000);
  assert.equal(trigger.outcomes["15s"].scenarioMovePct, 0.5);
});
