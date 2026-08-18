import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("browser entry points keep user version v23 and identify the current release build", async () => {
  const [html, app, worker, version] = await Promise.all([
    source("index.html"), source("app.js"), source("sw.js"), source("VERSION.txt"),
  ]);
  for (const text of [html, app, worker, version]) assert.doesNotMatch(text, /(?:v|build=|\?v=)22\b/);
  assert.match(html, /inpuls-build" content="26-126-final-exchanges-v1"/);
  assert.match(worker, /inpuls-26-91-runtime-boot-cache-feed-v1/);
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
  assert.match(app, /const maxSize = fullBookMaximum/);
  assert.doesNotMatch(app, /maxSize = Math\.max\([\s\S]*rows\.map/);
  assert.match(app, /marketAnchoredBookViewCenter\(/);
  assert.match(app, /const displayedQuote = bookDisplayedQuote\(source\)/);
  assert.match(app, /const anomalyReference = bookAnomalyQuote\(source, automatic\)/);
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

test("browser entry points carry a restrictive CSP and the manual rescue stays external", async () => {
  const names = [
    "index.html",
    "raw-stability-lab.html",
    "trade-latency-lab.html",
    "rescue-26-94.html",
  ];
  const pages = await Promise.all(names.map(source));
  for (const page of pages) {
    assert.match(page, /http-equiv="Content-Security-Policy"/);
    assert.match(page, /object-src 'none'/);
    assert.match(page, /script-src 'self'/);
    assert.match(page, /name="referrer" content="no-referrer"/);
  }
  assert.doesNotMatch(pages[3], /<script>(?:.|\n)*getRegistrations/);
  assert.match(pages[3], /rescue-26-94\.js\?v=26-94-runtime-rescue-v2/);
});

test("Service Worker removes retired app-shell caches and stays network-only", async () => {
  const worker = await source("sw.js");
  assert.match(worker, /26-126-final-exchanges-v1/);
  assert.match(worker, /await caches\.keys\(\)/);
  assert.match(worker, /key === CACHE \|\| key\.startsWith\("inpuls-"\)/);
  assert.match(worker, /\.map\(\(key\) => caches\.delete\(key\)\)/);
  assert.match(worker, /fetch\(event\.request, \{ cache: "no-store" \}\)/);
  assert.doesNotMatch(worker, /caches\.open\(/);
  assert.doesNotMatch(worker, /cache\.addAll\(/);
  assert.doesNotMatch(worker, /cache\.put\(/);
  assert.doesNotMatch(worker, /caches\.match\(/);
});

test("chart pointer work is coalesced through animation frames and first-anchor snapping is available", async () => {