import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { upsertLiveCandleInPlace } from "./chart.js?v=26-102-tape-live-edge-minute-boundary-v1";

const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
const chart = fs.readFileSync(new URL("./chart.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");

test("live candles update in place instead of copying history per packet", () => {
  const candles = [{ time: 1_000, open: 1, high: 2, low: 1, close: 2, volume: 1 }];
  const identity = candles;
  upsertLiveCandleInPlace(candles, { time: 1_000, open: 1, high: 3, low: 1, close: 3, volume: 2 }, 10);
  assert.equal(candles, identity);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].close, 3);
  upsertLiveCandleInPlace(candles, { time: 2_000, open: 3, high: 4, low: 3, close: 4, volume: 1 }, 10);
  assert.equal(candles.length, 2);
});

test("KlineFeed coalesces live chart paints and throttles cache snapshots", () => {
  assert.match(chart, /upsertLiveCandleInPlace\(this\.candles, candle/);
  assert.match(chart, /#scheduleLiveEmit\(/);
  assert.match(chart, /requestAnimationFrame\(emit\)/);
  assert.match(chart, /#scheduleSeriesCacheFlush\(/);
  assert.match(chart, /}, 250\);/);
});

test("full application rendering is no longer tied to each exact second", () => {
  assert.doesNotMatch(app, /setInterval\(render,\s*1000\)/);
  assert.doesNotMatch(app, /updateTrade\(data\);\s*scheduleRender\(\)/);
  assert.doesNotMatch(app, /updateBookTicker\(data\);[\s\S]{0,120}scheduleRender\(\)/);
  assert.match(app, /requestIdleCallback\(run, \{ timeout: 450 \}\)/);
});

test("clock work avoids hidden timezone scans and cached modules are refreshed", () => {
  assert.match(app, /if \(!els\.timeZoneDialog\?\.open\) return/);
  assert.match(app, /const timeFormatterCache = new Map\(\)/);
  assert.doesNotMatch(app, /setInterval\(updateClock,\s*1000\)/);
  assert.doesNotMatch(app, /let lastHeaderClockText|let clockTickTimer/);
  assert.match(app, /updateClock\.lastText/);
  assert.match(app, /scheduleClockTick\.timer/);
  assert.match(html, /app\.js\?v=26-125-aster-alpha-v1/);
  assert.match(app, /chart\.js\?v=26-125-aster-alpha-v1/);
});
