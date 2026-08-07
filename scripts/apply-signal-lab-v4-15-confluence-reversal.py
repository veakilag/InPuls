from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "signal-lab-v7-multi-timeframe-levels.js"
text = TARGET.read_text(encoding="utf-8")

old_policy = '''    // attacks bypass it before this decision is evaluated.\n    minimumHighIncomingBaseNatr: 3.00,\n'''
new_policy = '''    // attacks bypass it before this decision is evaluated.\n    minimumHighIncomingBaseNatr: 3.00,\n    // V4.15: a single 5m HIGH also needs a meaningful causal confirmation\n    // reversal relative to the stable regime scale. This rejects edge/current\n    // highs that are confirmed by the tiny recall-first detector threshold on\n    // volatile alts, without using candles after confirmedAt.\n    minimumHighConfirmingReversalBaseNatr: 0.60,\n'''
if text.count(old_policy) != 1:
    raise RuntimeError(f"expected one HIGH policy block, found {text.count(old_policy)}")
text = text.replace(old_policy, new_policy, 1)

old_high = '''    const visible = incomingBaseNatr >= minimumHighIncomingBaseNatr;\n    return Object.freeze({\n      visible,\n      reason: visible ? "HIGH_WORKING_PIVOT_PASS" : "HIGH_WORKING_PIVOT_WEAK_INCOMING_FILTERED",\n      pivotAt,\n      pivotPrice,\n      baseNatrPct,\n      incomingReference,\n      incomingPct,\n      incomingBaseNatr,\n      minimumHighIncomingBaseNatr,\n      lookbackBars,\n    });\n'''
new_high = '''    const minimumHighConfirmingReversalBaseNatr = Math.max(\n      0,\n      finite(policy.minimumHighConfirmingReversalBaseNatr) ?? 0,\n    );\n    const confirmingReversalPct = finite(level?.confirmingReversalPct);\n    const confirmingReversalBaseNatr = confirmingReversalPct !== null\n      ? confirmingReversalPct / baseNatrPct\n      : null;\n    const incomingPassed = incomingBaseNatr >= minimumHighIncomingBaseNatr;\n    // Missing confirmation diagnostics keep legacy visibility. Normalized live\n    // detector levels carry confirmingReversalPct, so calibrated review/runtime\n    // levels are evaluated without inventing future candles.\n    const confirmingReversalPassed = !(minimumHighConfirmingReversalBaseNatr > 0)\n      || confirmingReversalBaseNatr === null\n      || confirmingReversalBaseNatr >= minimumHighConfirmingReversalBaseNatr;\n    const visible = incomingPassed && confirmingReversalPassed;\n    return Object.freeze({\n      visible,\n      reason: visible\n        ? "HIGH_WORKING_PIVOT_PASS"\n        : !incomingPassed\n          ? "HIGH_WORKING_PIVOT_WEAK_INCOMING_FILTERED"\n          : "HIGH_WORKING_PIVOT_WEAK_CONFIRMING_REVERSAL_FILTERED",\n      pivotAt,\n      pivotPrice,\n      baseNatrPct,\n      incomingReference,\n      incomingPct,\n      incomingBaseNatr,\n      minimumHighIncomingBaseNatr,\n      incomingPassed,\n      confirmingReversalPct,\n      confirmingReversalBaseNatr,\n      minimumHighConfirmingReversalBaseNatr,\n      confirmingReversalPassed,\n      lookbackBars,\n    });\n'''
if text.count(old_high) != 1:
    raise RuntimeError(f"expected one HIGH visibility block, found {text.count(old_high)}")
text = text.replace(old_high, new_high, 1)

old_order = '''  const pivotDecision = structuralLocalWorkingSetPivotDecision(level, candles, volatilityContext);\n  if (!pivotDecision.visible) return false;\n\n  const distanceBaseNatr = structuralDistanceBaseNatr(level?.price, volatilityContext);\n'''
new_order = '''  const pivotDecision = structuralLocalWorkingSetPivotDecision(level, candles, volatilityContext);\n  if (!pivotDecision.visible) return false;\n\n  // V4.15: child confluence is allowed to retain a VALID local pivot outside\n  // the ordinary working-area radius, but it never bypasses the pivot-quality\n  // gate above. This restores accepted 5m structure on the 1m view without\n  // reintroducing the V4.14 resurrection bug.\n  if (sources.length > 1 || Number(level?.confluenceCount) > 1) return true;\n\n  const distanceBaseNatr = structuralDistanceBaseNatr(level?.price, volatilityContext);\n'''
if text.count(old_order) != 1:
    raise RuntimeError(f"expected one pivot/distance order block, found {text.count(old_order)}")
