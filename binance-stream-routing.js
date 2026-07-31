const CHANNEL_BASES = Object.freeze({
  market: "wss://fstream.binance.com/market/stream",
  public: "wss://fstream.binance.com/public/stream",
});

const GLOBAL_STREAMS = Object.freeze({
  market: Object.freeze([
    "!miniTicker@arr",
    "!markPrice@arr@1s",
    "!forceOrder@arr",
  ]),
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
  if (kind === "market") {
    for (const symbol of normalizeSymbols(symbols)) {
      streams.push(`${symbol.toLowerCase()}@aggTrade`);
    }
  }
  return [...new Set(streams)];
}

export function buildBinanceChannelTransports(kind, streams) {
  const base = CHANNEL_BASES[kind];
  if (!base) throw new TypeError(`Unknown Binance channel: ${kind}`);
  const normalized = [...new Set((streams ?? []).map(String).filter(Boolean))];
  if (!normalized.length) throw new TypeError(`Binance ${kind} channel requires streams`);
  return [
    {
      name: `${kind} · combined`,
      url: `${base}?streams=${normalized.join("/")}`,
      subscribeOnOpen: false,
    },
    {
      name: `${kind} · subscribe`,
      url: base,
      subscribeOnOpen: true,
    },
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

export function isCoreMiniTickerPacket(data) {
  return Array.isArray(data) && data.some((ticker) =>
    ticker?.e === "24hrMiniTicker"
    && typeof ticker?.s === "string"
    && ticker.s.endsWith("USDT")
    && Number.isFinite(Number(ticker.c))
    && Number(ticker.c) > 0,
  );
}
