import {
  canonicalBaseAsset,
  fromVenueSymbol,
  marketSource,
  normalizeCanonicalSymbol,
  toVenueSymbol,
} from "./exchange-registry.js?v=26-126-final-exchanges-v1";
import { resolveBinanceAlphaToken } from "./binance-alpha-symbols.js?v=26-126-final-exchanges-v1";
import {
  decodeGzipJsonMessage,
  decodeJsonMessage,
  decodeMexcProtobufMessage,
} from "./exchange-message-codecs.js?v=26-126-final-exchanges-v1";

const INTERVAL_MS = Object.freeze({
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
  "1M": 2_592_000_000,
});

const BYBIT_INTERVAL = Object.freeze({
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
  "1h": "60", "2h": "120", "4h": "240", "12h": "720",
  "1d": "D", "1w": "W", "1M": "M",
});
const OKX_INTERVAL = Object.freeze({
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1H", "2h": "2H", "4h": "4H", "12h": "12H",
  "1d": "1D", "3d": "3D", "1w": "1W", "1M": "1M",
});
const BITGET_INTERVAL = Object.freeze({
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1H", "2h": "2H", "4h": "4H", "12h": "12H",
  "1d": "1D", "3d": "3D", "1w": "1W", "1M": "1M",
});
const BITGET_SPOT_INTERVAL = Object.freeze({
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1H", "4h": "4H", "12h": "12H",
  "1d": "1D", "3d": "3D", "1w": "1W", "1M": "1M",
});
const BITGET_SPOT_REST_INTERVAL = Object.freeze({
  "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
  "1H": "1h", "4H": "4h", "12H": "12h",
  "1D": "1day", "3D": "3day", "1W": "1week", "1M": "1M",
});
const GATE_INTERVAL = Object.freeze({
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "2h": "2h", "4h": "4h", "12h": "12h",
  "1d": "1d", "3d": "3d", "1w": "7d", "1M": "30d",
});
const KUCOIN_INTERVAL = Object.freeze({
  "1m": "1min", "3m": "3min", "5m": "5min", "15m": "15min", "30m": "30min",
  "1h": "1hour", "2h": "2hour", "4h": "4hour", "12h": "12hour",
  "1d": "1day", "1w": "1week",
});
const KUCOIN_FUTURES_INTERVAL = Object.freeze({
  "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60",
  "2h": "120", "4h": "240", "12h": "720", "1d": "1440", "1w": "10080",
});
const MEXC_FUTURES_INTERVAL = Object.freeze({
  "1m": "Min1", "5m": "Min5", "15m": "Min15", "30m": "Min30",
  "1h": "Min60", "4h": "Hour4", "1d": "Day1", "1w": "Week1", "1M": "Month1",
});
const HTX_INTERVAL = Object.freeze({
  "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
  "1h": "60min", "4h": "4hour", "1d": "1day", "1w": "1week", "1M": "1mon",
});
const UPBIT_MINUTES = Object.freeze({
  "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240,
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validCandle(candle) {
  return candle && [candle.time, candle.open, candle.high, candle.low, candle.close]
    .every((value) => Number.isFinite(Number(value)));
}

function candle(time, open, high, low, close, volume = 0, closeTime = null, closed = true) {
  const isClosed = closed === true || closed === 1 || closed === "1" || closed === "true";
  const result = {
    time: finite(time),
    open: finite(open),
    high: finite(high),
    low: finite(low),
    close: finite(close),
    volume: finite(volume) ?? 0,
    closeTime: finite(closeTime),
    closed: isClosed,
  };
  return validCandle(result) ? result : null;
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(validCandle)
    .sort((left, right) => left.time - right.time)
    .filter((item, index, array) => index === array.length - 1 || item.time !== array[index + 1].time);
}

function timeoutSignal(externalSignal, timeoutMs = 6_000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener?.("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.("abort", abort);
    },
  };
}

async function fetchJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { cache: "no-store", ...options });
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 0}`);
  const payload = await response.json();
  if (payload?.retCode && Number(payload.retCode) !== 0) throw new Error(payload.retMsg || `Bybit ${payload.retCode}`);
  if (payload?.success === false) throw new Error(payload.message || payload.messageDetail || "Exchange error");
  if (payload?.status === "error") throw new Error(payload["err-msg"] || payload.message || "Exchange error");
  if (payload?.code && !["0", "00000", "000000", "200000"].includes(String(payload.code)) && !Array.isArray(payload)) throw new Error(payload.msg || payload.message || `Exchange ${payload.code}`);
  return payload;
}

export function exchangeIntervalMs(interval) {
  return INTERVAL_MS[interval] ?? 60_000;
}

export function nativeInterval(exchange, interval, market = "futures") {
  if (String(interval).endsWith("s")) return null;
  if (exchange === "bybit") return BYBIT_INTERVAL[interval] ?? null;
  if (exchange === "okx") return OKX_INTERVAL[interval] ?? null;
  if (exchange === "bitget") return (market === "spot" ? BITGET_SPOT_INTERVAL : BITGET_INTERVAL)[interval] ?? null;
  if (exchange === "gate") return GATE_INTERVAL[interval] ?? null;
  if (exchange === "kucoin") return (market === "spot" ? KUCOIN_INTERVAL : KUCOIN_FUTURES_INTERVAL)[interval] ?? null;
  if (exchange === "mexc") return market === "spot" ? (INTERVAL_MS[interval] ? interval : null) : MEXC_FUTURES_INTERVAL[interval] ?? null;
  if (exchange === "bingx") return INTERVAL_MS[interval] ? interval : null;
  if (exchange === "htx") return HTX_INTERVAL[interval] ?? null;
  if (exchange === "coinbase") return ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"].includes(interval) ? interval : null;
  if (exchange === "upbit") return UPBIT_MINUTES[interval] ?? (["1d", "1w", "1M"].includes(interval) ? interval : null);
  return INTERVAL_MS[interval] ? interval : null;
}

function intervalPlan(source, interval) {
  const direct = nativeInterval(source.exchange, interval, source.market);
  if (direct) return { native: direct, aggregate: false };
  if (source.exchange === "bybit" && interval === "3d") return { native: "D", aggregate: true };
  if (source.exchange === "bitget" && source.market === "spot" && interval === "3m") return { native: "1m", aggregate: true };
  if (source.exchange === "bitget" && source.market === "spot" && interval === "2h") return { native: "1H", aggregate: true };
  if (["kucoin", "mexc", "htx", "upbit"].includes(source.exchange)) {
    const fallback = {
      "3m": source.exchange === "kucoin" && source.market === "futures" ? "1" : null,
      "2h": source.exchange === "upbit" ? 60 : (source.exchange === "mexc" ? "Min60" : source.exchange === "htx" ? "60min" : source.market === "futures" ? "120" : "2hour"),
      "12h": source.exchange === "upbit" ? 240 : (source.exchange === "mexc" ? "Hour4" : source.exchange === "htx" ? "4hour" : "4hour"),
      "3d": source.exchange === "upbit" ? "1d" : (source.exchange === "mexc" ? "Day1" : source.exchange === "htx" ? "1day" : "1day"),
    }[interval];
    if (fallback) return { native: fallback, aggregate: true };
  }
  return { native: null, aggregate: false };
}

function aggregateCandles(rows, bucketMs) {
  const buckets = new Map();
  for (const row of normalizeRows(rows)) {
    const time = Math.floor(row.time / bucketMs) * bucketMs;
    const current = buckets.get(time);
    if (!current) {
      buckets.set(time, candle(time, row.open, row.high, row.low, row.close, row.volume, time + bucketMs - 1, row.closed));
      continue;
    }
    current.high = Math.max(current.high, row.high);
    current.low = Math.min(current.low, row.low);
    current.close = row.close;
    current.volume += row.volume;
    current.closed = current.closed && row.closed;
  }
  return normalizeRows([...buckets.values()]);
}

export async function resolveMarketMetadata(sourceValue, { fetchImpl = globalThis.fetch, signal } = {}) {
  const source = marketSource(sourceValue);
  const fallback = { ...source, quantityMultiplier: 1, priceTick: null };
  if (source.exchange === "binance_alpha") {
    const token = await resolveBinanceAlphaToken(source.symbol, { fetchImpl, signal });
    if (!token) throw new Error(`Binance Alpha symbol unavailable: ${source.symbol ?? "unknown"}`);
    return {
      ...fallback,
      venueSymbol: token.venueSymbol,
      alphaId: token.alphaId,
      priceTick: 10 ** -token.tradeDecimals,
    };
  }
  if (source.exchange === "hyperliquid" && source.market === "spot") {
    try {
      const payload = await fetchJson("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "spotMeta" }),
        signal,
      }, fetchImpl);
      const tokens = Array.isArray(payload?.tokens) ? payload.tokens : [];
      const universe = Array.isArray(payload?.universe) ? payload.universe : [];
      const baseName = canonicalBaseAsset(source.symbol);
      const aliases = new Set([baseName, baseName === "BTC" ? "UBTC" : baseName]);
      const pair = universe.find((item) => {
        const [baseIndex, quoteIndex] = item?.tokens ?? [];
        const base = String(tokens[baseIndex]?.name ?? "").toUpperCase();
        const quote = String(tokens[quoteIndex]?.name ?? "").toUpperCase();
        return aliases.has(base) && ["USDC", "USDT"].includes(quote);
      });
      if (pair?.name) return { ...fallback, venueSymbol: pair.name };
    } catch {}
    return fallback;
  }
  if (source.market !== "futures") return fallback;
  try {
    if (source.exchange === "okx") {
      const url = `https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=${encodeURIComponent(source.venueSymbol)}`;
      const payload = await fetchJson(url, { signal }, fetchImpl);
      const row = payload?.data?.[0];
      return {
        ...fallback,
        quantityMultiplier: finite(row?.ctVal) || 1,
        priceTick: finite(row?.tickSz),
      };
    }
    if (source.exchange === "gate") {
      const url = `https://api.gateio.ws/api/v4/futures/usdt/contracts/${encodeURIComponent(source.venueSymbol)}`;
      const row = await fetchJson(url, { signal }, fetchImpl);
      return {
        ...fallback,
        quantityMultiplier: finite(row?.quanto_multiplier) || 1,
        priceTick: finite(row?.order_price_round),
      };
    }
    if (source.exchange === "bitget") {
      const url = `https://api.bitget.com/api/v2/mix/market/contracts?productType=usdt-futures&symbol=${encodeURIComponent(source.venueSymbol)}`;
      const payload = await fetchJson(url, { signal }, fetchImpl);
      const row = payload?.data?.[0];
      return {
        ...fallback,
        // Bitget USDT-M depth/trade sizes are already expressed in the base asset.
        // sizeMultiplier is the order-size increment, not a contract-value multiplier.
        quantityMultiplier: 1,
        priceTick: finite(row?.pricePlace) !== null && finite(row?.priceEndStep) !== null
          ? finite(row.priceEndStep) * 10 ** -finite(row.pricePlace)
          : null,
      };
    }
    if (source.exchange === "kucoin") {
      const payload = await fetchJson(`https://api-futures.kucoin.com/api/v1/contracts/${encodeURIComponent(source.venueSymbol)}`, { signal }, fetchImpl);
      const row = payload?.data ?? {};
      return {
        ...fallback,
        venueSymbol: row.symbol || source.venueSymbol,
        quantityMultiplier: finite(row.multiplier) || 1,
        priceTick: finite(row.tickSize),
      };
    }
    if (source.exchange === "mexc") {
      const payload = await fetchJson(`https://contract.mexc.com/api/v1/contract/detail?symbol=${encodeURIComponent(source.venueSymbol)}`, { signal }, fetchImpl);
      const rows = Array.isArray(payload?.data) ? payload.data : [payload?.data];
      const row = rows.find((item) => String(item?.symbol ?? "").toUpperCase() === source.venueSymbol) ?? rows[0] ?? {};
      return { ...fallback, quantityMultiplier: finite(row.contractSize) || 1, priceTick: finite(row.priceUnit) };
    }
    if (source.exchange === "bingx") {
      const payload = await fetchJson("https://open-api.bingx.com/openApi/swap/v2/quote/contracts", { signal }, fetchImpl);
      const row = (payload?.data ?? []).find((item) => String(item?.symbol ?? "").toUpperCase() === source.venueSymbol) ?? {};
      return { ...fallback, quantityMultiplier: finite(row.size) || 1, priceTick: finite(row.pricePrecision) !== null ? 10 ** -finite(row.pricePrecision) : null };
    }
    if (source.exchange === "htx") {
      const payload = await fetchJson(`https://api.hbdm.com/linear-swap-api/v1/swap_contract_info?contract_code=${encodeURIComponent(source.venueSymbol)}`, { signal }, fetchImpl);
      const row = payload?.data?.[0] ?? {};
      return { ...fallback, quantityMultiplier: finite(row.contract_size) || 1, priceTick: finite(row.price_tick) };
    }
  } catch {}
  return fallback;
}

