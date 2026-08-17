import {
  buildOrderBookStream,
  fetchExchangeOrderBook,
  resolveMarketMetadata,
} from "./exchange-market-data.js?v=26-124-multi-exchange-v1";
import {
  marketSource,
  marketSourceKey,
} from "./exchange-registry.js?v=26-124-multi-exchange-v1";

const MAX_LEVELS = 10_000;
const MAX_TRADES = 60_000;
const TRADE_RETENTION_MS = 5 * 60_000;

function applyRows(target, rows) {
  for (const row of rows ?? []) {
    const price = Number(row?.[0]);
    const quantity = Number(row?.[1]);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
    if (quantity > 0) target.set(price, quantity);
    else target.delete(price);
  }
}

function sortedRows(map, side) {
  return [...map.entries()]
    .filter(([price, quantity]) => Number.isFinite(price) && Number.isFinite(quantity) && quantity > 0)
    .sort((left, right) => side === "bid" ? right[0] - left[0] : left[0] - right[0])
    .slice(0, MAX_LEVELS);
}

function quoteScale(bids, asks) {
  const quotes = [...bids, ...asks]
    .map(([price, quantity]) => Number(price) * Number(quantity))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (!quotes.length) return { maximum: 1, anomaly: 1 };
  const percentile = quotes[Math.min(quotes.length - 1, Math.floor(quotes.length * .97))];
  return {
    maximum: Math.max(1, quotes.at(-1)),
    anomaly: Math.max(1, percentile),
  };
}

export class ExchangeOrderBookFeed {
  constructor({
    exchange,
    market,
    onData = () => {},
    onStatus = () => {},
    WebSocketImpl = globalThis.WebSocket,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.source = marketSource({ exchange, market });
    this.onData = onData;
    this.onStatus = onStatus;
    this.WebSocketImpl = WebSocketImpl;
    this.fetchImpl = fetchImpl;
    this.symbol = null;
    this.socket = null;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.abortController = null;
    this.generation = 0;
    this.destroyed = false;
    this.bids = new Map();
    this.asks = new Map();
    this.trades = [];
    this.tradeKeys = new Set();
    this.sequence = null;
    this.depthReady = false;
    this.resyncCount = 0;
    this.lastEmitAt = 0;
    this.emitTimer = null;
  }

  select(symbol) {
    if (this.destroyed || !symbol) return;
    this.symbol = symbol;
    this.generation += 1;
    this.#cleanupConnection();
    this.#reset();
    this.#dispatchTape({ replace: true, seriesReplace: true, trades: [], aggregationTrades: [], seriesTrades: [] });
    this.#start(this.generation);
  }

  async #start(generation) {
    this.onStatus({ state: "loading", text: `Подключение ${this.source.exchange.toUpperCase()}` });
    this.abortController = new AbortController();
    const sourceValue = { ...this.source, symbol: this.symbol };
    try {
      const metadata = await resolveMarketMetadata(sourceValue, {
        fetchImpl: this.fetchImpl,
        signal: this.abortController.signal,
      });
      if (generation !== this.generation || this.destroyed) return;
      this.source = metadata;
      const descriptor = await buildOrderBookStream(metadata, {
        fetchImpl: this.fetchImpl,
        signal: this.abortController.signal,
      });
      if (generation !== this.generation || this.destroyed) return;
      this.#openSocket(descriptor, generation);
      this.#loadSnapshot(metadata, generation);
    } catch (error) {
      if (generation !== this.generation || this.destroyed || error?.name === "AbortError") return;
      this.onStatus({ state: "offline", text: `${this.source.exchange.toUpperCase()} недоступна` });
      this.#scheduleReconnect(generation);
    }
  }

