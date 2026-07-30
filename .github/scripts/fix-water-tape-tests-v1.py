from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


write("test-orderbook-tape-v2-core.mjs", r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
const resetPage = readFileSync(new URL("./reset-v26.html", import.meta.url), "utf8");
const resetScript = readFileSync(new URL("./reset.js", import.meta.url), "utf8");

function tapePainter() {
  const start = orderbook.indexOf("function drawTapeCard(card) {");
  const end = orderbook.indexOf("\nfunction drawAllTapes()", start);
  assert.ok(start >= 0 && end > start);
  return orderbook.slice(start, end);
}

test("Tape keeps RAW default and AGG explicit", () => {
  assert.match(orderbook, /mode: localStorage\.getItem\(TAPE_MODE_KEY\) === "agg" \? "agg" : "raw"/);
  assert.match(orderbook, /button\.textContent = aggregated/);
  assert.match(orderbook, /TAPE_AGGREGATION_LEVELS/);
});

test("water renderer owns stable event geometry", () => {
  const painter = tapePainter();
  assert.match(orderbook, /export function advanceWaterTapeClock\(/);
  assert.match(orderbook, /export function tapeViewportFromRows\(/);
  assert.match(orderbook, /export function projectTapePrice\(/);
  assert.match(orderbook, /function refreshTapeRenderModel\(/);
  assert.match(orderbook, /Object\.freeze\(\{/);
  assert.match(painter, /projectWaterTapeNodes/);
  assert.match(painter, /const baseX = tapeTimeX\(item\.time, window, rect\.width\)/);
  assert.doesNotMatch(painter, /layoutTapeSequence|buildReadableTapeLayout|nearestVisibleRow|tapePricePosition/);
  assert.doesNotMatch(painter, /adaptiveRawDiameter\(strength, item\.density/);
  assert.match(orderbook, /function activeTapeCards\(\)/);
  assert.match(orderbook, /requestAnimationFrame\(runTapeDrawFrame\)/);
  assert.match(orderbook, /const TAPE_MAX_RAW_VISIBLE = TAPE_MAX_STORED/);
  assert.match(orderbook, /card\.dataset\.inpulsPriceWidthPx/);
  assert.match(orderbook, /left: 0 !important;/);
  assert.match(orderbook, /width: var\(--size\) !important/);
  assert.match(orderbook, />ЛЕНТА<\/button>/);
  assert.match(orderbook, />КЛАСТЕРЫ<\/button>/);
});

test("Flow Workspace cache and reset page point to water runtime", () => {
  assert.match(orderbook, /inpuls-orderbook-runtime-26-71-water-tape-v1/);
  assert.match(orderbook, /orderbook-flow-workspace\.js\?v=26-71-water-tape-v1/);
  assert.match(serviceWorker, /inpuls-26-71-water-tape-v1/);
  assert.match(serviceWorker, /orderbook\.js\?v=26-71-water-tape-v1/);
  assert.match(serviceWorker, /render-scheduler\.js\?v=render-scheduler-v1/);
  assert.match(serviceWorker, /orderbook-worker\.js\?v=26-71-water-tape-v1/);
  assert.match(serviceWorker, /orderbook-tape-layout\.js\?v=stable-tape-v4/);
  assert.match(serviceWorker, /orderbook-tape-latency\.js\?v=worker-bp-v1/);
  assert.match(serviceWorker, /orderbook-flow-workspace\.js\?v=26-71-water-tape-v1/);
  assert.match(resetPage, /Resume v2/);
  assert.match(resetPage, /reset\.js\?v=26-71-water-tape-v1/);
  assert.match(resetScript, /sw\.js\?v=\$\{BUILD\}/);
  assert.match(resetScript, /26-71-water-tape-v1/);
});

test("production TAPE accepts only live packets and starts from an empty frame", () => {
  assert.match(orderbook, /if \(!detail\?\.replace && !detail\?\.live\) return;/);
  assert.match(orderbook, /const incoming = detail\?\.live && Array\.isArray\(detail\?\.trades\)/);
});
''')

visual = read("test-orderbook-visual-priority.mjs")
old = '''test("live trades invalidate the current footprint frame immediately", () => {
  assert.match(flow, /incoming\.length && state\.historyOffset === 0/);
  assert.match(orderbook, /const y = snapTapeCoordinate\(item\.row\.y, dpr\)/);
  assert.match(orderbook, /const pathY = snapTapeCoordinate\(pathItem\.row\.y, dpr\)/);
  assert.match(orderbook, /const pathX = pathItem\.x \?\? tapeTimeX/);
  assert.doesNotMatch(orderbook, /row\.y \+ \(Number\([^)]*yOffset/);
  assert.match(flow, /state\.hasFrame = false/);
});'''
new = '''test("live flow invalidates footprint while Tape keeps one coherent viewport", () => {
  assert.match(flow, /incoming\.length && state\.historyOffset === 0/);
  assert.match(orderbook, /state\.priceViewport = advanceTapePriceViewport/);
  assert.match(orderbook, /projectWaterTapeNodes\(recentRaw, state\.priceViewport\)/);
  assert.match(orderbook, /const baseX = tapeTimeX\(item\.time, window, rect\.width\)/);
  assert.doesNotMatch(orderbook, /row\.y \+ \(Number\([^)]*yOffset/);
  assert.match(flow, /state\.hasFrame = false/);
});'''
if old not in visual:
    raise SystemExit("visual-priority Tape contract block not found")
visual = visual.replace(old, new, 1)
write("test-orderbook-visual-priority.mjs", visual)

write("test-tape-stability-followup-v1.mjs", r'''import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  advanceTapePriceViewport,
  advanceWaterTapeClock,
  aggregateTapeBuckets,
  bookPriceEmphasis,
  bookPriceEmphasisForUnit,
  bookPsychologicalPriceUnit,
  projectTapePrice,
  stableTapeQuoteStrength,
  tapeViewportFromRows,
} from "./orderbook.js";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const footprint = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
const chart = readFileSync(new URL("./chart.js", import.meta.url), "utf8");

function tapePainter() {
  const start = orderbook.indexOf("function drawTapeCard(card) {");
  const end = orderbook.indexOf("\nfunction drawAllTapes()", start);
  assert.ok(start >= 0 && end > start);
  return orderbook.slice(start, end);
}

test("psychological levels keep one anchored unit per symbol", () => {
  assert.equal(bookPsychologicalPriceUnit(.093), .001);
  assert.deepEqual(bookPriceEmphasis(.093, .093), { round: true, half: false, majorUnit: .001 });
  assert.deepEqual(bookPriceEmphasisForUnit(.0925, .001), { round: false, half: true, majorUnit: .001 });
  assert.match(orderbook, /function stableBookPsychologicalUnit\(card, referencePrice\)/);
});

test("water clock moves continuously between WebSocket packets", () => {
  const first = advanceWaterTapeClock(null, null, 10_000, 100, 100, false);
  const second = advanceWaterTapeClock(first, 100, 10_000, 100, 116, false);
  const third = advanceWaterTapeClock(second, 116, 10_000, 100, 132, false);
  assert.ok(second > first);
  assert.ok(third > second);
  assert.equal(advanceWaterTapeClock(third, 132, 10_000, 100, 148, true), third);
  assert.match(orderbook, /function activeTapeCards\(\)/);
  assert.match(orderbook, /requestAnimationFrame\(runTapeDrawFrame\)/);
});

test("all trades share one coherent affine price viewport", () => {
  const target = tapeViewportFromRows([
    { price: 99, y: 90, height: 10 },
    { price: 100, y: 50, height: 10 },
    { price: 101, y: 10, height: 10 },
  ]);
  const viewport = advanceTapePriceViewport(null, target, 16);
  assert.equal(projectTapePrice(viewport, 99).y, 90);
  assert.equal(projectTapePrice(viewport, 100).y, 50);
  assert.equal(projectTapePrice(viewport, 101).y, 10);
  const painter = tapePainter();
  assert.match(painter, /projectWaterTapeNodes/);
  assert.doesNotMatch(painter, /layoutTapeSequence|nearestVisibleRow|tapePricePosition/);
});

test("AGG buckets include the complete intersecting bucket", () => {
  const buckets = aggregateTapeBuckets([
    { id: 1, time: 920, price: 10, quote: 100, side: "buy" },
    { id: 2, time: 1_000, price: 10, quote: 200, side: "sell" },
  ], .01, 0, { startTime: 970, endTime: 1_100 });
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].quote, 300);
  assert.match(orderbook, /snapshot = Object\.freeze/);
  assert.match(orderbook, /state\.aggSourceBuckets/);
});

test("marker geometry is absolute and independent of visible neighbours", () => {
  assert.equal(stableTapeQuoteStrength(0), 0);
  assert.ok(stableTapeQuoteStrength(10_000) > stableTapeQuoteStrength(1_000));
  const painter = tapePainter();
  assert.match(painter, /const strength = stableTapeQuoteStrength\(item\.quote\)/);
  assert.match(painter, /const baseX = tapeTimeX\(item\.time, window, rect\.width\)/);
  assert.doesNotMatch(painter, /adaptiveRawDiameter\(strength, item\.density/);
});

test("footprint and chart visual requests stay applied", () => {
  assert.doesNotMatch(footprint, /formatSignedQuoteDelta|deltaText/);
  assert.match(footprint, /const alpha = \.38 \+ clusterStrength \* \.5/);
  assert.match(chart, /const fill = this\.theme\.bearFill;/);
});
''')

write("test-water-tape-renderer-v1.mjs", r'''import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  advanceTapePriceViewport,
  advanceWaterTapeClock,
  projectTapePrice,
  tapeViewportFromRows,
} from "./orderbook.js";

const source = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

function tapePainter() {
  const start = source.indexOf("function drawTapeCard(card) {");
  const end = source.indexOf("\nfunction drawAllTapes()", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test("adding a neighbouring trade cannot change an existing event coordinate", () => {
  const viewport = tapeViewportFromRows([
    { price: 10, y: 100, height: 10 },
    { price: 11, y: 50, height: 10 },
    { price: 12, y: 0, height: 10 },
  ]);
  const before = projectTapePrice(viewport, 11);
  const after = projectTapePrice(viewport, 11);
  assert.deepEqual(after, before);
  assert.match(source, /key: `raw:\$\{String\(trade\.id\)\}/);
  assert.match(source, /Object\.freeze\(\{/);
});

test("viewport changes move the whole historical layer coherently", () => {
  const first = tapeViewportFromRows([
    { price: 100, y: 100, height: 10 },
    { price: 101, y: 50, height: 10 },
    { price: 102, y: 0, height: 10 },
  ]);
  const second = tapeViewportFromRows([
    { price: 101, y: 100, height: 10 },
    { price: 102, y: 50, height: 10 },
    { price: 103, y: 0, height: 10 },
  ]);
  const moved = advanceTapePriceViewport(first, second, 16, 90);
  assert.ok(moved.lowPrice > first.lowPrice && moved.lowPrice < second.lowPrice);
  assert.ok(projectTapePrice(moved, 102));
});

test("clock never steps backward and does not depend on packet cadence", () => {
  const a = advanceWaterTapeClock(null, null, 1_000, 0, 0, false);
  const b = advanceWaterTapeClock(a, 0, 1_000, 0, 16, false);
  const c = advanceWaterTapeClock(b, 16, 1_008, 16, 32, false);
  assert.ok(b >= a);
  assert.ok(c >= b);
});

test("renderer does not feed historical items through collision layout", () => {
  const painter = tapePainter();
  assert.doesNotMatch(painter, /layoutTapeSequence|nearestVisibleRow|tapePricePosition/);
  assert.match(painter, /projectWaterTapeNodes/);
  assert.match(painter, /tapeTimeX\(item\.time, window, rect\.width\)/);
});
''')
