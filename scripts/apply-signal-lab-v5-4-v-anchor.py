from pathlib import Path

levels_path = Path('signal-lab-v7-multi-timeframe-levels.js')
text = levels_path.read_text()

old_policy_start = text.index('// V5.0: trader-reviewed BICO 1m/5m showed')
old_policy_end = text.index('// V4.7 calibration:', old_policy_start)
new_policy = '''// V5.4: persistent local structure now starts at 5m. Trader-reviewed BICO\n// separated real tradable turns from trend-leg noise by a balanced V-rejection:\n// immediate arrival+departure >= 1.0 base/local NATR, sustained six-bar separation\n// >= 2.0 NATR, and no return into a narrow 0.35-NATR zone during those six bars.\n// This is a structural qualification rule, not a price prediction. Repeated attacks\n// and senior confluence remain independent evidence and bypass continuation filtering.\nexport const LOCAL_TRADABLE_STRUCTURE_POLICY = Object.freeze({\n  "5m": Object.freeze({ mode: "V_REJECTION" }),\n});\n\nexport const LOCAL_V_REJECTION_POLICY = Object.freeze({\n  "5m": Object.freeze({\n    immediateBalanceNatr: 1.00,\n    sustainedBalanceNatr: 2.00,\n    separationBars: 6,\n    zoneNatr: 0.35,\n  }),\n});\n\n'''
text = text[:old_policy_start] + new_policy + text[old_policy_end:]

