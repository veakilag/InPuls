#!/usr/bin/env bash
set -euo pipefail

cat > signal-lab-v3-candidates.js <<'EOF'
export const SIGNAL_LAB_V3_FORMULA_VERSION = "signal-lab-v3-four-patterns-v1-2026-08";

export const CANDIDATE_TYPES = Object.freeze({
  KNIFE: "down_reversal_attempt",
  SHARPENING: "up_reversal_attempt",
  BREAKOUT_UP: "level_break_attempt_up",
  BREAKOUT_DOWN: "level_break_attempt_down",
  CASCADE_UP: "cascade_structure_up",
  CASCADE_DOWN: "cascade_structure_down",
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
}) {
  return Object.freeze({
    schemaVersion: 2,
    entity: "SignalLabCandidate",
    formulaVersion: SIGNAL_LAB_V3_FORMULA_VERSION,
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
        "only-four-patterns-are-collected",
        ...limitations,
      ])]),
    }),
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
    || !isEligibleForSignalLabV3(metrics, settings)
  ) return [];

  const result = [];
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
EOF

cat > signal-lab-v3-explainer.js <<'EOF'
const HYPOTHESIS_LABELS = Object.freeze({
  knife_reclaim: "Нож",
  sharpening_rejection: "Заточка",
  level_breakout: "Пробой",
  cascade_breakout: "Каскад",
  continuation_breakout: "Продолжение вверх",
  continuation_breakdown: "Продолжение вниз",
  false_breakout: "Ложный пробой",
});

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const percent = (value) => {
  const number = finite(value);
  if (number === null) return null;
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
};

function originText(origins = []) {
  const labels = origins.map((origin) => {
    if (origin === "level_breakout") return "пробоя уровня";
    if (origin === "cascade_breakout") return "пробоя каскада";
    return "сильного импульса";
  });
  return labels.length ? labels.join(" и ") : "сильного импульса";
}

function choosePrimary(candidate) {
  const type = String(candidate?.candidateType ?? "");
  if (type === "down_reversal_attempt") return "knife_reclaim";
  if (type === "up_reversal_attempt") return "sharpening_rejection";
  if (type === "level_break_attempt_up" || type === "level_break_attempt_down") return "level_breakout";
  if (type === "cascade_structure_up" || type === "cascade_structure_down") return "cascade_breakout";
  return candidate?.patternHypotheses?.[0] ?? "level_breakout";
}

