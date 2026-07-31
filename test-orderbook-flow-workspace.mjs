import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  FOOTPRINT_TIMEFRAMES,
  FLOW_WORKSPACE,
  buildFootprintColumns,
  createFootprintAccumulator,
  flowWindow,
  footprintIntervalHistory,
  footprintIntervalSnapshot,
  footprintColumnWidthForWheel,
  footprintHistoryOffsetLimit,
  footprintBucketMs,
  footprintTone,
  ingestFootprintTrades,
  mergeFlowTrades,
  normalizeFlowTrade,
  visibleFlowCount,
} from "./orderbook-flow-workspace.js";

test("normalizes and deduplicates trade history", () => {
  const trade = { id: 7, price: 100, quantity: 2, time: 1_000, side: "buy" };
  assert.equal(normalizeFlowTrade(trade).quote, 200);
  const merged = mergeFlowTrades([trade], [trade, { ...trade, id: 8, time: 1_001 }]);
  assert.deepEqual(merged.map((item) => item.id), [8, 7]);
});

test("footprint columns preserve time, price and aggressor totals", () => {
  const columns = buildFootprintColumns([
    { id: 1, price: 100, quantity: 1, quote: 100, time: 1_100, side: "buy" },
    { id: 2, price: 100, quantity: 2, quote: 200, time: 1_200, side: "sell" },
    { id: 3, price: 101, quantity: 1, quote: 101, time: 1_600, side: "buy" },
  ], {
    startTime: 1_000,
    endTime: 2_000,
    bucketMs: 500,
    priceStep: 1,
  });
  assert.equal(columns.length, 2);
  assert.equal(columns[0].count, 2);
  assert.equal(columns[0].cells[0].buyQuote, 100);
  assert.equal(columns[0].cells[0].sellQuote, 200);
  assert.equal(columns[1].cells[0].price, 101);
});

test("flow window and visible count stay independent from pane width", () => {
  const window = flowWindow(20_000, 15_000);
  assert.deepEqual(window, { startTime: 5_000, endTime: 20_000, duration: 15_000 });
  assert.equal(
    visibleFlowCount([{ time: 4_999 }, { time: 5_000 }, { time: 20_000 }], 5_000, 20_000),
    2,
  );
  assert.ok(footprintBucketMs(120, window.duration) >= FLOW_WORKSPACE.minimumBucketMs);
  assert.ok(footprintBucketMs(1_200, window.duration) >= FLOW_WORKSPACE.minimumBucketMs);
});

test("footprint tone reports buy and sell dominance", () => {
  assert.equal(footprintTone({ buyQuote: 100, sellQuote: 0 }), 1);
  assert.equal(footprintTone({ buyQuote: 0, sellQuote: 100 }), -1);
  assert.equal(footprintTone({ buyQuote: 50, sellQuote: 50 }), 0);
});

