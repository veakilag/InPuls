import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { normalizeFlowTrade } from "./orderbook-flow-workspace.js?v=26-108-tape-arrival-clock-v1";

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

test("Worker publishes displayTime and Tape consumes it", () => {
  const worker = read("./orderbook-worker.js");
  const tape = read("./orderbook.js");
  assert.match(worker, /const displayTime = Number\.isFinite\(calibratedReceivedTime\)/);
  assert.match(worker, /displayTime,\n\s+tradeTime: timing\.tradeTime/);
  assert.match(tape, /const suppliedDisplayTime = Number\(trade\?\.displayTime\)/);
  assert.match(tape, /Math\.max\(time, suppliedDisplayTime\)/);
});

test("footprint column shows total quote above its time", () => {
  const source = read("./orderbook-flow-workspace.js");
  assert.match(source, /formatQuoteVolume\(interval\.quote\)/);
  assert.match(source, /height - 22/);
  assert.match(source, /height - 16/);
  assert.match(source, /height - 5/);
});
