import { calculateAtr, normalizeCandles } from "./algo-backtest.js";
import { createCascadeStrategy } from "./algo-cascade-strategy.js";

const EPSILON = 1e-12;

function assertInteger(value, label, minimum = 1) {
  if (!Number.isInteger(value) || value < minimum) throw new RangeError(`${label} must be an integer >= ${minimum}`);
}

function assertPositive(value, label, { allowZero = false } = {}) {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(`${label} must be ${allowZero ? "non-negative" : "positive"}`);
  }
}

function ema(values, period) {
  assertInteger(period, "EMA period", 2);
  const result = Array(values.length).fill(null);
  if (values.length < period) return result;
  let seed = 0;
  for (let index = 0; index < period; index += 1) seed += values[index];
  let current = seed / period;
  result[period - 1] = current;
  const alpha = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    current = values[index] * alpha + current * (1 - alpha);
    result[index] = current;
  }
  return result;
}

function rollingAveragePrevious(values, period) {
  assertInteger(period, "rolling average period", 1);
  const result = Array(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (index >= period) result[index] = sum / period;
    sum += values[index];
    if (index >= period) sum -= values[index - period];
  }
  return result;
}

function rollingExtremePrevious(candles, period, key, mode) {
  assertInteger(period, "rolling extreme period", 2);
  const result = Array(candles.length).fill(null);
  const deque = [];
  const better = mode === "max"
    ? (left, right) => left >= right
    : (left, right) => left <= right;

  for (let index = 0; index < candles.length; index += 1) {
    while (deque.length && deque[0] < index - period) deque.shift();
    if (index >= period && deque.length) result[index] = candles[deque[0]][key];
    const value = candles[index][key];
    while (deque.length && better(value, candles[deque.at(-1)][key])) deque.pop();
    deque.push(index);
  }
  return result;
}

function volumeRatioAt(context, index) {
  const average = context.averageVolume[index];
  return Number.isFinite(average) && average > 0 ? context.candles[index].volume / average : 1;
}

function atrPercentAt(context, index) {
  const atr = context.atr[index];
  const close = context.candles[index].close;
  return Number.isFinite(atr) && atr > 0 && close > 0 ? atr / close * 100 : null;
}

function validIndicator(...values) {
  return values.every((value) => Number.isFinite(value));
}

function sessionAllowed(time, sessionStartUtc, sessionEndUtc) {
  if (sessionStartUtc === null || sessionEndUtc === null) return true;
  const hour = new Date(time).getUTCHours();
  if (sessionStartUtc === sessionEndUtc) return true;
  if (sessionStartUtc < sessionEndUtc) return hour >= sessionStartUtc && hour < sessionEndUtc;
  return hour >= sessionStartUtc || hour < sessionEndUtc;
}

function buildSignal({ side, candle, stopDistance, rewardRisk, metadata }) {
  return Object.freeze({
    side,
    stopDistance,
    targetDistance: stopDistance * rewardRisk,
    signalTime: candle.time,
    metadata: Object.freeze(metadata),
  });
}

