import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("../orderbook.js", import.meta.url), "utf8");
const footprint = await readFile(new URL("../orderbook-flow-workspace.js", import.meta.url), "utf8");
const worker = await readFile(new URL("../orderbook-worker.js", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../sw.js", import.meta.url), "utf8");

test("all orderbook panels share one latest-only frame scheduler", () => {
  assert.match(app, /new LatestFrameScheduler\(\{/);
  assert.match(app, /budgetMs: 8/);
  assert.match(app, /maxPerFrame: 2/);
  assert.match(app, /onData\(data\) \{\s+panel\.latest = data;\s+scheduleOrderBookRender\(panel\);/);
  assert.doesNotMatch(app, /panel\.frame = requestAnimationFrame/);
  assert.match(app, /orderBookRenderScheduler\.remove\(panel\)/);
  assert.match(app, /orderbook\.scheduler-coalesced/);
  assert.match(app, /orderbook\.scheduler-yield/);
  assert.match(app, /patchBookLadderRows\(body, rows, middle, maxSize, anomaly, panel\.baseTick\)/);
  assert.doesNotMatch(app, /body\.innerHTML = rows\.map/);
});

test("canvas runtime disables the hidden legacy DOM footprint", () => {
  assert.match(runtime, /flow\.dataset\.inpulsTapeRenderer = "canvas"/);
  assert.match(app, /flow\.dataset\.inpulsTapeRenderer !== "canvas"/);
  assert.match(app, /orderbook\.legacy-flow-skipped/);
});

test("Tape draw work yields across animation frames without dropping dirty cards", () => {
  assert.match(runtime, /const TAPE_DRAW_BUDGET_MS = 8/);
  assert.match(runtime, /const TAPE_DRAW_MAX_CARDS = 2/);
  assert.match(runtime, /dirtyTapeCards\.delete\(card\)/);
  assert.match(runtime, /tapeNeedsDraw = dirtyTapeCards\.size > 0/);
  assert.match(runtime, /requestAnimationFrame\(runTapeDrawFrame\)/);
  assert.doesNotMatch(runtime, /dirtyTapeCards\.clear\(\)/);
});

test("Tape ingestion shares each frame between active symbols", () => {
  assert.match(runtime, /const liveShare = Math\.max\(1, Math\.floor\(budget \/ Math\.max\(1, pendingEntries\.length\)\)\)/);
  assert.match(runtime, /Math\.min\(budget, liveShare, pending\.trades\.length\)/);
  assert.match(runtime, /tapeRecentRateBySymbol\.set\(symbol/);
  assert.match(runtime, /tape\.ingest-frame/);
});

test("footprint renders only dirty cards under the same frame budget", () => {
  assert.match(footprint, /const FLOW_DRAW_BUDGET_MS = 8/);
  assert.match(footprint, /const FLOW_DRAW_MAX_CARDS = 2/);
  assert.match(footprint, /dirtyCards\.delete\(card\)/);
  assert.match(footprint, /if \(cardSymbol\(card\) !== symbol\) return;/);
  assert.match(footprint, /ingestFootprintTrades\(/);
  assert.match(footprint, /footprintIntervalSnapshot\(/);
  assert.match(footprint, /footprint\.scheduler-yield/);
  assert.doesNotMatch(
    footprint,
    /document\.querySelectorAll\("\.orderbook-card"\)\.forEach\(\(card\) => \{\s+cardCount \+= 1;/,
  );
});

test("render optimization leaves strict depth sequencing untouched", () => {
  const applyStart = worker.indexOf("  applyDepth(");
  const applyEnd = worker.indexOf("\n  bufferDepth(", applyStart);
  const applyBlock = worker.slice(applyStart, applyEnd);
  assert.match(applyBlock, /sequenceDecision\(this\.lastUpdateId, event, first\)/);
  assert.match(applyBlock, /this\.lastUpdateId = Number\(event\.u\)/);
  assert.doesNotMatch(applyBlock, /LatestFrameScheduler|TAPE_DRAW_BUDGET/);
  assert.match(serviceWorker, /render-scheduler\.js/);
  assert.match(serviceWorker, /orderbook-flow-workspace\.js\?v=26-45-orderbook-auto-cluster-theme-v1/);
});
