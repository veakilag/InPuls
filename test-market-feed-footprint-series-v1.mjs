import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { TAPE_SWEEP_WINDOW_MS, aggregateTapeSweeps } from "./orderbook.js?v=26-88-split-market-public-feed-v1";
import { selectFootprintTapeBatch } from "./orderbook-flow-workspace.js?v=26-88-split-market-public-feed-v1";

const trade = (id, eventTime, receivedAt, price, side, quote = 1_000) => ({
  id, firstTradeId: id, lastTradeId: id, eventTime, tradeTime: eventTime,
  receivedAt, time: receivedAt, price, quantity: quote / price, quote, side,
});

test("global market feed goes online only after a valid miniTicker packet", () => {
  const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /isCoreMiniTickerPacket\(data\)/);
  assert.match(app, /setConnection\("online", "Онлайн"\)/);
  assert.match(app, /Нет miniTicker · резервный поток/);
  assert.match(app, /isBinanceSubscriptionError\(payload\)/);
});

test("footprint bootstraps from stable Tape and switches once to guarded flow", () => {
  const stable = [{ id: 1 }];
  const guarded = [{ id: 2 }];
  assert.deepEqual(selectFootprintTapeBatch({ live: true, trades: stable, aggregationTrades: [] }, null), { trades: stable, source: "stable", replace: false });
  assert.deepEqual(selectFootprintTapeBatch({ live: true, trades: stable, aggregationTrades: guarded }, "stable"), { trades: guarded, source: "guarded", replace: true });
  assert.deepEqual(selectFootprintTapeBatch({ live: true, trades: stable, aggregationTrades: [] }, "guarded"), { trades: [], source: "guarded", replace: false });
});

test("Series groups raw aggressive trades for 100 ms and closes on the first opposite trade", () => {
  const series = aggregateTapeSweeps([
    trade(1, 1_000, 2_000, 100, "buy", 1_000),
    trade(2, 1_040, 2_040, 101, "buy", 2_000),
    trade(3, 1_100, 2_100, 102, "buy", 3_000),
    trade(4, 1_101, 2_101, 101, "sell", 4_000),
    trade(5, 1_150, 2_150, 100, "sell", 5_000),
  ]);
  assert.equal(TAPE_SWEEP_WINDOW_MS, 100);
  assert.equal(series.length, 2);
  assert.equal(series[0].side, "buy");
  assert.equal(series[0].count, 3);
  assert.equal(series[0].quote, 6_000);
  assert.equal(series[0].time, 2_050);
  assert.equal(series[0].labelPrice, 101);
  assert.equal(series[0].sizeQuote, 3_000);
  assert.equal(series[1].side, "sell");
  assert.equal(series[1].count, 2);
});

test("same-side trades outside the 100 ms window start a new Series", () => {
  const series = aggregateTapeSweeps([
    trade(10, 5_000, 6_000, 10, "buy"),
    trade(11, 5_100, 6_100, 11, "buy"),
    trade(12, 5_101, 6_101, 12, "buy"),
    trade(13, 5_150, 6_150, 13, "buy"),
  ]);
  assert.equal(series.length, 2);
  assert.equal(series[0].count, 2);
  assert.equal(series[1].count, 2);
});

test("footprint uses order-book USD formatting and highlights the column maximum", () => {
  const source = fs.readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
  assert.match(source, /formatCompactUsd\(cluster\.quote\)/);
  assert.match(source, /querySelector\?\.\("\.book-size"\)/);
  assert.match(source, /const isColumnMaximum =/);
  assert.match(source, /lineWidth = isColumnMaximum \? 2\.15 : 1\.15/);
});
