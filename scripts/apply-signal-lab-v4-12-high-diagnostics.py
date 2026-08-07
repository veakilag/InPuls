from pathlib import Path

LEVELS = Path('signal-lab-v7-multi-timeframe-levels.js')
TEST = Path('test/signal-lab-v7-high-prominence-diagnostics.test.js')

text = LEVELS.read_text(encoding='utf-8')

old_guard = '''  const policy = LOCAL_PIVOT_PROMINENCE_POLICY[sourceTimeframe];
  if (!policy || extreme?.side !== "LOW") {
    return Object.freeze({ admitted: true, reason: extreme?.side === "HIGH" ? "HIGH_CALIBRATION_BYPASS" : "PROMINENCE_NOT_APPLICABLE" });
  }
'''
new_guard = '''  const policy = LOCAL_PIVOT_PROMINENCE_POLICY[sourceTimeframe];
  if (!policy || !["LOW", "HIGH"].includes(extreme?.side)) {
    return Object.freeze({ admitted: true, reason: "PROMINENCE_NOT_APPLICABLE" });
  }
  const isHigh = extreme?.side === "HIGH";
'''
if old_guard not in text:
    raise SystemExit('V4.12 guard anchor not found')
text = text.replace(old_guard, new_guard, 1)

for old_reason, new_reason in [
    ('return Object.freeze({ admitted: true, reason: "PROMINENCE_MISSING_EXTREME_DATA" });',
     'return Object.freeze({ admitted: true, reason: isHigh ? "HIGH_CALIBRATION_BYPASS" : "PROMINENCE_MISSING_EXTREME_DATA" });'),
    ('return Object.freeze({ admitted: true, reason: "PROMINENCE_PIVOT_CANDLE_UNAVAILABLE" });',
     'return Object.freeze({ admitted: true, reason: isHigh ? "HIGH_CALIBRATION_BYPASS" : "PROMINENCE_PIVOT_CANDLE_UNAVAILABLE" });'),
    ('return Object.freeze({ admitted: true, reason: "PROMINENCE_CONTEXT_INCOMPLETE" });',
     'return Object.freeze({ admitted: true, reason: isHigh ? "HIGH_CALIBRATION_BYPASS" : "PROMINENCE_CONTEXT_INCOMPLETE" });'),
    ('return Object.freeze({ admitted: true, reason: "PROMINENCE_SCALE_UNAVAILABLE" });',
     'return Object.freeze({ admitted: true, reason: isHigh ? "HIGH_CALIBRATION_BYPASS" : "PROMINENCE_SCALE_UNAVAILABLE" });'),
]:
    if old_reason not in text:
        raise SystemExit(f'V4.12 compatibility anchor not found: {old_reason}')
    text = text.replace(old_reason, new_reason, 1)

old_refs = '''  const incomingReference = Math.max(...before.map((row) => row.high));
  const outgoingReference = Math.max(...after.map((row) => row.high));
  const incomingPct = structuralPercentMove(incomingReference, pivotPrice);
  const outgoingPct = structuralPercentMove(pivotPrice, outgoingReference);
'''
new_refs = '''  // V4.12: HIGH remains calibration-bypassed, but calculate its causal
  // prominence diagnostics symmetrically so trader review can distinguish a
  // meaningful rejection from a tiny edge/current-price peak without changing
  // visible behavior yet.
  const incomingReference = isHigh
    ? Math.min(...before.map((row) => row.low))
    : Math.max(...before.map((row) => row.high));
  const outgoingReference = isHigh
    ? Math.min(...after.map((row) => row.low))
    : Math.max(...after.map((row) => row.high));
  const incomingPct = structuralPercentMove(incomingReference, pivotPrice);
  const outgoingPct = structuralPercentMove(pivotPrice, outgoingReference);
'''
if old_refs not in text:
    raise SystemExit('V4.12 reference anchor not found')
text = text.replace(old_refs, new_refs, 1)

anchor = '''  const incomingPassed = incomingBaseNatr >= minimumIncomingBaseNatr;
  const outgoingPassed = outgoingBaseNatr >= minimumOutgoingBaseNatr;

  // V4.8: absolute NATR prominence is not enough.'''
insert = '''  const incomingPassed = incomingBaseNatr >= minimumIncomingBaseNatr;
  const outgoingPassed = outgoingBaseNatr >= minimumOutgoingBaseNatr;

  if (isHigh) {
    return Object.freeze({
      admitted: true,
      reason: "HIGH_CALIBRATION_BYPASS",
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
    });
  }

  // V4.8: absolute NATR prominence is not enough.'''
if anchor not in text:
    raise SystemExit('V4.12 insertion anchor not found')
text = text.replace(anchor, insert, 1)
LEVELS.write_text(text, encoding='utf-8')

TEST.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport { structuralLocalPivotProminenceDecision } from "../signal-lab-v7-multi-timeframe-levels.js";\n\nconst STEP = 5 * 60_000;\nconst candle = (index, high, low, close = (high + low) / 2) => ({\n  time: index * STEP,\n  closeTime: (index + 1) * STEP - 1,\n  open: close,\n  high,\n  low,\n  close,\n  closed: true,\n});\n\nfunction context(candles, baseNatrPct = 0.20) {\n  return {\n    currentPrice: candles.at(-1)?.close ?? 100,\n    currentNatrPct: baseNatrPct,\n    baseNatrPct,\n    compressionRatio: 1,\n    volatilityState: "NORMAL",\n    times: candles.map((row) => row.time),\n    natrs: candles.map(() => baseNatrPct),\n  };\n}\n\ntest("V4.12 HIGH stays admitted but exposes causal incoming/outgoing prominence diagnostics", () => {\n  const candles = [\n    candle(0, 99.20, 98.90),\n    candle(1, 99.55, 99.10),\n    candle(2, 99.90, 99.40),\n    candle(3, 100.30, 99.80),\n    candle(4, 100.70, 100.20),\n    candle(5, 101.00, 100.55),\n    candle(6, 101.10, 100.75),\n    candle(7, 101.30, 100.95),\n    candle(8, 101.10, 100.70),\n    candle(9, 100.95, 100.55),\n  ];\n  const extreme = {\n    side: "HIGH",\n    price: 101.30,\n    extremeAt: candles[7].time,\n    confirmedAt: candles[9].time,\n  };\n  const decision = structuralLocalPivotProminenceDecision(extreme, "5m", candles, context(candles));\n  assert.equal(decision.admitted, true);\n  assert.equal(decision.reason, "HIGH_CALIBRATION_BYPASS");\n  assert.ok(Number.isFinite(decision.incomingBaseNatr) && decision.incomingBaseNatr > 0);\n  assert.ok(Number.isFinite(decision.outgoingBaseNatr) && decision.outgoingBaseNatr > 0);\n});\n''', encoding='utf-8')
