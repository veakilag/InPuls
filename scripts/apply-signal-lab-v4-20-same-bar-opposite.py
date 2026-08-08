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
      // V4.20: the same closed candle can contain the first opposite wick of a
      // violent reversal. Previously we cleared it here, so a 1m low/high pair
      // inside one candle could lose the opposite price forever. Preserve that
      // wick provisionally; OHLC cannot tell its intrabar order, so downstream
      // consumers get an explicit data-quality flag and later bars still have to
      // confirm the candidate through the normal state machine.
      this.#seedSameBarOppositeCandidate("LOW", candle);
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
      // V4.20: preserve the opposite wick of the same closed reversal candle.
      // It is provisional because OHLC does not encode whether high or low came
      // first inside the minute. Later candles must still confirm it normally.
      this.#seedSameBarOppositeCandidate("HIGH", candle);
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
helper = '''  #seedSameBarOppositeCandidate(side, candle) {
    const price = side === "LOW" ? candle.low : candle.high;
    const priceTicks = toTicks(price, this.tickSize);
    this.oppositeCandidate = {
      ...makeCandidate(side, price, priceTicks, candle, this.barIndex),
      provisionalSameBar: true,
      intrabarOrderUnknown: true,
    };
    this.eventLog.push(eventRecord("OPPOSITE_CANDIDATE_SEEDED_SAME_BAR", candle.closeTime, {
      side,
      price,
      extremeAt: candle.time,
      semantics: "CLOSED_OHLC_INTRABAR_ORDER_UNKNOWN",
    }));
  }

'''
if anchor not in text:
    raise SystemExit("opposite candidate method anchor not found")
if '#seedSameBarOppositeCandidate(side, candle)' not in text:
    text = text.replace(anchor, helper + anchor, 1)

old_row = '''      atrWasCapped: metrics.threshold.atrWasCapped,
      touchCount: 0,'''
new_row = '''      atrWasCapped: metrics.threshold.atrWasCapped,
      // V4.20 observability: if this extremum originated from the opposite wick
      // of the same OHLC candle, retain the ambiguity instead of pretending the
      // intrabar high/low order is known.
      provisionalSameBar: Boolean(source.provisionalSameBar),
      intrabarOrderUnknown: Boolean(source.intrabarOrderUnknown),
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

test("V4.20 preserves the opposite wick when the primary candidate moves on the same closed candle", () => {
  const engine = new StructuralExtremeEngine({
    symbol: "TESTUSDT",
    timeframe: "1m",
    tickSize: 0.01,
    config: {
      minimumSwingPercent: 1,
      minimumPercent: 0.5,
      atrMultiplier: 0,
      minimumBarsAfterCandidate: 1,
    },
  });

  engine.ingestCandles([
    candle(0, { open: 100, high: 100, low: 99, close: 99.5 }),
    candle(1, { open: 99.5, high: 99.5, low: 95, close: 95.5 }),
    // New LOW candidate and a large opposite HIGH wick coexist in this candle.
    // The old state machine kept the 90 low but discarded the 98 high.
    candle(2, { open: 95.5, high: 98, low: 90, close: 91 }),
  ]);

  let snapshot = engine.snapshot();
  assert.equal(snapshot.candidate?.side, "LOW");
  assert.equal(snapshot.candidate?.price, 90);
  assert.equal(snapshot.oppositeCandidate?.side, "HIGH");
  assert.equal(snapshot.oppositeCandidate?.price, 98);
  assert.equal(snapshot.oppositeCandidate?.provisionalSameBar, true);
  assert.equal(snapshot.oppositeCandidate?.intrabarOrderUnknown, true);

  // A later candle confirms the LOW. Its weaker high must not replace the
  // preserved 98 same-bar opposite candidate.
  engine.ingestCandle(candle(3, { open: 91, high: 96, low: 91, close: 95 }));
  snapshot = engine.snapshot();
  assert.equal(snapshot.direction, "TRACKING_UP");
  assert.equal(snapshot.candidate?.side, "HIGH");
  assert.equal(snapshot.candidate?.price, 98);
  assert.equal(snapshot.candidate?.intrabarOrderUnknown, true);

  // The provisional HIGH is still not accepted on faith: a later candle has to
  // provide the normal reversal confirmation.
  engine.ingestCandle(candle(4, { open: 95, high: 97, low: 93, close: 93 }));
  snapshot = engine.snapshot();
  const confirmedHigh = snapshot.active.find((row) => row.side === "HIGH" && row.price === 98);
  assert.ok(confirmedHigh, "same-bar opposite high should become confirmable on later bars");
  assert.equal(confirmedHigh.provisionalSameBar, true);
  assert.equal(confirmedHigh.intrabarOrderUnknown, true);
});
''', encoding="utf-8")