function explanationFor(candidate, primary) {
  const evidence = candidate?.evidence ?? {};
  const type = String(candidate?.candidateType ?? "");
  const reasoning = [];
  const confirmation = [];
  const invalidation = [];
  let headline = "Это предварительная гипотеза, а не готовый торговый сигнал.";
  let alternative = null;

  if (type === "down_reversal_attempt" || type === "up_reversal_attempt") {
    const knife = type === "down_reversal_attempt";
    const source = originText(Array.isArray(evidence.originPatterns) ? evidence.originPatterns : []);
    headline = knife
      ? `Я выбрал гипотезу «Нож», потому что после ${source} появился быстрый измеримый выкуп от свежего минимума.`
      : `Я выбрал гипотезу «Заточка», потому что после ${source} цена потеряла продолжение и резко вернулась от свежего максимума.`;
    const impulse = percent((knife ? -1 : 1) * (finite(evidence.impulsePercent) ?? 0));
    const recovery = percent((knife ? 1 : -1) * (finite(evidence.recoveryPercent) ?? 0));
    if (impulse) reasoning.push(`размер исходного импульса ${impulse}`);
    if (recovery) reasoning.push(`обратная реакция от экстремума ${recovery}`);
    if (finite(evidence.recoveryDurationMs) !== null) {
      reasoning.push(`реакция появилась за ${(finite(evidence.recoveryDurationMs) / 1_000).toFixed(1)} секунды`);
    }
    if (finite(evidence.natr5m) !== null) reasoning.push(`NATR5 ${finite(evidence.natr5m).toFixed(2)}%`);
    confirmation.push(knife ? "выкуп в ленте и удержание минимума" : "продавец в ленте и неспособность обновить максимум");
    confirmation.push("стаканная реакция у зоны, а не одиночный случайный тик");
    invalidation.push(knife ? "повторный пролив ниже экстремума без быстрого возврата" : "закрепление выше экстремума и продолжение выноса");
    alternative = evidence.originPatterns?.includes("cascade_breakout") ? "Продолжение пробоя каскада" : "Продолжение исходного пробоя";
  } else if (type === "level_break_attempt_up" || type === "level_break_attempt_down") {
    const upward = type.endsWith("_up");
    headline = evidence.broken
      ? "Я выбрал гипотезу «Пробой», потому что цена вышла за повторно тестируемый уровень. Это ещё кандидат: нужно доказать принятие цены за уровнем."
      : "Я выбрал кандидата «Пробой», потому что цена подошла к повторно тестируемому уровню. Самого пробоя и продолжения пока нет.";
    if (finite(evidence.touchCount) !== null) reasoning.push(`у уровня найдено ${Math.round(finite(evidence.touchCount))} касания`);
    if (finite(evidence.distancePercent) !== null) reasoning.push(`расстояние относительно уровня ${percent(evidence.distancePercent)}`);
    if (finite(evidence.natr5m) !== null) reasoning.push(`NATR5 ${finite(evidence.natr5m).toFixed(2)}%`);
    if (finite(evidence.quoteVolume24h) !== null) reasoning.push(`24-часовой оборот выше обязательного порога $100 млн`);
    confirmation.push("принятие цены за уровнем и follow-through");
    confirmation.push("либо качественный ретест с реакцией в сторону пробоя");
    invalidation.push("быстрый возврат обратно без продолжения");
    alternative = upward
      ? "После сильного выхода может сформироваться заточка"
      : "После сильного выхода может сформироваться нож";
  } else if (type === "cascade_structure_up" || type === "cascade_structure_down") {
    const upward = type.endsWith("_up");
    headline = "Я выбрал кандидата «Каскад», потому что вижу направленную цепочку минимум из трёх экстремумов, а не один случайный уровень.";
    if (finite(evidence.extremaCount) !== null) reasoning.push(`в цепочке ${Math.round(finite(evidence.extremaCount))} экстремума`);
    if (finite(evidence.zoneWidthPercent) !== null) reasoning.push(`ширина конструкции ${percent(evidence.zoneWidthPercent)}`);
    if (finite(evidence.natr5m) !== null) reasoning.push(`NATR5 ${finite(evidence.natr5m).toFixed(2)}%`);
    confirmation.push("ускорение при прохождении ближайшей ступени");
    confirmation.push("быстрое прохождение цепочки и follow-through");
    invalidation.push("возврат внутрь конструкции после попытки пробоя");
    alternative = upward
      ? "После импульсного пробоя каскада может сформироваться заточка"
      : "После импульсного пробоя каскада может сформироваться нож";
  }

  return { primary, headline, reasoning, confirmation, invalidation, alternative };
}

export function buildTraderExplanation(candidate, evidencePack = {}, now = Date.now()) {
  const primary = choosePrimary(candidate);
  const core = explanationFor(candidate, primary);
  const bookCoverage = Number(evidencePack?.coverage?.bookSnapshots) || 0;
  const priceCoverage = Number(evidencePack?.coverage?.pricePoints) || 0;
  const missing = [];
  if (!bookCoverage) missing.push("глубокий стакан ещё не записан для этой точки");
  if (priceCoverage < 10) missing.push("мало секундного контекста до события");
  if (!candidate?.evidence?.tps && !candidate?.evidence?.buyShare) missing.push("нет достаточного подтверждения потоком сделок");

  return Object.freeze({
    schemaVersion: 2,
    entity: "SignalLabTraderExplanation",
    generatedAt: now,
    primaryHypothesis: primary,
    primaryLabel: HYPOTHESIS_LABELS[primary] ?? primary,
    headline: core.headline,
    reasoning: Object.freeze(core.reasoning.slice(0, 5)),
    confirmation: Object.freeze(core.confirmation.slice(0, 4)),
    invalidation: Object.freeze(core.invalidation.slice(0, 4)),
    missingEvidence: Object.freeze(missing.slice(0, 4)),
    alternative: core.alternative,
    disclaimer: "Объяснение описывает наблюдаемую гипотезу и условия её проверки. Это не команда на сделку и не доказательство намерения участника.",
  });
}

