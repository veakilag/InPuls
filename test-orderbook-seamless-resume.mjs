import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("./orderbook-worker.js", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("./sw.js", import.meta.url), "utf8");

test("background return reuses the existing worker before a guarded restart", () => {
  assert.doesNotMatch(orderbook, /ORDERBOOK_BACKGROUND_HARD_RESTART_MS/);
  assert.doesNotMatch(orderbook, /hiddenFor\s*>=/);
  assert.match(orderbook, /ORDERBOOK_RESUME_PROBE_MS\s*=\s*3_500/);
  assert.match(orderbook, /Worker не проснулся после фона/);
  assert.match(orderbook, /this\.worker\.postMessage\(this\.#visibilityPayload\(true\)\)/);
});

test("last rendered book remains visible while strict resync happens", () => {
  assert.match(orderbook, /СИНХРОНИЗАЦИЯ · последний кадр/);
  assert.match(worker, /const preserveLastFrame = this\.depthReady \|\|/);
  assert.match(worker, /this\.syncing = preserveLastFrame/);
  assert.match(worker, /this\.setStatus\("stale", "СИНХРОНИЗАЦИЯ · последний кадр"\)/);
  assert.match(worker, /this\.syncing = false;[\s\S]*diagnose\(this\.symbol, "depth\.live"[\s\S]*this\.publishLiveStatus\(\)/);
  assert.match(worker, /syncing: this\.syncing/);
});

test("resume prioritizes the last selected symbol and staggers other feeds", () => {
  assert.match(orderbook, /#promoteSymbol\(symbol\)/);
  assert.match(orderbook, /prioritySymbols: visible \? this\.#orderedSymbols\(\) : \[\]/);
  assert.match(worker, /priorityRank = new Map/);
  assert.match(worker, /active\.forEach\(\(feed, index\) => feed\.resume\(index \* RESUME_STAGGER_MS, epoch\)\)/);
});

test("long recovery backfills trades while fast resume avoids REST", () => {
  assert.match(
    worker,
    /restartAfterBackground\(force = false\)[\s\S]*loadRecentTrades\(generation, \{ resume: true \}\)/,
  );
  const resumeStart = worker.indexOf("  resume(");
  const resumeEnd = worker.indexOf("\n  restartAfterBackground(", resumeStart);
  const resumeBlock = worker.slice(resumeStart, resumeEnd);
  assert.doesNotMatch(resumeBlock, /loadRecentTrades/);
  assert.match(worker, /async loadRecentTrades\(generation, \{ resume = false \} = \{\}\)/);
  assert.match(worker, /replace: !resume/);
  assert.match(worker, /resume,\n\s*trades,/);
});

test("resume overlap filtering stays off the live trade hot path", () => {
  assert.match(worker, /const coveredRanges = resume \? mergeTradeCoverage\(this\.tradeSnapshot\(\)\) : null/);
  assert.match(worker, /tradeCoverageOverlaps\(coveredRanges, trade\.firstTradeId, trade\.lastTradeId\)/);
  assert.match(worker, /addTradeCoverage\(coveredRanges, trade\.firstTradeId, trade\.lastTradeId\)/);
  assert.doesNotMatch(worker, /return this\.trades\.some/);
  assert.doesNotMatch(worker, /this\.tradeRangeOverlaps/);

  const insertStart = worker.indexOf("  insertTrade(");
  const insertEnd = worker.indexOf("\n  queueTape(", insertStart);
  assert.ok(insertStart >= 0 && insertEnd > insertStart);
  const insertBlock = worker.slice(insertStart, insertEnd);
  assert.doesNotMatch(insertBlock, /mergeTradeCoverage|tradeCoverageOverlaps|addTradeCoverage|this\.trades\.some/);
});

test("resume coverage helpers merge and query trade ID intervals", () => {
  const helperStart = worker.indexOf("function mergeTradeCoverage");
  const helperEnd = worker.indexOf("async function fetchJson", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);

  const context = {};
  vm.runInNewContext(
    `${worker.slice(helperStart, helperEnd)}
globalThis.coverageApi = { mergeTradeCoverage, tradeCoverageOverlaps, addTradeCoverage };`,
    context,
  );

  const ranges = context.coverageApi.mergeTradeCoverage([
    { firstTradeId: 10, lastTradeId: 12 },
    { firstTradeId: 13, lastTradeId: 15 },
    { firstTradeId: 20, lastTradeId: 22 },
    { id: 999 },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(ranges)), [[10, 15], [20, 22]]);
  assert.equal(context.coverageApi.tradeCoverageOverlaps(ranges, 12, 14), true);
  assert.equal(context.coverageApi.tradeCoverageOverlaps(ranges, 16, 19), false);
  context.coverageApi.addTradeCoverage(ranges, 16, 21);
  assert.deepEqual(JSON.parse(JSON.stringify(ranges)), [[10, 22]]);
});

test("current generation replaces an obsolete bootstrap request", () => {
  assert.doesNotMatch(worker, /tradeBootstrapLoading/);
  assert.match(worker, /this\.tradeBootstrapRequest = 0/);
  assert.match(worker, /const requestId = \+\+this\.tradeBootstrapRequest/);
  assert.match(worker, /requestId !== this\.tradeBootstrapRequest/);
});

test("cache versions keep seamless resume while shipping Resume v2", () => {
  assert.match(orderbook, /orderbook-worker\.js\?v=worker-bp-v1/);
  assert.match(serviceWorker, /inpuls-26-30-render-scheduler-v1/);
  assert.match(serviceWorker, /orderbook\.js\?v=render-scheduler-v1/);
  assert.match(serviceWorker, /render-scheduler\.js\?v=render-scheduler-v1/);
  assert.match(serviceWorker, /orderbook-worker\.js\?v=worker-bp-v1/);
  assert.match(serviceWorker, /orderbook-flow-workspace\.js\?v=render-scheduler-v1/);
  assert.doesNotMatch(serviceWorker, /v26-22-background-restart/);
});