marker = 'function adaptiveDistanceMultiplier(policy, distanceNatr) {'
insert_at = text.index(marker)
v_code = r'''
function structuralVReference(window, side) {
  if (!window.length) return null;
  if (side === "LOW") return Math.max(...window.map((row) => row.high));
  return Math.min(...window.map((row) => row.low));
}

function structuralVMovePct(price, reference) {
  const pivot = finite(price);
  const value = finite(reference);
  if (!(pivot > 0) || !(value > 0)) return null;
  return Math.abs(value - pivot) / pivot * 100;
}

function structuralVRejectionMetricsFromRows(
  level,
  sourceTimeframe,
  rows,
  volatilityContext,
  pivotIndex,
) {
  const policy = LOCAL_V_REJECTION_POLICY[sourceTimeframe];
  if (!policy || sourceTimeframe !== "5m") {
    return Object.freeze({ qualified: true, reason: "V_REJECTION_NOT_APPLICABLE" });
  }
  const side = level?.side;
  const price = finite(level?.price);
  const extremeAt = finite(level?.nativeExtremeAt ?? level?.extremeAt);
  if (!(side === "LOW" || side === "HIGH") || !(price > 0) || extremeAt === null || pivotIndex < 0) {
    return Object.freeze({ qualified: false, reason: "V_REJECTION_MISSING_PIVOT" });
  }

  const separationBars = Math.max(1, Math.round(finite(policy.separationBars) ?? 6));
  const before1 = rows.slice(Math.max(0, pivotIndex - 1), pivotIndex);
  const after1 = rows.slice(pivotIndex + 1, pivotIndex + 2);
  const beforeLong = rows.slice(Math.max(0, pivotIndex - separationBars), pivotIndex);
  const afterLong = rows.slice(pivotIndex + 1, pivotIndex + 1 + separationBars);
  if (!before1.length || !after1.length || afterLong.length < separationBars) {
    return Object.freeze({
      qualified: false,
      reason: "V_REJECTION_CONTEXT_INCOMPLETE",
      separationBars,
    });
  }

  const natrAtExtreme = structuralNatrAt(volatilityContext, extremeAt);
  const baseNatrPct = finite(volatilityContext?.baseNatrPct);
  const scaleNatrPct = natrAtExtreme !== null && natrAtExtreme > 0 ? natrAtExtreme : baseNatrPct;
  if (!(scaleNatrPct > 0)) {
    return Object.freeze({ qualified: false, reason: "V_REJECTION_SCALE_UNAVAILABLE" });
  }

  const normalize = (pct) => pct === null ? null : pct / scaleNatrPct;
  const incoming1Pct = structuralVMovePct(price, structuralVReference(before1, side));
  const outgoing1Pct = structuralVMovePct(price, structuralVReference(after1, side));
  const incomingLongPct = structuralVMovePct(price, structuralVReference(beforeLong, side));
  const outgoingLongPct = structuralVMovePct(price, structuralVReference(afterLong, side));
  const incoming1Natr = normalize(incoming1Pct);
  const outgoing1Natr = normalize(outgoing1Pct);
  const incomingLongNatr = normalize(incomingLongPct);
  const outgoingLongNatr = normalize(outgoingLongPct);
  const immediateBalanceNatr = incoming1Natr !== null && outgoing1Natr !== null
    ? Math.min(incoming1Natr, outgoing1Natr)
    : null;
  const sustainedBalanceNatr = incomingLongNatr !== null && outgoingLongNatr !== null
    ? Math.min(incomingLongNatr, outgoingLongNatr)
    : null;

  const zoneNatr = Math.max(0, finite(policy.zoneNatr) ?? 0.35);
  const zonePct = scaleNatrPct * zoneNatr;
  let defenseReturns = 0;
  for (const row of afterLong) {
    const touch = side === "LOW" ? finite(row?.low) : finite(row?.high);
    if (!(touch > 0)) continue;
    const distancePct = Math.abs(touch - price) / price * 100;
    if (distancePct <= zonePct) defenseReturns += 1;
  }

  const minimumImmediateBalanceNatr = Math.max(0, finite(policy.immediateBalanceNatr) ?? 1);
  const minimumSustainedBalanceNatr = Math.max(0, finite(policy.sustainedBalanceNatr) ?? 2);
  const immediatePassed = immediateBalanceNatr !== null
    && immediateBalanceNatr >= minimumImmediateBalanceNatr;
  const sustainedPassed = sustainedBalanceNatr !== null
    && sustainedBalanceNatr >= minimumSustainedBalanceNatr;
  const cleanSeparationPassed = defenseReturns === 0;
  const qualified = immediatePassed && sustainedPassed && cleanSeparationPassed;

  return Object.freeze({
    qualified,
    reason: qualified
      ? "V_REJECTION_PASS"
      : !immediatePassed
        ? "V_REJECTION_WEAK_IMMEDIATE_TURN"
        : !sustainedPassed
          ? "V_REJECTION_WEAK_SUSTAINED_SEPARATION"
          : "V_REJECTION_ZONE_RETESTED",
    side,
    price,
    extremeAt,
    scaleNatrPct,
    natrAtExtreme,
    baseNatrPct,
    incoming1Natr,
    outgoing1Natr,
    incomingLongNatr,
    outgoingLongNatr,
    immediateBalanceNatr,
    sustainedBalanceNatr,
    minimumImmediateBalanceNatr,
    minimumSustainedBalanceNatr,
    separationBars,
    zoneNatr,
    defenseReturns,
    immediatePassed,
    sustainedPassed,
    cleanSeparationPassed,
  });
}

export function structuralLocalVRejectionDecision(
  level,
  sourceTimeframe,
  candles = [],
  volatilityContext = null,
) {
  const rows = (Array.isArray(candles) ? candles : [])
    .map(validCandle)
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  const pivotAt = finite(level?.nativeExtremeAt ?? level?.extremeAt);
  const pivotIndex = rows.findIndex((row) => row.time === pivotAt);
  const context = volatilityContext ?? buildStructuralVolatilityContext(rows);
  return structuralVRejectionMetricsFromRows(level, sourceTimeframe, rows, context, pivotIndex);
}

function structuralVAnchorAcceptance(rows, startIndex, side, price, tickSize, intervalMs) {
  const tolerance = Math.max(0, finite(tickSize) ?? 0);
  let consecutive = 0;
  for (let index = startIndex; index < rows.length; index += 1) {
    const close = finite(rows[index]?.close);
    if (!(close > 0)) continue;
    const beyond = side === "LOW"
      ? close < price - tolerance
      : close > price + tolerance;
    consecutive = beyond ? consecutive + 1 : 0;
    if (consecutive >= 2) {
      return rows[index].time + intervalMs - 1;
    }
  }
  return null;
}

// Recall supplement for a specific failure mode of the alternating swing engine:
// a meaningful opposite 5m V-turn can occur inside a larger continuing leg and be
// overwritten before it becomes the engine's next alternating candidate. We scan
// closed 5m OHLC only, wait six full bars for causal separation, and emit a
// structural anchor. No 1m data or intrabar-order assumption is used.
export function buildStructuralVAnchorExtremes(
  candles,
  sourceTimeframe,
  volatilityContext = null,
  { tickSize = 0, endAt = null } = {},
) {
  if (sourceTimeframe !== "5m" || !LOCAL_V_REJECTION_POLICY[sourceTimeframe]) {
    return Object.freeze([]);
  }
  const rows = (Array.isArray(candles) ? candles : [])
    .map(validCandle)
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  if (rows.length < 8) return Object.freeze([]);
  const context = volatilityContext ?? buildStructuralVolatilityContext(rows);
  const intervalMs = STRUCTURAL_TF_INTERVAL_MS[sourceTimeframe];
  const separationBars = Math.max(
    1,
    Math.round(finite(LOCAL_V_REJECTION_POLICY[sourceTimeframe]?.separationBars) ?? 6),
  );
  const rangeEnd = finite(endAt);
  const anchors = [];

  for (let index = 1; index + separationBars < rows.length; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    const next = rows[index + 1];
    for (const side of ["LOW", "HIGH"]) {
      const price = finite(side === "LOW" ? row.low : row.high);
      if (!(price > 0)) continue;
      const localTurn = side === "LOW"
        ? price < previous.low && price <= next.low
        : price > previous.high && price >= next.high;
      if (!localTurn) continue;

      const pseudo = { side, price, extremeAt: row.time, nativeExtremeAt: row.time };
      const decision = structuralVRejectionMetricsFromRows(
        pseudo,
        sourceTimeframe,
        rows,
        context,
        index,
      );
      if (!decision.qualified) continue;

      const confirmedAt = rows[index + separationBars].time + intervalMs - 1;
      if (rangeEnd !== null && confirmedAt > rangeEnd) continue;
      const crossedAt = structuralVAnchorAcceptance(
        rows,
        index + separationBars + 1,
        side,
        price,
        tickSize,
        intervalMs,
      );
      const active = crossedAt === null || (rangeEnd !== null && crossedAt > rangeEnd);
      anchors.push(Object.freeze({
        id: `vanchor:${sourceTimeframe}:${side}:${row.time}:${price}`,
        side,
        price,
        extremeAt: row.time,
        confirmedAt,
        attackCount: 1,
        touchCount: 0,
        active,
        crossedAt: active ? null : crossedAt,
        status: active ? "CONFIRMED_ACTIVE" : "ACCEPTED",
        swingAmplitudePct: null,
        confirmingReversalPct: decision.outgoing1Natr * decision.scaleNatrPct,
        reversalThresholdPct: null,
        syntheticStructuralAnchor: true,
        structuralReason: "V_REJECTION_5M",
        vRejection: decision,
      }));
    }
  }
  return Object.freeze(anchors);
}

'''
text = text[:insert_at] + v_code + text[insert_at:]

