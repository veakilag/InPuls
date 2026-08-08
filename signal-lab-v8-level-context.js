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
  const weighted = proximity === null
    ? null
    : (0.60 * proximity) + (0.25 * attacks) + (0.15 * confluence);

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
    inFivePercentWindow: distancePct !== null ? distancePct <= FIVE_PERCENT : null,
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
      sourceTimeframe: timeframe ?? null,
      sources: Object.freeze(levelSources(level)),
      attackCount: Math.max(1, Math.round(Number(level?.attackCount) || 1)),
      confluenceCount: Math.max(1, Number(level?.confluenceCount) || levelSources(level).length || 1),
      originAt: levelOriginAt(level),
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

export const LEVEL_CONTEXT_RESEARCH_VERSION = "v6-shadow-2026-08";
