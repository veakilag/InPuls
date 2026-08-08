const normalizeSymbol = (value) => String(value ?? "").trim().toUpperCase();

export function binanceFuturesMarketForSymbol(payload, symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;
  const markets = Array.isArray(payload?.symbols) ? payload.symbols : [];
  return markets.find((market) => normalizeSymbol(market?.symbol) === normalized) ?? null;
}

export function binanceFuturesTickSize(payload, symbol) {
  const market = binanceFuturesMarketForSymbol(payload, symbol);
  const priceFilter = (Array.isArray(market?.filters) ? market.filters : [])
    .find((filter) => filter?.filterType === "PRICE_FILTER");
  const tickSize = Number(priceFilter?.tickSize);
  if (!(tickSize > 0)) {
    throw new Error(`Binance не вернул PRICE_FILTER для ${normalizeSymbol(symbol) || "UNKNOWN"}`);
  }
  return tickSize;
}

export function createSymbolScopedExchangeInfoFetch(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");

  return async function symbolScopedExchangeInfoFetch(input, init) {
    const response = await fetchImpl(input, init);
    if (!response?.ok) return response;

    const rawUrl = typeof input === "string" || input instanceof URL
      ? String(input)
      : input?.url;
    if (!rawUrl) return response;

    let url;
    try {
      url = new URL(rawUrl, globalThis.location?.href ?? "https://localhost/");
    } catch {
      return response;
    }

    if (!url.pathname.endsWith("/fapi/v1/exchangeInfo")) return response;
    const requestedSymbol = normalizeSymbol(url.searchParams.get("symbol"));
    if (!requestedSymbol) return response;

    let payload;
    try {
      payload = await response.clone().json();
    } catch {
      return response;
    }

    const market = binanceFuturesMarketForSymbol(payload, requestedSymbol);
    if (!market) {
      throw new Error(`Binance exchangeInfo не содержит ${requestedSymbol}`);
    }

    const headers = new Headers(response.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.delete("content-length");
    return new Response(JSON.stringify({ ...payload, symbols: [market] }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

export function installSymbolScopedExchangeInfoFetch() {
  if (globalThis.__INPULS_SYMBOL_SCOPED_EXCHANGE_INFO__) return;
  const originalFetch = globalThis.fetch?.bind(globalThis);
  if (typeof originalFetch !== "function") throw new Error("Fetch API недоступен");
  globalThis.fetch = createSymbolScopedExchangeInfoFetch(originalFetch);
  globalThis.__INPULS_SYMBOL_SCOPED_EXCHANGE_INFO__ = true;
}
