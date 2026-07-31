import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  aggregateTapeSweeps,
  aggregateTapeZeroMs,
  resolveTapeVisualTime,
} from "./orderbook.js?v=26-88-split-market-public-feed-v1";

const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("arrival time owns live X while exchange time still owns zero-ms grouping", () => {
  assert.equal(resolveTapeVisualTime(1_000, 9_000), 9_000);
  assert.equal(resolveTapeVisualTime(1_000, null), 1_000);
  const groups = aggregateTapeZeroMs([
    { id: 1, firstTradeId: 1, lastTradeId: 1, price: 100, quantity: 1, quote: 100, side: "buy", time: 1_000, receivedAt: 9_000, tradeTime: 1_000, eventTime: 1_000 },
    { id: 2, firstTradeId: 2, lastTradeId: 2, price: 101, quantity: 1, quote: 101, side: "buy", time: 1_000, receivedAt: 9_001, tradeTime: 1_000, eventTime: 1_000 },
    { id: 3, firstTradeId: 3, lastTradeId: 3, price: 102, quantity: 1, quote: 102, side: "buy", time: 1_020, receivedAt: 9_020, tradeTime: 1_020, eventTime: 1_020 },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].eventTime, 1_000);
  assert.equal(groups[0].time, 9_000);
  assert.equal(groups[0].lastTime, 9_001);
  const series = aggregateTapeSweeps(groups, { maxGapMs: 35, tick: 1 });
  assert.equal(series.length, 1);
  assert.equal(series[0].eventTime, 1_010);
  assert.equal(series[0].time, 9_010);
  assert.equal(series[0].labelPrice, 101);
});

test("full market rendering is not driven by exact seconds or high-rate auxiliary feeds", () => {
  assert.doesNotMatch(app, /setInterval\(render,\s*1_?000\)/);
  assert.match(app, /requestIdleCallback\(run, \{ timeout: 450 \}\)/);
  const bookBlock = app.match(/if \(data\.e === "bookTicker"[\s\S]*?return;\n    \}/)?.[0] ?? "";
  const tradeBlock = app.match(/if \(data\.e === "aggTrade"[\s\S]*?return;\n    \}/)?.[0] ?? "";
  assert.ok(bookBlock.length > 0);
  assert.ok(tradeBlock.length > 0);
  assert.doesNotMatch(bookBlock, /scheduleRender\(/);
  assert.doesNotMatch(tradeBlock, /scheduleRender\(/);
});
