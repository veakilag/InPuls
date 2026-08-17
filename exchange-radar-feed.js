import {
  fromVenueSymbol,
  marketSource,
  normalizeCanonicalSymbol,
} from "./exchange-registry.js?v=26-124-multi-exchange-v1";

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { cache: "no-store", ...options });
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 0}`);
  const payload = await response.json();
  if (payload?.retCode && Number(payload.retCode) !== 0) throw new Error(payload.retMsg || "Bybit error");
  if (payload?.code && !["0", "00000"].includes(String(payload.code))) throw new Error(payload.msg || "Exchange error");
  return payload;
}

function ticker({ symbol, price, open, high, low, quoteVolume, trades = null, funding = null, nextFundingTime = null }, now) {
  const normalized = normalizeCanonicalSymbol(symbol, "");
  const lastPrice = finite(price);
  if (!normalized || !Number.isFinite(lastPrice) || lastPrice <= 0) return null;
  return {
    e: "24hrMiniTicker",
    E: Number(now) || Date.now(),
    s: normalized,
    c: lastPrice,
    o: finite(open),
    h: finite(high),
    l: finite(low),
    q: Math.max(0, finite(quoteVolume) ?? 0),
    n: finite(trades),
    r: finite(funding),
    T: finite(nextFundingTime),
  };
}

function openFromChange(price, changePercent) {
  const last = finite(price);
  const change = finite(changePercent);
  if (!Number.isFinite(last) || !Number.isFinite(change) || change <= -100) return null;
  return last / (1 + change / 100);
}

function hyperSpotSymbol(meta, pair) {
  const tokens = Array.isArray(meta?.tokens) ? meta.tokens : [];
  const [baseIndex, quoteIndex] = pair?.tokens ?? [];
  let base = String(tokens[baseIndex]?.name ?? "").toUpperCase();
  const quote = String(tokens[quoteIndex]?.name ?? "").toUpperCase();
  if (base === "UBTC") base = "BTC";
  if (!base || !["USDC", "USDT"].includes(quote)) return null;
  return `${base}USDT`;
}

export async function fetchExchangeTickers(sourceValue, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const source = marketSource(sourceValue);
  const now = Date.now();
  if (source.exchange === "binance") {
    const url = source.market === "spot"
      ? "https://api.binance.com/api/v3/ticker/24hr"
      : "https://fapi.binance.com/fapi/v1/ticker/24hr";
    const rows = await fetchJson(url, { signal }, fetchImpl);
    return rows.map((row) => ticker({
      symbol: row.symbol,
      price: row.lastPrice,
      open: row.openPrice,
      high: row.highPrice,
      low: row.lowPrice,
      quoteVolume: row.quoteVolume,
      trades: row.count,
    }, row.closeTime ?? now)).filter(Boolean);
  }
  if (source.exchange === "bybit") {
    const category = source.market === "spot" ? "spot" : "linear";
    const payload = await fetchJson(`https://api.bybit.com/v5/market/tickers?category=${category}`, { signal }, fetchImpl);
    return (payload?.result?.list ?? []).map((row) => ticker({
      symbol: row.symbol,
      price: row.lastPrice,
      open: row.prevPrice24h,
      high: row.highPrice24h,
      low: row.lowPrice24h,
      quoteVolume: row.turnover24h,
      funding: row.fundingRate,
      nextFundingTime: row.nextFundingTime,
    }, now)).filter(Boolean);
  }
  if (source.exchange === "okx") {
    const instType = source.market === "spot" ? "SPOT" : "SWAP";
    const payload = await fetchJson(`https://www.okx.com/api/v5/market/tickers?instType=${instType}`, { signal }, fetchImpl);
    return (payload?.data ?? []).map((row) => {
      const symbol = fromVenueSymbol("okx", source.market, row.instId);
      const price = finite(row.last);
      const baseVolume = finite(row.volCcy24h);
      return ticker({
        symbol,
        price,
        open: row.open24h,
        high: row.high24h,
        low: row.low24h,
        quoteVolume: source.market === "spot" ? row.volCcy24h : (Number.isFinite(price) && Number.isFinite(baseVolume) ? price * baseVolume : null),
      }, row.ts ?? now);
    }).filter(Boolean);
  }
  if (source.exchange === "bitget") {
    const url = source.market === "spot"
      ? "https://api.bitget.com/api/v2/spot/market/tickers"
      : "https://api.bitget.com/api/v2/mix/market/tickers?productType=usdt-futures";
    const payload = await fetchJson(url, { signal }, fetchImpl);
    return (payload?.data ?? []).map((row) => ticker({
      symbol: row.symbol,
      price: row.lastPr ?? row.close,
      open: row.openUtc ?? row.open24h,
      high: row.high24h,
      low: row.low24h,
      quoteVolume: row.quoteVolume ?? row.usdtVolume,
      funding: row.fundingRate,
    }, row.ts ?? now)).filter(Boolean);
  }
  if (source.exchange === "gate") {
    const path = source.market === "spot" ? "spot/tickers" : "futures/usdt/tickers";
    const rows = await fetchJson(`https://api.gateio.ws/api/v4/${path}`, { signal }, fetchImpl);
    return rows.map((row) => {
      const price = row.last;
      return ticker({
        symbol: row.currency_pair ?? row.contract,
        price,
        open: openFromChange(price, row.change_percentage),
        high: row.high_24h,
        low: row.low_24h,
        quoteVolume: row.quote_volume ?? row.volume_24h_usd,
        funding: row.funding_rate,
      }, now);
    }).filter(Boolean);
  }
  const type = source.market === "spot" ? "spotMetaAndAssetCtxs" : "metaAndAssetCtxs";
  const payload = await fetchJson("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type }),
    signal,
  }, fetchImpl);
  const [meta, contexts] = Array.isArray(payload) ? payload : [];
  return (meta?.universe ?? []).map((row, index) => {
    const context = contexts?.[index] ?? {};
    const symbol = source.market === "spot"
      ? hyperSpotSymbol(meta, row)
      : `${String(row?.name ?? "").toUpperCase()}USDT`;
    const price = context.midPx ?? context.markPx ?? context.oraclePx;
    return ticker({
      symbol,
      price,
      open: context.prevDayPx,
      high: null,
      low: null,
      quoteVolume: context.dayNtlVlm,
      funding: context.funding,
    }, now);
  }).filter(Boolean);
}

