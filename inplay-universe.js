import { fetchBinanceFuturesKlines } from "./binance-history.js";
import {
  fetchBinanceJson,
  sharedBinanceRequestScheduler,
} from "./binance-request.js";

export const BINANCE_FUTURES_EXCHANGE_INFO_ENDPOINT = "https://fapi.binance.com/fapi/v1/exchangeInfo";
export const BINANCE_FUTURES_TICKER_24H_ENDPOINT = "https://fapi.binance.com/fapi/v1/ticker/24hr";
export const DEFAULT_INPLAY_RULES = Object.freeze({
  minV24: 100,
  minNatr1: null,
  minNatr5: null,
  minGrowth24: null,
});

const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}USDT$/;

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requireNonNegative(value, label) {
  if (value !== null && value < 0) throw new RangeError(`${label} must be non-negative or null`);
  return value;
}

export function normalizeInPlayRules(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    minV24: requireNonNegative(finiteOrNull(Object.hasOwn(source, "minV24") ? source.minV24 : DEFAULT_INPLAY_RULES.minV24), "minV24"),
    minNatr1: requireNonNegative(finiteOrNull(source.minNatr1), "minNatr1"),
    minNatr5: requireNonNegative(finiteOrNull(source.minNatr5), "minNatr5"),
    minGrowth24: finiteOrNull(source.minGrowth24),
  };
}

function meetsMinimum(actual, minimum) {
  return minimum === null || (Number.isFinite(actual) && actual >= minimum);
}

export function matchesInPlayRules(metric, rules = DEFAULT_INPLAY_RULES) {
  const normalized = normalizeInPlayRules(rules);
  return [
    meetsMinimum(metric?.quoteVolume24h, normalized.minV24 === null ? null : normalized.minV24 * 1_000_000),
    meetsMinimum(metric?.natr1m, normalized.minNatr1),
    meetsMinimum(metric?.natr5m, normalized.minNatr5),
    meetsMinimum(metric?.change24h, normalized.minGrowth24),
  ].every(Boolean);
}

export function selectInPlayMetrics(metrics, {
  rules = DEFAULT_INPLAY_RULES,
  previousOrder = [],
  limit = 18,
} = {}) {
  if (!Array.isArray(metrics)) throw new TypeError("metrics must be an array");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("limit must be an integer between 1 and 100");

  const eligible = metrics
    .filter((item) => SYMBOL_PATTERN.test(String(item?.symbol ?? "").toUpperCase()))
    .filter((item) => matchesInPlayRules(item, rules));
  const eligibleBySymbol = new Map(eligible.map((item) => [String(item.symbol).toUpperCase(), item]));
  const previous = [...new Set(previousOrder.map((symbol) => String(symbol).toUpperCase()))]
    .filter((symbol) => eligibleBySymbol.has(symbol));
  const known = new Set(previous);
  const newcomers = eligible
    .filter((item) => !known.has(String(item.symbol).toUpperCase()))
    .sort((left, right) => (right.change24h ?? -Infinity) - (left.change24h ?? -Infinity)
      || (right.quoteVolume24h ?? 0) - (left.quoteVolume24h ?? 0)
      || String(left.symbol).localeCompare(String(right.symbol)))
    .map((item) => String(item.symbol).toUpperCase());
  const order = [...previous, ...newcomers];
  return {
    order,
    matches: order.slice(0, limit).map((symbol) => eligibleBySymbol.get(symbol)).filter(Boolean),
  };
}

export function aggregateCandles(candles, size) {
  if (!Array.isArray(candles)) throw new TypeError("candles must be an array");
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  const result = [];
  for (const candle of candles) {
    const time = Math.floor(candle.time / (size * 60_000)) * size * 60_000;
    const last = result.at(-1);
    if (last?.time === time) {
      last.high = Math.max(last.high, candle.high);
      last.low = Math.min(last.low, candle.low);
      last.close = candle.close;
      last.volume += Number(candle.volume) || 0;
    } else {
      result.push({ ...candle, time, volume: Number(candle.volume) || 0 });
    }
  }
  return result;
}

