from pathlib import Path

levels = Path('signal-lab-v7-multi-timeframe-levels.js')
text = levels.read_text()

policy_anchor = '''// V4.7 calibration: trader review on BTC 5m showed that two shallow pauses\n'''
policy = '''// V5.0: trader-reviewed BICO 1m/5m showed that a smooth directional leg can\n// generate many technically valid swing pivots that are not independently tradable\n// liquidity levels. Keep detector/history recall-first, but require a continuation-\n// side higher LOW / lower HIGH to reset a meaningful part of the preceding leg\n// before it is promoted to the working map. This is structural geometry, not a\n// price-prediction score. Repeated attacks and multi-TF confluence bypass it.\nexport const LOCAL_TRADABLE_STRUCTURE_POLICY = Object.freeze({\n  "1m": Object.freeze({ minimumLegResetRatio: 0.30, maxAnchorBars: 60 }),\n  "5m": Object.freeze({ minimumLegResetRatio: 0.30, maxAnchorBars: 24 }),\n});\n\n'''
if 'LOCAL_TRADABLE_STRUCTURE_POLICY' not in text:
    if policy_anchor not in text:
        raise SystemExit('V5 policy anchor not found')
    text = text.replace(policy_anchor, policy + policy_anchor, 1)

helper_anchor = '''function candleExtreme(candle, side) {\n'''
helper = r'''export function structuralTrendLegQualificationDecision(
  level,
  previousQualifiedSameSide,
  viewTimeframe,
  candles = [],
) {
  const policy = LOCAL_TRADABLE_STRUCTURE_POLICY[viewTimeframe];
  if (!policy || !isLocalStructuralTimeframe(viewTimeframe)) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_QUALIFICATION_NOT_APPLICABLE" });
  }
  if (!level || level.active === false || !["HIGH", "LOW"].includes(level.side)) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_INACTIVE_OR_INVALID" });
  }

  const sources = Array.isArray(level?.sources)
    ? level.sources
    : [level?.sourceTimeframe].filter(Boolean);
  const attackCount = Math.max(1, Math.round(Number(level?.attackCount) || 1));

  // Senior ownership, multi-TF confluence and repeated defence are independent
  // structural evidence. V5 must not erase them merely because a local leg is smooth.
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
  const maxAnchorBars = Math.max(1, Math.round(finite(policy.maxAnchorBars) ?? 1));
  if (anchorBars > maxAnchorBars) {
    return Object.freeze({
      qualified: true,
      reason: "TREND_LEG_ANCHOR_EXPIRED",
      anchorBars,
      maxAnchorBars,
    });
  }

  // V5.0 intentionally targets continuation-side staircases only. A new lower LOW
  // or higher HIGH is left for the next qualification stage (V-reversal/defence),
  // rather than being guessed here.
  const continuationSide = level.side === "LOW"
    ? currentPrice > priorPrice
    : currentPrice < priorPrice;
  if (!continuationSide) {
    return Object.freeze({
      qualified: true,
      reason: "TREND_LEG_NEW_PRICE_EXTREME_DEFERRED",
      anchorBars,
      maxAnchorBars,
    });
  }

  const rows = (Array.isArray(candles) ? candles : [])
    .map(validCandle)
    .filter(Boolean)
    .filter((row) => row.time > priorAt && row.time <= currentAt)
    .sort((left, right) => left.time - right.time);
  if (!rows.length) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_CANDLES_UNAVAILABLE" });
  }

  let legExtreme = null;
  let legMove = null;
  let resetMove = null;
  if (level.side === "LOW") {
    legExtreme = Math.max(...rows.map((row) => row.high));
    if (!(legExtreme > priorPrice)) {
      return Object.freeze({ qualified: true, reason: "TREND_LEG_NO_ADVANCE" });
    }
    legMove = legExtreme - priorPrice;
    resetMove = Math.max(0, legExtreme - currentPrice);
  } else {
    legExtreme = Math.min(...rows.map((row) => row.low));
    if (!(legExtreme < priorPrice)) {
      return Object.freeze({ qualified: true, reason: "TREND_LEG_NO_DECLINE" });
    }
    legMove = priorPrice - legExtreme;
    resetMove = Math.max(0, currentPrice - legExtreme);
  }

  if (!(legMove > 0)) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_ZERO_MOVE" });
  }

  const resetRatio = resetMove / legMove;
  const minimumLegResetRatio = Math.max(
    0,
    Math.min(1, finite(policy.minimumLegResetRatio) ?? 0.30),
  );
  const qualified = resetRatio >= minimumLegResetRatio;
  return Object.freeze({
    qualified,
    reason: qualified
      ? "TREND_LEG_RESET_PASS"
      : "TREND_LEG_SHALLOW_CONTINUATION_FILTERED",
    side: level.side,
    priorPrice,
    currentPrice,
    priorAt,
    currentAt,
    anchorBars,
    maxAnchorBars,
    legExtreme,
    legMove,
    resetMove,
    resetRatio,
    minimumLegResetRatio,
  });
}

export function filterLocalTradableStructure(levels, viewTimeframe, candles = []) {
  const source = Array.isArray(levels) ? levels.filter(Boolean) : [];
  if (!LOCAL_TRADABLE_STRUCTURE_POLICY[viewTimeframe]) return Object.freeze([...source]);

  const ordered = source.slice().sort((left, right) => {
    const leftAt = structuralLevelTimeOnView(left, viewTimeframe) ?? Infinity;
    const rightAt = structuralLevelTimeOnView(right, viewTimeframe) ?? Infinity;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
  });

  const keptIds = new Set();
  const lastQualifiedBySide = new Map();
  for (const level of ordered) {
    const previous = lastQualifiedBySide.get(level?.side) ?? null;
    const decision = structuralTrendLegQualificationDecision(
      level,
      previous,
      viewTimeframe,
      candles,
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
if 'structuralTrendLegQualificationDecision' not in text:
    if helper_anchor not in text:
        raise SystemExit('V5 helper anchor not found')
    text = text.replace(helper_anchor, helper + helper_anchor, 1)

old_return = '''  const shadowFilteredHierarchy = filterLocalSameSideShadow(workingHierarchy, viewTimeframe);\n  return Object.freeze(shadowFilteredHierarchy);\n}'''
new_return = '''  const shadowFilteredHierarchy = filterLocalSameSideShadow(workingHierarchy, viewTimeframe);\n  const tradableHierarchy = filterLocalTradableStructure(\n    shadowFilteredHierarchy,\n    viewTimeframe,\n    candlesByTimeframe?.[viewTimeframe] ?? [],\n  );\n  return Object.freeze(tradableHierarchy);\n}'''
if old_return not in text:
    raise SystemExit('V5 return anchor not found')
text = text.replace(old_return, new_return, 1)
levels.write_text(text)


test = Path('test/signal-lab-v7-tradable-structure-v5.test.js')
test.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";

import {
  filterLocalTradableStructure,
  structuralTrendLegQualificationDecision,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const minute = 60_000;
const level = (id, side, price, index, extra = {}) => ({
  id,
  side,
  price,
  extremeAt: index * minute,
  nativeExtremeAt: index * minute,
  displayAt: index * minute,
  sourceTimeframe: "1m",
  sources: ["1m"],
  refinedThroughTimeframe: "1m",
  refinementPath: [{ timeframe: "1m", time: index * minute }],
  active: true,
  attackCount: 1,
  ...extra,
});
const candle = (index, high, low, close = (high + low) / 2) => ({
  time: index * minute,
  high,
  low,
  close,
});

test("V5 filters shallow higher-LOW staircases inside one bullish leg", () => {
  const levels = [
    level("low-base", "LOW", 100, 0),
    level("low-step-1", "LOW", 108, 5),
    level("low-step-2", "LOW", 109, 10),
  ];
  const candles = [
    candle(1, 104, 101), candle(2, 108, 103), candle(3, 110, 106),
    candle(4, 110, 107), candle(5, 109, 108),
    candle(6, 111, 108), candle(7, 112, 109), candle(8, 112, 109),
    candle(9, 112, 109), candle(10, 111, 109),
  ];
  const result = filterLocalTradableStructure(levels, "1m", candles);
  assert.deepEqual(result.map((row) => row.id), ["low-base"]);
});

test("V5 accepts a higher LOW after a meaningful leg reset", () => {
  const prior = level("low-base", "LOW", 100, 0);
  const current = level("low-reset", "LOW", 106, 5);
  const candles = [
    candle(1, 104, 101), candle(2, 108, 103), candle(3, 110, 105),
    candle(4, 109, 106), candle(5, 108, 106),
  ];
  const decision = structuralTrendLegQualificationDecision(current, prior, "1m", candles);
  assert.equal(decision.qualified, true);
  assert.equal(decision.reason, "TREND_LEG_RESET_PASS");
  assert.ok(decision.resetRatio >= 0.30);
});

test("V5 mirrors the rule for lower HIGH staircases inside one bearish leg", () => {
  const levels = [
    level("high-base", "HIGH", 110, 0),
    level("high-step", "HIGH", 102, 5),
  ];
  const candles = [
    candle(1, 109, 106), candle(2, 107, 103), candle(3, 104, 100),
    candle(4, 103, 100), candle(5, 102, 101),
  ];
  const result = filterLocalTradableStructure(levels, "1m", candles);
  assert.deepEqual(result.map((row) => row.id), ["high-base"]);
});

test("V5 never suppresses repeated attacks or multi-TF confluence", () => {
  const levels = [
    level("low-base", "LOW", 100, 0),
    level("low-x2", "LOW", 109, 5, { attackCount: 2 }),
    level("low-confluence", "LOW", 109.5, 6, {
      sourceTimeframe: "15m",
      sources: ["15m", "1m"],
      refinementPath: [
        { timeframe: "15m", time: 0 },
        { timeframe: "1m", time: 6 * minute },
      ],
      displayAt: 6 * minute,
    }),
  ];
  const candles = [
    candle(1, 104, 101), candle(2, 108, 103), candle(3, 110, 106),
    candle(4, 110, 108), candle(5, 110, 109), candle(6, 110, 109.5),
  ];
  const result = filterLocalTradableStructure(levels, "1m", candles);
  assert.deepEqual(result.map((row) => row.id), ["low-base", "low-x2", "low-confluence"]);
});

test("V5 expires an old same-side anchor instead of connecting unrelated regimes", () => {
  const prior = level("low-old", "LOW", 100, 0);
  const current = level("low-new", "LOW", 109, 61);
  const decision = structuralTrendLegQualificationDecision(current, prior, "1m", [
    candle(60, 110, 108), candle(61, 110, 109),
  ]);
  assert.equal(decision.qualified, true);
  assert.equal(decision.reason, "TREND_LEG_ANCHOR_EXPIRED");
});
''')

doc = Path('docs/signal-lab-v7-structural-extremes-stage1.md')
doc_text = doc.read_text()
section = '''\n\n## V5.0 — tradable structure / trend-leg qualification\n\nBICO trader review exposed a separate product problem: on 1m/5m a smooth directional leg can contain many valid local swings, while only a subset are independently tradable liquidity levels. V5 keeps the detector/history recall-first and adds a working-map qualification layer.\n\nFirst rule: a continuation-side higher LOW or lower HIGH must reset at least 30% of the move from the previous qualified same-side level to the intervening leg extreme. Shallow stair-step pivots stay in event memory but do not become working-map rays. The anchor expires after 60 bars on 1m / 24 bars on 5m. Repeated attacks, senior ownership and multi-timeframe confluence bypass this filter.\n\nThis is only V5.0. New lower LOW / higher HIGH cases are intentionally deferred to the next V-reversal / defence-base qualification stage instead of being hidden by an unvalidated rule.\n'''
if '## V5.0 — tradable structure / trend-leg qualification' not in doc_text:
    doc.write_text(doc_text + section)
