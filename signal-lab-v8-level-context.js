import {
  STRUCTURAL_TF_INTERVAL_MS,
  buildStructuralVolatilityContext,
  structuralLocalVRejectionDecision,
} from "./signal-lab-v7-multi-timeframe-levels.js";

const FIVE_PERCENT = 5;
const BOUNDARIES = Object.freeze({
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
});

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const round = (value, digits = 2) => {
  const number = finite(value);
  if (number === null) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
};
const score = (value) => Math.round(clamp01(value) * 100);

function levelSources(level) {
  const rows = Array.isArray(level?.sources) && level.sources.length
    ? level.sources
    : [level?.sourceTimeframe].filter(Boolean);
  return [...new Set(rows.map(String))];
}


function researchLevelSemanticKey(level) {
  const side = String(level?.side ?? "?");
  const timeframe = String(level?.sourceTimeframe ?? "?");
  const at = finite(level?.nativeExtremeAt ?? level?.extremeAt ?? level?.displayAt);
  const price = finite(level?.price);
  if (at === null || !(price > 0)) return null;
  return `${side}:${timeframe}:${at}:${price.toPrecision(14)}`;
}

// V6.1 shadow architecture: context research must be able to inspect source-
// qualified candidates that the current working-map filter hides. This does not
// change the chart or hierarchy. It only creates a deduplicated research pool.
export function mergeLevelResearchCandidatePool(visibleLevels, hiddenCandidates) {
  const visible = (Array.isArray(visibleLevels) ? visibleLevels : []).filter(Boolean);
  const hidden = (Array.isArray(hiddenCandidates) ? hiddenCandidates : []).filter(Boolean);
  const visibleIds = new Set();
  const semanticKeys = new Set();
  const rows = [];

  for (const level of visible) {
    if (level?.id) visibleIds.add(level.id);
    for (const id of Array.isArray(level?.memberIds) ? level.memberIds : []) {
      if (id) visibleIds.add(id);
    }
    const key = researchLevelSemanticKey(level);
    if (key) semanticKeys.add(key);
    rows.push(Object.freeze({ ...level, researchCandidateState: "VISIBLE_MAP" }));
  }

  for (const candidate of hidden) {
    if (candidate?.id && visibleIds.has(candidate.id)) continue;
    const key = researchLevelSemanticKey(candidate);
    if (key && semanticKeys.has(key)) continue;
    if (candidate?.id) visibleIds.add(candidate.id);
    if (key) semanticKeys.add(key);
    rows.push(Object.freeze({ ...candidate, researchCandidateState: "SOURCE_QUALIFIED_HIDDEN" }));
  }

  return Object.freeze(rows);
}

function levelOriginAt(level) {
  return finite(level?.nativeExtremeAt ?? level?.extremeAt ?? level?.displayAt);
}

function levelAgeBars(level, endAt) {
  const originAt = levelOriginAt(level);
  const end = finite(endAt);
  const interval = STRUCTURAL_TF_INTERVAL_MS[level?.sourceTimeframe];
  if (originAt === null || end === null || !(interval > 0) || end < originAt) return null;
  return (end - originAt) / interval;
}

function priceDistancePct(price, currentPrice) {
  const levelPrice = finite(price);
  const current = finite(currentPrice);
  if (!(levelPrice > 0) || !(current > 0)) return null;
  return Math.abs(levelPrice - current) / current * 100;
}

function boundaryContext(endAt) {
  const end = finite(endAt);
  if (end === null) return Object.freeze({});
  const result = {};
  for (const [label, interval] of Object.entries(BOUNDARIES)) {
    const completedAt = end + 1;
    const remainder = ((completedAt % interval) + interval) % interval;
    const remainingMs = remainder === 0 ? 0 : interval - remainder;
    const elapsedMs = remainder === 0 ? interval : remainder;
    const nearBoundaryMs = Math.min(60_000, interval * 0.10);
    result[label] = Object.freeze({
      intervalMs: interval,
      elapsedMs,
      remainingMs,
      remainingMinutes: round(remainingMs / 60_000, 2),
      phase: round(elapsedMs / interval, 3),
      nearBoundary: remainingMs <= nearBoundaryMs,
    });
  }
  return Object.freeze(result);
}

