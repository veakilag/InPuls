import test from "node:test";
import assert from "node:assert/strict";

// Series is event-first: reversal closes immediately, silence only separates attacks.
import {
  TAPE_SERIES_MAX_GAP_MS,
  aggregateTapeSeries,
  materializeTapeSeries,
  nextTapeMode,
  normalizeTapeMode,
} from "./orderbook.js?v=26-117-chart-interaction-performance-v1";

function trade(id, time, side, price, quote) {
  return {
    id,
    time,
    tradeTime: time,
    eventTime: time,
    displayTime: time,
    side,
    price,
    quote,
    quantity: quote / price,
  };
}

test("Tape mode cycles RAW to AGG to SERIES", () => {
  assert.equal(normalizeTapeMode(null), "raw");
  assert.equal(nextTapeMode("raw"), "agg");
  assert.equal(nextTapeMode("agg"), "series");
  assert.equal(nextTapeMode("series"), "raw");
});

test("same aggressor merges until opposite side or silence boundary", () => {
  const groups = aggregateTapeSeries([
    trade(1, 1_000, "buy", 100, 1_000),
    trade(2, 1_240, "buy", 101, 2_000),
    trade(3, 1_241, "sell", 100, 500),
    trade(4, 1_700, "sell", 99, 1_500),
    trade(5, 2_201, "sell", 98, 700),
  ]);

  assert.equal(TAPE_SERIES_MAX_GAP_MS, 500);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => group.side), ["buy", "sell", "sell"]);
  assert.deepEqual(groups.map((group) => group.count), [2, 2, 1]);
  assert.equal(groups[0].quote, 3_000);
  assert.equal(groups[0].minPrice, 100);
  assert.equal(groups[0].maxPrice, 101);
  assert.equal(groups[0].time, 1_240);
  assert.equal(groups[1].quote, 2_000);
  assert.equal(groups[2].firstEventTime - groups[1].lastEventTime, 501);
});

test("only the live right-most series grows and silence seals it visually", () => {
  const groups = aggregateTapeSeries([
    trade(10, 10_000, "buy", 100, 1_000),
    trade(11, 10_100, "buy", 101, 2_000),
    trade(12, 10_200, "sell", 100, 500),
  ]);
  const state = {};
  const live = materializeTapeSeries(state, groups, [], 10_400);
  assert.equal(live[0].status, "sealed");
  assert.equal(live[1].status, "open");
  assert.equal(live[0].showLabel, true);
  assert.equal(state.seriesSnapshots.size, 1);

  const timedOut = materializeTapeSeries(state, groups, [], 10_701);
  assert.equal(timedOut.at(-1).status, "sealed");
  assert.equal(state.seriesSnapshots.size, 1);
});
