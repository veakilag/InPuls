export const STRUCTURAL_EXTREME_ALGORITHM_VERSION = "signal-lab-structural-extremes-stage1-v1-2026-08";

export const STRUCTURAL_DIRECTIONS = Object.freeze({
  UNDEFINED: "UNDEFINED",
  TRACKING_UP: "TRACKING_UP",
  TRACKING_DOWN: "TRACKING_DOWN",
});

export const STRUCTURAL_EXTREME_STATUSES = Object.freeze({
  CANDIDATE: "CANDIDATE",
  CONFIRMED_ACTIVE: "CONFIRMED_ACTIVE",
  TOUCHED: "TOUCHED",
  CROSSED: "CROSSED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
});

export const STRUCTURAL_TIMEFRAMES = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);

export const DEFAULT_STRUCTURAL_EXTREME_CONFIG = Object.freeze({
  atrPeriod: 14,
  minimumBarsAfterCandidate: 2,
  tickSizeBufferTicks: 3,
  touchZoneTicks: 1,
  rearmDistanceFactor: 0.7,
  acceptanceBars: 2,
  rejectionBars: 3,
  historyLimit: 10_000,
  timeframes: Object.freeze({
    "1m": Object.freeze({ minimumPercent: 0.20, atrMultiplier: 1.0, minimumSwingPercent: 0.30 }),
    "5m": Object.freeze({ minimumPercent: 0.35, atrMultiplier: 1.1, minimumSwingPercent: 0.525 }),
    "15m": Object.freeze({ minimumPercent: 0.50, atrMultiplier: 1.2, minimumSwingPercent: 0.75 }),
    "1h": Object.freeze({ minimumPercent: 0.80, atrMultiplier: 1.3, minimumSwingPercent: 1.20 }),
    "4h": Object.freeze({ minimumPercent: 1.20, atrMultiplier: 1.5, minimumSwingPercent: 1.80 }),
    "1d": Object.freeze({ minimumPercent: 2.00, atrMultiplier: 1.7, minimumSwingPercent: 3.00 }),
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
    minimumBarsAfterCandidate: Math.max(
      0,
      Math.round(finite(config.minimumBarsAfterCandidate) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.minimumBarsAfterCandidate),
    ),
    tickSizeBufferTicks: Math.max(
      1,
      Math.round(finite(config.tickSizeBufferTicks) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.tickSizeBufferTicks),
    ),
    touchZoneTicks: Math.max(
      0,
      Math.round(finite(config.touchZoneTicks) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.touchZoneTicks),
    ),
    rearmDistanceFactor: Math.max(
      0.1,
      finite(config.rearmDistanceFactor) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.rearmDistanceFactor,
    ),
    acceptanceBars: Math.max(
      1,
      Math.round(finite(config.acceptanceBars) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.acceptanceBars),
    ),
    rejectionBars: Math.max(
      1,
      Math.round(finite(config.rejectionBars) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.rejectionBars),
    ),
    historyLimit: Math.max(
      100,
      Math.round(finite(config.historyLimit) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.historyLimit),
    ),
    minimumPercent: Math.max(0, finite(config.minimumPercent) ?? defaults.minimumPercent),
    atrMultiplier: Math.max(0, finite(config.atrMultiplier) ?? defaults.atrMultiplier),
    minimumSwingPercent: Math.max(
      0,
      finite(config.minimumSwingPercent) ?? defaults.minimumSwingPercent,
    ),
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

export function structuralAtr(candles, period = 14) {
  const rows = Array.isArray(candles) ? candles : [];
  if (!rows.length) return null;
  const ranges = [];
  for (let index = 0; index < rows.length; index += 1) {
    const value = trueRange(rows[index], rows[index - 1]?.close);
    if (Number.isFinite(value)) ranges.push(value);
  }
  const window = ranges.slice(-Math.max(1, Math.round(period)));
  return window.length ? window.reduce((sum, value) => sum + value, 0) / window.length : null;
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
  const {
    attackState,
    rearmed,
    crossedBarIndex,
    acceptanceCount,
    ...publicRow
  } = row;
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
  constructor({
    symbol,
    timeframe,
    tickSize,
    config = {},
    restoredState = null,
  }) {
    this.symbol = normalizeSymbol(symbol);
    this.timeframe = normalizeTimeframe(timeframe);
    this.intervalMs = TIMEFRAME_MS[this.timeframe];
    if (!this.symbol || !this.timeframe || !this.intervalMs) {
      throw new TypeError("Unsupported symbol or timeframe");
    }
    this.tickSize = normalizeTickSize(tickSize);
    this.config = mergeConfig(this.timeframe, config);
    this.direction = STRUCTURAL_DIRECTIONS.UNDEFINED;
    this.candidate = null;
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
    this.lastDiagnostic = Object.freeze({
      reason: "WAITING_FIRST_CLOSED_CANDLE",
      direction: this.direction,
    });
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
    if (this.lastCandleTime !== null && candle.time <= this.lastCandleTime) {
      return emitSnapshot ? this.snapshot() : null;
    }

    this.barIndex += 1;
    this.lastCandleTime = candle.time;
    this.candles.push(candle);
    const candleLimit = Math.max(this.config.atrPeriod + 4, 64);
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
        low: candle.low,
        lowAt: candle.time,
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
    }
    if (candle.low < this.bootstrap.low) {
      this.bootstrap.low = candle.low;
      this.bootstrap.lowAt = candle.time;
    }

    const upAmplitude = percentDistance(this.bootstrap.low, this.bootstrap.high);
    const downAmplitude = percentDistance(this.bootstrap.high, this.bootstrap.low);
    const upOrdered = this.bootstrap.highAt >= this.bootstrap.lowAt;
    const downOrdered = this.bootstrap.lowAt >= this.bootstrap.highAt;

    if (upOrdered && upAmplitude >= this.config.minimumSwingPercent) {
      this.direction = STRUCTURAL_DIRECTIONS.TRACKING_UP;
      this.movementStart = {
        side: "LOW",
        price: this.bootstrap.low,
        at: this.bootstrap.lowAt,
        extremeId: null,
      };
      this.candidate = makeCandidate(
        "HIGH",
        this.bootstrap.high,
        toTicks(this.bootstrap.high, this.tickSize),
        { ...candle, time: this.bootstrap.highAt },
        this.barIndex,
      );
      this.eventLog.push(eventRecord("DIRECTION_DEFINED", candle.closeTime, {
        direction: this.direction,
        candidatePrice: this.candidate.price,
      }));
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "DIRECTION_DEFINED_UP",
        swingAmplitudePct: upAmplitude,
        reversalPct: percentDistance(this.candidate.price, candle.low),
        thresholdPct: this.#reversalThresholdPct(this.candidate.price).thresholdPct,
      });
      this.bootstrap = null;
      return;
    }

    if (downOrdered && downAmplitude >= this.config.minimumSwingPercent) {
      this.direction = STRUCTURAL_DIRECTIONS.TRACKING_DOWN;
      this.movementStart = {
        side: "HIGH",
        price: this.bootstrap.high,
        at: this.bootstrap.highAt,
        extremeId: null,
      };
      this.candidate = makeCandidate(
        "LOW",
        this.bootstrap.low,
        toTicks(this.bootstrap.low, this.tickSize),
        { ...candle, time: this.bootstrap.lowAt },
        this.barIndex,
      );
      this.eventLog.push(eventRecord("DIRECTION_DEFINED", candle.closeTime, {
        direction: this.direction,
        candidatePrice: this.candidate.price,
      }));
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "DIRECTION_DEFINED_DOWN",
        swingAmplitudePct: downAmplitude,
        reversalPct: percentDistance(this.candidate.price, candle.high),
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
    const toleranceTicks = this.config.tickSizeBufferTicks;
    if (!this.candidate) {
      this.candidate = makeCandidate("HIGH", candle.high, highTicks, candle, this.barIndex);
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "HIGH_CANDIDATE_CREATED",
        swingAmplitudePct: this.#swingAmplitudePct(this.candidate.price),
        reversalPct: 0,
        thresholdPct: this.#reversalThresholdPct(this.candidate.price).thresholdPct,
      });
      return;
    }

    if (highTicks > this.candidate.priceTicks + toleranceTicks) {
      const previousPrice = this.candidate.price;
      this.candidate = {
        ...makeCandidate("HIGH", candle.high, highTicks, candle, this.barIndex),
        movedCount: this.candidate.movedCount + 1,
      };
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
        reversalPct: percentDistance(this.candidate.price, candle.low),
        thresholdPct: this.#reversalThresholdPct(this.candidate.price).thresholdPct,
      });
      return;
    }

    const threshold = this.#reversalThresholdPct(this.candidate.price);
    const reversalPct = (this.candidate.price - candle.low) / this.candidate.price * 100;
    const swingAmplitudePct = this.#swingAmplitudePct(this.candidate.price);
    const barsAfterCandidate = this.barIndex - this.candidate.barIndex;

    if (barsAfterCandidate < this.config.minimumBarsAfterCandidate) {
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "WAITING_MINIMUM_BARS_AFTER_HIGH",
        swingAmplitudePct,
        reversalPct,
        thresholdPct: threshold.thresholdPct,
      });
      return;
    }
    if (swingAmplitudePct < this.config.minimumSwingPercent) {
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "HIGH_SWING_AMPLITUDE_TOO_SMALL",
        swingAmplitudePct,
        reversalPct,
        thresholdPct: threshold.thresholdPct,
      });
      return;
    }
    if (reversalPct < threshold.thresholdPct) {
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "HIGH_REVERSAL_BELOW_THRESHOLD",
        swingAmplitudePct,
        reversalPct,
        thresholdPct: threshold.thresholdPct,
      });
      return;
    }

    this.#confirm("HIGH", candle, {
      swingAmplitudePct,
      reversalPct,
      threshold,
    });
  }

  #advanceDown(candle) {
    const lowTicks = toTicks(candle.low, this.tickSize);
    const toleranceTicks = this.config.tickSizeBufferTicks;
    if (!this.candidate) {
      this.candidate = makeCandidate("LOW", candle.low, lowTicks, candle, this.barIndex);
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "LOW_CANDIDATE_CREATED",
        swingAmplitudePct: this.#swingAmplitudePct(this.candidate.price),
        reversalPct: 0,
        thresholdPct: this.#reversalThresholdPct(this.candidate.price).thresholdPct,
      });
      return;
    }

    if (lowTicks < this.candidate.priceTicks - toleranceTicks) {
      const previousPrice = this.candidate.price;
      this.candidate = {
        ...makeCandidate("LOW", candle.low, lowTicks, candle, this.barIndex),
        movedCount: this.candidate.movedCount + 1,
      };
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
        reversalPct: percentDistance(this.candidate.price, candle.high),
        thresholdPct: this.#reversalThresholdPct(this.candidate.price).thresholdPct,
      });
      return;
    }

    const threshold = this.#reversalThresholdPct(this.candidate.price);
    const reversalPct = (candle.high - this.candidate.price) / this.candidate.price * 100;
    const swingAmplitudePct = this.#swingAmplitudePct(this.candidate.price);
    const barsAfterCandidate = this.barIndex - this.candidate.barIndex;

    if (barsAfterCandidate < this.config.minimumBarsAfterCandidate) {
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "WAITING_MINIMUM_BARS_AFTER_LOW",
        swingAmplitudePct,
        reversalPct,
        thresholdPct: threshold.thresholdPct,
      });
      return;
    }
    if (swingAmplitudePct < this.config.minimumSwingPercent) {
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "LOW_SWING_AMPLITUDE_TOO_SMALL",
        swingAmplitudePct,
        reversalPct,
        thresholdPct: threshold.thresholdPct,
      });
      return;
    }
    if (reversalPct < threshold.thresholdPct) {
      this.lastDiagnostic = this.#diagnostic({
        candle,
        reason: "LOW_REVERSAL_BELOW_THRESHOLD",
        swingAmplitudePct,
        reversalPct,
        thresholdPct: threshold.thresholdPct,
      });
      return;
    }

    this.#confirm("LOW", candle, {
      swingAmplitudePct,
      reversalPct,
      threshold,
    });
  }

  #confirm(side, confirmationCandle, metrics) {
    const source = this.candidate;
    if (!source || source.side !== side) return null;
    const previousOppositeId = side === "HIGH" ? this.lastConfirmedLowId : this.lastConfirmedHighId;
    const normalizedPrice = source.priceTicks;
    const id = [
      this.symbol,
      this.timeframe,
      side,
      source.extremeAt,
      normalizedPrice,
      STRUCTURAL_EXTREME_ALGORITHM_VERSION,
    ].join(":");
    if (this.extremeById.has(id)) return this.extremeById.get(id);

    const row = {
      id,
      symbol: this.symbol,
      timeframe: this.timeframe,
      side,
      price: source.price,
      normalizedPrice,
      extremeAt: source.extremeAt,
      confirmedAt: confirmationCandle.closeTime,
      status: STRUCTURAL_EXTREME_STATUSES.CONFIRMED_ACTIVE,
      active: true,
      previousOppositeExtremeId: previousOppositeId ?? undefined,
      swingAmplitudePct: round(metrics.swingAmplitudePct),
      confirmingReversalPct: round(metrics.reversalPct),
      reversalThresholdPct: round(metrics.threshold.thresholdPct),
      atrAtConfirmation: round(metrics.threshold.atr),
      touchCount: 0,
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
      },
      attackState: "AWAY",
      rearmed: false,
      crossedBarIndex: null,
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

    if (side === "HIGH") {
      this.direction = STRUCTURAL_DIRECTIONS.TRACKING_DOWN;
      this.movementStart = { side: "HIGH", price: row.price, at: row.extremeAt, extremeId: row.id };
      this.candidate = makeCandidate(
        "LOW",
        confirmationCandle.low,
        toTicks(confirmationCandle.low, this.tickSize),
        confirmationCandle,
        this.barIndex,
      );
    } else {
      this.direction = STRUCTURAL_DIRECTIONS.TRACKING_UP;
      this.movementStart = { side: "LOW", price: row.price, at: row.extremeAt, extremeId: row.id };
      this.candidate = makeCandidate(
        "HIGH",
        confirmationCandle.high,
        toTicks(confirmationCandle.high, this.tickSize),
        confirmationCandle,
        this.barIndex,
      );
    }
    return row;
  }

  #observeLifecycle(candle) {
    const lowTicks = toTicks(candle.low, this.tickSize);
    const highTicks = toTicks(candle.high, this.tickSize);
    const closeTicks = toTicks(candle.close, this.tickSize);
    const tolerance = this.config.tickSizeBufferTicks;
    const touchZone = Math.max(tolerance, this.config.touchZoneTicks);

    for (const row of this.extremes) {
      if (row.status === STRUCTURAL_EXTREME_STATUSES.CROSSED) {
        const beyond = row.side === "HIGH"
          ? closeTicks > row.normalizedPrice + tolerance
          : closeTicks < row.normalizedPrice - tolerance;
        const returned = row.side === "HIGH"
          ? closeTicks <= row.normalizedPrice - tolerance
          : closeTicks >= row.normalizedPrice + tolerance;
        if (beyond) row.acceptanceCount += 1;
        else row.acceptanceCount = 0;
        if (row.acceptanceCount >= this.config.acceptanceBars) {
          row.status = STRUCTURAL_EXTREME_STATUSES.ACCEPTED;
          row.acceptedAt = candle.closeTime;
          this.eventLog.push(eventRecord("EXTREME_ACCEPTED", candle.closeTime, { extremeId: row.id }));
        } else if (
          returned
          && this.barIndex - row.crossedBarIndex <= this.config.rejectionBars
        ) {
          row.status = STRUCTURAL_EXTREME_STATUSES.REJECTED;
          row.rejectedAt = candle.closeTime;
          this.eventLog.push(eventRecord("EXTREME_REJECTED", candle.closeTime, { extremeId: row.id }));
        }
        continue;
      }

      if (!row.active) continue;
      const crossed = row.side === "HIGH"
        ? highTicks > row.normalizedPrice + tolerance
        : lowTicks < row.normalizedPrice - tolerance;
      if (crossed) {
        row.active = false;
        row.status = STRUCTURAL_EXTREME_STATUSES.CROSSED;
        row.crossedAt = candle.closeTime;
        row.crossedBarIndex = this.barIndex;
        row.acceptanceCount = 0;
        this.activeExtremeIds.delete(row.id);
        this.eventLog.push(eventRecord("EXTREME_CROSSED", candle.closeTime, {
          extremeId: row.id,
          side: row.side,
          price: row.price,
        }));
        continue;
      }

      const touchesZone = row.side === "HIGH"
        ? highTicks >= row.normalizedPrice - touchZone
        : lowTicks <= row.normalizedPrice + touchZone;
      if (touchesZone) {
        if (row.attackState !== "IN_ZONE") {
          if (row.rearmed && candle.closeTime > row.confirmedAt) {
            row.touchCount += 1;
            row.status = STRUCTURAL_EXTREME_STATUSES.TOUCHED;
            this.eventLog.push(eventRecord("EXTREME_TOUCHED", candle.closeTime, {
              extremeId: row.id,
              touchCount: row.touchCount,
            }));
          }
          row.attackState = "IN_ZONE";
          row.rearmed = false;
        }
        continue;
      }

      row.attackState = "AWAY";
      const threshold = this.#reversalThresholdPct(row.price);
      const rearmPct = threshold.thresholdPct * this.config.rearmDistanceFactor;
      const movedAwayPct = row.side === "HIGH"
        ? (row.price - candle.low) / row.price * 100
        : (candle.high - row.price) / row.price * 100;
      if (movedAwayPct >= rearmPct) row.rearmed = true;
      if (row.status === STRUCTURAL_EXTREME_STATUSES.TOUCHED) {
        row.status = STRUCTURAL_EXTREME_STATUSES.CONFIRMED_ACTIVE;
      }
    }
  }

  #reversalThresholdPct(candidatePrice) {
    const atr = structuralAtr(this.candles, this.config.atrPeriod) ?? 0;
    const atrPercent = candidatePrice > 0 ? atr / candidatePrice * 100 : 0;
    const tickSizeBufferPercent = candidatePrice > 0
      ? this.tickSize * this.config.tickSizeBufferTicks / candidatePrice * 100
      : 0;
    return {
      thresholdPct: Math.max(
        this.config.minimumPercent,
        atrPercent * this.config.atrMultiplier,
        tickSizeBufferPercent,
      ),
      atr,
      atrPercent,
      tickSizeBufferPercent,
    };
  }

  #swingAmplitudePct(candidatePrice) {
    const startPrice = this.movementStart?.price;
    return startPrice > 0 ? Math.abs(candidatePrice - startPrice) / startPrice * 100 : 0;
  }

  #diagnostic({
    candle,
    reason,
    swingAmplitudePct,
    reversalPct,
    thresholdPct,
    confirmedExtremeId = null,
  }) {
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
      previousOppositeExtremeId: previousOppositeId,
      movementStart: this.movementStart ? { ...this.movementStart } : null,
      swingAmplitudePct: round(swingAmplitudePct),
      confirmingReversalPct: round(reversalPct),
      requiredReversalPct: round(thresholdPct),
      atr: round(threshold.atr),
      parameters: {
        minimumPercent: this.config.minimumPercent,
        atrMultiplier: this.config.atrMultiplier,
        minimumSwingPercent: this.config.minimumSwingPercent,
        minimumBarsAfterCandidate: this.config.minimumBarsAfterCandidate,
        tickSizeBufferTicks: this.config.tickSizeBufferTicks,
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
      schemaVersion: 1,
      entity: "SignalLabStructuralExtremeMap",
      algorithmVersion: STRUCTURAL_EXTREME_ALGORITHM_VERSION,
      symbol: this.symbol,
      timeframe: this.timeframe,
      tickSize: this.tickSize,
      direction: this.direction,
      candidate: candidatePublic(this.candidate),
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
    if (state?.algorithmVersion !== STRUCTURAL_EXTREME_ALGORITHM_VERSION) {
      throw new Error("Unsupported structural extreme state version");
    }
    if (state.symbol !== this.symbol || state.timeframe !== this.timeframe) {
      throw new Error("Restored state belongs to another symbol or timeframe");
    }
    this.direction = state.direction;
    this.candidate = clone(state.candidate);
    this.bootstrap = clone(state.bootstrap);
    this.movementStart = clone(state.movementStart);
    this.candles = clone(state.candles ?? []);
    this.lastCandleTime = finite(state.lastCandleTime);
    this.barIndex = Math.round(finite(state.barIndex) ?? -1);
    this.extremes = clone(state.extremes ?? []);
    this.extremeById = new Map(this.extremes.map((row) => [row.id, row]));
    this.activeExtremeIds = new Set(
      (state.activeExtremeIds ?? []).filter((id) => this.extremeById.get(id)?.active),
    );
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
      schemaVersion: 1,
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
  for (const candle of Array.isArray(candles) ? candles : []) {
    steps.push(engine.ingestCandle(candle));
  }
  return Object.freeze({
    steps: Object.freeze(steps),
    final: engine.snapshot(),
    serializedState: engine.serialize(),
  });
}