export { HYPOTHESIS_LABELS };
EOF

cat > test/signal-lab-v3.test.js <<'EOF'
import test from "node:test";
import assert from "node:assert/strict";

import {
  CandidateEpisodeTracker,
  CANDIDATE_TYPES,
  detectExpertCandidates,
  isEligibleForSignalLabV3,
  SIGNAL_LAB_V3_FORMULA_VERSION,
} from "../signal-lab-v3-candidates.js";
import { rowsToCsv, SignalLabV3Store } from "../signal-lab-v3-store.js";

function baseMetrics(overrides = {}) {
  return {
    symbol: "TESTUSDT",
    price: 100,
    updatedAt: 100_000,
    quoteVolume24h: 150_000_000,
    turnoverPerMinute: 500_000,
    warmupSeconds: 120,
    change15s: 0,
    change1m: 0,
    change5m: 0,
    volumeBoost: 1.5,
    natr1m: 0.8,
    natr5m: 1.2,
    range60s: { min: 99.8, max: 100.2, percent: 0.4 },
    range5m: { min: 98, max: 102, percent: 4 },
    trades: { tps: 2, buy: 60_000, sell: 40_000, buyShare: 60 },
    liquidation: { longs: 0, shorts: 0, total: 0 },
    priceHistory: [
      { at: 40_000, price: 100 },
      { at: 60_000, price: 100 },
      { at: 80_000, price: 100 },
      { at: 100_000, price: 100 },
    ],
    minuteCandles: [],
    ...overrides,
  };
}

function breakoutCandles() {
  return [
    { time: 1, open: 99.3, high: 99.7, low: 99.1, close: 99.5 },
    { time: 2, open: 99.5, high: 100, low: 99.4, close: 99.7 },
    { time: 3, open: 99.7, high: 99.8, low: 99.3, close: 99.5 },
    { time: 4, open: 99.5, high: 99.96, low: 99.4, close: 99.7 },
    { time: 5, open: 99.7, high: 99.82, low: 99.5, close: 99.6 },
    { time: 6, open: 99.6, high: 99.9, low: 99.5, close: 99.8 },
    { time: 7, open: 99.8, high: 99.92, low: 99.7, close: 99.88 },
    { time: 8, open: 99.88, high: 99.91, low: 99.8, close: 99.9 },
  ];
}

function cascadeCandles() {
  const highs = [99, 100, 99.5, 101, 100.5, 102, 101.5, 101.95];
  return highs.map((high, index) => ({
    time: index + 1,
    open: high - 0.4,
    high,
    low: high - 0.8,
    close: high - 0.2,
  }));
}

function types(rows) {
  return new Set(rows.map((row) => row.candidateType));
}

test("eligibility is strictly above $100m quote volume and NATR5 above 1%", () => {
  assert.equal(isEligibleForSignalLabV3(baseMetrics()), true);
  assert.equal(isEligibleForSignalLabV3(baseMetrics({ quoteVolume24h: 100_000_000 })), false);
  assert.equal(isEligibleForSignalLabV3(baseMetrics({ quoteVolume24h: 99_999_999 })), false);
  assert.equal(isEligibleForSignalLabV3(baseMetrics({ natr5m: 1 })), false);
  assert.equal(isEligibleForSignalLabV3(baseMetrics({ natr5m: 0.99 })), false);
  assert.equal(isEligibleForSignalLabV3(baseMetrics({ natr5m: null })), false);
});

