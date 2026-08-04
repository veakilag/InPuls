import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TAPE_AGGREGATION_PERIOD_MS,
  aggregateTapeZeroMs,
  materializeZeroMsAggregates,
} from "./orderbook.js";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

const trade = (id, time, side, price, quote) => ({
  id,
  time,
  side,
  price,
  quote,
  quantity: quote / price,
});

test("zero-ms AGG groups only consecutive executions with equal event time and side", () => {
  assert.equal(TAPE_AGGREGATION_PERIOD_MS, 0);
  const groups = aggregateTapeZeroMs([
    trade(5, 1001, "buy", 101, 505),
    trade(2, 1000, "buy", 100, 200),
    trade(1, 1000, "buy", 99, 99),
    trade(3, 1000, "sell", 98, 196),
    trade(4, 1001, "buy", 100, 300),
  ]);

  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => [group.eventTime, group.side, group.count]), [
    [1000, "buy", 2],
    [1000, "sell", 1],
    [1001, "buy", 2],
  ]);
  assert.equal(groups[0].quote, 299);
  assert.equal(groups[0].price, 99, "marker stays on the first execution price");
  assert.notEqual(groups[0].vwapPrice, groups[0].price);
});

test("only the right-most aggregate is OPEN and sealed history keeps object identity", () => {
  const state = { aggSnapshots: new Map() };
  const first = aggregateTapeZeroMs([
    trade(1, 1000, "buy", 100, 100),
    trade(2, 1001, "sell", 101, 202),
  ]);
  const firstView = materializeZeroMsAggregates(state, first, []);
  assert.equal(firstView[0].status, "sealed");
  assert.equal(firstView[1].status, "open");
  assert.equal(Object.isFrozen(firstView[0]), true);
  assert.equal(Object.isFrozen(firstView[1]), true);

  const sealed = firstView[0];
  const updated = aggregateTapeZeroMs([
    trade(1, 1000, "buy", 100, 100),
    trade(2, 1001, "sell", 101, 202),
    trade(3, 1001, "sell", 102, 204),
  ]);
  const updatedView = materializeZeroMsAggregates(state, updated, []);
  assert.equal(updatedView[0], sealed, "historical aggregate is reused, not rebuilt");
  assert.equal(updatedView[1].status, "open");
  assert.equal(updatedView[1].quote, 406, "only current OPEN aggregate grows immediately");
});

test("Tape UI keeps zero-ms AGG, adds SERIES and restores the marker threshold", () => {
  assert.doesNotMatch(orderbook, /TAPE_AGGREGATION_LEVELS|data-inpuls-agg-step|AGG ×/);
  assert.doesNotMatch(orderbook, /TAPE_AGG_EVENT_GRACE_MS|TAPE_AGG_WALL_CLOCK_GRACE_MS/);
  assert.match(orderbook, /data-inpuls-trade-min|TAPE_MIN_FILTER_KEY/);
  assert.match(orderbook, /button\.textContent = mode === "series" \? "СЕРИЯ" : mode\.toUpperCase\(\)/);
  assert.match(orderbook, /TAPE_SERIES_MAX_GAP_MS = 500/);
  assert.match(orderbook, /AGG 0 мс/);
  assert.match(orderbook, /status: "open"/);
  assert.match(orderbook, /status: "sealed"/);
});
