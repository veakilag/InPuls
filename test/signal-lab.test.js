import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SIGNAL_LAB_EVIDENCE_LEVELS,
  SIGNAL_LAB_WINDOWS,
  SignalLabLocalStore,
  buildSignalLabReport,
} from "../signal-lab.js";

const DAY = 86_400_000;
const NOW = 40 * DAY;

function signalEvent({
  id,
  symbol = "ETHUSDT",
  signalType = "impulse",
  direction = "up",
  triggeredAt = NOW - 10_000,
  formulaVersion = "radar-signals-v1",
  settings = { impulse15s: 0.35 },
} = {}) {
  return {
    schemaVersion: 1,
    entity: "SignalEvent",
    id,
    venue: "binance-usdm",
    symbol,
    signalType,
    direction,
    triggeredAt,
    price: 100,
    formula: {
      name: "radar-signal-classifier",
      version: formulaVersion,
      settings,
    },
  };
}

function signalContext(event, {
  complete = false,
  orderBookObserved = false,
  episodes = [],
} = {}) {
  return {
    schemaVersion: 1,
    entity: "SignalContext",
    id: `${event.id}:context`,
    eventId: event.id,
    symbol: event.symbol,
    quality: { complete },
    liquidity: {
      observed: orderBookObserved,
      episodes,
      quality: { importance: "not-scored-from-size" },
    },
  };
}

function observation(event, {
  horizon = "15s",
  state = "observed",
  qualityState = "live",
  returnPercent = 1,
  directionalReturnPercent = returnPercent,
  mfePercent = Math.max(directionalReturnPercent, 0),
  maePercent = Math.min(directionalReturnPercent, 0),
  effectDurationMs = 5_000,
  dueAt = event.triggeredAt + 15_000,
} = {}) {
  return {
    schemaVersion: 1,
    version: 2,
    entity: "SignalObservation",
    id: `${event.id}:observation:${horizon}`,
    eventId: event.id,
    horizon,
    horizonMs: horizon === "15s" ? 15_000 : 60_000,
    state,
    dueAt,
    returnPercent: state === "observed" ? returnPercent : null,
    directionalReturnPercent: state === "observed" ? directionalReturnPercent : null,
    mfePercent: state === "observed" ? mfePercent : null,
    maePercent: state === "observed" ? maePercent : null,
    effectDurationMs: state === "observed" ? effectDurationMs : null,
    quality: {
      state: state === "observed" ? qualityState : state,
      limitations: [],
    },
  };
}

function reportFor(events, observations, contexts = [], options = {}) {
  return buildSignalLabReport(
    { events, contexts, observations },
    {
      now: NOW,
      windows: [{ key: "1d", durationMs: DAY }],
      ...options,
    },
  );
}

test("Signal Lab publishes the intended 1d, 3d, 7d and 30d windows", () => {
  assert.deepEqual(
    SIGNAL_LAB_WINDOWS.map((window) => window.key),
    ["1d", "3d", "7d", "30d"],
  );
});

test("primary statistics use only complete live observations and expose every exclusion", () => {
  const events = Array.from(
    { length: 6 },
    (_, index) => signalEvent({ id: `event-${index + 1}` }),
  );
  const observations = [
    observation(events[0], {
      returnPercent: 1,
      directionalReturnPercent: 1,
      mfePercent: 2,
      maePercent: -0.5,
      effectDurationMs: 1_000,
    }),
    observation(events[1], {
      returnPercent: 3,
      directionalReturnPercent: 3,
      mfePercent: 4,
      maePercent: -1,
      effectDurationMs: 3_000,
    }),
    observation(events[2], {
      returnPercent: -1,
      directionalReturnPercent: -1,
      mfePercent: 1,
      maePercent: -2,
      effectDurationMs: 2_000,
    }),
    observation(events[3], {
      qualityState: "partial",
      returnPercent: 10,
      directionalReturnPercent: 10,
      mfePercent: 12,
      maePercent: -8,
      effectDurationMs: 12_000,
    }),
    observation(events[4], { state: "unavailable" }),
    observation(events[5], { state: "pending", dueAt: NOW - 1 }),
  ];
  const contexts = events.map((event, index) => signalContext(event, {
    complete: index === 0,
    orderBookObserved: index < 2,
    episodes: index === 0 ? [{ interaction: "touched", importance: "unrated" }] : [],
  }));

  const report = reportFor(events, observations, contexts);
  const group = report.windows[0].signalGroups[0];

  assert.deepEqual(group.sample, {
    events: 6,
    observations: 6,
    due: 6,
    observed: 4,
    usableLive: 3,
    observedPartial: 1,
    unavailable: 1,
    pending: 1,
    awaiting: 0,
    overduePending: 1,
    observedCoveragePercent: 66.6667,
    usableCoveragePercent: 50,
    livePathSharePercent: 75,
  });
  assert.deepEqual(group.continuation, {
    definition: "directionalReturnPercent > 0",
    continued: 2,
    flat: 0,
    adverse: 1,
    ratePercent: 66.6667,
  });
  assert.deepEqual(group.target, {
    definition: "mfePercent > 1",
    thresholdPercent: 1,
    hits: 2,
    misses: 1,
    ratePercent: 66.6667,
  });
  assert.equal(group.outcome.directionalReturnPercent.mean, 1);
  assert.equal(group.outcome.directionalReturnPercent.median, 1);
  assert.equal(group.outcome.mfePercent.mean, 7 / 3);
  assert.equal(group.outcome.maePercent.median, -1);
  assert.equal(group.outcome.effectDurationMs.mean, 2_000);
  assert.equal(group.evidence.level, SIGNAL_LAB_EVIDENCE_LEVELS.INSUFFICIENT);
  assert.ok(group.evidence.limitations.includes("partial-price-paths-excluded"));
  assert.ok(group.evidence.limitations.includes("unavailable-horizons"));
  assert.ok(group.evidence.limitations.includes("overdue-pending-horizons"));
  assert.equal(group.context.densityInteractionObserved, 1);
  assert.equal(group.context.densityImportance, "unrated");
});

