from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


levels = "signal-lab-v7-multi-timeframe-levels.js"

replace_once(
    levels,
    '''export function structuralLocalWorkingSetVisible(level, volatilityContext) {\n  const sourceTimeframe = level?.sourceTimeframe;\n  const policy = LOCAL_WORKING_SET_POLICY[sourceTimeframe];\n  if (!policy || level?.active === false) return true;\n\n  const sources = Array.isArray(level?.sources) ? level.sources : [sourceTimeframe].filter(Boolean);\n  if (sources.length > 1 || Number(level?.confluenceCount) > 1) return true;\n  if ((Number(level?.attackCount) || 1) > 1) return true;\n\n  const distanceBaseNatr = structuralDistanceBaseNatr(level?.price, volatilityContext);\n  if (distanceBaseNatr === null) return true;\n\n  // V4.6: a distant local-only single-touch swing is memory, not an eternal\n  // working-map ray. If it is truly macro-important it must be represented by\n  // a senior timeframe, confluence, or repeated attacks. Strong local swing\n  // magnitude alone no longer bypasses the working-area radius.\n  return distanceBaseNatr <= policy.maxDistanceBaseNatr;\n}\n''',
    '''export function structuralLocalWorkingSetPivotDecision(level, candles, volatilityContext) {\n  const sourceTimeframe = level?.sourceTimeframe;\n  const policy = LOCAL_PIVOT_PROMINENCE_POLICY[sourceTimeframe];\n  if (!policy || level?.side !== "LOW") {\n    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_NOT_APPLICABLE" });\n  }\n\n  const pivotAt = finite(level?.nativeExtremeAt ?? level?.extremeAt);\n  const pivotPrice = finite(level?.price);\n  if (pivotAt === null || !(pivotPrice > 0)) {\n    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_MISSING_LEVEL_DATA" });\n  }\n\n  const rows = (Array.isArray(candles) ? candles : [])\n    .map(validCandle)\n    .filter(Boolean)\n    .sort((left, right) => left.time - right.time);\n  const pivotIndex = rows.findIndex((row) => row.time === pivotAt);\n  if (pivotIndex < 0) {\n    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_CANDLE_UNAVAILABLE" });\n  }\n\n  const structureLookbackBars = Math.max(\n    3,\n    Math.round(finite(policy.structureLookbackBars) ?? 24),\n  );\n  const structuralBefore = rows.slice(Math.max(0, pivotIndex - structureLookbackBars), pivotIndex);\n  if (structuralBefore.length < 3) {\n    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_CONTEXT_INCOMPLETE" });\n  }\n\n  let peakIndex = -1;\n  let peakPrice = null;\n  for (let index = 0; index < structuralBefore.length; index += 1) {\n    const high = finite(structuralBefore[index]?.high);\n    if (!(high > 0)) continue;\n    if (peakPrice === null || high >= peakPrice) {\n      peakPrice = high;\n      peakIndex = index;\n    }\n  }\n\n  let originLow = null;\n  if (peakIndex > 0) {\n    for (const row of structuralBefore.slice(0, peakIndex + 1)) {\n      const low = finite(row?.low);\n      if (!(low > 0)) continue;\n      if (originLow === null || low < originLow) originLow = low;\n    }\n  }\n\n  const baseNatrPct = finite(volatilityContext?.baseNatrPct);\n  const priorImpulsePct = peakPrice !== null && originLow !== null\n    ? structuralPercentMove(originLow, peakPrice)\n    : null;\n  const priorImpulseBaseNatr = priorImpulsePct !== null && baseNatrPct > 0\n    ? priorImpulsePct / baseNatrPct\n    : null;\n  const retracementRatio = peakPrice !== null && originLow !== null && peakPrice > originLow\n    ? Math.max(0, peakPrice - pivotPrice) / (peakPrice - originLow)\n    : null;\n  const minimumPriorImpulseBaseNatr = Math.max(\n    0,\n    finite(policy.minimumPriorImpulseBaseNatr) ?? 1.25,\n  );\n  const minimumRetracementRatio = Math.max(\n    0,\n    Math.min(1, finite(policy.minimumRetracementRatio) ?? 0.20),\n  );\n  const applicable = priorImpulseBaseNatr !== null\n    && priorImpulseBaseNatr >= minimumPriorImpulseBaseNatr\n    && retracementRatio !== null;\n  const visible = !applicable || retracementRatio >= minimumRetracementRatio;\n\n  return Object.freeze({\n    visible,\n    reason: visible ? "WORKING_PIVOT_PASS" : "WORKING_PIVOT_SHALLOW_RETRACEMENT_FILTERED",\n    pivotAt,\n    pivotPrice,\n    peakPrice,\n    originLow,\n    baseNatrPct,\n    priorImpulsePct,\n    priorImpulseBaseNatr,\n    retracementRatio,\n    minimumPriorImpulseBaseNatr,\n    minimumRetracementRatio,\n    applicable,\n  });\n}\n\nexport function structuralLocalWorkingSetVisible(level, volatilityContext, candles = []) {\n  const sourceTimeframe = level?.sourceTimeframe;\n  const policy = LOCAL_WORKING_SET_POLICY[sourceTimeframe];\n  if (!policy || level?.active === false) return true;\n\n  const sources = Array.isArray(level?.sources) ? level.sources : [sourceTimeframe].filter(Boolean);\n  if (sources.length > 1 || Number(level?.confluenceCount) > 1) return true;\n  if ((Number(level?.attackCount) || 1) > 1) return true;\n\n  // V4.9: post-cluster local-only LOW guard. Event generation stays recall-first,\n  // but a shallow pause inside a large rising impulse is memory, not a fresh\n  // working support ray. This runs on the normalized visible level itself, so an\n  // earlier admission bypass cannot accidentally leak it onto the chart.\n  const pivotDecision = structuralLocalWorkingSetPivotDecision(level, candles, volatilityContext);\n  if (!pivotDecision.visible) return false;\n\n  const distanceBaseNatr = structuralDistanceBaseNatr(level?.price, volatilityContext);\n  if (distanceBaseNatr === null) return true;\n\n  // V4.6: a distant local-only single-touch swing is memory, not an eternal\n  // working-map ray. If it is truly macro-important it must be represented by\n  // a senior timeframe, confluence, or repeated attacks. Strong local swing\n  // magnitude alone no longer bypasses the working-area radius.\n  return distanceBaseNatr <= policy.maxDistanceBaseNatr;\n}\n''',
)

