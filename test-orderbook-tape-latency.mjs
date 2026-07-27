import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./orderbook-tape-latency.js";

const worker = readFileSync(new URL("./orderbook-worker.js", import.meta.url), "utf8");
const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const { normalizeTiming, RollingLatency } = globalThis.InPulsTapeLatency;

test("latency helper keeps exchange and browser timestamps separate", () => {
  const timing = normalizeTiming({ T: 1_000, E: 1_010 }, 1_040, 0);
  assert.deepEqual(timing, {
    tradeTime: 1_000,
    eventTime: 1_010,
    receivedAt: 1_040,
    rxLatencyMs: 30,
  });
});

test("REST timing stays without a fake receive timestamp", () => {
  assert.equal(normalizeTiming({ T: 1_000, E: 1_000 }).receivedAt, null);
  assert.equal(normalizeTiming({ T: 1_000, E: 1_000 }).rxLatencyMs, null);
});

test("latency helper rejects clock outliers", () => {
  assert.equal(normalizeTiming({ T: 1_000, E: 2_000 }, 1_000, 0).rxLatencyMs, null);
  assert.equal(normalizeTiming({ T: 1_000, E: 1_000 }, 12_000, 0).rxLatencyMs, null);
});

test("RX display is a rolling short-window median", () => {
  const metric = new RollingLatency({ windowMs: 2_000, updateMs: 1, maxSamples: 20 });
  [10, 20, 500, 30, 40].forEach((value, index) => metric.record(value, 1_000 + index * 60));
  assert.equal(metric.current(), 30);
  metric.record(50, 4_000);
  assert.equal(metric.current(), 50);
  assert.equal(
    readFileSync(new URL("./orderbook-tape-latency.js", import.meta.url), "utf8")
      .includes("samples.shift()"),
    false,
  );
});

test("worker records receive time and exposes RX in live status", () => {
  assert.match(worker, /importScripts\("\.\/orderbook-tape-latency\.js\?v=worker-bp-v1"\)/);
  assert.match(worker, /new self\.InPulsTapeLatency\.RollingLatency/);
  assert.match(worker, /normalizeTrade\(update, "agg", receivedAt\)/);
  assert.match(worker, /this\.tradeLatency\.record\(trade\.rxLatencyMs, receivedAt\)/);
  assert.match(worker, /RX \$\{Math\.round\(latency\)\}ms/);
});

test("UI preserves timing fields for future hover and replay", () => {
  assert.match(orderbook, /tradeTime: Number\.isFinite\(tradeTime\) \? tradeTime : time/);
  assert.match(orderbook, /eventTime: Number\.isFinite\(eventTime\) \? eventTime : time/);
  assert.match(orderbook, /receivedAt: Number\.isFinite\(receivedAt\) \? receivedAt : null/);
  assert.match(orderbook, /rxLatencyMs: Number\.isFinite\(rxLatencyMs\) \? rxLatencyMs : null/);
});
