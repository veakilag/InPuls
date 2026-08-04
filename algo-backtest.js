export const DEFAULT_BACKTEST_CONFIG = Object.freeze({
  initialEquity: 1_000,
  riskPerTrade: 0.0025,
  feeRate: 0.0005,
  slippageRate: 0.0002,
  maxLeverage: 1,
  startIndex: 0,
});

const EPSILON = 1e-12;

function assertFinitePositive(value, label, { allowZero = false } = {}) {
  const valid = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
  if (!valid) throw new TypeError(`${label} must be a finite ${allowZero ? "non-negative" : "positive"} number`);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 2) {
    throw new TypeError("candles must contain at least two entries");
  }

  let previousTime = -Infinity;
  return candles.map((raw, index) => {
    const time = Number(raw?.time ?? raw?.openTime ?? raw?.t);
    const open = Number(raw?.open ?? raw?.o);
    const high = Number(raw?.high ?? raw?.h);
    const low = Number(raw?.low ?? raw?.l);
    const close = Number(raw?.close ?? raw?.c);
    const volume = Number(raw?.volume ?? raw?.v ?? 0);

    if (!Number.isFinite(time)) throw new TypeError(`candle[${index}].time must be finite`);
    if (time <= previousTime) throw new RangeError("candle times must be strictly increasing");
    previousTime = time;

    for (const [label, value] of Object.entries({ open, high, low, close })) {
      assertFinitePositive(value, `candle[${index}].${label}`);
    }
    assertFinitePositive(volume, `candle[${index}].volume`, { allowZero: true });

    if (high + EPSILON < Math.max(open, close) || low - EPSILON > Math.min(open, close) || low > high) {
      throw new RangeError(`candle[${index}] contains inconsistent OHLC values`);
    }

    return Object.freeze({ time, open, high, low, close, volume });
  });
}

export function calculateAtr(candles, period = 14) {
  if (!Number.isInteger(period) || period < 1) throw new RangeError("ATR period must be a positive integer");
  const normalized = normalizeCandles(candles);
  const trueRanges = normalized.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = normalized[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });

  const atr = Array(normalized.length).fill(null);
  let sum = 0;
  for (let index = 0; index < trueRanges.length; index += 1) {
    sum += trueRanges[index];
    if (index >= period) sum -= trueRanges[index - period];
    if (index >= period - 1) atr[index] = sum / period;
  }
  return atr;
}

export function createBreakoutAtrStrategy({
  lookback = 20,
  atrPeriod = 14,
  stopAtr = 1,
  rewardRisk = 1.5,
  minVolumeRatio = 1.2,
  allowLong = true,
  allowShort = true,
} = {}) {
  for (const [label, value] of Object.entries({ lookback, atrPeriod })) {
    if (!Number.isInteger(value) || value < 2) throw new RangeError(`${label} must be an integer >= 2`);
  }
  for (const [label, value] of Object.entries({ stopAtr, rewardRisk, minVolumeRatio })) {
    assertFinitePositive(value, label);
  }
  if (!allowLong && !allowShort) throw new RangeError("at least one direction must be enabled");

  const warmupBars = Math.max(lookback, atrPeriod);

  return Object.freeze({
    id: "breakout-atr-v1",
    warmupBars,
    describe: () => ({ lookback, atrPeriod, stopAtr, rewardRisk, minVolumeRatio, allowLong, allowShort }),
    prepare(candles) {
      const normalized = normalizeCandles(candles);
      const atr = calculateAtr(normalized, atrPeriod);
      return Object.freeze({ candles: normalized, atr });
    },
    signal({ index, context }) {
      if (!context || !Array.isArray(context.candles) || !Array.isArray(context.atr)) {
        throw new TypeError("strategy context is missing; call prepare first");
      }
      if (!Number.isInteger(index) || index < warmupBars || index >= context.candles.length) return null;

      const candle = context.candles[index];
      const window = context.candles.slice(index - lookback, index);
      const previousHigh = Math.max(...window.map((item) => item.high));
      const previousLow = Math.min(...window.map((item) => item.low));
      const averageVolume = window.reduce((sum, item) => sum + item.volume, 0) / window.length;
      const volumeRatio = averageVolume > 0 ? candle.volume / averageVolume : 1;
      const atrValue = context.atr[index];
      if (!Number.isFinite(atrValue) || atrValue <= 0 || volumeRatio + EPSILON < minVolumeRatio) return null;

      const stopDistance = atrValue * stopAtr;
      const targetDistance = stopDistance * rewardRisk;

      if (allowLong && candle.close > previousHigh) {
        return Object.freeze({
          side: "long",
          stopDistance,
          targetDistance,
          signalTime: candle.time,
          metadata: Object.freeze({ previousHigh, previousLow, atr: atrValue, volumeRatio }),
        });
      }
      if (allowShort && candle.close < previousLow) {
        return Object.freeze({
          side: "short",
          stopDistance,
          targetDistance,
          signalTime: candle.time,
          metadata: Object.freeze({ previousHigh, previousLow, atr: atrValue, volumeRatio }),
        });
      }
      return null;
    },
  });
}

