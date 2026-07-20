import test from "node:test";
import assert from "node:assert/strict";
import { calculateNatr, parseRestKline, parseStreamKline, pearsonCorrelation, scaleFromDrag, sessionLabels, upsertCandle, visibleCountFromDrag } from "../chart.js";

test("REST kline is normalized", () => {
  const candle = parseRestKline([1000, "10", "12", "9", "11", "25", 1999]);
  assert.deepEqual(candle, {
    time: 1000,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 25,
    closeTime: 1999,
    closed: true,
  });
});

test("stream kline is normalized", () => {
  const candle = parseStreamKline({ k: { t: 1000, o: "10", h: "12", l: "9", c: "11", v: "25", T: 1999, x: false } });
  assert.equal(candle.close, 11);
  assert.equal(candle.closed, false);
});

test("live update replaces an open candle", () => {
  const previous = [{ time: 1000, close: 10 }];
  const next = upsertCandle(previous, { time: 1000, close: 11 });
  assert.deepEqual(next, [{ time: 1000, close: 11 }]);
  assert.notEqual(next, previous);
});

test("new candles append and respect the history limit", () => {
  const next = upsertCandle([{ time: 1000 }, { time: 2000 }], { time: 3000 }, 2);
  assert.deepEqual(next.map((item) => item.time), [2000, 3000]);
});

test("price-axis drag changes vertical scale", () => {
  assert.ok(scaleFromDrag(1, 80) > 1);
  assert.ok(scaleFromDrag(1, -80) < 1);
});

test("time-axis drag changes visible history", () => {
  assert.ok(visibleCountFromDrag(100, 80, 500) > 100);
  assert.ok(visibleCountFromDrag(100, -80, 500) < 100);
});

test("NATR normalizes Wilder ATR as a percentage", () => {
  const candles = Array.from({ length: 20 }, (_, index) => ({ high: 101 + index, low: 99 + index, close: 100 + index }));
  assert.ok(calculateNatr(candles) > 0);
});

test("Pearson correlation detects aligned and inverse returns", () => {
  assert.equal(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  assert.equal(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2]), -1);
});

test("time scale marks UTC day and abbreviated sessions", () => {
  const dayBoundary = sessionLabels(Date.UTC(2026, 6, 19, 23, 59), Date.UTC(2026, 6, 20, 0, 0));
  assert.ok(dayBoundary.includes("D"));
  assert.ok(dayBoundary.includes("AS"));
  const newYorkOpen = sessionLabels(Date.UTC(2026, 6, 20, 13, 29), Date.UTC(2026, 6, 20, 13, 30));
  assert.ok(newYorkOpen.includes("US"));
});