export function createPullbackReclaimStrategy({
  fastEma = 9,
  slowEma = 30,
  pullbackBars = 3,
  slopeBars = 3,
  atrPeriod = 14,
  stopAtr = 1.25,
  rewardRisk = 4,
  volumeLookback = 20,
  minimumVolumeRatio = 1,
  minimumAtrPercent = 0,
  sessionStartUtc = null,
  sessionEndUtc = null,
} = {}) {
  for (const [label, value] of Object.entries({ fastEma, slowEma, pullbackBars, slopeBars, atrPeriod, volumeLookback })) {
    assertInteger(value, label, 2);
  }
  if (slowEma <= fastEma) throw new RangeError("slowEma must exceed fastEma");
  for (const [label, value] of Object.entries({ stopAtr, rewardRisk, minimumVolumeRatio })) assertPositive(value, label);
  assertPositive(minimumAtrPercent, "minimumAtrPercent", { allowZero: true });

  const warmupBars = Math.max(slowEma + slopeBars, atrPeriod, volumeLookback, pullbackBars + 2);
  return Object.freeze({
    id: "pullback-reclaim-v1",
    warmupBars,
    describe: () => ({ fastEma, slowEma, pullbackBars, slopeBars, atrPeriod, stopAtr, rewardRisk, volumeLookback, minimumVolumeRatio, minimumAtrPercent, sessionStartUtc, sessionEndUtc }),
    prepare(candles) {
      const normalized = normalizeCandles(candles);
      const closes = normalized.map((candle) => candle.close);
      return Object.freeze({
        candles: normalized,
        atr: calculateAtr(normalized, atrPeriod),
        fast: ema(closes, fastEma),
        slow: ema(closes, slowEma),
        averageVolume: rollingAveragePrevious(normalized.map((candle) => candle.volume), volumeLookback),
      });
    },
    signal({ index, context }) {
      if (!Number.isInteger(index) || index < warmupBars || index >= context.candles.length) return null;
      const candle = context.candles[index];
      if (!sessionAllowed(candle.time, sessionStartUtc, sessionEndUtc)) return null;
      const fast = context.fast[index];
      const slow = context.slow[index];
      const previousFast = context.fast[index - 1];
      const previousSlow = context.slow[index - slopeBars];
      const atr = context.atr[index];
      const atrPercent = atrPercentAt(context, index);
      const volumeRatio = volumeRatioAt(context, index);
      if (!validIndicator(fast, slow, previousFast, previousSlow, atr, atrPercent) || atr <= 0) return null;
      if (atrPercent + EPSILON < minimumAtrPercent || volumeRatio + EPSILON < minimumVolumeRatio) return null;

      let longTouchedFast = false;
      let shortTouchedFast = false;
      let longHeldSlow = true;
      let shortHeldSlow = true;
      for (let cursor = index - pullbackBars; cursor < index; cursor += 1) {
        const item = context.candles[cursor];
        const itemFast = context.fast[cursor];
        const itemSlow = context.slow[cursor];
        if (!validIndicator(itemFast, itemSlow)) return null;
        if (item.low <= itemFast) longTouchedFast = true;
        if (item.high >= itemFast) shortTouchedFast = true;
        if (item.close < itemSlow) longHeldSlow = false;
        if (item.close > itemSlow) shortHeldSlow = false;
      }

      const longTrend = fast > slow && slow > previousSlow;
      const shortTrend = fast < slow && slow < previousSlow;
      const longReclaim = longTrend && longTouchedFast && longHeldSlow
        && context.candles[index - 1].close <= previousFast
        && candle.close > fast && candle.close > candle.open;
      const shortReclaim = shortTrend && shortTouchedFast && shortHeldSlow
        && context.candles[index - 1].close >= previousFast
        && candle.close < fast && candle.close < candle.open;
      const stopDistance = atr * stopAtr;
      if (longReclaim) return buildSignal({
        side: "long",
        candle,
        stopDistance,
        rewardRisk,
        metadata: { family: "pullback-reclaim", fast, slow, atr, atrPercent, volumeRatio },
      });
      if (shortReclaim) return buildSignal({
        side: "short",
        candle,
        stopDistance,
        rewardRisk,
        metadata: { family: "pullback-reclaim", fast, slow, atr, atrPercent, volumeRatio },
      });
      return null;
    },
  });
}

