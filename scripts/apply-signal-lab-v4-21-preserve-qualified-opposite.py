from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "signal-lab-v7-structural-extremes.js"
TEST = ROOT / "test" / "signal-lab-v7-same-bar-opposite-candidate.test.js"

text = TARGET.read_text(encoding="utf-8")

old_up = '''      // A new main extreme invalidates any stale opposite candidate from older
      // bars. V4.20 may seed a NEW same-bar opposite wick only when this closed
      // candle has already reversed from the new extreme by the causal reversal
      // threshold. This preserves violent reversal candles without turning every
      // ordinary higher high into a synthetic LOW.
      this.oppositeCandidate = null;
      this.#maybeSeedSameBarOppositeCandidate("LOW", candle);'''
new_up = '''      // A new main extreme invalidates ordinary stale opposite state. V4.21
      // keeps only a previously QUALIFIED same-bar provisional LOW alive across
      // continued higher highs; otherwise a violent reversal wick can be seeded
      // correctly and then erased by the very next continuation bar before the
      // primary HIGH is confirmed.
      const preservedQualifiedOpposite = this.oppositeCandidate?.provisionalSameBar === true
        && this.oppositeCandidate?.side === "LOW"
        ? { ...this.oppositeCandidate }
        : null;
      this.oppositeCandidate = preservedQualifiedOpposite;
      this.#maybeSeedSameBarOppositeCandidate("LOW", candle);'''
if old_up not in text:
    raise SystemExit("V4.21 advanceUp anchor not found")
text = text.replace(old_up, new_up, 1)

old_down = '''      // Same invariant as TRACKING_UP: stale opposite state is discarded first.
      // Only a materially reversed CLOSE may seed the opposite HIGH wick from
      // this same closed candle.
      this.oppositeCandidate = null;
      this.#maybeSeedSameBarOppositeCandidate("HIGH", candle);'''
new_down = '''      // Same invariant as TRACKING_UP: discard ordinary stale opposite state,
      // but preserve an already-qualified same-bar provisional HIGH while the
      // primary LOW continues to make lower lows. This is the HFT 08:53 case:
      // H=0.0258 was observed on a materially reversed candle, then later lower
      // lows must not erase that structural opposite before LOW confirmation.
      const preservedQualifiedOpposite = this.oppositeCandidate?.provisionalSameBar === true
        && this.oppositeCandidate?.side === "HIGH"
        ? { ...this.oppositeCandidate }
        : null;
      this.oppositeCandidate = preservedQualifiedOpposite;
      this.#maybeSeedSameBarOppositeCandidate("HIGH", candle);'''
if old_down not in text:
    raise SystemExit("V4.21 advanceDown anchor not found")
text = text.replace(old_down, new_down, 1)

old_seed = '''    const price = side === "LOW" ? candle.low : candle.high;
    const priceTicks = toTicks(price, this.tickSize);
    this.oppositeCandidate = {
      ...makeCandidate(side, price, priceTicks, candle, this.barIndex),
      provisionalSameBar: true,
      intrabarOrderUnknown: true,
      sameBarCloseReversalPct: round(closeReversalPct),
      sameBarReversalThresholdPct: round(threshold.thresholdPct),
    };'''
new_seed = '''    const price = side === "LOW" ? candle.low : candle.high;
    const priceTicks = toTicks(price, this.tickSize);
    const existing = this.oppositeCandidate;
    const shouldReplace = !existing
      || existing.side !== side
      || (side === "LOW" && priceTicks < existing.priceTicks)
      || (side === "HIGH" && priceTicks > existing.priceTicks);
    // If a previously qualified provisional opposite is more extreme, keep it.
    // Continuation candles may observe smaller opposite wicks, but they must not
    // downgrade the structural boundary already seen in closed OHLC data.
    if (!shouldReplace) return;
    this.oppositeCandidate = {
      ...makeCandidate(side, price, priceTicks, candle, this.barIndex),
      provisionalSameBar: true,
      intrabarOrderUnknown: true,
      sameBarCloseReversalPct: round(closeReversalPct),
      sameBarReversalThresholdPct: round(threshold.thresholdPct),
    };'''
if old_seed not in text:
    raise SystemExit("V4.21 same-bar seed anchor not found")
text = text.replace(old_seed, new_seed, 1)

TARGET.write_text(text, encoding="utf-8")

test_text = TEST.read_text(encoding="utf-8")
marker = 'test("V4.21 qualified same-bar opposite survives continued primary extremes until confirmation"'
if marker not in test_text:
    test_text += r'''

test("V4.21 qualified same-bar opposite survives continued primary extremes until confirmation", () => {
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
    // Qualified same-bar opposite HIGH=98 is created while LOW moves to 90.
    candle(2, { open: 95.5, high: 98, low: 90, close: 91 }),
  ]);

  let snapshot = engine.snapshot();
  assert.equal(snapshot.candidate?.side, "LOW");
  assert.equal(snapshot.candidate?.price, 90);
  assert.equal(snapshot.oppositeCandidate?.price, 98);
  assert.equal(snapshot.oppositeCandidate?.provisionalSameBar, true);

  // The main down-leg continues. Smaller same-bar highs must not erase or
  // downgrade the already qualified 98 boundary.
  engine.ingestCandle(candle(3, { open: 91, high: 94, low: 85, close: 86 }));
  snapshot = engine.snapshot();
  assert.equal(snapshot.candidate?.price, 85);
  assert.equal(snapshot.oppositeCandidate?.side, "HIGH");
  assert.equal(snapshot.oppositeCandidate?.price, 98);

  engine.ingestCandle(candle(4, { open: 86, high: 93, low: 80, close: 81 }));
  snapshot = engine.snapshot();
  assert.equal(snapshot.candidate?.price, 80);
  assert.equal(snapshot.oppositeCandidate?.price, 98);

  // Once the LOW is confirmed by a later reversal, the preserved opposite HIGH
  // becomes the normal next candidate rather than being lost.
  engine.ingestCandle(candle(5, { open: 81, high: 90, low: 81, close: 88 }));
  snapshot = engine.snapshot();
  assert.equal(snapshot.direction, "TRACKING_UP");
  assert.equal(snapshot.candidate?.side, "HIGH");
  assert.equal(snapshot.candidate?.price, 98);
  assert.equal(snapshot.candidate?.provisionalSameBar, true);
  assert.equal(snapshot.candidate?.intrabarOrderUnknown, true);
});
'''
    TEST.write_text(test_text, encoding="utf-8")