export async function fetchExchangeCandles(sourceValue, interval, limit = 1_500, {
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const source = await resolveMarketMetadata(sourceValue, { fetchImpl, signal });
  const venue = source.venueSymbol;
  const capped = Math.max(30, Math.min(1_500, Math.floor(Number(limit) || 1_500)));
  const plan = intervalPlan(source, interval);
  const native = plan.native;
  if (!native) return [];
  const finalize = (rows) => plan.aggregate
    ? aggregateCandles(rows, exchangeIntervalMs(interval)).slice(-capped)
    : normalizeRows(rows).slice(-capped);
  const timed = timeoutSignal(signal, 7_000);
  try {
    if (source.exchange === "binance") {
      const path = source.market === "spot" ? "api/v3/klines" : "fapi/v1/klines";
      const host = source.market === "spot" ? "api.binance.com" : "fapi.binance.com";
      const query = new URLSearchParams({ symbol: venue, interval, limit: String(capped) });
      const rows = await fetchJson(`https://${host}/${path}?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize(rows.map((row) => candle(row[0], row[1], row[2], row[3], row[4], row[5], row[6], true)));
    }
    if (source.exchange === "aster") {
      const host = source.market === "spot" ? "sapi.asterdex.com/api/v3" : "fapi.asterdex.com/fapi/v3";
      const query = new URLSearchParams({ symbol: venue, interval: native, limit: String(capped) });
      const rows = await fetchJson(`https://${host}/klines?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize(rows.map((row) => candle(row[0], row[1], row[2], row[3], row[4], row[5], row[6], true)));
    }
    if (source.exchange === "binance_alpha") {
      const query = new URLSearchParams({ symbol: venue, interval: native, limit: String(capped) });
      const payload = await fetchJson(`https://www.binance.com/bapi/defi/v1/public/alpha-trade/klines?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize((payload?.data ?? []).map((row) => candle(row[0], row[1], row[2], row[3], row[4], row[5], row[6], true)));
    }
    if (source.exchange === "bybit") {
      const query = new URLSearchParams({
        category: source.market === "spot" ? "spot" : "linear",
        symbol: venue,
        interval: native,
        limit: String(Math.min(1_000, capped)),
      });
      const payload = await fetchJson(`https://api.bybit.com/v5/market/kline?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize((payload?.result?.list ?? []).map((row) => candle(
        row[0], row[1], row[2], row[3], row[4], row[5], Number(row[0]) + exchangeIntervalMs(interval) - 1, true,
      )));
    }
    if (source.exchange === "okx") {
      const query = new URLSearchParams({ instId: venue, bar: native, limit: String(Math.min(300, capped)) });
      const payload = await fetchJson(`https://www.okx.com/api/v5/market/candles?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize((payload?.data ?? []).map((row) => candle(
        row[0], row[1], row[2], row[3], row[4], row[5], Number(row[0]) + exchangeIntervalMs(interval) - 1, row[8] === "1",
      )));
    }
    if (source.exchange === "bitget") {
      const query = source.market === "spot"
        ? new URLSearchParams({ symbol: venue, granularity: BITGET_SPOT_REST_INTERVAL[native] ?? native, limit: String(Math.min(1_000, capped)) })
        : new URLSearchParams({ symbol: venue, productType: "usdt-futures", granularity: native, limit: String(Math.min(1_000, capped)) });
      const path = source.market === "spot" ? "spot/market/candles" : "mix/market/candles";
      const payload = await fetchJson(`https://api.bitget.com/api/v2/${path}?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize((payload?.data ?? []).map((row) => candle(
        row[0], row[1], row[2], row[3], row[4], row[5], Number(row[0]) + exchangeIntervalMs(interval) - 1, true,
      )));
    }
    if (source.exchange === "gate") {
      const query = source.market === "spot"
        ? new URLSearchParams({ currency_pair: venue, interval: native, limit: String(Math.min(1_000, capped)) })
        : new URLSearchParams({ contract: venue, interval: native, limit: String(Math.min(2_000, capped)) });
      const path = source.market === "spot" ? "spot/candlesticks" : "futures/usdt/candlesticks";
      const rows = await fetchJson(`https://api.gateio.ws/api/v4/${path}?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize(rows.map((row) => Array.isArray(row)
        ? candle(Number(row[0]) * 1_000, row[5], row[3], row[4], row[2], row[6] ?? row[1], Number(row[0]) * 1_000 + exchangeIntervalMs(interval) - 1, true)
        : candle(Number(row.t) * 1_000, row.o, row.h, row.l, row.c, row.v, Number(row.t) * 1_000 + exchangeIntervalMs(interval) - 1, true)));
    }
    if (source.exchange === "kucoin") {
      if (source.market === "spot") {
        const query = new URLSearchParams({ symbol: venue, type: native });
        const payload = await fetchJson(`https://api.kucoin.com/api/v1/market/candles?${query}`, { signal: timed.signal }, fetchImpl);
        return finalize((payload?.data ?? []).map((row) => candle(
          Number(row[0]) * 1_000, row[1], row[3], row[4], row[2], row[5], Number(row[0]) * 1_000 + exchangeIntervalMs(interval) - 1, true,
        )));
      }
      const end = Date.now();
      const query = new URLSearchParams({
        symbol: venue,
        granularity: native,
        from: String(end - Math.min(200, capped) * Number(native) * 60_000),
        to: String(end),
      });
      const payload = await fetchJson(`https://api-futures.kucoin.com/api/v1/kline/query?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize((payload?.data ?? []).map((row) => candle(
        row[0], row[1], row[2], row[3], row[4], row[5], Number(row[0]) + exchangeIntervalMs(interval) - 1, true,
      )));
    }
    if (source.exchange === "mexc") {
      if (source.market === "spot") {
        const query = new URLSearchParams({ symbol: venue, interval: native, limit: String(capped) });
        const rows = await fetchJson(`https://api.mexc.com/api/v3/klines?${query}`, { signal: timed.signal }, fetchImpl);
        return finalize(rows.map((row) => candle(row[0], row[1], row[2], row[3], row[4], row[5], row[6], true)));
      }
      const query = new URLSearchParams({ interval: native });
      const payload = await fetchJson(`https://contract.mexc.com/api/v1/contract/kline/${encodeURIComponent(venue)}?${query}`, { signal: timed.signal }, fetchImpl);
      const row = payload?.data ?? {};
      const times = row.time ?? [];
      return finalize(times.map((time, index) => candle(
        Number(time) * 1_000, row.open?.[index], row.high?.[index], row.low?.[index], row.close?.[index], row.vol?.[index], Number(time) * 1_000 + exchangeIntervalMs(interval) - 1, true,
      )));
    }
    if (source.exchange === "bingx") {
      const path = source.market === "spot" ? "spot/v1/market/kline" : "swap/v2/quote/klines";
      const query = new URLSearchParams({ symbol: venue, interval: native, limit: String(Math.min(1_440, capped)) });
      const payload = await fetchJson(`https://open-api.bingx.com/openApi/${path}?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize((payload?.data ?? []).map((row) => Array.isArray(row)
        ? candle(row[0], row[1], row[2], row[3], row[4], row[7] ?? row[5], row[6], true)
        : candle(row.time, row.open, row.high, row.low, row.close, row.volume, Number(row.time) + exchangeIntervalMs(interval) - 1, true)));
    }
    if (source.exchange === "htx") {
      const host = source.market === "spot" ? "api.huobi.pro" : "api.hbdm.com";
      const prefix = source.market === "spot" ? "" : "linear-swap-ex";
      const symbolKey = source.market === "spot" ? "symbol" : "contract_code";
      const query = new URLSearchParams({ [symbolKey]: venue, period: native, size: String(Math.min(2_000, capped)) });
      const payload = await fetchJson(`https://${host}/${prefix ? `${prefix}/` : ""}market/history/kline?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize((payload?.data ?? []).map((row) => candle(
        Number(row.id) * 1_000, row.open, row.high, row.low, row.close, row.vol ?? row.amount, Number(row.id) * 1_000 + exchangeIntervalMs(interval) - 1, true,
      )));
    }
    if (source.exchange === "coinbase") {
      const granularity = {
        "1m": "ONE_MINUTE", "5m": "FIVE_MINUTE", "15m": "FIFTEEN_MINUTE", "30m": "THIRTY_MINUTE",
        "1h": "ONE_HOUR", "2h": "TWO_HOUR", "4h": "FOUR_HOUR", "1d": "ONE_DAY",
      }[interval];
      const end = Math.floor(Date.now() / 1_000);
      const query = new URLSearchParams({
        granularity,
        start: String(end - Math.min(350, capped) * exchangeIntervalMs(interval) / 1_000),
        end: String(end),
        limit: String(Math.min(350, capped)),
      });
      const payload = await fetchJson(`https://api.coinbase.com/api/v3/brokerage/market/products/${encodeURIComponent(venue)}/candles?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize((payload?.candles ?? []).map((row) => candle(
        Number(row.start) * 1_000, row.open, row.high, row.low, row.close, row.volume, (Number(row.start) + exchangeIntervalMs(interval) / 1_000) * 1_000 - 1, true,
      )));
    }
    if (source.exchange === "upbit") {
      let path;
      if (typeof native === "number") path = `minutes/${native}`;
      else path = native === "1d" ? "days" : native === "1w" ? "weeks" : "months";
      const query = new URLSearchParams({ market: venue, count: String(Math.min(200, capped)) });
      const rows = await fetchJson(`https://api.upbit.com/v1/candles/${path}?${query}`, { signal: timed.signal }, fetchImpl);
      return finalize(rows.map((row) => candle(
        Date.parse(`${row.candle_date_time_utc}Z`), row.opening_price, row.high_price, row.low_price, row.trade_price, row.candle_acc_trade_volume, Date.parse(`${row.candle_date_time_utc}Z`) + exchangeIntervalMs(interval) - 1, true,
      )));
    }
    if (source.exchange === "hyperliquid") {
      const endTime = Date.now();
      const payload = await fetchJson("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "candleSnapshot",
          req: {
            coin: venue,
            interval,
            startTime: endTime - capped * exchangeIntervalMs(interval),
            endTime,
          },
        }),
        signal: timed.signal,
      }, fetchImpl);
      return finalize((payload ?? []).map((row) => candle(row.t, row.o, row.h, row.l, row.c, row.v, row.T, true)));
    }
    return [];
  } finally {
    timed.done();
  }
}

