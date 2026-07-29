import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DATA_QUALITY_STATES,
  OBSERVATION_STATES,
  SIGNAL_FORMULA_VERSION,
  SIGNAL_OBSERVATION_HORIZONS,
  SignalMemoryTracker,
  createPendingSignalObservations,
  createSignalContext,
  createSignalEvent,
} from "../market-memory.js";

function metrics(now = 1_000, signals = [{
  type: "impulse",
  label: "ИМПУЛЬС",
  direction: "up",
  reason: "+0.50% за 15с · объём ×3.0",
  priority: 70,
}]) {
  return {
    symbol: "ETHUSDT",
    price: 100,
    updatedAt: now,
    lastTradeAt: now - 100,
    change15s: 0.5,
    change1m: 0.8,
    change5m: 1.2,
    change24h: 2.5,
    quoteVolume24h: 1_000_000_000,
    turnoverPerMinute: 2_000_000,
    volumeBoost: 3,
    range60s: { min: 99.5, max: 100.2, percent: 0.7 },
    range5m: { min: 98.8, max: 100.2, percent: 1.4 },
    trades: { tps: 42, buy: 700_000, sell: 300_000, buyShare: 70 },
    liquidation: { longs: 10_000, shorts: 20_000, total: 30_000 },
    fundingRate: 0.0001,
    nextFundingTime: now + 3_600_000,
    natr1m: 0.4,
    natr5m: 0.7,
    correlation: 0.65,
    score: 76,
    signals,
  };
}

function eventFixture(now = 1_000) {
  return createSignalEvent({
    id: `binance-usdm:ETHUSDT:impulse:${now}:1`,
    metrics: metrics(now),
    signal: metrics(now).signals[0],
    settings: { impulse15s: 0.35, volumeBoost: 2.5 },
    now,
  });
}

test("SignalEvent is an immutable formula-versioned snapshot without future results", () => {
  const event = eventFixture();

  assert.equal(event.entity, "SignalEvent");
  assert.equal(event.formula.version, SIGNAL_FORMULA_VERSION);
  assert.deepEqual(event.formula.settings, { impulse15s: 0.35, volumeBoost: 2.5 });
  assert.equal("returnPercent" in event, false);
  assert.equal("mfePercent" in event, false);
  assert.throws(() => {
    event.price = 101;
  }, TypeError);
});

test("SignalContext keeps current facts separate and marks unavailable inputs partial", () => {
  const event = eventFixture();
  const context = createSignalContext({
    event,
    metrics: metrics(),
    btcMetrics: {
      symbol: "BTCUSDT",
      price: 60_000,
      updatedAt: 1_000,
      change15s: 0.1,
      change1m: 0.2,
      change5m: 0.4,
    },
    now: 1_000,
  });

  assert.equal(context.entity, "SignalContext");
  assert.equal(context.eventId, event.id);
  assert.equal(context.market.volumeAcceleration, 3);
  assert.equal(context.trades.tradesPerSecond, 42);
  assert.equal(context.openInterest.value, null);
  assert.equal(context.openInterest.state, DATA_QUALITY_STATES.PARTIAL);
  assert.equal(context.marketRegime.label, null);
  assert.equal(context.liquidity.observed, false);
  assert.equal(context.quality.overall, DATA_QUALITY_STATES.PARTIAL);
  assert.equal("returnPercent" in context, false);
});

test("context includes observed density interactions but excludes untouched size-only candidates", () => {
  const event = eventFixture();
  const candidate = {
    id: "7:ask:100.4",
    side: "ask",
    price: 100.4,
    interaction: "unobserved",
    resolution: "active",
    evidenceTier: "candidate",
    evidenceQuality: "none",
    importance: "unrated",
  };
  const touched = {
    id: "7:bid:99.8",
    side: "bid",
    price: 99.8,
    interaction: "partially_filled",
    resolution: "active",
    evidenceTier: "correlated",
    evidenceQuality: "medium",
    importance: "unrated",
    touchCount: 2,
    correlatedFillQuote: 50_000,
    executionCoverageRatio: 0.8,
  };
  const context = createSignalContext({
    event,
    metrics: metrics(),
    now: 1_000,
    orderBook: {
      bestBid: 99.9,
      bestAsk: 100.1,
      eventTime: 1_000,
      coverage: { bidPercent: 1.1, askPercent: 1.2 },
      bookLevels: { bids: 2_000, asks: 2_100 },
      densityLifecycle: {
        venue: "binance-usdm",
        state: "live",
        bookEpoch: 7,
        computedAt: 1_000,
        densities: [candidate, touched],
        recentlyClosed: [],
        quality: {
          complete: true,
          depth: "live",
          trades: "observed",
          tradeSources: ["agg"],
          causality: "probabilistic-depth-trade-correlation",
          attribution: "aggregate-price-level-not-order-id",
        },
      },
    },
  });

  assert.equal(context.liquidity.state, DATA_QUALITY_STATES.LIVE);
  assert.equal(context.liquidity.episodes.length, 1);
  assert.equal(context.liquidity.episodes[0].id, touched.id);
  assert.equal(context.liquidity.episodes[0].importance, "unrated");
  assert.equal(context.liquidity.quality.importance, "not-scored-from-size");
});

