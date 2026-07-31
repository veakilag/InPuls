import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  TAPE_CLOCK_FUTURE_TOLERANCE_MS,
  TAPE_SWEEP_MAX_GAP_MS,
  TAPE_SWEEP_WINDOW_MS,
  TAPE_SWEEP_MIN_AGGREGATES,
  aggregateTapeZeroMs,
  aggregateTapeSweeps,
  materializeTapeSweeps,
  aggregateVisibleLabelPrice,
  advanceTapeDisplayClock,
  selectSweepLabelKeys,
} from "./orderbook.js?v=26-88-split-market-public-feed-v1";

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

test("Series groups same-side raw executions for a fixed 100 ms window", () => {
  const sweeps = aggregateTapeSweeps([
    trade(1, 1_000, 100, "buy"),
    trade(2, 1_040, 101, "buy"),
    trade(3, 1_100, 102, "buy"),
    trade(4, 1_101, 101, "sell"),
    trade(5, 1_150, 99, "sell"),
  ]);
  assert.equal(TAPE_SWEEP_WINDOW_MS, 100);
  assert.equal(TAPE_SWEEP_MAX_GAP_MS, 100);
  assert.equal(TAPE_SWEEP_MIN_AGGREGATES, 2);
  assert.equal(sweeps.length, 2);
  assert.equal(sweeps[0].aggregateCount, 3);
  assert.equal(sweeps[0].count, 3);
  assert.equal(sweeps[0].durationMs, 100);
  assert.equal(sweeps[0].labelPrice, 101);
  assert.equal(sweeps[0].kind, "sweep");
});

test("the first opposite execution closes the current Series immediately", () => {
  const sweeps = aggregateTapeSweeps([
    trade(10, 2_000, 10, "sell"),
    trade(11, 2_010, 9, "sell"),
    trade(12, 2_011, 10, "buy"),
    trade(13, 2_020, 11, "buy"),
  ]);
  assert.equal(sweeps.length, 2);
  assert.equal(sweeps[0].side, "sell");
  assert.equal(sweeps[1].side, "buy");
});

test("sealed Series history keeps identity while only the open Series grows", () => {
  const state = { sweepSnapshots: new Map() };
  const firstGroups = aggregateTapeSweeps([
    trade(20, 3_000, 100, "buy"),
    trade(21, 3_001, 101, "buy"),
    trade(22, 3_010, 100, "sell"),
    trade(23, 3_011, 99, "sell"),
  ]);
  const firstView = materializeTapeSweeps(state, firstGroups, []);
  assert.equal(firstView.length, 2);
  assert.equal(firstView[0].status, "sealed");
  assert.equal(firstView[1].status, "open");
  const sealed = firstView[0];

  const nextGroups = aggregateTapeSweeps([
    trade(20, 3_000, 100, "buy"),
    trade(21, 3_001, 101, "buy"),
    trade(22, 3_010, 100, "sell"),
    trade(23, 3_011, 99, "sell"),
    trade(24, 3_012, 98, "sell"),
  ]);
  const nextView = materializeTapeSweeps(state, nextGroups, []);
  assert.equal(nextView[0], sealed);
  assert.equal(nextView[1].status, "open");
  assert.equal(nextView[1].aggregateCount, 3);
});

test("Aggregate labels are clipped and Series labels use the ending price", () => {
  const viewport = { lowPrice: 100, highPrice: 110, step: 1, lowY: 100, highY: 0, rowHeight: 10 };
  assert.equal(aggregateVisibleLabelPrice(viewport, { minPrice: 90, maxPrice: 104 }), 100);
  assert.equal(aggregateVisibleLabelPrice(viewport, { minPrice: 104, maxPrice: 108 }), 106);
  assert.equal(aggregateVisibleLabelPrice(viewport, {
    minPrice: 104,
    maxPrice: 108,
    labelPrice: 108,
  }), 108);
  assert.ok(Number.isNaN(aggregateVisibleLabelPrice(viewport, { minPrice: 80, maxPrice: 90 })));
});

