import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOW_WORKSPACE,
  buildFootprintColumns,
  flowWindow,
  footprintBucketMs,
  footprintTone,
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