start = text.index('export function structuralTrendLegQualificationDecision(')
end = text.index('export function filterLocalTradableStructure(', start)
new_trend = r'''export function structuralTrendLegQualificationDecision(
  level,
  previousQualifiedSameSide,
  viewTimeframe,
  candles = [],
  volatilityContext = null,
) {
  const policy = LOCAL_TRADABLE_STRUCTURE_POLICY[viewTimeframe];
  if (!policy || viewTimeframe !== "5m") {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_QUALIFICATION_NOT_APPLICABLE" });
  }
  if (!level || level.active === false || !["HIGH", "LOW"].includes(level.side)) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_INACTIVE_OR_INVALID" });
  }

  const sources = Array.isArray(level?.sources)
    ? level.sources
    : [level?.sourceTimeframe].filter(Boolean);
  const attackCount = Math.max(1, Math.round(Number(level?.attackCount) || 1));
  if (level.sourceTimeframe !== viewTimeframe || sources.length > 1 || attackCount > 1) {
    return Object.freeze({
      qualified: true,
      reason: attackCount > 1
        ? "TREND_LEG_REPEATED_ATTACK_BYPASS"
        : sources.length > 1
          ? "TREND_LEG_CONFLUENCE_BYPASS"
          : "TREND_LEG_SENIOR_BYPASS",
    });
  }

  if (!previousQualifiedSameSide || previousQualifiedSameSide.side !== level.side) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_NO_PRIOR_ANCHOR" });
  }
  if (!structuralLevelContainsTimeframe(previousQualifiedSameSide, viewTimeframe)) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_PRIOR_NOT_ON_VIEW" });
  }

  const intervalMs = STRUCTURAL_TF_INTERVAL_MS[viewTimeframe];
  const currentAt = structuralLevelTimeOnView(level, viewTimeframe);
  const priorAt = structuralLevelTimeOnView(previousQualifiedSameSide, viewTimeframe);
  const currentPrice = finite(level?.price);
  const priorPrice = finite(previousQualifiedSameSide?.price);
  if (!(intervalMs > 0) || currentAt === null || priorAt === null || currentAt <= priorAt
    || !(currentPrice > 0) || !(priorPrice > 0)) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_CONTEXT_INCOMPLETE" });
  }

  const anchorBars = (currentAt - priorAt) / intervalMs;
  const continuationSide = level.side === "LOW"
    ? currentPrice > priorPrice
    : currentPrice < priorPrice;
  if (!continuationSide) {
    return Object.freeze({
      qualified: true,
      reason: "TREND_LEG_NEW_PRICE_EXTREME_DEFERRED",
      anchorBars,
    });
  }

  const context = volatilityContext ?? buildStructuralVolatilityContext(candles);
  const vRejection = structuralLocalVRejectionDecision(
    level,
    viewTimeframe,
    candles,
    context,
  );
  return Object.freeze({
    ...vRejection,
    qualified: Boolean(vRejection.qualified),
    reason: vRejection.qualified
      ? "TREND_LEG_V_REJECTION_PASS"
      : "TREND_LEG_V_REJECTION_FILTERED",
    anchorBars,
    vRejection,
  });
}

'''
text = text[:start] + new_trend + text[end:]

