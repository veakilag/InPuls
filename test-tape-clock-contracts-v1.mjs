import test from "node:test";
import assert from "node:assert/strict";

// Regression contract: execution, visual and interval clocks stay independent.
import { tapeVisualTime } from "./orderbook.js?v=26-125-aster-alpha-v1";
import {
  createFootprintAccumulator,
  footprintIntervalSnapshot,
  ingestFootprintTrades,
  stableFootprintPriceStep,
} from "./orderbook-flow-workspace.js?v=26-125-aster-alpha-v1";

test("Tape visual time uses calibrated receive time", () => {
  assert.equal(tapeVisualTime(10_000, 10_150, 200), 10_350);
  assert.equal(tapeVisualTime(10_500, 10_000, 100), 10_500);
});

test("footprint step ignores an off-grid current-price row", () => {
  const rows = [1, 1.01, 1.02, 1.025, 1.03, 1.04, 1.05].map((price) => ({ price }));
  assert.equal(stableFootprintPriceStep(rows), .01);
});

test("new live interval exists before its first trade", () => {
  const accumulator = createFootprintAccumulator();
  ingestFootprintTrades(accumulator, [{
    id: 1,
    price: 42,
    quantity: 1,
    quote: 42,
    time: 59_500,
    side: "buy",
  }]);
  const snapshot = footprintIntervalSnapshot(accumulator, "1m", 60_250);
  assert.equal(snapshot.startTime, 60_000);
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.count, 0);
  assert.equal(snapshot.openPrice, 42);
  assert.equal(snapshot.closePrice, 42);
  assert.equal(snapshot.cells.length, 0);
});