export function createSweepReversalStrategy({
  lookback = 40,
  atrPeriod = 14,
  minimumSweepAtr = 0.1,
  closeLocation = 0.35,
  stopBufferAtr = 0.2,
  minimumStopAtr = 0.8,
  rewardRisk = 4,
  volumeLookback = 20,
  minimumVolumeRatio = 1,
  trendPeriod = 50,
  trendMode = "none",
  sessionStartUtc = null,
  sessionEndUtc = null,
} = {}) {
  for (const [label, value] of Object.entries({ lookback, atrPeriod, volumeLookback, trendPeriod })) assertInteger(value, label, 2);
  for (const [label, value] of Object.entries({ minimumSweepAtr, closeLocation, stopBufferAtr, minimumStopAtr, rewardRisk, minimumVolumeRatio })) assertPositive(value, label);
  if (closeLocation >= 0.5) throw new RangeError("closeLocation must be below 0.5");
  if (!["none", "with-trend"].includes(trendMode)) throw new RangeError("trendMode must be none or with-trend");

  const warmupBars = Math.max(lookback, atrPeriod, volumeLookback, trendPeriod + 3);
  return Object.freeze({
    id: "sweep-reversal-v1",
    warmupBars,
    describe: () => ({ lookback, atrPeriod, minimumSweepAtr, closeLocation, stopBufferAtr, minimumStopAtr, rewardRisk, volumeLookback, minimumVolumeRatio, trendPeriod, trendMode, sessionStartUtc, sessionEndUtc }),
    prepare(candles) {
      const normalized = normalizeCandles(candles);
      const closes = normalized.map((candle) => candle.close);
      return Object.freeze({
        candles: normalized,
        atr: calculateAtr(normalized, atrPeriod),
        priorHigh: rollingExtremePrevious(normalized, lookback, "high", "max"),
        priorLow: rollingExtremePrevious(normalized, lookback, "low", "min"),
        trend: ema(closes, trendPeriod),
        averageVolume: rollingAveragePrevious(normalized.map((candle) => candle.volume), volumeLookback),
      });
    },
    signal({ index, context }) {
      if (!Number.isInteger(index) || index < warmupBars || index >= context.candles.length) return null;
      const candle = context.candles[index];
      if (!sessionAllowed(candle.time, sessionStartUtc, sessionEndUtc)) return null;
      const atr = context.atr[index];
      const priorHigh = context.priorHigh[index];
      const priorLow = context.priorLow[index];
      const trend = context.trend[index];
      const trendPast = context.trend[index - 3];
      const volumeRatio = volumeRatioAt(context, index);
      if (!validIndicator(atr, priorHigh, priorLow, trend, trendPast) || atr <= 0 || volumeRatio + EPSILON < minimumVolumeRatio) return null;
      const range = candle.high - candle.low;
      if (!(range > 0)) return null;
      const position = (candle.close - candle.low) / range;
      const longSweep = priorLow - candle.low;
      const shortSweep = candle.high - priorHigh;
      const longTrendOkay = trendMode === "none" || (candle.close > trend && trend > trendPast);
      const shortTrendOkay = trendMode === "none" || (candle.close < trend && trend < trendPast);

      if (longTrendOkay && longSweep >= atr * minimumSweepAtr && candle.close > priorLow && position >= 1 - closeLocation) {
        const stopDistance = Math.max(atr * minimumStopAtr, candle.close - candle.low + atr * stopBufferAtr);
        return buildSignal({ side: "long", candle, stopDistance, rewardRisk, metadata: { family: "sweep-reversal", priorLow, sweepAtr: longSweep / atr, closePosition: position, atr, volumeRatio, trendMode } });
      }
      if (shortTrendOkay && shortSweep >= atr * minimumSweepAtr && candle.close < priorHigh && position <= closeLocation) {
        const stopDistance = Math.max(atr * minimumStopAtr, candle.high - candle.close + atr * stopBufferAtr);
        return buildSignal({ side: "short", candle, stopDistance, rewardRisk, metadata: { family: "sweep-reversal", priorHigh, sweepAtr: shortSweep / atr, closePosition: position, atr, volumeRatio, trendMode } });
      }
      return null;
    },
  });
}

