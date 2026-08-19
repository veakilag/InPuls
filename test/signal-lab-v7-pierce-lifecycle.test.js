import test from "node:test";
import assert from "node:assert/strict";
import { manualLevelLifecycle } from "../signal-lab-v7-review-level-lifecycle.js";

const BASE = Date.UTC(2026, 7, 7, 0, 0, 0);
const STEP = 60_000;
function candle(index, open, high, low, close) {
  return { time: BASE + index * STEP, closeTime: BASE + (index + 1) * STEP - 1, open, high, low, close, volume: 1, closed: true };
}
const common = { side: "HIGH", price: 105, extremeAt: BASE, tickSize: 0.1, reversalThresholdPct: 1, rearmDistanceFactor: 0.5, acceptanceBars: 2 };

test("near miss is not an attack", () => {
  const result = manualLevelLifecycle({ ...common, candles: [candle(1, 104, 104.4, 103, 103.5), candle(2, 103.5, 104.9, 103.2, 104.7)] });
  assert.equal(result.retestCount, 0);
  assert.equal(result.touchCount, 1);
});

test("exact price after rearm is a new attack", () => {
  const result = manualLevelLifecycle({ ...common, candles: [candle(1, 104, 104.4, 103, 103.5), candle(2, 103.5, 105, 103.2, 104.7)] });
  assert.equal(result.retestCount, 1);
  assert.equal(result.touchCount, 2);
});

test("pierce that closes back is rejected, not a break", () => {
  const result = manualLevelLifecycle({ ...common, candles: [candle(1, 104, 104.4, 103, 103.5), candle(2, 103.5, 105.1, 103.2, 104.9)] });
  assert.equal(result.active, true);
  assert.equal(result.crossedAt, null);
  assert.equal(result.rejectedPierceCount, 1);
  assert.equal(result.pierces.length, 1);
});

test("accepted break needs persistence beyond the level", () => {
  const result = manualLevelLifecycle({ ...common, candles: [candle(1, 104, 104.4, 103, 103.5), candle(2, 103.5, 105.2, 103.2, 105.1), candle(3, 105.1, 105.4, 105.0, 105.2)] });
  assert.equal(result.active, false);
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.crossedAt, BASE + 4 * STEP - 1);
});

test("rejected pierce can be followed by a later second break attempt", () => {
  const result = manualLevelLifecycle({ ...common, candles: [
    candle(1, 104, 104.4, 103, 103.5),
    candle(2, 103.5, 105.1, 103.2, 104.9),
    candle(3, 104.9, 103.8, 102.8, 103.2),
    candle(4, 103.2, 105.2, 103.0, 105.1),
    candle(5, 105.1, 105.4, 105.0, 105.2),
  ] });
  assert.equal(result.pierces.length, 2);
  assert.equal(result.rejectedPierceCount, 1);
  assert.equal(result.active, false);
});
