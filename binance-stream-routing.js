const CHANNEL_BASES = Object.freeze({
  market: Object.freeze({
    combined: "wss://fstream.binance.com/market/stream",
    raw: "wss://fstream.binance.com/market/ws",
  }),
  public: Object.freeze({
    combined: "wss://fstream.binance.com/public/stream",
    raw: "wss://fstream.binance.com/public/ws",
  }),
});

const CHANNEL_ROUTES = Object.freeze({
  core: "market",
  auxiliary: "market",
  market: "market",
  public: "public",
});

const GLOBAL_STREAMS = Object.freeze({
  core: Object.freeze(["!miniTicker@arr"]),
  auxiliary: Object.freeze(["!markPrice@arr@1s", "!forceOrder@arr"]),
  market: Object.freeze(["!miniTicker@arr", "!markPrice@arr@1s", "!forceOrder@arr"]),
  public: Object.freeze(["!bookTicker"]),
});

function normalizeSymbols(symbols) {
  return [...new Set([...(symbols ?? [])]
    .map((symbol) => String(symbol ?? "").trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]{1,20}USDT$/.test(symbol)))];
}

export function buildBinanceChannelStreams(kind, symbols = []) {
  if (!(kind in GLOBAL_STREAMS)) throw new TypeError(`Unknown Binance channel: ${kind}`);
  const streams = [...GLOBAL_STREAMS[kind]];
  if (kind === "auxiliary" || kind === "market") {
    for (const symbol of normalizeSymbols(symbols)) streams.push(`${symbol.toLowerCase()}@aggTrade`);
  }
  return [...new Set(streams)];
}

export function buildBinanceChannelTransports(kind, streams) {
  const route = CHANNEL_ROUTES[kind];
  const bases = CHANNEL_BASES[route];
  if (!bases) throw new TypeError(`Unknown Binance channel: ${kind}`);
  const normalized = [...new Set((streams ?? []).map(String).filter(Boolean))];
  if (!normalized.length) throw new TypeError(`Binance ${kind} channel requires streams`);
  const fallback = normalized.length === 1
    ? { name: `${kind} · raw-path`, url: `${bases.raw}/${normalized[0]}`, subscribeOnOpen: false }
    : { name: `${kind} · subscribe`, url: bases.raw, subscribeOnOpen: true };
  return [
    { name: `${kind} · combined`, url: `${bases.combined}?streams=${normalized.join("/")}`, subscribeOnOpen: false },
    fallback,
  ];
}

export function nextBinanceTransportIndex(current, count, receivedRequiredPacket = false) {
  const total = Math.max(1, Math.floor(Number(count) || 1));
  const index = ((Math.floor(Number(current) || 0) % total) + total) % total;
  return receivedRequiredPacket ? index : (index + 1) % total;
}

export function isBinanceSubscriptionError(payload) {
  return Boolean(payload && typeof payload === "object" && Number.isFinite(Number(payload.code)));
}

export function normalizeBinanceRestMiniTicker(ticker, now = Date.now()) {
  if (!ticker || typeof ticker !== "object") return null;
  const normalized = {
    e: "24hrMiniTicker",
    E: Number(ticker.closeTime) || Number(ticker.E) || Number(now) || Date.now(),
    s: String(ticker.symbol ?? ticker.s ?? "").trim().toUpperCase(),
    c: ticker.lastPrice ?? ticker.c,
    o: ticker.openPrice ?? ticker.o,
    h: ticker.highPrice ?? ticker.h,
    l: ticker.lowPrice ?? ticker.l,
    v: ticker.volume ?? ticker.v,
    q: ticker.quoteVolume ?? ticker.q,
    n: ticker.count ?? ticker.n,
  };
  return isCoreMiniTickerPacket([normalized]) ? normalized : null;
}

export function normalizeBinanceRestMiniTickerRows(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return [];
  return rows.map((ticker) => normalizeBinanceRestMiniTicker(ticker, now)).filter(Boolean);
}

export function isCoreMiniTickerPacket(data) {
  return Array.isArray(data) && data.some((ticker) =>
    ticker?.e === "24hrMiniTicker"
    && typeof ticker?.s === "string"
    && ticker.s.endsWith("USDT")
    && Number.isFinite(Number(ticker.c))
    && Number(ticker.c) > 0,
  );
}

export function isBinanceCoreMiniTickerUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "wss:" || url.hostname !== "fstream.binance.com") return false;
    return decodeURIComponent(`${url.pathname}${url.search}`).includes("!miniTicker@arr");
  } catch {
    return false;
  }
}

// Compatibility helper only. It is intentionally pure: this module must never
// monkey-patch global WebSocket or timer functions during application startup.
export function acceleratedHistoryDelay(callbackName, delay, timerKind) {
  const numericDelay = Math.max(0, Number(delay) || 0);
  if (callbackName !== "warmupRadarHistory") return numericDelay;
  if (timerKind === "timeout" && numericDelay === 1_500) return 1_200;
  if (timerKind === "interval" && numericDelay === 5_000) return 1_500;
  return numericDelay;
}
