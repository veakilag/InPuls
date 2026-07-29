import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

await import("../orderbook-density.js?density-lifecycle-tests");

const {
  DensityLifecycleTracker,
  computeSideReference,
  percentileSorted,
} = globalThis.InPulsOrderBookDensity;

const TEST_CONFIG = Object.freeze({
  sampleLevels: 10,
  minSampleLevels: 4,
  entryMedianMultiplier: 4,
  entryP90Multiplier: 1.1,
  exitThresholdRatio: 0.5,
  referenceRefreshMs: 0,
  fadeGraceMs: 100,
  transitionHoldMs: 1_000,
  replenishWindowMs: 1_000,
  replenishRestoreRatio: 0.8,
  closedRetentionMs: 100_000,
});

function depthFixture() {
  return {
    bids: new Map([
      [100, 1],
      [99.9, 1],
      [99.8, 20],
      [99.7, 1],
      [99.6, 1],
      [99.5, 1],
      [99.4, 1],
      [99.3, 1],
      [99.2, 1],
      [99.1, 1],
    ]),
    asks: new Map([
      [100.1, 1],
      [100.2, 1],
      [100.3, 1],
      [100.4, 25],
      [100.5, 1],
      [100.6, 1],
      [100.7, 1],
      [100.8, 1],
      [100.9, 1],
      [101, 1],
    ]),
  };
}

function seededTracker(options = {}) {
  const depth = depthFixture();
  const tracker = new DensityLifecycleTracker({
    symbol: "btcusdt",
    ...TEST_CONFIG,
    ...options,
  });
  tracker.reset({ bookEpoch: 7, reason: "start", at: 1_000 });
  tracker.seedSnapshot({
    ...depth,
    bookEpoch: 7,
    receivedAt: 1_010,
  });
  tracker.markReady({ at: 1_020 });
  return { tracker, ...depth };
}

test("density reference uses a robust per-side quote distribution", () => {
  assert.equal(percentileSorted([1, 2, 3, 4], 0.5), 2.5);
  const { bids } = depthFixture();
  const reference = computeSideReference(bids, "bid", TEST_CONFIG, 1_000);

  assert.equal(reference.available, true);
  assert.equal(reference.sampledLevels, 10);
  assert.ok(reference.medianQuote > 99);
  assert.ok(reference.entryQuote > reference.medianQuote);
  assert.ok(reference.exitQuote < reference.entryQuote);
  assert.ok(99.8 * 20 > reference.entryQuote);
});

test("snapshot seeds observed densities without fabricating depth events", () => {
  const { tracker } = seededTracker();
  const summary = tracker.summary(1_110);

  assert.equal(summary.state, "live");
  assert.equal(summary.bookEpoch, 7);
  assert.equal(summary.activeCount, 2);
  assert.equal(summary.quality.complete, true);
  assert.equal(summary.quality.causality, "probabilistic-depth-trade-correlation");
  assert.equal(summary.quality.importance, "not-scored-from-size");
  assert.deepEqual(
    summary.densities.map(({ side, price, state, source, observedBeforeDetection }) => ({
      side,
      price,
      state,
      source,
      observedBeforeDetection,
    })),
    [
      {
        side: "ask",
        price: 100.4,
        state: "standing",
        source: "snapshot",
        observedBeforeDetection: true,
      },
      {
        side: "bid",
        price: 99.8,
        state: "standing",
        source: "snapshot",
        observedBeforeDetection: true,
      },
    ],
  );
  assert.equal(summary.densities[0].ageMs, 100);
  assert.equal(summary.epochCounts.detected, 2);
  assert.equal(summary.epochCounts.removed, 0);
});

test("a density transitions through strengthening, weakening and replenished", () => {
  const { tracker } = seededTracker();
  tracker.ingest([{
    type: "increased",
    side: "bid",
    price: 99.8,
    previousQuantity: 20,
    quantity: 30,
    receivedAt: 1_100,
    bookEpoch: 7,
    continuity: "live",
    sequence: 1,
  }]);
  assert.equal(
    tracker.summary(1_100).densities.find((item) => item.side === "bid").state,
    "strengthening",
  );

  tracker.ingest([{
    type: "decreased",
    side: "bid",
    price: 99.8,
    previousQuantity: 30,
    quantity: 10,
    receivedAt: 1_200,
    bookEpoch: 7,
    continuity: "live",
    sequence: 2,
  }]);
  assert.equal(
    tracker.summary(1_200).densities.find((item) => item.side === "bid").state,
    "weakening",
  );

  tracker.ingest([{
    type: "increased",
    side: "bid",
    price: 99.8,
    previousQuantity: 10,
    quantity: 25,
    receivedAt: 1_300,
    bookEpoch: 7,
    continuity: "live",
    sequence: 3,
  }]);
  const density = tracker.summary(1_300).densities.find((item) => item.side === "bid");
  assert.equal(density.state, "replenished");
  assert.equal(density.currentQuantity, 25);
  assert.equal(density.maxQuantity, 30);
  assert.equal(density.replenishmentCount, 1);
  assert.equal(density.lastReplenishedAt, 1_300);
  assert.equal(tracker.summary(1_300).epochCounts.replenished, 1);
});

