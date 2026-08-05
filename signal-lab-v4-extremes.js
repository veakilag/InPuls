export const SIGNAL_LAB_V4_EXTREME_FORMULA_VERSION = "signal-lab-v6-candle-extremes-v2-2026-08";

export const EXTREME_STATES = Object.freeze({
  CANDIDATE: "CANDIDATE",
  CONFIRMED_ACTIVE: "CONFIRMED_ACTIVE",
  RETESTED: "RETESTED",
  BREAK_ATTEMPT: "BREAK_ATTEMPT",
  BROKEN_ACCEPTED: "BROKEN_ACCEPTED",
  SWEPT_RECLAIMED: "SWEPT_RECLAIMED",
  EXPIRED: "EXPIRED",
});

export const EXTREME_DATA_QUALITY = Object.freeze({
  LIVE: "LIVE",
  STALE: "STALE",
  GAP: "GAP",
  RECOVERED: "RECOVERED",
  ERROR: "ERROR",
});

export const SIGNAL_LAB_V4_TIMEFRAMES = Object.freeze([
  "1m", "5m", "15m", "1h", "4h", "1d",
]);

export const DEFAULT_EXTREME_CONFIG = Object.freeze({
  atrPeriod: 14,
  minTicks: 3,
  rearmBars: 2,
  rearmDistanceFactor: 0.7,
  historyLimit: 4_000,
  timeframes: Object.freeze({
    "1m": Object.freeze({ minReversalPct: 0.10, atrMultiplier: 0.35 }),
    "5m": Object.freeze({ minReversalPct: 0.16, atrMultiplier: 0.42 }),
    "15m": Object.freeze({ minReversalPct: 0.25, atrMultiplier: 0.50 }),
    "1h": Object.freeze({ minReversalPct: 0.45, atrMultiplier: 0.62 }),
    "4h": Object.freeze({ minReversalPct: 0.75, atrMultiplier: 0.75 }),
    "1d": Object.freeze({ minReversalPct: 1.20, atrMultiplier: 0.90 }),
  }),
});

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeSymbol = (value) => {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,20}USDT$/.test(symbol) ? symbol : null;
};

const normalizeQuality = (value) => {
  const quality = String(value ?? "LIVE").toUpperCase();
  return Object.values(EXTREME_DATA_QUALITY).includes(quality)
    ? quality
    : EXTREME_DATA_QUALITY.ERROR;
};

const timeframeMs = (timeframe) => ({
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
}[timeframe] ?? null);

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeTickSize(value) {
  const tickSize = finite(value);
  if (tickSize === null || tickSize <= 0) throw new TypeError("tickSize must be a positive number");
  return tickSize;
}

export function priceToTicks(price, tickSize) {
  const value = finite(price);
  const step = normalizeTickSize(tickSize);
  if (value === null || value <= 0) throw new TypeError("price must be a positive number");
  return BigInt(Math.round(value / step));
}

export function ticksToPrice(priceTicks, tickSize) {
  const step = normalizeTickSize(tickSize);
  return Number(priceTicks) * step;
}

