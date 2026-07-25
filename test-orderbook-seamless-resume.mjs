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
  assert.match(worker, /this\.syncing = false;\n\s*this\.publishLiveStatus\(\)/);
  assert.match(worker, /syncing: this\.syncing/);
});

test("resume prioritizes the last selected symbol and staggers other feeds", () => {
  assert.match(orderbook, /#promoteSymbol\(symbol\)/);
  assert.match(orderbook, /prioritySymbols: visible \? this\.#orderedSymbols\(\) : \[\]/);
  assert.match(worker, /priorityRank = new Map/);
  assert.match(worker, /active\.forEach\(\(feed, index\) => feed\.resume\(index \* RESUME_STAGGER_MS, epoch\)\)/);
});

test("resume backfills recent trades without replacing the visible tape", () => {
  assert.match(worker, /loadRecentTrades\(this\.generation, \{ resume: true \}\)/);
  assert.match(worker, /loadRecentTrades\(generation, \{ resume: true \}\)/);
  assert.match(worker, /async loadRecentTrades\(generation, \{ resume = false \} = \{\}\)/);
  assert.match(worker, /replace: !resume/);
  assert.match(worker, /resume,\n\s*trades,/);
});

test("resume backfill rejects raw and aggregate range overlap", () => {
  assert.match(worker, /tradeRangeOverlaps\(firstTradeId, lastTradeId\)/);
  const reject = "if (hasRawRange && this.tradeRangeOverlaps(firstTradeId, lastTradeId)) return false;";
  const advance = "if (hasRawRange) this.tapeGuard.advanceBoundary(lastTradeId);";
  assert.ok(worker.includes(reject));
  assert.ok(worker.includes(advance));
  assert.ok(worker.indexOf(reject) < worker.indexOf(advance));
});

test("current generation replaces an obsolete bootstrap request", () => {
  assert.doesNotMatch(worker, /tradeBootstrapLoading/);
  assert.match(worker, /this\.tradeBootstrapRequest = 0/);
  assert.match(worker, /const requestId = \+\+this\.tradeBootstrapRequest/);
  assert.match(worker, /requestId !== this\.tradeBootstrapRequest/);
});

test("cache versions force the seamless resume runtime to production", () => {
  assert.match(orderbook, /orderbook-worker\.js\?v=26-23-seamless-resume/);
  assert.match(serviceWorker, /inpuls-v26-23-seamless-resume/);
  assert.match(serviceWorker, /orderbook\.js\?v=26-23-seamless-resume/);
  assert.match(serviceWorker, /orderbook-worker\.js\?v=26-23-seamless-resume/);
  assert.doesNotMatch(serviceWorker, /v26-22-background-restart/);
});
