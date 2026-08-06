import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./orderbook-tape-latency.js";

const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("./orderbook-worker.js", import.meta.url), "utf8");
const flow = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
const reset = readFileSync(new URL("./reset-v26.html", import.meta.url), "utf8");

test("normal reload keeps one consistent runtime build", () => {
  assert.match(index, /app\.js\?v=26-117-chart-interaction-performance-v1/);
  assert.match(app, /orderbook\.js\?v=26-117-chart-interaction-performance-v1/);
  assert.match(app, /render-scheduler\.js\?v=render-scheduler-v1/);
  assert.match(orderbook, /orderbook-flow-workspace\.js\?v=26-117-chart-interaction-performance-v1/);
  assert.match(orderbook, /orderbook-worker\.js\?v=26-117-chart-interaction-performance-v1/);
  assert.match(sw, /app\.js\?v=26-117-chart-interaction-performance-v1/);
  assert.match(sw, /orderbook\.js\?v=26-117-chart-interaction-performance-v1/);
  assert.match(sw, /orderbook-flow-workspace\.js\?v=26-117-chart-interaction-performance-v1/);
  assert.match(reset, /Resume v2/);
  assert.doesNotMatch(app, /getRegistrations\(\).*unregister/s);
});

test("worker-unavailable fallback does not leave a health interval open", () => {
  assert.match(
    orderbook,
    /#startHealthWatch\(\) \{\s+if \(this\.failed \|\| this\.healthTimer \|\| typeof setInterval !== "function"\) return;/,
  );
});

test("hidden tabs close sockets instead of accumulating a stale queue", () => {
  assert.match(worker, /pauseForBackground\(\)/);
  assert.match(worker, /feed\.pauseForBackground\(\)/);
  assert.match(worker, /this\.generation \+= 1;[\s\S]*this\.stopSockets\(\)/);
  assert.match(worker, /restartAfterBackground\(true\)/);
});

test("workspace order is footprint then Tape then book", () => {
  assert.match(flow, /grid-template-areas: "clusters split-a tape split-b book"/);
  assert.match(flow, /data-footprint-select/);
  assert.match(flow, /data-footprint-favorite/);
  assert.doesNotMatch(flow, /<span>Δ<\/span>/);
});

test("Tape and footprint visibility controls stay independent", () => {
  assert.match(orderbook, /data-inpuls-tape-visible/);
  assert.match(orderbook, /data-inpuls-clusters-visible/);
  assert.match(orderbook, /clustersVisible: localStorage\.getItem\(CLUSTERS_VISIBLE_KEY\) !== "0"/);
  assert.match(orderbook, /is-tape-hidden/);
  assert.match(orderbook, /is-clusters-hidden/);
});

test("RX uses calibrated Binance server time", () => {
  const timing = globalThis.InPulsTapeLatency.normalizeTiming(
    { T: 1_000, E: 1_000 },
    1_400,
    -350,
  );
  assert.equal(timing.rxLatencyMs, 50);
  assert.match(worker, /syncServerClock/);
  assert.match(worker, /normalizeTiming\(event, receivedAt, serverClockOffsetMs\)/);
});

test("multi-book worker prioritizes UI without truncating local depth", () => {
  assert.match(orderbook, /type: "priority"/);
  assert.match(worker, /prioritySymbols/);
  assert.match(worker, /emitIntervalMs\(\)/);
  assert.match(
    worker,
    /bookStorageLimit\(\) \{[\s\S]*return MAX_BOOK_LEVELS_PER_SIDE;/,
  );
  assert.doesNotMatch(worker, /MULTI_BOOK_LEVEL_LIMIT/);
  assert.match(
    worker,
    /trimSide\(this\.bids, "bid", limit\);[\s\S]*trimSide\(this\.asks, "ask", limit\);/,
  );
});
