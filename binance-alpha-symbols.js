import { normalizeCanonicalSymbol } from "./exchange-registry.js?v=26-125-aster-alpha-v1";

export const BINANCE_ALPHA_TOKEN_LIST_URL = "https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list";
export const BINANCE_ALPHA_EXCHANGE_INFO_URL = "https://www.binance.com/bapi/defi/v1/public/alpha-trade/get-exchange-info";

let sharedIndexPromise = null;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAlphaToken(row) {
  const alphaId = String(row?.alphaId ?? "").trim().toUpperCase();
  const baseAsset = String(row?.symbol ?? "").trim().toUpperCase();
  const symbol = normalizeCanonicalSymbol(`${baseAsset}USDT`, "");
  if (!symbol || !/^ALPHA_\d+$/.test(alphaId) || row?.offline === true || row?.fullyDelisted === true) return null;
  const chainId = String(row?.chainId ?? "").trim();
  const contractAddress = String(row?.contractAddress ?? "").trim().toLowerCase();
  return {
    alphaId,
    baseAsset,
    symbol,
    venueSymbol: `${alphaId}USDT`,
    chainId,
    contractAddress,
    contractKey: contractAddress && chainId ? `${contractAddress}@${chainId}` : null,
    price: finite(row?.price),
    change24h: finite(row?.percentChange24h),
    high24h: finite(row?.priceHigh24h),
    low24h: finite(row?.priceLow24h),
    quoteVolume24h: Math.max(0, finite(row?.volume24h) ?? 0),
    trades24h: Math.max(0, finite(row?.count24h) ?? 0),
    tradeDecimals: Math.max(0, Math.min(18, Number(row?.tradeDecimal) || 8)),
  };
}

function preferredToken(left, right) {
  if (!left) return right;
  if (!right) return left;
  return right.quoteVolume24h > left.quoteVolume24h ? right : left;
}

function buildIndex(rows, activeVenueSymbols = null) {
  const byCanonical = new Map();
  const byAlphaId = new Map();
  const byContract = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const token = normalizeAlphaToken(row);
    if (!token) continue;
    if (activeVenueSymbols?.size && !activeVenueSymbols.has(token.venueSymbol)) continue;
    byCanonical.set(token.symbol, preferredToken(byCanonical.get(token.symbol), token));
    byAlphaId.set(token.alphaId, preferredToken(byAlphaId.get(token.alphaId), token));
    if (token.contractKey) byContract.set(token.contractKey, preferredToken(byContract.get(token.contractKey), token));
  }
  const tokens = [...byCanonical.values()].sort((left, right) => right.quoteVolume24h - left.quoteVolume24h);
  return { tokens, byCanonical, byAlphaId, byContract };
}

async function requestJson(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { cache: "no-store", signal });
  if (!response?.ok) throw new Error(`Binance Alpha token list HTTP ${response?.status ?? 0}`);
  const payload = await response.json();
  if (payload?.success === false || String(payload?.code ?? "000000") !== "000000") {
    throw new Error(payload?.message || "Binance Alpha token list error");
  }
  return payload;
}

async function requestIndex(fetchImpl, signal) {
  const [tokenPayload, exchangeInfo] = await Promise.all([
    requestJson(BINANCE_ALPHA_TOKEN_LIST_URL, fetchImpl, signal),
    requestJson(BINANCE_ALPHA_EXCHANGE_INFO_URL, fetchImpl, signal).catch(() => null),
  ]);
  const activeVenueSymbols = new Set((exchangeInfo?.data?.symbols ?? [])
    .filter((row) => row?.status === "TRADING" && row?.quoteAsset === "USDT")
    .map((row) => String(row.symbol ?? "").trim().toUpperCase()));
  return buildIndex(tokenPayload?.data, activeVenueSymbols);
}

export async function loadBinanceAlphaTokenIndex({
  fetchImpl = globalThis.fetch,
  signal,
  force = false,
} = {}) {
  const defaultFetch = fetchImpl === globalThis.fetch;
  if (defaultFetch && force) {
    sharedIndexPromise = requestIndex(fetchImpl, undefined).catch((error) => {
      sharedIndexPromise = null;
      throw error;
    });
    return sharedIndexPromise;
  }
  const shared = defaultFetch;
  if (!shared) return requestIndex(fetchImpl, signal);
  if (!sharedIndexPromise) {
    // A widget abort must not cancel the shared symbol dictionary used by other widgets.
    sharedIndexPromise = requestIndex(fetchImpl, undefined).catch((error) => {
      sharedIndexPromise = null;
      throw error;
    });
  }
  return sharedIndexPromise;
}

export async function resolveBinanceAlphaToken(symbol, options = {}) {
  const normalized = normalizeCanonicalSymbol(symbol);
  if (!normalized) return null;
  const index = await loadBinanceAlphaTokenIndex(options);
  return index.byCanonical.get(normalized) ?? null;
}

export function resetBinanceAlphaTokenCache() {
  sharedIndexPromise = null;
}