function wsDescriptor(url, subscriptions, parse, options = {}) {
  return {
    url,
    binaryType: options.binaryType ?? null,
    decode: options.decode ?? decodeJsonMessage,
    open(socket) {
      if (typeof options.open === "function") return options.open(socket);
      for (const payload of subscriptions) socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
    },
    control: options.control ?? (() => false),
    parse,
  };
}

async function buildSyntheticCandleStream(source, interval, options) {
  const trades = await buildTradeStream(source, options);
  const bucketMs = exchangeIntervalMs(interval);
  let active = null;
  return {
    url: trades.url,
    open: trades.open,
    binaryType: trades.binaryType,
    decode: trades.decode,
    control: trades.control,
    parse(payload) {
      const rows = [];
      for (const trade of trades.parse(payload) ?? []) {
        const time = Math.floor(trade.time / bucketMs) * bucketMs;
        if (!active || active.time !== time) {
          active = candle(time, trade.price, trade.price, trade.price, trade.price, trade.quantity, time + bucketMs - 1, false);
        } else {
          active.high = Math.max(active.high, trade.price);
          active.low = Math.min(active.low, trade.price);
          active.close = trade.price;
          active.volume += trade.quantity;
        }
        rows.push({ ...active });
      }
      return rows;
    },
  };
}

