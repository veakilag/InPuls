import { calculateAtr, normalizeCandles } from "./algo-backtest.js";

const EPSILON = 1e-12;

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function percentDistance(left, right) {
  if (!(left > 0) || !(right > 0)) return null;
  return Math.abs(left - right) / Math.min(left, right) * 100;
}

function localExtrema(candles, side, offset) {
  const key = side === "high" ? "high" : "low";
  const values = [];
  for (let index = 1; index < candles.length - 1; index += 1) {
    const value = candles[index][key];
    const left = candles[index - 1][key];
    const right = candles[index + 1][key];
    const isExtreme = side === "high"
      ? value > left + EPSILON && value > right + EPSILON
      : value < left - EPSILON && value < right - EPSILON;
    if (isExtreme) values.push({ index: offset + index, time: candles[index].time, price: value });
  }
  return values;
}

function findCascade({ candles, index, side, lookback, minimumExtrema, minimumStepPercent, minimumWidthPercent, maximumWidthPercent }) {
  const start = Math.max(0, index - lookback);
  const completed = candles.slice(start, index);
  const extrema = localExtrema(completed, side, start).slice(-8);
  if (extrema.length < minimumExtrema) return null;

  let staircase = [];
  for (const extreme of extrema) {
    const previous = staircase.at(-1);
    const step = previous ? percentDistance(previous.price, extreme.price) : null;
    const towardBreakout = !previous
      || (side === "high" ? extreme.price > previous.price : extreme.price < previous.price);
    if (!previous || (towardBreakout && step >= minimumStepPercent)) staircase.push(extreme);
    else staircase = [extreme];
  }
  if (staircase.length < minimumExtrema) return null;

  const currentClose = candles[index].close;
  const previousClose = candles[index - 1].close;
  let best = null;
  for (let startIndex = 0; startIndex <= staircase.length - minimumExtrema; startIndex += 1) {
    const group = staircase.slice(startIndex);
    const prices = group.map((item) => item.price);
    const lower = Math.min(...prices);
    const upper = Math.max(...prices);
    const widthPercent = percentDistance(lower, upper);
    if (widthPercent === null || widthPercent < minimumWidthPercent || widthPercent > maximumWidthPercent) continue;
    const level = group.at(-1).price;
    const crossed = side === "high"
      ? previousClose <= level && currentClose > level
      : previousClose >= level && currentClose < level;
    if (!crossed) continue;
    if (!best || group.length > best.extrema.length) {
      best = { side, extrema: group, lower, upper, level, widthPercent };
    }
  }
  return best;
}

export function createCascadeStrategy({
  lookback = 240,
  atrPeriod = 14,
  minimumExtrema = 3,
  minimumStepPercent = 0.08,
  minimumWidthPercent = 1,
  maximumWidthPercent = 5,
  stopAtr = 2,
  rewardRisk = 2,
  volumeLookback = 20,
  minimumVolumeRatio = 1,
  allowLong = true,
  allowShort = true,
} = {}) {
  for (const [label, value] of Object.entries({ lookback, atrPeriod, minimumExtrema, volumeLookback })) {
    if (!Number.isInteger(value) || value < 2) throw new RangeError(`${label} must be an integer >= 2`);
  }
  for (const [label, value] of Object.entries({ minimumStepPercent, minimumWidthPercent, maximumWidthPercent, stopAtr, rewardRisk, minimumVolumeRatio })) {
    positive(value, label);
  }
  if (maximumWidthPercent <= minimumWidthPercent) throw new RangeError("maximumWidthPercent must exceed minimumWidthPercent");
  if (!allowLong && !allowShort) throw new RangeError("at least one direction must be enabled");

  const warmupBars = Math.max(lookback, atrPeriod, volumeLookback);
  return Object.freeze({
    id: "cascade-1m-v1",
    warmupBars,
    describe: () => ({ lookback, atrPeriod, minimumExtrema, minimumStepPercent, minimumWidthPercent, maximumWidthPercent, stopAtr, rewardRisk, volumeLookback, minimumVolumeRatio, allowLong, allowShort }),
    prepare(candles) {
      const normalized = normalizeCandles(candles);
      return Object.freeze({ candles: normalized, atr: calculateAtr(normalized, atrPeriod) });
    },
    signal({ index, context }) {
      if (!context || !Array.isArray(context.candles) || !Array.isArray(context.atr)) throw new TypeError("strategy context is missing");
      if (!Number.isInteger(index) || index < warmupBars || index >= context.candles.length) return null;
      const candle = context.candles[index];
      const volumeWindow = context.candles.slice(index - volumeLookback, index);
      const averageVolume = volumeWindow.reduce((sum, item) => sum + item.volume, 0) / volumeWindow.length;
      const volumeRatio = averageVolume > 0 ? candle.volume / averageVolume : 1;
      if (volumeRatio + EPSILON < minimumVolumeRatio) return null;
      const atr = context.atr[index];
      if (!Number.isFinite(atr) || atr <= 0) return null;

      const shared = {
        candles: context.candles,
        index,
        lookback,
        minimumExtrema,
        minimumStepPercent,
        minimumWidthPercent,
        maximumWidthPercent,
      };
      const longCandidate = allowLong ? findCascade({ ...shared, side: "high" }) : null;
      const shortCandidate = allowShort ? findCascade({ ...shared, side: "low" }) : null;
      const candidate = longCandidate && shortCandidate
        ? (longCandidate.extrema.at(-1).time >= shortCandidate.extrema.at(-1).time ? longCandidate : shortCandidate)
        : longCandidate || shortCandidate;
      if (!candidate) return null;

      const stopDistance = atr * stopAtr;
      return Object.freeze({
        side: candidate.side === "high" ? "long" : "short",
        stopDistance,
        targetDistance: stopDistance * rewardRisk,
        signalTime: candle.time,
        metadata: Object.freeze({
          extrema: candidate.extrema,
          extremaCount: candidate.extrema.length,
          zoneLower: candidate.lower,
          zoneUpper: candidate.upper,
          zoneWidthPercent: candidate.widthPercent,
          breakoutLevel: candidate.level,
          atr,
          volumeRatio,
        }),
      });
    },
  });
}
