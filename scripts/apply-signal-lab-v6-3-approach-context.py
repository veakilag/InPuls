from pathlib import Path

context_path = Path("signal-lab-v8-level-context.js")
context = context_path.read_text(encoding="utf-8")
context_anchor = 'export const LOCAL_STRUCTURE_RESEARCH_VERSION = "v6.2-relational-shadow-2026-08";'
if context_anchor not in context:
    raise SystemExit("V6.2 context anchor not found")

approach_code = r'''
function researchMedian(values) {
  const rows = (Array.isArray(values) ? values : [])
    .map(finite)
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function researchAverage(values) {
  const rows = (Array.isArray(values) ? values : [])
    .map(finite)
    .filter((value) => value !== null);
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
}

function researchCandleValid(candle) {
  return [candle?.open, candle?.high, candle?.low, candle?.close]
    .map(finite)
    .every((value) => value !== null && value > 0);
}

function signedTargetCloseGapPct(candle, targetPrice, side) {
  const target = finite(targetPrice);
  const close = finite(candle?.close);
  if (!(target > 0) || !(close > 0)) return null;
  return side === "HIGH"
    ? (target - close) / target * 100
    : side === "LOW"
      ? (close - target) / target * 100
      : null;
}

function relevantExtremePrice(candle, side) {
  return side === "HIGH" ? finite(candle?.high) : side === "LOW" ? finite(candle?.low) : null;
}

function relevantExtremeGapPct(candle, targetPrice, side) {
  const target = finite(targetPrice);
  const extreme = relevantExtremePrice(candle, side);
  if (!(target > 0) || !(extreme > 0)) return null;
  return Math.abs(extreme - target) / target * 100;
}

function candleRangePct(candle) {
  const high = finite(candle?.high);
  const low = finite(candle?.low);
  const close = finite(candle?.close);
  if (!(high > 0) || !(low > 0) || !(close > 0)) return null;
  return (high - low) / close * 100;
}

function targetRoleRows(localStructureContext) {
  const source = [
    ["NEAREST", localStructureContext?.nearestHigh],
    ["QUALITY", localStructureContext?.strongestHigh],
    ["NEAREST", localStructureContext?.nearestLow],
    ["QUALITY", localStructureContext?.strongestLow],
  ];
  const map = new Map();
  for (const [role, row] of source) {
    const price = finite(row?.price);
    const side = row?.side;
    if (!(price > 0) || !["HIGH", "LOW"].includes(side)) continue;
    const key = `${side}:${price.toPrecision(14)}`;
    const existing = map.get(key);
    if (existing) {
      existing.roles.add(role);
      continue;
    }
    map.set(key, { row, roles: new Set([role]) });
  }
  return [...map.values()].map(({ row, roles }) => Object.freeze({
    row,
    roles: Object.freeze([...roles]),
  }));
}

function towardDeltaNatr(candles, targetPrice, side, currentNatrPct, bars) {
  if (!(currentNatrPct > 0)) return null;
  const rows = candles.slice(-Math.max(2, bars));
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

  const window = candles.slice(-lookbackBars);
  if (window.length < 2) return null;
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

  const last6 = window.slice(-6);
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
  const currentDistancePct = currentPrice > 0
    ? Math.abs(targetPrice - currentPrice) / currentPrice * 100
    : null;

  return Object.freeze({
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
    lookbackBars: window.length,
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
    nearBars3: nearFlags.slice(-3).filter(Boolean).length,
    nearBars6: nearFlags.slice(-6).filter(Boolean).length,
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
}

// V6.3 measures the path toward already identified structural boundaries.
// Positive toward/progression/compression values are descriptive evidence of
// movement toward a target, not a breakout probability or trade direction.
export function buildApproachCompressionResearchContext(candles, localStructureContext, {
  currentPrice = null,
  currentNatrPct = null,
  lookbackBars = 12,
} = {}) {
  const rows = (Array.isArray(candles) ? candles : []).filter(researchCandleValid);
  const resolvedCurrentPrice = finite(currentPrice)
    ?? finite(localStructureContext?.currentPrice)
    ?? finite(rows.at(-1)?.close);
  const resolvedCurrentNatrPct = finite(currentNatrPct)
    ?? finite(localStructureContext?.currentNatrPct);
  const resolvedLookback = Math.max(6, Math.min(36, Math.round(Number(lookbackBars) || 12)));
  if (!(resolvedCurrentPrice > 0) || !(resolvedCurrentNatrPct > 0) || rows.length < 2) {
    return Object.freeze({ state: "UNKNOWN", targets: Object.freeze([]), researchOnly: true });
  }

  const targets = targetRoleRows(localStructureContext)
    .map((targetInfo) => approachTargetResearchRow(
      rows,
      targetInfo,
      resolvedCurrentPrice,
      resolvedCurrentNatrPct,
      resolvedLookback,
    ))
    .filter(Boolean);

  return Object.freeze({
    state: targets.length ? "PATH_CONTEXT_AVAILABLE" : "NO_LOCAL_TARGETS",
    timeframe: "5m",
    currentPrice: resolvedCurrentPrice,
    currentNatrPct: round(resolvedCurrentNatrPct, 4),
    lookbackBars: Math.min(resolvedLookback, rows.length),
    targets: Object.freeze(targets),
    researchOnly: true,
  });
}

export const APPROACH_CONTEXT_RESEARCH_VERSION = "v6.3-path-shadow-2026-08";
'''
context = context.replace(context_anchor, approach_code + "\n" + context_anchor, 1)
context_path.write_text(context, encoding="utf-8")

