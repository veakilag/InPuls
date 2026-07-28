import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

await import("../orderbook-events.js?orderbook-events-tests");

const {
  DepthEventJournal,
  applyDepthDiff,
  classifyDepthChange,
  seedDepthSnapshot,
} = globalThis.InPulsOrderBookEvents;

test("depth changes map to the four normalized lifecycle event types", () => {
  assert.equal(classifyDepthChange(0, 2), "appeared");
  assert.equal(classifyDepthChange(2, 5), "increased");
  assert.equal(classifyDepthChange(5, 1), "decreased");
  assert.equal(classifyDepthChange(1, 0), "removed");
  assert.equal(classifyDepthChange(2, 2), null);
});

test("snapshot seeds the book as a baseline without fabricating appeared events", () => {
  const bids = new Map([[90, 1]]);
  const asks = new Map([[110, 1]]);
  const journal = new DepthEventJournal({ capacity: 8 });
  journal.reset("start", 1_000);
  const baseline = journal.seedSnapshot({
    bids,
    asks,
    snapshot: {
      lastUpdateId: 100,
      bids: [["99", "2"], ["98", "3"]],
      asks: [["101", "4"], ["102", "5"]],
    },
    receivedAt: 1_010,
  });

  assert.deepEqual(baseline, { snapshotId: 100, bids: 2, asks: 2 });
  assert.deepEqual([...bids], [[99, 2], [98, 3]]);
  assert.deepEqual([...asks], [[101, 4], [102, 5]]);
  assert.deepEqual(journal.recent(), []);
  assert.equal(journal.summary().epochEvents, 0);
  assert.equal(journal.summary().state, "recovering");
});

test("a continuous diff emits normalized bid and ask events before updating the book", () => {
  const bids = new Map([[99, 2], [98, 3]]);
  const asks = new Map([[101, 4], [102, 5]]);
  const events = applyDepthDiff({
    bids,
    asks,
    bookEpoch: 7,
    continuity: "live",
    receivedAt: 2_050,
    symbol: "btcusdt",
    event: {
      E: 2_000,
      T: 2_010,
      U: 101,
      u: 101,
      pu: 100,
      b: [["99", "5"], ["98", "1"], ["97", "6"]],
      a: [["101", "0"], ["103", "7"], ["102", "5"]],
    },
  });

  assert.deepEqual(
    events.map(({ type, side, price, previousQuantity, quantity, deltaQuantity }) => ({
      type,
      side,
      price,
      previousQuantity,
      quantity,
      deltaQuantity,
    })),
    [
      { type: "increased", side: "bid", price: 99, previousQuantity: 2, quantity: 5, deltaQuantity: 3 },
      { type: "decreased", side: "bid", price: 98, previousQuantity: 3, quantity: 1, deltaQuantity: -2 },
      { type: "appeared", side: "bid", price: 97, previousQuantity: 0, quantity: 6, deltaQuantity: 6 },
      { type: "removed", side: "ask", price: 101, previousQuantity: 4, quantity: 0, deltaQuantity: -4 },
      { type: "appeared", side: "ask", price: 103, previousQuantity: 0, quantity: 7, deltaQuantity: 7 },
    ],
  );
  assert.deepEqual([...bids], [[99, 5], [98, 1], [97, 6]]);
  assert.deepEqual([...asks], [[102, 5], [103, 7]]);
  assert.equal(events[0].eventTime, 2_000);
  assert.equal(events[0].transactionTime, 2_010);
  assert.equal(events[0].receivedAt, 2_050);
  assert.equal(events[0].firstUpdateId, 101);
  assert.equal(events[0].finalUpdateId, 101);
  assert.equal(events[0].previousFinalUpdateId, 100);
  assert.equal(events[0].bookEpoch, 7);
  assert.equal(events[0].source, "depth-diff");
  assert.equal(events[0].symbol, "BTCUSDT");
  assert.equal(events[0].venue, "binance-usdm");
  assert.equal(events[0].previousQuote, 198);
  assert.equal(events[0].quote, 495);
  assert.equal(events[0].deltaQuote, 297);
});

test("missing zero levels, unchanged quantities and invalid rows stay silent", () => {
  const bids = new Map([[99, 2]]);
  const asks = new Map([[101, 4]]);
  const events = applyDepthDiff({
    bids,
    asks,
    event: {
      E: 3_000,
      U: 102,
      u: 102,
      pu: 101,
      b: [["99", "2"], ["97", "0"], ["bad", "1"], ["96", "-1"]],
      a: [["101", "4"]],
    },
  });
  assert.deepEqual(events, []);
  assert.deepEqual([...bids], [[99, 2]]);
  assert.deepEqual([...asks], [[101, 4]]);
});

