import test from "node:test";
import assert from "node:assert/strict";
import { applyDepthUpdates, depthView, partialDepthView } from "../orderbook.js";

test("depth updates add, replace and remove price levels", () => {
  const levels = new Map([[100, 2], [99, 4]]);
  applyDepthUpdates(levels, [["100", "3.5"], ["99", "0"], ["101", "1"]]);
  assert.deepEqual([...levels.entries()].sort((a, b) => a[0] - b[0]), [[100, 3.5], [101, 1]]);
});

test("order book view keeps best bids and asks first", () => {
  const view = depthView(new Map([[99, 1], [101, 2], [100, 3]]), new Map([[104, 1], [102, 2], [103, 3]]), 2);
  assert.deepEqual(view.bids, [[101, 2], [100, 3]]);
  assert.deepEqual(view.asks, [[102, 2], [103, 3]]);
});

test("partial depth stream becomes a ready top-20 book without REST snapshot", () => {
  const view = partialDepthView({
    b: [["101", "2"], ["100", "4"]],
    a: [["103", "3"], ["102", "1"]],
  });
  assert.deepEqual(view.bids, [[101, 2], [100, 4]]);
  assert.deepEqual(view.asks, [[102, 1], [103, 3]]);
});
