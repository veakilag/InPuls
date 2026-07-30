import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  advanceTapeCameraEnd,
  aggregateTapeBuckets,
  bookPriceEmphasis,
  bookPriceEmphasisForUnit,
  bookPsychologicalPriceUnit,
  resolveTapeWindowEnd,
  stableTapeQuoteStrength,
} from "./orderbook.js";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const footprint = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
const chart = readFileSync(new URL("./chart.js", import.meta.url), "utf8");

test("psychological levels keep one anchored unit per symbol", () => {
  assert.equal(bookPsychologicalPriceUnit(.093), .001);
  assert.deepEqual(bookPriceEmphasis(.093, .093), { round: true, half: false, majorUnit: .001 });
  assert.deepEqual(bookPriceEmphasisForUnit(.0925, .001), { round: false, half: true, majorUnit: .001 });
  assert.match(orderbook, /function stableBookPsychologicalUnit\(card, referencePrice\)/);
  assert.match(orderbook, /bookPriceEmphasisForUnit\(price, majorUnit\)/);
});

test("Tape camera eases only toward the latest real-trade target", () => {
  assert.equal(resolveTapeWindowEnd(10_000, false, 20_000), 10_180);
  assert.equal(resolveTapeWindowEnd(10_000, true, 20_000), 10_001);
  assert.equal(advanceTapeCameraEnd(null, 11_000, 16), 11_000);
  assert.ok(Math.abs(advanceTapeCameraEnd(10_000, 11_000, 16, 4) - 10_064) < 1e-9);
  assert.equal(advanceTapeCameraEnd(10_980, 11_000, 16, 4), 11_000);
  assert.doesNotMatch(orderbook, /snapTapeWindowEnd|tapeWindowPixelQuantum/);
  assert.match(orderbook, /function scheduleAnimatedTapeFrame\(\)/);
  assert.match(orderbook, /const base = count >= 6 \? 64 : count >= 3 \? 32 : 16/);
  assert.match(orderbook, /const pathX = pathItem\.x \?\? tapeTimeX/);
});

test("AGG buckets include the complete intersecting bucket", () => {
  const buckets = aggregateTapeBuckets([
    { id: 1, time: 920, price: 10, quote: 100, side: "buy" },
    { id: 2, time: 1_000, price: 10, quote: 200, side: "sell" },
  ], .01, 0, { startTime: 970, endTime: 1_100 });
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].bucketStart, 900);
  assert.equal(buckets[0].bucketEnd, 1_080);
  assert.equal(buckets[0].quote, 300);
  assert.equal(buckets[0].buyQuote, 100);
  assert.equal(buckets[0].sellQuote, 200);
  assert.match(orderbook, /function finalizedAggregateTapeBuckets\(state, buckets, closedBefore\)/);
  assert.match(orderbook, /aggregateTapeBuckets\(stored, step, state\.aggLevelIndex, window\)/);
  assert.match(orderbook, /snapshot = Object\.freeze/);
});

test("AGG marker size and label eligibility are absolute and immutable", () => {
  assert.equal(stableTapeQuoteStrength(0), 0);
  assert.ok(stableTapeQuoteStrength(10_000) > stableTapeQuoteStrength(1_000));
  assert.match(orderbook, /state\.mode === "agg"[\s\S]*stableTapeQuoteStrength/);
  assert.match(orderbook, /showLabel: stableTapeQuoteStrength\(bucket\.quote\) >= \.62/);
  assert.match(orderbook, /minQuote > 0 \|\| item\.showLabel/);
});

test("filter keeps the all-trade line and labels qualifying RAW trades", () => {
  assert.match(orderbook, /const rawPathItems = rawTapeItemsContinuous\(recent, rows, window\)/);
  assert.match(orderbook, /const pathDrawItems = layoutTapeSequence\(rawPathItems/);
  assert.match(orderbook, /if \(minQuote > 0\) \{[\s\S]*const label = formatTapeUsd\(item\.quote\)/);
});

test("footprint removes numeric delta and strengthens dominance colours", () => {
  assert.doesNotMatch(footprint, /formatSignedQuoteDelta|deltaText/);
  assert.match(footprint, /const alpha = \.38 \+ clusterStrength \* \.5/);
  assert.match(footprint, /dataLeft \+ dataWidth \/ 2/);
  assert.match(footprint, /formatQuoteVolume\(cluster\.quote\)/);
});

test("green and red chart candles share the same body interior", () => {
  assert.match(chart, /const fill = this\.theme\.bearFill;/);
  assert.match(chart, /const stroke = up \? this\.theme\.bullStroke : this\.theme\.bearStroke;/);
});
