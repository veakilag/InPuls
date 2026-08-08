from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


root = Path(".")
context_path = root / "signal-lab-v8-level-context.js"
runtime_path = root / "signal-lab-v7-multi-timeframe-review-runtime.js"
test_path = root / "test/signal-lab-v8-level-context.test.js"

context = context_path.read_text()
context = replace_once(
    context,
    "      originAt: levelOriginAt(level),\n      ageBars: round(levelAgeBars(level, endAt), 1),",
    "      originAt: levelOriginAt(level),\n      confirmedAt: finite(level?.confirmedAt),\n      ageBars: round(levelAgeBars(level, endAt), 1),",
    "level context confirmedAt",
)
context = replace_once(
    context,
    "    sourceTimeframe: row?.sourceTimeframe ?? null,\n    sources: Object.freeze(Array.isArray(row?.sources) ? [...row.sources] : []),",
    "    sourceTimeframe: row?.sourceTimeframe ?? null,\n    originAt: finite(row?.originAt),\n    confirmedAt: finite(row?.confirmedAt),\n    sources: Object.freeze(Array.isArray(row?.sources) ? [...row.sources] : []),",
    "boundary timing",
)

start = context.index("function towardDeltaNatr(")
end = context.index("\n\n// V6.3 measures", start)
replacement = '''function towardDeltaNatr(candles, targetPrice, side, currentNatrPct, bars) {
  if (!(currentNatrPct > 0) || candles.length < bars) return null;
  const rows = candles.slice(-bars);
  if (rows.length < 2) return null;
  const start = signedTargetCloseGapPct(rows[0], targetPrice, side);
  const end = signedTargetCloseGapPct(rows.at(-1), targetPrice, side);
  return start === null || end === null ? null : (start - end) / currentNatrPct;
}

function approachTargetResearchRow(candles, targetInfo, currentPrice, currentNatrPct, lookbackBars) {
  const target = targetInfo?.row;
  const targetPrice = finite(target?.price);
  const side = target?.side;
  if (!(targetPrice > 0) || !["HIGH", "LOW"].includes(side)) return null;

  const requestedLookbackBars = Math.max(2, Math.round(Number(lookbackBars) || 12));
  const confirmedAt = finite(target?.confirmedAt);
  const originAt = finite(target?.originAt);
  const causalFromAt = confirmedAt !== null ? confirmedAt : originAt;
  const causalBasis = confirmedAt !== null
    ? "CONFIRMED_AT"
    : originAt !== null
      ? "ORIGIN_AT_FALLBACK"
      : "UNBOUNDED_NO_TARGET_TIME";
  const validCandles = (Array.isArray(candles) ? candles : [])
    .filter((candle) => researchCandleValid(candle) && finite(candle?.time) !== null)
    .slice()
    .sort((left, right) => finite(left?.time) - finite(right?.time));
  const causalCandles = causalFromAt === null
    ? validCandles
    : validCandles.filter((candle) => finite(candle?.time) > causalFromAt);
  const window = causalCandles.slice(-requestedLookbackBars);
  const sampleBars = window.length;
  const sampleState = sampleBars >= requestedLookbackBars
    ? "READY"
    : sampleBars >= 2
      ? "LIMITED"
      : "INSUFFICIENT";
  const currentDistancePct = currentPrice > 0
    ? Math.abs(targetPrice - currentPrice) / currentPrice * 100
    : null;
  const baseRow = {
    side,
    targetPrice,
    roles: targetInfo.roles,
    candidateState: target?.candidateState ?? "VISIBLE_MAP",
    qualityScore: finite(target?.qualityScore),
    relevanceScore: finite(target?.relevanceScore),
    currentDistancePct: round(currentDistancePct, 4),
    currentDistanceNatr: currentDistancePct !== null && currentNatrPct > 0
      ? round(currentDistancePct / currentNatrPct, 3)
      : null,
    requestedLookbackBars,
    causalBarsAvailable: causalCandles.length,
    sampleBars,
    sampleState,
    causalFromAt,
    causalBasis,
    lookbackBars: sampleBars,
  };

  if (sampleBars < 2) {
    return Object.freeze({
      ...baseRow,
      nearZoneNatr: 0.35,
      startGapNatr: null,
      endGapNatr: null,
      towardDelta3Natr: null,
      towardDelta6Natr: null,
      towardDelta12Natr: null,
      medianGapCompressionNatr: null,
      progressionNatr: null,
      progressionLabel: side === "HIGH" ? "HIGHER_FLOOR" : "LOWER_CEILING",
      nearBars3: null,
      nearBars6: null,
      nearBarsWindow: null,
      proximityGroups: null,
      lastNearBarsAgo: null,
      closeBeyondBars: null,
      extremeBeyondBars: null,
      rangeContractionRatio3v3: null,
      researchOnly: true,
    });
  }

  const gapsNatr = window.map((candle) => {
    const gap = signedTargetCloseGapPct(candle, targetPrice, side);
    return gap === null || !(currentNatrPct > 0) ? null : gap / currentNatrPct;
  });
  const startGapNatr = finite(gapsNatr[0]);
  const endGapNatr = finite(gapsNatr.at(-1));
  const half = Math.floor(window.length / 2);
  const priorMedian = half >= 2 ? researchMedian(gapsNatr.slice(0, half)) : null;
  const recentMedian = half >= 2 ? researchMedian(gapsNatr.slice(half)) : null;

  const nearZoneNatr = 0.35;
  const nearFlags = window.map((candle) => {
    const gapPct = relevantExtremeGapPct(candle, targetPrice, side);
    return gapPct !== null && currentNatrPct > 0 && gapPct / currentNatrPct <= nearZoneNatr;
  });
  let proximityGroups = 0;
  for (let index = 0; index < nearFlags.length; index += 1) {
    if (nearFlags[index] && (index === 0 || !nearFlags[index - 1])) proximityGroups += 1;
  }
  let lastNearBarsAgo = null;
  for (let index = nearFlags.length - 1; index >= 0; index -= 1) {
    if (nearFlags[index]) {
      lastNearBarsAgo = nearFlags.length - 1 - index;
      break;
    }
  }

  const recent3 = window.slice(-3);
  const prior3 = window.length >= 6 ? window.slice(-6, -3) : [];
  let progressionNatr = null;
  if (prior3.length === 3 && recent3.length === 3 && currentNatrPct > 0 && currentPrice > 0) {
    if (side === "HIGH") {
      const priorFloor = Math.min(...prior3.map((candle) => finite(candle?.low)).filter((value) => value > 0));
      const recentFloor = Math.min(...recent3.map((candle) => finite(candle?.low)).filter((value) => value > 0));
      if (priorFloor > 0 && recentFloor > 0) {
        progressionNatr = ((recentFloor - priorFloor) / currentPrice * 100) / currentNatrPct;
      }
    } else {
      const priorCeiling = Math.max(...prior3.map((candle) => finite(candle?.high)).filter((value) => value > 0));
      const recentCeiling = Math.max(...recent3.map((candle) => finite(candle?.high)).filter((value) => value > 0));
      if (priorCeiling > 0 && recentCeiling > 0) {
        progressionNatr = ((priorCeiling - recentCeiling) / currentPrice * 100) / currentNatrPct;
      }
    }
  }

  const priorRange = prior3.length === 3 ? researchAverage(prior3.map(candleRangePct)) : null;
  const recentRange = recent3.length === 3 ? researchAverage(recent3.map(candleRangePct)) : null;
  const rangeRatio = priorRange > 0 && recentRange !== null ? recentRange / priorRange : null;
  const closeBeyond = window.filter((candle) => {
    const close = finite(candle?.close);
    return side === "HIGH" ? close > targetPrice : close < targetPrice;
  }).length;
  const extremeBeyond = window.filter((candle) => {
    const extreme = relevantExtremePrice(candle, side);
    return side === "HIGH" ? extreme > targetPrice : extreme < targetPrice;
  }).length;

  return Object.freeze({
    ...baseRow,
    nearZoneNatr,
    startGapNatr: round(startGapNatr, 3),
    endGapNatr: round(endGapNatr, 3),
    towardDelta3Natr: round(towardDeltaNatr(window, targetPrice, side, currentNatrPct, 3), 3),
    towardDelta6Natr: round(towardDeltaNatr(window, targetPrice, side, currentNatrPct, 6), 3),
    towardDelta12Natr: round(towardDeltaNatr(window, targetPrice, side, currentNatrPct, 12), 3),
    medianGapCompressionNatr: priorMedian !== null && recentMedian !== null
      ? round(priorMedian - recentMedian, 3)
      : null,
    progressionNatr: round(progressionNatr, 3),
    progressionLabel: side === "HIGH" ? "HIGHER_FLOOR" : "LOWER_CEILING",
    nearBars3: sampleBars >= 3 ? nearFlags.slice(-3).filter(Boolean).length : null,
    nearBars6: sampleBars >= 6 ? nearFlags.slice(-6).filter(Boolean).length : null,
    nearBarsWindow: nearFlags.filter(Boolean).length,
    proximityGroups,
    lastNearBarsAgo,
    closeBeyondBars: closeBeyond,
    extremeBeyondBars: extremeBeyond,
    rangeContractionRatio3v3: round(rangeRatio, 3),
    // Proximity groups are deliberately NOT Attack ×N; PIERCED and lifecycle
    // semantics remain owned by the structural event engine.
    researchOnly: true,
  });
}'''
context = context[:start] + replacement + context[end:]
context = replace_once(
    context,
    'export const APPROACH_CONTEXT_RESEARCH_VERSION = "v6.3-path-shadow-2026-08";',
    'export const APPROACH_CONTEXT_RESEARCH_VERSION = "v6.3.1-causal-path-shadow-2026-08";',
    "approach version",
)
context_path.write_text(context)

