export const SIGNAL_LAB_V3_FORMULA_VERSION = "signal-lab-v3-expert-candidates-2026-07";

export const CANDIDATE_TYPES = Object.freeze({
  DOWN_DISPLACEMENT: "down_displacement",
  UP_DISPLACEMENT: "up_displacement",
  DOWN_REVERSAL_ATTEMPT: "down_reversal_attempt",
  UP_REVERSAL_ATTEMPT: "up_reversal_attempt",
  LEVEL_PRESSURE_UP: "level_pressure_up",
  LEVEL_PRESSURE_DOWN: "level_pressure_down",
  LEVEL_BREAK_ATTEMPT_UP: "level_break_attempt_up",
  LEVEL_BREAK_ATTEMPT_DOWN: "level_break_attempt_down",
  CASCADE_STRUCTURE_UP: "cascade_structure_up",
  CASCADE_STRUCTURE_DOWN: "cascade_structure_down",
  FLOW_ACCELERATION_UP: "flow_acceleration_up",
  FLOW_ACCELERATION_DOWN: "flow_acceleration_down",
  LIQUIDITY_EVENT_BID: "liquidity_event_bid",
  LIQUIDITY_EVENT_ASK: "liquidity_event_ask",
  LIQUIDATION_BURST_UP: "liquidation_burst_up",
  LIQUIDATION_BURST_DOWN: "liquidation_burst_down",
});

export const CANDIDATE_LABELS = Object.freeze({
  [CANDIDATE_TYPES.DOWN_DISPLACEMENT]: "Резкий вынос вниз",
  [CANDIDATE_TYPES.UP_DISPLACEMENT]: "Резкий вынос вверх",
  [CANDIDATE_TYPES.DOWN_REVERSAL_ATTEMPT]: "Попытка выкупа после выноса вниз",
  [CANDIDATE_TYPES.UP_REVERSAL_ATTEMPT]: "Попытка слива после выноса вверх",
  [CANDIDATE_TYPES.LEVEL_PRESSURE_UP]: "Подход к верхнему уровню",
  [CANDIDATE_TYPES.LEVEL_PRESSURE_DOWN]: "Подход к нижнему уровню",
  [CANDIDATE_TYPES.LEVEL_BREAK_ATTEMPT_UP]: "Попытка пробоя вверх",
  [CANDIDATE_TYPES.LEVEL_BREAK_ATTEMPT_DOWN]: "Попытка пробоя вниз",
  [CANDIDATE_TYPES.CASCADE_STRUCTURE_UP]: "Восходящая каскадная структура",
  [CANDIDATE_TYPES.CASCADE_STRUCTURE_DOWN]: "Нисходящая каскадная структура",
  [CANDIDATE_TYPES.FLOW_ACCELERATION_UP]: "Ускорение покупок",
  [CANDIDATE_TYPES.FLOW_ACCELERATION_DOWN]: "Ускорение продаж",
  [CANDIDATE_TYPES.LIQUIDITY_EVENT_BID]: "Аномальная bid-ликвидность",
  [CANDIDATE_TYPES.LIQUIDITY_EVENT_ASK]: "Аномальная ask-ликвидность",
  [CANDIDATE_TYPES.LIQUIDATION_BURST_UP]: "Всплеск ликвидаций шортов",
  [CANDIDATE_TYPES.LIQUIDATION_BURST_DOWN]: "Всплеск ликвидаций лонгов",
});

