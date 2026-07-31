import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  TAPE_SWEEP_MAX_GAP_MS,
  aggregateTapeZeroMs,
  aggregateTapeSweeps,
  aggregateVisibleLabelPrice,
  advanceTapeDisplayClock,
} from "./orderbook.js?v=26-80-sweep-tape-clock-v1";

const trade = (id, time, price, side, quantity = 1) => ({
  id,
  firstTradeId: id,
  lastTradeId: id,
  time,
  price,
  quantity,
  quote: price * quantity,
  side,
});

test("Sweep joins adjacent same-side AGG across milliseconds", () => {
  const zero = aggregateTapeZeroMs([
    trade(1, 1_000, 100, "buy"),
    trade(2, 1_001, 101, "buy"),
    trade(3, 1_020, 102, "buy"),
    trade(4, 1_040, 101, "buy"),
    trade(5, 1_041, 99, "buy"),
    trade(6, 1_042, 98, "sell"),
  ]);
  const sweeps = aggregateTapeSweeps(zero);
  assert.equal(TAPE_SWEEP_MAX_GAP_MS, 35);
  assert.equal(sweeps.length, 3);
  assert.equal(sweeps[0].aggregateCount, 4);
  assert.equal(sweeps[0].count, 4);
  assert.equal(sweeps[0].minPrice, 100);
  assert.equal(sweeps[0].maxPrice, 102);
  assert.equal(sweeps[0].durationMs, 40);
  assert.equal(sweeps[1].firstPrice, 99);
  assert.equal(sweeps[2].side, "sell");
});

test("Sweep breaks on ID gap and excessive pause", () => {
  const zero = aggregateTapeZeroMs([
    trade(10, 2_000, 10, "sell"),
    trade(12, 2_001, 9, "sell"),
    trade(13, 2_100, 8, "sell"),
  ]);
  const sweeps = aggregateTapeSweeps(zero);
  assert.equal(sweeps.length, 3);
});

test("Aggregate labels are clipped to visible price range and absent outside it", () => {
  const viewport = { lowPrice: 100, highPrice: 110, step: 1, lowY: 100, highY: 0, rowHeight: 10 };
  assert.equal(aggregateVisibleLabelPrice(viewport, { minPrice: 90, maxPrice: 104 }), 100);
  assert.equal(aggregateVisibleLabelPrice(viewport, { minPrice: 104, maxPrice: 108 }), 106);
  assert.ok(Number.isNaN(aggregateVisibleLabelPrice(viewport, { minPrice: 80, maxPrice: 90 })));
});

test("Tape display clock follows wall clock smoothly instead of last trade packets", () => {
  const first = advanceTapeDisplayClock(null, null, 10_000, 0);
  const second = advanceTapeDisplayClock(first, 0, 10_016, 16);
  const third = advanceTapeDisplayClock(second, 16, 10_032, 32);
  assert.equal(first, 10_000);
  assert.ok(second >= 10_015 && second <= 10_017);
  assert.ok(third >= second);
});

test("Runtime exposes RAW, AGG and SERIES without per-second card rescans", () => {
  const source = fs.readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
  assert.match(source, /mode === "raw" \? "agg" : state\.mode === "agg" \? "sweep" : "raw"/);
  assert.match(source, /button\.textContent = mode === "agg" \? "AGG" : mode === "sweep" \? "СЕРИЯ" : "RAW"/);
  const timerBlock = source.match(/tapeStateTimer = setInterval\(\(\) => \{[\s\S]*?\}, TAPE_STATE_REFRESH_MS\);/)?.[0] ?? "";
  assert.ok(timerBlock.length > 0);
  assert.doesNotMatch(timerBlock, /scanTapeCards\(document\)/);
  assert.match(timerBlock, /if \(state\.densityAgeVisible\) decorateDensityAges/);
});

test("Footprint volume labels reuse order-book size typography", () => {
  const source = fs.readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
  assert.match(source, /state\.context\.font = "700 7px Arial, sans-serif"/);
});
