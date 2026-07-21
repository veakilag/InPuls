import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("all browser entry points identify the build as v22", async () => {
  const [html, app, worker, refresh, version] = await Promise.all([
    source("index.html"), source("app.js"), source("sw.js"), source("refresh.html"), source("VERSION.txt"),
  ]);
  for (const text of [html, app, worker, refresh, version]) assert.doesNotMatch(text, /(?:v|build=|\?v=)21\b/);
  assert.match(html, /inpuls-build" content="22"/);
  assert.match(worker, /inpuls-v22/);
  assert.match(version, /^InPuls v22/m);
});

test("v22 DOM exposes adaptive book controls and the aggregated trade path", async () => {
  const app = await source("app.js");
  assert.match(app, /data-book-center/);
  assert.match(app, /data-trade-min/);
  assert.match(app, /data-book-clusters/);
  assert.match(app, /data-book-highlight-manual/);
  assert.match(app, /data-book-highlight-auto/);
  assert.match(app, /aggregateTradePath/);
  assert.match(app, /manualScrollAnchorPrice/);
  assert.match(app, /book-splitter/);
  assert.match(app, /event\.ctrlKey \|\| event\.metaKey/);
  assert.doesNotMatch(app, /data-book-depth/);
});

test("INPLAY exposes and applies the NATR 5 filter", async () => {
  const [html, app] = await Promise.all([source("index.html"), source("app.js")]);
  assert.match(html, /id="inplay-min-natr5"/);
  assert.match(app, /state\.inplay\.minNatr5/);
  assert.match(app, /item\.natr5m/);
});

test("chart pointer work is coalesced through animation frames and first-anchor snapping is available", async () => {
  const chart = await source("chart.js");
  assert.match(chart, /#requestRender\(\)/);
  assert.match(chart, /export function snapPointToCandle/);
  assert.match(chart, /#shouldSnap\(event\)/);
});

test("small panels keep compact menus and smaller resize corners", async () => {
  const css = await source("styles.css");
  assert.match(css, /\.chart-resizer, \.panel-resizer \{ width: 12px; height: 12px; \}/);
  assert.match(css, /\.chart-toolbox\.opens-sideways/);
  assert.match(css, /@container \(max-width: 360px\)/);
});