test("journal marks bridge events as recovered and live events as live", () => {
  const bids = new Map();
  const asks = new Map();
  const journal = new DepthEventJournal({ capacity: 8 });
  journal.reset("resync", 4_000);
  journal.seedSnapshot({
    bids,
    asks,
    snapshot: { lastUpdateId: 200, bids: [["99", "2"]], asks: [["101", "4"]] },
    receivedAt: 4_010,
  });

  const recovered = journal.applyDiff({
    bids,
    asks,
    event: { E: 4_020, U: 201, u: 201, pu: 200, b: [["99", "3"]], a: [] },
    receivedAt: 4_025,
  });
  journal.markReady({ at: 4_030 });
  const live = journal.applyDiff({
    bids,
    asks,
    event: { E: 4_040, U: 202, u: 202, pu: 201, b: [], a: [["101", "2"]] },
    receivedAt: 4_045,
  });

  assert.equal(recovered[0].continuity, "recovered");
  assert.equal(live[0].continuity, "live");
  assert.equal(recovered[0].bookEpoch, live[0].bookEpoch);
  assert.equal(journal.summary().state, "live");
  assert.equal(journal.summary().snapshotId, 200);
  assert.equal(journal.summary().lastUpdateId, 202);
  assert.deepEqual(journal.summary().epochCounts, {
    appeared: 0,
    increased: 1,
    decreased: 1,
    removed: 0,
  });
});

test("gap reset opens a new epoch and cannot leak old lifecycle events", () => {
  const bids = new Map();
  const asks = new Map();
  const journal = new DepthEventJournal({ capacity: 2 });
  const firstEpoch = journal.reset("start", 5_000);
  journal.seedSnapshot({
    bids,
    asks,
    snapshot: { lastUpdateId: 300, bids: [["99", "1"]], asks: [["101", "1"]] },
  });
  journal.applyDiff({
    bids,
    asks,
    event: { E: 5_010, U: 301, u: 301, pu: 300, b: [["99", "2"]], a: [] },
  });

  const secondEpoch = journal.reset("sequence-gap", 5_020);
  assert.equal(secondEpoch, firstEpoch + 1);
  assert.deepEqual(journal.recent(), []);
  assert.equal(journal.summary().epochEvents, 0);
  assert.equal(journal.summary().totalEvents, 1);
  assert.equal(journal.summary().resetReason, "sequence-gap");
  assert.equal(journal.summary().state, "syncing");
});

test("journal history is bounded and keeps the newest normalized events", () => {
  const bids = new Map();
  const asks = new Map();
  const journal = new DepthEventJournal({ capacity: 2 });
  journal.reset("start");
  journal.seedSnapshot({
    bids,
    asks,
    snapshot: { lastUpdateId: 400, bids: [["99", "1"]], asks: [["101", "1"]] },
  });
  journal.markReady();
  journal.applyDiff({
    bids,
    asks,
    event: {
      E: 6_000,
      U: 401,
      u: 401,
      pu: 400,
      b: [["99", "2"], ["98", "1"]],
      a: [["101", "2"]],
    },
  });

  const recent = journal.recent();
  assert.equal(recent.length, 2);
  assert.deepEqual(recent.map((event) => event.price), [98, 101]);
  assert.equal(journal.summary().retainedEvents, 2);
  assert.equal(journal.summary().epochEvents, 3);
});

test("Worker and Legacy fallback share the event-first runtime contract", async () => {
  const [worker, runtime, serviceWorker] = await Promise.all([
    readFile(new URL("../orderbook-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../orderbook.js", import.meta.url), "utf8"),
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(worker, /importScripts\("\.\/orderbook-events\.js\?v=orderbook-events-core-v1"\)/);
  assert.match(runtime, /import "\.\/orderbook-events\.js\?v=orderbook-events-core-v1"/);
  assert.match(worker, /this\.bookEvents\.seedSnapshot\(/);
  assert.match(runtime, /this\.bookEvents\.seedSnapshot\(/);
  assert.match(worker, /this\.bookEvents\.applyDiff\(/);
  assert.match(runtime, /this\.bookEvents\.applyDiff\(/);
  assert.match(worker, /this\.resetBook\(text === "Переполнение буфера" \? "buffer-overflow" : "sequence-gap"\)/);
  assert.match(runtime, /this\.#resetBook\(text === "Переполнение буфера" \? "buffer-overflow" : "sequence-gap"\)/);
  assert.match(worker, /this\.bookEvents\.markUnavailable\("partial-depth"\)/);
  assert.match(runtime, /this\.bookEvents\.markUnavailable\("partial-depth"\)/);
  assert.match(worker, /orderBookEvents: this\.bookEvents\.summary\(\)/);
  assert.match(runtime, /orderBookEvents: this\.bookEvents\.summary\(\)/);
  assert.match(serviceWorker, /orderbook-events\.js\?v=orderbook-events-core-v1/);
});
