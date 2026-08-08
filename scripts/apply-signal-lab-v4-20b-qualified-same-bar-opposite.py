from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "signal-lab-v7-structural-extremes.js"
TEST = ROOT / "test" / "signal-lab-v7-same-bar-opposite-candidate.test.js"

text = TARGET.read_text(encoding="utf-8")

old_up = '''    if (highTicks > this.candidate.priceTicks) {
      const previousPrice = this.candidate.price;
      this.candidate = { ...makeCandidate("HIGH", candle.high, highTicks, candle, this.barIndex), movedCount: this.candidate.movedCount + 1 };
      this.oppositeCandidate = null;
      this.eventLog.push(eventRecord("CANDIDATE_MOVED", candle.closeTime, {
        side: "HIGH",
        fromPrice: previousPrice,
        toPrice: this.candidate.price,
        extremeAt: this.candidate.extremeAt,
      }));'''
new_up = '''    if (highTicks > this.candidate.priceTicks) {
      const previousPrice = this.candidate.price;
      this.candidate = { ...makeCandidate("HIGH", candle.high, highTicks, candle, this.barIndex), movedCount: this.candidate.movedCount + 1 };
      // A new main extreme invalidates any stale opposite candidate from older
      // bars. V4.20 may seed a NEW same-bar opposite wick only when this closed
      // candle has already reversed from the new extreme by the causal reversal
      // threshold. This preserves violent reversal candles without turning every
      // ordinary higher high into a synthetic LOW.
      this.oppositeCandidate = null;
      this.#maybeSeedSameBarOppositeCandidate("LOW", candle);
      this.eventLog.push(eventRecord("CANDIDATE_MOVED", candle.closeTime, {
        side: "HIGH",
        fromPrice: previousPrice,
        toPrice: this.candidate.price,
        extremeAt: this.candidate.extremeAt,
      }));'''
if old_up not in text:
    raise SystemExit("advanceUp moved-candidate anchor not found")
text = text.replace(old_up, new_up, 1)

old_down = '''    if (lowTicks < this.candidate.priceTicks) {
      const previousPrice = this.candidate.price;
      this.candidate = { ...makeCandidate("LOW", candle.low, lowTicks, candle, this.barIndex), movedCount: this.candidate.movedCount + 1 };
      this.oppositeCandidate = null;
      this.eventLog.push(eventRecord("CANDIDATE_MOVED", candle.closeTime, {
        side: "LOW",
        fromPrice: previousPrice,
        toPrice: this.candidate.price,
        extremeAt: this.candidate.extremeAt,
      }));'''
new_down = '''    if (lowTicks < this.candidate.priceTicks) {
      const previousPrice = this.candidate.price;
      this.candidate = { ...makeCandidate("LOW", candle.low, lowTicks, candle, this.barIndex), movedCount: this.candidate.movedCount + 1 };
      // Same invariant as TRACKING_UP: stale opposite state is discarded first.
      // Only a materially reversed CLOSE may seed the opposite HIGH wick from
      // this same closed candle.
      this.oppositeCandidate = null;
      this.#maybeSeedSameBarOppositeCandidate("HIGH", candle);
      this.eventLog.push(eventRecord("CANDIDATE_MOVED", candle.closeTime, {
        side: "LOW",
        fromPrice: previousPrice,
        toPrice: this.candidate.price,
        extremeAt: this.candidate.extremeAt,
      }));'''
if old_down not in text:
    raise SystemExit("advanceDown moved-candidate anchor not found")
text = text.replace(old_down, new_down, 1)

anchor = '''  #updateOppositeCandidate(side, candle) {
'''
helper = '''  #maybeSeedSameBarOppositeCandidate(side, candle) {
    if (!this.candidate) return;
    const threshold = this.#reversalThresholdPct(this.candidate.price);
    // Use the CLOSE, not the opposite wick itself, as evidence that a reversal
    // really existed by candle close. OHLC cannot reveal whether high or low
    // happened first inside the minute, therefore this remains provisional and
    // explicitly carries intrabarOrderUnknown=true.
    const closeReversalPct = this.candidate.side === "HIGH"
      ? Math.max(0, (this.candidate.price - candle.close) / this.candidate.price * 100)
      : Math.max(0, (candle.close - this.candidate.price) / this.candidate.price * 100);
    if (closeReversalPct < threshold.thresholdPct) return;

    const price = side === "LOW" ? candle.low : candle.high;
    const priceTicks = toTicks(price, this.tickSize);
    this.oppositeCandidate = {
      ...makeCandidate(side, price, priceTicks, candle, this.barIndex),
      provisionalSameBar: true,
      intrabarOrderUnknown: true,
      sameBarCloseReversalPct: round(closeReversalPct),
      sameBarReversalThresholdPct: round(threshold.thresholdPct),
    };
    this.eventLog.push(eventRecord("OPPOSITE_CANDIDATE_SEEDED_SAME_BAR", candle.closeTime, {
      side,
      price,
      extremeAt: candle.time,
      closeReversalPct: round(closeReversalPct),
      reversalThresholdPct: round(threshold.thresholdPct),
      semantics: "CLOSED_OHLC_INTRABAR_ORDER_UNKNOWN",
    }));
  }

'''
if anchor not in text:
    raise SystemExit("opposite candidate method anchor not found")
if '#maybeSeedSameBarOppositeCandidate(side, candle)' not in text:
    text = text.replace(anchor, helper + anchor, 1)

old_row = '''      atrWasCapped: metrics.threshold.atrWasCapped,
      touchCount: 0,'''
new_row = '''      atrWasCapped: metrics.threshold.atrWasCapped,
      // Preserve data-quality semantics if this extremum originated from the
      // opposite wick of one closed OHLC bar. The price is observed, but the
      // intrabar high/low ordering is not knowable from 1m OHLC alone.
      provisionalSameBar: Boolean(source.provisionalSameBar),
      intrabarOrderUnknown: Boolean(source.intrabarOrderUnknown),
      sameBarCloseReversalPct: finite(source.sameBarCloseReversalPct) ?? undefined,
      sameBarReversalThresholdPct: finite(source.sameBarReversalThresholdPct) ?? undefined,
      touchCount: 0,'''
if old_row not in text:
    raise SystemExit("confirmed row quality anchor not found")
text = text.replace(old_row, new_row, 1)

TARGET.write_text(text, encoding="utf-8")

TEST.write_text(r'''import test from "node:test";
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
''', encoding="utf-8")
