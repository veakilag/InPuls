import assert from "node:assert/strict";
import test from "node:test";

await import("../orderbook-depth-projection.js?test");

const { compactDepthSide, compactDepthView } = globalThis.InPulsOrderBookDepthProjection;

function quoteTotal(levels) {
  return levels.reduce(
    (sum, [price, quantity]) => sum + Number(price) * Number(quantity),
    0,
  );
}

test("deep projection preserves exact near levels and total quote", () => {
  const asks = Array.from({ length: 1_000 }, (_, index) => {
    const price = 100 + (index + 1) * .01;
    const quantity = index === 850 ? 5_000 : 1 + index % 5;
    return [price, quantity];
  });
  const projected = compactDepthSide(asks, "ask", {
    exactLimit: 100,
    densityLimit: 12,
    bandCount: 24,
  });

  assert.deepEqual(projected.levels.slice(0, 100), asks.slice(0, 100));
  assert.equal(projected.metadata.compacted, true);
  assert.ok(projected.levels.length <= 136);
  assert.ok(projected.levels.some(([price]) => price === asks[850][0]));
  assert.ok(Math.abs(quoteTotal(projected.levels) - quoteTotal(asks)) < 1e-6);
});

test("deep projection stays ordered on both sides", () => {
  const bids = Array.from({ length: 500 }, (_, index) => [100 - index * .01, 1 + index]);
  const asks = Array.from({ length: 500 }, (_, index) => [100 + index * .01, 1 + index]);
  const projected = compactDepthView(
    { bids, asks },
    { exactLimit: 80, densityLimit: 16, bandCount: 32 },
  );

  assert.ok(projected.bids.every((row, index) => index === 0 || projected.bids[index - 1][0] >= row[0]));
  assert.ok(projected.asks.every((row, index) => index === 0 || projected.asks[index - 1][0] <= row[0]));
  assert.equal(projected.bids[0][0], bids[0][0]);
  assert.equal(projected.asks[0][0], asks[0][0]);
  assert.ok(projected.metadata.bids.projectedLevels < bids.length);
  assert.ok(projected.metadata.asks.projectedLevels < asks.length);
});

test("small books pass through without compaction", () => {
  const view = compactDepthView({
    bids: [[100, 2], [99, 3]],
    asks: [[101, 4], [102, 5]],
  }, { exactLimit: 10 });

  assert.deepEqual(view.bids, [[100, 2], [99, 3]]);
  assert.deepEqual(view.asks, [[101, 4], [102, 5]]);
  assert.equal(view.metadata.bids.compacted, false);
  assert.equal(view.metadata.asks.compacted, false);
});
