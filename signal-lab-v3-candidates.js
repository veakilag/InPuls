export const SIGNAL_LAB_V3_FORMULA_VERSION = "signal-lab-v3-four-patterns-v1-2026-08";

export const CANDIDATE_TYPES = Object.freeze({
  KNIFE: "down_reversal_attempt",
  SHARPENING: "up_reversal_attempt",
  BREAKOUT_UP: "level_break_attempt_up",
  BREAKOUT_DOWN: "level_break_attempt_down",
  CASCADE_UP: "cascade_structure_up",
  CASCADE_DOWN: "cascade_structure_down",
  CASCADE_V4_UP: "cascade_v4_up",
  CASCADE_V4_DOWN: "cascade_v4_down",
  DOWN_REVERSAL_ATTEMPT: "down_reversal_attempt",
  UP_REVERSAL_ATTEMPT: "up_reversal_attempt",
  LEVEL_BREAK_ATTEMPT_UP: "level_break_attempt_up",
  LEVEL_BREAK_ATTEMPT_DOWN: "level_break_attempt_down",
  CASCADE_STRUCTURE_UP: "cascade_structure_up",
  CASCADE_STRUCTURE_DOWN: "cascade_structure_down",
});

export const CANDIDATE_LABELS = Object.freeze({
  [CANDIDATE_TYPES.KNIFE]: "Нож",
  [CANDIDATE_TYPES.SHARPENING]: "Заточка",
  [CANDIDATE_TYPES.BREAKOUT_UP]: "Кандидат пробоя вверх",
  [CANDIDATE_TYPES.BREAKOUT_DOWN]: "Кандидат пробоя вниз",
  [CANDIDATE_TYPES.CASCADE_UP]: "Кандидат каскада вверх",
  [CANDIDATE_TYPES.CASCADE_DOWN]: "Кандидат каскада вниз",
  [CANDIDATE_TYPES.CASCADE_V4_UP]: "Каскад V4 вверх",
  [CANDIDATE_TYPES.CASCADE_V4_DOWN]: "Каскад V4 вниз",
});

export const DEFAULT_CANDIDATE_SETTINGS = Object.freeze({
  minimumQuoteVolume24h: 100_000_000,
  minimumNatr5Percent: 1,
  minimumWarmupSeconds: 35,
  episodeCooldownMs: 45_000,
  episodeReleaseMs: 18_000,
  minimumMove15sPercent: 0.12,
  maximumMove15sPercent: 0.65,
  minimumStrongMovePercent: 0.35,
  maximumStrongMovePercent: 1.5,
  reversalLookbackMs: 75_000,
  reversalMaximumAgeMs: 25_000,
  reversalMinimumRecoveryPercent: 0.12,
  levelLookbackCandles: 40,
  levelMinimumTouches: 2,
  levelMinimumTolerancePercent: 0.08,
  levelMaximumTolerancePercent: 0.25,
  levelMinimumApproachPercent: 0.12,
  levelMaximumApproachPercent: 0.55,
  cascadeMinimumExtrema: 3,
  cascadeMinimumWidthPercent: 1,
  cascadeMaximumWidthPercent: 5,
  cascadeMinimumStepPercent: 0.04,
  minimumVolumeBoost: 1.35,
  v4MinimumQuoteVolume24h: 25_000_000,
  v4CascadeMaximumDistancePct: 3,
});

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const percentDistance = (left, right) => {
  if (!(left > 0) || !(right > 0)) return null;
  return Math.abs(left - right) / Math.min(left, right) * 100;
};

const percentChange = (current, baseline) => {
  if (!(current > 0) || !(baseline > 0)) return null;
  return (current - baseline) / baseline * 100;
};

