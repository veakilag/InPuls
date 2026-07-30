import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

function block(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test("frame arrays and projection slots are reused", () => {
  assert.match(source, /recentRawScratch: \[\]/);
  assert.match(source, /pathProjectionScratch: \[\]/);
  assert.match(source, /markerProjectionScratch: \[\]/);
  const projection = block("function projectWaterTapeNodes", "\nfunction prepareRawTapeMarkerBatches");
  assert.match(projection, /const slot = output\[count\] \?\?/);
  assert.match(projection, /projectTapePriceInto/);
  assert.doesNotMatch(projection, /projected = \[\]|\{ \.\.\.item/);
});

test("unfiltered RAW dots are drawn in a bounded number of Canvas batches", () => {
  const painter = block("function drawTapeCard(card) {", "\nfunction drawAllTapes()");
  const batching = block("function drawRawTapeMarkerBatches", "\nfunction drawTapeCard");
  assert.match(painter, /prepareRawTapeMarkerBatches\(state\)/);
  assert.match(painter, /rawMarkerBatches\[bucketIndex\]\.push\(x, y\)/);
  assert.match(painter, /drawRawTapeMarkerBatches\(context, rawMarkerBatches\)/);
  assert.match(batching, /context\.fill\(\)/);
  assert.match(source, /RAW_TAPE_MARKER_BUCKETS \* 2/);
});

test("status overlays do not mutate DOM twice per frame", () => {
  const status = block("function setTapeState", "\nfunction setTapeRangeSummary");
  const range = block("function setTapeRangeSummary", "\nfunction visiblePriceRange");
  const painter = block("function drawTapeCard(card) {", "\nfunction drawAllTapes()");
  assert.match(status, /state\.lastStatusText === value/);
  assert.match(range, /state\.lastRangeAbove === safeAbove/);
  assert.doesNotMatch(painter, /paintTapeSurface\(context, rect\);[\s\S]{0,120}setTapeRangeSummary\(state, 0, 0\)/);
});

test("batched renderer keeps near-fluid cadence under high trade rate", () => {
  const cadence = block("function targetTapeFrameMs", "\nfunction activeTapeCards");
  assert.match(cadence, /recentRate > 2_000/);
  assert.match(cadence, /Math\.max\(base, 32\)/);
  assert.match(cadence, /recentRate > 500/);
  assert.match(cadence, /Math\.max\(base, 20\)/);
});