  async #loadSnapshot(source, generation) {
    try {
      const snapshot = await fetchExchangeOrderBook(source, 1_000, {
        fetchImpl: this.fetchImpl,
        signal: this.abortController?.signal,
      });
      if (generation !== this.generation || this.destroyed || this.depthReady) return;
      this.bids.clear();
      this.asks.clear();
      applyRows(this.bids, snapshot.bids);
      applyRows(this.asks, snapshot.asks);
      this.sequence = Number.isFinite(Number(snapshot.sequence)) ? Number(snapshot.sequence) : null;
      this.depthReady = this.bids.size > 0 && this.asks.size > 0;
      if (this.depthReady) {
        this.#emit(Date.now(), true);
        this.onStatus({ state: "online", text: `LIVE · ${this.source.exchange.toUpperCase()}` });
      }
    } catch {
      // The WebSocket snapshot remains authoritative where the venue sends one.
    }
  }

  #openSocket(descriptor, generation) {
    let socket;
    try {
      socket = new this.WebSocketImpl(descriptor.url);
    } catch {
      this.#scheduleReconnect(generation);
      return;
    }
    this.socket = socket;
    this.watchdogTimer = setTimeout(() => {
      if (generation === this.generation && socket === this.socket && !this.depthReady) {
        try { socket.close(); } catch {}
      }
    }, 10_000);

    socket.addEventListener("open", () => {
      if (generation !== this.generation || socket !== this.socket) return;
      descriptor.open(socket);
      this.onStatus({ state: "loading", text: `Синхронизация ${this.source.exchange.toUpperCase()}` });
    });

    socket.addEventListener("message", (message) => {
      if (generation !== this.generation || socket !== this.socket) return;
      let payload;
      try { payload = JSON.parse(message.data); } catch { return; }
      let events;
      try { events = descriptor.parse(payload); } catch { return; }
      for (const event of events ?? []) this.#applyEvent(event);
    });

    socket.addEventListener("close", () => {
      if (generation !== this.generation || socket !== this.socket || this.destroyed) return;
      this.socket = null;
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
      this.onStatus({ state: "offline", text: `Переподключение ${this.source.exchange.toUpperCase()}` });
      this.#scheduleReconnect(generation);
    });

    socket.addEventListener("error", () => {
      if (generation === this.generation && socket === this.socket) {
        try { socket.close(); } catch {}
      }
    });
  }

  #applyEvent(event) {
    if (event?.kind === "book") {
      if (event.snapshot) {
        this.bids.clear();
        this.asks.clear();
      }
      applyRows(this.bids, event.bids);
      applyRows(this.asks, event.asks);
      if (Number.isFinite(Number(event.sequence))) this.sequence = Number(event.sequence);
      this.depthReady = this.bids.size > 0 && this.asks.size > 0;
      if (!this.depthReady) return;
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
      this.#emit(event.eventTime, false);
      this.onStatus({ state: "online", text: `LIVE · ${this.source.exchange.toUpperCase()}` });
      return;
    }
    if (event?.kind === "trades") this.#ingestTrades(event.trades);
  }

  #ingestTrades(rows) {
    const fresh = [];
    for (const trade of rows ?? []) {
      if (!trade || ![trade.time, trade.price, trade.quantity, trade.quote].every(Number.isFinite)) continue;
      const key = `${trade.id}:${trade.time}:${trade.price}:${trade.quantity}`;
      if (this.tradeKeys.has(key)) continue;
      this.tradeKeys.add(key);
      this.trades.push({
        ...trade,
        receivedAt: Date.now(),
        displayTime: trade.time,
        tradeTime: trade.time,
      });
      fresh.push(this.trades.at(-1));
    }
    if (!fresh.length) return;
    const cutoff = Date.now() - TRADE_RETENTION_MS;
    this.trades = this.trades.filter((trade) => trade.time >= cutoff).slice(-MAX_TRADES);
    this.tradeKeys = new Set(this.trades.map((trade) => `${trade.id}:${trade.time}:${trade.price}:${trade.quantity}`));
    this.#dispatchTape({
      replace: false,
      live: true,
      liveOnly: true,
      trades: fresh,
      aggregationTrades: fresh,
      aggregationSource: "raw",
      seriesTrades: fresh,
      seriesSource: "raw",
    });
    this.#emit(fresh.at(-1).time, false);
  }

  #dispatchTape(payload) {
    if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
    const key = marketSourceKey({ ...this.source, symbol: this.symbol });
    globalThis.dispatchEvent(new CustomEvent("inpuls:tape-data", {
      detail: {
        symbol: key,
        exchange: this.source.exchange,
        market: this.source.market,
        ...payload,
      },
    }));
  }

  #emit(eventTime = Date.now(), immediate = false) {
    const now = Date.now();
    if (!immediate && now - this.lastEmitAt < 70) {
      clearTimeout(this.emitTimer);
      this.emitTimer = setTimeout(() => this.#emit(eventTime, true), 70 - (now - this.lastEmitAt));
      return;
    }
    this.lastEmitAt = now;
    const bids = sortedRows(this.bids, "bid");
    const asks = sortedRows(this.asks, "ask");
    if (!bids.length || !asks.length) return;
    const scale = quoteScale(bids, asks);
    const data = {
      symbol: this.symbol,
      exchange: this.source.exchange,
      market: this.source.market,
      bids,
      asks,
      trades: this.trades.slice(-2_000).reverse(),
      eventTime: Number(eventTime) || Date.now(),
      lastUpdateId: this.sequence,
      depthReady: this.depthReady,
      bookLevels: { bids: this.bids.size, asks: this.asks.size },
      sizeScaleMaxQuote: scale.maximum,
      sizeAnomalyThresholdQuote: scale.anomaly,
      sizeAnomalyThresholdBidQuote: scale.anomaly,
      sizeAnomalyThresholdAskQuote: scale.anomaly,
      resyncCount: this.resyncCount,
    };
    this.onData(data);
  }

  #scheduleReconnect(generation) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (generation !== this.generation || this.destroyed) return;
      this.resyncCount += 1;
      this.#start(generation);
    }, 1_800);
  }

  #reset() {
    this.bids.clear();
    this.asks.clear();
    this.trades = [];
    this.tradeKeys.clear();
    this.sequence = null;
    this.depthReady = false;
    this.lastEmitAt = 0;
    clearTimeout(this.emitTimer);
    this.emitTimer = null;
  }

  #cleanupConnection() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdogTimer);
    clearTimeout(this.emitTimer);
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.emitTimer = null;
    this.abortController?.abort();
    this.abortController = null;
    try { this.socket?.close(); } catch {}
    this.socket = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.#cleanupConnection();
    this.#reset();
  }
}