test("1M and 5M clusters use aligned live intervals without delta", () => {
  const accumulator = createFootprintAccumulator();
  ingestFootprintTrades(accumulator, [
    { id: 1, price: 100, quantity: 1, quote: 100, time: 61_000, side: "buy" },
    { id: 2, price: 100, quantity: 2, quote: 200, time: 62_000, side: "sell" },
    { id: 3, price: 101, quantity: 1, quote: 101, time: 121_000, side: "buy" },
  ]);

  const oneMinute = footprintIntervalSnapshot(accumulator, 60_000, 62_500);
  assert.equal(oneMinute.startTime, 60_000);
  assert.equal(oneMinute.endTime, 120_000);
  assert.equal(oneMinute.partial, true);
  assert.equal(oneMinute.count, 2);
  assert.equal(oneMinute.cells[0].buyQuote, 100);
  assert.equal(oneMinute.cells[0].sellQuote, 200);

  const fiveMinutes = footprintIntervalSnapshot(accumulator, 300_000, 122_000);
  assert.equal(fiveMinutes.count, 3);
  assert.equal(fiveMinutes.cells.length, 2);
  assert.deepEqual([...FOOTPRINT_TIMEFRAMES], ["1s", "5s", "15s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "12h", "1d", "3d", "1w", "1M"]);
});

test("a live reset clears both cluster timeframes", () => {
  const accumulator = ingestFootprintTrades(createFootprintAccumulator(), [
    { id: 1, price: 100, quantity: 1, quote: 100, time: 61_000, side: "buy" },
  ]);
  ingestFootprintTrades(accumulator, [], { replace: true });
  assert.equal(footprintIntervalSnapshot(accumulator, 60_000, 62_000).count, 0);
  assert.equal(footprintIntervalSnapshot(accumulator, 300_000, 62_000).count, 0);
});

test("cluster history keeps aligned 1M and 5M columns", () => {
  const accumulator = createFootprintAccumulator();
  ingestFootprintTrades(accumulator, [
    { id: 1, price: 100, quantity: 1, quote: 100, time: 61_000, side: "buy" },
    { id: 2, price: 101, quantity: 1, quote: 101, time: 121_000, side: "sell" },
    { id: 3, price: 102, quantity: 1, quote: 102, time: 301_000, side: "buy" },
  ]);

  const oneMinute = footprintIntervalHistory(accumulator, 60_000, 302_000, 8);
  assert.deepEqual(oneMinute.map((item) => item.startTime), [
    60_000,
    120_000,
    180_000,
    240_000,
    300_000,
  ]);
  assert.deepEqual(oneMinute.map((item) => item.count), [1, 1, 0, 0, 1]);

  const fiveMinutes = footprintIntervalHistory(accumulator, 300_000, 302_000, 8);
  assert.deepEqual(fiveMinutes.map((item) => item.startTime), [0, 300_000]);
  assert.deepEqual(fiveMinutes.map((item) => item.count), [2, 1]);
});

test("Ctrl+wheel compacts columns toward LIVE and dragging can inspect older intervals", () => {
  assert.equal(footprintColumnWidthForWheel(54, -100), 47);
  assert.equal(footprintColumnWidthForWheel(47, 100), 54);

  const accumulator = createFootprintAccumulator();
  ingestFootprintTrades(accumulator, [
    { id: 1, price: 100, quantity: 1, quote: 100, time: 61_000, side: "buy" },
    { id: 2, price: 101, quantity: 1, quote: 101, time: 121_000, side: "sell" },
    { id: 3, price: 102, quantity: 1, quote: 102, time: 181_000, side: "buy" },
    { id: 4, price: 103, quantity: 1, quote: 103, time: 241_000, side: "sell" },
    { id: 5, price: 104, quantity: 1, quote: 104, time: 301_000, side: "buy" },
  ]);

  assert.equal(footprintHistoryOffsetLimit(accumulator, 60_000, 302_000), 4);
  const older = footprintIntervalHistory(accumulator, 60_000, 302_000, 2, 2);
  assert.deepEqual(older.map((item) => item.startTime), [120_000, 180_000]);
});

test("Flow Workspace redraw observer cannot trigger itself", () => {
  const source = readFileSync(
    new URL("./orderbook-flow-workspace.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /observer\.observe\(bookRows,/);
  assert.doesNotMatch(source, /observer\.observe\(card,/);
  assert.doesNotMatch(
    source.match(/observer\.observe\(bookRows,[\s\S]*?\}\);/)?.[0] ?? "",
    /characterData/,
  );
  assert.match(source, /data-footprint-select/);
  assert.match(source, /data-footprint-favorite/);
  assert.doesNotMatch(source, /<span>Δ<\/span>/);
  assert.match(source, /sessionPartial/);
  assert.doesNotMatch(source, /content: "TAPE"/);
  assert.match(source, /FLOW_LAYER_VISIBILITY_EVENT/);
  assert.match(source, /skip\("layer-hidden"\)/);
  assert.doesNotMatch(source, /inpuls-flow-count|flowCount|flowCountText|0 trades/);
  assert.match(source, /bookWidth - delta/);
  assert.match(source, /const sellWidth = cellWidth \* sellShare/);
  assert.match(source, /const buyWidth = Math\.max\(0, cellWidth - sellWidth\)/);
  assert.match(source, /formatCompactUsd\(cluster\.quote\)/);
  assert.match(source, /footprintBookVolumeTextStyle\(state, theme\)/);
  assert.match(source, /querySelector\?\.\("\.book-size"\)/);
  assert.match(source, /incoming\.length && state\.historyOffset === 0/);
  assert.match(source, /const highRow = nearestRow\(rows, interval\.highPrice\)/);
});
