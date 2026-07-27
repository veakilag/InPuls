import test from "node:test";
import assert from "node:assert/strict";

test("observability stays disabled without an explicit runtime flag", async () => {
  const { observability } = await import("../observability.js?disabled-test");
  assert.equal(observability.enabled, false);
  observability.record("ignored", 12);
  assert.deepEqual(observability.snapshot().metrics, {});
});

test("observability aggregates bounded percentile samples when enabled", async () => {
  const previousLocation = globalThis.location;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.location = { search: "?obs=1" };
  globalThis.requestAnimationFrame = () => 1;
  try {
    const { observability } = await import("../observability.js?enabled-test");
    assert.equal(observability.enabled, true);
    observability.record("render", 1);
    observability.record("render", 2);
    observability.record("render", 100);
    const metric = observability.snapshot().metrics.render;
    assert.deepEqual(metric, { count: 3, p50: 2, p95: 2, p99: 2, max: 100 });
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

test("worker timing metadata is converted into end-to-end metrics", async () => {
  const previousLocation = globalThis.location;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.location = { search: "?obs=1" };
  globalThis.requestAnimationFrame = () => 1;
  try {
    const { observability } = await import("../observability.js?worker-test");
    const receivedAtMonotonic = performance.now();
    const receivedAtEpoch = Date.now();
    observability.workerMessage({
      type: "data",
      symbol: "BTCUSDT",
      __obs: {
        sentAtEpochMs: receivedAtEpoch - 4,
        processMs: 2,
        observerOverheadMs: .2,
        payloadBytes: 4096,
        sourceClockOffsetMs: 0,
        sourceEventTimeMs: receivedAtEpoch - 10,
        sourceKind: "live-depth",
      },
    }, receivedAtMonotonic, receivedAtEpoch);
    observability.rendered("BTCUSDT", "ladder", receivedAtMonotonic + 3);
    observability.rendered("BTCUSDT", "ladder", receivedAtMonotonic + 8);
    const snapshot = observability.snapshot();
    assert.equal(snapshot.metrics["worker.post-to-main"].p50, 4);
    assert.equal(snapshot.metrics["worker.process"].p50, 2);
    assert.equal(snapshot.metrics["worker.observer-overhead"].p50, .2);
    assert.equal(snapshot.metrics["worker.payload-bytes"].p50, 4096);
    assert.equal(snapshot.metrics["source-to-main"].p50, 10);
    assert.equal(snapshot.metrics["main-to-render"].count, 1);
    assert.equal(snapshot.metrics["main-to-render"].p50, 3);
    assert.deepEqual(
      snapshot.metricsByTags["worker.post-to-main"][0].tags,
      { type: "data", symbol: "BTCUSDT", source: "live-depth" },
    );
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

test("worker flow diagnostics become per-symbol backpressure metrics", async () => {
  const previousLocation = globalThis.location;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.location = { search: "?obs=1" };
  globalThis.requestAnimationFrame = () => 1;
  try {
    const { observability } = await import("../observability.js?worker-flow-test");
    const now = Date.now();
    observability.workerMessage({
      type: "diagnostic",
      symbol: "SOLUSDT",
      diagnostic: {
        phase: "worker.flow",
        state: "sampled",
        atEpochMs: now,
        depthEventsPerSecond: 10,
        tradeEventsPerSecond: 25,
        depthProcessMeanMs: .2,
        depthProcessMaxMs: 1.5,
        tradeProcessMeanMs: .1,
        tradeProcessMaxMs: .8,
        tapeQueue: 4,
        depthSourceLagMs: 35,
        tradeSourceLagMs: 42,
      },
      __obs: {
        sentAtEpochMs: now,
        processMs: null,
        observerOverheadMs: 0,
        payloadBytes: null,
        sourceClockOffsetMs: 0,
        sourceEventTimeMs: null,
        sourceKind: null,
      },
    }, performance.now(), now);
    const snapshot = observability.snapshot();
    assert.equal(snapshot.metrics["worker.trade-events-per-second"].p50, 25);
    assert.equal(snapshot.metrics["worker.tape-queue"].p50, 4);
    assert.equal(
      snapshot.metricsByTags["worker.trade-source-lag"][0].tags.symbol,
      "SOLUSDT",
    );
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});

test("capture exports connection phases, render skips and five-second intervals", async () => {
  const previousLocation = globalThis.location;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.location = { search: "?obs=1" };
  globalThis.requestAnimationFrame = () => 1;
  try {
    const { observability } = await import("../observability.js?timeline-test");
    const receivedAtEpoch = Date.now();
    observability.workerMessage({
      type: "diagnostic",
      symbol: "ETHUSDT",
      diagnostic: {
        phase: "depth.snapshot.host",
        state: "failed",
        host: "fapi2.binance.com",
        errorKind: "network-or-cors",
        durationMs: 125,
        atEpochMs: receivedAtEpoch,
      },
      __obs: {
        sentAtEpochMs: receivedAtEpoch - 2,
        processMs: null,
        observerOverheadMs: .1,
        payloadBytes: null,
        sourceClockOffsetMs: 0,
        sourceEventTimeMs: null,
        sourceKind: null,
      },
    }, performance.now(), receivedAtEpoch);
    observability.skipRender("tape", "stream-not-live", { symbol: "ETHUSDT" });
    observability.record("app.render", 12);

    const snapshot = observability.snapshot();
    assert.equal(snapshot.version, 2);
    assert.ok(snapshot.capture.durationMs >= 0);
    assert.equal(snapshot.connectionEvents[0].name, "depth.snapshot.host");
    assert.equal(snapshot.connectionEvents[0].details.errorKind, "network-or-cors");
    assert.equal(snapshot.renderSkips[0].reason, "stream-not-live");
    assert.equal(snapshot.renderSkips[0].count, 1);
    assert.ok(snapshot.intervals.length >= 1);
    assert.equal(snapshot.intervals[0].metrics["app.render"].count, 1);
    assert.equal(snapshot.metrics["worker.process"], undefined);
    assert.equal(snapshot.metrics["worker.payload-bytes"], undefined);
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});