export function createCompressionBreakoutStrategy({
  breakoutLookback = 20,
  fastAtrPeriod = 8,
  slowAtrPeriod = 50,
  maximumCompression = 0.7,
  trendPeriod = 50,
  stopAtr = 1.25,
  rewardRisk = 4,
  volumeLookback = 20,
  minimumVolumeRatio = 1.2,
  sessionStartUtc = null,
  sessionEndUtc = null,
} = {}) {
  for (const [label, value] of Object.entries({ breakoutLookback, fastAtrPeriod, slowAtrPeriod, trendPeriod, volumeLookback })) assertInteger(value, label, 2);
  if (slowAtrPeriod <= fastAtrPeriod) throw new RangeError("slowAtrPeriod must exceed fastAtrPeriod");
  for (const [label, value] of Object.entries({ maximumCompression, stopAtr, rewardRisk, minimumVolumeRatio })) assertPositive(value, label);
  if (maximumCompression >= 1) throw new RangeError("maximumCompression must be below 1");

  const warmupBars = Math.max(breakoutLookback, slowAtrPeriod, trendPeriod + 3, volumeLookback);
  return Object.freeze({
    id: "compression-breakout-v1",
    warmupBars,
    describe: () => ({ breakoutLookback, fastAtrPeriod, slowAtrPeriod, maximumCompression, trendPeriod, stopAtr, rewardRisk, volumeLookback, minimumVolumeRatio, sessionStartUtc, sessionEndUtc }),
    prepare(candles) {
      const normalized = normalizeCandles(candles);
      const closes = normalized.map((candle) => candle.close);
      return Object.freeze({
        candles: normalized,
        fastAtr: calculateAtr(normalized, fastAtrPeriod),
        slowAtr: calculateAtr(normalized, slowAtrPeriod),
        trend: ema(closes, trendPeriod),
        priorHigh: rollingExtremePrevious(normalized, breakoutLookback, "high", "max"),
        priorLow: rollingExtremePrevious(normalized, breakoutLookback, "low", "min"),
        averageVolume: rollingAveragePrevious(normalized.map((candle) => candle.volume), volumeLookback),
      });
    },
    signal({ index, context }) {
      if (!Number.isInteger(index) || index < warmupBars || index >= context.candles.length) return null;
      const candle = context.candles[index];
      if (!sessionAllowed(candle.time, sessionStartUtc, sessionEndUtc)) return null;
      const fastAtr = context.fastAtr[index - 1];
      const slowAtr = context.slowAtr[index - 1];
      const currentAtr = context.slowAtr[index];
      const trend = context.trend[index];
      const trendPast = context.trend[index - 3];
      const priorHigh = context.priorHigh[index];
      const priorLow = context.priorLow[index];
      const volumeRatio = volumeRatioAt(context, index);
      if (!validIndicator(fastAtr, slowAtr, currentAtr, trend, trendPast, priorHigh, priorLow) || slowAtr <= 0 || currentAtr <= 0) return null;
      const compression = fastAtr / slowAtr;
      if (compression > maximumCompression + EPSILON || volumeRatio + EPSILON < minimumVolumeRatio) return null;
      const stopDistance = currentAtr * stopAtr;
      if (candle.close > priorHigh && candle.close > trend && trend > trendPast) {
        return buildSignal({ side: "long", candle, stopDistance, rewardRisk, metadata: { family: "compression-breakout", compression, priorHigh, trend, currentAtr, volumeRatio } });
      }
      if (candle.close < priorLow && candle.close < trend && trend < trendPast) {
        return buildSignal({ side: "short", candle, stopDistance, rewardRisk, metadata: { family: "compression-breakout", compression, priorLow, trend, currentAtr, volumeRatio } });
      }
      return null;
    },
  });
}