function normalizeEpoch(value) {
  const timestamp = finite(value);
  if (!Number.isFinite(timestamp)) return Date.now();
  if (timestamp > 1e17) return Math.floor(timestamp / 1e6);
  if (timestamp > 1e14) return Math.floor(timestamp / 1e3);
  if (timestamp < 1e11) return timestamp * 1_000;
  return timestamp;
}

async function kucoinWsDescriptor(source, topics, parse, { fetchImpl = globalThis.fetch, signal } = {}) {
  const host = source.market === "spot" ? "https://api.kucoin.com" : "https://api-futures.kucoin.com";
  const payload = await fetchJson(`${host}/api/v1/bullet-public`, { method: "POST", signal }, fetchImpl);
  const server = payload?.data?.instanceServers?.[0];
  const token = payload?.data?.token;
  if (!server?.endpoint || !token) throw new Error("KuCoin WebSocket token unavailable");
  const url = `${server.endpoint}?token=${encodeURIComponent(token)}&connectId=inpuls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return wsDescriptor(url, [], parse, {
    open(socket) {
      topics.forEach((topic, index) => socket.send(JSON.stringify({
        id: `${Date.now()}-${index}`,
        type: "subscribe",
        topic,
        privateChannel: false,
        response: true,
      })));
      const pingEvery = Math.max(8_000, Number(server.pingInterval) || 18_000);
      const timer = setInterval(() => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ id: String(Date.now()), type: "ping" }));
      }, pingEvery);
      socket.addEventListener?.("close", () => clearInterval(timer), { once: true });
    },
  });
}

export async function buildCandleStream(sourceValue, interval, options = {}) {
  const source = await resolveMarketMetadata(sourceValue, options);
  const venue = source.venueSymbol;
  const plan = intervalPlan(source, interval);
  const native = plan.native;
  if (!native || plan.aggregate) return buildSyntheticCandleStream(source, interval, options);
  if (["kucoin", "mexc", "bingx", "htx", "coinbase", "upbit"].includes(source.exchange)) {
    return buildSyntheticCandleStream(source, interval, options);
  }
  if (source.exchange === "binance") {
    const host = source.market === "spot" ? "stream.binance.com:9443" : "fstream.binance.com";
    return wsDescriptor(`wss://${host}/ws/${venue.toLowerCase()}@kline_${interval}`, [], (payload) => {
      const row = (payload?.data ?? payload)?.k;
      return row ? [candle(row.t, row.o, row.h, row.l, row.c, row.v, row.T, row.x)] : [];
    });
  }
  if (source.exchange === "aster") {
    const host = source.market === "spot" ? "sstream.asterdex.com" : "fstream.asterdex.com";
    return wsDescriptor(`wss://${host}/ws/${venue.toLowerCase()}@kline_${native}`, [], (payload) => {
      const row = (payload?.data ?? payload)?.k;
      return row ? [candle(row.t, row.o, row.h, row.l, row.c, row.v, row.T, row.x)] : [];
    });
  }
  if (source.exchange === "binance_alpha") {
    const stream = `${venue.toLowerCase()}@kline_${native}`;
    return wsDescriptor("wss://nbstream.binance.com/w3w/wsa/stream", [
      { method: "SUBSCRIBE", params: [stream], id: 1 },
    ], (payload) => {
      const row = payload?.data?.k;
      return row ? [candle(row.t, row.o, row.h, row.l, row.c, row.v, row.T, row.x)] : [];
    });
  }
  if (source.exchange === "bybit") {
    const category = source.market === "spot" ? "spot" : "linear";
    return wsDescriptor(`wss://stream.bybit.com/v5/public/${category}`, [
      { op: "subscribe", args: [`kline.${native}.${venue}`] },
    ], (payload) => (payload?.topic?.startsWith("kline.") ? (payload.data ?? []).map((row) => candle(
      row.start, row.open, row.high, row.low, row.close, row.volume, row.end, row.confirm,
    )) : []));
  }
  if (source.exchange === "okx") {
    return wsDescriptor("wss://ws.okx.com:8443/ws/v5/business", [
      { op: "subscribe", args: [{ channel: `candle${native}`, instId: venue }] },
    ], (payload) => (String(payload?.arg?.channel ?? "").startsWith("candle") ? (payload.data ?? []).map((row) => candle(
      row[0], row[1], row[2], row[3], row[4], row[5], Number(row[0]) + exchangeIntervalMs(interval) - 1, row[8] === "1",
    )) : []));
  }
  if (source.exchange === "bitget") {
    const instType = source.market === "spot" ? "SPOT" : "USDT-FUTURES";
    return wsDescriptor("wss://ws.bitget.com/v2/ws/public", [
      { op: "subscribe", args: [{ instType, channel: `candle${native}`, instId: venue }] },
    ], (payload) => (String(payload?.arg?.channel ?? "").startsWith("candle") ? (payload.data ?? []).map((row) => candle(
      row[0], row[1], row[2], row[3], row[4], row[5], Number(row[0]) + exchangeIntervalMs(interval) - 1, false,
    )) : []));
  }
  if (source.exchange === "gate") {
    const prefix = source.market === "spot" ? "spot" : "futures";
    const url = source.market === "spot" ? "wss://api.gateio.ws/ws/v4/" : "wss://fx-ws.gateio.ws/v4/ws/usdt";
    return wsDescriptor(url, [{
      time: Math.floor(Date.now() / 1_000),
      channel: `${prefix}.candlesticks`,
      event: "subscribe",
      payload: [native, venue],
    }], (payload) => {
      if (payload?.channel !== `${prefix}.candlesticks` || payload?.event !== "update") return [];
      const row = payload.result;
      return row ? [candle(Number(row.t) * 1_000, row.o, row.h, row.l, row.c, row.v, Number(row.t) * 1_000 + exchangeIntervalMs(interval) - 1, row.w)] : [];
    });
  }
  return wsDescriptor("wss://api.hyperliquid.xyz/ws", [{
    method: "subscribe",
    subscription: { type: "candle", coin: venue, interval },
  }], (payload) => payload?.channel === "candle" && payload?.data
    ? [candle(payload.data.t, payload.data.o, payload.data.h, payload.data.l, payload.data.c, payload.data.v, payload.data.T, false)]
    : []);
}

function normalizedTrade(id, time, price, quantity, side, multiplier = 1) {
  const numericPrice = finite(price);
  const numericQuantity = finite(quantity);
  const numericTime = finite(time);
  const numericMultiplier = finite(multiplier) || 1;
  if (![numericPrice, numericQuantity, numericTime].every(Number.isFinite)) return null;
  const baseQuantity = numericQuantity * numericMultiplier;
  const normalizedSide = String(side ?? "").trim().toLowerCase();
  return {
    id: String(id ?? `${numericTime}-${numericPrice}-${baseQuantity}`),
    time: numericTime,
    eventTime: numericTime,
    price: numericPrice,
    quantity: baseQuantity,
    quote: numericPrice * baseQuantity,
    side: ["sell", "s", "a", "ask"].includes(normalizedSide) ? "sell" : "buy",
  };
}