test("a generic impulse no longer creates a standalone episode", () => {
  const rows = detectExpertCandidates(baseMetrics({
    change15s: 0.9,
    range60s: { min: 99, max: 101, percent: 2 },
    minuteCandles: [],
  }), 100_000);
  assert.deepEqual(rows, []);
});

test("repeated level creates one breakout candidate that evolves from forming to triggered", () => {
  const forming = detectExpertCandidates(baseMetrics({
    price: 99.9,
    minuteCandles: breakoutCandles(),
  }), 100_000).find((row) => row.candidateType === CANDIDATE_TYPES.BREAKOUT_UP);
  assert.ok(forming);
  assert.equal(forming.stage, "forming");
  assert.deepEqual(forming.patternHypotheses, ["level_breakout"]);

  const triggered = detectExpertCandidates(baseMetrics({
    price: 100.15,
    minuteCandles: breakoutCandles(),
  }), 100_000).find((row) => row.candidateType === CANDIDATE_TYPES.BREAKOUT_UP);
  assert.ok(triggered);
  assert.equal(triggered.stage, "triggered");
  assert.equal(triggered.evidence.possibleReactionPattern, "sharpening_rejection");
});

test("three ordered extrema create only a cascade candidate", () => {
  const rows = detectExpertCandidates(baseMetrics({
    price: 101.95,
    minuteCandles: cascadeCandles(),
  }), 100_000);
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.CASCADE_UP);
  assert.ok(item);
  assert.equal(item.evidence.extremaCount, 3);
  assert.ok(item.evidence.zoneWidthPercent >= 1);
  assert.deepEqual(item.patternHypotheses, ["cascade_breakout"]);
});

test("sharpening records a level breakout as the origin of the reverse move", () => {
  const rows = detectExpertCandidates(baseMetrics({
    price: 100.35,
    minuteCandles: breakoutCandles(),
    priceHistory: [
      { at: 30_000, price: 99.5 },
      { at: 50_000, price: 99.7 },
      { at: 75_000, price: 100.1 },
      { at: 85_000, price: 100.8 },
      { at: 92_000, price: 100.55 },
      { at: 100_000, price: 100.35 },
    ],
  }), 100_000);
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.SHARPENING);
  assert.ok(item);
  assert.ok(item.evidence.originPatterns.includes("level_breakout"));
  assert.deepEqual(item.patternHypotheses, ["sharpening_rejection"]);
});

test("knife may follow a strong impulse even when no breakout structure is proven", () => {
  const rows = detectExpertCandidates(baseMetrics({
    price: 99.55,
    priceHistory: [
      { at: 30_000, price: 100.4 },
      { at: 50_000, price: 100.2 },
      { at: 75_000, price: 99.8 },
      { at: 85_000, price: 99.1 },
      { at: 92_000, price: 99.3 },
      { at: 100_000, price: 99.55 },
    ],
  }), 100_000);
  const item = rows.find((row) => row.candidateType === CANDIDATE_TYPES.KNIFE);
  assert.ok(item);
  assert.deepEqual(item.evidence.originPatterns, ["strong_impulse"]);
  assert.deepEqual(item.patternHypotheses, ["knife_reclaim"]);
});

test("detector emits only breakout, cascade, knife and sharpening types", () => {
  const allowed = new Set([
    CANDIDATE_TYPES.KNIFE,
    CANDIDATE_TYPES.SHARPENING,
    CANDIDATE_TYPES.BREAKOUT_UP,
    CANDIDATE_TYPES.BREAKOUT_DOWN,
    CANDIDATE_TYPES.CASCADE_UP,
    CANDIDATE_TYPES.CASCADE_DOWN,
  ]);
  const rows = [
    ...detectExpertCandidates(baseMetrics({ price: 100.15, minuteCandles: breakoutCandles() }), 100_000),
    ...detectExpertCandidates(baseMetrics({ price: 101.95, minuteCandles: cascadeCandles() }), 100_000),
  ];
  assert.ok(rows.length > 0);
  assert.equal(rows.every((row) => allowed.has(row.candidateType)), true);
  assert.equal(rows.every((row) => row.formulaVersion === SIGNAL_LAB_V3_FORMULA_VERSION), true);
});

