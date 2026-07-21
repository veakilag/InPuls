import test from "node:test";
import assert from "node:assert/strict";
import { aggregateCandles, calculateNatr, candleCenterSlot, candleIndexAtSlot, drawingPercentChange, KlineFeed, maximumVisibleCandles, nicePriceStep, niceTimeTickStep, parseRestKline, parseStreamKline, pearsonCorrelation, preserveViewFraction, scaleFromDrag, sessionLabels, snapPointToCandle, snapPriceToCandle, upsertCandle, visibleCountFromDrag } from "../chart.js";

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

test("one-second candles aggregate into a five-second history", () => {
  const candles = Array.from({ length: 10 }, (_, index) => ({
    time: index * 1000,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 2,
    closeTime: index * 1000 + 999,
    closed: true,
  }));
  const result = aggregateCandles(candles, 5000);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    time: 0,
    open: 100,
    high: 105,
    low: 99,
    close: 104.5,
    volume: 10,
    closeTime: 4999,
    closed: true,
  });
});

test("screen density keeps at least one distinct pixel slot per rendered candle", () => {
  assert.equal(maximumVisibleCandles(1000), 800);
  assert.equal(maximumVisibleCandles(100), 80);
  assert.equal(maximumVisibleCandles(10), 20);
});

test("second-history fallback walks backward through aggregate-trade pages", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  let active = 0;
  let maxActive = 0;
  let aggregateCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/klines")) return { ok: false, status: 400, json: async () => ({}) };
    aggregateCalls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    const endTime = Number(new URL(url).searchParams.get("endTime"));
    return {
      ok: true,
      json: async () => Array.from({ length: 40 }, (_, index) => ({
        a: endTime + index,
        p: String(100 + index / 100),
        q: "1",
        T: endTime - 40_000 + index * 1000,
      })),
    };
  };
  globalThis.WebSocket = class {
    addEventListener() {}
    close() {}
  };
  let latest = [];
  try {
    const feed = new KlineFeed({ onData: (candles) => { latest = candles; }, onStatus() {} });
    await feed.select("BTCUSDT", "1s", "15m");
    assert.equal(aggregateCalls, 12);
    assert.equal(maxActive, 1);
    assert.ok(latest.length > 40);
    feed.destroy();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
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

test("drawing ruler reports signed price change", () => {
  assert.equal(drawingPercentChange(100, 105), 5);
  assert.equal(drawingPercentChange(100, 95), -5);
  assert.equal(drawingPercentChange(0, 95), null);
});

test("Ctrl magnet snaps to nearest candle body or wick extreme", () => {
  const candle = { open: 100, high: 112, low: 94, close: 106 };
  assert.equal(snapPriceToCandle(candle, 110.8), 112);
  assert.equal(snapPriceToCandle(candle, 104.9), 106);
  assert.equal(snapPriceToCandle(candle, 96), 94);
});

test("Ctrl magnet resolves the candle centered under the cursor", () => {
  assert.equal(candleCenterSlot(12), 12.5);
  assert.equal(candleIndexAtSlot(12.5, 100), 12);
  assert.equal(candleIndexAtSlot(12.99, 100), 12);
});

test("Ctrl magnet snaps the first drawing anchor before the drawing exists", () => {
  const candles = [
    { time: 1_000, open: 100, high: 105, low: 98, close: 102 },
    { time: 2_000, open: 102, high: 109, low: 101, close: 108 },
  ];
  assert.deepEqual(snapPointToCandle(candles, 1.5, 107.6), {
    time: 2_000,
    price: 108,
    snapped: true,
    candleIndex: 1,
  });
});

test("live data keeps the fractional manual viewport offset", () => {
  assert.equal(preserveViewFraction(44, 12.625), 44.625);
});

test("time scale marks trading sessions without a separate day marker", () => {
  const dayBoundary = sessionLabels(Date.UTC(2026, 6, 19, 23, 59), Date.UTC(2026, 6, 20, 0, 0));
  assert.ok(!dayBoundary.includes("D"));
  assert.ok(dayBoundary.includes("Asia"));
  const usaOpen = sessionLabels(Date.UTC(2026, 6, 20, 13, 29), Date.UTC(2026, 6, 20, 13, 30));
  assert.ok(usaOpen.includes("USA"));
});

test("progressive time scale selects round divisions", () => {
  assert.equal(niceTimeTickStep(6 * 60_000, 6), 60_000);
  assert.equal(niceTimeTickStep(12 * 3_600_000, 6), 2 * 3_600_000);
  assert.equal(niceTimeTickStep(40 * 86_400_000, 6), 7 * 86_400_000);
});

test("price scale uses round and half-round increments", () => {
  assert.equal(nicePriceStep(12, 6), 2);
  assert.equal(nicePriceStep(.015, 6), .0025);
  assert.equal(nicePriceStep(4300, 6), 1000);
});