function resolveConfig(config = {}) {
  const resolved = { ...DEFAULT_BACKTEST_CONFIG, ...config };
  for (const key of ["initialEquity", "riskPerTrade", "maxLeverage"]) {
    assertFinitePositive(resolved[key], key);
  }
  for (const key of ["feeRate", "slippageRate"]) {
    assertFinitePositive(resolved[key], key, { allowZero: true });
  }
  if (resolved.riskPerTrade > 1) throw new RangeError("riskPerTrade must be <= 1");
  if (resolved.slippageRate >= 1) throw new RangeError("slippageRate must be < 1");
  if (!Number.isInteger(resolved.startIndex) || resolved.startIndex < 0) {
    throw new RangeError("startIndex must be a non-negative integer");
  }
  return Object.freeze(resolved);
}

function applyEntrySlippage(price, side, rate) {
  return side === "long" ? price * (1 + rate) : price * (1 - rate);
}

function applyExitSlippage(price, side, rate) {
  return side === "long" ? price * (1 - rate) : price * (1 + rate);
}

function createPosition({ signal, candle, index, equity, config }) {
  if (!signal || !["long", "short"].includes(signal.side)) return null;
  assertFinitePositive(signal.stopDistance, "signal.stopDistance");
  assertFinitePositive(signal.targetDistance, "signal.targetDistance");

  const entryPrice = applyEntrySlippage(candle.open, signal.side, config.slippageRate);
  const stopPrice = signal.side === "long"
    ? entryPrice - signal.stopDistance
    : entryPrice + signal.stopDistance;
  const targetPrice = signal.side === "long"
    ? entryPrice + signal.targetDistance
    : entryPrice - signal.targetDistance;

  if (stopPrice <= 0 || targetPrice <= 0) return null;

  const riskBudget = equity * config.riskPerTrade;
  const stopDistance = Math.abs(entryPrice - stopPrice);
  const quantityByRisk = riskBudget / stopDistance;
  const quantityByLeverage = (equity * config.maxLeverage) / entryPrice;
  const quantity = Math.min(quantityByRisk, quantityByLeverage);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const riskCash = quantity * stopDistance;

  return {
    side: signal.side,
    signalTime: signal.signalTime,
    entryTime: candle.time,
    entryIndex: index,
    entryPrice,
    stopPrice,
    targetPrice,
    quantity,
    riskBudget,
    riskCash,
    entryFee: entryPrice * quantity * config.feeRate,
    metadata: signal.metadata ?? null,
  };
}

function chooseExit(position, candle) {
  if (position.side === "long") {
    if (candle.open <= position.stopPrice) return { rawPrice: candle.open, reason: "gap_stop" };
    const stopHit = candle.low <= position.stopPrice;
    const targetHit = candle.high >= position.targetPrice;
    if (stopHit) return { rawPrice: position.stopPrice, reason: "stop" };
    if (targetHit) return { rawPrice: position.targetPrice, reason: "target" };
  } else {
    if (candle.open >= position.stopPrice) return { rawPrice: candle.open, reason: "gap_stop" };
    const stopHit = candle.high >= position.stopPrice;
    const targetHit = candle.low <= position.targetPrice;
    if (stopHit) return { rawPrice: position.stopPrice, reason: "stop" };
    if (targetHit) return { rawPrice: position.targetPrice, reason: "target" };
  }
  return null;
}

function closePosition(position, { rawPrice, reason }, candle, index, config) {
  const exitPrice = applyExitSlippage(rawPrice, position.side, config.slippageRate);
  const grossPnl = position.side === "long"
    ? (exitPrice - position.entryPrice) * position.quantity
    : (position.entryPrice - exitPrice) * position.quantity;
  const exitFee = exitPrice * position.quantity * config.feeRate;
  const fees = position.entryFee + exitFee;
  const netPnl = grossPnl - fees;
  const denominator = Math.max(position.riskCash, EPSILON);

  return Object.freeze({
    side: position.side,
    signalTime: position.signalTime,
    entryTime: position.entryTime,
    exitTime: candle.time,
    entryIndex: position.entryIndex,
    exitIndex: index,
    entryPrice: position.entryPrice,
    exitPrice,
    stopPrice: position.stopPrice,
    targetPrice: position.targetPrice,
    quantity: position.quantity,
    riskBudget: position.riskBudget,
    riskCash: position.riskCash,
    grossPnl,
    fees,
    netPnl,
    rMultiple: netPnl / denominator,
    reason,
    metadata: position.metadata,
  });
}