test("episode tracker updates one pattern episode instead of creating duplicate cards", () => {
  const tracker = new CandidateEpisodeTracker();
  const metrics = baseMetrics({ price: 100.15, minuteCandles: breakoutCandles() });
  const first = tracker.ingest([metrics], 100_000);
  const second = tracker.ingest([metrics], 101_000);
  assert.ok(first.created.length >= 1);
  assert.equal(second.created.length, 0);
  assert.ok(second.updated.length >= 1);
  assert.equal(second.updated[0].id, first.created[0].id);
  const expired = tracker.ingest([], 130_000);
  assert.ok(expired.expired.length >= 1);
  assert.equal(expired.expired[0].stage, "completed");
});

test("candidate output contains eligibility facts but no trade command", () => {
  const rows = detectExpertCandidates(baseMetrics({ price: 100.15, minuteCandles: breakoutCandles() }), 100_000);
  const text = JSON.stringify(rows).toLowerCase();
  assert.match(text, /natr5/);
  assert.equal(text.includes("покупай"), false);
  assert.equal(text.includes("продавай"), false);
  assert.equal(text.includes("гарант"), false);
});

test("V3 store works in memory mode and preserves four-pattern manual review", async () => {
  const store = new SignalLabV3Store({ indexedDB: null });
  const status = await store.initialize();
  assert.equal(status.mode, "memory");
  await store.upsertEpisodes([{
    id: "episode-1",
    symbol: "TESTUSDT",
    candidateType: CANDIDATE_TYPES.KNIFE,
    label: "Нож",
    direction: "up",
    stage: "forming",
    firstSeenAt: 100,
    lastSeenAt: 110,
    observations: 2,
    peakEvidenceScore: 70,
    latest: {
      facts: ["вынос вниз -0.8%"],
      patternHypotheses: ["knife_reclaim"],
      formulaVersion: SIGNAL_LAB_V3_FORMULA_VERSION,
      quality: { state: "live", limitations: ["candidate-not-trade-signal"] },
    },
  }]);
  await store.saveReview("episode-1", {
    verdict: "valid",
    finalPatternId: "knife_reclaim",
    comment: "Есть остановка и быстрый возврат",
  }, 200);
  const [row] = await store.list();
  assert.equal(row.reviewState, "valid");
  assert.equal(row.review.finalPatternId, "knife_reclaim");
  const exported = await store.exportRows();
  assert.equal(exported[0].comment, "Есть остановка и быстрый возврат");
  assert.match(rowsToCsv(exported), /episode-1/);
});
EOF

python - <<'PY'
from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, got {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new))

replace_once(
    "signal-lab-v3-collector.js",
    'from "./signal-lab-v3-candidates.js";',
    'from "./signal-lab-v3-candidates.js?v=signal-lab-v3-four-patterns-v1";',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''    const ranked = metrics
      .filter((row) => (finite(row.quoteVolume24h) ?? 0) >= this.settings.minimumQuoteVolume24h)
      .sort((left, right) => candidateWatchScore(right) - candidateWatchScore(left));''',
    '''    const ranked = metrics
      .filter((row) => (
        (finite(row.quoteVolume24h) ?? 0) > this.settings.minimumQuoteVolume24h
        && (finite(row.natr5m) ?? 0) > this.settings.minimumNatr5Percent
      ))
      .sort((left, right) => candidateWatchScore(right, this.settings) - candidateWatchScore(left, this.settings));''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '      .filter((row) => (finite(row.quoteVolume24h) ?? 0) >= this.settings.minimumQuoteVolume24h)\n      .sort((left, right) => (finite(right.quoteVolume24h) ?? 0) - (finite(left.quoteVolume24h) ?? 0))',
    '      .filter((row) => (finite(row.quoteVolume24h) ?? 0) > this.settings.minimumQuoteVolume24h)\n      .sort((left, right) => (finite(right.quoteVolume24h) ?? 0) - (finite(left.quoteVolume24h) ?? 0))',
)

