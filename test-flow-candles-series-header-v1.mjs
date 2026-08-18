// Final verification trigger for the clean runtime head.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  projectFootprintPriceRow,
  stableFootprintProjectionRows,
} from "./orderbook-flow-workspace.js?v=26-126-final-exchanges-v1";
import { aggregateTapeSeries } from "./orderbook.js?v=26-126-final-exchanges-v1";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const rows = [
  { price: 99, y: 90, height: 10 },
  { price: 100, y: 80, height: 10 },
  { price: 100.37, y: 75, height: 10 },
  { price: 101, y: 70, height: 10 },
  { price: 102, y: 60, height: 10 },
];

test("footprint projection ignores the transient off-grid current-price row", () => {
  const stable = stableFootprintProjectionRows(rows);
  assert.deepEqual(stable.map((row) => row.price), [99, 100, 101, 102]);
  assert.equal(projectFootprintPriceRow(rows, 100.5).y, 75);
});

test("partial OHLC remains projected at the visible edge", () => {
  assert.equal(projectFootprintPriceRow(rows, 105), null);
  const clipped = projectFootprintPriceRow(rows, 105, true);
  assert.equal(clipped.y, 60);
  assert.equal(clipped.clipped, true);
});

test("series keeps one staircase coordinate per visual millisecond", () => {
  const trade = (id, time, price, quote) => ({ id, time, tradeTime: time, displayTime: time, side: "buy", price, quote, quantity: quote / price });
  const series = aggregateTapeSeries([
    trade(1, 1_000, 100, 100),
    trade(2, 1_000, 101, 200),
    trade(3, 1_250, 102, 300),
  ])[0];
  assert.equal(series.steps.length, 2);
  assert.deepEqual(series.steps.map((step) => [step.time, step.price]), [[1_000, 101], [1_250, 102]]);
  assert.equal(series.price, 102);
});

test("runtime draws chart-style cluster candles and a Tape staircase", () => {
  const flow = read("./orderbook-flow-workspace.js");
  const tape = read("./orderbook.js");
  assert.match(flow, /nearestRow\(rows, interval\.highPrice, true\)/);
  assert.match(flow, /state\.context\.fillStyle = theme\.bearFill/);
  assert.match(flow, /state\.context\.rect\(columnLeft, candleTop/);
  assert.match(flow, /height - 28/);
  assert.match(tape, /function drawTapeSeriesLadder/);
  assert.match(tape, /context\.lineTo\(next\.x, previous\.y\)/);
  assert.match(tape, /context\.lineTo\(next\.x, next\.y\)/);
  assert.match(tape, /rgba\(66, 225, 173, \.46\)/);
});

test("brightness is between Download and Sound and runtime key is atomic", () => {
  const html = read("./index.html");
  const header = html.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.ok(header.indexOf('id="install-app"') < header.indexOf('id="comfort-slider"'));
  assert.ok(header.indexOf('id="comfort-slider"') < header.indexOf('id="sound-toggle"'));
  for (const path of ["./index.html", "./app.js", "./orderbook.js", "./sw.js"]) {
    assert.match(read(path), /26-126-final-exchanges-v1/);
  }
});
