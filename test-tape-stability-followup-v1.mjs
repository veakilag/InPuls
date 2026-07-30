import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  bookPriceEmphasis,
  bookPsychologicalPriceUnit,
  snapTapeWindowEnd,
  tapeWindowPixelQuantum,
} from "./orderbook.js";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const footprint = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");

test("psychological round levels do not depend on selected book step", () => {
  assert.equal(bookPsychologicalPriceUnit(.093), .001);
  assert.deepEqual(bookPriceEmphasis(.093, .093), {
    round: true,
    half: false,
    majorUnit: .001,
  });
  assert.deepEqual(bookPriceEmphasis(.0925, .093), {
    round: false,
    half: true,
    majorUnit: .001,
  });
  assert.equal(bookPsychologicalPriceUnit(100_000), 1_000);
});

test("Tape camera advances on a complete CSS-pixel time grid", () => {
  const duration = 12_000;
  const width = 600;
  assert.equal(tapeWindowPixelQuantum(duration, width), 20);
  assert.equal(snapTapeWindowEnd(10_001, duration, width), 10_020);
  assert.equal(snapTapeWindowEnd(10_019, duration, width), 10_020);
  assert.equal(tapeWindowPixelQuantum(duration, width * 1.5), 40 / 3);
});

test("filter preserves all-trade path and labels every qualifying RAW marker", () => {
  assert.match(orderbook, /const rawPathItems = rawTapeItemsContinuous\(recent, rows, window\)/);
  assert.match(orderbook, /const pathDrawItems = layoutTapeSequence\(rawPathItems/);
  assert.match(orderbook, /if \(minQuote > 0\) \{[\s\S]*const label = formatTapeUsd\(item\.quote\)/);
  assert.match(orderbook, /Линия всех сделок · нет маркеров по фильтру/);
});

test("footprint candle owns the left lane and data begins after its body", () => {
  assert.match(footprint, /const candleLeft = columnLeft \+ 2/);
  assert.match(footprint, /const dataLeft = candleLeft \+ candleBodyWidth \+ 2/);
  assert.match(footprint, /const deltaText = formatSignedQuoteDelta\(cluster\.buyQuote - cluster\.sellQuote\)/);
  assert.match(footprint, /const volumeText = formatQuoteVolume\(cluster\.quote\)/);
  assert.match(footprint, /state\.context\.moveTo\(candleX, highRow\.y\)/);
});


test("runtime passes DPR into the Tape camera", () => {
  assert.match(orderbook, /buildContinuousTapeWindow\(rect\.width, latestTime, endTime, dpr\)/);
  assert.match(orderbook, /const physicalWidth = safeWidth \* Math\.max\(1, Number\(dpr\) \|\| 1\)/);
});