function structuralQuality(level, candles, volatilityContext) {
  const baseNatrPct = finite(volatilityContext?.baseNatrPct);
  const swingPct = finite(level?.swingAmplitudePct);
  const reversalPct = finite(level?.confirmingReversalPct);
  const components = [];

  const swingNatr = swingPct !== null && baseNatrPct > 0 ? swingPct / baseNatrPct : null;
  if (swingNatr !== null) {
    components.push(Object.freeze({
      id: "SWING",
      raw: round(swingNatr, 3),
      normalized: clamp01(swingNatr / 4),
      note: "4N=full research evidence",
    }));
  }

  const reversalNatr = reversalPct !== null && baseNatrPct > 0 ? reversalPct / baseNatrPct : null;
  if (reversalNatr !== null) {
    components.push(Object.freeze({
      id: "REVERSAL",
      raw: round(reversalNatr, 3),
      normalized: clamp01(reversalNatr / 2),
      note: "2N=full research evidence",
    }));
  }

  let vShape = null;
  if (level?.sourceTimeframe === "5m" && Array.isArray(candles) && candles.length) {
    const decision = structuralLocalVRejectionDecision(
      level,
      "5m",
      candles,
      volatilityContext,
    );
    const immediate = finite(decision?.immediateBalanceNatr);
    const sustained = finite(decision?.sustainedBalanceNatr);
    const defenseReturns = finite(decision?.defenseReturns);
    if (immediate !== null && sustained !== null && defenseReturns !== null) {
      const geometry = Math.min(clamp01(immediate / 1), clamp01(sustained / 2));
      const defense = defenseReturns === 0 ? 1 : 0;
      const normalized = geometry * defense;
      vShape = Object.freeze({
        immediateBalanceNatr: round(immediate, 3),
        sustainedBalanceNatr: round(sustained, 3),
        defenseReturns,
        qualified: Boolean(decision?.qualified),
      });
      components.push(Object.freeze({
        id: "V_SHAPE",
        raw: round(normalized, 3),
        normalized,
        note: "V5.4 geometry; returns into zone invalidate this component",
      }));
    }
  }

  const normalized = components.length
    ? components.reduce((sum, row) => sum + row.normalized, 0) / components.length
    : null;
  return Object.freeze({
    score: normalized === null ? null : score(normalized),
    state: normalized === null ? "UNKNOWN" : "RESEARCH_ONLY",
    baseNatrPct: round(baseNatrPct, 4),
    swingNatr: round(swingNatr, 3),
    reversalNatr: round(reversalNatr, 3),
    vShape,
    components: Object.freeze(components),
  });
}