start = text.index('export function filterLocalTradableStructure(')
end = text.index('function candleExtreme(', start)
new_filter = r'''export function filterLocalTradableStructure(levels, viewTimeframe, candles = []) {
  const source = Array.isArray(levels) ? levels.filter(Boolean) : [];
  if (!LOCAL_TRADABLE_STRUCTURE_POLICY[viewTimeframe]) return Object.freeze([...source]);

  const ordered = source.slice().sort((left, right) => {
    const leftAt = structuralLevelTimeOnView(left, viewTimeframe) ?? Infinity;
    const rightAt = structuralLevelTimeOnView(right, viewTimeframe) ?? Infinity;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
  });

  const volatilityContext = buildStructuralVolatilityContext(candles);
  const keptIds = new Set();
  const lastQualifiedBySide = new Map();
  for (const level of ordered) {
    const previous = lastQualifiedBySide.get(level?.side) ?? null;
    const decision = structuralTrendLegQualificationDecision(
      level,
      previous,
      viewTimeframe,
      candles,
      volatilityContext,
    );
    if (!decision.qualified) continue;
    if (level?.id) keptIds.add(level.id);
    if (structuralLevelContainsTimeframe(level, viewTimeframe) && ["HIGH", "LOW"].includes(level?.side)) {
      lastQualifiedBySide.set(level.side, level);
    }
  }

  return Object.freeze(source.filter((level) => !level?.id || keptIds.has(level.id)));
}

'''
text = text[:start] + new_filter + text[end:]

