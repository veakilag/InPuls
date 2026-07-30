import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

function tapePainter() {
  const start = orderbook.indexOf("function drawTapeCard(card) {");
  const end = orderbook.indexOf("\nfunction drawAllTapes()", start);
  assert.ok(start >= 0 && end > start);
  return orderbook.slice(start, end);
}

test("Tape threshold is restored without restoring aggregation levels", () => {
  assert.match(orderbook, /const TAPE_MIN_FILTER_KEY = "inpuls-tape-min-filter-v3"/);
  assert.match(orderbook, /data-inpuls-trade-min/);
  assert.match(orderbook, /localStorage\.setItem\(TAPE_MIN_FILTER_KEY/);
  assert.doesNotMatch(orderbook, /TAPE_AGGREGATION_LEVELS|data-inpuls-agg-step|AGG ×/);
  assert.match(orderbook, /export const TAPE_AGGREGATION_PERIOD_MS = 0/);
});

test("threshold filters markers while the path still uses every RAW trade", () => {
  const painter = tapePainter();
  assert.match(painter, /const pathItems = projectWaterTapeNodes\([\s\S]*recentRaw/);
  assert.match(painter, /filterWaterTapeCandidates\([\s\S]*sourceItems,[\s\S]*minQuote/);
  assert.match(painter, /const showLabel = minQuote > 0 \|\| Boolean\(item\.showLabel\)/);
});

test("zero threshold no longer writes a label on every aggregate", () => {
  assert.doesNotMatch(orderbook, /current\.showLabel = true/);
  assert.match(orderbook, /showLabel: stableTapeQuoteStrength\(group\.quote\) >= \.62/);
});