function currentRelevance(level, allLevels, currentPrice) {
  const distancePct = priceDistancePct(level?.price, currentPrice);
  const sources = levelSources(level);
  const attackCount = Math.max(1, Math.round(Number(level?.attackCount) || 1));
  const confluenceCount = Math.max(1, Number(level?.confluenceCount) || sources.length || 1);

  const proximity = distancePct === null ? null : clamp01(1 - (distancePct / FIVE_PERCENT));
  const attacks = clamp01((attackCount - 1) / 2);
  const confluence = clamp01((confluenceCount - 1) / 2);

  // Price-structure-only research score. Context with ambiguous directionality
  // (density, age, time boundaries) is exposed as features but intentionally
  // not assigned a positive/negative weight until outcome data exists.
  // Current relevance is intentionally local to the product's 0-5% working
  // range. A far-away historical level may have excellent structural quality,
  // repeated attacks or confluence, but it is not relevant NOW merely because
  // of those properties. Quality remains available separately.
  const inFivePercentWindow = distancePct !== null ? distancePct <= FIVE_PERCENT : null;
  const weighted = proximity === null
    ? null
    : inFivePercentWindow
      ? (0.60 * proximity) + (0.25 * attacks) + (0.15 * confluence)
      : 0;

  const active = (Array.isArray(allLevels) ? allLevels : []).filter((row) => row?.active !== false);
  const neighborRows = active.filter((row) => {
    if (row === level || row?.id === level?.id) return false;
    const distance = priceDistancePct(row?.price, level?.price);
    return distance !== null && distance <= FIVE_PERCENT;
  });
  const currentWindowRows = active.filter((row) => {
    const distance = priceDistancePct(row?.price, currentPrice);
    return distance !== null && distance <= FIVE_PERCENT;
  });

  const expectedSide = level?.side === "HIGH"
    ? finite(level?.price) >= finite(currentPrice)
    : level?.side === "LOW"
      ? finite(level?.price) <= finite(currentPrice)
      : null;

  return Object.freeze({
    score: weighted === null ? null : Math.round(weighted * 100),
    state: weighted === null ? "UNKNOWN" : "PRICE_STRUCTURE_ONLY",
    distancePct: round(distancePct, 4),
    inFivePercentWindow,
    proximityComponent: proximity === null ? null : score(proximity),
    attackComponent: score(attacks),
    confluenceComponent: score(confluence),
    attackCount,
    confluenceCount,
    sources: Object.freeze(sources),
    neighborsWithin5PctOfLevel: neighborRows.length,
    activeLevelsWithin5PctOfCurrent: currentWindowRows.length,
    expectedSideOfPrice: expectedSide,
  });
}

export function buildLevelResearchContexts(levels, {
  candlesByTimeframe = {},
  viewTimeframe = null,
  endAt = null,
  currentPrice = null,
} = {}) {
  const source = (Array.isArray(levels) ? levels : []).filter((level) => level && level.active !== false);
  const viewCandles = Array.isArray(candlesByTimeframe?.[viewTimeframe])
    ? candlesByTimeframe[viewTimeframe]
    : [];
  const resolvedCurrentPrice = finite(currentPrice)
    ?? finite(viewCandles.at(-1)?.close)
    ?? finite(source.at(-1)?.price);
  const boundaries = boundaryContext(endAt);
  const volatilityCache = new Map();

  const rows = source.map((level) => {
    const timeframe = level?.sourceTimeframe;
    const candles = Array.isArray(candlesByTimeframe?.[timeframe])
      ? candlesByTimeframe[timeframe]
      : [];
    if (!volatilityCache.has(timeframe)) {
      volatilityCache.set(timeframe, buildStructuralVolatilityContext(candles));
    }
    const volatility = volatilityCache.get(timeframe);
    const quality = structuralQuality(level, candles, volatility);
    const relevance = currentRelevance(level, source, resolvedCurrentPrice);
    return Object.freeze({
      id: level?.id ?? null,
      side: level?.side ?? null,
      price: finite(level?.price),
      candidateState: level?.researchCandidateState ?? "VISIBLE_MAP",
      sourceTimeframe: timeframe ?? null,
      sources: Object.freeze(levelSources(level)),
      attackCount: Math.max(1, Math.round(Number(level?.attackCount) || 1)),
      confluenceCount: Math.max(1, Number(level?.confluenceCount) || levelSources(level).length || 1),
      originAt: levelOriginAt(level),
      confirmedAt: finite(level?.confirmedAt),
      ageBars: round(levelAgeBars(level, endAt), 1),
      currentPrice: resolvedCurrentPrice,
      quality,
      relevance,
      timeContext: boundaries,
      coverage: Object.freeze({
        priceStructure: "AVAILABLE",
        timeBoundaries: "AVAILABLE",
        orderBookSizes: "UNAVAILABLE",
        tradeTape: "UNAVAILABLE",
        openInterest: "UNAVAILABLE",
        liquidations: "UNAVAILABLE",
        marketMemory: "UNAVAILABLE",
      }),
      researchOnly: true,
    });
  });

  return Object.freeze(rows.sort((left, right) => {
    const relevanceDelta = (right.relevance?.score ?? -1) - (left.relevance?.score ?? -1);
    if (relevanceDelta) return relevanceDelta;
    const qualityDelta = (right.quality?.score ?? -1) - (left.quality?.score ?? -1);
    if (qualityDelta) return qualityDelta;
    return (left.price ?? 0) - (right.price ?? 0);
  }));
}



