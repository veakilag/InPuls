import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  aggregateTapeSweeps,
  aggregateTapeZeroMs,
  selectTapeLabelKeys,
  tapeDisplayLabel,
  tapeVisualSizeQuote,
} from "./orderbook.js?v=26-89-core-feed-footprint-runtime-v1";
import { upsertLiveCandleInPlace } from "./chart.js?v=26-89-core-feed-footprint-runtime-v1";

const trade = (id, eventTime, receivedAt, price, side, quote) => ({
  id,
  firstTradeId: id,
  lastTradeId: id,
  time: receivedAt,
  receivedAt,
  tradeTime: eventTime,
  eventTime,
  price,
  quantity: quote / price,
  quote,
  side,
});

test("SERIES displays a sum but keeps the visual size of its largest child AGG", () => {
  const aggregates = aggregateTapeZeroMs([
    trade(1, 1_000, 9_000, 100, "buy", 2_000),
    trade(2, 1_010, 9_010, 101, "buy", 8_000),
    trade(3, 1_020, 9_020, 102, "buy", 4_000),
  ]);
  const series = aggregateTapeSweeps(aggregates, { tick: 1 })[0];
  assert.equal(series.quote, 14_000);
  assert.equal(series.peakAggregateQuote, 8_000);
  assert.equal(tapeVisualSizeQuote(series, "sweep"), 8_000);
  assert.equal(tapeDisplayLabel(series, "sweep"), "Σ14.0K");
  assert.equal(tapeDisplayLabel(aggregates[1], "agg"), "8.0K");
});

test("dense AGG windows keep markers but bound overlapping text labels", () => {
  const window = { startTime: 0, endTime: 2_000, duration: 2_000, plotRight: 240 };
  const projected = Array.from({ length: 50 }, (_, index) => ({
    source: {
      key: `agg-${index}`,
      time: 1_000 + index,
      timeOrdinal: index,
      quote: 100_000 - index,
      showLabel: true,
      status: index === 49 ? "open" : "sealed",
    },
    position: { y: 50 + (index % 3) },
  }));
  const keys = selectTapeLabelKeys(projected, window, 240, () => 28, { mode: "agg", forceLabels: true });
  assert.ok(keys.size > 0);
  assert.ok(keys.size <= 4);
  assert.ok(keys.has("agg-49"));
});

test("live chart candles update in place without copying the full history", () => {
  const candles = [{ time: 1_000, open: 1, high: 2, low: 1, close: 2, volume: 1 }];
  const identity = candles;
  upsertLiveCandleInPlace(candles, { time: 1_000, open: 1, high: 3, low: 1, close: 3, volume: 2 }, 10);
  assert.equal(candles, identity);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].close, 3);
  upsertLiveCandleInPlace(candles, { time: 2_000, open: 3, high: 4, low: 3, close: 4, volume: 1 }, 10);
  assert.equal(candles.length, 2);
});

test("hidden timezone map no longer performs exact-second marker scans", () => {
  const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /if \(!els\.timeZoneDialog\?\.open\) return/);
  assert.match(app, /minuteKey === timeZoneClockMinuteKey/);
  assert.doesNotMatch(app, /setInterval\(updateClock,\s*1000\)/);
  assert.match(app, /requestAnimationFrame\(\(\) => \{\s*updateClock/);
});

test("KlineFeed coalesces live data and throttles full-array cache copies", () => {
  const chart = fs.readFileSync(new URL("./chart.js", import.meta.url), "utf8");
  assert.match(chart, /upsertLiveCandleInPlace\(this\.candles, candle/);
  assert.match(chart, /#scheduleLiveEmit\(/);
  assert.match(chart, /#scheduleSeriesCacheFlush\(/);
  assert.match(chart, /this\.cacheFlushTimer = setTimeout/);
});