replace_once(
    "owner-signal-lab-v3.js",
    'from "./signal-lab-v3-candidates.js";',
    'from "./signal-lab-v3-candidates.js?v=signal-lab-v3-four-patterns-v1";',
)
replace_once(
    "owner-signal-lab-v3.js",
    'from "./signal-lab-v3-collector.js?v=signal-lab-v3-evidence-replay-v1";',
    'from "./signal-lab-v3-collector.js?v=signal-lab-v3-four-patterns-v1";',
)

html = Path("owner-signal-lab-v3.html")
text = html.read_text()
text = text.replace("Owner Signal Lab V3.1", "Owner Signal Lab V3.2")
text = text.replace("OWNER SIGNAL LAB V3.1", "OWNER SIGNAL LAB V3.2")
text = text.replace("signal-lab-v3-evidence-replay-v1", "signal-lab-v3-four-patterns-v1")
text = text.replace(
    "Для каждого нового кандидата лаборатория сохраняет контекст цены до и после события,\n          sampled depth20 по выбранным монетам, поток и формальное объяснение гипотезы.\n          Это материал для обучения и ручной разметки, а не команда на сделку.",
    "Новые эпизоды создаются только для монет с 24-часовым оборотом выше $100 млн и NATR5 выше 1%.\n          Лаборатория собирает только четыре паттерна: каскад, пробой, нож и заточку.\n          Нож и заточка могут стать обратной реакцией после пробоя, каскада или сильного импульса.",
)
text = text.replace(
    "Сборщик прогревает историю. Быстрые кандидаты появляются раньше,\n          а уровни, каскады и предыстория стакана требуют времени на прогрев.",
    "Сборщик прогревает 1-минутную историю для расчёта NATR5. Эпизод появится только после прохождения\n          фильтров: объём 24ч > $100 млн, NATR5 > 1% и наличие каскада, пробоя, ножа или заточки.",
)
old_options = '''                <option value="knife_reclaim">Нож</option>
                <option value="sharpening_rejection">Заточка</option>
                <option value="level_breakout">Пробой уровня</option>
                <option value="cascade_breakout">Пробой каскада</option>
                <option value="false_breakout">Ложный пробой</option>
                <option value="liquidity_hold">Участник / удержание сайза</option>
                <option value="liquidity_rearrangement">Переставляш / алгоритм</option>
                <option value="participant_activity">Направленный поток</option>
                <option value="liquidation_cascade">Каскад ликвидаций</option>
                <option value="other">Другое</option>'''
new_options = '''                <option value="knife_reclaim">Нож</option>
                <option value="sharpening_rejection">Заточка</option>
                <option value="level_breakout">Пробой</option>
                <option value="cascade_breakout">Каскад</option>
                <option value="other">Другое</option>'''
if old_options not in text:
    raise SystemExit("owner pattern options block not found")
text = text.replace(old_options, new_options)
html.write_text(text)
PY