function researchBoundaryRow(row, currentPrice) {
  if (!row) return null;
  const price = finite(row?.price);
  if (!(price > 0)) return null;
  return Object.freeze({
    id: row?.id ?? null,
    side: row?.side ?? null,
    price,
    distancePct: round(priceDistancePct(price, currentPrice), 4),
    qualityScore: finite(row?.quality?.score),
    relevanceScore: finite(row?.relevance?.score),
    candidateState: row?.candidateState ?? "VISIBLE_MAP",
    sourceTimeframe: row?.sourceTimeframe ?? null,
    originAt: finite(row?.originAt),
    confirmedAt: finite(row?.confirmedAt),
    sources: Object.freeze(Array.isArray(row?.sources) ? [...row.sources] : []),
  });
}

function strongestResearchBoundary(rows, currentPrice) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((left, right) => {
      const qualityDelta = (finite(right?.quality?.score) ?? -1) - (finite(left?.quality?.score) ?? -1);
      if (qualityDelta) return qualityDelta;
      const relevanceDelta = (finite(right?.relevance?.score) ?? -1) - (finite(left?.relevance?.score) ?? -1);
      if (relevanceDelta) return relevanceDelta;
      return (priceDistancePct(left?.price, currentPrice) ?? Infinity)
        - (priceDistancePct(right?.price, currentPrice) ?? Infinity);
    })[0] ?? null;
}

function bracketMetrics(lowRow, highRow, sourceRows, currentPrice, currentNatrPct) {
  const low = researchBoundaryRow(lowRow, currentPrice);
  const high = researchBoundaryRow(highRow, currentPrice);
  if (!low || !high || !(high.price > low.price) || !(currentPrice > 0)) return null;
  const widthPct = (high.price - low.price) / currentPrice * 100;
  const position = (currentPrice - low.price) / (high.price - low.price);
  const contained = (Array.isArray(sourceRows) ? sourceRows : []).filter((row) => {
    const price = finite(row?.price);
    return price !== null && price >= low.price && price <= high.price;
  });
  return Object.freeze({
    low,
    high,
    widthPct: round(widthPct, 4),
    widthNatr: currentNatrPct > 0 ? round(widthPct / currentNatrPct, 3) : null,
    currentPosition: round(position, 4),
    containedLevels: contained.length,
    visibleLevels: contained.filter((row) => row?.candidateState === "VISIBLE_MAP").length,
    shadowLevels: contained.filter((row) => row?.candidateState !== "VISIBLE_MAP").length,
  });
}