test("a zero quantity closes a density as removed without claiming execution", () => {
  const { tracker } = seededTracker();
  tracker.ingest([{
    type: "removed",
    side: "ask",
    price: 100.4,
    previousQuantity: 25,
    quantity: 0,
    receivedAt: 1_200,
    bookEpoch: 7,
    continuity: "live",
    sequence: 4,
  }]);
  const summary = tracker.summary(1_250);

  assert.equal(summary.activeCount, 1);
  assert.equal(summary.recentlyClosed.length, 1);
  assert.equal(summary.recentlyClosed[0].state, "removed");
  assert.equal(summary.recentlyClosed[0].closeReason, "removed");
  assert.equal(summary.quality.causality, "probabilistic-depth-trade-correlation");
  assert.equal(summary.epochCounts.removed, 1);
});

test("hysteresis closes a weakened level only after the fade grace window", () => {
  const { tracker, bids, asks } = seededTracker();
  tracker.ingest([{
    type: "decreased",
    side: "bid",
    price: 99.8,
    previousQuantity: 20,
    quantity: 1,
    receivedAt: 1_200,
    bookEpoch: 7,
    continuity: "live",
    sequence: 5,
  }]);
  bids.set(99.8, 1);

  tracker.refresh({ bids, asks, now: 1_250, force: true });
  assert.equal(tracker.summary(1_250).activeCount, 2);
  tracker.refresh({ bids, asks, now: 1_350, force: true });
  const summary = tracker.summary(1_350);
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.recentlyClosed[0].state, "faded");
  assert.equal(summary.recentlyClosed[0].closeReason, "below-threshold");
});

test("gap reset and partial fallback cannot leak lifecycle state", () => {
  const { tracker } = seededTracker();
  tracker.reset({ bookEpoch: 8, reason: "sequence-gap", at: 2_000 });
  let summary = tracker.summary(2_010);
  assert.equal(summary.state, "syncing");
  assert.equal(summary.bookEpoch, 8);
  assert.equal(summary.activeCount, 0);
  assert.equal(summary.recentlyClosed.length, 0);
  assert.equal(summary.epochCounts.detected, 0);
  assert.equal(summary.totalCounts.detected, 2);

  tracker.markUnavailable("partial-depth", 2_020);
  summary = tracker.summary(2_030);
  assert.equal(summary.state, "partial");
  assert.equal(summary.quality.complete, false);
  assert.equal(summary.references.bid.available, false);
  assert.equal(summary.references.ask.available, false);
});

test("Legacy symbol changes reset cross-symbol lifetime counters", () => {
  const { tracker } = seededTracker();
  assert.equal(tracker.summary(1_100).totalCounts.detected, 2);
  tracker.setSymbol("ETHUSDT");
  tracker.reset({ bookEpoch: 8, reason: "symbol-change", at: 2_000 });

  const summary = tracker.summary(2_010);
  assert.equal(summary.symbol, "ETHUSDT");
  assert.equal(summary.totalCounts.detected, 0);
  assert.equal(summary.activeCount, 0);
});

test("active and serialized density collections stay bounded", () => {
  const { tracker } = seededTracker({
    maxActive: 2,
    maxClosed: 2,
    summaryLimit: 1,
    closedSummaryLimit: 1,
  });
  tracker.ingest([
    {
      type: "appeared",
      side: "bid",
      price: 99.7,
      previousQuantity: 0,
      quantity: 20,
      receivedAt: 1_100,
      bookEpoch: 7,
      sequence: 6,
    },
    {
      type: "appeared",
      side: "ask",
      price: 100.5,
      previousQuantity: 0,
      quantity: 20,
      receivedAt: 1_110,
      bookEpoch: 7,
      sequence: 7,
    },
  ]);
  const summary = tracker.summary(1_120);

  assert.equal(summary.activeCount, 2);
  assert.equal(summary.densities.length, 1);
  assert.ok(summary.retainedClosed <= 2);
  assert.ok(summary.recentlyClosed.length <= 1);
  assert.ok(summary.epochCounts.capacity >= 1);
});

test("Worker and Legacy fallback share the density lifecycle contract", async () => {
  const [worker, runtime, serviceWorker] = await Promise.all([
    readFile(new URL("../orderbook-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../orderbook.js", import.meta.url), "utf8"),
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(worker, /importScripts\("\.\/orderbook-density\.js\?v=density-trades-correlation-v1"\)/);
  assert.match(runtime, /import "\.\/orderbook-density\.js\?v=density-trades-correlation-v1"/);
  assert.match(worker, /this\.densityLifecycle\.seedSnapshot\(/);
  assert.match(runtime, /this\.densityLifecycle\.seedSnapshot\(/);
  assert.match(worker, /this\.densityLifecycle\.ingest\(bookEvents\)/);
  assert.match(runtime, /this\.densityLifecycle\.ingest\(bookEvents\)/);
  assert.match(worker, /densityLifecycle: this\.densityLifecycle\.summary\(now\)/);
  assert.match(runtime, /densityLifecycle: this\.densityLifecycle\.summary\(densityNow\)/);
  assert.match(worker, /this\.densityLifecycle\.markUnavailable\("partial-depth"\)/);
  assert.equal(
    runtime.match(/this\.densityLifecycle\.markUnavailable\("partial-depth"\)/g)?.length,
    2,
  );
  assert.match(serviceWorker, /orderbook-density\.js\?v=density-trades-correlation-v1/);
});