runtime_path = Path("signal-lab-v7-multi-timeframe-review-runtime.js")
runtime = runtime_path.read_text(encoding="utf-8")
old_import = 'import { LEVEL_CONTEXT_RESEARCH_VERSION, LOCAL_STRUCTURE_RESEARCH_VERSION, buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";'
new_import = 'import { APPROACH_CONTEXT_RESEARCH_VERSION, LEVEL_CONTEXT_RESEARCH_VERSION, LOCAL_STRUCTURE_RESEARCH_VERSION, buildApproachCompressionResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";'
if old_import not in runtime:
    raise SystemExit("runtime v8 import anchor not found")
runtime = runtime.replace(old_import, new_import, 1)

formatter_anchor = 'function formatLevelResearchContextRow(row) {'
formatter_code = r'''function formatApproachResearchRow(row) {
  const map = row?.candidateState === "VISIBLE_MAP" ? "VISIBLE" : "shadow";
  const roles = Array.isArray(row?.roles) ? row.roles.join("+") : "?";
  return [
    `APPROACH ${row.side} ${roles}`,
    `target=${debugNumber(row.targetPrice, row.targetPrice >= 1000 ? 1 : 6)}`,
    `map=${map}`,
    `Q=${row.qualityScore ?? "—"} R=${row.relevanceScore ?? "—"}`,
    `dist=${debugNumber(row.currentDistancePct, 3)}%/${debugNumber(row.currentDistanceNatr, 2)}N`,
    `gap=${debugNumber(row.startGapNatr, 2)}→${debugNumber(row.endGapNatr, 2)}N`,
    `toward3/6/12=${debugNumber(row.towardDelta3Natr, 2)}/${debugNumber(row.towardDelta6Natr, 2)}/${debugNumber(row.towardDelta12Natr, 2)}N`,
    `medianCompress=${debugNumber(row.medianGapCompressionNatr, 2)}N`,
    `${row.progressionLabel === "HIGHER_FLOOR" ? "floorRise" : "ceilingDrop"}=${debugNumber(row.progressionNatr, 2)}N`,
    `near3/6/${row.lookbackBars}=${row.nearBars3}/${row.nearBars6}/${row.nearBarsWindow}`,
    `nearGroups=${row.proximityGroups}(not×N)`,
    `lastNear=${row.lastNearBarsAgo ?? "—"}b`,
    `closeBeyond=${row.closeBeyondBars}`,
    `extremeBeyond=${row.extremeBeyondBars}(not PIERCED)`,
    `range3v3=${debugNumber(row.rangeContractionRatio3v3, 2)}x`,
  ].join(" | ");
}

function formatApproachResearchContext(row) {
  if (!row || row.state === "UNKNOWN") return ["APPROACH CONTEXT | unavailable"];
  return [
    `APPROACH CONTEXT ${APPROACH_CONTEXT_RESEARCH_VERSION} · 5m PATH · RESEARCH ONLY · no breakout score`,
    ...(Array.isArray(row.targets) && row.targets.length
      ? row.targets.map(formatApproachResearchRow)
      : ["APPROACH TARGETS | none"]),
  ];
}

'''
if formatter_anchor not in runtime:
    raise SystemExit("runtime formatter anchor not found")
runtime = runtime.replace(formatter_anchor, formatter_code + formatter_anchor, 1)

