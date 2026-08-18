import {
  fromVenueSymbol,
  marketSource,
  normalizeCanonicalSymbol,
} from "./exchange-registry.js?v=26-126-final-exchanges-v1";
import { loadBinanceAlphaTokenIndex } from "./binance-alpha-symbols.js?v=26-126-final-exchanges-v1";

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchJson(url, options = {}, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { cache: "no-store", ...options });
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 0}`);
  const payload = await response.json();
  if (payload?.retCode && Number(payload.retCode) !== 0) throw new Error(payload.retMsg || "Bybit error");
  if (payload?.success === false) throw new Error(payload.message || payload.messageDetail || "Exchange error");
  if (payload?.status === "error") throw new Error(payload["err-msg"] || payload.message || "Exchange error");
  if (payload?.code && !["0", "00000", "000000", "200000"].includes(String(payload.code))) throw new Error(payload.msg || payload.message || "Exchange error");
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

function asterTicker(row, funding = null, nextFundingTime = null) {
  return ticker({
    symbol: row?.symbol ?? row?.s,
    price: row?.lastPrice ?? row?.c,
    open: row?.openPrice ?? row?.o,
    high: row?.highPrice ?? row?.h,
    low: row?.lowPrice ?? row?.l,
    quoteVolume: row?.quoteVolume ?? row?.q,
    trades: row?.count ?? row?.n,
    funding,
    nextFundingTime,
  }, row?.closeTime ?? row?.C ?? row?.E ?? Date.now());
}

function alphaTokenTicker(token, patch = null) {
  const price = finite(patch?.p) ?? token?.price;
  const change = finite(patch?.pc24) ?? token?.change24h;
  return ticker({
    symbol: token?.symbol,
    price,
    open: openFromChange(price, change),
    high: token?.high24h,
    low: token?.low24h,
    quoteVolume: finite(patch?.vol24) ?? token?.quoteVolume24h,
    trades: finite(patch?.cnt24) ?? token?.trades24h,
  }, patch?.t ?? Date.now());
}

export async function fetchExchangeTickers(sourceValue, {
  fetchImpl = globalThis.fetch,
  signal,
  refresh = false,
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
  if (source.exchange === "aster") {
    const tickerUrl = source.market === "spot"
      ? "https://sapi.asterdex.com/api/v3/ticker/24hr"
      : "https://fapi.asterdex.com/fapi/v3/ticker/24hr";
    if (source.market === "spot") {
      const rows = await fetchJson(tickerUrl, { signal }, fetchImpl);
      return rows.map((row) => asterTicker(row)).filter(Boolean);
    }
    const [rows, premiumRows] = await Promise.all([
      fetchJson(tickerUrl, { signal }, fetchImpl),
      fetchJson("https://fapi.asterdex.com/fapi/v3/premiumIndex", { signal }, fetchImpl).catch(() => []),
    ]);
    const premiumBySymbol = new Map((Array.isArray(premiumRows) ? premiumRows : [premiumRows])
      .map((row) => [String(row?.symbol ?? "").toUpperCase(), row]));
    return rows.map((row) => {
      const premium = premiumBySymbol.get(String(row?.symbol ?? "").toUpperCase());
      return asterTicker(row, premium?.lastFundingRate, premium?.nextFundingTime);
    }).filter(Boolean);
  }
  if (source.exchange === "binance_alpha") {
    const index = await loadBinanceAlphaTokenIndex({ fetchImpl, signal, force: refresh });
    return index.tokens.map((token) => alphaTokenTicker(token)).filter(Boolean);
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
  if (source.exchange === "kucoin") {
    if (source.market === "spot") {
      const payload = await fetchJson("https://api.kucoin.com/api/v1/market/allTickers", { signal }, fetchImpl);
      return (payload?.data?.ticker ?? []).map((row) => ticker({
        symbol: fromVenueSymbol("kucoin", "spot", row.symbol),
        price: row.last,
        open: openFromChange(row.last, Number(row.changeRate) * 100),
        high: row.high,
        low: row.low,
        quoteVolume: row.volValue,
      }, payload?.data?.time ?? now)).filter(Boolean);
    }
    const payload = await fetchJson("https://api-futures.kucoin.com/api/v1/contracts/active", { signal }, fetchImpl);
    return (payload?.data ?? []).map((row) => ticker({
      symbol: fromVenueSymbol("kucoin", "futures", row.symbol),
      price: row.lastTradePrice ?? row.markPrice,
      open: openFromChange(row.lastTradePrice ?? row.markPrice, Number(row.priceChgPct) * 100),
      high: row.highPrice,
      low: row.lowPrice,
      quoteVolume: row.turnoverOf24h,
      funding: row.fundingFeeRate,
      nextFundingTime: row.nextFundingRateTime,
    }, now)).filter(Boolean);
  }
  if (source.exchange === "mexc") {
    const url = source.market === "spot"
      ? "https://api.mexc.com/api/v3/ticker/24hr"
      : "https://contract.mexc.com/api/v1/contract/ticker";
    const payload = await fetchJson(url, { signal }, fetchImpl);
    const rows = source.market === "spot" ? payload : payload?.data ?? [];
    return rows.map((row) => ticker({
      symbol: fromVenueSymbol("mexc", source.market, row.symbol),
      price: row.lastPrice,
      open: row.openPrice ?? openFromChange(row.lastPrice, Number(row.riseFallRate) * 100),
      high: row.highPrice ?? row.high24Price,
      low: row.lowPrice ?? row.lower24Price,
      quoteVolume: row.quoteVolume ?? row.amount24,
      trades: row.count,
      funding: row.fundingRate,
    }, row.closeTime ?? row.timestamp ?? now)).filter(Boolean);
  }
  if (source.exchange === "bingx") {
    const url = source.market === "spot"
      ? "https://open-api.bingx.com/openApi/spot/v1/ticker/24hr"
      : "https://open-api.bingx.com/openApi/swap/v2/quote/ticker";
    const payload = await fetchJson(url, { signal }, fetchImpl);
    const rows = Array.isArray(payload?.data) ? payload.data : [payload?.data];
    return rows.map((row) => ticker({
      symbol: fromVenueSymbol("bingx", source.market, row?.symbol),
      price: row?.lastPrice,
      open: row?.openPrice ?? openFromChange(row?.lastPrice, row?.priceChangePercent),
      high: row?.highPrice,
      low: row?.lowPrice,
      quoteVolume: row?.quoteVolume,
      trades: row?.count,
      funding: row?.fundingRate,
      nextFundingTime: row?.nextFundingTime,
    }, row?.time ?? now)).filter(Boolean);
  }
  if (source.exchange === "htx") {
    const url = source.market === "spot"
      ? "https://api.huobi.pro/market/tickers"
      : "https://api.hbdm.com/linear-swap-ex/market/detail/batch_merged";
    const payload = await fetchJson(url, { signal }, fetchImpl);
    return (payload?.data ?? payload?.ticks ?? []).map((row) => ticker({
      symbol: fromVenueSymbol("htx", source.market, row.symbol ?? row.contract_code),
      price: row.close,
      open: row.open,
      high: row.high,
      low: row.low,
      quoteVolume: row.trade_turnover ?? row.vol,
      trades: row.count,
      funding: row.funding_rate,
    }, row.ts ?? payload.ts ?? now)).filter(Boolean);
  }
  if (source.exchange === "coinbase") {
    const products = [];
    let cursor = "";
    for (let page = 0; page < 8; page += 1) {
      const query = new URLSearchParams({ product_type: "SPOT", limit: "250" });
      if (cursor) query.set("cursor", cursor);
      const payload = await fetchJson(`https://api.coinbase.com/api/v3/brokerage/market/products?${query}`, { signal }, fetchImpl);
      products.push(...(payload?.products ?? []));
      if (!payload?.pagination?.has_next || !payload.pagination.next_cursor) break;
      cursor = payload.pagination.next_cursor;
    }
    return products.filter((row) => row.quote_currency_id === "USDT" && row.product_type === "SPOT").map((row) => ticker({
      symbol: fromVenueSymbol("coinbase", "spot", row.product_id),
      price: row.price,
      open: openFromChange(row.price, row.price_percentage_change_24h),
      high: row.price_24h_high,
      low: row.price_24h_low,
      quoteVolume: Number(row.volume_24h) * Number(row.price),
    }, now)).filter(Boolean);
  }
  if (source.exchange === "upbit") {
    const rows = await fetchJson("https://api.upbit.com/v1/ticker/all?quote_currencies=USDT", { signal }, fetchImpl);
    return rows.map((row) => ticker({
      symbol: fromVenueSymbol("upbit", "spot", row.market),
      price: row.trade_price,
      open: row.opening_price,
      high: row.high_price,
      low: row.low_price,
      quoteVolume: row.acc_trade_price_24h,
    }, row.timestamp ?? now)).filter(Boolean);
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

async function buildLiveTickerStream(source, { fetchImpl, signal }) {
  if (source.exchange === "aster") {
    const host = source.market === "spot" ? "sstream.asterdex.com" : "fstream.asterdex.com";
    return {
      url: `wss://${host}/ws/!ticker@arr`,
      open() {},
      parse(payload) {
        return (Array.isArray(payload) ? payload : []).map((row) => asterTicker(row)).filter(Boolean);
      },
    };
  }
  if (source.exchange === "binance_alpha") {
    const index = await loadBinanceAlphaTokenIndex({ fetchImpl, signal });
    return {
      url: "wss://nbstream.binance.com/w3w/wsa/stream",
      open(socket) {
        socket.send(JSON.stringify({ method: "SUBSCRIBE", params: ["came@allTokens@ticker24"], id: 1 }));
      },
      parse(payload) {
        return (payload?.data?.d ?? []).map((row) => {
          const alphaId = String(row?.aid ?? "").trim().toUpperCase();
          const token = index.byAlphaId.get(alphaId)
            ?? index.byContract.get(String(row?.ca ?? "").trim().toLowerCase());
          return token ? alphaTokenTicker(token, row) : null;
        }).filter(Boolean);
      },
    };
  }
  return null;
}

function mergeTicker(previous, next) {
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    o: finite(next.o) ?? previous.o,
    h: finite(next.h) ?? previous.h,
    l: finite(next.l) ?? previous.l,
    q: finite(next.q) ?? previous.q,
    n: finite(next.n) ?? previous.n,
    r: finite(next.r) ?? previous.r,
    T: finite(next.T) ?? previous.T,
  };
}