test("formula versions and settings never share one statistical group", () => {
  const first = signalEvent({ id: "first", settings: { impulse15s: 0.35 } });
  const second = signalEvent({ id: "second", settings: { impulse15s: 0.5 } });
  const third = signalEvent({
    id: "third",
    formulaVersion: "radar-signals-v2",
    settings: { impulse15s: 0.35 },
  });

  const report = reportFor(
    [first, second, third],
    [observation(first), observation(second), observation(third)],
  );
  const groups = report.windows[0].signalGroups;

  assert.equal(groups.length, 3);
  assert.deepEqual(
    new Set(groups.map((group) => group.formula.version)),
    new Set(["radar-signals-v1", "radar-signals-v2"]),
  );
  assert.equal(new Set(groups.map((group) => group.formula.settingsKey)).size, 2);
});

test("market groups combine symbols while symbol groups keep coin histories separate", () => {
  const ether = signalEvent({ id: "ether", symbol: "ETHUSDT" });
  const bitcoin = signalEvent({ id: "bitcoin", symbol: "BTCUSDT" });
  const report = reportFor(
    [ether, bitcoin],
    [observation(ether), observation(bitcoin)],
  );

  assert.equal(report.windows[0].signalGroups.length, 1);
  assert.equal(report.windows[0].signalGroups[0].sample.usableLive, 2);
  assert.deepEqual(
    report.windows[0].symbolGroups.map((group) => group.symbol).sort(),
    ["BTCUSDT", "ETHUSDT"],
  );
});

test("lookback windows use signal time and do not leak older events into 1d", () => {
  const recent = signalEvent({ id: "recent", triggeredAt: NOW - (12 * 60 * 60 * 1_000) });
  const older = signalEvent({ id: "older", triggeredAt: NOW - (2 * DAY) });
  const report = buildSignalLabReport(
    {
      events: [recent, older],
      observations: [observation(recent), observation(older)],
      contexts: [],
    },
    { now: NOW },
  );

  assert.equal(report.windows.find((window) => window.key === "1d").counts.events, 1);
  assert.equal(report.windows.find((window) => window.key === "3d").counts.events, 2);
});

test("large density size is not promoted into importance or outcome statistics", () => {
  const event = signalEvent({ id: "density-event" });
  const context = signalContext(event, {
    orderBookObserved: true,
    episodes: [{
      interaction: "unobserved",
      importance: "unrated",
      currentQuote: 100_000_000,
    }],
  });
  const report = reportFor([event], [observation(event)], [context]);
  const serialized = JSON.stringify(report.windows[0].signalGroups[0]);

  assert.match(serialized, /"densityImportance":"unrated"/);
  assert.doesNotMatch(serialized, /100000000/);
  assert.ok(report.limitations.includes("density-size-is-not-importance"));
});

test("duplicate entity IDs are de-duplicated before aggregation", () => {
  const event = signalEvent({ id: "deduplicated" });
  const first = observation(event, { returnPercent: 1 });
  const replacement = observation(event, { returnPercent: 2 });
  const report = reportFor([event, event], [first, replacement]);
  const group = report.windows[0].signalGroups[0];

  assert.equal(report.source.eventCount, 1);
  assert.equal(report.source.observationCount, 1);
  assert.equal(group.sample.usableLive, 1);
  assert.equal(group.outcome.marketReturnPercent.mean, 2);
});

test("Signal Lab degrades safely when IndexedDB is unavailable", async () => {
  const store = new SignalLabLocalStore({ indexedDBFactory: null });
  const status = await store.initialize({ now: NOW });
  const persisted = await store.persist({
    events: [signalEvent({ id: "not-written" })],
    contexts: [],
    observations: [],
    resolvedObservations: [],
  });
  const report = await store.report({ now: NOW });

  assert.equal(status.state, "unavailable");
  assert.equal(persisted, false);
  assert.equal(report.source.storageState, "unavailable");
  assert.equal(report.source.eventCount, 0);
});

test("browser runtime wires persistent Signal Lab without adding destructive controls", async () => {
  const [app, serviceWorker, version] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
    readFile(new URL("../VERSION.txt", import.meta.url), "utf8"),
  ]);

  assert.match(app, /SignalLabLocalStore/);
  assert.match(app, /signalLab\.persist\(created/);
  assert.match(app, /inpulsSignalLab/);
  assert.doesNotMatch(app, /inpulsSignalLab[\s\S]{0,300}(clear|delete)/i);
  assert.match(serviceWorker, /signal-lab\.js\?v=signal-lab-analytics-v1/);
  assert.match(version, /signal-lab-analytics-v1/);
});