export async function buildTradeStream(sourceValue, options = {}) {
  const source = await resolveMarketMetadata(sourceValue, options);
  const venue = source.venueSymbol;
  const multiplier = source.quantityMultiplier;
  if (source.exchange === "binance") {
    const host = source.market === "spot" ? "stream.binance.com:9443" : "fstream.binance.com";
    return wsDescriptor(`wss://${host}/ws/${venue.toLowerCase()}@aggTrade`, [], (payload) => {
      const row = payload?.data ?? payload;
      const trade = row?.e === "aggTrade" ? normalizedTrade(row.a, row.T, row.p, row.q, row.m ? "sell" : "buy", 1) : null;
      return trade ? [trade] : [];
    });
  }
  if (source.exchange === "aster") {
    const host = source.market === "spot" ? "sstream.asterdex.com" : "fstream.asterdex.com";
    return wsDescriptor(`wss://${host}/ws/${venue.toLowerCase()}@aggTrade`, [], (payload) => {
      const row = payload?.data ?? payload;
      const trade = row?.e === "aggTrade" ? normalizedTrade(row.a, row.T, row.p, row.q, row.m ? "sell" : "buy", 1) : null;
      return trade ? [trade] : [];
    });
  }
  if (source.exchange === "binance_alpha") {
    const stream = `${venue.toLowerCase()}@aggTrade`;
    return wsDescriptor("wss://nbstream.binance.com/w3w/wsa/stream", [
      { method: "SUBSCRIBE", params: [stream], id: 1 },
    ], (payload) => {
      const row = payload?.data;
      const trade = row?.e === "aggTrade" ? normalizedTrade(row.a, row.T, row.p, row.q, row.m ? "sell" : "buy", 1) : null;
      return trade ? [trade] : [];
    });
  }
  if (source.exchange === "bybit") {
    const category = source.market === "spot" ? "spot" : "linear";
    return wsDescriptor(`wss://stream.bybit.com/v5/public/${category}`, [
      { op: "subscribe", args: [`publicTrade.${venue}`] },
    ], (payload) => payload?.topic?.startsWith("publicTrade.")
      ? (payload.data ?? []).map((row) => normalizedTrade(row.i, row.T, row.p, row.v, row.S, multiplier)).filter(Boolean)
      : []);
  }
  if (source.exchange === "okx") {
    return wsDescriptor("wss://ws.okx.com:8443/ws/v5/public", [
      { op: "subscribe", args: [{ channel: "trades", instId: venue }] },
    ], (payload) => payload?.arg?.channel === "trades"
      ? (payload.data ?? []).map((row) => normalizedTrade(row.tradeId, row.ts, row.px, row.sz, row.side, multiplier)).filter(Boolean)
      : []);
  }
  if (source.exchange === "bitget") {
    const instType = source.market === "spot" ? "SPOT" : "USDT-FUTURES";
    return wsDescriptor("wss://ws.bitget.com/v2/ws/public", [
      { op: "subscribe", args: [{ instType, channel: "trade", instId: venue }] },
    ], (payload) => payload?.arg?.channel === "trade"
      ? (payload.data ?? []).map((row) => Array.isArray(row)
        ? normalizedTrade(row[0], row[0], row[1], row[2], row[3], multiplier)
        : normalizedTrade(row.tradeId, row.ts, row.price, row.size, row.side, multiplier)).filter(Boolean)
      : []);
  }
  if (source.exchange === "gate") {
    const prefix = source.market === "spot" ? "spot" : "futures";
    const url = source.market === "spot" ? "wss://api.gateio.ws/ws/v4/" : "wss://fx-ws.gateio.ws/v4/ws/usdt";
    return wsDescriptor(url, [{
      time: Math.floor(Date.now() / 1_000),
      channel: `${prefix}.trades`,
      event: "subscribe",
      payload: [venue],
    }], (payload) => {
      if (payload?.channel !== `${prefix}.trades` || payload?.event !== "update") return [];
      const rows = Array.isArray(payload.result) ? payload.result : [payload.result];
      return rows.map((row) => normalizedTrade(
        row?.id, finite(row?.create_time_ms) ?? Number(row?.create_time) * 1_000, row?.price, Math.abs(Number(row?.amount ?? row?.size)), row?.side ?? (Number(row?.size) < 0 ? "sell" : "buy"), multiplier,
      )).filter(Boolean);
    });
  }
  if (source.exchange === "kucoin") {
    const topic = source.market === "spot" ? `/market/match:${venue}` : `/contractMarket/execution:${venue}`;
    return kucoinWsDescriptor(source, [topic], (payload) => {
      if (payload?.type !== "message" || payload?.topic !== topic) return [];
      const row = payload.data ?? {};
      const trade = normalizedTrade(
        row.tradeId ?? row.sequence,
        normalizeEpoch(row.time ?? row.ts),
        row.price,
        row.size ?? row.matchSize,
        row.side,
        multiplier,
      );
      return trade ? [trade] : [];
    }, options);
  }
  if (source.exchange === "mexc") {
    if (source.market === "spot") {
      const channel = `spot@public.aggre.deals.v3.api.pb@100ms@${venue}`;
      return wsDescriptor("wss://wbs-api.mexc.com/ws", [{ method: "SUBSCRIPTION", params: [channel] }], (payload) => (
        payload?.deals ?? []
      ).map((row) => normalizedTrade(row.id, normalizeEpoch(row.time), row.price, row.quantity, Number(row.tradeType) === 2 ? "sell" : "buy", 1)).filter(Boolean), {
        binaryType: "arraybuffer",
        decode: decodeMexcProtobufMessage,
      });
    }
    return wsDescriptor("wss://contract.mexc.com/edge", [{ method: "sub.deal", param: { symbol: venue } }], (payload) => {
      if (payload?.channel !== "push.deal") return [];
      const rows = Array.isArray(payload.data) ? payload.data : [payload.data];
      return rows.map((row) => normalizedTrade(row?.id, normalizeEpoch(row?.t), row?.p, row?.v, Number(row?.T) === 2 ? "sell" : "buy", multiplier)).filter(Boolean);
    });
  }
  if (source.exchange === "bingx") {
    const channel = `${venue}@trade`;
    return wsDescriptor("wss://open-api-ws.bingx.com/market", [{ id: `inpuls-${Date.now()}`, dataType: channel }], (payload) => {
      if (payload?.dataType !== channel) return [];
      const rows = Array.isArray(payload.data) ? payload.data : [payload.data];
      return rows.map((row) => normalizedTrade(row?.t, normalizeEpoch(row?.T), row?.p, row?.q ?? row?.v, row?.m ? "sell" : "buy", multiplier)).filter(Boolean);
    }, {
      binaryType: "arraybuffer",
      decode: decodeGzipJsonMessage,
      control(socket, payload) {
        if (payload !== "Ping") return false;
        socket.send("Pong");
        return true;
      },
    });
  }
  if (source.exchange === "htx") {
    const topic = `market.${venue}.trade.detail`;
    const url = source.market === "spot" ? "wss://api.huobi.pro/ws" : "wss://api.hbdm.com/linear-swap-ws";
    return wsDescriptor(url, [{ sub: topic, id: `inpuls-${Date.now()}` }], (payload) => {
      if (payload?.ch !== topic) return [];
      return (payload?.tick?.data ?? []).map((row) => normalizedTrade(row.id, normalizeEpoch(row.ts), row.price, row.amount, row.direction, multiplier)).filter(Boolean);
    }, {
      binaryType: "arraybuffer",
      decode: decodeGzipJsonMessage,
      control(socket, payload) {
        if (!Number.isFinite(Number(payload?.ping))) return false;
        socket.send(JSON.stringify({ pong: payload.ping }));
        return true;
      },
    });
  }
  if (source.exchange === "coinbase") {
    return wsDescriptor("wss://advanced-trade-ws.coinbase.com/", [
      { type: "subscribe", product_ids: [venue], channel: "market_trades" },
      { type: "subscribe", channel: "heartbeats" },
    ], (payload) => {
      if (payload?.channel !== "market_trades") return [];
      return (payload.events ?? []).flatMap((event) => event.trades ?? []).map((row) => normalizedTrade(
        row.trade_id, Date.parse(row.time), row.price, row.size, row.side, 1,
      )).filter(Boolean);
    });
  }
  if (source.exchange === "upbit") {
    return wsDescriptor("wss://api.upbit.com/websocket/v1", [[
      { ticket: `inpuls-${Date.now()}` },
      { type: "trade", codes: [venue], is_only_realtime: true },
      { format: "DEFAULT" },
    ]], (payload) => {
      if (payload?.type !== "trade") return [];
      const trade = normalizedTrade(payload.sequential_id, payload.trade_timestamp, payload.trade_price, payload.trade_volume, payload.ask_bid === "ASK" ? "sell" : "buy", 1);
      return trade ? [trade] : [];
    }, { binaryType: "arraybuffer" });
  }
  return wsDescriptor("wss://api.hyperliquid.xyz/ws", [{
    method: "subscribe",
    subscription: { type: "trades", coin: venue },
  }], (payload) => payload?.channel === "trades"
    ? (payload.data ?? []).map((row) => normalizedTrade(row.hash ?? row.tid, row.time, row.px, row.sz, row.side, 1)).filter(Boolean)
    : []);
}

