import { parseBinanceKlines } from "./algo-backtest.js";
import {
  fetchBinanceJson,
  sharedBinanceRequestScheduler,
} from "./binance-request.js";

export const BINANCE_FUTURES_KLINES_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";

export const BINANCE_INTERVAL_MS = Object.freeze({
  "1m": 60_000,
  "3m": 3 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "8h": 8 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "3d": 3 * 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
});

const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}USDT$/;

function validateTimestamp(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a non-negative timestamp`);
}

export async function fetchBinanceFuturesKlines({
  symbol,
  interval = "1m",
  startTime,
  endTime = Date.now(),
  pageLimit = 1_000,
  maxCandles = 50_000,
  fetchImpl = globalThis.fetch,
  requestScheduler = sharedBinanceRequestScheduler,
  maxRetries = 4,
  sleepImpl,
} = {}) {
  const normalizedSymbol = String(symbol ?? "").trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(normalizedSymbol)) throw new RangeError("symbol must be a USDT futures symbol such as BTCUSDT");
  if (!Object.hasOwn(BINANCE_INTERVAL_MS, interval)) throw new RangeError(`unsupported interval: ${interval}`);
  validateTimestamp(startTime, "startTime");
  validateTimestamp(endTime, "endTime");
  if (endTime <= startTime) throw new RangeError("endTime must be after startTime");
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 1_000) throw new RangeError("pageLimit must be between 1 and 1000");
  if (!Number.isInteger(maxCandles) || maxCandles < 2) throw new RangeError("maxCandles must be an integer >= 2");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (typeof requestScheduler !== "function") throw new TypeError("requestScheduler must be a function");

  const intervalMs = BINANCE_INTERVAL_MS[interval];
  let cursor = startTime;
  const byTime = new Map();

  while (cursor < endTime && byTime.size < maxCandles) {
    const limit = Math.min(pageLimit, maxCandles - byTime.size);
    const query = new URLSearchParams({
      symbol: normalizedSymbol,
      interval,
      startTime: String(cursor),
      endTime: String(endTime),
      limit: String(limit),
    });
    const page = await fetchBinanceJson(`${BINANCE_FUTURES_KLINES_ENDPOINT}?${query}`, {
      label: "Binance klines request",
      fetchImpl,
      requestScheduler,
      maxRetries,
      ...(sleepImpl ? { sleepImpl } : {}),
    });
    if (!Array.isArray(page)) throw new TypeError("Binance klines response is not an array");
    if (page.length === 0) break;

    for (const row of page) {
      if (!Array.isArray(row) || row.length < 6) throw new TypeError("Binance returned an invalid kline row");
      const time = Number(row[0]);
      if (Number.isFinite(time) && time >= startTime && time <= endTime) byTime.set(time, row);
    }

    const lastOpenTime = Number(page.at(-1)?.[0]);
    if (!Number.isFinite(lastOpenTime) || lastOpenTime < cursor) {
      throw new Error("Binance pagination did not advance");
    }
    const nextCursor = lastOpenTime + intervalMs;
    if (nextCursor <= cursor) throw new Error("Binance pagination stalled");
    cursor = nextCursor;
    if (page.length < limit) break;
  }

  const rows = [...byTime.values()].sort((left, right) => Number(left[0]) - Number(right[0]));
  if (rows.length < 2) throw new Error("Binance returned fewer than two candles");
  return parseBinanceKlines(rows);
}