runtime = runtime_path.read_text()
format_start = runtime.index("function formatApproachResearchRow(")
format_end = runtime.index("\n\nfunction formatApproachResearchContext", format_start)
format_replacement = '''function formatApproachResearchRow(row) {
  const map = row?.candidateState === "VISIBLE_MAP" ? "VISIBLE" : "shadow";
  const roles = Array.isArray(row?.roles) ? row.roles.join("+") : "?";
  const causalAt = finite(row?.causalFromAt);
  const causalAtLabel = causalAt === null ? "—" : new Date(causalAt).toISOString().slice(11, 16);
  const countOrDash = (value) => value === null || value === undefined ? "—" : value;
  return [
    `APPROACH ${row.side} ${roles}`,
    `target=${debugNumber(row.targetPrice, row.targetPrice >= 1000 ? 1 : 6)}`,
    `map=${map}`,
    `Q=${row.qualityScore ?? "—"} R=${row.relevanceScore ?? "—"}`,
    `sample=${row.sampleBars ?? 0}/${row.requestedLookbackBars ?? 12}b(${row.sampleState ?? "?"})`,
    `causal=${row.causalBasis ?? "?"}@${causalAtLabel}`,
    `dist=${debugNumber(row.currentDistancePct, 3)}%/${debugNumber(row.currentDistanceNatr, 2)}N`,
    `gap=${debugNumber(row.startGapNatr, 2)}→${debugNumber(row.endGapNatr, 2)}N`,
    `toward3/6/12=${debugNumber(row.towardDelta3Natr, 2)}/${debugNumber(row.towardDelta6Natr, 2)}/${debugNumber(row.towardDelta12Natr, 2)}N`,
    `medianCompress=${debugNumber(row.medianGapCompressionNatr, 2)}N`,
    `${row.progressionLabel === "HIGHER_FLOOR" ? "floorRise" : "ceilingDrop"}=${debugNumber(row.progressionNatr, 2)}N`,
    `near3/6/${row.sampleBars ?? 0}=${countOrDash(row.nearBars3)}/${countOrDash(row.nearBars6)}/${countOrDash(row.nearBarsWindow)}`,
    `nearGroups=${countOrDash(row.proximityGroups)}(not×N)`,
    `lastNear=${row.lastNearBarsAgo ?? "—"}b`,
    `closeBeyond=${countOrDash(row.closeBeyondBars)}`,
    `extremeBeyond=${countOrDash(row.extremeBeyondBars)}(not PIERCED)`,
    `range3v3=${debugNumber(row.rangeContractionRatio3v3, 2)}x`,
  ].join(" | ");
}'''
runtime = runtime[:format_start] + format_replacement + runtime[format_end:]
runtime = replace_once(
    runtime,
    "    `DEBUG V6.3 APPROACH CONTEXT · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}` ,",
    "    `DEBUG V6.3.1 CAUSAL APPROACH CONTEXT · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}` ,",
    "debug header spaced",
) if "    `DEBUG V6.3 APPROACH CONTEXT · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}` ," in runtime else runtime
runtime = replace_once(
    runtime,
    "    `DEBUG V6.3 APPROACH CONTEXT · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,",
    "    `DEBUG V6.3.1 CAUSAL APPROACH CONTEXT · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,",
    "debug header",
)
runtime_path.write_text(runtime)

