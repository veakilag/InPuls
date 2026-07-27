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
    const receivedAt = performance.now();
    observability.workerMessage({
      type: "data",
      symbol: "BTCUSDT",
      __obs: {
        sentAt: receivedAt - 4,
        processMs: 2,
        observerOverheadMs: .2,
        payloadBytes: 4096,
        exchangeEventTime: Date.now() - 10,
      },
    }, receivedAt);
    const snapshot = observability.snapshot();
    assert.equal(snapshot.metrics["worker.post-to-main"].p50, 4);
    assert.equal(snapshot.metrics["worker.process"].p50, 2);
    assert.equal(snapshot.metrics["worker.observer-overhead"].p50, .2);
    assert.equal(snapshot.metrics["worker.payload-bytes"].p50, 4096);
    assert.ok(snapshot.metrics["exchange-to-main"].p50 >= 10);
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});