export function createImpulsePullbackStrategy({
  impulseBars = 4,
  pullbackBars = 2,
  atrPeriod = 14,
  impulseAtr = 2,
  minimumRetrace = 0.1,
  maximumRetrace = 0.55,
  trendPeriod = 50,
  stopAtr = 1.25,
  rewardRisk = 4,
  volumeLookback = 20,
  minimumVolumeRatio = 1,
  sessionStartUtc = null,
  sessionEndUtc = null,
} = {}) {
  for (const [label, value] of Object.entries({ impulseBars, pullbackBars, atrPeriod, trendPeriod, volumeLookback })) assertInteger(value, label, 2);
  for (const [label, value] of Object.entries({ impulseAtr, minimumRetrace, maximumRetrace, stopAtr, rewardRisk, minimumVolumeRatio })) assertPositive(value, label);
  if (maximumRetrace <= minimumRetrace || maximumRetrace >= 1) throw new RangeError("maximumRetrace must be between minimumRetrace and 1");

  const warmupBars = Math.max(atrPeriod, trendPeriod + 3, volumeLookback, impulseBars + pullbackBars + 2);
  return Object.freeze({
    id: "impulse-pullback-v1",
    warmupBars,
    describe: () => ({ impulseBars, pullbackBars, atrPeriod, impulseAtr, minimumRetrace, maximumRetrace, trendPeriod, stopAtr, rewardRisk, volumeLookback, minimumVolumeRatio, sessionStartUtc, sessionEndUtc }),
    prepare(candles) {
      const normalized = normalizeCandles(candles);
      return Object.freeze({
        candles: normalized,
        atr: calculateAtr(normalized, atrPeriod),
        trend: ema(normalized.map((candle) => candle.close), trendPeriod),
        averageVolume: rollingAveragePrevious(normalized.map((candle) => candle.volume), volumeLookback),
      });
    },
    signal({ index, context }) {
      if (!Number.isInteger(index) || index < warmupBars || index >= context.candles.length) return null;
      const candle = context.candles[index];
      if (!sessionAllowed(candle.time, sessionStartUtc, sessionEndUtc)) return null;
      const impulseEnd = index - pullbackBars - 1;
      const impulseStart = impulseEnd - impulseBars + 1;
      if (impulseStart < 0) return null;
      const atr = context.atr[impulseEnd];
      const currentAtr = context.atr[index];
      const trend = context.trend[index];
      const trendPast = context.trend[index - 3];
      const volumeRatio = volumeRatioAt(context, index);
      if (!validIndicator(atr, currentAtr, trend, trendPast) || atr <= 0 || currentAtr <= 0 || volumeRatio + EPSILON < minimumVolumeRatio) return null;

      let impulseHigh = -Infinity;
      let impulseLow = Infinity;
      for (let cursor = impulseStart; cursor <= impulseEnd; cursor += 1) {
        impulseHigh = Math.max(impulseHigh, context.candles[cursor].high);
        impulseLow = Math.min(impulseLow, context.candles[cursor].low);
      }
      const impulseRange = impulseHigh - impulseLow;
      if (!(impulseRange > 0)) return null;
      let pullbackLow = Infinity;
      let pullbackHigh = -Infinity;
      for (let cursor = impulseEnd + 1; cursor < index; cursor += 1) {
        pullbackLow = Math.min(pullbackLow, context.candles[cursor].low);
        pullbackHigh = Math.max(pullbackHigh, context.candles[cursor].high);
      }
      const impulseOpen = context.candles[impulseStart].open;
      const impulseClose = context.candles[impulseEnd].close;
      const longMove = impulseClose - impulseOpen;
      const shortMove = impulseOpen - impulseClose;
      const previous = context.candles[index - 1];
      const stopDistance = currentAtr * stopAtr;

      if (longMove >= atr * impulseAtr && trend > trendPast && candle.close > trend) {
        const retrace = (impulseHigh - pullbackLow) / impulseRange;
        if (retrace >= minimumRetrace && retrace <= maximumRetrace && pullbackLow > impulseLow && candle.close > previous.high && candle.close > candle.open) {
          return buildSignal({ side: "long", candle, stopDistance, rewardRisk, metadata: { family: "impulse-pullback", impulseAtr: longMove / atr, retrace, trend, currentAtr, volumeRatio } });
        }
      }
      if (shortMove >= atr * impulseAtr && trend < trendPast && candle.close < trend) {
        const retrace = (pullbackHigh - impulseLow) / impulseRange;
        if (retrace >= minimumRetrace && retrace <= maximumRetrace && pullbackHigh < impulseHigh && candle.close < previous.low && candle.close < candle.open) {
          return buildSignal({ side: "short", candle, stopDistance, rewardRisk, metadata: { family: "impulse-pullback", impulseAtr: shortMove / atr, retrace, trend, currentAtr, volumeRatio } });
        }
      }
      return null;
    },
  });
}

