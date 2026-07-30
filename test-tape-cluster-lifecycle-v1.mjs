import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildReadableTapeLayout } from "./orderbook-tape-layout.js";
import {
  TAPE_AGGREGATION_PERIOD_MS,
  aggregateTapeZeroMs,
  materializeZeroMsAggregates,
  bookDistancePercentLabel,
} from "./orderbook.js";
import {
  FOOTPRINT_TIMEFRAMES,
  createFootprintAccumulator,
  footprintIntervalHistory,
  footprintIntervalStart,
  ingestFootprintTrades,
} from "./orderbook-flow-workspace.js";

const runtime = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");

test("historical Tape X coordinates do not depend on newly appended neighbours", () => {
  const window = { startTime: 0, endTime: 1_000, duration: 1_000, plotRight: 500 };
  const first = [{ key: "a", time: 100 }, { key: "b", time: 101 }];
  const before = buildReadableTapeLayout(first, window, 500);
  const after = buildReadableTapeLayout([...first, { key: "c", time: 102 }], window, 500);
  assert.equal(after.find((item) => item.key === "a").x, before.find((item) => item.key === "a").x);
  assert.equal(after.find((item) => item.key === "b").x, before.find((item) => item.key === "b").x);
});

test("zero-ms AGG keeps sealed identity while only the newest group stays open", () => {
  assert.equal(TAPE_AGGREGATION_PERIOD_MS, 0);
  const state = { aggSnapshots: new Map() };
  const trades = [
    { id: 1, time: 1_010, price: 100.01, quote: 10, quantity: .1, side: "buy" },
    { id: 2, time: 1_010, price: 100.02, quote: 20, quantity: .2, side: "buy" },
    { id: 3, time: 1_011, price: 100.03, quote: 30, quantity: .3, side: "sell" },
  ];
  const firstView = materializeZeroMsAggregates(state, aggregateTapeZeroMs(trades), []);
  const sealed = firstView[0];
  assert.equal(sealed.status, "sealed");
  assert.equal(firstView[1].status, "open");
  assert.equal(sealed.price, 100.01);

  const nextView = materializeZeroMsAggregates(state, aggregateTapeZeroMs([
    ...trades,
    { id: 4, time: 1_011, price: 100.04, quote: 40, quantity: .4, side: "sell" },
  ]), []);
  assert.equal(nextView[0], sealed);
  assert.equal(nextView[1].quote, 70);
});

test("distance badge is unsigned and fixed to tenths", () => {
  assert.equal(bookDistancePercentLabel(101, 100), "1.0%");
  assert.equal(bookDistancePercentLabel(99.75, 100), "0.3%");
  assert.equal(bookDistancePercentLabel(100, 100), "0.0%");
});

test("footprint exposes the same timeframe set and exchange-aligned boundaries", () => {
  assert.deepEqual(FOOTPRINT_TIMEFRAMES, [
    "1s", "5s", "15s", "1m", "3m", "5m", "15m", "30m",
    "1h", "2h", "4h", "12h", "1d", "3d", "1w", "1M",
  ]);
  assert.equal(footprintIntervalStart(Date.UTC(2026, 6, 30, 12, 34, 56), "5m"), Date.UTC(2026, 6, 30, 12, 30, 0));
  assert.equal(footprintIntervalStart(Date.UTC(2026, 6, 30), "1M"), Date.UTC(2026, 6, 1));
  assert.equal(new Date(footprintIntervalStart(Date.UTC(2026, 6, 30), "1w")).getUTCDay(), 1);
});

test("first cluster candle is aligned but explicitly marked session-partial", () => {
  const accumulator = ingestFootprintTrades(createFootprintAccumulator(), [
    { id: 1, time: Date.UTC(2026, 6, 30, 12, 34, 20), price: 100, quantity: 1, quote: 100, side: "buy" },
  ]);
  const history = footprintIntervalHistory(accumulator, "5m", Date.UTC(2026, 6, 30, 12, 34, 30), 3, 0);
  assert.equal(history.at(-1).startTime, Date.UTC(2026, 6, 30, 12, 30, 0));
  assert.equal(history.at(-1).sessionPartial, true);
});

test("runtime ships zero-ms RAW/AGG control, synchronized canvas and density age toggle", () => {
  assert.match(runtime, /desynchronized: false/);
  assert.match(runtime, /button\.textContent = aggregated \? "AGG" : "RAW"/);
  assert.doesNotMatch(runtime, /data-inpuls-agg-step|TAPE_AGGREGATION_LEVELS/);
  assert.match(runtime, /data-inpuls-density-age/);
  assert.match(runtime, /densityLifecycle\?\.densities/);
  assert.match(workspace, /data-footprint-favorite/);
  assert.match(workspace, /FOOTPRINT_MAX_RETAINED_CELLS/);
  assert.match(workspace, /retainedFromAt/);
  assert.match(workspace, /LIVE\$\{sessionPartial \? " · PARTIAL"/);
});