const formatPercent = (value, digits = 2) => {
  const number = finite(value);
  return number === null ? null : `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
};

const formatCompactUsd = (value) => {
  const number = finite(value);
  if (number === null) return null;
  return `$${new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number)}`;
};

const normalizeSymbol = (value) => {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,20}USDT$/.test(symbol) ? symbol : null;
};

export function isEligibleForSignalLabV3(metrics, options = {}) {
  const settings = { ...DEFAULT_CANDIDATE_SETTINGS, ...options };
  const quoteVolume24h = finite(metrics?.quoteVolume24h) ?? 0;
  const natr5m = finite(metrics?.natr5m);
  return (
    quoteVolume24h > settings.minimumQuoteVolume24h
    && natr5m !== null
    && natr5m > settings.minimumNatr5Percent
  );
}

function dynamicThresholds(metrics, settings) {
  const natr5m = Math.max(settings.minimumNatr5Percent, finite(metrics?.natr5m) ?? 0);
  return {
    move15s: clamp(
      natr5m * 0.12,
      settings.minimumMove15sPercent,
      settings.maximumMove15sPercent,
    ),
    strongMove: clamp(
      natr5m * 0.35,
      settings.minimumStrongMovePercent,
      settings.maximumStrongMovePercent,
    ),
    levelTolerance: clamp(
      natr5m * 0.08,
      settings.levelMinimumTolerancePercent,
      settings.levelMaximumTolerancePercent,
    ),
    levelApproach: clamp(
      natr5m * 0.18,
      settings.levelMinimumApproachPercent,
      settings.levelMaximumApproachPercent,
    ),
    cascadeStep: Math.max(settings.cascadeMinimumStepPercent, natr5m * 0.05),
  };
}

function priceHistory(metrics, now, lookbackMs) {
  const start = now - lookbackMs;
  return (Array.isArray(metrics?.priceHistory) ? metrics.priceHistory : [])
    .map((point) => ({
      at: finite(point?.at ?? point?.t),
      price: finite(point?.price ?? point?.p),
    }))
    .filter((point) => point.at !== null && point.price !== null && point.price > 0 && point.at >= start)
    .sort((left, right) => left.at - right.at);
}

function reversalEvidence(metrics, now, side, thresholds, settings) {
  const points = priceHistory(metrics, now, settings.reversalLookbackMs);
  const current = finite(metrics?.price);
  if (points.length < 6 || current === null) return null;

  let extremeIndex = -1;
  let extreme = side === "down" ? Infinity : -Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const value = points[index].price;
    if ((side === "down" && value < extreme) || (side === "up" && value > extreme)) {
      extreme = value;
      extremeIndex = index;
    }
  }
  if (extremeIndex < 1) return null;

  const before = points.slice(0, extremeIndex).map((point) => point.price);
  const origin = side === "down" ? Math.max(...before) : Math.min(...before);
  const impulse = Math.abs(percentChange(extreme, origin) ?? 0);
  const recovery = Math.abs(percentChange(current, extreme) ?? 0);
  const extremeAt = points[extremeIndex].at;
  const recovered = side === "down" ? current > extreme : current < extreme;
  const minimumRecovery = Math.max(settings.reversalMinimumRecoveryPercent, impulse * 0.18);
  if (
    !recovered
    || impulse < thresholds.strongMove
    || recovery < minimumRecovery
    || now - extremeAt > settings.reversalMaximumAgeMs
  ) return null;

  return {
    impulseSide: side,
    impulsePercent: impulse,
    recoveryPercent: recovery,
    originPrice: origin,
    extremePrice: extreme,
    extremeAt,
    recoveryDurationMs: Math.max(0, now - extremeAt),
  };
}

function closedMinuteCandles(metrics, settings) {
  return (Array.isArray(metrics?.minuteCandles) ? metrics.minuteCandles : [])
    .slice(-(settings.levelLookbackCandles + 1), -1)
    .map((candle) => ({
      time: finite(candle?.time),
      open: finite(candle?.open),
      high: finite(candle?.high),
      low: finite(candle?.low),
      close: finite(candle?.close),
    }))
    .filter((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close]
      .every((value) => value !== null && value > 0));
}

function levelEvidence(metrics, side, thresholds, settings, referencePrice = finite(metrics?.price)) {
  const candles = closedMinuteCandles(metrics, settings);
  if (candles.length < 6 || referencePrice === null) return null;
  const values = candles.map((candle) => side === "up" ? candle.high : candle.low);
  const level = side === "up" ? Math.max(...values) : Math.min(...values);
  const touchRows = candles.filter((candle) => (
    percentDistance(side === "up" ? candle.high : candle.low, level) <= thresholds.levelTolerance
  ));
  if (touchRows.length < settings.levelMinimumTouches) return null;
  const distancePercent = percentChange(referencePrice, level);
  const absoluteDistance = Math.abs(distancePercent ?? Infinity);
  const approached = absoluteDistance <= thresholds.levelApproach;
  const broken = side === "up" ? referencePrice > level : referencePrice < level;
  if (!approached && !broken) return null;
  return {
    side,
    level,
    touchCount: touchRows.length,
    touchTimes: touchRows.slice(-6).map((candle) => candle.time),
    tolerancePercent: thresholds.levelTolerance,
    distancePercent,
    approached,
    broken,
    referencePrice,
  };
}

function localExtrema(candles, side) {
  const key = side === "high" ? "high" : "low";
  const rows = [];
  for (let index = 1; index < candles.length - 1; index += 1) {
    const left = candles[index - 1][key];
    const value = candles[index][key];
    const right = candles[index + 1][key];
    const matches = side === "high"
      ? value >= left && value > right
      : value <= left && value < right;
    if (matches) rows.push({ at: candles[index].time, price: value });
  }
  return rows;
}

function cascadeEvidence(metrics, side, thresholds, settings, referencePrice = finite(metrics?.price)) {
  const candles = closedMinuteCandles(metrics, settings).slice(-32);
  if (candles.length < 7 || referencePrice === null) return null;
  const extrema = localExtrema(candles, side).slice(-10);
  if (extrema.length < settings.cascadeMinimumExtrema) return null;

  let staircase = [];
  let best = [];
  for (const extreme of extrema) {
    const previous = staircase.at(-1);
    const directed = !previous || (side === "high"
      ? extreme.price > previous.price
      : extreme.price < previous.price);
    const step = previous ? percentDistance(previous.price, extreme.price) : Infinity;
    if (!previous || (directed && step >= thresholds.cascadeStep)) staircase.push(extreme);
    else staircase = [extreme];
    if (staircase.length > best.length) best = [...staircase];
  }
  if (best.length < settings.cascadeMinimumExtrema) return null;

  const prices = best.map((item) => item.price);
  const lower = Math.min(...prices);
  const upper = Math.max(...prices);
  const widthPercent = percentDistance(lower, upper);
  if (
    widthPercent === null
    || widthPercent < settings.cascadeMinimumWidthPercent
    || widthPercent > settings.cascadeMaximumWidthPercent
  ) return null;

  const nearest = best.at(-1).price;
  const broken = side === "high" ? referencePrice > nearest : referencePrice < nearest;
  const distancePercent = percentChange(referencePrice, nearest);
  if (!broken && Math.abs(distancePercent ?? Infinity) > thresholds.levelApproach) return null;
  return {
    side,
    extrema: best,
    extremaCount: best.length,
    zoneLower: lower,
    zoneUpper: upper,
    zoneWidthPercent: widthPercent,
    nearestStepPrice: nearest,
    distanceFromNearestPercent: distancePercent,
    broken,
    referencePrice,
  };
}

function marketContext(metrics) {
  const trades = metrics?.trades ?? {};
  const liquidation = metrics?.liquidation ?? {};
  return {
    quoteVolume24h: finite(metrics?.quoteVolume24h),
    natr5m: finite(metrics?.natr5m),
    move15sPercent: finite(metrics?.change15s),
    range60sPercent: finite(metrics?.range60s?.percent),
    volumeBoost: finite(metrics?.volumeBoost),
    tps: finite(trades?.tps),
    buyShare: finite(trades?.buyShare),
    liquidationTotalQuoteUsd: finite(liquidation?.total),
    bookCandidate: metrics?.bookCandidate ? { ...metrics.bookCandidate } : null,
  };
}

function contextFacts(context) {
  return [
    context.quoteVolume24h === null ? null : `объём 24ч ${formatCompactUsd(context.quoteVolume24h)}`,
    context.natr5m === null ? null : `NATR5 ${formatPercent(context.natr5m)}`,
    context.volumeBoost === null ? null : `ускорение объёма ×${context.volumeBoost.toFixed(1)}`,
    context.tps === null || context.tps <= 0 ? null : `${context.tps.toFixed(1)} сделок/с`,
  ];
}

function originLabel(origin) {
  if (origin === "level_breakout") return "пробой уровня";
  if (origin === "cascade_breakout") return "пробой каскада";
  return "сильный импульс";
}

function reversalOrigins(metrics, reversal, thresholds, settings) {
  const side = reversal.impulseSide;
  const level = levelEvidence(metrics, side, thresholds, settings, reversal.extremePrice);
  const cascade = cascadeEvidence(
    metrics,
    side === "up" ? "high" : "low",
    thresholds,
    settings,
    reversal.extremePrice,
  );
  const origins = [];
  if (level?.broken) origins.push("level_breakout");
  if (cascade?.broken) origins.push("cascade_breakout");
  if (!origins.length) origins.push("strong_impulse");
  return { origins, level, cascade };
}

function evidenceScore(parts) {
  const values = parts.filter(Number.isFinite);
  if (!values.length) return 0;
  return Math.round(clamp(values.reduce((sum, value) => sum + value, 0), 0, 100));
}

function candidate({
  metrics,
  now,
  type,
  direction,
  stage = "forming",
  evidence,
  facts,
  hypotheses,
  scoreParts,
  limitations = [],
  formulaVersion = SIGNAL_LAB_V3_FORMULA_VERSION,
}) {
  return Object.freeze({
    schemaVersion: 2,
    entity: "SignalLabCandidate",
    formulaVersion,
    symbol: normalizeSymbol(metrics?.symbol),
    candidateType: type,
    label: CANDIDATE_LABELS[type] ?? type,
    direction,
    stage,
    observedAt: now,
    price: finite(metrics?.price),
    evidenceScore: evidenceScore(scoreParts),
    evidence: Object.freeze({ ...evidence }),
    facts: Object.freeze(facts.filter(Boolean).slice(0, 8)),
    patternHypotheses: Object.freeze([...new Set(hypotheses)]),
    quality: Object.freeze({
      state: now - (finite(metrics?.updatedAt) ?? 0) <= 5_000 ? "live" : "stale",
      eligibility: Object.freeze({
        quoteVolume24h: finite(metrics?.quoteVolume24h),
        natr5m: finite(metrics?.natr5m),
        minimumQuoteVolume24h: DEFAULT_CANDIDATE_SETTINGS.minimumQuoteVolume24h,
        minimumNatr5Percent: DEFAULT_CANDIDATE_SETTINGS.minimumNatr5Percent,
      }),
      limitations: Object.freeze([...new Set([
        "candidate-not-trade-signal",
        formulaVersion === SIGNAL_LAB_V3_FORMULA_VERSION
          ? "legacy-four-pattern-collector"
          : "v4-deterministic-calibration",
        ...limitations,
      ])]),
    }),
  });
}

function detectCascadeV4Candidates(metrics, now, settings) {
  const quoteVolume24h = finite(metrics?.quoteVolume24h) ?? 0;
  if (quoteVolume24h < settings.v4MinimumQuoteVolume24h) return [];
  const events = Array.isArray(metrics?.cascadeMap?.active) ? metrics.cascadeMap.active : [];
  return events
    .filter((event) => (
      ["SETUP", "TRIGGERED", "CONFIRMED", "EXTENDED"].includes(event?.state)
      && (finite(event?.setupFeatures?.primaryDistancePct) ?? Infinity) <= settings.v4CascadeMaximumDistancePct
      && (event?.levelIds?.length ?? 0) >= 2
    ))
    .map((event) => {
      const direction = event.direction === "DOWN" ? "down" : "up";
      const state = event.state;
      const gaps = Array.isArray(event.adjacentGapPct) ? event.adjacentGapPct : [];
      const maxGap = gaps.length ? Math.max(...gaps.map((value) => finite(value) ?? 0)) : 0;
      const touchCounts = Array.isArray(event.touchCounts) ? event.touchCounts : [];
      const repeatedLevels = touchCounts.filter((count) => (finite(count) ?? 1) >= 2).length;
      const qualityLive = ["LIVE", "RECOVERED"].includes(String(event.dataQuality ?? "").toUpperCase());
      const distance = finite(event?.setupFeatures?.primaryDistancePct) ?? 0;
      const facts = [
        `${event.levelIds.length} активных уровня впереди`,
        `разрывы 0–${maxGap.toFixed(2)}% · общая ширина ${(finite(event.totalSpanPct) ?? 0).toFixed(2)}%`,
        repeatedLevels ? `${repeatedLevels} уровня имеют повторные атаки ×N` : "повторные атаки ×N пока не подтверждены",
        state === "SETUP" ? "первый уровень ещё не пройден" : `снято уровней: ${event.levelsBroken}`,
        `данные ${event.dataQuality ?? "UNKNOWN"}`,
      ];
      return candidate({
        metrics,
        now,
        type: direction === "up" ? CANDIDATE_TYPES.CASCADE_V4_UP : CANDIDATE_TYPES.CASCADE_V4_DOWN,
        direction,
        stage: state === "SETUP" ? "forming" : "triggered",
        formulaVersion: event.formulaVersion ?? metrics?.cascadeMap?.formulaVersion,
        evidence: {
          cascadeV4: event,
          cascadeState: state,
          geometricState: event.geometricState,
          levelsBroken: event.levelsBroken,
          levelIds: event.levelIds,
          levelPrices: event.levelPrices,
          adjacentGapPct: event.adjacentGapPct,
          totalSpanPct: event.totalSpanPct,
          touchCounts: event.touchCounts,
          variants: event.variants,
          setupDetectedAt: event.setupDetectedAt,
          triggeredAt: event.triggeredAt,
          confirmedAt: event.confirmedAt,
          dataQuality: event.dataQuality,
        },
        facts,
        hypotheses: ["cascade_breakout"],
        scoreParts: [
          Math.min(30, event.levelIds.length * 8),
          Math.min(18, repeatedLevels * 7),
          Math.max(0, 20 * (1 - distance / settings.v4CascadeMaximumDistancePct)),
          event.compressionType && event.compressionType !== "NO_COMPRESSION" ? 12 : 4,
          event.variants?.includes("MULTI_TIMEFRAME") ? 10 : 0,
          qualityLive ? 10 : 0,
        ],
        limitations: [
          "stops-behind-levels-are-a-microstructure-hypothesis-not-observed-orders",
          "cascade-v4-parameters-are-not-final-until-manual-validation",
          event.confirmationBlockedByDataQuality ? "confirmation-blocked-by-data-quality" : null,
        ],
      });
    });
}

export function detectExpertCandidates(metrics, now = Date.now(), options = {}) {
  const settings = { ...DEFAULT_CANDIDATE_SETTINGS, ...options };
  const symbol = normalizeSymbol(metrics?.symbol);
  const price = finite(metrics?.price);
  const warmupSeconds = finite(metrics?.warmupSeconds) ?? 0;
  if (
    !symbol
    || price === null
    || price <= 0
    || warmupSeconds < settings.minimumWarmupSeconds
  ) return [];

  const result = detectCascadeV4Candidates(metrics, now, settings);
  if (!isEligibleForSignalLabV3(metrics, settings)) {
    return result.sort((left, right) => right.evidenceScore - left.evidenceScore);
  }
  const thresholds = dynamicThresholds(metrics, settings);
  const context = marketContext(metrics);
  const contextRows = contextFacts(context);

  for (const side of ["up", "down"]) {
    const level = levelEvidence(metrics, side, thresholds, settings);
    if (!level) continue;
    const direction = side;
    result.push(candidate({
      metrics,
      now,
      type: side === "up" ? CANDIDATE_TYPES.BREAKOUT_UP : CANDIDATE_TYPES.BREAKOUT_DOWN,
      direction,
      stage: level.broken ? "triggered" : "forming",
      evidence: {
        ...context,
        ...level,
        possibleReactionPattern: side === "up" ? "sharpening_rejection" : "knife_reclaim",
      },
      facts: [
        `${level.touchCount} касания уровня`,
        `уровень ${level.level}`,
        `${level.broken ? "уровень пробит" : "до уровня"} ${formatPercent(level.distancePercent)}`,
        ...contextRows,
      ],
      hypotheses: ["level_breakout"],
      scoreParts: [
        clamp(level.touchCount / settings.levelMinimumTouches, 0, 2) * 18,
        clamp(1 - Math.min(Math.abs(level.distancePercent ?? 1) / thresholds.levelApproach, 1), 0, 1) * 18,
        level.broken ? 20 : 8,
        clamp((context.volumeBoost ?? 0) / settings.minimumVolumeBoost, 0, 2) * 8,
      ],
      limitations: [
        "touches-are-geometric-evidence-not-proof-of-stop-liquidity",
        "after-breakout-reversal-may-form-knife-or-sharpening",
      ],
    }));
  }

  for (const side of ["high", "low"]) {
    const cascade = cascadeEvidence(metrics, side, thresholds, settings);
    if (!cascade) continue;
    const direction = side === "high" ? "up" : "down";
    result.push(candidate({
      metrics,
      now,
      type: direction === "up" ? CANDIDATE_TYPES.CASCADE_UP : CANDIDATE_TYPES.CASCADE_DOWN,
      direction,
      stage: cascade.broken ? "triggered" : "forming",
      evidence: {
        ...context,
        ...cascade,
        possibleReactionPattern: direction === "up" ? "sharpening_rejection" : "knife_reclaim",
      },
      facts: [
        `${cascade.extremaCount} последовательных экстремума`,
        `ширина конструкции ${formatPercent(cascade.zoneWidthPercent)}`,
        `${cascade.broken ? "ступень пробита" : "до ступени"} ${formatPercent(cascade.distanceFromNearestPercent)}`,
        ...contextRows,
      ],
      hypotheses: ["cascade_breakout"],
      scoreParts: [
        clamp(cascade.extremaCount / settings.cascadeMinimumExtrema, 0, 2) * 22,
        clamp(cascade.zoneWidthPercent / settings.cascadeMinimumWidthPercent, 0, 2) * 10,
        cascade.broken ? 20 : 8,
        clamp((context.volumeBoost ?? 0) / settings.minimumVolumeBoost, 0, 2) * 6,
      ],
      limitations: [
        "extrema-zone-is-not-confirmed-stop-location",
        "follow-through-not-confirmed-at-candidate-stage",
        "after-cascade-breakout-reversal-may-form-knife-or-sharpening",
      ],
    }));
  }

  const downReversal = reversalEvidence(metrics, now, "down", thresholds, settings);
  if (downReversal) {
    const origin = reversalOrigins(metrics, downReversal, thresholds, settings);
    result.push(candidate({
      metrics,
      now,
      type: CANDIDATE_TYPES.KNIFE,
      direction: "up",
      stage: "forming",
      evidence: {
        ...context,
        ...downReversal,
        originPatterns: origin.origins,
        originLevel: origin.level,
        originCascade: origin.cascade,
      },
      facts: [
        `вынос вниз ${formatPercent(-downReversal.impulsePercent)}`,
        `выкуп от экстремума ${formatPercent(downReversal.recoveryPercent)}`,
        `реакция за ${(downReversal.recoveryDurationMs / 1_000).toFixed(1)}с`,
        `источник: ${origin.origins.map(originLabel).join(" + ")}`,
        ...contextRows,
      ],
      hypotheses: ["knife_reclaim"],
      scoreParts: [
        clamp(downReversal.impulsePercent / thresholds.strongMove, 0, 2) * 28,
        clamp(downReversal.recoveryPercent / settings.reversalMinimumRecoveryPercent, 0, 2) * 22,
        origin.origins.includes("strong_impulse") ? 5 : 15,
      ],
      limitations: ["knife-needs-flow-and-book-confirmation"],
    }));
  }

  const upReversal = reversalEvidence(metrics, now, "up", thresholds, settings);
  if (upReversal) {
    const origin = reversalOrigins(metrics, upReversal, thresholds, settings);
    result.push(candidate({
      metrics,
      now,
      type: CANDIDATE_TYPES.SHARPENING,
      direction: "down",
      stage: "forming",
      evidence: {
        ...context,
        ...upReversal,
        originPatterns: origin.origins,
        originLevel: origin.level,
        originCascade: origin.cascade,
      },
      facts: [
        `вынос вверх ${formatPercent(upReversal.impulsePercent)}`,
        `слив от экстремума ${formatPercent(-upReversal.recoveryPercent)}`,
        `реакция за ${(upReversal.recoveryDurationMs / 1_000).toFixed(1)}с`,
        `источник: ${origin.origins.map(originLabel).join(" + ")}`,
        ...contextRows,
      ],
      hypotheses: ["sharpening_rejection"],
      scoreParts: [
        clamp(upReversal.impulsePercent / thresholds.strongMove, 0, 2) * 28,
        clamp(upReversal.recoveryPercent / settings.reversalMinimumRecoveryPercent, 0, 2) * 22,
        origin.origins.includes("strong_impulse") ? 5 : 15,
      ],
      limitations: ["sharpening-needs-flow-and-book-confirmation"],
    }));
  }

  return result.sort((left, right) => right.evidenceScore - left.evidenceScore);
}

function episodeKey(candidate) {
  return `${candidate.symbol}:${candidate.candidateType}:${candidate.direction}`;
}

export class CandidateEpisodeTracker {
  constructor(options = {}) {
    this.options = { ...DEFAULT_CANDIDATE_SETTINGS, ...options };
    this.active = new Map();
    this.sequence = 0;
  }

  ingest(metricsRows, now = Date.now()) {
    const created = [];
    const updated = [];
    const seenKeys = new Set();
    for (const metrics of Array.isArray(metricsRows) ? metricsRows : []) {
      for (const item of detectExpertCandidates(metrics, now, this.options)) {
        const key = episodeKey(item);
        seenKeys.add(key);
        const existing = this.active.get(key);
        if (existing && now - existing.lastSeenAt <= this.options.episodeCooldownMs) {
          const next = Object.freeze({
            ...existing,
            lastSeenAt: now,
            observations: existing.observations + 1,
            peakEvidenceScore: Math.max(existing.peakEvidenceScore, item.evidenceScore),
            latest: item,
          });
          this.active.set(key, next);
          updated.push(next);
          continue;
        }
        this.sequence += 1;
        const id = `${item.symbol}:${item.candidateType}:${now}:${this.sequence}`;
        const episode = Object.freeze({
          schemaVersion: 2,
          entity: "SignalLabCandidateEpisode",
          id,
          episodeId: id,
          key,
          symbol: item.symbol,
          candidateType: item.candidateType,
          label: item.label,
          direction: item.direction,
          stage: item.stage,
          firstSeenAt: now,
          lastSeenAt: now,
          observations: 1,
          peakEvidenceScore: item.evidenceScore,
          latest: item,
          reviewState: "unreviewed",
        });
        this.active.set(key, episode);
        created.push(episode);
      }
    }

    const expired = [];
    for (const [key, episode] of this.active) {
      if (seenKeys.has(key)) continue;
      if (now - episode.lastSeenAt < this.options.episodeReleaseMs) continue;
      this.active.delete(key);
      expired.push(Object.freeze({ ...episode, stage: "completed", completedAt: now }));
    }
    return Object.freeze({ created, updated, expired });
  }

  status() {
    return Object.freeze({
      formulaVersion: SIGNAL_LAB_V3_FORMULA_VERSION,
      activeEpisodes: this.active.size,
      sequence: this.sequence,
    });
  }
}

export function candidateWatchScore(metrics, options = {}) {
  const settings = { ...DEFAULT_CANDIDATE_SETTINGS, ...options };
  if (!isEligibleForSignalLabV3(metrics, settings)) return Number.NEGATIVE_INFINITY;
  const move = Math.abs(finite(metrics?.change15s) ?? 0);
  const range = finite(metrics?.range60s?.percent) ?? 0;
  const boost = finite(metrics?.volumeBoost) ?? 0;
  const turnover = finite(metrics?.turnoverPerMinute) ?? 0;
  const natr5m = finite(metrics?.natr5m) ?? 0;
  return (
    move * 30
    + range * 18
    + Math.min(boost, 5) * 6
    + natr5m * 5
    + Math.max(0, Math.log10(Math.max(turnover, 1)) - 3) * 4
  );
}