function candidate(family, parameters, factory) {
  const stable = Object.fromEntries(Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)));
  const id = `${family}:${Object.entries(stable).map(([key, value]) => `${key}=${value}`).join(";")}`;
  return Object.freeze({ id, family, parameters: Object.freeze(parameters), factory });
}

export function buildResearchCandidates() {
  const candidates = [];
  const sessions = [[null, null], [7, 17], [12, 22]];

  for (const fastEma of [9, 12]) for (const slowEma of [30, 50]) for (const pullbackBars of [2, 4]) for (const stopAtr of [1, 1.5]) for (const rewardRisk of [4, 5]) for (const [sessionStartUtc, sessionEndUtc] of sessions) {
    const parameters = { fastEma, slowEma, pullbackBars, slopeBars: 3, atrPeriod: 14, stopAtr, rewardRisk, volumeLookback: 20, minimumVolumeRatio: 1, minimumAtrPercent: 0.03, sessionStartUtc, sessionEndUtc };
    candidates.push(candidate("pullback-reclaim", parameters, () => createPullbackReclaimStrategy(parameters)));
  }

  for (const lookback of [20, 40, 80]) for (const closeLocation of [0.25, 0.4]) for (const minimumSweepAtr of [0.05, 0.2]) for (const rewardRisk of [4, 5]) for (const trendMode of ["none", "with-trend"]) {
    const parameters = { lookback, atrPeriod: 14, minimumSweepAtr, closeLocation, stopBufferAtr: 0.2, minimumStopAtr: 0.8, rewardRisk, volumeLookback: 20, minimumVolumeRatio: 1, trendPeriod: 50, trendMode, sessionStartUtc: null, sessionEndUtc: null };
    candidates.push(candidate("sweep-reversal", parameters, () => createSweepReversalStrategy(parameters)));
  }

  for (const breakoutLookback of [10, 20, 40]) for (const maximumCompression of [0.6, 0.75]) for (const stopAtr of [1, 1.5]) for (const rewardRisk of [4, 5]) for (const minimumVolumeRatio of [1, 1.3]) {
    const parameters = { breakoutLookback, fastAtrPeriod: 8, slowAtrPeriod: 50, maximumCompression, trendPeriod: 50, stopAtr, rewardRisk, volumeLookback: 20, minimumVolumeRatio, sessionStartUtc: null, sessionEndUtc: null };
    candidates.push(candidate("compression-breakout", parameters, () => createCompressionBreakoutStrategy(parameters)));
  }

  for (const impulseBars of [3, 5]) for (const pullbackBars of [2, 3]) for (const impulseAtr of [1.5, 2.5]) for (const maximumRetrace of [0.4, 0.6]) for (const rewardRisk of [4, 5]) {
    const parameters = { impulseBars, pullbackBars, atrPeriod: 14, impulseAtr, minimumRetrace: 0.1, maximumRetrace, trendPeriod: 50, stopAtr: 1.25, rewardRisk, volumeLookback: 20, minimumVolumeRatio: 1, sessionStartUtc: null, sessionEndUtc: null };
    candidates.push(candidate("impulse-pullback", parameters, () => createImpulsePullbackStrategy(parameters)));
  }

  for (const lookback of [120, 240]) for (const minimumStepPercent of [0.03, 0.08]) for (const minimumWidthPercent of [0.5, 1]) for (const stopAtr of [1, 1.5]) for (const rewardRisk of [4, 5]) {
    const parameters = { lookback, atrPeriod: 14, minimumExtrema: 3, minimumStepPercent, minimumWidthPercent, maximumWidthPercent: 5, stopAtr, rewardRisk, volumeLookback: 20, minimumVolumeRatio: 1 };
    candidates.push(candidate("cascade", parameters, () => createCascadeStrategy(parameters)));
  }

  return Object.freeze(candidates);
}
