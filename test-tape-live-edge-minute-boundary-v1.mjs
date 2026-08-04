import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { buildProvisionalCandle } from "./chart.js";
import { ensureFootprintLiveBucket } from "./orderbook.js";

const RUNTIME_BUILD = "26-105-tape-clock-frozen-projection-v1";
const CHART_BUILD = "26-102-tape-live-edge-minute-boundary-v1";
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("minute boundary creates a zero-volume provisional candle from the last close", () => {
  const candle = buildProvisionalCandle(
    { time: 60_000, close: 12.5 },
    120_000,
    60_000,
  );
  assert.deepEqual(candle, {
    time: 120_000, open: 12.5, high: 12.5, low: 12.5, close: 12.5,
    volume: 0, closeTime: 179_999, closed: false, provisional: true,
  });
});

test("current footprint interval is represented honestly before its first execution", () => {
  const previous = [{ key: "old", time: 5_000, price: 10, quote: 100, buyQuote: 100, sellQuote: 0, count: 1 }];
  const next = ensureFootprintLiveBucket(previous, 10.25, 10_001, 5_000);
  assert.equal(next.length, 2);
  assert.deepEqual(next.at(-1), {
    key: "empty-live:10000", time: 10_000, price: 10.25, quote: 0,
    buyQuote: 0, sellQuote: 0, count: 0, empty: true,
  });
});

test("runtime loads the live Canvas preview and fresh boundary build", () => {
  const index = read("./index.html");
  const app = read("./app.js");
  const chart = read("./chart.js");
  const sw = read("./sw.js");
  assert.match(index, new RegExp(`canvas-comfort-preview\\.js\\?v=${RUNTIME_BUILD}`));
  assert.match(index, new RegExp(`app\\.js\\?v=${RUNTIME_BUILD}`));
  assert.match(app, new RegExp(`chart\\.js\\?v=${CHART_BUILD}`));
  assert.match(chart, /#scheduleBoundaryTick/);
  assert.match(sw, new RegExp(`canvas-comfort-preview\\.js\\?v=${RUNTIME_BUILD}`));
});
