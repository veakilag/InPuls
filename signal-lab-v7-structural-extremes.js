export const STRUCTURAL_EXTREME_ALGORITHM_VERSION = "signal-lab-structural-extremes-stage1-v3.9-pierce-lifecycle-2026-08";

export const STRUCTURAL_DIRECTIONS = Object.freeze({
  UNDEFINED: "UNDEFINED",
  TRACKING_UP: "TRACKING_UP",
  TRACKING_DOWN: "TRACKING_DOWN",
});

export const STRUCTURAL_EXTREME_STATUSES = Object.freeze({
  CANDIDATE: "CANDIDATE",
  CONFIRMED_ACTIVE: "CONFIRMED_ACTIVE",
  TOUCHED: "TOUCHED",
  PIERCED: "PIERCED",
  CROSSED: "CROSSED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
});

export const STRUCTURAL_TIMEFRAMES = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);

export const STRUCTURAL_TIMEFRAME_STRENGTH = Object.freeze({
  "1m": Object.freeze({ rank: 1, score: 17, label: "LOCAL" }),
  "5m": Object.freeze({ rank: 2, score: 33, label: "LOCAL_PLUS" }),
  "15m": Object.freeze({ rank: 3, score: 50, label: "INTRADAY" }),
  "1h": Object.freeze({ rank: 4, score: 67, label: "INTRADAY_MAJOR" }),
  "4h": Object.freeze({ rank: 5, score: 83, label: "SWING" }),
  "1d": Object.freeze({ rank: 6, score: 100, label: "MAJOR" }),
});

export const DEFAULT_STRUCTURAL_EXTREME_CONFIG = Object.freeze({
  atrPeriod: 14,
  atrTrimFraction: 0.2,
  minimumBarsAfterCandidate: 2,
  tickSizeBufferTicks: 3,
  crossingToleranceTicks: 1,
  touchZoneTicks: 2,
  touchZoneFactor: 0.15,
  maximumTouchZonePercent: 0.25,
  rearmDistanceFactor: 0.7,
  acceptanceBars: 2,
  rejectionBars: 3,
  historyLimit: 10_000,
  confirmationSource: "close",
  timeframes: Object.freeze({
    "1m": Object.freeze({ minimumPercent: 0.10, atrMultiplier: 0.75, maximumPercent: 1.25, minimumSwingPercent: 0.15, minimumBarsAfterCandidate: 1 }),
    "5m": Object.freeze({ minimumPercent: 0.18, atrMultiplier: 0.80, maximumPercent: 1.75, minimumSwingPercent: 0.27, minimumBarsAfterCandidate: 1 }),
    "15m": Object.freeze({ minimumPercent: 0.28, atrMultiplier: 0.85, maximumPercent: 2.50, minimumSwingPercent: 0.42, minimumBarsAfterCandidate: 2 }),
    "1h": Object.freeze({ minimumPercent: 0.45, atrMultiplier: 0.90, maximumPercent: 4.00, minimumSwingPercent: 0.70, minimumBarsAfterCandidate: 2 }),
    "4h": Object.freeze({ minimumPercent: 0.70, atrMultiplier: 1.00, maximumPercent: 7.00, minimumSwingPercent: 1.10, minimumBarsAfterCandidate: 2 }),
    "1d": Object.freeze({ minimumPercent: 1.00, atrMultiplier: 1.10, maximumPercent: 10.00, minimumSwingPercent: 1.50, minimumBarsAfterCandidate: 1 }),
  }),
});

const TIMEFRAME_MS = Object.freeze({
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
});

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const round = (value, digits = 8) => {
  const number = finite(value);
  if (number === null) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
};

const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

function normalizeSymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,20}USDT$/.test(symbol) ? symbol : null;
}

function normalizeTickSize(value) {
  const tickSize = finite(value);
  if (!(tickSize > 0)) throw new TypeError("tickSize must be a positive number");
  return tickSize;
}

function normalizeTimeframe(value) {
  const timeframe = String(value ?? "");
  return STRUCTURAL_TIMEFRAMES.includes(timeframe) ? timeframe : null;
}