export const DEFAULT_CANDIDATE_SETTINGS = Object.freeze({
  minimumQuoteVolume24h: 5_000_000,
  minimumWarmupSeconds: 35,
  episodeCooldownMs: 45_000,
  episodeReleaseMs: 18_000,
  minimumMove15sPercent: 0.12,
  maximumMove15sPercent: 0.55,
  minimumStrongMovePercent: 0.28,
  maximumStrongMovePercent: 1.1,
  reversalLookbackMs: 75_000,
  reversalMaximumAgeMs: 25_000,
  reversalMinimumRecoveryPercent: 0.12,
  levelLookbackCandles: 40,
  levelMinimumTouches: 2,
  levelMinimumTolerancePercent: 0.08,
  levelMaximumTolerancePercent: 0.28,
  levelMinimumApproachPercent: 0.12,
  levelMaximumApproachPercent: 0.5,
  cascadeMinimumExtrema: 3,
  cascadeMinimumWidthPercent: 0.5,
  cascadeMaximumWidthPercent: 8,
  cascadeMinimumStepPercent: 0.04,
  minimumVolumeBoost: 1.35,
  minimumAggressorSharePercent: 62,
  minimumTradesPerSecond: 1.5,
  minimumLiquidityQuoteUsd: 25_000,
  minimumLiquidityMultiple: 2.8,
  minimumLiquidationQuoteUsd: 10_000,
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

function dynamicThresholds(metrics, settings) {
  const natr = Math.max(
    0.12,
    finite(metrics?.natr1m) ?? finite(metrics?.natr5m) ?? 0.25,
  );
  return {
    move15s: clamp(
      natr * 0.45,
      settings.minimumMove15sPercent,
      settings.maximumMove15sPercent,
    ),
    strongMove: clamp(
      natr * 0.9,
      settings.minimumStrongMovePercent,
      settings.maximumStrongMovePercent,
    ),
    levelTolerance: clamp(
      natr * 0.24,
      settings.levelMinimumTolerancePercent,
      settings.levelMaximumTolerancePercent,
    ),
    levelApproach: clamp(
      natr * 0.55,
      settings.levelMinimumApproachPercent,
      settings.levelMaximumApproachPercent,
    ),
    cascadeStep: Math.max(settings.cascadeMinimumStepPercent, natr * 0.12),
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
  const minimumRecovery = Math.max(
    settings.reversalMinimumRecoveryPercent,
    impulse * 0.18,
  );
  if (
    !recovered
    || impulse < thresholds.strongMove
    || recovery < minimumRecovery
    || now - extremeAt > settings.reversalMaximumAgeMs
  ) return null;

  return {
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

function levelEvidence(metrics, side, thresholds, settings) {
  const candles = closedMinuteCandles(metrics, settings);
  const current = finite(metrics?.price);
  if (candles.length < 6 || current === null) return null;
  const values = candles.map((candle) => side === "up" ? candle.high : candle.low);
  const level = side === "up" ? Math.max(...values) : Math.min(...values);
  const touchRows = candles.filter((candle) => (
    percentDistance(side === "up" ? candle.high : candle.low, level) <= thresholds.levelTolerance
  ));
  if (touchRows.length < settings.levelMinimumTouches) return null;
  const distancePercent = percentChange(current, level);
  const absoluteDistance = Math.abs(distancePercent ?? Infinity);
  const approached = absoluteDistance <= thresholds.levelApproach;
  const broken = side === "up" ? current > level : current < level;
  if (!approached && !broken) return null;
  return {
    level,
    touchCount: touchRows.length,
    touchTimes: touchRows.slice(-6).map((candle) => candle.time),
    tolerancePercent: thresholds.levelTolerance,
    distancePercent,
    broken,
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

function cascadeEvidence(metrics, side, thresholds, settings) {
  const candles = closedMinuteCandles(metrics, settings).slice(-32);
  const current = finite(metrics?.price);
  if (candles.length < 7 || current === null) return null;
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
  const broken = side === "high" ? current > nearest : current < nearest;
  const distancePercent = percentChange(current, nearest);
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
  };
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
  stage = "observed",
  evidence,
  facts,
  hypotheses,
  scoreParts,
  limitations = [],
}) {
  return Object.freeze({
    schemaVersion: 1,
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
    facts: Object.freeze(facts.filter(Boolean).slice(0, 7)),
    patternHypotheses: Object.freeze([...new Set(hypotheses)]),
    quality: Object.freeze({
      state: now - (finite(metrics?.updatedAt) ?? 0) <= 5_000 ? "live" : "stale",
      limitations: Object.freeze([...new Set([
        "candidate-not-trade-signal",
        "expert-channel-examples-are-training-hypotheses",
        ...limitations,
      ])]),
    }),
  });
}

export function detectExpertCandidates(metrics, now = Date.now(), options = {}) {
  const settings = { ...DEFAULT_CANDIDATE_SETTINGS, ...options };
  const symbol = normalizeSymbol(metrics?.symbol);
  const price = finite(metrics?.price);
  const quoteVolume24h = finite(metrics?.quoteVolume24h) ?? 0;
  const warmupSeconds = finite(metrics?.warmupSeconds) ?? 0;
  if (
    !symbol
    || price === null
    || price <= 0
    || quoteVolume24h < settings.minimumQuoteVolume24h
    || warmupSeconds < settings.minimumWarmupSeconds
  ) return [];

  const result = [];
  const thresholds = dynamicThresholds(metrics, settings);
  const move15s = finite(metrics?.change15s);
  const range60s = finite(metrics?.range60s?.percent) ?? 0;
  const volumeBoost = finite(metrics?.volumeBoost) ?? 0;
  const tps = finite(metrics?.trades?.tps) ?? 0;
  const buyShare = finite(metrics?.trades?.buyShare);
  const sellShare = buyShare === null ? null : 100 - buyShare;
  const absMove15s = Math.abs(move15s ?? 0);
  const moveTriggered = move15s !== null && absMove15s >= thresholds.move15s;
  const rangeTriggered = range60s >= thresholds.strongMove;

  if (moveTriggered || rangeTriggered) {
    const direction = (move15s ?? 0) < 0 ? "down" : "up";
    const type = direction === "down"
      ? CANDIDATE_TYPES.DOWN_DISPLACEMENT
      : CANDIDATE_TYPES.UP_DISPLACEMENT;
    result.push(candidate({
      metrics,
      now,
      type,
      direction,
      evidence: { move15sPercent: move15s, range60sPercent: range60s, volumeBoost, tps, buyShare },
      facts: [
        move15s === null ? null : `движение за 15с ${formatPercent(move15s)}`,
        range60s ? `диапазон за 60с ${formatPercent(range60s)}` : null,
        volumeBoost ? `ускорение объёма ×${volumeBoost.toFixed(1)}` : null,
        tps ? `${tps.toFixed(1)} сделок/с` : null,
      ],
      hypotheses: direction === "down"
        ? ["knife_reclaim", "continuation_breakdown"]
        : ["sharpening_rejection", "continuation_breakout"],
      scoreParts: [
        clamp(absMove15s / thresholds.move15s, 0, 2) * 22,
        clamp(range60s / thresholds.strongMove, 0, 2) * 16,
        clamp(volumeBoost / settings.minimumVolumeBoost, 0, 2) * 10,
      ],
      limitations: ["directional-displacement-does-not-prove-reversal-or-continuation"],
    }));
  }

  const downReversal = reversalEvidence(metrics, now, "down", thresholds, settings);
  if (downReversal) {
    result.push(candidate({
      metrics,
      now,
      type: CANDIDATE_TYPES.DOWN_REVERSAL_ATTEMPT,
      direction: "up",
      stage: "forming",
      evidence: downReversal,
      facts: [
        `вынос вниз ${formatPercent(-downReversal.impulsePercent)}`,
        `выкуп от экстремума ${formatPercent(downReversal.recoveryPercent)}`,
        `реакция за ${(downReversal.recoveryDurationMs / 1_000).toFixed(1)}с`,
      ],
      hypotheses: ["knife_reclaim", "false_breakout"],
      scoreParts: [
        clamp(downReversal.impulsePercent / thresholds.strongMove, 0, 2) * 24,
        clamp(downReversal.recoveryPercent / settings.reversalMinimumRecoveryPercent, 0, 2) * 18,
      ],
      limitations: ["reversal-needs-flow-or-liquidity-confirmation"],
    }));
  }

  const upReversal = reversalEvidence(metrics, now, "up", thresholds, settings);
  if (upReversal) {
    result.push(candidate({
      metrics,
      now,
      type: CANDIDATE_TYPES.UP_REVERSAL_ATTEMPT,
      direction: "down",
      stage: "forming",
      evidence: upReversal,
      facts: [
        `вынос вверх ${formatPercent(upReversal.impulsePercent)}`,
        `слив от экстремума ${formatPercent(-upReversal.recoveryPercent)}`,
        `реакция за ${(upReversal.recoveryDurationMs / 1_000).toFixed(1)}с`,
      ],
      hypotheses: ["sharpening_rejection", "false_breakout"],
      scoreParts: [
        clamp(upReversal.impulsePercent / thresholds.strongMove, 0, 2) * 24,
        clamp(upReversal.recoveryPercent / settings.reversalMinimumRecoveryPercent, 0, 2) * 18,
      ],
      limitations: ["reversal-needs-flow-or-liquidity-confirmation"],
    }));
  }

  for (const side of ["up", "down"]) {
    const level = levelEvidence(metrics, side, thresholds, settings);
    if (!level) continue;
    const pressureType = side === "up"
      ? CANDIDATE_TYPES.LEVEL_PRESSURE_UP
      : CANDIDATE_TYPES.LEVEL_PRESSURE_DOWN;
    const breakType = side === "up"
      ? CANDIDATE_TYPES.LEVEL_BREAK_ATTEMPT_UP
      : CANDIDATE_TYPES.LEVEL_BREAK_ATTEMPT_DOWN;
    result.push(candidate({
      metrics,
      now,
      type: level.broken ? breakType : pressureType,
      direction: side,
      stage: level.broken ? "triggered" : "forming",
      evidence: level,
      facts: [
        `${level.touchCount} касания уровня`,
        `уровень ${level.level}`,
        `${level.broken ? "выход" : "расстояние"} ${formatPercent(level.distancePercent)}`,
      ],
      hypotheses: level.broken
        ? ["level_breakout", "false_breakout"]
        : ["level_breakout", "liquidity_sweep"],
      scoreParts: [
        clamp(level.touchCount / settings.levelMinimumTouches, 0, 2) * 16,
        clamp(1 - Math.min(Math.abs(level.distancePercent ?? 1) / thresholds.levelApproach, 1), 0, 1) * 18,
        level.broken ? 12 : 0,
      ],
      limitations: ["touches-are-geometric-evidence-not-proof-of-stop-liquidity"],
    }));
  }

  for (const side of ["high", "low"]) {
    const cascade = cascadeEvidence(metrics, side, thresholds, settings);
    if (!cascade) continue;
    const direction = side === "high" ? "up" : "down";
    result.push(candidate({
      metrics,
      now,
      type: direction === "up"
        ? CANDIDATE_TYPES.CASCADE_STRUCTURE_UP
        : CANDIDATE_TYPES.CASCADE_STRUCTURE_DOWN,
      direction,
      stage: cascade.broken ? "triggered" : "forming",
      evidence: cascade,
      facts: [
        `${cascade.extremaCount} последовательных экстремума`,
        `ширина конструкции ${formatPercent(cascade.zoneWidthPercent)}`,
        `${cascade.broken ? "ступень пробита" : "до ступени"} ${formatPercent(cascade.distanceFromNearestPercent)}`,
      ],
      hypotheses: ["cascade_breakout"],
      scoreParts: [
        clamp(cascade.extremaCount / settings.cascadeMinimumExtrema, 0, 2) * 20,
        clamp(cascade.zoneWidthPercent / settings.cascadeMinimumWidthPercent, 0, 2) * 8,
        cascade.broken ? 18 : 6,
      ],
      limitations: [
        "extrema-zone-is-not-confirmed-stop-location",
        "follow-through-not-confirmed-at-candidate-stage",
      ],
    }));
  }

  if (
    volumeBoost >= settings.minimumVolumeBoost
    && tps >= settings.minimumTradesPerSecond
    && buyShare !== null
    && (buyShare >= settings.minimumAggressorSharePercent || sellShare >= settings.minimumAggressorSharePercent)
  ) {
    const direction = buyShare >= settings.minimumAggressorSharePercent ? "up" : "down";
    result.push(candidate({
      metrics,
      now,
      type: direction === "up"
        ? CANDIDATE_TYPES.FLOW_ACCELERATION_UP
        : CANDIDATE_TYPES.FLOW_ACCELERATION_DOWN,
      direction,
      evidence: { volumeBoost, tps, buyShare, sellShare },
      facts: [
        `объём ускорился ×${volumeBoost.toFixed(1)}`,
        `${tps.toFixed(1)} сделок/с`,
        `${direction === "up" ? "покупки" : "продажи"} ${Math.max(buyShare, sellShare).toFixed(0)}%`,
      ],
      hypotheses: ["participant_activity", "directional_impulse"],
      scoreParts: [
        clamp(volumeBoost / settings.minimumVolumeBoost, 0, 2) * 18,
        clamp(tps / settings.minimumTradesPerSecond, 0, 2) * 14,
        clamp((Math.max(buyShare, sellShare) - 50) / 25, 0, 2) * 14,
      ],
      limitations: ["aggregated-trade-flow-does-not-identify-a-participant"],
    }));
  }

  const book = metrics?.bookCandidate;
  if (
    book
    && finite(book.quoteUsd) >= settings.minimumLiquidityQuoteUsd
    && finite(book.sizeMultiple) >= settings.minimumLiquidityMultiple
  ) {
    const side = book.side === "ask" ? "ask" : "bid";
    result.push(candidate({
      metrics,
      now,
      type: side === "bid"
        ? CANDIDATE_TYPES.LIQUIDITY_EVENT_BID
        : CANDIDATE_TYPES.LIQUIDITY_EVENT_ASK,
      direction: side === "bid" ? "up" : "down",
      stage: Number(book.touchCount) >= 2 ? "forming" : "observed",
      evidence: { ...book },
      facts: [
        `сайз ${formatCompactUsd(book.quoteUsd)}`,
        `${Number(book.sizeMultiple).toFixed(1)}× к локальной медиане`,
        Number(book.touchCount) ? `${Math.round(book.touchCount)} повторения` : null,
        book.moved === true ? "сайз переставлялся" : null,
      ],
      hypotheses: ["liquidity_hold", "liquidity_rearrangement"],
      scoreParts: [
        clamp(Number(book.sizeMultiple) / settings.minimumLiquidityMultiple, 0, 2) * 22,
        clamp(Number(book.touchCount ?? 1) / 3, 0, 2) * 12,
        book.moved === true ? 12 : 0,
      ],
      limitations: [
        "displayed-liquidity-does-not-prove-intent",
        "best-quote-only-until-deep-book-context-is-open",
      ],
    }));
  }

  const liquidation = metrics?.liquidation ?? {};
  const liquidationTotal = finite(liquidation.total) ?? 0;
  const turnoverPerMinute = finite(metrics?.turnoverPerMinute) ?? 0;
  const liquidationThreshold = Math.max(
    settings.minimumLiquidationQuoteUsd,
    turnoverPerMinute * 0.12,
  );
  if (liquidationTotal >= liquidationThreshold) {
    const longs = finite(liquidation.longs) ?? 0;
    const shorts = finite(liquidation.shorts) ?? 0;
    const direction = shorts > longs ? "up" : "down";
    const alignedQuote = direction === "up" ? shorts : longs;
    result.push(candidate({
      metrics,
      now,
      type: direction === "up"
        ? CANDIDATE_TYPES.LIQUIDATION_BURST_UP
        : CANDIDATE_TYPES.LIQUIDATION_BURST_DOWN,
      direction,
      evidence: { longsQuoteUsd: longs, shortsQuoteUsd: shorts, totalQuoteUsd: liquidationTotal },
      facts: [
        `ликвидации ${formatCompactUsd(liquidationTotal)}`,
        `${direction === "up" ? "шорты" : "лонги"} ${formatCompactUsd(alignedQuote)}`,
        move15s === null ? null : `цена за 15с ${formatPercent(move15s)}`,
      ],
      hypotheses: ["liquidation_cascade", "exhaustion_reversal"],
      scoreParts: [
        clamp(liquidationTotal / liquidationThreshold, 0, 2) * 28,
        clamp(absMove15s / thresholds.move15s, 0, 2) * 12,
      ],
      limitations: ["liquidation-burst-does-not-guarantee-continuation"],
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
          schemaVersion: 1,
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

export function candidateWatchScore(metrics) {
  const move = Math.abs(finite(metrics?.change15s) ?? 0);
  const range = finite(metrics?.range60s?.percent) ?? 0;
  const boost = finite(metrics?.volumeBoost) ?? 0;
  const turnover = finite(metrics?.turnoverPerMinute) ?? 0;
  const liquidation = finite(metrics?.liquidation?.total) ?? 0;
  return (
    move * 30
    + range * 18
    + Math.min(boost, 5) * 6
    + Math.max(0, Math.log10(Math.max(turnover, 1)) - 3) * 4
    + Math.max(0, Math.log10(Math.max(liquidation, 1)) - 3) * 3
  );
}
