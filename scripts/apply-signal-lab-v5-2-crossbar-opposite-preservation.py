from pathlib import Path

engine_path = Path('signal-lab-v7-structural-extremes.js')
text = engine_path.read_text()
old_up = '''      // A new main extreme invalidates ordinary stale opposite state. V4.21
      // keeps only a previously QUALIFIED same-bar provisional LOW alive across
      // continued higher highs; otherwise a violent reversal wick can be seeded
      // correctly and then erased by the very next continuation bar before the
      // primary HIGH is confirmed.
      const preservedQualifiedOpposite = this.oppositeCandidate?.provisionalSameBar === true
        && this.oppositeCandidate?.side === "LOW"
        ? { ...this.oppositeCandidate }
        : null;
      this.oppositeCandidate = preservedQualifiedOpposite;
      this.#maybeSeedSameBarOppositeCandidate("LOW", candle);
'''
new_up = '''      // V5.2: preserve the deepest observed opposite LOW across continued
      // higher highs. A smooth bullish leg may contain one meaningful defended
      // pullback before the primary HIGH is finally confirmed. Dropping that
      // cross-bar LOW on every new higher high creates a ladder of weaker LOWs
      // later. Keeping the most extreme observed LOW makes the leg event-first:
      // later higher LOWs cannot downgrade the structural boundary already seen.
      const preservedOpposite = this.oppositeCandidate?.side === "LOW"
        ? { ...this.oppositeCandidate, preservedAcrossContinuation: true }
        : null;
      this.oppositeCandidate = preservedOpposite;
      this.#maybeSeedSameBarOppositeCandidate("LOW", candle);
      if (preservedOpposite) {
        this.eventLog.push(eventRecord("OPPOSITE_CANDIDATE_PRESERVED_ACROSS_CONTINUATION", candle.closeTime, {
          side: "LOW",
          price: preservedOpposite.price,
          extremeAt: preservedOpposite.extremeAt,
          primarySide: "HIGH",
          primaryPrice: this.candidate.price,
        }));
      }
'''
if old_up not in text:
    raise SystemExit('advanceUp preservation block not found')
text = text.replace(old_up, new_up, 1)
old_down = '''      // Same invariant as TRACKING_UP: discard ordinary stale opposite state,
      // but preserve an already-qualified same-bar provisional HIGH while the
      // primary LOW continues to make lower lows. This is the HFT 08:53 case:
      // H=0.0258 was observed on a materially reversed candle, then later lower
      // lows must not erase that structural opposite before LOW confirmation.
      const preservedQualifiedOpposite = this.oppositeCandidate?.provisionalSameBar === true
        && this.oppositeCandidate?.side === "HIGH"
        ? { ...this.oppositeCandidate }
        : null;
      this.oppositeCandidate = preservedQualifiedOpposite;
      this.#maybeSeedSameBarOppositeCandidate("HIGH", candle);
'''
new_down = '''      // V5.2 mirror: preserve the highest observed opposite HIGH across
      // continued lower lows. Later lower HIGHs inside the same bearish leg
      // cannot downgrade an already-observed structural boundary.
      const preservedOpposite = this.oppositeCandidate?.side === "HIGH"
        ? { ...this.oppositeCandidate, preservedAcrossContinuation: true }
        : null;
      this.oppositeCandidate = preservedOpposite;
      this.#maybeSeedSameBarOppositeCandidate("HIGH", candle);
      if (preservedOpposite) {
        this.eventLog.push(eventRecord("OPPOSITE_CANDIDATE_PRESERVED_ACROSS_CONTINUATION", candle.closeTime, {
          side: "HIGH",
          price: preservedOpposite.price,
          extremeAt: preservedOpposite.extremeAt,
          primarySide: "LOW",
          primaryPrice: this.candidate.price,
        }));
      }
'''
if old_down not in text:
    raise SystemExit('advanceDown preservation block not found')
text = text.replace(old_down, new_down, 1)
engine_path.write_text(text)

test_path = Path('test/signal-lab-v7-structural-extremes-v3.test.js')
test_text = test_path.read_text()
old_test = '''test("new higher high resets a stale opposite low", () => {
  const subject = engine();
  subject.ingestCandle(candle(0, 100, 100, 100, 100));
  subject.ingestCandle(candle(1, 100, 106, 100, 105));
  subject.ingestCandle(candle(2, 105, 110, 104, 109));
  subject.ingestCandle(candle(3, 109, 109, 101, 108.5));
  assert.equal(subject.snapshot().oppositeCandidate.price, 101);
  const snapshot = subject.ingestCandle(candle(4, 108.5, 112, 106, 111));
  assert.equal(snapshot.candidate.price, 112);
  assert.equal(snapshot.oppositeCandidate, null);
});
'''
new_test = '''test("new higher high preserves the deepest prior opposite low across one continuous leg", () => {
  const subject = engine();
  subject.ingestCandle(candle(0, 100, 100, 100, 100));
  subject.ingestCandle(candle(1, 100, 106, 100, 105));
  subject.ingestCandle(candle(2, 105, 110, 104, 109));
  subject.ingestCandle(candle(3, 109, 109, 101, 108.5));
  assert.equal(subject.snapshot().oppositeCandidate.price, 101);

  const continuation = subject.ingestCandle(candle(4, 108.5, 112, 106, 111));
  assert.equal(continuation.candidate.price, 112);
  assert.equal(continuation.oppositeCandidate.price, 101);
  assert.equal(continuation.oppositeCandidate.preservedAcrossContinuation, true);

  // A weaker later LOW must not replace the deeper structural boundary.
  const confirmed = subject.ingestCandle(candle(5, 111, 111, 106, 108));
  assert.equal(confirmed.history.at(-1).side, "HIGH");
  assert.equal(confirmed.direction, STRUCTURAL_DIRECTIONS.TRACKING_DOWN);
  assert.equal(confirmed.candidate.side, "LOW");
  assert.equal(confirmed.candidate.price, 101);
  assert.equal(confirmed.candidate.extremeAt, candle(3, 109, 109, 101, 108.5).time);
});

test("new lower low mirrors cross-bar preservation for the highest opposite high", () => {
  const subject = engine();
  subject.ingestCandle(candle(0, 100, 100, 100, 100));
  subject.ingestCandle(candle(1, 100, 100, 94, 95));
  subject.ingestCandle(candle(2, 95, 96, 90, 91));
  subject.ingestCandle(candle(3, 91, 99, 91, 92));
  assert.equal(subject.snapshot().oppositeCandidate.price, 99);

  const continuation = subject.ingestCandle(candle(4, 92, 94, 88, 89));
  assert.equal(continuation.candidate.price, 88);
  assert.equal(continuation.oppositeCandidate.price, 99);
  assert.equal(continuation.oppositeCandidate.preservedAcrossContinuation, true);
});
'''
if old_test not in test_text:
    raise SystemExit('legacy stale-opposite test not found')
test_text = test_text.replace(old_test, new_test, 1)
test_path.write_text(test_text)
