const USDT_PERPETUAL_SYMBOL_PATTERN = /^[A-Z0-9]{1,20}USDT$/;

function normalizeSymbol(value) {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return USDT_PERPETUAL_SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export function parseInPulsNavigation(search = "") {
  const parameters = new URLSearchParams(String(search).replace(/^\?/, ""));
  const symbol = normalizeSymbol(parameters.get("symbol"));
  const open = parameters.get("open") === "orderbook" ? "orderbook" : null;
  const source = parameters.get("source") === "signal-lab" ? "signal-lab" : null;
  return Object.freeze({ symbol, open, source });
}

export function buildInPulsNavigationUrl(baseHref, {
  symbol,
  open = "orderbook",
  source = "signal-lab",
} = {}) {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return null;
  const url = new URL("./", baseHref);
  url.searchParams.set("symbol", normalizedSymbol);
  if (open === "orderbook") url.searchParams.set("open", "orderbook");
  if (source === "signal-lab") url.searchParams.set("source", "signal-lab");
  return url.href;
}