function mergeConfig(timeframe, config = {}) {
  const defaults = DEFAULT_STRUCTURAL_EXTREME_CONFIG.timeframes[timeframe];
  return Object.freeze({
    atrPeriod: Math.max(2, Math.round(finite(config.atrPeriod) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.atrPeriod)),
    atrTrimFraction: Math.max(0, Math.min(0.4, finite(config.atrTrimFraction) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.atrTrimFraction)),
    minimumBarsAfterCandidate: Math.max(0, Math.round(
      finite(config.minimumBarsAfterCandidate)
      ?? finite(defaults.minimumBarsAfterCandidate)
      ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.minimumBarsAfterCandidate,
    )),
    tickSizeBufferTicks: Math.max(1, Math.round(finite(config.tickSizeBufferTicks) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.tickSizeBufferTicks)),
    crossingToleranceTicks: Math.max(0, Math.round(finite(config.crossingToleranceTicks) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.crossingToleranceTicks)),
    touchZoneTicks: Math.max(1, Math.round(finite(config.touchZoneTicks) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.touchZoneTicks)),
    touchZoneFactor: Math.max(0.01, finite(config.touchZoneFactor) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.touchZoneFactor),
    maximumTouchZonePercent: Math.max(0.01, finite(config.maximumTouchZonePercent) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.maximumTouchZonePercent),
    rearmDistanceFactor: Math.max(0.1, finite(config.rearmDistanceFactor) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.rearmDistanceFactor),
    acceptanceBars: Math.max(1, Math.round(finite(config.acceptanceBars) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.acceptanceBars)),
    rejectionBars: Math.max(1, Math.round(finite(config.rejectionBars) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.rejectionBars)),
    historyLimit: Math.max(100, Math.round(finite(config.historyLimit) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.historyLimit)),
    minimumPercent: Math.max(0, finite(config.minimumPercent) ?? defaults.minimumPercent),
    atrMultiplier: Math.max(0, finite(config.atrMultiplier) ?? defaults.atrMultiplier),
    maximumPercent: Math.max(
      finite(config.minimumPercent) ?? defaults.minimumPercent,
      finite(config.maximumPercent) ?? defaults.maximumPercent,
    ),
    minimumSwingPercent: Math.max(0, finite(config.minimumSwingPercent) ?? defaults.minimumSwingPercent),
    confirmationSource: config.confirmationSource === "wick" ? "wick" : "close",
  });
}

function normalizeCandle(row, intervalMs) {
  const time = finite(row?.time ?? row?.openTime);
  const open = finite(row?.open);
  const high = finite(row?.high);
  const low = finite(row?.low);
  const close = finite(row?.close);
  if (time === null || time < 0) return null;
  if (![open, high, low, close].every((value) => value !== null && value > 0)) return null;
  if (high < Math.max(open, close) || low > Math.min(open, close) || low > high) return null;
  return Object.freeze({
    time,
    closeTime: finite(row?.closeTime) ?? time + intervalMs - 1,
    open,
    high,
    low,
    close,
    volume: Math.max(0, finite(row?.volume) ?? 0),
    closed: row?.closed !== false,
  });
}

function trueRange(candle, previousClose) {
  if (!candle) return null;
  if (!(previousClose > 0)) return candle.high - candle.low;
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose),
  );
}

function robustMean(values, trimFraction = 0.2) {
  const clean = (Array.isArray(values) ? values : [])
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!clean.length) return null;
  const trim = Math.min(
    Math.floor(clean.length * trimFraction),
    Math.max(0, Math.floor((clean.length - 1) / 2)),
  );
  const window = clean.slice(trim, clean.length - trim || clean.length);
  return window.reduce((sum, value) => sum + value, 0) / window.length;
}

export function structuralAtr(candles, period = 14, trimFraction = 0.2) {
  const rows = Array.isArray(candles) ? candles : [];
  if (!rows.length) return null;
  const ranges = [];
  for (let index = 0; index < rows.length; index += 1) {
    const value = trueRange(rows[index], rows[index - 1]?.close);
    if (Number.isFinite(value)) ranges.push(value);
  }
  return robustMean(ranges.slice(-Math.max(1, Math.round(period))), trimFraction);
}

export function structuralAtrPercent(candles, period = 14, trimFraction = 0.2) {
  const rows = Array.isArray(candles) ? candles : [];
  if (!rows.length) return null;
  const percentages = [];
  for (let index = 0; index < rows.length; index += 1) {
    const previousClose = rows[index - 1]?.close ?? rows[index]?.open;
    const range = trueRange(rows[index], previousClose);
    if (Number.isFinite(range) && previousClose > 0) percentages.push(range / previousClose * 100);
  }
  return robustMean(percentages.slice(-Math.max(1, Math.round(period))), trimFraction);
}

function toTicks(price, tickSize) {
  const value = finite(price);
  if (!(value > 0)) throw new TypeError("price must be positive");
  return Math.round(value / tickSize);
}

function percentDistance(from, to) {
  if (!(from > 0) || !Number.isFinite(to)) return 0;
  return Math.abs(to - from) / from * 100;
}

function candidatePublic(candidate) {
  return candidate ? Object.freeze({ ...candidate }) : null;
}

function extremePublic(row) {
  if (!row) return null;
  const { attackState, rearmed, crossedBarIndex, piercedBarIndex, acceptanceCount, ...publicRow } = row;
  return Object.freeze({ ...publicRow });
}

function makeCandidate(side, price, priceTicks, candle, barIndex) {
  return {
    side,
    price,
    priceTicks,
    extremeAt: candle.time,
    detectedAt: candle.closeTime,
    barIndex,
    movedCount: 0,
    status: STRUCTURAL_EXTREME_STATUSES.CANDIDATE,
  };
}

function eventRecord(type, at, payload = {}) {
  return Object.freeze({ type, at, ...payload });
}

