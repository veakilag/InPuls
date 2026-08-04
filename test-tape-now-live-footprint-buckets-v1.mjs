import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  aggregateFootprintCellsByStep,
} from "./orderbook-flow-workspace.js";
import { tapeSecondsForScale } from "./orderbook.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("footprint aggregates exact prices by the current ladder step", () => {
  const result = aggregateFootprintCellsByStep([
    { price: 100.01, buyQuote: 120, sellQuote: 0, quote: 120, count: 1 },
    { price: 100.04, buyQuote: 0, sellQuote: 80, quote: 80, count: 1 },
    { price: 100.11, buyQuote: 50, sellQuote: 0, quote: 50, count: 1 },
  ], .1);
  assert.equal(result.length, 2);
  const first = result.find((item) => item.price === 100);
  assert.equal(first.quote, 200);
  assert.equal(first.buyQuote, 120);
  assert.equal(first.sellQuote, 80);
});

test("Tape never exposes more than two minutes", () => {
  assert.equal(tapeSecondsForScale(4_000, 300), 120);
});

test("Tape ships a right-side NOW line and a precise slider", () => {
  const source = read("./orderbook.js");
  assert.match(source, /NOW · LIVE/);
  assert.match(source, /TAPE_RETENTION_MS = 2 \* 60_000/);
  assert.match(source, /data-inpuls-tape-time-scale[^>]+step="1"/);
  assert.doesNotMatch(source, /data-inpuls-tape-time-scale-value/);
  assert.match(source, /width: 118px/);
});

test("Tape display time includes bounded receive latency", () => {
  const source = read("./orderbook.js");
  assert.match(source, /const displayTime = time \+ latency/);
  assert.match(source, /tradeTime: Number\.isFinite\(tradeTime\)/);
});
