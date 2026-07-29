import test from "node:test";
import assert from "node:assert/strict";
import {
  PATTERN_CATALOG,
  PATTERN_GROUPS,
  densityGeometry,
  minuteStructureEvidence,
  patternClock,
} from "../pattern-catalog.js";

test("catalog has only the agreed pattern groups plus explicit market events", () => {
  assert.equal(PATTERN_CATALOG.knife.group, PATTERN_GROUPS.CLASSIC);
  assert.equal(PATTERN_CATALOG.rearranger.group, PATTERN_GROUPS.ALGORITHM);
  assert.equal(PATTERN_CATALOG.impulse.group, PATTERN_GROUPS.MARKET_EVENT);
  assert.equal(PATTERN_CATALOG.compression, undefined);
  assert.equal(PATTERN_CATALOG.magnet, undefined);
  assert.equal(PATTERN_CATALOG.garden_bed, undefined);
  assert.equal(PATTERN_CATALOG.sharpening.detectorState, "active");
});

test("minute structure stores one-minute extrema for cascade research", () => {
  const structure = minuteStructureEvidence([
    { time: 60_000, open: 100, high: 101, low: 99, close: 100 },
    { time: 120_000, open: 100, high: 103, low: 100, close: 102 },
    { time: 180_000, open: 102, high: 102.5, low: 98, close: 99 },
    { time: 240_000, open: 99, high: 104, low: 99, close: 103 },
    { time: 300_000, open: 103, high: 103.5, low: 101, close: 102 },
  ], 102);
  assert.equal(structure.timeframe, "1m");
  assert.equal(structure.source, "minute-candles");
  assert.deepEqual(
    structure.extrema.map(({ side, price }) => ({ side, price })),
    [
      { side: "high", price: 103 },
      { side: "low", price: 98 },
      { side: "high", price: 104 },
    ],
  );
});

test("59th-minute evidence uses UTC exchange time", () => {
  const clock = patternClock(Date.UTC(2026, 6, 29, 12, 59, 42, 250));
  assert.equal(clock.minuteInHour, 59);
  assert.equal(clock.secondInMinute, 42);
  assert.equal(clock.isMinute59, true);
  assert.equal(clock.distanceToNextMinuteMs, 17_750);
});

test("density geometry preserves layout and observed move chains without scoring intent", () => {
  const geometry = densityGeometry({
    densityLifecycle: {
      state: "live",
      computedAt: 1_000,
      densities: [
        { id: "a", side: "bid", price: 99, currentQuote: 100_000 },
        {
          id: "b",
          side: "bid",
          price: 99.5,
          currentQuote: 110_000,
          move: { fromPrice: 99.4, toPrice: 99.5, distanceBps: 10, matchedAt: 900 },
        },
      ],
    },
  });
  assert.equal(geometry.bid.count, 2);
  assert.equal(geometry.bid.spacingsBps.length, 1);
  assert.equal(geometry.movedDensityCount, 1);
  assert.equal(geometry.source, "local-deep-book-density-lifecycle");
});