tests = test_path.read_text()
marker = 'test("V6.3.1 causal approach excludes pre-confirmation candles and reports sample sufficiency", () => {'
if marker in tests:
    raise SystemExit("causal test already present")
tests += r'''


test("V6.3.1 causal approach excludes pre-confirmation candles and reports sample sufficiency", () => {
  const path = Array.from({ length: 8 }, (_, index) => {
    const beforeConfirmation = index <= 4;
    return {
      time: index * STEP,
      open: beforeConfirmation ? 105.2 : 100,
      high: beforeConfirmation ? 106 : 101,
      low: beforeConfirmation ? 104.8 : 99,
      close: beforeConfirmation ? 105.5 : 100,
    };
  });
  const confirmedAt = 5 * STEP - 1;
  const target = {
    id: "causal-high",
    side: "HIGH",
    price: 105,
    candidateState: "SOURCE_QUALIFIED_HIDDEN",
    qualityScore: 70,
    relevanceScore: 50,
    originAt: STEP,
    confirmedAt,
  };
  const structure = {
    currentPrice: 100,
    currentNatrPct: 1,
    nearestHigh: target,
    strongestHigh: target,
  };
  const context = buildApproachCompressionResearchContext(path, structure, {
    currentPrice: 100,
    currentNatrPct: 1,
    lookbackBars: 12,
  });
  const row = context.targets[0];
  assert.equal(row.causalBasis, "CONFIRMED_AT");
  assert.equal(row.causalFromAt, confirmedAt);
  assert.equal(row.causalBarsAvailable, 3);
  assert.equal(row.sampleBars, 3);
  assert.equal(row.requestedLookbackBars, 12);
  assert.equal(row.sampleState, "LIMITED");
  assert.equal(row.nearBars3, 0);
  assert.equal(row.nearBars6, null);
  assert.equal(row.nearBarsWindow, 0);
  assert.equal(row.proximityGroups, 0);
  assert.equal(row.closeBeyondBars, 0);
  assert.equal(row.extremeBeyondBars, 0);
  assert.equal(row.towardDelta6Natr, null);
  assert.equal(row.towardDelta12Natr, null);
});

test("V6.3.1 causal approach labels origin fallback and does not invent evidence with one bar", () => {
  const path = [
    { time: 0, open: 100, high: 101, low: 99, close: 100 },
    { time: STEP, open: 100, high: 101, low: 99, close: 100 },
    { time: 2 * STEP, open: 100, high: 101, low: 99, close: 100 },
  ];
  const target = {
    id: "origin-fallback",
    side: "HIGH",
    price: 105,
    candidateState: "VISIBLE_MAP",
    qualityScore: 80,
    relevanceScore: 40,
    originAt: STEP,
  };
  const structure = { currentPrice: 100, currentNatrPct: 1, nearestHigh: target, strongestHigh: target };
  const context = buildApproachCompressionResearchContext(path, structure, {
    currentPrice: 100,
    currentNatrPct: 1,
    lookbackBars: 12,
  });
  const row = context.targets[0];
  assert.equal(row.causalBasis, "ORIGIN_AT_FALLBACK");
  assert.equal(row.causalFromAt, STEP);
  assert.equal(row.sampleBars, 1);
  assert.equal(row.sampleState, "INSUFFICIENT");
  assert.equal(row.startGapNatr, null);
  assert.equal(row.nearBarsWindow, null);
  assert.equal(row.proximityGroups, null);
  assert.equal(row.closeBeyondBars, null);
  assert.equal(row.extremeBeyondBars, null);
});
'''
test_path.write_text(tests)

print("Applied V6.3.1 causal approach patch")