python - <<'PY'
from pathlib import Path
path = Path("test/signal-lab-v3-evidence.test.js")
text = path.read_text()
text = text.replace('id: `BICOUSDT:up_displacement:${now}:1`,', 'id: `BICOUSDT:level_break_attempt_up:${now}:1`,')
text = text.replace('candidateType: "up_displacement",', 'candidateType: "level_break_attempt_up",')
text = text.replace('label: "Резкий вынос вверх",', 'label: "Кандидат пробоя вверх",')
text = text.replace('stage: "observed",', 'stage: "triggered",')
text = text.replace('candidateType: "up_displacement",', 'candidateType: "level_break_attempt_up",')
text = text.replace('''      evidence: {
        move15sPercent: 0.55,
        range60sPercent: 0.81,
        volumeBoost: 1.9,
      },
      facts: ["движение за 15с +0.55%", "ускорение объёма ×1.9"],
      patternHypotheses: ["sharpening_rejection", "continuation_breakout"],''', '''      evidence: {
        level: 0.24,
        touchCount: 3,
        distancePercent: 0.42,
        broken: true,
        natr5m: 1.2,
        quoteVolume24h: 150_000_000,
        volumeBoost: 1.9,
      },
      facts: ["3 касания уровня", "уровень пробит +0.42%"],
      patternHypotheses: ["level_breakout"],''')
text = text.replace('assert.equal(first.created[0].evidencePack.traderExplanation.primaryHypothesis, "continuation_breakout");', 'assert.equal(first.created[0].evidencePack.traderExplanation.primaryHypothesis, "level_breakout");')
text = text.replace('assert.equal(explanation.primaryLabel, "Продолжение вверх");', 'assert.equal(explanation.primaryLabel, "Пробой");')
path.write_text(text)
PY

python - <<'PY'
from pathlib import Path
path = Path("test/signal-lab-v3-collector.test.js")
text = path.read_text()
text = text.replace("signal-lab-v3-evidence-replay-v1", "signal-lab-v3-four-patterns-v1")
insert = '''\n\ntest("Signal Lab V3 collector tracks trades and depth only after both market filters", () => {
  assert.match(collectorSource, /minimumQuoteVolume24h/);
  assert.match(collectorSource, /minimumNatr5Percent/);
  assert.match(collectorSource, /finite\(row\.natr5m\)/);
  assert.match(ownerHtml, /выше \$100 млн/);
  assert.match(ownerHtml, /NATR5 выше 1%/);
});\n'''
text += insert
path.write_text(text)
PY

cat > docs/signal-lab-v3-four-pattern-filter.md <<'EOF'
# Signal Lab V3.2: четыре паттерна и жёсткий market gate

## Цель

Снизить шум и собирать только эпизоды на монетах, пригодных для практического скальпинга.

## Обязательный допуск монеты

Новый эпизод создаётся только когда одновременно выполняются условия:

- Binance USDⓈ-M perpetual;
- 24-часовой quote volume строго выше 100 000 000 USDT;
- NATR5 строго выше 1%;
- история прогрета и данные не просрочены.

Равенство порогу не проходит: 100 млн и NATR5 1.00 не допускаются.

## Единственные собираемые паттерны

1. Пробой уровня — формирующийся подход или уже выполненный выход за повторно тестируемый уровень.
2. Каскад — направленная цепочка минимум из трёх экстремумов шириной 1–5%.
3. Нож — быстрый выкуп после сильного движения вниз.
4. Заточка — быстрая обратная реакция после сильного движения вверх.

Импульс, поток, ликвидации и отображаемый сайз больше не создают самостоятельные карточки. Они сохраняются как доказательства внутри одного из четырёх паттернов.

## Связь паттернов

Пробой и каскад являются первичными структурами-кандидатами. После их импульсного прохождения может появиться вторичный эпизод:

- после движения вниз — нож;
- после движения вверх — заточка.

Если структура пробоя или каскада не доказана, нож/заточка всё равно могут быть сохранены после достаточно сильного импульса, но источник будет явно указан как `strong_impulse`.

## Ограничения

- кандидат пробоя не означает подтверждённый пробой;
- кандидат каскада не доказывает расположение стопов;
- нож и заточка требуют подтверждения лентой и стаканом;
- sampled depth20 не является полной локальной книгой;
- формула используется для сбора и обучения, а не для команды на сделку.
EOF