old_native = '''    const nativeCandidates = filterLocalTradableStructure(\n      rawNativeCandidates,\n      sourceTimeframe,\n      childCandles,\n    );\n'''
new_native = '''    let sourceCandidates = rawNativeCandidates;\n    if (sourceTimeframe === "5m" && childCandles.length) {\n      const vAnchors = buildStructuralVAnchorExtremes(\n        childCandles,\n        sourceTimeframe,\n        volatilityContext,\n        { tickSize, endAt },\n      );\n      const intervalMs = STRUCTURAL_TF_INTERVAL_MS[sourceTimeframe];\n      const augmented = [...sourceCandidates];\n      for (const anchor of vAnchors) {\n        if (!includeHistory && anchor.active === false) continue;\n        const level = normalizeStructuralLevel(anchor, sourceTimeframe, endAt);\n        if (!level) continue;\n        const duplicate = augmented.some((existing) => {\n          if (existing?.side !== level.side) return false;\n          const existingAt = finite(existing?.nativeExtremeAt ?? existing?.extremeAt);\n          const levelAt = finite(level?.nativeExtremeAt ?? level?.extremeAt);\n          if (existingAt === null || levelAt === null || Math.abs(existingAt - levelAt) > intervalMs) return false;\n          return samePriceZone(existing, level, {\n            tickSize,\n            tolerancePct: 0.03,\n            toleranceTicks: 3,\n          });\n        });\n        if (!duplicate) augmented.push(level);\n      }\n      sourceCandidates = augmented;\n    }\n\n    const nativeCandidates = filterLocalTradableStructure(\n      sourceCandidates,\n      sourceTimeframe,\n      childCandles,\n    );\n'''
if old_native not in text:
    raise SystemExit('native candidate insertion anchor not found')
text = text.replace(old_native, new_native, 1)
levels_path.write_text(text)

runtime_path = Path('signal-lab-v7-multi-timeframe-review-runtime.js')
runtime = runtime_path.read_text()
runtime = runtime.replace('DEBUG V5.3 SHADOW METRICS · ${state.viewTimeframe}', 'DEBUG V5.4 V-ANCHOR · ${state.viewTimeframe}', 1)
old_debug = '''    `leg=${debugNumber(row.decision?.legExtreme, row.price >= 1000 ? 1 : 6)}`,\n    `reset=${debugPercentRatio(row.decision?.resetRatio)} min=${debugPercentRatio(row.decision?.minimumLegResetRatio)}`,\n    `bars=${debugNumber(row.decision?.anchorBars, 1)}`,\n'''
new_debug = '''    `v1=${debugNumber(row.decision?.vRejection?.immediateBalanceNatr ?? row.decision?.immediateBalanceNatr, 2)}N`,\n    `v6=${debugNumber(row.decision?.vRejection?.sustainedBalanceNatr ?? row.decision?.sustainedBalanceNatr, 2)}N`,\n    `def6=${row.decision?.vRejection?.defenseReturns ?? row.decision?.defenseReturns ?? "—"}`,\n    `bars=${debugNumber(row.decision?.anchorBars, 1)}`,\n'''
if old_debug not in runtime:
    raise SystemExit('runtime V5 debug fields anchor not found')
runtime = runtime.replace(old_debug, new_debug, 1)
runtime_path.write_text(runtime)

# Replace obsolete reset-ratio regression with V5.4 contracts. 1m is chart-only.
test_path = Path('test/signal-lab-v7-tradable-structure-v5.test.js')
test_path.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStructuralVAnchorExtremes,
  structuralLocalVRejectionDecision,
  structuralTrendLegQualificationDecision,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const five = 5 * 60_000;
const candle = (index, high, low, close = (high + low) / 2) => ({
  time: index * five,
  closeTime: (index + 1) * five - 1,
  open: close,
  high,
  low,
  close,
  volume: 1,
  closed: true,
});
const level = (id, side, price, index, extra = {}) => ({
  id,
  side,
  price,
  extremeAt: index * five,
  nativeExtremeAt: index * five,
  displayAt: index * five,
  sourceTimeframe: "5m",
  sources: ["5m"],
  refinedThroughTimeframe: "5m",
  refinementPath: [{ timeframe: "5m", time: index * five }],
  active: true,
  attackCount: 1,
  ...extra,
});

function volatilityFor(candles, natr = 2) {
  return {
    baseNatrPct: natr,
    currentNatrPct: natr,
    times: candles.map((row) => row.time),
    natrs: candles.map(() => natr),
  };
}

