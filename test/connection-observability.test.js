import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../orderbook-worker.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("../orderbook.js", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../sw.js", import.meta.url), "utf8");

test("Worker REST startup uses staggered cancellable host fallback", () => {
  assert.match(worker, /importScripts\("\.\/orderbook-network\.js\?v=obs-pr1-1"\)/);
  assert.match(worker, /InPulsOrderBookNetwork\.firstSuccessful/);
  assert.doesNotMatch(worker, /Promise\.any/);
  assert.match(worker, /depth\.snapshot\.host/);
  assert.doesNotMatch(worker, /tape\.bootstrap\.host|\/fapi\/v1\/aggTrades/);
  assert.match(worker, /network-or-cors|errorKind/);
});

test("connection lifecycle identifies WebSocket, snapshot, retry and LIVE phases", () => {
  for (const phase of [
    "feed.start",
    "depth.ws.create",
    "depth.ws.open",
    "depth.ws.first-message",
    "depth.ws.retry",
    "depth.snapshot",
    "depth.fallback",
    "depth.live",
    "tape.ws.create",
    "tape.ws.open",
    "tape.ws.first-message",
    "tape.ws.retry",
    "worker.flow",
    "depth.freshness",
    "tape.freshness",
  ]) {
    assert.match(worker, new RegExp(phase.replaceAll(".", "\\.")));
  }
});

test("cross-context timing uses epoch timestamps and source kind", () => {
  assert.match(worker, /sentAtEpochMs: Date\.now\(\)/);
  assert.match(worker, /sourceClockOffsetMs/);
  assert.match(worker, /sourceEventTimeMs/);
  assert.match(worker, /sourceKind: this\.lastDepthEventTime \? "live-depth" : "snapshot-depth"/);
  assert.match(worker, /sourceKind: "live-trade"/);
  assert.doesNotMatch(worker, /sentAt: performance\.now\(\)/);
});

test("main-thread render diagnostics cover computation, ladder DOM and skipped TAPE", () => {
  assert.match(app, /app\.render\.metrics/);
  assert.match(app, /app\.render\.rows/);
  assert.match(app, /app\.render\.dom/);
  assert.match(app, /orderbook\.compute/);
  assert.match(app, /orderbook\.ladder-dom/);
  assert.match(app, /observability\.rendered\(symbol, "ladder"\)/);
  assert.match(runtime, /observability\.skipRender\("tape"/);
  assert.match(runtime, /tape\.draw-all/);
});

test("new diagnostic runtime files are in the Service Worker release", () => {
  assert.match(serviceWorker, /orderbook-network\.js\?v=obs-pr1-1/);
  assert.match(serviceWorker, /observability\.js\?v=render-scheduler-v1/);
  assert.match(serviceWorker, /orderbook-worker-buffers\.js\?v=worker-bp-v1/);
  assert.match(serviceWorker, /render-scheduler\.js\?v=render-scheduler-v1/);
  assert.match(serviceWorker, /inpuls-26-72-water-tape-fast-v1/);
});
