import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Arrival-time rendering must not overwrite the original execution timestamp.
import { normalizeFlowTrade } from "./orderbook-flow-workspace.js?v=26-122-configurable-market-headers-v1";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("footprint live interval uses explicit arrival time", () => {
  const trade = normalizeFlowTrade({
    id: 1,
    price: 42,
    quantity: 2,
    quote: 84,
    time: 1_000,
    tradeTime: 1_000,
    displayTime: 11_000,
    side: "buy",
  });
  assert.equal(trade.time, 11_000);
});

test("Tape aligns local receipt with the main Binance clock", () => {
  const worker = read("./orderbook-worker.js");
  const tape = read("./orderbook.js");
  assert.match(worker, /receivedAt: timing\.receivedAt/);
  assert.match(tape, /tapeDisplayTimeFromReceipt\(receivedAt, time\)/);
  assert.doesNotMatch(tape, /const suppliedDisplayTime = Number\(trade\?\.displayTime\)/);
});

test("footprint column shows total quote above its time", () => {
  const source = read("./orderbook-flow-workspace.js");
  assert.match(source, /formatQuoteVolume\(interval\.quote\)/);
  assert.match(source, /height - 28/);
  assert.match(source, /height - 19/);
  assert.match(source, /height - 6/);
});