export function calculateNatr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return null;
  const ranges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    if (![candle?.high, candle?.low, candle?.close, previous?.close].every(Number.isFinite)) return null;
    ranges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    ));
  }
  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < ranges.length; index += 1) {
    atr = ((atr * (period - 1)) + ranges[index]) / period;
  }
  const close = candles.at(-1)?.close;
  return Number.isFinite(close) && close > 0 ? (atr / close) * 100 : null;
}

function createPool(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || queue.length === 0) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });
}

export async function fetchCurrentInPlayUniverse({
  rules = DEFAULT_INPLAY_RULES,
  limit = 18,
  now = Date.now(),
  natrLookbackMinutes = 120,
  concurrency = 2,
  fetchImpl = globalThis.fetch,
  fetchKlines = fetchBinanceFuturesKlines,
  requestScheduler = sharedBinanceRequestScheduler,
  maxRetries = 4,
  sleepImpl,
} = {}) {
  const normalizedRules = normalizeInPlayRules(rules);
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (typeof fetchKlines !== "function") throw new TypeError("fetchKlines must be a function");
  if (typeof requestScheduler !== "function") throw new TypeError("requestScheduler must be a function");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new RangeError("concurrency must be between 1 and 8");
  if (!Number.isInteger(natrLookbackMinutes) || natrLookbackMinutes < 30 || natrLookbackMinutes > 1_000) {
    throw new RangeError("natrLookbackMinutes must be between 30 and 1000");
  }

  const requestOptions = {
    fetchImpl,
    requestScheduler,
    maxRetries,
    ...(sleepImpl ? { sleepImpl } : {}),
  };
  const [exchangeInfo, tickers] = await Promise.all([
    fetchBinanceJson(BINANCE_FUTURES_EXCHANGE_INFO_ENDPOINT, {
      ...requestOptions,
      label: "Binance exchangeInfo request",
    }),
    fetchBinanceJson(BINANCE_FUTURES_TICKER_24H_ENDPOINT, {
      ...requestOptions,
      label: "Binance ticker request",
    }),
  ]);
  if (!Array.isArray(exchangeInfo?.symbols)) throw new TypeError("Binance exchangeInfo response is invalid");
  if (!Array.isArray(tickers)) throw new TypeError("Binance ticker response is invalid");

  const tradable = new Set(exchangeInfo.symbols
    .filter((item) => item?.status === "TRADING" && item?.contractType === "PERPETUAL" && item?.quoteAsset === "USDT")
    .map((item) => String(item.symbol).toUpperCase())
    .filter((symbol) => SYMBOL_PATTERN.test(symbol)));

  let metrics = tickers
    .map((ticker) => ({
      symbol: String(ticker?.symbol ?? "").toUpperCase(),
      quoteVolume24h: Number(ticker?.quoteVolume),
      change24h: Number(ticker?.priceChangePercent),
      natr1m: null,
      natr5m: null,
    }))
    .filter((item) => tradable.has(item.symbol))
    .filter((item) => Number.isFinite(item.quoteVolume24h) && Number.isFinite(item.change24h))
    .filter((item) => meetsMinimum(item.quoteVolume24h, normalizedRules.minV24 === null ? null : normalizedRules.minV24 * 1_000_000))
    .filter((item) => meetsMinimum(item.change24h, normalizedRules.minGrowth24));

  const needsNatr = normalizedRules.minNatr1 !== null || normalizedRules.minNatr5 !== null;
  if (needsNatr && metrics.length) {
    const run = createPool(concurrency);
    metrics = await Promise.all(metrics.map((metric) => run(async () => {
      try {
        const candles = await fetchKlines({
          symbol: metric.symbol,
          interval: "1m",
          startTime: now - natrLookbackMinutes * 60_000,
          endTime: now,
          fetchImpl,
          requestScheduler,
          maxRetries,
          ...(sleepImpl ? { sleepImpl } : {}),
        });
        return {
          ...metric,
          natr1m: calculateNatr(candles),
          natr5m: calculateNatr(aggregateCandles(candles, 5)),
        };
      } catch (error) {
        return { ...metric, error: error.message };
      }
    })));
  }

  const selected = selectInPlayMetrics(metrics, { rules: normalizedRules, limit });
  return {
    capturedAt: now,
    rules: normalizedRules,
    order: selected.order,
    matches: selected.matches,
    scanned: metrics.length,
    failed: metrics.filter((item) => item.error).map((item) => ({ symbol: item.symbol, error: item.error })),
  };
}
