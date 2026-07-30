import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bookPriceEmphasisForUnit,
  bookPsychologicalPriceUnit,
  buildDepthLadder,
  tapeAggregationTickFromBook,
} from "./orderbook.js";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("ladder emphasis is round-only and independent from compression", () => {
  const market = .01417;
  const unit = bookPsychologicalPriceUnit(market);
  const fine = buildDepthLadder([], [], market, market, .000005, 121);
  const compressed = buildDepthLadder([], [], market, market, .00005, 121);

  assert.equal(fine.some((row) => row.isHalfRound), false);
  assert.equal(compressed.some((row) => row.isHalfRound), false);
  for (const row of [...fine, ...compressed]) {
    assert.equal(row.isRound, bookPriceEmphasisForUnit(row.price, unit).round);
  }
  assert.doesNotMatch(app, /source\.isHalfRound|is-price-half/);
  assert.doesNotMatch(orderbook, /\.book-ladder-row\.is-price-half/);
});

test("AGG price grid comes from the exchange book instead of the visible ladder step", () => {
  const book = {
    bids: [[.01416, 10], [.01415, 10], [.01414, 10]],
    asks: [[.01417, 10], [.01418, 10], [.01419, 10]],
  };
  assert.equal(tapeAggregationTickFromBook(book, .0005), .00001);
  assert.match(orderbook, /stableTapeAggregationTick\([\s\S]*latestBookDataBySymbol\.get\(symbol\)/);
  assert.match(orderbook, /refreshTapeRenderModel\(state, symbol, stored, aggregationTick\)/);
  assert.doesNotMatch(orderbook, /refreshTapeRenderModel\(state, symbol, stored, step\)/);
});

test("AGG markers are exposed only as sealed immutable snapshots", () => {
  assert.match(orderbook, /snapshot = Object\.freeze\(\{[\s\S]*status: "sealed"/);
  assert.match(orderbook, /const aggregateClosedBefore = Math\.min\(/);
  assert.match(orderbook, /state\.aggSnapshots\.get\(bucket\.key\)/);
  assert.match(orderbook, /if \(snapshot\) output\.push\(snapshot\)/);
});
