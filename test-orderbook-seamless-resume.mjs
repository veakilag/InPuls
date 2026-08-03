import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("every resume starts a clean live-only Tape without REST history", () => {
  const resumeStart = worker.indexOf("  resume(");
  const resumeEnd = worker.indexOf("\n  restartAfterBackground(", resumeStart);
  const resumeBlock = worker.slice(resumeStart, resumeEnd);
  const restartStart = resumeEnd;
  const restartEnd = worker.indexOf("\n  resetFlowWindow(", restartStart);
  const restartBlock = worker.slice(restartStart, restartEnd);
  const startStart = worker.indexOf("  start() {");
  const startEnd = worker.indexOf("\n  stopSockets(", startStart);
  const startBlock = worker.slice(startStart, startEnd);

  for (const block of [startBlock, resumeBlock, restartBlock]) {
    assert.match(block, /replace: true,[\s\S]*liveOnly: true,[\s\S]*trades: \[\]/);
  }
  assert.doesNotMatch(worker, /\/fapi\/v1\/aggTrades/);
  assert.doesNotMatch(resumeBlock, /loadRecentTrades/);
  assert.doesNotMatch(worker, /indexedDB|TradeStore|cached-trades|bootstrap-trades/);
});

test("cache versions keep seamless resume while shipping Resume v2", () => {
  assert.match(orderbook, /orderbook-worker\.js\?v=26-101-binance-clock-sync-v1/);
  assert.match(serviceWorker, /inpuls-26-91-runtime-boot-cache-feed-v1/);
  assert.match(serviceWorker, /orderbook\.js\?v=26-104-tape-cluster-theme-clock-sync-v2/);
  assert.match(serviceWorker, /render-scheduler\.js\?v=render-scheduler-v1/);
  assert.match(serviceWorker, /orderbook-worker\.js\?v=26-101-binance-clock-sync-v1/);
  assert.match(serviceWorker, /orderbook-flow-workspace\.js\?v=26-104-tape-cluster-theme-clock-sync-v2/);
  assert.doesNotMatch(serviceWorker, /v26-22-background-restart/);
});
