from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ROOT / "signal-lab-v7-multi-timeframe-levels.js"
TEST = ROOT / "test/signal-lab-v7-high-working-pivot.test.js"

text = LEVELS.read_text(encoding="utf-8")

old_policy = '''    minimumPriorImpulseBaseNatr: 1.25,
    // V4.11 visual calibration on BTC 5m: two trader-rejected pauses
    // measured 23.7% and 25.5% retracement, while reviewed structural LOWs
    // were either not applicable to this gate or measured 127% / 674%.
    // Keep the rule causal and apply it only when a valid prior impulse exists.
    minimumRetracementRatio: 0.30,
  }),
});'''
new_policy = '''    minimumPriorImpulseBaseNatr: 1.25,
    // V4.11 visual calibration on BTC 5m: two trader-rejected pauses
    // measured 23.7% and 25.5% retracement, while reviewed structural LOWs
    // were either not applicable to this gate or measured 127% / 674%.
    // Keep the rule causal and apply it only when a valid prior impulse exists.
    minimumRetracementRatio: 0.30,
    // V4.13 HIGH calibration from the same fixed BTC review window. The single
    // trader-rejected edge HIGH had only 2.19 base-NATR of incoming rise, while
    // retained local HIGHs measured 3.82N, 5.56N, 6.78N and 7.77N. Apply this
    // only post-cluster in the local working map; senior confluence and x2+
    // attacks bypass it before this decision is evaluated.
    minimumHighIncomingBaseNatr: 3.00,
  }),
});'''
if old_policy not in text:
    raise SystemExit("V4.13 policy anchor not found")
text = text.replace(old_policy, new_policy, 1)

old_guard = '''export function structuralLocalWorkingSetPivotDecision(level, candles, volatilityContext) {
  const sourceTimeframe = level?.sourceTimeframe;
  const policy = LOCAL_PIVOT_PROMINENCE_POLICY[sourceTimeframe];
  if (!policy || level?.side !== "LOW") {
    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_NOT_APPLICABLE" });
  }

  const pivotAt = finite(level?.nativeExtremeAt ?? level?.extremeAt);'''
new_guard = '''export function structuralLocalWorkingSetPivotDecision(level, candles, volatilityContext) {
  const sourceTimeframe = level?.sourceTimeframe;
  const policy = LOCAL_PIVOT_PROMINENCE_POLICY[sourceTimeframe];
  if (!policy || !["LOW", "HIGH"].includes(level?.side)) {
    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_NOT_APPLICABLE" });
  }

  const pivotAt = finite(level?.nativeExtremeAt ?? level?.extremeAt);'''
if old_guard not in text:
    raise SystemExit("V4.13 function guard anchor not found")
text = text.replace(old_guard, new_guard, 1)

old_after_index = '''  const pivotIndex = rows.findIndex((row) => row.time === pivotAt);
  if (pivotIndex < 0) {
    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_CANDLE_UNAVAILABLE" });
  }

  const structureLookbackBars = Math.max('''
new_after_index = '''  const pivotIndex = rows.findIndex((row) => row.time === pivotAt);
  if (pivotIndex < 0) {
    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_CANDLE_UNAVAILABLE" });
  }

  // V4.13: HIGH uses only causal incoming-leg prominence in the post-cluster
  // working map. Do not mirror the LOW retracement formula: the BTC review
  // showed outgoing rejection does not separate the edge HIGH, while incoming
  // rise does. 1m remains unchanged until it has its own reviewed sample.
  if (level?.side === "HIGH") {
    const minimumHighIncomingBaseNatr = Math.max(
      0,
      finite(policy.minimumHighIncomingBaseNatr) ?? 0,
    );
    if (!(minimumHighIncomingBaseNatr > 0)) {
      return Object.freeze({ visible: true, reason: "HIGH_WORKING_PIVOT_NOT_CALIBRATED" });
    }
    const lookbackBars = Math.max(2, Math.round(finite(policy.lookbackBars) ?? 6));
    const before = rows.slice(Math.max(0, pivotIndex - lookbackBars), pivotIndex);
    const baseNatrPct = finite(volatilityContext?.baseNatrPct);
    if (!before.length || !(baseNatrPct > 0)) {
      return Object.freeze({ visible: true, reason: "HIGH_WORKING_PIVOT_CONTEXT_INCOMPLETE" });
    }
    const incomingReference = Math.min(...before.map((row) => row.low));
    const incomingPct = structuralPercentMove(incomingReference, pivotPrice);
    const incomingBaseNatr = incomingPct !== null ? incomingPct / baseNatrPct : null;
    if (incomingBaseNatr === null) {
      return Object.freeze({ visible: true, reason: "HIGH_WORKING_PIVOT_SCALE_UNAVAILABLE" });
    }
    const visible = incomingBaseNatr >= minimumHighIncomingBaseNatr;
    return Object.freeze({
      visible,
      reason: visible ? "HIGH_WORKING_PIVOT_PASS" : "HIGH_WORKING_PIVOT_WEAK_INCOMING_FILTERED",
      pivotAt,
      pivotPrice,
      baseNatrPct,
      incomingReference,
      incomingPct,
      incomingBaseNatr,
      minimumHighIncomingBaseNatr,
      lookbackBars,
    });
  }

  const structureLookbackBars = Math.max('''