function normalizeCandle(row, intervalMs) {
  const time = finite(row?.time ?? row?.openTime);
  const open = finite(row?.open);
  const high = finite(row?.high);
  const low = finite(row?.low);
  const close = finite(row?.close);
  if (time === null || time < 0) return null;
  if (![open, high, low, close].every((value) => value !== null && value > 0)) return null;
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return null;
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

export function atrFromClosedCandles(candles, period = 14) {
  const rows = Array.isArray(candles) ? candles : [];
  if (rows.length < 2) return null;
  const ranges = [];
  for (let index = 0; index < rows.length; index += 1) {
    const range = trueRange(rows[index], rows[index - 1]?.close);
    if (Number.isFinite(range)) ranges.push(range);
  }
  const window = ranges.slice(-Math.max(1, Math.round(period)));
  return window.length ? window.reduce((sum, value) => sum + value, 0) / window.length : null;
}

function candidate(side, priceTicks, time, detectedAt, barIndex) {
  return {
    side,
    priceTicks,
    extremeTime: time,
    detectedAt,
    barIndex,
    state: EXTREME_STATES.CANDIDATE,
  };
}

function candidatePublic(row, tickSize) {
  if (!row) return null;
  return Object.freeze({
    side: row.side,
    priceTicks: row.priceTicks.toString(),
    price: ticksToPrice(row.priceTicks, tickSize),
    extremeTime: row.extremeTime,
    detectedAt: row.detectedAt,
    state: EXTREME_STATES.CANDIDATE,
  });
}

function extremePublic(row) {
  return Object.freeze({
    ...row,
    priceTicks: row.priceTicks.toString(),
  });
}

export class TimeframeExtremeEngine {
  constructor({
    symbol,
    timeframe,
    tickSize,
    config = {},
  }) {
    this.symbol = normalizeSymbol(symbol);
    this.timeframe = String(timeframe ?? "");
    this.intervalMs = timeframeMs(this.timeframe);
    if (!this.symbol || !this.intervalMs) throw new TypeError("Unsupported symbol or timeframe");
    this.tickSize = normalizeTickSize(tickSize);
    const timeframeDefaults = DEFAULT_EXTREME_CONFIG.timeframes[this.timeframe];
    this.config = {
      ...DEFAULT_EXTREME_CONFIG,
      ...timeframeDefaults,
      ...config,
      timeframes: undefined,
    };
    this.mode = "SEEK_BOTH";
    this.highCandidate = null;
    this.lowCandidate = null;
    this.candles = [];
    this.lastCandleTime = null;
    this.barIndex = -1;
    this.extremes = [];
    this.extremeById = new Map();
    this.activeExtremeIds = new Set();
    this.eventLog = [];
    this.dataQuality = EXTREME_DATA_QUALITY.LIVE;
  }

  ingestCandles(rows, { dataQuality = this.dataQuality, emitSnapshot = true } = {}) {
    const normalized = (Array.isArray(rows) ? rows : [])
      .map((row) => normalizeCandle(row, this.intervalMs))
      .filter((row) => row?.closed)
      .sort((left, right) => left.time - right.time);
    for (const row of normalized) {
      if (this.lastCandleTime !== null && row.time <= this.lastCandleTime) continue;
      this.ingestCandle(row, { dataQuality, emitSnapshot: false });
    }
    return emitSnapshot ? this.snapshot() : null;
  }

  ingestCandle(raw, {
    dataQuality = this.dataQuality,
    availableAt = null,
    emitSnapshot = true,
  } = {}) {
    const candle = normalizeCandle(raw, this.intervalMs);
    if (!candle?.closed) return emitSnapshot ? this.snapshot() : null;
    if (this.lastCandleTime !== null && candle.time <= this.lastCandleTime) return emitSnapshot ? this.snapshot() : null;
    this.dataQuality = normalizeQuality(dataQuality);
    this.barIndex += 1;
    this.lastCandleTime = candle.time;
    this.candles.push(candle);
    if (this.candles.length > this.config.historyLimit) this.candles.shift();
    const knownAt = finite(availableAt) ?? candle.closeTime;

    this.#observeActiveRange(candle.low, candle.high, knownAt, this.barIndex);
    this.#advanceCandidates(candle, knownAt);
    return emitSnapshot ? this.snapshot() : null;
  }

  ingestTrade(price, at = Date.now(), {
    dataQuality = this.dataQuality,
    emitSnapshot = true,
  } = {}) {
    const value = finite(price);
    const timestamp = finite(at);
    if (value === null || value <= 0 || timestamp === null) return emitSnapshot ? this.snapshot() : null;
    this.dataQuality = normalizeQuality(dataQuality);
    const ticks = priceToTicks(value, this.tickSize);
    this.#observeActiveTicks(ticks, ticks, timestamp, this.barIndex);

    if (this.mode === "SEEK_BOTH" || this.mode === "SEEK_HIGH") {
      if (!this.highCandidate || ticks > this.highCandidate.priceTicks) {
        this.highCandidate = candidate("HIGH", ticks, timestamp, timestamp, this.barIndex);
      } else if (
        timestamp > this.highCandidate.extremeTime
        && this.highCandidate.priceTicks - ticks >= this.#confirmationTicks(this.highCandidate.priceTicks)
      ) {
        this.#confirm("HIGH", this.highCandidate, timestamp, this.barIndex);
      }
    }
    if (this.mode === "SEEK_BOTH" || this.mode === "SEEK_LOW") {
      if (!this.lowCandidate || ticks < this.lowCandidate.priceTicks) {
        this.lowCandidate = candidate("LOW", ticks, timestamp, timestamp, this.barIndex);
      } else if (
        timestamp > this.lowCandidate.extremeTime
        && ticks - this.lowCandidate.priceTicks >= this.#confirmationTicks(this.lowCandidate.priceTicks)
      ) {
        this.#confirm("LOW", this.lowCandidate, timestamp, this.barIndex);
      }
    }
    return emitSnapshot ? this.snapshot() : null;
  }

  observePrice(price, at = Date.now(), {
    dataQuality = this.dataQuality,
    emitSnapshot = true,
  } = {}) {
    const value = finite(price);
    const timestamp = finite(at);
    if (value === null || value <= 0 || timestamp === null) {
      return emitSnapshot ? this.snapshot() : null;
    }
    this.dataQuality = normalizeQuality(dataQuality);
    const ticks = priceToTicks(value, this.tickSize);
    this.#observeActiveTicks(ticks, ticks, timestamp, this.barIndex);
    return emitSnapshot ? this.snapshot() : null;
  }

  #advanceCandidates(candle, knownAt) {
    const highTicks = priceToTicks(candle.high, this.tickSize);
    const lowTicks = priceToTicks(candle.low, this.tickSize);
    const highEligible = this.mode === "SEEK_BOTH" || this.mode === "SEEK_HIGH";
    const lowEligible = this.mode === "SEEK_BOTH" || this.mode === "SEEK_LOW";

    if (highEligible && (!this.highCandidate || highTicks > this.highCandidate.priceTicks)) {
      this.highCandidate = candidate("HIGH", highTicks, candle.time, knownAt, this.barIndex);
    }
    if (lowEligible && (!this.lowCandidate || lowTicks < this.lowCandidate.priceTicks)) {
      this.lowCandidate = candidate("LOW", lowTicks, candle.time, knownAt, this.barIndex);
    }

    const highConfirmable = highEligible
      && this.highCandidate
      && candle.time > this.highCandidate.extremeTime
      && this.highCandidate.priceTicks - lowTicks >= this.#confirmationTicks(this.highCandidate.priceTicks);
    const lowConfirmable = lowEligible
      && this.lowCandidate
      && candle.time > this.lowCandidate.extremeTime
      && highTicks - this.lowCandidate.priceTicks >= this.#confirmationTicks(this.lowCandidate.priceTicks);

    if (highConfirmable && lowConfirmable && this.mode === "SEEK_BOTH") {
      if (this.highCandidate.extremeTime < this.lowCandidate.extremeTime) {
        this.#confirm("HIGH", this.highCandidate, knownAt, this.barIndex);
      } else if (this.lowCandidate.extremeTime < this.highCandidate.extremeTime) {
        this.#confirm("LOW", this.lowCandidate, knownAt, this.barIndex);
      }
      return;
    }
    if (highConfirmable) this.#confirm("HIGH", this.highCandidate, knownAt, this.barIndex);
    else if (lowConfirmable) this.#confirm("LOW", this.lowCandidate, knownAt, this.barIndex);
  }

  #confirmationTicks(priceTicks) {
    const price = ticksToPrice(priceTicks, this.tickSize);
    const atr = atrFromClosedCandles(this.candles, this.config.atrPeriod);
    const pctDistance = price * Math.max(0, Number(this.config.minReversalPct) || 0) / 100;
    const atrDistance = (atr ?? 0) * Math.max(0, Number(this.config.atrMultiplier) || 0);
    const tickDistance = this.tickSize * Math.max(1, Math.round(Number(this.config.minTicks) || 1));
    return priceToTicks(Math.max(this.tickSize, pctDistance, atrDistance, tickDistance), this.tickSize);
  }

  #confirm(side, source, confirmedAt, confirmedBarIndex) {
    if (!source || source.side !== side) return null;
    const price = ticksToPrice(source.priceTicks, this.tickSize);
    const thresholdTicks = this.#confirmationTicks(source.priceTicks);
    const id = `${this.symbol}:${this.timeframe}:${side}:${source.extremeTime}:${source.priceTicks}:${SIGNAL_LAB_V4_EXTREME_FORMULA_VERSION}`;
    if (this.extremeById.has(id)) return this.extremeById.get(id);
    const row = {
      id,
      symbol: this.symbol,
      exchange: "BINANCE",
      marketType: "USD_M_FUTURES",
      timeframe: this.timeframe,
      side,
      priceTicks: source.priceTicks,
      price,
      extremeTime: source.extremeTime,
      detectedAt: source.detectedAt,
      confirmedAt,
      state: EXTREME_STATES.CONFIRMED_ACTIVE,
      confirmationMovePct: Number(source.priceTicks) > 0
        ? Number(thresholdTicks) / Number(source.priceTicks) * 100
        : null,
      confirmationDelayBars: Math.max(0, confirmedBarIndex - source.barIndex),
      confirmationDelayMs: Math.max(0, confirmedAt - source.extremeTime),
      touchCount: 1,
      crossedAt: null,
      acceptedAt: null,
      invalidatedAt: null,
      dataQuality: this.dataQuality,
      formulaVersion: SIGNAL_LAB_V4_EXTREME_FORMULA_VERSION,
      active: true,
      lastTestedAt: source.extremeTime,
      lastTouchBarIndex: source.barIndex,
      rearmed: false,
      outsideBars: 0,
    };
    this.extremes.push(row);
    this.extremeById.set(id, row);
    this.activeExtremeIds.add(id);
    this.eventLog.push({ type: "EXTREME_CONFIRMED", at: confirmedAt, extremeId: id });
    if (this.eventLog.length > this.config.historyLimit * 2) {
      this.eventLog.splice(0, this.eventLog.length - this.config.historyLimit * 2);
    }
    if (side === "HIGH") {
      this.mode = "SEEK_LOW";
      this.highCandidate = null;
      this.lowCandidate = null;
    } else {
      this.mode = "SEEK_HIGH";
      this.lowCandidate = null;
      this.highCandidate = null;
    }
    return row;
  }

  #observeActiveRange(low, high, at, barIndex) {
    this.#observeActiveTicks(
      priceToTicks(low, this.tickSize),
      priceToTicks(high, this.tickSize),
      at,
      barIndex,
    );
  }

  #observeActiveTicks(lowTicks, highTicks, at, barIndex) {
    for (const extremeId of [...this.activeExtremeIds]) {
      const row = this.extremeById.get(extremeId);
      if (!row?.active) {
        this.activeExtremeIds.delete(extremeId);
        continue;
      }
      const crossed = row.side === "HIGH"
        ? highTicks > row.priceTicks
        : lowTicks < row.priceTicks;
      if (crossed) {
        row.active = false;
        row.state = EXTREME_STATES.BREAK_ATTEMPT;
        row.crossedAt = at;
        row.invalidatedAt = at;
        row.dataQuality = this.dataQuality;
        this.activeExtremeIds.delete(row.id);
        this.eventLog.push({ type: "EXTREME_CROSSED", at, extremeId: row.id });
        continue;
      }
      const touched = row.side === "HIGH"
        ? highTicks === row.priceTicks
        : lowTicks === row.priceTicks;
      const thresholdTicks = this.#confirmationTicks(row.priceTicks);
      const rearmTicks = BigInt(Math.max(
        1,
        Math.round(Number(thresholdTicks) * Math.max(0.1, Number(this.config.rearmDistanceFactor) || 0.7)),
      ));
      const movedAway = row.side === "HIGH"
        ? row.priceTicks - lowTicks >= rearmTicks
        : highTicks - row.priceTicks >= rearmTicks;
      if (touched) {
        if (row.rearmed && barIndex > row.lastTouchBarIndex) {
          row.touchCount += 1;
          row.lastTestedAt = at;
          row.lastTouchBarIndex = barIndex;
          row.state = EXTREME_STATES.RETESTED;
          this.eventLog.push({ type: "EXTREME_RETESTED", at, extremeId: row.id, touchCount: row.touchCount });
        }
        row.rearmed = false;
        row.outsideBars = 0;
        continue;
      }
      row.outsideBars = Math.max(0, Number(row.outsideBars) || 0) + 1;
      if (
        movedAway
        || row.outsideBars >= Math.max(1, Math.round(Number(this.config.rearmBars) || 1))
      ) row.rearmed = true;
    }
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
      entity: "SignalLabExtremeMap",
      formulaVersion: SIGNAL_LAB_V4_EXTREME_FORMULA_VERSION,
      symbol: this.symbol,
      timeframe: this.timeframe,
      tickSize: this.tickSize,
      dataQuality: this.dataQuality,
      mode: this.mode,
      lastCandleTime: this.lastCandleTime,
      candidates: Object.freeze({
        high: candidatePublic(this.highCandidate, this.tickSize),
        low: candidatePublic(this.lowCandidate, this.tickSize),
      }),
      active: Object.freeze(this.activeExtremes()),
      history: Object.freeze(includeHistory ? this.extremes.slice(-500).map(extremePublic) : []),
      events: Object.freeze(includeEvents ? clone(this.eventLog.slice(-1_000)) : []),
    });
  }
}

