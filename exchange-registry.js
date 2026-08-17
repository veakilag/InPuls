export const EXCHANGE_IDS = Object.freeze([
  "binance",
  "bybit",
  "okx",
  "bitget",
  "gate",
  "hyperliquid",
]);

export const MARKET_TYPES = Object.freeze(["futures", "spot"]);

export const EXCHANGES = Object.freeze({
  binance: Object.freeze({ id: "binance", label: "BINANCE", markets: MARKET_TYPES }),
  bybit: Object.freeze({ id: "bybit", label: "BYBIT", markets: MARKET_TYPES }),
  okx: Object.freeze({ id: "okx", label: "OKX", markets: MARKET_TYPES }),
  bitget: Object.freeze({ id: "bitget", label: "BITGET", markets: MARKET_TYPES }),
  gate: Object.freeze({ id: "gate", label: "GATE", markets: MARKET_TYPES }),
  hyperliquid: Object.freeze({ id: "hyperliquid", label: "HYPER", markets: MARKET_TYPES }),
});

export function normalizeExchange(value, fallback = "binance") {
  const exchange = String(value ?? "").trim().toLowerCase();
  return EXCHANGE_IDS.includes(exchange) ? exchange : fallback;
}

export function normalizeMarket(value, fallback = "futures") {
  const market = String(value ?? "").trim().toLowerCase();
  if (market === "perp" || market === "swap" || market === "linear") return "futures";
  return MARKET_TYPES.includes(market) ? market : fallback;
}

export function normalizeCanonicalSymbol(value, fallbackQuote = "USDT") {
  if (typeof value !== "string") return null;
  let symbol = value.trim().toUpperCase();
  if (!symbol) return null;
  symbol = symbol
    .replace(/-SWAP$/, "")
    .replace(/[\/_-]/g, "");
  if (/^[A-Z0-9]{1,20}$/.test(symbol) && !symbol.endsWith("USDT") && fallbackQuote) {
    symbol += fallbackQuote;
  }
  return /^[A-Z0-9]{1,20}USDT$/.test(symbol) ? symbol : null;
}

export function canonicalBaseAsset(symbol) {
  const normalized = normalizeCanonicalSymbol(symbol);
  return normalized ? normalized.slice(0, -4) : null;
}

export function toVenueSymbol(exchangeValue, marketValue, symbolValue) {
  const exchange = normalizeExchange(exchangeValue);
  const market = normalizeMarket(marketValue);
  const symbol = normalizeCanonicalSymbol(symbolValue);
  if (!symbol) return null;
  const base = canonicalBaseAsset(symbol);
  if (exchange === "okx") return market === "spot" ? `${base}-USDT` : `${base}-USDT-SWAP`;
  if (exchange === "gate") return `${base}_USDT`;
  if (exchange === "hyperliquid") return market === "spot" ? `${base}/USDC` : base;
  return symbol;
}

export function fromVenueSymbol(exchangeValue, marketValue, value) {
  const exchange = normalizeExchange(exchangeValue);
  const market = normalizeMarket(marketValue);
  if (typeof value !== "string") return null;
  const raw = value.trim().toUpperCase();
  if (!raw) return null;
  if (exchange === "hyperliquid") {
    const base = raw.split("/")[0].replace(/^@/, "");
    return /^[A-Z0-9]{1,16}$/.test(base) ? `${base}USDT` : null;
  }
  return normalizeCanonicalSymbol(raw, market === "spot" ? "USDT" : "USDT");
}

export function marketSource(value = {}) {
  const exchange = normalizeExchange(value.exchange);
  const market = normalizeMarket(value.market);
  const symbol = normalizeCanonicalSymbol(value.symbol);
  return Object.freeze({
    exchange,
    market,
    symbol,
    venueSymbol: symbol ? toVenueSymbol(exchange, market, symbol) : null,
  });
}

export function marketSourceKey(value = {}) {
  const source = marketSource(value);
  return `${source.exchange}:${source.market}:${source.symbol ?? ""}`;
}

export function marketSourceLabel(value = {}) {
  const source = marketSource(value);
  const exchange = EXCHANGES[source.exchange]?.label ?? source.exchange.toUpperCase();
  return `${exchange} · ${source.market === "spot" ? "SPOT" : "FUTURES"}`;
}

export function nextExchange(value, direction = 1) {
  const exchange = normalizeExchange(value);
  const index = EXCHANGE_IDS.indexOf(exchange);
  const step = Number(direction) < 0 ? -1 : 1;
  return EXCHANGE_IDS[(index + step + EXCHANGE_IDS.length) % EXCHANGE_IDS.length];
}

export function exchangeSupportsMarket(exchangeValue, marketValue) {
  const exchange = normalizeExchange(exchangeValue);
  const market = normalizeMarket(marketValue);
  return EXCHANGES[exchange]?.markets.includes(market) ?? false;
}
