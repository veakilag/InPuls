const KNOWN_EXCHANGES = new Set(["binance", "bybit", "okx", "bitget", "gate", "hyperliquid"]);

export function normalizeOrderBookMarketKey(value, fallbackMarket = "futures") {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const parts = raw.split(":");
  const carriesExchange = parts.length >= 3 && KNOWN_EXCHANGES.has(String(parts[0]).toLowerCase());
  const exchange = carriesExchange ? String(parts.shift()).toLowerCase() : "binance";
  const marketValue = parts.length >= 2 ? parts.shift() : fallbackMarket;
  const symbolValue = parts.join(":") || raw;
  const market = String(marketValue).trim().toLowerCase() === "spot" ? "spot" : "futures";
  const symbol = String(symbolValue).replace(/\//g, "").trim().toUpperCase();

  if (!symbol.endsWith("USDT")) return null;
  return exchange === "binance" ? `${market}:${symbol}` : `${exchange}:${market}:${symbol}`;
}