function calculateMaxDrawdown(equityCurve) {
  let peak = equityCurve[0]?.equity ?? 0;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;

  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const drawdown = peak - point.equity;
    const drawdownPercent = peak > 0 ? drawdown / peak : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdownPercent);
  }
  return { maxDrawdown, maxDrawdownPercent };
}

function summarize({ initialEquity, finalEquity, trades, equityCurve }) {
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const totalFees = trades.reduce((sum, trade) => sum + trade.fees, 0);
  const netPnl = finalEquity - initialEquity;
  const { maxDrawdown, maxDrawdownPercent } = calculateMaxDrawdown(equityCurve);

  return Object.freeze({
    initialEquity,
    finalEquity,
    netPnl,
    returnPercent: (netPnl / initialEquity) * 100,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss > EPSILON ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    expectancy: trades.length ? netPnl / trades.length : 0,
    averageR: trades.length ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length : 0,
    totalFees,
    maxDrawdown,
    maxDrawdownPercent,
  });
}

export function runBacktest(candles, strategy, config = {}) {
  if (!strategy || typeof strategy.prepare !== "function" || typeof strategy.signal !== "function") {
    throw new TypeError("strategy must expose prepare(candles) and signal({ index, context })");
  }

  const normalized = normalizeCandles(candles);
  const resolved = resolveConfig(config);
  const context = strategy.prepare(normalized);
  const firstSignalIndex = Math.max(resolved.startIndex, strategy.warmupBars ?? 0);

  let equity = resolved.initialEquity;
  let position = null;
  let pendingSignal = null;
  const trades = [];
  const equityCurve = [{ time: normalized[0].time, equity }];

  for (let index = 0; index < normalized.length; index += 1) {
    const candle = normalized[index];

    if (equity <= 0) break;

    if (!position && pendingSignal && index >= firstSignalIndex) {
      position = createPosition({ signal: pendingSignal, candle, index, equity, config: resolved });
      pendingSignal = null;
    }

    if (position) {
      const exit = chooseExit(position, candle);
      if (exit) {
        const trade = closePosition(position, exit, candle, index, resolved);
        trades.push(trade);
        equity += trade.netPnl;
        position = null;
      }
    }

    equityCurve.push({ time: candle.time, equity });

    if (!position && !pendingSignal && index >= firstSignalIndex && index < normalized.length - 1) {
      pendingSignal = strategy.signal({ index, context }) ?? null;
    }
  }

  if (position) {
    const finalIndex = normalized.length - 1;
    const finalCandle = normalized[finalIndex];
    const trade = closePosition(
      position,
      { rawPrice: finalCandle.close, reason: "end_of_data" },
      finalCandle,
      finalIndex,
      resolved,
    );
    trades.push(trade);
    equity += trade.netPnl;
    equityCurve.push({ time: finalCandle.time, equity });
  }

  const metrics = summarize({
    initialEquity: resolved.initialEquity,
    finalEquity: equity,
    trades,
    equityCurve,
  });

  return Object.freeze({
    strategyId: strategy.id ?? "custom",
    strategy: typeof strategy.describe === "function" ? strategy.describe() : null,
    config: resolved,
    metrics,
    trades: Object.freeze(trades),
    equityCurve: Object.freeze(equityCurve.map(Object.freeze)),
  });
}

export function runTrainTest({
  candles,
  strategyFactory,
  trainRatio = 0.7,
  contextBars = 100,
  config = {},
}) {
  if (typeof strategyFactory !== "function") throw new TypeError("strategyFactory must be a function");
  if (!Number.isFinite(trainRatio) || trainRatio <= 0.5 || trainRatio >= 0.95) {
    throw new RangeError("trainRatio must be between 0.5 and 0.95");
  }
  if (!Number.isInteger(contextBars) || contextBars < 0) throw new RangeError("contextBars must be a non-negative integer");

  const normalized = normalizeCandles(candles);
  const splitIndex = clamp(Math.floor(normalized.length * trainRatio), 2, normalized.length - 2);
  const trainCandles = normalized.slice(0, splitIndex);
  const contextStart = Math.max(0, splitIndex - contextBars);
  const testCandles = normalized.slice(contextStart);
  const testStartIndex = splitIndex - contextStart;

  const train = runBacktest(trainCandles, strategyFactory(), config);
  const test = runBacktest(testCandles, strategyFactory(), { ...config, startIndex: testStartIndex });

  return Object.freeze({
    splitTime: normalized[splitIndex].time,
    splitIndex,
    train,
    test,
  });
}

export function parseBinanceKlines(rows) {
  if (!Array.isArray(rows)) throw new TypeError("Binance kline payload must be an array");
  return normalizeCandles(rows.map((row, index) => {
    if (!Array.isArray(row) || row.length < 6) throw new TypeError(`Binance kline row ${index} is invalid`);
    return {
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    };
  }));
}
