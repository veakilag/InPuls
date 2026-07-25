import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
const resetPage = readFileSync(new URL("./reset-v26.html", import.meta.url), "utf8");

function tapeApi() {
  const constantsStart = orderbook.indexOf("const TAPE_SECOND_MS");
  const constantsEnd = orderbook.indexOf("const TAPE_STALE_NOTICE_MS", constantsStart);
  const clampStart = orderbook.indexOf("function clampTape(");
  const clampEnd = orderbook.indexOf("function formatTapeUsd", clampStart);
  const helperStart = orderbook.indexOf("function buildContinuousTapeWindow");
  const helperEnd = orderbook.indexOf("function rawTapeItemsContinuous", helperStart);
  assert.ok(constantsStart >= 0 && constantsEnd > constantsStart);
  assert.ok(clampStart >= 0 && clampEnd > clampStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);

  const context = {};
  vm.runInNewContext(
    `${orderbook.slice(constantsStart, constantsEnd)}
${orderbook.slice(clampStart, clampEnd)}
${orderbook.slice(helperStart, helperEnd)}
globalThis.tapeApi = { buildContinuousTapeWindow, tapeTimeX, layoutTapeSequence, formatTapeClock };`,
    context,
  );
  return context.tapeApi;
}

test("Tape v2 defaults to RAW and keeps AGG as an explicit mode", () => {
  assert.match(orderbook, /mode: localStorage\.getItem\(TAPE_MODE_KEY\) === "agg" \? "agg" : "raw"/);
  assert.match(orderbook, /button\.textContent = aggregated \? "AGG" : "RAW"/);
});

test("RAW layout preserves chronological order and separates equal timestamps", () => {
  const api = tapeApi();
  const latest = Date.now();
  const window = api.buildContinuousTapeWindow(320, latest);
  const trades = Array.from({ length: 12 }, (_, index) => ({
    id: index,
    time: latest - 80,
    lastTime: latest - 80,
    quote: 100 + index,
  }));
  const laidOut = api.layoutTapeSequence(trades, window, 320);
  assert.deepEqual(laidOut.map((item) => item.id), trades.map((item) => item.id));
  for (let index = 1; index < laidOut.length; index += 1) {
    assert.ok(laidOut[index].x > laidOut[index - 1].x);
  }
  assert.ok(laidOut[0].x >= 1);
  assert.ok(laidOut.at(-1).x <= window.plotRight);
});

test("collision solver remains bounded at maximum visible RAW density", () => {
  const api = tapeApi();
  const latest = Date.now();
  const window = api.buildContinuousTapeWindow(280, latest);
  const trades = Array.from({ length: 1_200 }, (_, index) => ({
    id: index,
    time: latest - 30 + Math.floor(index / 80),
    lastTime: latest - 30 + Math.floor(index / 80),
    quote: 10,
  }));
  const laidOut = api.layoutTapeSequence(trades, window, 280);
  assert.equal(laidOut.length, trades.length);
  assert.ok(laidOut.every((item) => Number.isFinite(item.x)));
  assert.ok(laidOut[0].x >= 1);
  assert.ok(laidOut.at(-1).x <= window.plotRight + 1e-9);
  for (let index = 1; index < laidOut.length; index += 1) {
    assert.ok(laidOut[index].x >= laidOut[index - 1].x);
  }
});

test("sparse trades stay anchored to real time", () => {
  const api = tapeApi();
  const latest = Date.now();
  const window = api.buildContinuousTapeWindow(600, latest);
  const times = [window.startTime + 1_000, window.startTime + 4_000, window.startTime + 8_000];
  const trades = times.map((time, index) => ({ id: index, time, lastTime: time, quote: 10 }));
  const laidOut = api.layoutTapeSequence(trades, window, 600);
  laidOut.forEach((item, index) => {
    const expected = api.tapeTimeX(times[index], window, 600);
    assert.ok(Math.abs(item.x - expected) < 0.001);
  });
});

test("renderer draws a NOW line, second labels, and bounded RAW dots", () => {
  assert.match(orderbook, /drawTapeTimeline\(context, rect, window\)/);
  assert.match(orderbook, /context\.fillText\("NOW",/);
  assert.match(orderbook, /const TAPE_RAW_MAX_DIAMETER = 15/);
  assert.match(orderbook, /const drawItems = state\.mode === "raw"\n\s*\? layoutTapeSequence\(items, window, rect\.width\)/);
  assert.doesNotMatch(orderbook, /1103515245/);
  assert.doesNotMatch(orderbook, /sort\(\(left, right\) => Number\(left\.quote\) - Number\(right\.quote\)\)/);
  assert.match(orderbook, /const baseX = item\.x \?\? tapeTimeX/);
});

test("Tape v2 cache and reset page point to the new runtime", () => {
  assert.match(orderbook, /inpuls-orderbook-runtime-v26-24-tape-v2-core/);
  assert.match(serviceWorker, /inpuls-v26-24-tape-v2-core/);
  assert.match(serviceWorker, /orderbook\.js\?v=26-24-tape-v2-core/);
  assert.match(resetPage, /Tape v2 Core/);
  assert.match(resetPage, /sw\.js\?v=26-24-tape-v2-core/);
  assert.match(resetPage, /build=26-24-tape-v2-core/);
});