function rowsWithMultiplier(rows, multiplier = 1) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const price = finite(Array.isArray(row) ? row[0] : row?.px ?? row?.p ?? row?.price ?? row?.price_level);
    const quantity = finite(Array.isArray(row) ? row[1] : row?.sz ?? row?.s ?? row?.size ?? row?.quantity ?? row?.new_quantity);
    return [price, Number.isFinite(quantity) ? quantity * multiplier : null];
  }).filter(([price, quantity]) => Number.isFinite(price) && Number.isFinite(quantity));
}

export async function fetchExchangeOrderBook(sourceValue, limit = 1_000, options = {}) {
  const { fetchImpl = globalThis.fetch, signal } = options;
  const source = await resolveMarketMetadata(sourceValue, options);
  const venue = source.venueSymbol;
  const multiplier = source.quantityMultiplier;
  if (source.exchange === "binance") {
    const host = source.market === "spot" ? "api.binance.com/api/v3" : "fapi.binance.com/fapi/v1";
    const payload = await fetchJson(`https://${host}/depth?symbol=${encodeURIComponent(venue)}&limit=${Math.min(1_000, limit)}`, { signal }, fetchImpl);
    return { bids: rowsWithMultiplier(payload.bids, multiplier), asks: rowsWithMultiplier(payload.asks, multiplier), sequence: finite(payload.lastUpdateId) };
  }
  if (source.exchange === "aster") {
    const host = source.market === "spot" ? "sapi.asterdex.com/api/v3" : "fapi.asterdex.com/fapi/v3";
    const payload = await fetchJson(`https://${host}/depth?symbol=${encodeURIComponent(venue)}&limit=${Math.min(1_000, limit)}`, { signal }, fetchImpl);
    return { bids: rowsWithMultiplier(payload.bids, multiplier), asks: rowsWithMultiplier(payload.asks, multiplier), sequence: finite(payload.lastUpdateId) };
  }
  if (source.exchange === "binance_alpha") {
    const url = `https://www.binance.com/bapi/defi/v1/public/alpha-trade/fullDepth?symbol=${encodeURIComponent(venue)}&limit=${Math.min(1_000, limit)}`;
    const payload = await fetchJson(url, { signal }, fetchImpl);
    const row = payload?.data ?? {};
    return { bids: rowsWithMultiplier(row.bids, multiplier), asks: rowsWithMultiplier(row.asks, multiplier), sequence: finite(row.lastUpdateId) };
  }
  if (source.exchange === "bybit") {
    const category = source.market === "spot" ? "spot" : "linear";
    const query = new URLSearchParams({ category, symbol: venue, limit: String(Math.min(1_000, limit)) });
    const payload = await fetchJson(`https://api.bybit.com/v5/market/orderbook?${query}`, { signal }, fetchImpl);
    return { bids: rowsWithMultiplier(payload?.result?.b, multiplier), asks: rowsWithMultiplier(payload?.result?.a, multiplier), sequence: finite(payload?.result?.u) };
  }
  if (source.exchange === "okx") {
    const payload = await fetchJson(`https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(venue)}&sz=${Math.min(400, limit)}`, { signal }, fetchImpl);
    const row = payload?.data?.[0] ?? {};
    return { bids: rowsWithMultiplier(row.bids, multiplier), asks: rowsWithMultiplier(row.asks, multiplier), sequence: finite(row.seqId) };
  }
  if (source.exchange === "bitget") {
    const url = source.market === "spot"
      ? `https://api.bitget.com/api/v2/spot/market/orderbook?symbol=${encodeURIComponent(venue)}&type=step0&limit=${Math.min(150, limit)}`
      : `https://api.bitget.com/api/v2/mix/market/merge-depth?symbol=${encodeURIComponent(venue)}&productType=usdt-futures&precision=scale0&limit=${Math.min(100, limit)}`;
    const payload = await fetchJson(url, { signal }, fetchImpl);
    const row = payload?.data ?? {};
    return { bids: rowsWithMultiplier(row.bids, multiplier), asks: rowsWithMultiplier(row.asks, multiplier), sequence: finite(row.seq) };
  }
  if (source.exchange === "gate") {
    const url = source.market === "spot"
      ? `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${encodeURIComponent(venue)}&limit=${Math.min(100, limit)}&with_id=true`
      : `https://api.gateio.ws/api/v4/futures/usdt/order_book?contract=${encodeURIComponent(venue)}&limit=${Math.min(100, limit)}&with_id=true`;
    const payload = await fetchJson(url, { signal }, fetchImpl);
    return { bids: rowsWithMultiplier(payload.bids, multiplier), asks: rowsWithMultiplier(payload.asks, multiplier), sequence: finite(payload.id) };
  }
  if (source.exchange === "kucoin") {
    const url = source.market === "spot"
      ? `https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=${encodeURIComponent(venue)}`
      : `https://api-futures.kucoin.com/api/v1/level2/depth100?symbol=${encodeURIComponent(venue)}`;
    const payload = await fetchJson(url, { signal }, fetchImpl);
    const row = payload?.data ?? {};
    return { bids: rowsWithMultiplier(row.bids, multiplier), asks: rowsWithMultiplier(row.asks, multiplier), sequence: finite(row.sequence) };
  }
  if (source.exchange === "mexc") {
    const url = source.market === "spot"
      ? `https://api.mexc.com/api/v3/depth?symbol=${encodeURIComponent(venue)}&limit=${Math.min(1_000, limit)}`
      : `https://contract.mexc.com/api/v1/contract/depth/${encodeURIComponent(venue)}`;
    const payload = await fetchJson(url, { signal }, fetchImpl);
    const row = source.market === "spot" ? payload : payload?.data ?? {};
    return { bids: rowsWithMultiplier(row.bids, multiplier), asks: rowsWithMultiplier(row.asks, multiplier), sequence: finite(row.lastUpdateId ?? row.version) };
  }
  if (source.exchange === "bingx") {
    const path = source.market === "spot" ? "spot/v1/market/depth" : "swap/v2/quote/depth";
    const maximum = source.market === "spot" ? 100 : 1_000;
    const requested = Math.min(maximum, Math.max(5, Number(limit) || maximum));
    const depthLimit = [1_000, 500, 100, 50, 20, 10, 5].find((value) => value <= requested && value <= maximum) ?? 5;
    const query = new URLSearchParams({ symbol: venue, limit: String(depthLimit) });
    const payload = await fetchJson(`https://open-api.bingx.com/openApi/${path}?${query}`, { signal }, fetchImpl);
    const row = payload?.data ?? {};
    return { bids: rowsWithMultiplier(row.bids, multiplier), asks: rowsWithMultiplier(row.asks, multiplier), sequence: finite(row.T ?? row.ts) };
  }
  if (source.exchange === "htx") {
    const host = source.market === "spot" ? "api.huobi.pro" : "api.hbdm.com";
    const prefix = source.market === "spot" ? "" : "linear-swap-ex/";
    const symbolKey = source.market === "spot" ? "symbol" : "contract_code";
    const query = new URLSearchParams({ [symbolKey]: venue, type: "step0", depth: String(Math.min(150, limit)) });
    const payload = await fetchJson(`https://${host}/${prefix}market/depth?${query}`, { signal }, fetchImpl);
    const row = payload?.tick ?? {};
    return { bids: rowsWithMultiplier(row.bids, multiplier), asks: rowsWithMultiplier(row.asks, multiplier), sequence: finite(row.version ?? payload.ts) };
  }
  if (source.exchange === "coinbase") {
    const query = new URLSearchParams({ product_id: venue, limit: String(Math.min(1_000, limit)) });
    const payload = await fetchJson(`https://api.coinbase.com/api/v3/brokerage/market/product_book?${query}`, { signal }, fetchImpl);
    const row = payload?.pricebook ?? {};
    return { bids: rowsWithMultiplier(row.bids, 1), asks: rowsWithMultiplier(row.asks, 1), sequence: finite(row.time) };
  }
  if (source.exchange === "upbit") {
    const payload = await fetchJson(`https://api.upbit.com/v1/orderbook?markets=${encodeURIComponent(venue)}&count=${Math.min(30, limit)}`, { signal }, fetchImpl);
    const row = payload?.[0] ?? {};
    const units = row.orderbook_units ?? [];
    return {
      bids: units.map((item) => [finite(item.bid_price), finite(item.bid_size)]).filter((item) => item.every(Number.isFinite)),
      asks: units.map((item) => [finite(item.ask_price), finite(item.ask_size)]).filter((item) => item.every(Number.isFinite)),
      sequence: finite(row.timestamp),
    };
  }
  const payload = await fetchJson("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "l2Book", coin: venue }),
    signal,
  }, fetchImpl);
  return { bids: rowsWithMultiplier(payload?.levels?.[0], 1), asks: rowsWithMultiplier(payload?.levels?.[1], 1), sequence: finite(payload?.time) };
}