old_diag = '''  window.__INPULS_LOCAL_STRUCTURE_CONTEXT__ = localStructureContext;\n  const localStructureLines = formatLocalStructureResearchContext(localStructureContext);\n  const candleTraceRows = [...buildCandleTraceRows(state)];\n  panel.textContent = [\n    `DEBUG V6.2 LOCAL STRUCTURE · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,\n    ...localStructureLines,\n'''
new_diag = '''  window.__INPULS_LOCAL_STRUCTURE_CONTEXT__ = localStructureContext;\n  const localStructureLines = formatLocalStructureResearchContext(localStructureContext);\n  const structural5mCandles = state?.candlesByTimeframe?.["5m"] ?? [];\n  const structural5mVolatility = buildStructuralVolatilityContext(structural5mCandles);\n  const approachContext = buildApproachCompressionResearchContext(structural5mCandles, localStructureContext, {\n    currentPrice: localStructureContext.currentPrice,\n    currentNatrPct: structural5mVolatility.currentNatrPct ?? localStructureContext.currentNatrPct,\n    lookbackBars: 12,\n  });\n  window.__INPULS_APPROACH_CONTEXT__ = approachContext;\n  const approachLines = formatApproachResearchContext(approachContext);\n  const candleTraceRows = [...buildCandleTraceRows(state)];\n  panel.textContent = [\n    `DEBUG V6.3 APPROACH CONTEXT · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,\n    ...localStructureLines,\n    ...approachLines,\n'''
if old_diag not in runtime:
    raise SystemExit("runtime diagnostic anchor not found")
runtime = runtime.replace(old_diag, new_diag, 1)
runtime_path.write_text(runtime, encoding="utf-8")

test_path = Path("test/signal-lab-v8-level-context.test.js")
tests = test_path.read_text(encoding="utf-8")
old_test_import = 'import { buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";'
new_test_import = 'import { buildApproachCompressionResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";'
if old_test_import not in tests:
    raise SystemExit("test import anchor not found")
tests = tests.replace(old_test_import, new_test_import, 1)

tests += r'''

test("V6.3 HIGH approach measures higher floor and shrinking target gap symmetrically without a signal score", () => {
  const path = Array.from({ length: 12 }, (_, index) => {
    const close = 100 + index * 0.75;
    return {
      time: index * STEP,
      open: close - 0.2,
      high: close + (index >= 9 ? 1.2 : 0.8),
      low: close - 1.0,
      close,
    };
  });
  const target = { id: "h", side: "HIGH", price: 109, candidateState: "SOURCE_QUALIFIED_HIDDEN", qualityScore: 60, relevanceScore: 40 };
  const structure = { currentPrice: path.at(-1).close, currentNatrPct: 2, nearestHigh: target, strongestHigh: target };
  const context = buildApproachCompressionResearchContext(path, structure, { currentNatrPct: 2, lookbackBars: 12 });
  assert.equal(context.targets.length, 1);
  const row = context.targets[0];
  assert.deepEqual(row.roles, ["NEAREST", "QUALITY"]);
  assert.ok(row.towardDelta12Natr > 0);
  assert.ok(row.progressionNatr > 0);
  assert.equal(row.progressionLabel, "HIGHER_FLOOR");
  assert.ok(row.nearBars3 >= 1);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "score"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "attackCount"), false);
});

test("V6.3 LOW approach mirrors HIGH logic with lower ceiling progression", () => {
  const path = Array.from({ length: 12 }, (_, index) => {
    const close = 100 - index * 0.75;
    return {
      time: index * STEP,
      open: close + 0.2,
      high: close + 1.0,
      low: close - (index >= 9 ? 1.2 : 0.8),
      close,
    };
  });
  const target = { id: "l", side: "LOW", price: 91, candidateState: "SOURCE_QUALIFIED_HIDDEN", qualityScore: 55, relevanceScore: 35 };
  const structure = { currentPrice: path.at(-1).close, currentNatrPct: 2, nearestLow: target, strongestLow: target };
  const context = buildApproachCompressionResearchContext(path, structure, { currentNatrPct: 2, lookbackBars: 12 });
  const row = context.targets[0];
  assert.ok(row.towardDelta12Natr > 0);
  assert.ok(row.progressionNatr > 0);
  assert.equal(row.progressionLabel, "LOWER_CEILING");
  assert.ok(row.nearBars3 >= 1);
});

test("V6.3 keeps nearest and quality targets separate when structure points to different levels", () => {
  const path = Array.from({ length: 12 }, (_, index) => ({
    time: index * STEP,
    open: 100 + index * 0.1,
    high: 101 + index * 0.1,
    low: 99 + index * 0.1,
    close: 100 + index * 0.1,
  }));
  const structure = {
    currentPrice: path.at(-1).close,
    currentNatrPct: 1.5,
    nearestHigh: { id: "near", side: "HIGH", price: 102, candidateState: "SOURCE_QUALIFIED_HIDDEN", qualityScore: 20, relevanceScore: 50 },
    strongestHigh: { id: "strong", side: "HIGH", price: 104, candidateState: "VISIBLE_MAP", qualityScore: 90, relevanceScore: 20 },
  };
  const context = buildApproachCompressionResearchContext(path, structure, { currentNatrPct: 1.5 });
  assert.equal(context.targets.length, 2);
  assert.deepEqual(context.targets.map((row) => row.roles[0]), ["NEAREST", "QUALITY"]);
  assert.equal(context.researchOnly, true);
});
'''
test_path.write_text(tests, encoding="utf-8")

print("Applied V6.3 approach/compression shadow context")