if old_after_index not in text:
    raise SystemExit("V4.13 pivot-index anchor not found")
text = text.replace(old_after_index, new_after_index, 1)

text = text.replace(
'''  // V4.9: post-cluster local-only LOW guard. Event generation stays recall-first,
  // but a shallow pause inside a large rising impulse is memory, not a fresh
  // working support ray. This runs on the normalized visible level itself, so an
  // earlier admission bypass cannot accidentally leak it onto the chart.''',
'''  // V4.13: post-cluster local-only pivot guard. LOW keeps the V4.11
  // retracement rule; calibrated 5m HIGH now also requires a standalone incoming
  // rise. Event generation stays recall-first, and senior confluence / x2+
  // attacks have already bypassed this guard above.''',
1,
)

LEVELS.write_text(text, encoding="utf-8")

TEST.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import {
  structuralLocalWorkingSetPivotDecision,
  structuralLocalWorkingSetVisible,
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

const volatility = {
  currentPrice: 100,
  currentNatrPct: 0.20,
  baseNatrPct: 0.20,
  compressionRatio: 1,
  volatilityState: "NORMAL",
  times: [],
  natrs: [],
};

function level(price, time, extra = {}) {
  return {
    id: `5m:HIGH:${time}:${price}`,
    side: "HIGH",
    price,
    extremeAt: time,
    nativeExtremeAt: time,
    sourceTimeframe: "5m",
    sources: ["5m"],
    attackCount: 1,
    active: true,
    ...extra,
  };
}

test("V4.13 filters a 5m HIGH whose incoming rise is below 3 base NATR", () => {
  const candles = [
    candle(0, 99.82, 99.70),
    candle(1, 99.88, 99.76),
    candle(2, 99.92, 99.80),
    candle(3, 99.96, 99.84),
    candle(4, 99.99, 99.88),
    candle(5, 100.00, 99.92),
    candle(6, 100.00, 99.90),
  ];
  const target = level(100.00, candles[5].time);
  const decision = structuralLocalWorkingSetPivotDecision(target, candles, volatility);
  assert.equal(decision.visible, false);
  assert.equal(decision.reason, "HIGH_WORKING_PIVOT_WEAK_INCOMING_FILTERED");
  assert.ok(decision.incomingBaseNatr < 3);
  assert.equal(structuralLocalWorkingSetVisible(target, volatility, candles), false);
});

test("V4.13 keeps a 5m HIGH with a standalone incoming rise above 3 base NATR", () => {
  const candles = [
    candle(0, 99.30, 99.10),
    candle(1, 99.50, 99.25),
    candle(2, 99.70, 99.45),
    candle(3, 99.85, 99.65),
    candle(4, 99.95, 99.78),
    candle(5, 100.00, 99.90),
    candle(6, 100.00, 99.88),
  ];
  const target = level(100.00, candles[5].time);
  const decision = structuralLocalWorkingSetPivotDecision(target, candles, volatility);
  assert.equal(decision.visible, true);
  assert.equal(decision.reason, "HIGH_WORKING_PIVOT_PASS");
  assert.ok(decision.incomingBaseNatr >= 3);
  assert.equal(structuralLocalWorkingSetVisible(target, volatility, candles), true);
});

test("V4.13 preserves senior confluence and x2+ attack bypasses for weak HIGH", () => {
  const candles = [
    candle(0, 99.82, 99.70),
    candle(1, 99.88, 99.76),
    candle(2, 99.92, 99.80),
    candle(3, 99.96, 99.84),
    candle(4, 99.99, 99.88),
    candle(5, 100.00, 99.92),
  ];
  const weak = level(100.00, candles[5].time);
  assert.equal(structuralLocalWorkingSetPivotDecision(weak, candles, volatility).visible, false);
  assert.equal(structuralLocalWorkingSetVisible(level(100.00, candles[5].time, { sources: ["5m", "1h"] }), volatility, candles), true);
  assert.equal(structuralLocalWorkingSetVisible(level(100.00, candles[5].time, { attackCount: 2 }), volatility, candles), true);
});

test("V4.13 does not calibrate 1m HIGH yet", () => {
  const candles = [candle(0, 100, 99.9), candle(1, 100.01, 99.95)];
  const target = { ...level(100.01, candles[1].time), sourceTimeframe: "1m", sources: ["1m"] };
  const decision = structuralLocalWorkingSetPivotDecision(target, candles, volatility);
  assert.equal(decision.visible, true);
  assert.equal(decision.reason, "HIGH_WORKING_PIVOT_NOT_CALIBRATED");
});
''', encoding="utf-8")
