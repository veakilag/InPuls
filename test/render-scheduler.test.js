import test from "node:test";
import assert from "node:assert/strict";
import { LatestFrameScheduler } from "../render-scheduler.js";

function schedulerHarness(options = {}) {
  let clock = 0;
  let nextHandle = 1;
  const frames = new Map();
  const rendered = [];
  const frameMetrics = [];
  const scheduler = new LatestFrameScheduler({
    render(item, metadata) {
      rendered.push({ item, metadata });
      clock += options.renderCostMs ?? 0;
    },
    budgetMs: options.budgetMs ?? 8,
    maxPerFrame: options.maxPerFrame ?? 2,
    now: () => clock,
    requestFrame(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      frames.delete(handle);
    },
    onFrame(metrics) {
      frameMetrics.push(metrics);
    },
  });

  return {
    scheduler,
    rendered,
    frameMetrics,
    advance(ms) {
      clock += ms;
    },
    runFrame() {
      const [handle, callback] = frames.entries().next().value ?? [];
      assert.ok(handle, "expected a scheduled animation frame");
      frames.delete(handle);
      callback(clock);
    },
    get scheduledFrames() {
      return frames.size;
    },
  };
}

test("latest scheduler coalesces repeated data for one panel", () => {
  const harness = schedulerHarness();
  const panel = { id: "BTC" };
  assert.equal(harness.scheduler.schedule(panel), true);
  assert.equal(harness.scheduler.schedule(panel), false);
  assert.equal(harness.scheduler.schedule(panel), false);
  assert.equal(harness.scheduler.pending, 1);

  harness.runFrame();

  assert.deepEqual(harness.rendered.map(({ item }) => item.id), ["BTC"]);
  assert.equal(harness.frameMetrics[0].coalesced, 2);
  assert.equal(harness.scheduler.pending, 0);
});

test("frame budget yields remaining panels to the next frame", () => {
  const harness = schedulerHarness({ renderCostMs: 5, budgetMs: 8, maxPerFrame: 4 });
  for (const id of ["BTC", "ETH", "SOL", "XRP"]) harness.scheduler.schedule({ id });

  harness.runFrame();
  assert.deepEqual(harness.rendered.map(({ item }) => item.id), ["BTC", "ETH"]);
  assert.equal(harness.frameMetrics[0].yielded, true);
  assert.equal(harness.frameMetrics[0].pending, 2);
  assert.equal(harness.scheduledFrames, 1);

  harness.runFrame();
  assert.deepEqual(harness.rendered.map(({ item }) => item.id), ["BTC", "ETH", "SOL", "XRP"]);
  assert.equal(harness.frameMetrics[1].yielded, false);
});

test("urgent interaction moves an already queued panel to the front", () => {
  const harness = schedulerHarness({ maxPerFrame: 2 });
  const btc = { id: "BTC" };
  const eth = { id: "ETH" };
  const sol = { id: "SOL" };
  harness.scheduler.schedule(btc);
  harness.scheduler.schedule(eth);
  harness.scheduler.schedule(sol);
  harness.advance(3);
  harness.scheduler.schedule(sol, { urgent: true });

  harness.runFrame();

  assert.deepEqual(harness.rendered.map(({ item }) => item.id), ["SOL", "BTC"]);
  assert.equal(harness.rendered[0].metadata.urgent, true);
  assert.equal(harness.rendered[0].metadata.waitMs, 3);
});

test("removed panels never render from a stale queue entry", () => {
  const harness = schedulerHarness();
  const panel = { id: "BTC" };
  harness.scheduler.schedule(panel);
  assert.equal(harness.scheduler.remove(panel), true);

  harness.runFrame();

  assert.deepEqual(harness.rendered, []);
  assert.equal(harness.scheduler.pending, 0);
});