function cleanLowCandles() {
  return [
    candle(0, 101, 97),
    candle(1, 100, 96),
    candle(2, 99, 95),
    candle(3, 98, 94),
    candle(4, 97, 93),
    candle(5, 95, 92),
    candle(6, 93, 90, 91),
    candle(7, 96, 92, 95),
    candle(8, 97, 94, 96),
    candle(9, 98, 95, 97),
    candle(10, 99, 95, 98),
    candle(11, 100, 96, 99),
    candle(12, 101, 97, 100),
    candle(13, 102, 98, 101),
  ];
}

test("V5.4 accepts a clean balanced 5m V rejection", () => {
  const candles = cleanLowCandles();
  const decision = structuralLocalVRejectionDecision(
    level("good-low", "LOW", 90, 6),
    "5m",
    candles,
    volatilityFor(candles),
  );
  assert.equal(decision.qualified, true);
  assert.equal(decision.reason, "V_REJECTION_PASS");
  assert.ok(decision.immediateBalanceNatr >= 1);
  assert.ok(decision.sustainedBalanceNatr >= 2);
  assert.equal(decision.defenseReturns, 0);
});

test("V5.4 rejects a turn that returns into the level zone", () => {
  const candles = cleanLowCandles();
  candles[9] = candle(9, 98, 90.4, 97);
  const decision = structuralLocalVRejectionDecision(
    level("retested-low", "LOW", 90, 6),
    "5m",
    candles,
    volatilityFor(candles),
  );
  assert.equal(decision.qualified, false);
  assert.equal(decision.reason, "V_REJECTION_ZONE_RETESTED");
  assert.ok(decision.defenseReturns > 0);
});

test("V5.4 rejects weak immediate V geometry even if price later runs", () => {
  const candles = cleanLowCandles();
  candles[5] = candle(5, 91, 90.5, 90.8);
  const decision = structuralLocalVRejectionDecision(
    level("weak-low", "LOW", 90, 6),
    "5m",
    candles,
    volatilityFor(candles),
  );
  assert.equal(decision.qualified, false);
  assert.equal(decision.reason, "V_REJECTION_WEAK_IMMEDIATE_TURN");
});

test("V5.4 candle scanner creates a missing 5m V anchor without 1m data", () => {
  const candles = cleanLowCandles();
  const anchors = buildStructuralVAnchorExtremes(
    candles,
    "5m",
    volatilityFor(candles),
    { tickSize: 0.01, endAt: candles.at(-1).closeTime },
  );
  const anchor = anchors.find((row) => row.side === "LOW" && row.extremeAt === 6 * five);
  assert.ok(anchor);
  assert.equal(anchor.price, 90);
  assert.equal(anchor.syntheticStructuralAnchor, true);
  assert.equal(anchor.structuralReason, "V_REJECTION_5M");
});

test("V5.4 continuation level must prove V rejection, while repeated attack bypass remains", () => {
  const candles = cleanLowCandles();
  const prior = level("prior-low", "LOW", 80, 0);
  const current = level("current-low", "LOW", 90, 6);
  const decision = structuralTrendLegQualificationDecision(
    current,
    prior,
    "5m",
    candles,
    volatilityFor(candles),
  );
  assert.equal(decision.qualified, true);
  assert.equal(decision.reason, "TREND_LEG_V_REJECTION_PASS");

  const bypass = structuralTrendLegQualificationDecision(
    { ...current, id: "x2", attackCount: 2 },
    prior,
    "5m",
    [],
    volatilityFor(candles),
  );
  assert.equal(bypass.qualified, true);
  assert.equal(bypass.reason, "TREND_LEG_REPEATED_ATTACK_BYPASS");
});

test("1m no longer runs tradable structural qualification", () => {
  const decision = structuralTrendLegQualificationDecision(
    { ...level("legacy", "LOW", 90, 6), sourceTimeframe: "1m", sources: ["1m"] },
    null,
    "1m",
    [],
  );
  assert.equal(decision.qualified, true);
  assert.equal(decision.reason, "TREND_LEG_QUALIFICATION_NOT_APPLICABLE");
});
''')
