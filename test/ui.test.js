import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("browser entry points keep user version v23 and identify the current release build", async () => {
  const [html, app, worker, refresh, version] = await Promise.all([
    source("index.html"), source("app.js"), source("sw.js"), source("refresh.html"), source("VERSION.txt"),
  ]);
  for (const text of [html, app, worker, refresh, version]) assert.doesNotMatch(text, /(?:v|build=|\?v=)22\b/);
  assert.match(html, /inpuls-build" content="26-51-signal-observation-engine-v1"/);
  assert.match(worker, /inpuls-26-51-signal-observation-engine-v1/);
  assert.match(html, /SCREENER <small>v23<\/small>/);
  assert.match(version, /^InPuls v23/m);
});

test("v23 DOM exposes fixed price steps, live Tape and footprint controls", async () => {
  const app = await source("app.js");
  assert.match(app, /data-book-center/);
  assert.match(app, /data-trade-min/);
  assert.match(app, /data-book-clusters/);
  assert.match(app, /data-book-highlight-manual/);
  assert.match(app, /data-book-highlight-auto/);
  assert.match(app, /aggregateTradePath/);
  assert.match(app, /aggregateFootprintClusters/);
  assert.match(app, /maximumBookScaleIndex/);
  assert.match(app, /priceStepForScale/);
  assert.match(app, /bookScaleLabel/);
  assert.match(app, /data-trade-window/);
  assert.match(app, /trade-flow-grid/);
  assert.match(app, /inplayOrder/);
  assert.match(app, /manualScrollAnchorPrice/);
  assert.match(app, /book-splitter/);
  assert.match(app, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(app, /bookScaleIndex/);
  assert.match(app, /function formatBookPrice\(value, baseTick\)/);
  assert.match(app, /minimumFractionDigits: fractionDigits/);
  assert.doesNotMatch(app, /--book-size-label-space/);
  assert.match(app, /const maxSize = automaticHighlight[\s\S]*\? fullBookMaximum[\s\S]*rows\.map\(\(row\) => Math\.max\(0, Number\(row\.quote\) \|\| 0\)\)/);
  assert.match(app, /maximumDepthQuote\([\s\S]*data\.sizeScaleMaxQuote/);
  assert.doesNotMatch(app, /priceStepForDepthPercent/);
});

test("INPLAY exposes and applies the NATR 5 filter", async () => {
  const [html, app] = await Promise.all([source("index.html"), source("app.js")]);
  assert.match(html, /id="inplay-min-natr5"/);
  assert.match(app, /state\.inplay\.minNatr5/);
  assert.match(app, /item\.natr5m/);
});

test("market symbols are validated before subscriptions and detail rendering avoids dynamic HTML", async () => {
  const [app, engine] = await Promise.all([source("app.js"), source("engine.js")]);
  assert.match(engine, /USDT_PERPETUAL_SYMBOL_PATTERN/);
  assert.match(app, /this\.trackedAggTrades\.has\(data\.s\)/);
  assert.match(app, /normalizeUsdtPerpetualSymbol\(event\.dataTransfer\.getData/);
  assert.doesNotMatch(app, /detailContent\.innerHTML/);
  assert.match(app, /detailContent\.replaceChildren\(content\)/);
  assert.match(app, /link\.rel = "noopener noreferrer"/);
});

test("browser entry points carry a restrictive CSP and reset scripts stay external", async () => {
  const names = [
    "index.html",
    "raw-stability-lab.html",
    "trade-latency-lab.html",
    "refresh.html",
    "reset-v26.html",
  ];
  const pages = await Promise.all(names.map(source));
  for (const page of pages) {
    assert.match(page, /http-equiv="Content-Security-Policy"/);
    assert.match(page, /object-src 'none'/);
    assert.match(page, /script-src 'self'/);
    assert.match(page, /name="referrer" content="no-referrer"/);
  }
  assert.doesNotMatch(pages[3], /<script>(?:.|\n)*getRegistrations/);
  assert.doesNotMatch(pages[4], /<script>(?:.|\n)*getRegistrations/);
  assert.match(pages[3], /refresh\.js\?v=26-51-signal-observation-engine-v1/);
  assert.match(pages[4], /reset\.js\?v=26-51-signal-observation-engine-v1/);
});

test("Service Worker installs atomically and validates cached response types", async () => {
  const worker = await source("sw.js");
  assert.match(worker, /cache\.addAll\(SHELL\)/);
  assert.match(worker, /isCacheableResponse/);
  assert.match(worker, /content-type/);
  assert.match(worker, /await caches\.delete\(CACHE\)/);
  assert.doesNotMatch(worker, /Promise\.allSettled\(SHELL/);
});

test("chart pointer work is coalesced through animation frames and first-anchor snapping is available", async () => {
  const chart = await source("chart.js");
  assert.match(chart, /#requestRender\(\)/);
  assert.match(chart, /export function snapPointToCandle/);
  assert.match(chart, /#shouldSnap\(event\)/);
  assert.match(chart, /this\.drawingSnap/);
  assert.match(chart, /resetView\(\)/);
});

test("small panels keep compact menus and smaller resize corners", async () => {
  const [app, css] = await Promise.all([source("app.js"), source("styles.css")]);
  assert.match(css, /\.chart-resizer, \.panel-resizer \{ width: 12px; height: 12px; \}/);
  assert.match(css, /\.chart-toolbox\.opens-sideways/);
  assert.match(css, /@container \(max-width: 360px\)/);
  assert.match(css, /@container \(max-width: 210px\)/);
  assert.match(app, /model\.type === "orderbook" && element\?\.classList\.contains\("is-flow-hidden"\)/);
  assert.match(app, /return \{ w: 2, h: 2 \};/);
});

test("brightness control keeps fixed accents and morphs from sun to moon", async () => {
  const [html, app, css] = await Promise.all([
    source("index.html"), source("app.js"), source("styles.css"),
  ]);
  assert.doesNotMatch(html, /СУМЕРКИ|НОЧЬ/);
  assert.match(html, /class="comfort-sun"/);
  assert.match(html, /class="comfort-moon"/);
  assert.match(app, /root\.style\.setProperty\("--comfort-position"/);
  assert.match(app, /root\.style\.setProperty\("--comfort-moon-opacity"/);
  assert.match(app, /const turquoise = "#42d9b1"/);
  assert.match(app, /const blue = "#65b7ff"/);
  assert.match(app, /const violet = "#aa86ff"/);
  assert.match(css, /linear-gradient\(90deg,#c8cdd2 0%,#737b84 46%,#242930 100%\)/);
});

test("orderbook price text is separated from the size boundary", async () => {
  const orderbook = await source("orderbook.js");
  assert.match(orderbook, /grid-template-columns: minmax\(0, 1fr\) var\(--book-price-width, 8\.25ch\)/);
  assert.match(orderbook, /padding: 0 3px 0 2px !important;/);
  assert.match(orderbook, /column-gap: 4px !important;/);
  assert.match(orderbook, /\.book-ladder-row \.book-size \{[\s\S]*border-right: 1px solid color-mix\(in srgb, var\(--line\) 72%, transparent\);/);
  assert.match(orderbook, /\.book-ladder-row strong \{[\s\S]*border-left: 0 !important;/);
  assert.match(orderbook, /\.book-ladder-row \.book-size \{[\s\S]*overflow: hidden !important;/);
});
