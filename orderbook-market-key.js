export function normalizeOrderBookMarketKey(value, fallbackMarket = "futures") {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const separator = raw.indexOf(":");
  const marketValue = separator >= 0 ? raw.slice(0, separator) : fallbackMarket;
  const symbolValue = separator >= 0 ? raw.slice(separator + 1) : raw;
  const market = String(marketValue).trim().toLowerCase() === "spot" ? "spot" : "futures";
  const symbol = String(symbolValue).replace(/\//g, "").trim().toUpperCase();

  return symbol.endsWith("USDT") ? `${market}:${symbol}` : null;
}