test("SignalObservation starts pending at the exact 15s, 1m, 3m and 5m horizons", () => {
  const event = eventFixture();
  const observations = createPendingSignalObservations({ event, now: 1_000 });

  assert.deepEqual(
    observations.map(({ horizon, horizonMs }) => ({ horizon, horizonMs })),
    SIGNAL_OBSERVATION_HORIZONS
      .map(({ key, durationMs }) => ({ horizon: key, horizonMs: durationMs })),
  );
  assert.ok(observations.every((item) => item.state === OBSERVATION_STATES.PENDING));
  assert.ok(observations.every((item) => item.finalPrice === null));
  assert.ok(observations.every((item) => item.mfePercent === null && item.maePercent === null));
});

test("tracker emits once for a continuous signal and rearms only after a real absence", () => {
  const tracker = new SignalMemoryTracker({ releaseAfterMs: 2_000 });

  const first = tracker.ingest({ metrics: [metrics(1_000)], now: 1_000 });
  const duplicate = tracker.ingest({ metrics: [metrics(1_500)], now: 1_500 });
  tracker.ingest({ metrics: [metrics(4_000, [])], now: 4_000 });
  const shortAbsence = tracker.ingest({ metrics: [metrics(4_100)], now: 4_100 });
  tracker.ingest({ metrics: [metrics(5_000, [])], now: 5_000 });
  const rearmed = tracker.ingest({ metrics: [metrics(7_100)], now: 7_100 });

  assert.equal(first.events.length, 1);
  assert.equal(first.contexts.length, 1);
  assert.equal(first.observations.length, 4);
  assert.equal(duplicate.events.length, 0);
  assert.equal(shortAbsence.events.length, 0);
  assert.equal(rearmed.events.length, 1);
  assert.notEqual(rearmed.events[0].id, first.events[0].id);
  assert.deepEqual(tracker.summary(), {
    schemaVersion: 1,
    events: 2,
    contexts: 2,
    observations: 8,
    pendingObservations: 8,
    activeSignals: 1,
    formulaVersion: SIGNAL_FORMULA_VERSION,
  });
});

test("a long render pause does not fabricate an absence or duplicate a continuous signal", () => {
  const tracker = new SignalMemoryTracker({ releaseAfterMs: 2_000 });

  tracker.ingest({ metrics: [metrics(1_000)], now: 1_000 });
  const afterPause = tracker.ingest({ metrics: [metrics(20_000)], now: 20_000 });

  assert.equal(afterPause.events.length, 0);
  assert.equal(tracker.summary().events, 1);
});

test("a settings change creates a new formula snapshot even if the signal stays active", () => {
  const tracker = new SignalMemoryTracker();
  const first = tracker.ingest({
    metrics: [metrics(1_000)],
    settings: { impulse15s: 0.35 },
    now: 1_000,
  });
  const changed = tracker.ingest({
    metrics: [metrics(1_100)],
    settings: { impulse15s: 0.5 },
    now: 1_100,
  });

  assert.equal(first.events.length, 1);
  assert.equal(changed.events.length, 1);
  assert.deepEqual(first.events[0].formula.settings, { impulse15s: 0.35 });
  assert.deepEqual(changed.events[0].formula.settings, { impulse15s: 0.5 });
});

test("tracker does not create new signal facts from stale market snapshots", () => {
  const tracker = new SignalMemoryTracker();
  const stale = metrics(1_000);
  stale.updatedAt = 1_000;

  const created = tracker.ingest({ metrics: [stale], now: 10_000 });

  assert.equal(created.events.length, 0);
  assert.equal(tracker.summary().events, 0);
});

test("browser runtime captures the contract and ships it in the atomic app shell", async () => {
  const [app, serviceWorker, version] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
    readFile(new URL("../VERSION.txt", import.meta.url), "utf8"),
  ]);

  assert.match(app, /SignalMemoryTracker/);
  assert.match(app, /updateSignalMemory\(metrics, now\)/);
  assert.match(app, /contextForSymbol: latestOrderBookForSignalMemory/);
  assert.match(serviceWorker, /market-memory\.js\?v=signal-memory-contract-v1/);
  assert.match(version, /signal-memory-contract-v1/);
});
