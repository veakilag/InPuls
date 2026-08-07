from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ROOT / "signal-lab-v7-multi-timeframe-levels.js"


def replace_once(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one occurrence, found {count}: {old[:160]!r}")
    return text.replace(old, new, 1)


text = LEVELS.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''export const LOCAL_PIVOT_PROMINENCE_POLICY = Object.freeze({
  "1m": Object.freeze({ lookbackBars: 8, minimumIncomingBaseNatr: 0.75, minimumOutgoingBaseNatr: 0.60 }),
  "5m": Object.freeze({ lookbackBars: 6, minimumIncomingBaseNatr: 0.75, minimumOutgoingBaseNatr: 0.60 }),
});''',
    '''export const LOCAL_PIVOT_PROMINENCE_POLICY = Object.freeze({
  "1m": Object.freeze({
    lookbackBars: 8,
    structureLookbackBars: 60,
    minimumIncomingBaseNatr: 0.75,
    minimumOutgoingBaseNatr: 0.60,
    minimumPriorImpulseBaseNatr: 1.25,
    minimumRetracementRatio: 0.15,
  }),
  "5m": Object.freeze({
    lookbackBars: 6,
    structureLookbackBars: 24,
    minimumIncomingBaseNatr: 0.75,
    minimumOutgoingBaseNatr: 0.60,
    minimumPriorImpulseBaseNatr: 1.25,
    minimumRetracementRatio: 0.20,
  }),
});''',
)

old = '''  const incomingBaseNatr = incomingPct / baseNatrPct;
  const outgoingBaseNatr = outgoingPct / baseNatrPct;
  const minimumIncomingBaseNatr = Math.max(0, finite(policy.minimumIncomingBaseNatr) ?? 0.75);
  const minimumOutgoingBaseNatr = Math.max(0, finite(policy.minimumOutgoingBaseNatr) ?? 0.60);
  const incomingPassed = incomingBaseNatr >= minimumIncomingBaseNatr;
  const outgoingPassed = outgoingBaseNatr >= minimumOutgoingBaseNatr;
  const admitted = incomingPassed && outgoingPassed;

  return Object.freeze({
    admitted,
    reason: admitted ? "LOW_PIVOT_PROMINENCE_PASS" : "LOW_PIVOT_PROMINENCE_FILTERED",
    incomingPct,
    outgoingPct,
    baseNatrPct,
    incomingBaseNatr,
    outgoingBaseNatr,
    minimumIncomingBaseNatr,
    minimumOutgoingBaseNatr,
    incomingPassed,
    outgoingPassed,
    lookbackBars,
    pivotAt,
    confirmedAt,
  });'''

new = '''  const incomingBaseNatr = incomingPct / baseNatrPct;
  const outgoingBaseNatr = outgoingPct / baseNatrPct;
  const minimumIncomingBaseNatr = Math.max(0, finite(policy.minimumIncomingBaseNatr) ?? 0.75);
  const minimumOutgoingBaseNatr = Math.max(0, finite(policy.minimumOutgoingBaseNatr) ?? 0.60);
  const incomingPassed = incomingBaseNatr >= minimumIncomingBaseNatr;
  const outgoingPassed = outgoingBaseNatr >= minimumOutgoingBaseNatr;

  // V4.8: absolute NATR prominence is not enough. During a strong rising leg a
  // tiny pause can still be > 0.75 NATR and therefore look "large" in isolation.
  // Measure the pullback against the whole causal impulse that preceded the LOW.
  // A shallow retracement inside that same impulse stays event-memory, not a new
  // structural support ray. Compression HIGHs are untouched by this LOW-only gate.
  const structureLookbackBars = Math.max(
    lookbackBars + 2,
    Math.round(finite(policy.structureLookbackBars) ?? lookbackBars * 3),
  );
  const structuralBefore = rows.slice(Math.max(0, pivotIndex - structureLookbackBars), pivotIndex);
  let priorImpulsePeakIndex = -1;
  let priorImpulsePeak = null;
  for (let index = 0; index < structuralBefore.length; index += 1) {
    const high = finite(structuralBefore[index]?.high);
    if (!(high > 0)) continue;
    if (priorImpulsePeak === null || high >= priorImpulsePeak) {
      priorImpulsePeak = high;
      priorImpulsePeakIndex = index;
    }
  }

  let priorImpulseOriginLow = null;
  if (priorImpulsePeakIndex > 0) {
    for (const row of structuralBefore.slice(0, priorImpulsePeakIndex + 1)) {
      const low = finite(row?.low);
      if (!(low > 0)) continue;
      if (priorImpulseOriginLow === null || low < priorImpulseOriginLow) priorImpulseOriginLow = low;
    }
  }

  const priorImpulsePct = priorImpulsePeak !== null && priorImpulseOriginLow !== null
    ? structuralPercentMove(priorImpulseOriginLow, priorImpulsePeak)
    : null;
  const priorImpulseBaseNatr = priorImpulsePct !== null ? priorImpulsePct / baseNatrPct : null;
  const retracementRatio = priorImpulsePeak !== null
    && priorImpulseOriginLow !== null
    && priorImpulsePeak > priorImpulseOriginLow
    ? Math.max(0, priorImpulsePeak - pivotPrice) / (priorImpulsePeak - priorImpulseOriginLow)
    : null;
  const minimumPriorImpulseBaseNatr = Math.max(
    0,
    finite(policy.minimumPriorImpulseBaseNatr) ?? 1.25,
  );
  const minimumRetracementRatio = Math.max(
    0,
    Math.min(1, finite(policy.minimumRetracementRatio) ?? 0.20),
  );
  const retracementApplicable = priorImpulseBaseNatr !== null
    && priorImpulseBaseNatr >= minimumPriorImpulseBaseNatr
    && retracementRatio !== null;
  const retracementPassed = !retracementApplicable || retracementRatio >= minimumRetracementRatio;
  const admitted = incomingPassed && outgoingPassed && retracementPassed;

  return Object.freeze({
    admitted,
    reason: admitted
      ? "LOW_PIVOT_PROMINENCE_PASS"
      : !retracementPassed
        ? "LOW_PIVOT_SHALLOW_RETRACEMENT_FILTERED"
        : "LOW_PIVOT_PROMINENCE_FILTERED",
    incomingPct,
    outgoingPct,
    baseNatrPct,
    incomingBaseNatr,
    outgoingBaseNatr,
    minimumIncomingBaseNatr,
    minimumOutgoingBaseNatr,
    incomingPassed,
    outgoingPassed,
    lookbackBars,
    structureLookbackBars,
    priorImpulsePeak,
    priorImpulseOriginLow,
    priorImpulsePct,
    priorImpulseBaseNatr,
    minimumPriorImpulseBaseNatr,
    retracementRatio,
    minimumRetracementRatio,
    retracementApplicable,
    retracementPassed,
    pivotAt,
    confirmedAt,
  });'''

text = replace_once(text, old, new)
LEVELS.write_text(text, encoding="utf-8")

TEST = ROOT / "test/signal-lab-v7-pivot-retracement.test.js"
TEST.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import {
  structuralLocalPivotProminenceDecision,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const STEP = 5 * 60_000;
const candle = (index, high, low, close = (high + low) / 2) => ({
  time: index * STEP,
  closeTime: (index + 1) * STEP - 1,
  open: close,
  high,
  low,
  close,
  closed: true,
});

function context(candles, baseNatrPct = 0.20) {
  return {
    currentPrice: candles.at(-1)?.close ?? 100,
    currentNatrPct: baseNatrPct,
    baseNatrPct,
    compressionRatio: 1,
    volatilityState: "NORMAL",
    times: candles.map((row) => row.time),
    natrs: candles.map(() => baseNatrPct),
  };
}

test("V4.8 filters a shallow LOW pause inside one larger rising impulse", () => {
  const candles = [
    candle(0, 99.10, 98.90),
    candle(1, 99.45, 99.05),
    candle(2, 99.90, 99.35),
    candle(3, 100.35, 99.80),
    candle(4, 100.75, 100.25),
    candle(5, 101.05, 100.65),
    candle(6, 101.10, 100.84),
    candle(7, 101.08, 100.80), // shallow candidate LOW after a ~2.2 point impulse
    candle(8, 101.12, 100.86),
    candle(9, 101.18, 100.92),
  ];
  const extreme = {
    side: "LOW",
    price: 100.80,
    extremeAt: candles[7].time,
    confirmedAt: candles[9].time,
  };
  const decision = structuralLocalPivotProminenceDecision(extreme, "5m", candles, context(candles));
  assert.equal(decision.incomingPassed, true);
  assert.equal(decision.outgoingPassed, true);
  assert.equal(decision.retracementApplicable, true);
  assert.ok(decision.retracementRatio < 0.20);
  assert.equal(decision.admitted, false);
  assert.equal(decision.reason, "LOW_PIVOT_SHALLOW_RETRACEMENT_FILTERED");
});

test("V4.8 keeps a meaningful LOW retracement after a real prior impulse", () => {
  const candles = [
    candle(0, 99.10, 98.90),
    candle(1, 99.50, 99.00),
    candle(2, 100.00, 99.40),
    candle(3, 100.50, 99.90),
    candle(4, 101.00, 100.40),
    candle(5, 101.10, 100.70),
    candle(6, 100.95, 100.30),
    candle(7, 100.55, 99.95), // meaningful pullback LOW
    candle(8, 100.65, 100.05),
    candle(9, 100.90, 100.30),
  ];
  const extreme = {
    side: "LOW",
    price: 99.95,
    extremeAt: candles[7].time,
    confirmedAt: candles[9].time,
  };
  const decision = structuralLocalPivotProminenceDecision(extreme, "5m", candles, context(candles));
  assert.equal(decision.incomingPassed, true);
  assert.equal(decision.outgoingPassed, true);
  assert.equal(decision.retracementApplicable, true);
  assert.ok(decision.retracementRatio >= 0.20);
  assert.equal(decision.admitted, true);
});

test("V4.8 still bypasses HIGH so BTC compression highs cannot regress", () => {
  const candles = [candle(0, 100.2, 99.8), candle(1, 100.4, 100.0)];
  const decision = structuralLocalPivotProminenceDecision({
    side: "HIGH",
    price: 100.4,
    extremeAt: candles[1].time,
    confirmedAt: candles[1].time,
  }, "5m", candles, context(candles));
  assert.equal(decision.admitted, true);
  assert.equal(decision.reason, "HIGH_CALIBRATION_BYPASS");
});
''', encoding="utf-8")
