import test from "node:test";
import assert from "node:assert/strict";

import { createCascadeStrategy } from "./algo-cascade-strategy.js";

function longCandles(extrema = [100, 101, 102]) {
  const candles = Array.from({ length: 50 }, (_, index) => {
    const price = 95 + index * 0.01;
    return { time: index * 60_000, open: price, high: price + 0.4, low: price - 0.4, close: price + 0.1, volume: 10 };
  });
  [10, 20, 30].forEach((index, position) => { candles[index].high = extrema[position]; });
  candles[40] = { time: 40 * 60_000, open: 101.7, high: 102.8, low: 101.5, close: 102.4, volume: 12 };
  candles[41] = { time: 41 * 60_000, open: 102.4, high: 102.9, low: 102.1, close: 102.6, volume: 12 };
  return candles;
}

function shortCandles(extrema = [100, 99, 98]) {
  const candles = Array.from({ length: 50 }, (_, index) => {
    const price = 105 - index * 0.01;
    return { time: index * 60_000, open: price, high: price + 0.4, low: price - 0.4, close: price - 0.1, volume: 10 };
  });
  [10, 20, 30].forEach((index, position) => { candles[index].low = extrema[position]; });
  candles[40] = { time: 40 * 60_000, open: 98.3, high: 98.5, low: 97.4, close: 97.6, volume: 12 };
  return candles;
}

function strategy() {
  return createCascadeStrategy({ lookback: 35, atrPeriod: 3, volumeLookback: 3, minimumVolumeRatio: 1 });
}

test("cascade strategy enters long only on the nearest staircase-high crossing", () => {
  const instance = strategy();
  const context = instance.prepare(longCandles());
  const signal = instance.signal({ index: 40, context });
  assert.equal(signal.side, "long");
  assert.equal(signal.metadata.extremaCount, 3);
  assert.equal(signal.metadata.breakoutLevel, 102);
  assert.ok(signal.metadata.zoneWidthPercent >= 1 && signal.metadata.zoneWidthPercent <= 5);
});

test("cascade strategy mirrors the structure for shorts", () => {
  const instance = strategy();
  const context = instance.prepare(shortCandles());
  const signal = instance.signal({ index: 40, context });
  assert.equal(signal.side, "short");
  assert.equal(signal.metadata.breakoutLevel, 98);
});

test("cascade strategy rejects zones wider than five percent", () => {
  const instance = strategy();
  const context = instance.prepare(longCandles([100, 104, 106]));
  assert.equal(instance.signal({ index: 40, context }), null);
});

test("cascade strategy rejects zones narrower than one percent", () => {
  const candles = longCandles([101.2, 101.6, 102]);
  const instance = strategy();
  const context = instance.prepare(candles);
  assert.equal(instance.signal({ index: 40, context }), null);
});

test("cascade strategy does not repeatedly enter after the level is already broken", () => {
  const instance = strategy();
  const context = instance.prepare(longCandles());
  assert.ok(instance.signal({ index: 40, context }));
  assert.equal(instance.signal({ index: 41, context }), null);
});
