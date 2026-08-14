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
  auxiliary: Object.freeze([
    "!markPrice@arr@1s",
    "!forceOrder@arr",
  ]),
  market: Object.freeze([
    "!miniTicker@arr",
    "!markPrice@arr@1s",
    "!forceOrder@arr",
  ]),
  public: Object.freeze(["!bookTicker"]),
});

const FAST_MARKET_BOOTSTRAP_HOSTS = Object.freeze([
  "fapi.binance.com",
  "fapi1.binance.com",
  "fapi2.binance.com",
]);
const FAST_MARKET_BOOTSTRAP_TIMEOUT_MS = 3_000;
const FAST_HISTORY_TIMEOUT_MS = 1_200;
const FAST_HISTORY_INTERVAL_MS = 1_500;

const nativeSetTimeout = typeof globalThis.setTimeout === "function"
  ? globalThis.setTimeout.bind(globalThis)
  : null;
const nativeSetInterval = typeof globalThis.setInterval === "function"
  ? globalThis.setInterval.bind(globalThis)
  : null;

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
    ? {
        name: `${kind} · raw-path`,
        url: `${bases.raw}/${normalized[0]}`,
        subscribeOnOpen: false,
      }
    : {
        name: `${kind} · subscribe`,
        url: bases.raw,
        subscribeOnOpen: true,
      };
  return [
    {
      name: `${kind} · combined`,
      url: `${bases.combined}?streams=${normalized.join("/")}`,
      subscribeOnOpen: false,
    },
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
    // REST exposes this as `count`; full WebSocket ticker uses `n`.
    // miniTicker has neither, so preserve the REST value on SymbolState.
    n: ticker.count ?? ticker.n,
  };
  return isCoreMiniTickerPacket([normalized]) ? normalized : null;
}

export function normalizeBinanceRestMiniTickerRows(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((ticker) => normalizeBinanceRestMiniTicker(ticker, now))
    .filter(Boolean);
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

export function acceleratedHistoryDelay(callbackName, delay, timerKind) {
  const numericDelay = Math.max(0, Number(delay) || 0);
  if (callbackName !== "warmupRadarHistory") return numericDelay;
  if (timerKind === "timeout" && numericDelay === 1_500) return FAST_HISTORY_TIMEOUT_MS;
  if (timerKind === "interval" && numericDelay === 5_000) return FAST_HISTORY_INTERVAL_MS;
  return numericDelay;
}

function extractCoreMiniTickerSymbols(eventData) {
  try {
    const payload = JSON.parse(eventData);
    const rows = payload?.data ?? payload;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((ticker) => ticker?.e === "24hrMiniTicker")
      .map((ticker) => String(ticker.s ?? "").trim().toUpperCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = FAST_MARKET_BOOTSTRAP_TIMEOUT_MS) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = nativeSetTimeout?.(() => controller?.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload) || !payload.length) throw new Error("Empty market snapshot");
    return payload;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function loadFastMarketBootstrapSnapshot() {
  let lastError = null;
  for (const host of FAST_MARKET_BOOTSTRAP_HOSTS) {
    try {
      const rows = await fetchJsonWithTimeout(`https://${host}/fapi/v1/ticker/24hr`);
      return normalizeBinanceRestMiniTickerRows(rows, Date.now());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Market bootstrap unavailable");
}

function installFastMarketBootstrap() {
  if (
    typeof window === "undefined"
    || typeof globalThis.WebSocket !== "function"
    || typeof globalThis.fetch !== "function"
    || typeof globalThis.MessageEvent !== "function"
  ) return;

  const NativeWebSocket = globalThis.WebSocket;
  const snapshotPromise = loadFastMarketBootstrapSnapshot().catch(() => []);

  class InPulsFastStartWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      if (protocols === undefined) super(url);
      else super(url, protocols);
      if (!isBinanceCoreMiniTickerUrl(url)) return;

      const seenSymbols = new Set();
      let opened = this.readyState === NativeWebSocket.OPEN;
      let injected = false;
      let dispatchingBootstrap = false;

      this.addEventListener("message", (event) => {
        if (dispatchingBootstrap) return;
        for (const symbol of extractCoreMiniTickerSymbols(event.data)) seenSymbols.add(symbol);
      });

      const injectMarketSnapshot = (snapshot) => {
        if (!opened || injected || !Array.isArray(snapshot) || !snapshot.length) return;
        injected = true;
        // Send missing symbols and the enriched REST rows carrying fields absent
        // from miniTicker (notably the 24h trade count).
        const enriched = snapshot.filter((ticker) => !seenSymbols.has(ticker.s) || Number.isFinite(Number(ticker.n)));
        if (!enriched.length) return;
        dispatchingBootstrap = true;
        try {
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify(enriched),
          }));
        } finally {
          dispatchingBootstrap = false;
        }
      };

      this.addEventListener("open", () => {
        opened = true;
        snapshotPromise.then(injectMarketSnapshot);
      }, { once: true });

      if (opened) snapshotPromise.then(injectMarketSnapshot);
    }
  }

  Object.defineProperty(InPulsFastStartWebSocket, "name", {
    value: "WebSocket",
    configurable: true,
  });
  globalThis.WebSocket = InPulsFastStartWebSocket;
}

function installFastHistoryWarmupTimers() {
  if (typeof window === "undefined" || !nativeSetTimeout || !nativeSetInterval) return;
  const originalSetTimeout = globalThis.setTimeout;
  const originalSetInterval = globalThis.setInterval;
  let timeoutAccelerated = false;
  let intervalAccelerated = false;
  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.setInterval = originalSetInterval;
  };
  const restoreWhenReady = () => {
    if (timeoutAccelerated && intervalAccelerated) restore();
  };

  globalThis.setTimeout = function inpulsFastStartTimeout(callback, delay, ...args) {
    const nextDelay = acceleratedHistoryDelay(callback?.name, delay, "timeout");
    if (nextDelay !== Number(delay)) timeoutAccelerated = true;
    const handle = nativeSetTimeout(callback, nextDelay, ...args);
    restoreWhenReady();
    return handle;
  };

  globalThis.setInterval = function inpulsFastStartInterval(callback, delay, ...args) {
    const nextDelay = acceleratedHistoryDelay(callback?.name, delay, "interval");
    if (nextDelay !== Number(delay)) intervalAccelerated = true;
    const handle = nativeSetInterval(callback, nextDelay, ...args);
    restoreWhenReady();
    return handle;
  };

  nativeSetTimeout(restore, 30_000);
}

installFastMarketBootstrap();
installFastHistoryWarmupTimers();
