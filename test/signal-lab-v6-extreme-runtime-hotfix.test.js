import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { latestCompleteTimeframeCandle } from "../signal-lab-v3-collector.js";
import {
  SignalLabV4ExtremeRegistry,
  TimeframeExtremeEngine,
} from "../signal-lab-v4-extremes.js";

const minute = 60_000;

function candle(index, open, high, low, close) {
  return {
    time: index * minute,
    closeTime: (index + 1) * minute - 1,
    open,
    high,
    low,
    close,
    closed: true,
  };
}

function engine() {
  return new TimeframeExtremeEngine({
    symbol: "TESTUSDT",
    timeframe: "1m",
    tickSize: 0.01,
    config: { minReversalPct: 0.2, atrMultiplier: 0, minTicks: 2 },
  });
}

test("trade observation invalidates confirmed levels without manufacturing candle extrema", () => {
  const subject = engine();
  subject.ingestCandles([
    candle(0, 99.96, 100, 99.95, 99.98),
    candle(1, 99.98, 99.99, 99.70, 99.75),
  ]);
  const before = subject.snapshot();
  assert.equal(before.history.length, 1);
  const candidateBefore = before.candidates.low;

  subject.observePrice(99.80, 2 * minute + 1);
  const observed = subject.snapshot();
  assert.equal(observed.history.length, 1);
  assert.deepEqual(observed.candidates.low, candidateBefore);
  assert.equal(observed.active.length, 1);

  subject.observePrice(100.01, 2 * minute + 2);
  assert.equal(subject.snapshot().active.length, 0);
  assert.equal(subject.snapshot().history.length, 1);
});

test("lean live snapshot preserves active extrema and omits heavy history", () => {
  const subject = engine();
  subject.ingestCandles([
    candle(0, 99.96, 100, 99.95, 99.98),
    candle(1, 99.98, 99.99, 99.70, 99.75),
  ]);
  const snapshot = subject.snapshot({ includeHistory: false, includeEvents: false });
  assert.equal(snapshot.active.length, 1);
  assert.deepEqual(snapshot.history, []);
  assert.deepEqual(snapshot.events, []);
});

test("registry observes only already hydrated timeframe engines", () => {
  const registry = new SignalLabV4ExtremeRegistry();
  registry.setTickSize("TESTUSDT", 0.01);
  registry.hydrate("TESTUSDT", "1m", [
    candle(0, 99.96, 100, 99.95, 99.98),
    candle(1, 99.98, 99.99, 99.70, 99.75),
  ]);
  registry.observePrice("TESTUSDT", 99.80, 2 * minute + 1, { emitSnapshot: false });
  const snapshot = registry.snapshot("TESTUSDT", { includeHistory: false, includeEvents: false });
  assert.deepEqual(Object.keys(snapshot.timeframes), ["1m"]);
  assert.equal(snapshot.timeframes["1m"].active.length, 1);
});

test("collector live path is candle-driven and uses lean extreme maps", () => {
  const collector = fs.readFileSync(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
  assert.match(collector, /this\.extremes\.observePrice\(data\.s/);
  assert.doesNotMatch(collector, /this\.extremes\.ingestTrade\(data\.s/);
  assert.match(collector, /SIGNAL_LAB_V4_TIMEFRAMES/);
  assert.match(collector, /latestCompleteTimeframeCandle\(state\.minuteCandles, timeframe, now\)/);
  assert.match(collector, /hydrate\(metrics\.symbol, timeframe, \[candle\]/);
  assert.match(collector, /hasNewSourceMinute/);
  assert.match(collector, /lastTimeframeAggregationAt\.set\(metrics\.symbol/);
  assert.match(collector, /includeHistory: false, includeEvents: false/);
  assert.match(collector, /historyRetryAt\.set\(symbol, Date\.now\(\) \+ 60_000\)/);
});

test("owner UI no longer rebuilds all episode cards every five seconds", () => {
  const owner = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
  assert.match(owner, /setInterval\(\(\) => scheduleRender\(0\), 15_000\)/);
  assert.match(owner, /activeExtremes \?\? 0/);
});

test("minute history produces only fully closed higher-timeframe candles", () => {
  const rows = Array.from({ length: 65 }, (_, index) => ({
    time: index * minute,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 1,
  }));
  const five = latestCompleteTimeframeCandle(rows, "5m", 65 * minute);
  assert.equal(five.time, 60 * minute);
  assert.equal(five.open, 160);
  assert.equal(five.close, 164.5);
  assert.equal(five.volume, 5);
  const hour = latestCompleteTimeframeCandle(rows, "1h", 65 * minute);
  assert.equal(hour.time, 0);
  assert.equal(hour.open, 100);
  assert.equal(hour.close, 159.5);
});

test("incomplete current bucket falls back to the previous complete bucket", () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    time: index * minute,
    open: 10 + index,
    high: 11 + index,
    low: 9 + index,
    close: 10.5 + index,
  }));
  const candle5m = latestCompleteTimeframeCandle(rows, "5m", 7 * minute);
  assert.equal(candle5m.time, 0);
  assert.equal(candle5m.close, 14.5);
});

test("warmed symbols retain enough minute history for a complete 1d candle", () => {
  const rows = Array.from({ length: 1_440 }, (_, index) => ({
    time: index * minute,
    open: 20,
    high: 21,
    low: 19,
    close: 20,
  }));
  const daily = latestCompleteTimeframeCandle(rows, "1d", 1_440 * minute);
  assert.equal(daily.time, 0);
  assert.equal(daily.closeTime, 1_440 * minute - 1);
});

test("warmed minute history remains bounded while supporting daily aggregation", () => {
  const source = fs.readFileSync(new URL("../engine.js", import.meta.url), "utf8");
  assert.match(source, /Math\.min\(1_500, candles\.length \|\| 0\)/);
  assert.match(source, /slice\(-this\.minuteCandleLimit\)/);
  assert.match(source, /minuteCandles: this\.minuteCandles\.slice\(-100\)/);
});