replace_once(
    levels,
    '''  const workingHierarchy = hierarchy.filter((level) => structuralLocalWorkingSetVisible(\n    level,\n    volatilityByTimeframe[level?.sourceTimeframe],\n  ));''',
    '''  const workingHierarchy = hierarchy.filter((level) => structuralLocalWorkingSetVisible(\n    level,\n    volatilityByTimeframe[level?.sourceTimeframe],\n    candlesByTimeframe?.[level?.sourceTimeframe] ?? [],\n  ));''',
)

# Focused V4.9 regression: the two cases mirror the trader distinction: a shallow
# pause inside a rising leg is hidden from working map, while a meaningful pullback
# remains visible. The event itself is not deleted.
test_path = ROOT / "test/signal-lab-v7-working-set-pivot.test.js"
test_path.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStructuralVolatilityContext,
  structuralLocalWorkingSetPivotDecision,
  structuralLocalWorkingSetVisible,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const STEP = 5 * 60_000;

function candle(index, open, high, low, close) {
  return { time: index * STEP, closeTime: (index + 1) * STEP - 1, open, high, low, close, closed: true };
}

function level(index, price) {
  return {
    id: `5m:LOW:${index}:${price}`,
    side: "LOW",
    price,
    extremeAt: index * STEP,
    nativeExtremeAt: index * STEP,
    sourceTimeframe: "5m",
    active: true,
    attackCount: 1,
    sources: ["5m"],
    confluenceCount: 1,
  };
}

test("V4.9 hides a shallow local LOW inside a larger rising impulse", () => {
  const rows = [
    candle(0, 100.0, 100.2, 99.8, 100.1),
    candle(1, 100.1, 100.8, 100.0, 100.7),
    candle(2, 100.7, 101.6, 100.6, 101.5),
    candle(3, 101.5, 102.5, 101.4, 102.4),
    candle(4, 102.4, 103.3, 102.3, 103.2),
    candle(5, 103.2, 104.1, 103.1, 104.0),
    candle(6, 104.0, 104.2, 103.75, 103.85),
    candle(7, 103.85, 104.5, 103.8, 104.4),
  ];
  const context = buildStructuralVolatilityContext(rows, { period: 3, baseWindow: 6 });
  const target = level(6, 103.75);
  const decision = structuralLocalWorkingSetPivotDecision(target, rows, context);
  assert.equal(decision.applicable, true);
  assert.ok(decision.retracementRatio < 0.20);
  assert.equal(decision.visible, false);
  assert.equal(structuralLocalWorkingSetVisible(target, context, rows), false);
});

test("V4.9 keeps a meaningful structural LOW pullback", () => {
  const rows = [
    candle(0, 100.0, 100.2, 99.8, 100.1),
    candle(1, 100.1, 101.0, 100.0, 100.9),
    candle(2, 100.9, 102.0, 100.8, 101.9),
    candle(3, 101.9, 103.0, 101.8, 102.9),
    candle(4, 102.9, 104.0, 102.8, 103.9),
    candle(5, 103.9, 104.3, 103.7, 104.1),
    candle(6, 104.1, 104.15, 102.8, 103.0),
    candle(7, 103.0, 103.8, 102.9, 103.7),
  ];
  const context = buildStructuralVolatilityContext(rows, { period: 3, baseWindow: 6 });
  const target = level(6, 102.8);
  const decision = structuralLocalWorkingSetPivotDecision(target, rows, context);
  assert.equal(decision.applicable, true);
  assert.ok(decision.retracementRatio >= 0.20);
  assert.equal(decision.visible, true);
});

test("V4.9 never applies the LOW pivot filter to HIGH", () => {
  const rows = [candle(0, 100, 101, 99, 100), candle(1, 100, 102, 100, 101)];
  const context = buildStructuralVolatilityContext(rows, { period: 2, baseWindow: 2 });
  const high = { ...level(1, 102), side: "HIGH" };
  assert.equal(structuralLocalWorkingSetPivotDecision(high, rows, context).visible, true);
});
''', encoding="utf-8")