export class ExchangeRadarFeed {
  constructor({
    exchange,
    market,
    onSnapshot = () => {},
    onStatus = () => {},
    fetchImpl = globalThis.fetch,
    WebSocketImpl = globalThis.WebSocket,
    intervalMs = 10_000,
  } = {}) {
    this.source = marketSource({ exchange, market });
    this.onSnapshot = onSnapshot;
    this.onStatus = onStatus;
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.intervalMs = Math.max(5_000, Number(intervalMs) || 10_000);
    this.abortController = null;
    this.timer = null;
    this.socket = null;
    this.liveReconnectTimer = null;
    this.liveEmitTimer = null;
    this.liveConnecting = false;
    this.snapshotBySymbol = new Map();
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
        refresh: this.source.exchange === "binance_alpha",
      });
      if (!this.running || generation !== this.generation) return;
      this.snapshotBySymbol = new Map(rows.map((row) => [row.s, row]));
      this.onSnapshot(rows, this.source);
      this.onStatus({ state: "online", text: `${this.source.exchange.toUpperCase()} · ${rows.length} рынков` });
      this.#connectLive(generation);
    } catch (error) {
      if (!this.running || generation !== this.generation || error?.name === "AbortError") return;
      this.onStatus({ state: "warning", text: `${this.source.exchange.toUpperCase()} · повторное подключение` });
    }
    if (this.running && generation === this.generation) {
      const liveSource = ["aster", "binance_alpha"].includes(this.source.exchange);
      this.timer = setTimeout(() => this.#poll(generation), liveSource ? Math.max(60_000, this.intervalMs * 6) : this.intervalMs);
    }
  }

  async #connectLive(generation) {
    if (
      !this.running
      || generation !== this.generation
      || this.socket
      || this.liveConnecting
      || typeof this.WebSocketImpl !== "function"
      || !["aster", "binance_alpha"].includes(this.source.exchange)
    ) return;
    this.liveConnecting = true;
    let descriptor;
    try {
      descriptor = await buildLiveTickerStream(this.source, {
        fetchImpl: this.fetchImpl,
        signal: this.abortController?.signal,
      });
    } catch {
      this.liveConnecting = false;
      this.#scheduleLiveReconnect(generation);
      return;
    }
    this.liveConnecting = false;
    if (!descriptor || !this.running || generation !== this.generation) return;
    let socket;
    try {
      socket = new this.WebSocketImpl(descriptor.url);
    } catch {
      this.#scheduleLiveReconnect(generation);
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (socket !== this.socket || generation !== this.generation) return;
      descriptor.open(socket);
    });
    socket.addEventListener("message", (message) => {
      if (socket !== this.socket || generation !== this.generation) return;
      let payload;
      try { payload = JSON.parse(message.data); } catch { return; }
      let rows;
      try { rows = descriptor.parse(payload); } catch { return; }
      if (!rows?.length) return;
      for (const row of rows) this.snapshotBySymbol.set(row.s, mergeTicker(this.snapshotBySymbol.get(row.s), row));
      clearTimeout(this.liveEmitTimer);
      this.liveEmitTimer = setTimeout(() => {
        if (!this.running || generation !== this.generation) return;
        const snapshot = [...this.snapshotBySymbol.values()];
        this.onSnapshot(snapshot, this.source);
        this.onStatus({ state: "online", text: `${this.source.exchange.toUpperCase()} · LIVE · ${snapshot.length} рынков` });
      }, 180);
    });
    socket.addEventListener("close", () => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.#scheduleLiveReconnect(generation);
    });
    socket.addEventListener("error", () => {
      if (socket === this.socket) {
        try { socket.close(); } catch {}
      }
    });
  }

  #scheduleLiveReconnect(generation) {
    clearTimeout(this.liveReconnectTimer);
    if (!this.running || generation !== this.generation) return;
    this.liveReconnectTimer = setTimeout(() => this.#connectLive(generation), 1_800);
  }

  #cancel() {
    clearTimeout(this.timer);
    clearTimeout(this.liveReconnectTimer);
    clearTimeout(this.liveEmitTimer);
    this.timer = null;
    this.liveReconnectTimer = null;
    this.liveEmitTimer = null;
    this.liveConnecting = false;
    this.abortController?.abort();
    this.abortController = null;
    try { this.socket?.close(); } catch {}
    this.socket = null;
    this.snapshotBySymbol.clear();
  }

  destroy() {
    this.running = false;
    this.generation += 1;
    this.#cancel();
  }
}