test("Tape live edge follows the site clock even when the market is silent", () => {
  const first = advanceTapeDisplayClock(null, null, 10_000, 20_000, 0);
  assert.equal(first, 20_000);
  const next = advanceTapeDisplayClock(first, 0, 10_000, 20_016, 16);
  assert.equal(next, 20_016);
  const futureTrade = advanceTapeDisplayClock(next, 16, 20_500, 20_032, 32);
  assert.ok(futureTrade >= 20_032);
  assert.ok(futureTrade <= 20_032 + TAPE_CLOCK_FUTURE_TOLERANCE_MS);
});

test("Series labels keep the larger volume when visual boxes collide", () => {
  const window = { startTime: 0, endTime: 2_000, duration: 2_000, plotRight: 200 };
  const labels = selectSweepLabelKeys([
    {
      source: { key: "small", time: 1_000, timeOrdinal: 0, quote: 1_000, aggregateCount: 2, showLabel: true, status: "sealed" },
      position: { y: 50 },
    },
    {
      source: { key: "large", time: 1_001, timeOrdinal: 0, quote: 8_000, aggregateCount: 5, showLabel: true, status: "sealed" },
      position: { y: 51 },
    },
  ], window, 200, () => 24);
  assert.deepEqual([...labels], ["large"]);
});

test("Current open Series label wins a collision so the live event remains readable", () => {
  const window = { startTime: 0, endTime: 2_000, duration: 2_000, plotRight: 200 };
  const labels = selectSweepLabelKeys([
    {
      source: { key: "old-large", time: 1_000, timeOrdinal: 0, quote: 20_000, aggregateCount: 8, showLabel: true, status: "sealed" },
      position: { y: 50 },
    },
    {
      source: { key: "live", time: 1_001, timeOrdinal: 0, quote: 3_000, aggregateCount: 3, showLabel: true, status: "open" },
      position: { y: 51 },
    },
  ], window, 200, () => 24);
  assert.deepEqual([...labels], ["live"]);
});

test("Burst traffic cannot create an unbounded wall of Series labels", () => {
  const window = { startTime: 0, endTime: 2_000, duration: 2_000, plotRight: 200 };
  const projected = Array.from({ length: 60 }, (_, index) => ({
    source: {
      key: `burst-${index}`,
      time: 500 + index * 20,
      timeOrdinal: 0,
      quote: 60_000 - index,
      aggregateCount: 5,
      showLabel: true,
      status: "sealed",
    },
    position: { y: index * 24 },
  }));
  const labels = selectSweepLabelKeys(projected, window, 200, () => 24);
  assert.ok(labels.size > 0);
  assert.ok(labels.size <= 3);
});

test("Runtime exposes compact Series and avoids per-second card rescans", () => {
  const source = fs.readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
  assert.match(source, /mode === "raw" \? "agg" : state\.mode === "agg" \? "sweep" : "raw"/);
  assert.match(source, /button\.textContent = mode === "agg" \? "AGG" : mode === "sweep" \? "СЕРИЯ" : "RAW"/);
  assert.match(source, /current\.count >= TAPE_SWEEP_MIN_AGGREGATES/);
  assert.match(source, /function drawSweepDirection\(/);
  assert.match(source, /roundedRectPath\(context, x - bodyWidth \/ 2/);
  assert.match(source, /function selectSweepLabelKeys\(/);
  assert.match(source, /function selectTapeLabelKeys\(/);
  assert.match(source, /const maximumLabels = sweepMode/);
  assert.match(source, /const showLabel = sweepMode\s*\? Boolean\(sweepLabelKeys\?\.has\(item\.key\)\)\s*:\s*Boolean\(aggLabelKeys\?\.has\(item\.key\)\)/);
  assert.match(source, /advanceTapeDisplayClock\(\s*state\.clockEndTime,\s*state\.clockPerfAt,\s*latestTime,/);
  assert.match(source, /cachedTapeClockLabel\(state, window\.endTime\).*LIVE/);
  assert.doesNotMatch(source, /tapeStateTimer = setInterval/);
  assert.doesNotMatch(source, /Math\.floor\(age \/ 1_000\)/);
});

test("Footprint volume labels reuse order-book size typography", () => {
  const source = fs.readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
  assert.match(source, /formatCompactUsd\(cluster\.quote\)/);
  assert.match(source, /querySelector\?\.\("\.book-size"\)/);
});