text = text.replace(old_order, new_order, 1)
TARGET.write_text(text, encoding="utf-8")

HIGH_TEST = ROOT / "test/signal-lab-v7-high-working-pivot.test.js"
high_test = HIGH_TEST.read_text(encoding="utf-8")
high_marker = 'test("V4.15 filters a strong incoming 5m HIGH when its causal confirming reversal is below 0.60 base NATR"'
if high_marker not in high_test:
    high_test += r'''

test("V4.15 filters a strong incoming 5m HIGH when its causal confirming reversal is below 0.60 base NATR", () => {
  const candles = [
    candle(0, 99.30, 99.10),
    candle(1, 99.50, 99.25),
    candle(2, 99.70, 99.45),
    candle(3, 99.85, 99.65),
    candle(4, 99.95, 99.78),
    candle(5, 100.00, 99.90),
    candle(6, 100.00, 99.94),
  ];
  const target = level(100.00, candles[5].time, { confirmingReversalPct: 0.05 });
  const decision = structuralLocalWorkingSetPivotDecision(target, candles, volatility);
  assert.ok(decision.incomingBaseNatr >= 3);
  assert.ok(decision.confirmingReversalBaseNatr < 0.60);
  assert.equal(decision.visible, false);
  assert.equal(decision.reason, "HIGH_WORKING_PIVOT_WEAK_CONFIRMING_REVERSAL_FILTERED");
  assert.equal(structuralLocalWorkingSetVisible(target, volatility, candles), false);
});

test("V4.15 keeps a strong 5m HIGH when both incoming leg and causal confirming reversal pass", () => {
  const candles = [
    candle(0, 99.30, 99.10),
    candle(1, 99.50, 99.25),
    candle(2, 99.70, 99.45),
    candle(3, 99.85, 99.65),
    candle(4, 99.95, 99.78),
    candle(5, 100.00, 99.90),
    candle(6, 99.90, 99.75),
  ];
  const target = level(100.00, candles[5].time, { confirmingReversalPct: 0.20 });
  const decision = structuralLocalWorkingSetPivotDecision(target, candles, volatility);
  assert.ok(decision.incomingBaseNatr >= 3);
  assert.ok(decision.confirmingReversalBaseNatr >= 0.60);
  assert.equal(decision.visible, true);
  assert.equal(decision.reason, "HIGH_WORKING_PIVOT_PASS");
});
'''
HIGH_TEST.write_text(high_test, encoding="utf-8")

FRONTIER_TEST = ROOT / "test/signal-lab-v7-local-frontier.test.js"
frontier_test = FRONTIER_TEST.read_text(encoding="utf-8")
frontier_marker = 'test("V4.15 child confluence retains a pivot after quality gate even outside local distance radius"'
if frontier_marker not in frontier_test:
    frontier_test += r'''

test("V4.15 child confluence retains a pivot after quality gate even outside local distance radius", () => {
  const distantConfluent = level({
    price: 97.0,
    sourceTimeframe: "5m",
    confluenceCount: 2,
    sources: ["5m", "1m"],
  });
  assert.equal(structuralLocalWorkingSetVisible(distantConfluent, ctx), true);
});
'''
FRONTIER_TEST.write_text(frontier_test, encoding="utf-8")

NO_RES_TEST = ROOT / "test/signal-lab-v7-no-resurrection.test.js"
no_res = NO_RES_TEST.read_text(encoding="utf-8")
assert_marker = 'V4.15 ordering keeps child confluence behind pivot quality'
if assert_marker not in no_res:
    no_res += r'''

test("V4.15 ordering keeps child confluence behind pivot quality", () => {
  const weakFiveMinutePrimary = {
    side: "HIGH",
    price: 100.00,
    sourceTimeframe: "5m",
    nativeExtremeAt: 6 * STEP,
    extremeAt: 6 * STEP,
    active: true,
    attackCount: 1,
    sources: ["5m", "1m"],
    confluenceCount: 2,
    confirmingReversalPct: 0.20,
  };
  assert.equal(
    structuralLocalWorkingSetVisible(weakFiveMinutePrimary, volatilityContext, candles),
    false,
  );
});
'''
NO_RES_TEST.write_text(no_res, encoding="utf-8")