export class ExchangeRadarFeed {
  constructor({
    exchange,
    market,
    onSnapshot = () => {},
    onStatus = () => {},
    fetchImpl = globalThis.fetch,
    intervalMs = 10_000,
  } = {}) {
    this.source = marketSource({ exchange, market });
    this.onSnapshot = onSnapshot;
    this.onStatus = onStatus;
    this.fetchImpl = fetchImpl;
    this.intervalMs = Math.max(5_000, Number(intervalMs) || 10_000);
    this.abortController = null;
    this.timer = null;
    this.generation = 0;
    this.running = false;
  }

  select(sourceValue) {
    this.source = marketSource(sourceValue);
    this.generation += 1;
    this.#cancel();
    this.running = true;
    this.#poll(this.generation);
  }

  async #poll(generation) {
    this.abortController = new AbortController();
    this.onStatus({ state: "loading", text: `${this.source.exchange.toUpperCase()} · загрузка рынка` });
    try {
      const rows = await fetchExchangeTickers(this.source, {
        fetchImpl: this.fetchImpl,
        signal: this.abortController.signal,
      });
      if (!this.running || generation !== this.generation) return;
      this.onSnapshot(rows, this.source);
      this.onStatus({ state: "online", text: `${this.source.exchange.toUpperCase()} · ${rows.length} рынков` });
    } catch (error) {
      if (!this.running || generation !== this.generation || error?.name === "AbortError") return;
      this.onStatus({ state: "warning", text: `${this.source.exchange.toUpperCase()} · повторное подключение` });
    }
    if (this.running && generation === this.generation) {
      this.timer = setTimeout(() => this.#poll(generation), this.intervalMs);
    }
  }

  #cancel() {
    clearTimeout(this.timer);
    this.timer = null;
    this.abortController?.abort();
    this.abortController = null;
  }

  destroy() {
    this.running = false;
    this.generation += 1;
    this.#cancel();
  }
}