export async function buildOrderBookStream(sourceValue, options = {}) {
  const source = await resolveMarketMetadata(sourceValue, options);
  const venue = source.venueSymbol;
  const multiplier = source.quantityMultiplier;
  const depthOnly = options.depthOnly === true;
  const emitBook = (snapshot, bids, asks, eventTime, sequence = null, sync = {}) => ({
    kind: "book",
    snapshot,
    bids: rowsWithMultiplier(bids, multiplier),
    asks: rowsWithMultiplier(asks, multiplier),
    eventTime: finite(eventTime) ?? Date.now(),
    sequence: finite(sequence),
    firstSequence: finite(sync.firstSequence),
    previousSequence: finite(sync.previousSequence),
    requiresSnapshot: sync.requiresSnapshot === true,
  });
  const emitTrades = (trades) => ({ kind: "trades", trades: trades.filter(Boolean) });
  if (source.exchange === "binance") {
    const host = source.market === "spot" ? "stream.binance.com:9443" : "fstream.binance.com";
    const stream = venue.toLowerCase();
    return wsDescriptor(`wss://${host}/ws/${stream}@depth@100ms`, [], (payload) => {
      if (payload?.e !== "depthUpdate") return [];
      return [emitBook(false, payload.b ?? payload.bids, payload.a ?? payload.asks, payload.T ?? payload.E, payload.u, {
        firstSequence: payload.U,
        previousSequence: payload.pu,
        requiresSnapshot: true,
      })];
    });
  }
  if (source.exchange === "aster") {
    const host = source.market === "spot" ? "sstream.asterdex.com" : "fstream.asterdex.com";
    const stream = venue.toLowerCase();
    const streams = depthOnly ? `${stream}@depth@100ms` : `${stream}@depth@100ms/${stream}@aggTrade`;
    return wsDescriptor(`wss://${host}/stream?streams=${streams}`, [], (payload) => {
      const row = payload?.data ?? payload;
      if (row?.e === "depthUpdate") return [emitBook(false, row.b ?? row.bids, row.a ?? row.asks, row.T ?? row.E, row.u, {
        firstSequence: row.U,
        previousSequence: row.pu,
        requiresSnapshot: true,
      })];
      if (row?.e === "aggTrade") return [emitTrades([normalizedTrade(row.a, row.T, row.p, row.q, row.m ? "sell" : "buy", 1)])];
      return [];
    });
  }
  if (source.exchange === "binance_alpha") {
    const stream = venue.toLowerCase();
    return wsDescriptor("wss://nbstream.binance.com/w3w/wsa/stream", [{
      method: "SUBSCRIBE",
      params: depthOnly ? [`${stream}@fulldepth@500ms`] : [`${stream}@fulldepth@500ms`, `${stream}@aggTrade`],
      id: 1,
    }], (payload) => {
      const row = payload?.data;
      if (row?.e === "depthUpdate") return [emitBook(false, row.b, row.a, row.T ?? row.E, row.u, {
        firstSequence: row.U,
        previousSequence: row.pu,
        requiresSnapshot: true,
      })];
      if (row?.e === "aggTrade") return [emitTrades([normalizedTrade(row.a, row.T, row.p, row.q, row.m ? "sell" : "buy", 1)])];
      return [];
    });
  }
  if (source.exchange === "bybit") {
    const category = source.market === "spot" ? "spot" : "linear";
    return wsDescriptor(`wss://stream.bybit.com/v5/public/${category}`, [{
      op: "subscribe", args: depthOnly ? [`orderbook.200.${venue}`] : [`orderbook.200.${venue}`, `publicTrade.${venue}`],
    }], (payload) => {
      if (payload?.topic?.startsWith("orderbook.")) return [emitBook(payload.type === "snapshot", payload.data?.b, payload.data?.a, payload.data?.cts ?? payload.ts, payload.data?.u)];
      if (payload?.topic?.startsWith("publicTrade.")) return [emitTrades((payload.data ?? []).map((row) => normalizedTrade(row.i, row.T, row.p, row.v, row.S, multiplier)))];
      return [];
    });
  }
  if (source.exchange === "okx") {
    return wsDescriptor("wss://ws.okx.com:8443/ws/v5/public", [{
      op: "subscribe", args: depthOnly
        ? [{ channel: "books", instId: venue }]
        : [{ channel: "books", instId: venue }, { channel: "trades", instId: venue }],
    }], (payload) => {
      if (payload?.arg?.channel === "books") return (payload.data ?? []).map((row) => emitBook(payload.action === "snapshot", row.bids, row.asks, row.ts, row.seqId));
      if (payload?.arg?.channel === "trades") return [emitTrades((payload.data ?? []).map((row) => normalizedTrade(row.tradeId, row.ts, row.px, row.sz, row.side, multiplier)))];
      return [];
    });
  }
  if (source.exchange === "bitget") {
    const instType = source.market === "spot" ? "SPOT" : "USDT-FUTURES";
    return wsDescriptor("wss://ws.bitget.com/v2/ws/public", [{
      op: "subscribe",
      args: depthOnly
        ? [{ instType, channel: "books", instId: venue }]
        : [{ instType, channel: "books", instId: venue }, { instType, channel: "trade", instId: venue }],
    }], (payload) => {
      if (payload?.arg?.channel === "books") return (payload.data ?? []).map((row) => emitBook(payload.action === "snapshot", row.bids, row.asks, row.ts, row.seq));
      if (payload?.arg?.channel === "trade") return [emitTrades((payload.data ?? []).map((row) => Array.isArray(row)
        ? normalizedTrade(row[0], row[0], row[1], row[2], row[3], multiplier)
        : normalizedTrade(row.tradeId, row.ts, row.price, row.size, row.side, multiplier)))];
      return [];
    });
  }
  if (source.exchange === "gate") {
    const prefix = source.market === "spot" ? "spot" : "futures";
    const url = source.market === "spot" ? "wss://api.gateio.ws/ws/v4/" : "wss://fx-ws.gateio.ws/v4/ws/usdt";
    const depthPayload = source.market === "spot" ? [venue, "100ms"] : [venue, "100ms", "100"];
    const subscriptions = [
      { time: Math.floor(Date.now() / 1_000), channel: `${prefix}.order_book_update`, event: "subscribe", payload: depthPayload },
    ];
    if (!depthOnly) subscriptions.push({ time: Math.floor(Date.now() / 1_000), channel: `${prefix}.trades`, event: "subscribe", payload: [venue] });
    return wsDescriptor(url, subscriptions, (payload) => {
      if (payload?.channel === `${prefix}.order_book_update` && payload?.event === "update") {
        const row = payload.result ?? {};
        return [emitBook(Boolean(row.full), row.b ?? row.bids, row.a ?? row.asks, row.t ?? payload.time_ms, row.u)];
      }
      if (payload?.channel === `${prefix}.trades` && payload?.event === "update") {
        const rows = Array.isArray(payload.result) ? payload.result : [payload.result];
        return [emitTrades(rows.map((row) => normalizedTrade(row?.id, finite(row?.create_time_ms) ?? Number(row?.create_time) * 1_000, row?.price, Math.abs(Number(row?.amount ?? row?.size)), row?.side ?? (Number(row?.size) < 0 ? "sell" : "buy"), multiplier)))];
      }
      return [];
    });
  }
  if (source.exchange === "kucoin") {
    const bookTopic = source.market === "spot" ? `/spotMarket/level2Depth50:${venue}` : `/contractMarket/level2Depth50:${venue}`;
    const tradeTopic = source.market === "spot" ? `/market/match:${venue}` : `/contractMarket/execution:${venue}`;
    return kucoinWsDescriptor(source, depthOnly ? [bookTopic] : [bookTopic, tradeTopic], (payload) => {
      if (payload?.type !== "message") return [];
      const row = payload.data ?? {};
      if (payload.topic === bookTopic) return [emitBook(true, row.bids, row.asks, normalizeEpoch(row.timestamp ?? row.ts), row.sequence)];
      if (payload.topic === tradeTopic) return [emitTrades([normalizedTrade(
        row.tradeId ?? row.sequence, normalizeEpoch(row.time ?? row.ts), row.price, row.size ?? row.matchSize, row.side, multiplier,
      )])];
      return [];
    }, options);
  }
  if (source.exchange === "mexc") {
    if (source.market === "spot") {
      const depthChannel = `spot@public.aggre.depth.v3.api.pb@100ms@${venue}`;
      const tradeChannel = `spot@public.aggre.deals.v3.api.pb@100ms@${venue}`;
      return wsDescriptor("wss://wbs-api.mexc.com/ws", [{ method: "SUBSCRIPTION", params: depthOnly ? [depthChannel] : [depthChannel, tradeChannel] }], (payload) => {
        if (payload?.depth) return [emitBook(false, payload.depth.bids, payload.depth.asks, payload.depth.eventTime ?? payload.sendTime, payload.depth.sequence, {
          firstSequence: payload.depth.firstSequence,
          requiresSnapshot: true,
        })];
        if (payload?.deals) return [emitTrades(payload.deals.map((row) => normalizedTrade(
          row.id, normalizeEpoch(row.time), row.price, row.quantity, Number(row.tradeType) === 2 ? "sell" : "buy", 1,
        )))];
        return [];
      }, { binaryType: "arraybuffer", decode: decodeMexcProtobufMessage });
    }
    const subscriptions = [{ method: "sub.depth.full", param: { symbol: venue, limit: 20 } }];
    if (!depthOnly) subscriptions.push({ method: "sub.deal", param: { symbol: venue } });
    return wsDescriptor("wss://contract.mexc.com/edge", subscriptions, (payload) => {
      if (payload?.channel === "push.depth.full") {
        const row = payload.data ?? {};
        return [emitBook(true, row.bids, row.asks, normalizeEpoch(row.timestamp ?? payload.ts), row.version)];
      }
      if (payload?.channel === "push.deal") {
        const rows = Array.isArray(payload.data) ? payload.data : [payload.data];
        return [emitTrades(rows.map((row) => normalizedTrade(row?.id, normalizeEpoch(row?.t), row?.p, row?.v, Number(row?.T) === 2 ? "sell" : "buy", multiplier)))];
      }
      return [];
    });
  }
  if (source.exchange === "bingx") {
    const bookChannel = `${venue}@depth100`;
    const tradeChannel = `${venue}@trade`;
    const subscriptions = [{ id: `inpuls-depth-${Date.now()}`, dataType: bookChannel }];
    if (!depthOnly) subscriptions.push({ id: `inpuls-trade-${Date.now()}`, dataType: tradeChannel });
    return wsDescriptor("wss://open-api-ws.bingx.com/market", subscriptions, (payload) => {
      if (payload?.dataType === bookChannel) {
        const row = payload.data ?? {};
        return [emitBook(true, row.bids, row.asks, row.T ?? payload.ts, row.T)];
      }
      if (payload?.dataType === tradeChannel) {
        const rows = Array.isArray(payload.data) ? payload.data : [payload.data];
        return [emitTrades(rows.map((row) => normalizedTrade(row?.t, normalizeEpoch(row?.T), row?.p, row?.q ?? row?.v, row?.m ? "sell" : "buy", multiplier)))];
      }
      return [];
    }, {
      binaryType: "arraybuffer",
      decode: decodeGzipJsonMessage,
      control(socket, payload) {
        if (payload !== "Ping") return false;
        socket.send("Pong");
        return true;
      },
    });
  }
  if (source.exchange === "htx") {
    const bookTopic = `market.${venue}.depth.step0`;
    const tradeTopic = `market.${venue}.trade.detail`;
    const url = source.market === "spot" ? "wss://api.huobi.pro/ws" : "wss://api.hbdm.com/linear-swap-ws";
    const subscriptions = [{ sub: bookTopic, id: "inpuls-book" }];
    if (!depthOnly) subscriptions.push({ sub: tradeTopic, id: "inpuls-trades" });
    return wsDescriptor(url, subscriptions, (payload) => {
      if (payload?.ch === bookTopic) return [emitBook(true, payload.tick?.bids, payload.tick?.asks, payload.ts, payload.tick?.version)];
      if (payload?.ch === tradeTopic) return [emitTrades((payload.tick?.data ?? []).map((row) => normalizedTrade(
        row.id, normalizeEpoch(row.ts), row.price, row.amount, row.direction, multiplier,
      )))];
      return [];
    }, {
      binaryType: "arraybuffer",
      decode: decodeGzipJsonMessage,
      control(socket, payload) {
        if (!Number.isFinite(Number(payload?.ping))) return false;
        socket.send(JSON.stringify({ pong: payload.ping }));
        return true;
      },
    });
  }
  if (source.exchange === "coinbase") {
    const subscriptions = [
      { type: "subscribe", product_ids: [venue], channel: "level2" },
      { type: "subscribe", channel: "heartbeats" },
    ];
    if (!depthOnly) subscriptions.splice(1, 0, { type: "subscribe", product_ids: [venue], channel: "market_trades" });
    return wsDescriptor("wss://advanced-trade-ws.coinbase.com/", subscriptions, (payload) => {
      if (["level2", "l2_data"].includes(payload?.channel)) return (payload.events ?? []).map((event) => {
        const bids = [];
        const asks = [];
        for (const row of event.updates ?? []) {
          const target = ["bid", "buy"].includes(String(row.side ?? "").toLowerCase()) ? bids : asks;
          target.push([row.price_level, row.new_quantity]);
        }
        return emitBook(event.type === "snapshot", bids, asks, Date.parse(payload.timestamp), null);
      });
      if (payload?.channel === "market_trades") return [emitTrades((payload.events ?? []).flatMap((event) => event.trades ?? []).map((row) => normalizedTrade(
        row.trade_id, Date.parse(row.time), row.price, row.size, row.side, 1,
      )))];
      return [];
    });
  }
  if (source.exchange === "upbit") {
    const channels = [
      { ticket: `inpuls-${Date.now()}` },
      ...(depthOnly ? [] : [{ type: "trade", codes: [venue], is_only_realtime: true }]),
      { type: "orderbook", codes: [venue], is_only_realtime: true },
      { format: "DEFAULT" },
    ];
    return wsDescriptor("wss://api.upbit.com/websocket/v1", [[
      ...channels,
    ]], (payload) => {
      if (payload?.type === "orderbook") {
        const units = payload.orderbook_units ?? [];
        return [emitBook(
          true,
          units.map((row) => [row.bid_price, row.bid_size]),
          units.map((row) => [row.ask_price, row.ask_size]),
          payload.timestamp,
          payload.timestamp,
        )];
      }
      if (payload?.type === "trade") return [emitTrades([normalizedTrade(
        payload.sequential_id, payload.trade_timestamp, payload.trade_price, payload.trade_volume, payload.ask_bid === "ASK" ? "sell" : "buy", 1,
      )])];
      return [];
    }, { binaryType: "arraybuffer" });
  }
  if (source.exchange === "hyperliquid") {
    const subscriptions = [{ method: "subscribe", subscription: { type: "l2Book", coin: venue } }];
    if (!depthOnly) subscriptions.push({ method: "subscribe", subscription: { type: "trades", coin: venue } });
    return wsDescriptor("wss://api.hyperliquid.xyz/ws", subscriptions, (payload) => {
      if (payload?.channel === "l2Book") return [emitBook(true, payload.data?.levels?.[0], payload.data?.levels?.[1], payload.data?.time, payload.data?.time)];
      if (payload?.channel === "trades") return [emitTrades((payload.data ?? []).map((row) => normalizedTrade(row.hash ?? row.tid, row.time, row.px, row.sz, row.side, 1)))];
      return [];
    });
  }
  throw new Error(`Unsupported generic order book exchange: ${source.exchange}`);
}

export function canonicalSymbolFromVenue(exchange, market, venueSymbol) {
  return fromVenueSymbol(exchange, market, venueSymbol);
}

export function canonicalSymbol(value) {
  return normalizeCanonicalSymbol(value);
}

export function venueSymbol(exchange, market, symbol) {
  return toVenueSymbol(exchange, market, symbol);
}