export function buildLocalStructureResearchContext(levelContexts, {
  currentPrice = null,
  currentNatrPct = null,
} = {}) {
  const all = (Array.isArray(levelContexts) ? levelContexts : [])
    .filter((row) => row && finite(row?.price) > 0);
  const resolvedCurrentPrice = finite(currentPrice)
    ?? finite(all.find((row) => finite(row?.currentPrice) > 0)?.currentPrice);
  const resolvedCurrentNatrPct = finite(currentNatrPct);
  if (!(resolvedCurrentPrice > 0)) {
    return Object.freeze({ state: "UNKNOWN", researchOnly: true });
  }

  const local = all.filter((row) => {
    const distance = priceDistancePct(row?.price, resolvedCurrentPrice);
    return distance !== null && distance <= FIVE_PERCENT;
  });
  const highsAbove = local.filter((row) => row?.side === "HIGH" && finite(row?.price) > resolvedCurrentPrice);
  const lowsBelow = local.filter((row) => row?.side === "LOW" && finite(row?.price) < resolvedCurrentPrice);
  const sideMismatch = local.filter((row) => (
    (row?.side === "HIGH" && finite(row?.price) < resolvedCurrentPrice)
    || (row?.side === "LOW" && finite(row?.price) > resolvedCurrentPrice)
  ));

  const nearestHigh = highsAbove.slice().sort((a, b) => Number(a.price) - Number(b.price))[0] ?? null;
  const nearestLow = lowsBelow.slice().sort((a, b) => Number(b.price) - Number(a.price))[0] ?? null;
  const strongestHigh = strongestResearchBoundary(highsAbove, resolvedCurrentPrice);
  const strongestLow = strongestResearchBoundary(lowsBelow, resolvedCurrentPrice);
  const within = (pct) => local.filter((row) => (priceDistancePct(row?.price, resolvedCurrentPrice) ?? Infinity) <= pct).length;
  const highPrices = highsAbove.map((row) => finite(row?.price)).filter((value) => value > 0);
  const lowPrices = lowsBelow.map((row) => finite(row?.price)).filter((value) => value > 0);
  const spreadPct = (prices) => prices.length > 1
    ? (Math.max(...prices) - Math.min(...prices)) / resolvedCurrentPrice * 100
    : 0;
  const stack = (rows) => Object.freeze(rows
    .slice()
    .sort((a, b) => (priceDistancePct(a?.price, resolvedCurrentPrice) ?? Infinity) - (priceDistancePct(b?.price, resolvedCurrentPrice) ?? Infinity))
    .map((row) => researchBoundaryRow(row, resolvedCurrentPrice))
    .filter(Boolean));

  return Object.freeze({
    state: local.length ? "LOCAL_STRUCTURE_AVAILABLE" : "EMPTY_LOCAL_WINDOW",
    currentPrice: resolvedCurrentPrice,
    currentNatrPct: round(resolvedCurrentNatrPct, 4),
    windowPct: FIVE_PERCENT,
    counts: Object.freeze({
      within1Pct: within(1),
      within2Pct: within(2),
      within5Pct: local.length,
      highsAbove: highsAbove.length,
      lowsBelow: lowsBelow.length,
      sideMismatch: sideMismatch.length,
      visible: local.filter((row) => row?.candidateState === "VISIBLE_MAP").length,
      shadow: local.filter((row) => row?.candidateState !== "VISIBLE_MAP").length,
    }),
    nearestBracket: bracketMetrics(nearestLow, nearestHigh, local, resolvedCurrentPrice, resolvedCurrentNatrPct),
    strongestBracket: bracketMetrics(strongestLow, strongestHigh, local, resolvedCurrentPrice, resolvedCurrentNatrPct),
    nearestLow: researchBoundaryRow(nearestLow, resolvedCurrentPrice),
    nearestHigh: researchBoundaryRow(nearestHigh, resolvedCurrentPrice),
    strongestLow: researchBoundaryRow(strongestLow, resolvedCurrentPrice),
    strongestHigh: researchBoundaryRow(strongestHigh, resolvedCurrentPrice),
    highStackSpreadPct: round(spreadPct(highPrices), 4),
    lowStackSpreadPct: round(spreadPct(lowPrices), 4),
    highStack: stack(highsAbove),
    lowStack: stack(lowsBelow),
    sideMismatch: stack(sideMismatch),
    researchOnly: true,
  });
}


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

export const APPROACH_CONTEXT_RESEARCH_VERSION = "v6.3.1-causal-path-shadow-2026-08";

export const LOCAL_STRUCTURE_RESEARCH_VERSION = "v6.2-relational-shadow-2026-08";

export const LEVEL_CONTEXT_RESEARCH_VERSION = "v6.1-candidate-shadow-2026-08";
