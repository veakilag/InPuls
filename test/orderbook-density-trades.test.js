import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

await import("../orderbook-density.js?density-trades-correlation-tests");

const { DensityLifecycleTracker } = globalThis.InPulsOrderBookDensity;

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
  correlationWindowMs: 100,
  settlementDelayMs: 120,
  consumedCoverageRatio: 0.75,
  reactionWindowMs: 1_000,
  moveWindowMs: 500,
  moveLeadGraceMs: 50,
  moveMaxDistanceBps: 25,
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

function seededTracker() {
  const depth = depthFixture();
  const tracker = new DensityLifecycleTracker({
    symbol: "BTCUSDT",
    ...TEST_CONFIG,
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

function trade({
  id,
  side,
  price,
  quantity,
  receivedAt,
}) {
  return {
    id,
    firstTradeId: id,
    lastTradeId: id,
    source: "agg",
    side,
    price,
    quantity,
    quote: price * quantity,
    time: receivedAt,
    eventTime: receivedAt,
    receivedAt,
  };
}

function density(summary, side, price) {
  return [...summary.densities, ...summary.recentlyClosed]
    .find((item) => item.side === side && item.price === price);
}

test("size alone remains an unrated candidate without claiming importance", () => {
  const { tracker } = seededTracker();
  const ask = density(tracker.summary(1_100), "ask", 100.4);

  assert.equal(ask.interaction, "unobserved");
  assert.equal(ask.resolution, "active");
  assert.equal(ask.importance, "unrated");
  assert.equal(ask.evidenceTier, "candidate");
  assert.equal(ask.evidenceQuality, "none");
});

test("only the correct aggressor touching the exact density price is correlated", () => {
  const { tracker } = seededTracker();
  tracker.ingestTrades([
    trade({ id: 1, side: "sell", price: 100.4, quantity: 2, receivedAt: 1_100 }),
    trade({ id: 2, side: "buy", price: 100.5, quantity: 2, receivedAt: 1_110 }),
  ]);
  let ask = density(tracker.summary(1_120), "ask", 100.4);
  assert.equal(ask.interaction, "unobserved");

  tracker.ingestTrades([
    trade({ id: 3, side: "buy", price: 100.4, quantity: 2, receivedAt: 1_130 }),
  ]);
  ask = density(tracker.summary(1_140), "ask", 100.4);

  assert.equal(ask.interaction, "touched");
  assert.equal(ask.evidenceTier, "observed");
  assert.equal(ask.touchCount, 1);
  assert.equal(ask.matchedTradeQuantity, 2);
  assert.equal(ask.correlatedFillQuantity, 0);
});

test("matching executions plus a remaining level classify a partial fill", () => {
  const { tracker } = seededTracker();
  tracker.ingestTrades([
    trade({ id: 10, side: "sell", price: 99.8, quantity: 5, receivedAt: 1_100 }),
  ]);
  tracker.ingest([{
    type: "decreased",
    side: "bid",
    price: 99.8,
    previousQuantity: 20,
    quantity: 15,
    receivedAt: 1_150,
    bookEpoch: 7,
    continuity: "live",
    sequence: 1,
  }]);
  const bid = density(tracker.summary(1_300), "bid", 99.8);

  assert.equal(bid.interaction, "partially_filled");
  assert.equal(bid.resolution, "active");
  assert.equal(bid.evidenceTier, "correlated");
  assert.equal(bid.correlatedFillQuantity, 5);
  assert.equal(bid.executionCoverageRatio, 1);
});

test("a removed level is consumed only when matching executions cover it", () => {
  const { tracker } = seededTracker();
  tracker.ingestTrades([
    trade({ id: 20, side: "buy", price: 100.4, quantity: 25, receivedAt: 1_100 }),
  ]);
  tracker.ingest([{
    type: "removed",
    side: "ask",
    price: 100.4,
    previousQuantity: 25,
    quantity: 0,
    receivedAt: 1_150,
    bookEpoch: 7,
    continuity: "live",
    sequence: 2,
  }]);
  const ask = density(tracker.summary(1_300), "ask", 100.4);

  assert.equal(ask.interaction, "consumed");
  assert.equal(ask.resolution, "consumed");
  assert.equal(ask.evidenceQuality, "strong");
  assert.equal(ask.executionCoverageRatio, 1);
  assert.equal(ask.unmatchedReductionQuantity, 0);
});

test("a trade arriving after the depth decrease still correlates inside the window", () => {
  const { tracker } = seededTracker();
  tracker.ingest([{
    type: "decreased",
    side: "ask",
    price: 100.4,
    previousQuantity: 25,
    quantity: 20,
    receivedAt: 1_100,
    bookEpoch: 7,
    continuity: "live",
    sequence: 21,
  }]);
  tracker.ingestTrades([
    trade({ id: 21, side: "buy", price: 100.4, quantity: 5, receivedAt: 1_150 }),
  ]);
  const ask = density(tracker.summary(1_250), "ask", 100.4);

  assert.equal(ask.interaction, "partially_filled");
  assert.equal(ask.correlatedFillQuantity, 5);
  assert.equal(ask.executionCoverageRatio, 1);
});

test("a removal without matching executions settles as pulled", () => {
  const { tracker } = seededTracker();
  tracker.ingest([{
    type: "removed",
    side: "ask",
    price: 100.4,
    previousQuantity: 25,
    quantity: 0,
    receivedAt: 1_100,
    bookEpoch: 7,
    continuity: "live",
    sequence: 3,
  }]);
  const ask = density(tracker.summary(1_250), "ask", 100.4);

  assert.equal(ask.interaction, "unobserved");
  assert.equal(ask.resolution, "pulled");
  assert.equal(ask.evidenceTier, "observed");
  assert.equal(ask.unmatchedReductionQuantity, 25);
});

test("a nearby similar replacement is marked moved only as a low-confidence heuristic", () => {
  const { tracker } = seededTracker();
  tracker.ingest([{
    type: "removed",
    side: "ask",
    price: 100.4,
    previousQuantity: 25,
    quantity: 0,
    receivedAt: 1_100,
    bookEpoch: 7,
    continuity: "live",
    sequence: 4,
  }]);
  tracker.ingest([{
    type: "appeared",
    side: "ask",
    price: 100.5,
    previousQuantity: 0,
    quantity: 25,
    receivedAt: 1_150,
    bookEpoch: 7,
    continuity: "live",
    sequence: 5,
  }]);
  const summary = tracker.summary(1_250);
  const origin = density(summary, "ask", 100.4);
  const replacement = density(summary, "ask", 100.5);

  assert.equal(origin.resolution, "moved");
  assert.equal(origin.evidenceQuality, "low");
  assert.equal(origin.move.toPrice, 100.5);
  assert.equal(origin.move.confidence, "low");
  assert.equal(replacement.move.fromPrice, 100.4);
});

test("gap reset and partial depth clear correlation evidence", () => {
  const { tracker } = seededTracker();
  tracker.ingestTrades([
    trade({ id: 30, side: "buy", price: 100.4, quantity: 1, receivedAt: 1_100 }),
  ]);
  assert.equal(tracker.summary(1_110).correlationCounts.touched, 1);

  tracker.reset({ bookEpoch: 8, reason: "sequence-gap", at: 2_000 });
  let summary = tracker.summary(2_010);
  assert.equal(summary.correlationCounts.touched, 0);
  assert.equal(summary.quality.trades, "none");

  tracker.markUnavailable("partial-depth", 2_020);
  summary = tracker.summary(2_030);
  assert.equal(summary.state, "partial");
  assert.equal(summary.quality.complete, false);
  assert.equal(summary.correlationCounts.unobserved, 0);
});

test("Worker and Legacy fallback ingest the same accepted trades into density correlation", async () => {
  const [worker, runtime] = await Promise.all([
    readFile(new URL("../orderbook-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../orderbook.js", import.meta.url), "utf8"),
  ]);

  assert.match(worker, /this\.densityLifecycle\.ingestTrades\(\[trade\]\)/);
  assert.equal(
    runtime.match(/this\.densityLifecycle\.ingestTrades\(\[trade\]\)/g)?.length,
    2,
  );
  assert.match(worker, /if \(matchedDensities\.length\) this\.markDirty\(\)/);
  assert.equal(
    runtime.match(/if \(matchedDensities\.length\) this\.#emit\(/g)?.length,
    2,
  );
});
