import {
  canonicalBaseAsset,
  fromVenueSymbol,
  marketSource,
  normalizeCanonicalSymbol,
  toVenueSymbol,
} from "./exchange-registry.js?v=26-124-multi-exchange-v1";

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
  if (payload?.code && !["0", "00000"].includes(String(payload.code)) && !Array.isArray(payload)) throw new Error(payload.msg || `Exchange ${payload.code}`);
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
  return INTERVAL_MS[interval] ? interval : null;
}

function intervalPlan(source, interval) {
  const direct = nativeInterval(source.exchange, interval, source.market);
  if (direct) return { native: direct, aggregate: false };
  if (source.exchange === "bybit" && interval === "3d") return { native: "D", aggregate: true };
  if (source.exchange === "bitget" && source.market === "spot" && interval === "3m") return { native: "1m", aggregate: true };
  if (source.exchange === "bitget" && source.market === "spot" && interval === "2h") return { native: "1H", aggregate: true };
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

function wsDescriptor(url, subscriptions, parse) {
  return {
    url,
    open(socket) {
      for (const payload of subscriptions) socket.send(JSON.stringify(payload));
    },
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

export async function buildCandleStream(sourceValue, interval, options = {}) {
  const source = await resolveMarketMetadata(sourceValue, options);
  const venue = source.venueSymbol;
  const plan = intervalPlan(source, interval);
  const native = plan.native;
  if (!native || plan.aggregate) return buildSyntheticCandleStream(source, interval, options);
  if (source.exchange === "binance") {
    const host = source.market === "spot" ? "stream.binance.com:9443" : "fstream.binance.com";
    return wsDescriptor(`wss://${host}/ws/${venue.toLowerCase()}@kline_${interval}`, [], (payload) => {
      const row = (payload?.data ?? payload)?.k;
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
  return wsDescriptor("wss://api.hyperliquid.xyz/ws", [{
    method: "subscribe",
    subscription: { type: "trades", coin: venue },
  }], (payload) => payload?.channel === "trades"
    ? (payload.data ?? []).map((row) => normalizedTrade(row.hash ?? row.tid, row.time, row.px, row.sz, row.side, 1)).filter(Boolean)
    : []);
}

function rowsWithMultiplier(rows, multiplier = 1) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const price = finite(Array.isArray(row) ? row[0] : row?.px ?? row?.p);
    const quantity = finite(Array.isArray(row) ? row[1] : row?.sz ?? row?.s);
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
  const emitBook = (snapshot, bids, asks, eventTime, sequence = null) => ({
    kind: "book", snapshot, bids: rowsWithMultiplier(bids, multiplier), asks: rowsWithMultiplier(asks, multiplier), eventTime: finite(eventTime) ?? Date.now(), sequence: finite(sequence),
  });
  const emitTrades = (trades) => ({ kind: "trades", trades: trades.filter(Boolean) });
  if (source.exchange === "bybit") {
    const category = source.market === "spot" ? "spot" : "linear";
    return wsDescriptor(`wss://stream.bybit.com/v5/public/${category}`, [{
      op: "subscribe", args: [`orderbook.200.${venue}`, `publicTrade.${venue}`],
    }], (payload) => {
      if (payload?.topic?.startsWith("orderbook.")) return [emitBook(payload.type === "snapshot", payload.data?.b, payload.data?.a, payload.data?.cts ?? payload.ts, payload.data?.u)];
      if (payload?.topic?.startsWith("publicTrade.")) return [emitTrades((payload.data ?? []).map((row) => normalizedTrade(row.i, row.T, row.p, row.v, row.S, multiplier)))];
      return [];
    });
  }
  if (source.exchange === "okx") {
    return wsDescriptor("wss://ws.okx.com:8443/ws/v5/public", [{
      op: "subscribe", args: [{ channel: "books", instId: venue }, { channel: "trades", instId: venue }],
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
      args: [
        { instType, channel: "books", instId: venue },
        { instType, channel: "trade", instId: venue },
      ],
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
    return wsDescriptor(url, [
      { time: Math.floor(Date.now() / 1_000), channel: `${prefix}.order_book_update`, event: "subscribe", payload: depthPayload },
      { time: Math.floor(Date.now() / 1_000), channel: `${prefix}.trades`, event: "subscribe", payload: [venue] },
    ], (payload) => {
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
  if (source.exchange === "hyperliquid") {
    return wsDescriptor("wss://api.hyperliquid.xyz/ws", [
      { method: "subscribe", subscription: { type: "l2Book", coin: venue } },
      { method: "subscribe", subscription: { type: "trades", coin: venue } },
    ], (payload) => {
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