export class StructuralExtremeEngine {
  constructor({ symbol, timeframe, tickSize, config = {}, restoredState = null }) {
    this.symbol = normalizeSymbol(symbol);
    this.timeframe = normalizeTimeframe(timeframe);
    this.intervalMs = TIMEFRAME_MS[this.timeframe];
    if (!this.symbol || !this.timeframe || !this.intervalMs) throw new TypeError("Unsupported symbol or timeframe");
    this.tickSize = normalizeTickSize(tickSize);
    this.config = mergeConfig(this.timeframe, config);
    this.timeframeStrength = STRUCTURAL_TIMEFRAME_STRENGTH[this.timeframe];
    this.direction = STRUCTURAL_DIRECTIONS.UNDEFINED;
    this.candidate = null;
    this.oppositeCandidate = null;
    this.bootstrap = null;
    this.movementStart = null;
    this.candles = [];
    this.lastCandleTime = null;
    this.barIndex = -1;
    this.extremes = [];
    this.extremeById = new Map();
    this.activeExtremeIds = new Set();
    this.lastConfirmedHighId = null;
    this.lastConfirmedLowId = null;
    this.eventLog = [];
    this.lastDiagnostic = Object.freeze({ reason: "WAITING_FIRST_CLOSED_CANDLE", direction: this.direction });
    if (restoredState) this.#restore(restoredState);
  }

  ingestCandles(rows, options = {}) {
    const normalized = (Array.isArray(rows) ? rows : [])
      .map((row) => normalizeCandle(row, this.intervalMs))
      .filter((row) => row?.closed)
      .sort((left, right) => left.time - right.time);
    const snapshots = [];
    for (const candle of normalized) {
      if (this.lastCandleTime !== null && candle.time <= this.lastCandleTime) continue;
      snapshots.push(this.ingestCandle(candle, { ...options, emitSnapshot: true }));
    }
    return options.includeSteps ? snapshots : this.snapshot();
  }

  ingestCandle(raw, { emitSnapshot = true } = {}) {
    const candle = normalizeCandle(raw, this.intervalMs);
    if (!candle?.closed) return emitSnapshot ? this.snapshot() : null;
    if (this.lastCandleTime !== null && candle.time <= this.lastCandleTime) return emitSnapshot ? this.snapshot() : null;
    this.barIndex += 1;
    this.lastCandleTime = candle.time;
    this.candles.push(candle);
    const candleLimit = Math.max(this.config.atrPeriod + 8, 96);
    if (this.candles.length > candleLimit) this.candles.shift();
    this.#observeLifecycle(candle);
    if (this.direction === STRUCTURAL_DIRECTIONS.UNDEFINED) this.#bootstrapDirection(candle);
    else if (this.direction === STRUCTURAL_DIRECTIONS.TRACKING_UP) this.#advanceUp(candle);
    else this.#advanceDown(candle);
    return emitSnapshot ? this.snapshot() : null;
  }

