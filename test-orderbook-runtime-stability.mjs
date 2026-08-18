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

test("normal reload keeps one consistent runtime build", () => {
  assert.match(index, /app\.js\?v=26-126-final-exchanges-v1/);
  assert.match(app, /orderbook\.js\?v=26-126-final-exchanges-v1/);
  assert.match(app, /render-scheduler\.js\?v=render-scheduler-v1/);
  assert.match(orderbook, /orderbook-flow-workspace\.js\?v=26-126-final-exchanges-v1/);
  assert.match(orderbook, /orderbook-worker\.js\?v=26-126-final-exchanges-v1/);
  assert.match(sw, /app\.js\?v=26-126-final-exchanges-v1/);
  assert.match(sw, /orderbook\.js\?v=26-126-final-exchanges-v1/);
  assert.match(sw, /orderbook-flow-workspace\.js\?v=26-126-final-exchanges-v1/);
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
