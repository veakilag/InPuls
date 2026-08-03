import assert from "node:assert/strict";
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
  assert.match(painter, /tapeTradeX\(item\.time, window, rect\.width\)/);
  assert.match(
    source,
    /function tapeTradeX\(time, window, width\) \{[\s\S]*tapeSecondSlotTime\(time, window\)[\s\S]*tapeTimeX\(slotTime \?\? time, window, width\)/,
  );
});