  #bootstrapDirection(candle) {
    if (!this.bootstrap) {
      this.bootstrap = {
        anchorPrice: candle.close,
        anchorAt: candle.time,
        high: candle.high,
        highAt: candle.time,
        highCloseTime: candle.closeTime,
        highBarIndex: this.barIndex,
        low: candle.low,
        lowAt: candle.time,
        lowCloseTime: candle.closeTime,
        lowBarIndex: this.barIndex,
      };
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "BOOTSTRAP_ANCHOR_CREATED",
        swingAmplitudePct: 0,
        reversalPct: 0,
        thresholdPct: this.#reversalThresholdPct(candle.close).thresholdPct,
      });
      return;
    }
    if (candle.high > this.bootstrap.high) {
      this.bootstrap.high = candle.high;
      this.bootstrap.highAt = candle.time;
      this.bootstrap.highCloseTime = candle.closeTime;
      this.bootstrap.highBarIndex = this.barIndex;
    }
    if (candle.low < this.bootstrap.low) {
      this.bootstrap.low = candle.low;
      this.bootstrap.lowAt = candle.time;
      this.bootstrap.lowCloseTime = candle.closeTime;
      this.bootstrap.lowBarIndex = this.barIndex;
    }
    const upAmplitude = percentDistance(this.bootstrap.low, this.bootstrap.high);
    const downAmplitude = percentDistance(this.bootstrap.high, this.bootstrap.low);
    const upOrdered = this.bootstrap.highAt >= this.bootstrap.lowAt;
    const downOrdered = this.bootstrap.lowAt >= this.bootstrap.highAt;
    if (upOrdered && upAmplitude >= this.config.minimumSwingPercent) {
      this.direction = STRUCTURAL_DIRECTIONS.TRACKING_UP;
      this.movementStart = { side: "LOW", price: this.bootstrap.low, at: this.bootstrap.lowAt, extremeId: null };
      this.candidate = makeCandidate(
        "HIGH",
        this.bootstrap.high,
        toTicks(this.bootstrap.high, this.tickSize),
        { time: this.bootstrap.highAt, closeTime: this.bootstrap.highCloseTime },
        this.bootstrap.highBarIndex,
      );
      this.oppositeCandidate = null;
      this.eventLog.push(eventRecord("DIRECTION_DEFINED", candle.closeTime, { direction: this.direction, candidatePrice: this.candidate.price }));
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "DIRECTION_DEFINED_UP",
        swingAmplitudePct: upAmplitude,
        reversalPct: percentDistance(this.candidate.price, candle.close),
        thresholdPct: this.#reversalThresholdPct(this.candidate.price).thresholdPct,
      });
      this.bootstrap = null;
      return;
    }
    if (downOrdered && downAmplitude >= this.config.minimumSwingPercent) {
      this.direction = STRUCTURAL_DIRECTIONS.TRACKING_DOWN;
      this.movementStart = { side: "HIGH", price: this.bootstrap.high, at: this.bootstrap.highAt, extremeId: null };
      this.candidate = makeCandidate(
        "LOW",
        this.bootstrap.low,
        toTicks(this.bootstrap.low, this.tickSize),
        { time: this.bootstrap.lowAt, closeTime: this.bootstrap.lowCloseTime },
        this.bootstrap.lowBarIndex,
      );
      this.oppositeCandidate = null;
      this.eventLog.push(eventRecord("DIRECTION_DEFINED", candle.closeTime, { direction: this.direction, candidatePrice: this.candidate.price }));
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "DIRECTION_DEFINED_DOWN",
        swingAmplitudePct: downAmplitude,
        reversalPct: percentDistance(this.candidate.price, candle.close),
        thresholdPct: this.#reversalThresholdPct(this.candidate.price).thresholdPct,
      });
      this.bootstrap = null;
      return;
    }
    this.lastDiagnostic = this.#diagnostic({
      candle,
      reason: "WAITING_SIGNIFICANT_BOOTSTRAP_MOVE",
      swingAmplitudePct: Math.max(upAmplitude, downAmplitude),
      reversalPct: 0,
      thresholdPct: this.config.minimumSwingPercent,
    });
  }

  #advanceUp(candle) {
    const highTicks = toTicks(candle.high, this.tickSize);
    if (!this.candidate) {
      this.candidate = makeCandidate("HIGH", candle.high, highTicks, candle, this.barIndex);
      this.oppositeCandidate = null;
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "HIGH_CANDIDATE_CREATED",
        swingAmplitudePct: this.#swingAmplitudePct(this.candidate.price),
        reversalPct: 0,
        thresholdPct: this.#reversalThresholdPct(this.candidate.price).thresholdPct,
      });
      return;
    }
    if (highTicks > this.candidate.priceTicks) {
      const previousPrice = this.candidate.price;
      this.candidate = { ...makeCandidate("HIGH", candle.high, highTicks, candle, this.barIndex), movedCount: this.candidate.movedCount + 1 };
      this.oppositeCandidate = null;
      this.eventLog.push(eventRecord("CANDIDATE_MOVED", candle.closeTime, {
        side: "HIGH",
        fromPrice: previousPrice,
        toPrice: this.candidate.price,
        extremeAt: this.candidate.extremeAt,
      }));
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "HIGH_CANDIDATE_MOVED",
        swingAmplitudePct: this.#swingAmplitudePct(this.candidate.price),
        reversalPct: percentDistance(this.candidate.price, candle.close),
        thresholdPct: this.#reversalThresholdPct(this.candidate.price).thresholdPct,
      });
      return;
    }
    this.#updateOppositeCandidate("LOW", candle);
    const threshold = this.#reversalThresholdPct(this.candidate.price);
    const confirmationPrice = this.config.confirmationSource === "wick" ? candle.low : candle.close;
    const reversalPct = Math.max(0, (this.candidate.price - confirmationPrice) / this.candidate.price * 100);
    this.#tryConfirm("HIGH", candle, reversalPct, threshold);
  }

  #advanceDown(candle) {
    const lowTicks = toTicks(candle.low, this.tickSize);
    if (!this.candidate) {
      this.candidate = makeCandidate("LOW", candle.low, lowTicks, candle, this.barIndex);
      this.oppositeCandidate = null;
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "LOW_CANDIDATE_CREATED",
        swingAmplitudePct: this.#swingAmplitudePct(this.candidate.price),
        reversalPct: 0,
        thresholdPct: this.#reversalThresholdPct(this.candidate.price).thresholdPct,
      });
      return;
    }
    if (lowTicks < this.candidate.priceTicks) {
      const previousPrice = this.candidate.price;
      this.candidate = { ...makeCandidate("LOW", candle.low, lowTicks, candle, this.barIndex), movedCount: this.candidate.movedCount + 1 };
      this.oppositeCandidate = null;
      this.eventLog.push(eventRecord("CANDIDATE_MOVED", candle.closeTime, {
        side: "LOW",
        fromPrice: previousPrice,
        toPrice: this.candidate.price,
        extremeAt: this.candidate.extremeAt,
      }));
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "LOW_CANDIDATE_MOVED",
        swingAmplitudePct: this.#swingAmplitudePct(this.candidate.price),
        reversalPct: percentDistance(this.candidate.price, candle.close),
        thresholdPct: this.#reversalThresholdPct(this.candidate.price).thresholdPct,
      });
      return;
    }
    this.#updateOppositeCandidate("HIGH", candle);
    const threshold = this.#reversalThresholdPct(this.candidate.price);
    const confirmationPrice = this.config.confirmationSource === "wick" ? candle.high : candle.close;
    const reversalPct = Math.max(0, (confirmationPrice - this.candidate.price) / this.candidate.price * 100);
    this.#tryConfirm("LOW", candle, reversalPct, threshold);
  }

  #updateOppositeCandidate(side, candle) {
    if (!this.candidate || this.barIndex <= this.candidate.barIndex) return;
    const price = side === "LOW" ? candle.low : candle.high;
    const priceTicks = toTicks(price, this.tickSize);
    const shouldReplace = !this.oppositeCandidate
      || (side === "LOW" && priceTicks < this.oppositeCandidate.priceTicks)
      || (side === "HIGH" && priceTicks > this.oppositeCandidate.priceTicks);
    if (!shouldReplace) return;
    const previousPrice = this.oppositeCandidate?.price ?? null;
    this.oppositeCandidate = makeCandidate(side, price, priceTicks, candle, this.barIndex);
    this.eventLog.push(eventRecord(
      previousPrice === null ? "OPPOSITE_CANDIDATE_CREATED" : "OPPOSITE_CANDIDATE_MOVED",
      candle.closeTime,
      { side, fromPrice: previousPrice, toPrice: price, extremeAt: candle.time },
    ));
  }

  #tryConfirm(side, candle, reversalPct, threshold) {
    const swingAmplitudePct = this.#swingAmplitudePct(this.candidate.price);
    const barsAfterCandidate = this.barIndex - this.candidate.barIndex;
    if (barsAfterCandidate < this.config.minimumBarsAfterCandidate) {
      this.lastDiagnostic = this.#diagnostic({ candle, reason: `WAITING_MINIMUM_BARS_AFTER_${side}`, swingAmplitudePct, reversalPct, thresholdPct: threshold.thresholdPct });
      return;
    }
    if (swingAmplitudePct < this.config.minimumSwingPercent) {
      this.lastDiagnostic = this.#diagnostic({ candle, reason: `${side}_SWING_AMPLITUDE_TOO_SMALL`, swingAmplitudePct, reversalPct, thresholdPct: threshold.thresholdPct });
      return;
    }
    if (reversalPct < threshold.thresholdPct) {
      this.lastDiagnostic = this.#diagnostic({ candle, reason: `${side}_REVERSAL_BELOW_THRESHOLD`, swingAmplitudePct, reversalPct, thresholdPct: threshold.thresholdPct });
      return;
    }
    this.#confirm(side, candle, { swingAmplitudePct, reversalPct, threshold });
  }

  #confirm(side, confirmationCandle, metrics) {
    const source = this.candidate;
    if (!source || source.side !== side) return null;
    const previousOppositeId = side === "HIGH" ? this.lastConfirmedLowId : this.lastConfirmedHighId;
    const id = [this.symbol, this.timeframe, side, source.extremeAt, source.priceTicks, STRUCTURAL_EXTREME_ALGORITHM_VERSION].join(":");
    if (this.extremeById.has(id)) return this.extremeById.get(id);
    const row = {
      id,
      symbol: this.symbol,
      timeframe: this.timeframe,
      timeframeStrength: { ...this.timeframeStrength },
      side,
      price: source.price,
      normalizedPrice: source.priceTicks,
      extremeAt: source.extremeAt,
      confirmedAt: confirmationCandle.closeTime,
      status: STRUCTURAL_EXTREME_STATUSES.CONFIRMED_ACTIVE,
      active: true,
      previousOppositeExtremeId: previousOppositeId ?? undefined,
      swingAmplitudePct: round(metrics.swingAmplitudePct),
      confirmingReversalPct: round(metrics.reversalPct),
      reversalThresholdPct: round(metrics.threshold.thresholdPct),
      atrAtConfirmation: round(metrics.threshold.atr),
      atrPercentAtConfirmation: round(metrics.threshold.atrPercent),
      atrWasCapped: metrics.threshold.atrWasCapped,
      touchCount: 0,
      pierceCount: 0,
      piercedAt: undefined,
      lastRejectedPierceAt: undefined,
      crossedAt: undefined,
      acceptedAt: undefined,
      rejectedAt: undefined,
      algorithmVersion: STRUCTURAL_EXTREME_ALGORITHM_VERSION,
      diagnostic: {
        reason: side === "HIGH" ? "STRUCTURAL_HIGH_CONFIRMED" : "STRUCTURAL_LOW_CONFIRMED",
        movementStartPrice: this.movementStart?.price ?? null,
        movementStartAt: this.movementStart?.at ?? null,
        candidateMovedCount: source.movedCount,
        barsAfterCandidate: this.barIndex - source.barIndex,
        confirmationSource: this.config.confirmationSource,
        oppositeCandidatePreserved: Boolean(this.oppositeCandidate),
      },
      attackState: "AWAY",
      rearmed: false,
      crossedBarIndex: null,
      piercedBarIndex: null,
      acceptanceCount: 0,
    };
    this.extremes.push(row);
    if (this.extremes.length > this.config.historyLimit) {
      const removed = this.extremes.shift();
      if (removed) {
        this.extremeById.delete(removed.id);
        this.activeExtremeIds.delete(removed.id);
      }
    }
    this.extremeById.set(id, row);
    this.activeExtremeIds.add(id);
    if (side === "HIGH") this.lastConfirmedHighId = id;
    else this.lastConfirmedLowId = id;
    this.eventLog.push(eventRecord("EXTREME_CONFIRMED", confirmationCandle.closeTime, {
      extremeId: id,
      side,
      price: row.price,
      extremeAt: row.extremeAt,
      confirmedAt: row.confirmedAt,
    }));
    this.lastDiagnostic = this.#diagnostic({
      candle: confirmationCandle,
      reason: row.diagnostic.reason,
      swingAmplitudePct: row.swingAmplitudePct,
      reversalPct: row.confirmingReversalPct,
      thresholdPct: row.reversalThresholdPct,
      confirmedExtremeId: row.id,
    });
    const preservedOpposite = this.oppositeCandidate;
    if (side === "HIGH") {
      this.direction = STRUCTURAL_DIRECTIONS.TRACKING_DOWN;
      this.movementStart = { side: "HIGH", price: row.price, at: row.extremeAt, extremeId: row.id };
      this.candidate = preservedOpposite?.side === "LOW"
        ? { ...preservedOpposite }
        : makeCandidate("LOW", confirmationCandle.low, toTicks(confirmationCandle.low, this.tickSize), confirmationCandle, this.barIndex);
    } else {
      this.direction = STRUCTURAL_DIRECTIONS.TRACKING_UP;
      this.movementStart = { side: "LOW", price: row.price, at: row.extremeAt, extremeId: row.id };
      this.candidate = preservedOpposite?.side === "HIGH"
        ? { ...preservedOpposite }
        : makeCandidate("HIGH", confirmationCandle.high, toTicks(confirmationCandle.high, this.tickSize), confirmationCandle, this.barIndex);
    }
    this.oppositeCandidate = null;
    return row;
  }

  #observeLifecycle(candle) {
    const lowTicks = toTicks(candle.low, this.tickSize);
    const highTicks = toTicks(candle.high, this.tickSize);
    const closeTicks = toTicks(candle.close, this.tickSize);

    const restoreAfterRejectedPierce = (row) => {
      row.status = row.touchCount > 0
        ? STRUCTURAL_EXTREME_STATUSES.TOUCHED
        : STRUCTURAL_EXTREME_STATUSES.CONFIRMED_ACTIVE;
      row.lastRejectedPierceAt = candle.closeTime;
      row.acceptanceCount = 0;
      row.piercedBarIndex = null;
      row.attackState = "AWAY";
      row.rearmed = false;
      this.activeExtremeIds.add(row.id);
      this.eventLog.push(eventRecord("EXTREME_PIERCE_REJECTED", candle.closeTime, {
        extremeId: row.id,
        side: row.side,
        price: row.price,
        pierceCount: row.pierceCount,
      }));
    };

    const acceptBreak = (row) => {
      row.active = false;
      row.status = STRUCTURAL_EXTREME_STATUSES.ACCEPTED;
      row.acceptedAt = candle.closeTime;
      // crossedAt remains the backwards-compatible terminal ray end.
      row.crossedAt = candle.closeTime;
      row.crossedBarIndex = this.barIndex;
      row.acceptanceCount = 0;
      this.activeExtremeIds.delete(row.id);
      this.eventLog.push(eventRecord("EXTREME_BREAK_ACCEPTED", candle.closeTime, {
        extremeId: row.id,
        side: row.side,
        price: row.price,
        pierceCount: row.pierceCount,
      }));
    };

    for (const row of this.extremes) {
      if (!row.active) continue;

      if (row.status === STRUCTURAL_EXTREME_STATUSES.PIERCED) {
        const closeBeyond = row.side === "HIGH"
          ? closeTicks > row.normalizedPrice
          : closeTicks < row.normalizedPrice;
        if (!closeBeyond) {
          restoreAfterRejectedPierce(row);
          continue;
        }
        row.acceptanceCount += 1;
        if (row.acceptanceCount >= this.config.acceptanceBars) acceptBreak(row);
        continue;
      }

      // V3.9: touching the exact exchange tick is an attack. A print through
      // the level is only a pierce attempt until price is accepted beyond it.
      const pierced = row.side === "HIGH"
        ? highTicks > row.normalizedPrice
        : lowTicks < row.normalizedPrice;
      if (pierced) {
        row.status = STRUCTURAL_EXTREME_STATUSES.PIERCED;
        row.piercedAt = candle.closeTime;
        row.piercedBarIndex = this.barIndex;
        row.pierceCount = Math.max(0, Number(row.pierceCount) || 0) + 1;
        row.acceptanceCount = 0;
        row.attackState = "AWAY";
        row.rearmed = false;
        this.eventLog.push(eventRecord("EXTREME_PIERCED", candle.closeTime, {
          extremeId: row.id,
          side: row.side,
          price: row.price,
          pierceCount: row.pierceCount,
        }));

        const closeBeyond = row.side === "HIGH"
          ? closeTicks > row.normalizedPrice
          : closeTicks < row.normalizedPrice;
        if (!closeBeyond) {
          restoreAfterRejectedPierce(row);
          continue;
        }
        row.acceptanceCount = 1;
        if (row.acceptanceCount >= this.config.acceptanceBars) acceptBreak(row);
        continue;
      }

      const exactAttack = row.side === "HIGH"
        ? highTicks === row.normalizedPrice
        : lowTicks === row.normalizedPrice;
      if (exactAttack) {
        if (row.attackState !== "AT_LEVEL") {
          if (row.rearmed && candle.closeTime > row.confirmedAt) {
            row.touchCount += 1;
            row.status = STRUCTURAL_EXTREME_STATUSES.TOUCHED;
            this.eventLog.push(eventRecord("EXTREME_ATTACKED", candle.closeTime, {
              extremeId: row.id,
              attackRetestCount: row.touchCount,
              attackPrice: row.price,
              semantics: "EXACT_PRICE_TICK",
            }));
          }
          row.attackState = "AT_LEVEL";
          row.rearmed = false;
        }
        continue;
      }

      row.attackState = "AWAY";
      const thresholdPct = Math.max(this.config.minimumPercent, row.reversalThresholdPct ?? this.config.minimumPercent);
      // Volatility separates independent attacks but never widens the attack price.
      const rearmPct = Math.max(0.01, thresholdPct * this.config.rearmDistanceFactor);
      const distancePct = row.side === "HIGH"
        ? Math.max(0, (row.price - candle.close) / row.price * 100)
        : Math.max(0, (candle.close - row.price) / row.price * 100);
      if (distancePct >= rearmPct) row.rearmed = true;
    }
  }

  #reversalThresholdPct(candidatePrice) {
    const atr = structuralAtr(this.candles, this.config.atrPeriod, this.config.atrTrimFraction);
    const atrPercent = structuralAtrPercent(this.candles, this.config.atrPeriod, this.config.atrTrimFraction) ?? 0;
    const rawAtrComponent = atrPercent * this.config.atrMultiplier;
    const cappedAtrComponent = Math.min(this.config.maximumPercent, rawAtrComponent);
    const tickSizeBufferPercent = candidatePrice > 0
      ? this.tickSize * this.config.tickSizeBufferTicks / candidatePrice * 100
      : 0;
    return {
      thresholdPct: Math.max(this.config.minimumPercent, cappedAtrComponent, tickSizeBufferPercent),
      atr,
      atrPercent,
      rawAtrComponent,
      cappedAtrComponent,
      atrWasCapped: rawAtrComponent > this.config.maximumPercent,
      tickSizeBufferPercent,
    };
  }

  #swingAmplitudePct(candidatePrice) {
    const startPrice = this.movementStart?.price;
    return startPrice > 0 ? Math.abs(candidatePrice - startPrice) / startPrice * 100 : 0;
  }

  #diagnostic({ candle, reason, swingAmplitudePct, reversalPct, thresholdPct, confirmedExtremeId = null }) {
    const previousOppositeId = this.direction === STRUCTURAL_DIRECTIONS.TRACKING_UP
      ? this.lastConfirmedLowId
      : this.direction === STRUCTURAL_DIRECTIONS.TRACKING_DOWN
        ? this.lastConfirmedHighId
        : null;
    const threshold = this.candidate
      ? this.#reversalThresholdPct(this.candidate.price)
      : this.#reversalThresholdPct(candle?.close ?? 1);
    return Object.freeze({
      at: candle?.closeTime ?? null,
      candleTime: candle?.time ?? null,
      direction: this.direction,
      candidate: candidatePublic(this.candidate),
      oppositeCandidate: candidatePublic(this.oppositeCandidate),
      previousOppositeExtremeId: previousOppositeId,
      movementStart: this.movementStart ? { ...this.movementStart } : null,
      timeframeStrength: { ...this.timeframeStrength },
      swingAmplitudePct: round(swingAmplitudePct),
      confirmingReversalPct: round(reversalPct),
      requiredReversalPct: round(thresholdPct),
      atr: round(threshold.atr),
      atrPercent: round(threshold.atrPercent),
      rawAtrComponent: round(threshold.rawAtrComponent),
      cappedAtrComponent: round(threshold.cappedAtrComponent),
      atrWasCapped: threshold.atrWasCapped,
      parameters: {
        minimumPercent: this.config.minimumPercent,
        atrMultiplier: this.config.atrMultiplier,
        maximumPercent: this.config.maximumPercent,
        minimumSwingPercent: this.config.minimumSwingPercent,
        minimumBarsAfterCandidate: this.config.minimumBarsAfterCandidate,
        confirmationSource: this.config.confirmationSource,
        tickSizeBufferTicks: this.config.tickSizeBufferTicks,
        crossingToleranceTicks: this.config.crossingToleranceTicks,
        touchZoneTicks: this.config.touchZoneTicks,
        touchZoneFactor: this.config.touchZoneFactor,
        maximumTouchZonePercent: this.config.maximumTouchZonePercent,
      },
      reason,
      confirmedExtremeId,
    });
  }

  activeExtremes(side = null) {
    return [...this.activeExtremeIds]
      .map((id) => this.extremeById.get(id))
      .filter((row) => row?.active && (!side || row.side === side))
      .map(extremePublic);
  }

  snapshot({ includeHistory = true, includeEvents = true } = {}) {
    return Object.freeze({
      schemaVersion: 3,
      entity: "SignalLabStructuralExtremeMap",
      algorithmVersion: STRUCTURAL_EXTREME_ALGORITHM_VERSION,
      symbol: this.symbol,
      timeframe: this.timeframe,
      timeframeStrength: { ...this.timeframeStrength },
      tickSize: this.tickSize,
      direction: this.direction,
      candidate: candidatePublic(this.candidate),
      oppositeCandidate: candidatePublic(this.oppositeCandidate),
      previousConfirmedOpposite: extremePublic(
        this.extremeById.get(
          this.direction === STRUCTURAL_DIRECTIONS.TRACKING_UP
            ? this.lastConfirmedLowId
            : this.lastConfirmedHighId,
        ),
      ),
      active: Object.freeze(this.activeExtremes()),
      history: Object.freeze(includeHistory ? this.extremes.map(extremePublic) : []),
      diagnostics: this.lastDiagnostic,
      events: Object.freeze(includeEvents ? clone(this.eventLog) : []),
      lastCandleTime: this.lastCandleTime,
      barIndex: this.barIndex,
    });
  }

  serialize() {
    return clone({
      algorithmVersion: STRUCTURAL_EXTREME_ALGORITHM_VERSION,
      symbol: this.symbol,
      timeframe: this.timeframe,
      tickSize: this.tickSize,
      config: this.config,
      direction: this.direction,
      candidate: this.candidate,
      oppositeCandidate: this.oppositeCandidate,
      bootstrap: this.bootstrap,
      movementStart: this.movementStart,
      candles: this.candles,
      lastCandleTime: this.lastCandleTime,
      barIndex: this.barIndex,
      extremes: this.extremes,
      activeExtremeIds: [...this.activeExtremeIds],
      lastConfirmedHighId: this.lastConfirmedHighId,
      lastConfirmedLowId: this.lastConfirmedLowId,
      eventLog: this.eventLog,
      lastDiagnostic: this.lastDiagnostic,
    });
  }

  #restore(state) {
    if (state?.algorithmVersion !== STRUCTURAL_EXTREME_ALGORITHM_VERSION) throw new Error("Unsupported structural extreme state version");
    if (state.symbol !== this.symbol || state.timeframe !== this.timeframe) throw new Error("Restored state belongs to another symbol or timeframe");
    this.direction = state.direction;
    this.candidate = clone(state.candidate);
    this.oppositeCandidate = clone(state.oppositeCandidate);
    this.bootstrap = clone(state.bootstrap);
    this.movementStart = clone(state.movementStart);
    this.candles = clone(state.candles ?? []);
    this.lastCandleTime = finite(state.lastCandleTime);
    this.barIndex = Math.round(finite(state.barIndex) ?? -1);
    this.extremes = clone(state.extremes ?? []);
    this.extremeById = new Map(this.extremes.map((row) => [row.id, row]));
    this.activeExtremeIds = new Set((state.activeExtremeIds ?? []).filter((id) => this.extremeById.get(id)?.active));
    this.lastConfirmedHighId = state.lastConfirmedHighId ?? null;
    this.lastConfirmedLowId = state.lastConfirmedLowId ?? null;
    this.eventLog = clone(state.eventLog ?? []);
    this.lastDiagnostic = Object.freeze(clone(state.lastDiagnostic ?? this.lastDiagnostic));
  }

  static restore(state) {
    return new StructuralExtremeEngine({
      symbol: state?.symbol,
      timeframe: state?.timeframe,
      tickSize: state?.tickSize,
      config: state?.config,
      restoredState: state,
    });
  }
}