export class SignalLabV4ExtremeRegistry {
  constructor({ config = {} } = {}) {
    this.config = config;
    this.engines = new Map();
    this.tickSizes = new Map();
  }

  setTickSize(symbol, tickSize) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return;
    this.tickSizes.set(normalized, normalizeTickSize(tickSize));
  }

  #key(symbol, timeframe) {
    return `${symbol}:${timeframe}`;
  }

  engine(symbol, timeframe, tickSize = this.tickSizes.get(normalizeSymbol(symbol))) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized || !SIGNAL_LAB_V4_TIMEFRAMES.includes(timeframe) || !(tickSize > 0)) return null;
    const key = this.#key(normalized, timeframe);
    if (!this.engines.has(key)) {
      this.engines.set(key, new TimeframeExtremeEngine({
        symbol: normalized,
        timeframe,
        tickSize,
        config: {
          ...(this.config?.common ?? {}),
          ...(this.config?.timeframes?.[timeframe] ?? {}),
        },
      }));
    }
    return this.engines.get(key);
  }

  hydrate(symbol, timeframe, candles, options = {}) {
    const engine = this.engine(symbol, timeframe, options.tickSize);
    return engine?.ingestCandles(candles, options) ?? null;
  }

  ingestTrade(symbol, price, at, options = {}) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return null;
    const emitSnapshot = options.emitSnapshot !== false;
    for (const timeframe of SIGNAL_LAB_V4_TIMEFRAMES) {
      this.engine(normalized, timeframe)?.ingestTrade(price, at, {
        ...options,
        emitSnapshot: false,
      });
    }
    return emitSnapshot ? this.snapshot(normalized) : null;
  }

  observePrice(symbol, price, at, options = {}) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return null;
    const emitSnapshot = options.emitSnapshot !== false;
    for (const timeframe of SIGNAL_LAB_V4_TIMEFRAMES) {
      this.engines.get(this.#key(normalized, timeframe))?.observePrice(price, at, {
        ...options,
        emitSnapshot: false,
      });
    }
    return emitSnapshot
      ? this.snapshot(normalized, options.snapshotOptions ?? {})
      : null;
  }

  snapshot(symbol, options = {}) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return null;
    const timeframes = {};
    for (const timeframe of SIGNAL_LAB_V4_TIMEFRAMES) {
      const engine = this.engines.get(this.#key(normalized, timeframe));
      if (engine) timeframes[timeframe] = engine.snapshot(options);
    }
    return Object.freeze({
      schemaVersion: 1,
      entity: "SignalLabMultiTimeframeExtremeMap",
      symbol: normalized,
      formulaVersion: SIGNAL_LAB_V4_EXTREME_FORMULA_VERSION,
      timeframes: Object.freeze(timeframes),
    });
  }

  activeLevels(symbol) {
    const snapshot = this.snapshot(symbol, { includeHistory: false, includeEvents: false });
    const rows = [];
    for (const [timeframe, map] of Object.entries(snapshot?.timeframes ?? {})) {
      for (const extreme of map.active ?? []) rows.push({ ...extreme, timeframe });
    }
    return rows.sort((left, right) => left.price - right.price);
  }

  watchScore(symbol, currentPrice) {
    const price = finite(currentPrice);
    if (!(price > 0)) return 0;
    const active = this.activeLevels(symbol);
    if (!active.length) return 0;
    let score = 0;
    for (const row of active) {
      const distance = Math.abs(row.price - price) / price * 100;
      if (distance > 5) continue;
      const timeframeWeight = ({ "1m": 1, "5m": 1.2, "15m": 1.45, "1h": 1.8, "4h": 2.2, "1d": 2.6 })[row.timeframe] ?? 1;
      score += timeframeWeight * (1 + Math.max(0, row.touchCount - 1) * 0.45) / Math.max(0.08, distance);
    }
    return score;
  }
}
