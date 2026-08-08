import test from "node:test";
import assert from "node:assert/strict";

import { StructuralExtremeEngine } from "../signal-lab-v7-structural-extremes.js";

const minute = 60_000;
const candle = (index, { open, high, low, close }) => ({
  time: index * minute,
  closeTime: (index + 1) * minute - 1,
  open,
  high,
  low,
  close,
  volume: 1,
  closed: true,
});

test("V4.20 preserves a materially reversed same-bar opposite wick provisionally", () => {
  const engine = new StructuralExtremeEngine({
    symbol: "TESTUSDT",
    timeframe: "1m",
    tickSize: 0.01,
    config: {
      minimumSwingPercent: 1,
      minimumPercent: 0.5,
      maximumPercent: 5,
      atrMultiplier: 0,
      minimumBarsAfterCandidate: 1,
    },
  });

  engine.ingestCandles([
    candle(0, { open: 100, high: 100, low: 99, close: 99.5 }),
    candle(1, { open: 99.5, high: 99.5, low: 95, close: 95.5 }),
    // The new LOW is 90, while the same closed candle also observed HIGH=98
    // and closed 1.11% above the low (>0.5% threshold). Preserve 98 as a
    // provisional opposite wick; do not claim its intrabar order.
    candle(2, { open: 95.5, high: 98, low: 90, close: 91 }),
  ]);

  let snapshot = engine.snapshot();
  assert.equal(snapshot.candidate?.side, "LOW");
  assert.equal(snapshot.candidate?.price, 90);
  assert.equal(snapshot.oppositeCandidate?.side, "HIGH");
  assert.equal(snapshot.oppositeCandidate?.price, 98);
  assert.equal(snapshot.oppositeCandidate?.provisionalSameBar, true);
  assert.equal(snapshot.oppositeCandidate?.intrabarOrderUnknown, true);

  engine.ingestCandle(candle(3, { open: 91, high: 96, low: 91, close: 95 }));
  snapshot = engine.snapshot();
  assert.equal(snapshot.direction, "TRACKING_UP");
  assert.equal(snapshot.candidate?.side, "HIGH");
  assert.equal(snapshot.candidate?.price, 98);
  assert.equal(snapshot.candidate?.intrabarOrderUnknown, true);

  // Still needs normal later-bar reversal confirmation.
  engine.ingestCandle(candle(4, { open: 95, high: 97, low: 93, close: 93 }));
  snapshot = engine.snapshot();
  const confirmedHigh = snapshot.active.find((row) => row.side === "HIGH" && row.price === 98);
  assert.ok(confirmedHigh);
  assert.equal(confirmedHigh.provisionalSameBar, true);
  assert.equal(confirmedHigh.intrabarOrderUnknown, true);
});

test("V4.20 ordinary new higher high still clears stale opposite when close reversal is below threshold", () => {
  const engine = new StructuralExtremeEngine({
    symbol: "TESTUSDT",
    timeframe: "1m",
    tickSize: 0.1,
    config: {
      minimumPercent: 2,
      maximumPercent: 2,
      atrMultiplier: 0,
      minimumSwingPercent: 1,
      minimumBarsAfterCandidate: 1,
    },
  });

  engine.ingestCandle(candle(0, { open: 100, high: 100, low: 100, close: 100 }));
  engine.ingestCandle(candle(1, { open: 100, high: 106, low: 100, close: 105 }));
  engine.ingestCandle(candle(2, { open: 105, high: 110, low: 104, close: 109 }));
  engine.ingestCandle(candle(3, { open: 109, high: 109, low: 101, close: 108.5 }));
  assert.equal(engine.snapshot().oppositeCandidate?.price, 101);

  const snapshot = engine.ingestCandle(candle(4, { open: 108.5, high: 112, low: 106, close: 111 }));
  assert.equal(snapshot.candidate?.price, 112);
  // 112 -> 111 is only 0.89%, below the 2% reversal threshold: do not seed 106.
  assert.equal(snapshot.oppositeCandidate, null);
});