export class StructuralExtremeRegistry {
  constructor({ config = {} } = {}) {
    this.config = config;
    this.engines = new Map();
  }

  #key(symbol, timeframe) {
    return `${normalizeSymbol(symbol)}:${timeframe}`;
  }

  engine(symbol, timeframe, tickSize) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const normalizedTimeframe = normalizeTimeframe(timeframe);
    if (!normalizedSymbol || !normalizedTimeframe || !(finite(tickSize) > 0)) return null;
    const key = this.#key(normalizedSymbol, normalizedTimeframe);
    if (!this.engines.has(key)) {
      this.engines.set(key, new StructuralExtremeEngine({
        symbol: normalizedSymbol,
        timeframe: normalizedTimeframe,
        tickSize,
        config: {
          ...(this.config.common ?? {}),
          ...(this.config.timeframes?.[normalizedTimeframe] ?? {}),
        },
      }));
    }
    return this.engines.get(key);
  }

  ingest(symbol, timeframe, tickSize, candles, options = {}) {
    return this.engine(symbol, timeframe, tickSize)?.ingestCandles(candles, options) ?? null;
  }

  snapshot(symbol) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return null;
    const timeframes = {};
    for (const timeframe of STRUCTURAL_TIMEFRAMES) {
      const engine = this.engines.get(this.#key(normalized, timeframe));
      if (engine) timeframes[timeframe] = engine.snapshot();
    }
    return Object.freeze({
      schemaVersion: 3,
      entity: "SignalLabMultiTimeframeStructuralExtremeMap",
      algorithmVersion: STRUCTURAL_EXTREME_ALGORITHM_VERSION,
      symbol: normalized,
      timeframes: Object.freeze(timeframes),
    });
  }
}

export function replayStructuralExtremes(options, candles) {
  const engine = new StructuralExtremeEngine(options);
  const steps = [];
  for (const candle of Array.isArray(candles) ? candles : []) steps.push(engine.ingestCandle(candle));
  return Object.freeze({
    steps: Object.freeze(steps),
    final: engine.snapshot(),
    serializedState: engine.serialize(),
  });
}
