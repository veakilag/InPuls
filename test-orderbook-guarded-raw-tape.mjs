import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

await import("./orderbook-tape-guard.js");
const TapeGuard = globalThis.InPulsTapeGuard;

function raw(id, time = 1_000 + id) {
  return {
    source: "raw",
    id,
    firstTradeId: id,
    lastTradeId: id,
    price: 100,
    quantity: 1,
    time,
  };
}

function agg(firstTradeId, lastTradeId, time = 2_000 + lastTradeId) {
  return {
    source: "agg",
    id: lastTradeId,
    firstTradeId,
    lastTradeId,
    price: 100,
    quantity: lastTradeId - firstTradeId + 1,
    time,
  };
}

test("starts on aggregate live and promotes raw only inside the shadow guard", () => {
  const guard = new TapeGuard({ rawWarmupTrades: 3, rawStaleMs: 1_500 });
  guard.connect();

  assert.equal(guard.ingest(agg(1, 1), 10).emit, true);
  assert.equal(guard.label(), "AGG LIVE");
  assert.equal(guard.ingest(raw(2), 20).emit, false);
  assert.equal(guard.ingest(raw(3), 30).emit, false);
  const promoted = guard.ingest(raw(4), 40);
  assert.equal(promoted.emit, true);
  assert.equal(promoted.mode, "raw");
  assert.equal(guard.label(), "RAW SHADOW");
});

test("raw sequence gap immediately falls back without emitting the broken trade", () => {
  const guard = new TapeGuard({ rawWarmupTrades: 2 });
  guard.connect();
  guard.ingest(agg(10, 10), 10);
  guard.ingest(raw(11), 20);
  assert.equal(guard.ingest(raw(12), 30).emit, true);
  const gap = guard.ingest(raw(15), 40);
  assert.equal(gap.emit, false);
  assert.equal(gap.mode, "agg");
  assert.equal(guard.snapshot(40).rawGapCount, 2);
  assert.equal(guard.label(), "AGG LIVE");
});

test("aggregate fallback waits for a fully new range to avoid double volume", () => {
  const guard = new TapeGuard({ rawWarmupTrades: 2, rawStaleMs: 100 });
  guard.connect();
  guard.ingest(agg(20, 20), 10);
  guard.ingest(raw(21), 20);
  assert.equal(guard.ingest(raw(22), 30).emit, true);
  assert.equal(guard.label(), "RAW SHADOW");

  const overlap = guard.ingest(agg(22, 23), 400);
  assert.equal(overlap.emit, false);
  assert.equal(overlap.mode, "agg");
  assert.equal(guard.snapshot(400).overlapSkips, 1);

  const clean = guard.ingest(agg(24, 25), 410);
  assert.equal(clean.emit, true);
  assert.equal(clean.reason, "agg-live");
});

test("recovery to raw requires consecutive IDs beyond the aggregate boundary", () => {
  const guard = new TapeGuard({ rawWarmupTrades: 3 });
  guard.connect();
  guard.ingest(agg(100, 102), 10);

  assert.equal(guard.ingest(raw(101), 20).emit, false);
  assert.equal(guard.ingest(raw(102), 30).emit, false);
  assert.equal(guard.ingest(raw(103), 40).emit, true);
  assert.equal(guard.label(), "RAW SHADOW");
});

test("invalid, duplicate and out-of-order events never reach the tape", () => {
  const guard = new TapeGuard({ rawWarmupTrades: 2 });
  guard.connect();
  assert.equal(guard.ingest({ ...raw(1), price: 0 }, 1).emit, false);
  guard.ingest(agg(1, 1), 2);
  guard.ingest(raw(2), 3);
  guard.ingest(raw(3), 4);
  assert.equal(guard.ingest(raw(3), 5).emit, false);
  assert.equal(guard.ingest(raw(2), 6).emit, false);
  const snapshot = guard.snapshot(6);
  assert.equal(snapshot.invalidCount, 1);
  assert.equal(snapshot.duplicateSkips, 1);
  assert.equal(snapshot.rawOutOfOrderCount, 1);
});

test("production worker keeps visual RAW stable and routes guarded raw trades only to AGG", (context) => {
  const workerUrl = new URL("./orderbook-worker.js", import.meta.url);
  if (!existsSync(workerUrl)) { context.skip("worker is added by the branch transformer"); return; }
  const worker = readFileSync(workerUrl, "utf8");
  const guard = readFileSync(new URL("./orderbook-tape-guard.js", import.meta.url), "utf8");
  assert.match(worker, /importScripts\("\.\/orderbook-tape-guard\.js\?v=worker-bp-v1"\);/);
  assert.match(worker, /return \[`\$\{name\}@aggTrade`, `\$\{name\}@trade`\];/);
  assert.match(worker, /if \(aggregateEvent && this\.insertTrade\(trade, true\)\)/);
  assert.match(worker, /if \(decision\.emit && this\.insertAggregationTrade\(trade, true\)\)/);
  assert.match(worker, /aggregationSource: guard\.mode/);
  assert.match(worker, /\/market\/stream\?streams=/);
  assert.match(worker, /new self\.InPulsTapeGuard/);
  assert.match(worker, /decision = this\.tapeGuard\.ingest/);
  assert.match(guard, /RAW SHADOW/);
  assert.match(guard, /AGG LIVE/);
  assert.match(worker, /tapeGuard\.label\(\)/);
  const insertStart = worker.indexOf("  insertTrade(trade");
  const insertEnd = worker.indexOf("\n  insertAggregationTrade", insertStart);
  const primaryInsert = worker.slice(insertStart, insertEnd);
  assert.doesNotMatch(primaryInsert, /tapeGuard\.advanceBoundary/);
});
