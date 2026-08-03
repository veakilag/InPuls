import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  advanceTapePriceViewport,
  advanceWaterTapeClock,
  aggregateTapeZeroMs,
  materializeZeroMsAggregates,
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

test("zero-ms AGG groups exact event time and freezes completed history", () => {
  const groups = aggregateTapeZeroMs([
    { id: 1, time: 1_000, price: 10, quote: 100, quantity: 10, side: "buy" },
    { id: 2, time: 1_000, price: 10.1, quote: 202, quantity: 20, side: "buy" },
    { id: 3, time: 1_001, price: 10.2, quote: 204, quantity: 20, side: "sell" },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].quote, 302);
  assert.equal(groups[0].price, 10);
  const view = materializeZeroMsAggregates({ aggSnapshots: new Map() }, groups, []);
  assert.equal(view[0].status, "sealed");
  assert.equal(view[1].status, "open");
  assert.match(orderbook, /state\.aggSourceBuckets = aggregateTapeZeroMs/);
});

test("marker geometry is absolute and independent of visible neighbours", () => {
  assert.equal(stableTapeQuoteStrength(0), 0);
  assert.ok(stableTapeQuoteStrength(10_000) > stableTapeQuoteStrength(1_000));
  const painter = tapePainter();
  assert.match(painter, /const strength = stableTapeQuoteStrength\(item\.quote\)/);
  assert.match(painter, /const baseX = tapeTradeX\(item\.time, window, rect\.width\)/);
  assert.match(
    orderbook,
    /function tapeTradeX\(time, window, width\) \{[\s\S]*tapeSecondSlotTime\(time, window\)[\s\S]*tapeTimeX\(slotTime \?\? time, window, width\)/,
  );
  assert.doesNotMatch(painter, /adaptiveRawDiameter\(strength, item\.density/);
});

test("footprint and chart visual requests stay applied", () => {
  assert.doesNotMatch(footprint, /formatSignedQuoteDelta|deltaText/);
  assert.match(footprint, /const alpha = \.58 \+ clusterStrength \* \.4/);
  assert.match(chart, /const fill = this\.theme\.bearFill;/);
});
