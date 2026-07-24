import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const nativeSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => {
  const timer = nativeSetInterval(...args);
  timer?.unref?.();
  return timer;
};

const {
  aggregateTapeBlockSize,
  invertBookScaleWheelDelta,
  rawTapeBubbleDiameter,
} = await import("../orderbook.js");

test("Ctrl + wheel direction is inverted for increasing scale on forward wheel", () => {
  assert.equal(invertBookScaleWheelDelta(-100), 100);
  assert.equal(invertBookScaleWheelDelta(100), -100);
});

test("raw tape bubbles scale monotonically with trade strength", () => {
  const small = rawTapeBubbleDiameter(.15, 600);
  const medium = rawTapeBubbleDiameter(.8, 600);
  const large = rawTapeBubbleDiameter(1.8, 600);
  assert.ok(small >= 3);
  assert.ok(medium > small);
  assert.ok(large > medium);
  assert.ok(large <= 44);
});

test("AGG tape blocks also grow with executed volume", () => {
  const small = aggregateTapeBlockSize(.15, 18, 600);
  const large = aggregateTapeBlockSize(1.8, 18, 600);
  assert.ok(large.height > small.height);
  assert.ok(large.width > small.width);
  assert.ok(large.height <= 29);
  assert.ok(large.width <= 112);
});

test("wide tape keeps bubble diameter under the hard cap", () => {
  assert.ok(rawTapeBubbleDiameter(1.9, 1200) <= 44);
  assert.ok(rawTapeBubbleDiameter(1.9, 1200) >= rawTapeBubbleDiameter(1.9, 240));
});

test("worker resume is bounded and full-book emission is expanded", async () => {
  const worker = await readFile(new URL("../orderbook-worker.js", import.meta.url), "utf8");
  assert.match(worker, /MAX_RESUME_TAPE_SNAPSHOT = 420/);
  assert.match(worker, /RESUME_TAPE_WINDOW_MS = 75_000/);
  assert.match(worker, /MAX_EMITTED_LEVELS_PER_SIDE = 8_000/);
  assert.match(worker, /if \(active === 2\) return 5_000/);
  assert.match(worker, /if \(active === 3\) return 3_500/);
  assert.match(worker, /return 2_500/);
});
