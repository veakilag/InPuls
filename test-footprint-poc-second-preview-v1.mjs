import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createFootprintAccumulator,
  footprintIntervalSnapshot,
  footprintPocCluster,
  ingestFootprintTrades,
} from "./orderbook-flow-workspace.js";
import { tapeSecondSlotTime } from "./orderbook.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("footprint ignores a repeated execution instead of growing closed clusters", () => {
  const time = 1_700_000_000_100;
  const trade = {
    id: 42,
    price: 100,
    quantity: 2,
    quote: 200,
    time,
    side: "buy",
  };
  const accumulator = createFootprintAccumulator();
  ingestFootprintTrades(accumulator, [trade]);
  ingestFootprintTrades(accumulator, [trade]);

  const snapshot = footprintIntervalSnapshot(accumulator, "1m", time + 500);
  assert.equal(snapshot.quote, 200);
  assert.equal(snapshot.count, 1);
});

test("POC selects the largest traded price and resolves ties near the close", () => {
  const clusters = [
    { quote: 600, row: { price: 99 } },
    { quote: 900, row: { price: 101 } },
    { quote: 900, row: { price: 100.1 } },
  ];
  assert.equal(footprintPocCluster(clusters, 100)?.row.price, 100.1);
});

test("Tape preserves exact execution time while the shared clock owns the live edge", () => {
  const tradeTime = 1_700_000_031_123;
  assert.equal(tapeSecondSlotTime(tradeTime), tradeTime);

  const window = {
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_031_200,
    duration: 31_200,
    plotRight: 1_000,
  };
  assert.equal(tapeSecondSlotTime(tradeTime, window), tradeTime);
  assert.equal(tapeSecondSlotTime(window.endTime + 400, window), window.endTime - 1);
});

test("comfort preview covers the full palette and all live Canvas surfaces", () => {
  const preview = read("./canvas-comfort-preview.js");
  assert.match(preview, /#comfort-slider/);
  assert.match(preview, /capture:\s*true/);
  assert.match(preview, /requestAnimationFrame\(flushDirectPreview\)/);
  assert.match(preview, /inpuls:comfort-preview/);
  assert.match(preview, /\.inpuls-footprint-canvas/);
  const app = read("./app.js");
  const start = app.indexOf("function applyComfortPreview(rawValue) {");
  const end = app.indexOf("\n\nfunction applyComfort(rawValue)", start);
  const block = app.slice(start, end);
  assert.match(block, /--text/);
  assert.match(block, /--muted/);
  assert.match(block, /--chart-bg/);
  assert.match(block, /priceChart\.setTheme\(previewChartTheme\)/);
  assert.match(block, /inpuls:theme-change/);
});

// Regression contract for closed footprint levels, Tape edge and draggable clock.
test("closed footprint levels and site clock stay stable", () => {
  const flow = read("./orderbook-flow-workspace.js");
  assert.doesNotMatch(flow, /clustersByRow/);
  assert.match(flow, /interval\.cells[\s\S]*nearestRow\(rows, source\.price\)/);
  const orderbook = read("./orderbook.js");
  assert.match(orderbook, /const TAPE_LIVE_EDGE_LEAD_MS = 0;/);
  const app = read("./app.js");
  assert.match(app, /clockPosition/);
  assert.match(app, /enableClockDrag\(\)/);
  assert.match(app, /pointermove/);
});
