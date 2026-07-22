import { applyDepthUpdates, depthView, normalizeMarketTrade } from "./orderbook-core-v25.js";

export function depthCoverage(bids, asks) {
  const bestBid = Number(bids?.[0]?.[0]);
  const bestAsk = Number(asks?.[0]?.[0]);
  const middle = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? (bestBid + bestAsk) / 2 : NaN;
  if (!Number.isFinite(middle) || middle <= 0) return { bidPercent: 0, askPercent: 0 };
  const lowestBid = Number(bids?.at(-1)?.[0]);
  const highestAsk = Number(asks?.at(-1)?.[0]);
  return {
    bidPercent: Number.isFinite(lowestBid) ? Math.max(0, ((middle - lowestBid) / middle) * 100) : 0,
    askPercent: Number.isFinite(highestAsk) ? Math.max(0, ((highestAsk - middle) / middle) * 100) : 0,
  };
}

export function canApplyDepthEvent(lastUpdateId, event, firstEvent = false) {
  const first = Number(event?.U);
  const final = Number(event?.u);
  const previous = Number(event?.pu);
  const local = Number(lastUpdateId);
  if (![first, final, local].every(Number.isFinite)) return { action: "resync", reason: "invalid-sequence" };
  if (final <= local) return { action: "ignore", reason: "stale" };
  if (firstEvent) {
    return first <= local + 1 && final >= local + 1
      ? { action: "apply", reason: "bridge" }
      : { action: "resync", reason: "missing-bridge" };
  }
  if (Number.isFinite(previous) && previous !== local) return { action: "resync", reason: "pu-gap" };
  if (!Number.isFinite(previous) && first > local + 1) return { action: "resync", reason: "u-gap" };
  return { action: "apply", reason: "continuous" };
}

const MAX_TRADE_HISTORY = 20_000;
const MAX_BOOK_LEVELS_PER_SIDE = 20_000;
const MAX_EMITTED_LEVELS_PER_SIDE = 10_000;
const MAX_BUFFERED_DEPTH_EVENTS = 4_000;
const SNAPSHOT_RETRY_MS = 350;

function streamTransports(streamName) {
  return [
    { url: `wss://fstream.binance.com/ws/${streamName}`, subscribe: false, name: "binance-raw" },
    { url: `wss://fstream.binance.com/stream?streams=${streamName}`, subscribe: false, name: "binance-combined" },
    { url: "wss://fstream.binance.com/ws", subscribe: true, name: "binance-subscribe" },
    { url: `wss://stream.binancefuture.com/ws/${streamName}`, subscribe: false, name: "future-raw" },
    { url: `wss://stream.binancefuture.com/stream?streams=${streamName}`, subscribe: false, name: "future-combined" },
    { url: "wss://stream.binancefuture.com/ws", subscribe: true, name: "future-subscribe" },
    // Последние варианты оставлены только для совместимости со старой сборкой.
    { url: `wss://fstream.binance.com/public/stream?streams=${streamName}`, subscribe: false, name: "legacy-public" },
    { url: `wss://fstream.binance.com/market/stream?streams=${streamName}`, subscribe: false, name: "legacy-market" },
  ];
}

function websocketPayload(raw) {
  let payload;
  try { payload = JSON.parse(raw); } catch { return null; }
  if (payload?.result === null || payload?.id) return null;
  return payload?.data ?? payload;
}

class TradeHistoryStore {
  constructor() { this.dbPromise = null; }
  #open() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      const request = indexedDB.open("inpuls-market-trades-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("symbols", { keyPath: "symbol" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return this.dbPromise;
  }
  async get(symbol) {
    const db = await this.#open();
    if (!db) return [];
    return new Promise((resolve) => {
      const request = db.transaction("symbols", "readonly").objectStore("symbols").get(symbol);
      request.onsuccess = () => resolve(Array.isArray(request.result?.trades) ? request.result.trades : []);
      request.onerror = () => resolve([]);
    });
  }
  async set(symbol, trades) {
    const db = await this.#open();
    if (!db) return;
    await new Promise((resolve) => {
      const transaction = db.transaction("symbols", "readwrite");
      transaction.objectStore("symbols").put({ symbol, trades: trades.slice(0, MAX_TRADE_HISTORY), updatedAt: Date.now() });
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
    });
  }
}

const tradeHistoryStore = new TradeHistoryStore();

export class OrderBookFeed {
  constructor({ onData, onStatus, WebSocketImpl = globalThis.WebSocket, fetchImpl = globalThis.fetch } = {}) {
    this.onData = onData ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.WebSocketImpl = WebSocketImpl;
    this.fetchImpl = fetchImpl;
    this.depthSocket = null;
    this.tradeSocket = null;
    this.symbol = null;
    this.generation = 0;
    this.depthAttemptIndex = 0;
    this.tradeAttemptIndex = 0;
    this.depthReconnectTimer = null;
    this.tradeReconnectTimer = null;
    this.depthWatchdogTimer = null;
    this.tradeWatchdogTimer = null;
    this.snapshotRetryTimer = null;
    this.tradeHistoryTimer = null;
    this.bids = new Map();
    this.asks = new Map();
    this.trades = [];
    this.lastUpdateId = null;
    this.cachedDepth = null;
    this.depthBuffer = [];
    this.depthReady = false;
    this.snapshotLoading = false;
    this.snapshotFailures = 0;
    this.depthMode = "deep";
    this.partialBidKeys = new Set();
    this.partialAskKeys = new Set();
    this.resyncCount = 0;
  }
  select(symbol) {
    if (!symbol?.endsWith("USDT")) return;
    if (this.symbol && this.trades.length) tradeHistoryStore.set(this.symbol, this.trades).catch(() => {});
    this.symbol = symbol;
    this.bids.clear();
    this.asks.clear();
    this.trades = [];
    this.lastUpdateId = null;
    this.cachedDepth = null;
    this.depthBuffer = [];
    this.depthReady = false;
    this.snapshotLoading = false;
    this.snapshotFailures = 0;
    this.depthMode = "deep";
    this.partialBidKeys = new Set();
    this.partialAskKeys = new Set();
    this.resyncCount = 0;
    clearTimeout(this.snapshotRetryTimer);
    clearTimeout(this.tradeHistoryTimer);
    const generation = ++this.generation;
    this.#start(generation);
    this.#loadTradeHistory(symbol, generation);
  }
  async #loadTradeHistory(symbol, generation) {
    const saved = await tradeHistoryStore.get(symbol);
    if (generation !== this.generation || symbol !== this.symbol || !saved.length) return;
    const merged = new Map();
    for (const trade of [...this.trades, ...saved]) {
      if (!trade || !Number.isFinite(Number(trade.time))) continue;
      merged.set(String(trade.id), trade);
    }
    this.trades = [...merged.values()].sort((left, right) => right.time - left.time).slice(0, MAX_TRADE_HISTORY);
    this.#emit(Date.now());
  }
  #scheduleTradeHistorySave() {
    clearTimeout(this.tradeHistoryTimer);
    const symbol = this.symbol;
    this.tradeHistoryTimer = setTimeout(() => {
      if (symbol === this.symbol) tradeHistoryStore.set(symbol, this.trades).catch(() => {});
    }, 4_000);
  }

  #replacePartialSide(target, previousKeys, rows) {
    const nextKeys = new Set();
    for (const [priceValue, quantityValue] of rows ?? []) {
      const price = Number(priceValue);
      const quantity = Number(quantityValue);
      if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
      nextKeys.add(price);
      if (quantity > 0) target.set(price, quantity);
      else target.delete(price);
    }
    for (const price of previousKeys) {
      if (!nextKeys.has(price)) target.delete(price);
    }
    return nextKeys;
  }
  #activatePartialFallback(generation) {
    if (generation !== this.generation || this.depthMode === "partial") return;
    this.depthMode = "partial";
    this.depthReady = false;
    this.snapshotLoading = false;
    this.depthBuffer = [];
    this.bids.clear();
    this.asks.clear();
    this.partialBidKeys.clear();
    this.partialAskKeys.clear();
    this.lastUpdateId = null;
    this.cachedDepth = null;
    clearTimeout(this.snapshotRetryTimer);
    clearTimeout(this.depthReconnectTimer);
    clearTimeout(this.depthWatchdogTimer);
    this.onStatus({ state: "loading", text: "Резервный live-стакан" });
    const previousSocket = this.depthSocket;
    this.depthSocket = null;
    previousSocket?.close();
    this.depthReconnectTimer = setTimeout(() => this.#startDepth(generation), 0);
  }
  #start(generation) {
    this.onStatus({ state: "loading", text: "Подключение" });
    this.#startDepth(generation);
    this.#startTrades(generation);
  }
  #emit(eventTime = Date.now(), refreshDepth = false) {
    if (refreshDepth || !this.cachedDepth) this.cachedDepth = depthView(this.bids, this.asks, MAX_EMITTED_LEVELS_PER_SIDE);
    const view = this.cachedDepth;
    if (!view.bids.length || !view.asks.length) return;
    this.onData({
      symbol: this.symbol,
      ...view,
      trades: this.trades,
      lastUpdateId: this.lastUpdateId,
      eventTime,
      depthReady: this.depthReady,
      coverage: depthCoverage(view.bids, view.asks),
      bookLevels: { bids: this.bids.size, asks: this.asks.size },
      resyncCount: this.resyncCount,
    });
  }
  #bufferDepthEvent(update) {
    this.depthBuffer.push(update);
    if (this.depthBuffer.length <= MAX_BUFFERED_DEPTH_EVENTS) return;
    this.depthBuffer.splice(0, this.depthBuffer.length - MAX_BUFFERED_DEPTH_EVENTS);
    this.#resyncDepth("Переполнение буфера", false);
  }
  #trimBook() {
    if (this.bids.size > MAX_BOOK_LEVELS_PER_SIDE) {
      const sorted = [...this.bids.keys()].sort((left, right) => right - left);
      for (const price of sorted.slice(MAX_BOOK_LEVELS_PER_SIDE)) this.bids.delete(price);
    }
    if (this.asks.size > MAX_BOOK_LEVELS_PER_SIDE) {
      const sorted = [...this.asks.keys()].sort((left, right) => left - right);
      for (const price of sorted.slice(MAX_BOOK_LEVELS_PER_SIDE)) this.asks.delete(price);
    }
  }
  #applyDepthEvent(update, firstEvent = false) {
    const decision = canApplyDepthEvent(this.lastUpdateId, update, firstEvent);
    if (decision.action === "ignore") return true;
    if (decision.action === "resync") {
      this.#resyncDepth("Разрыв последовательности");
      return false;
    }
    applyDepthUpdates(this.bids, update.b ?? update.bids);
    applyDepthUpdates(this.asks, update.a ?? update.asks);
    this.lastUpdateId = Number(update.u);
    this.#trimBook();
    return true;
  }
  #applyBufferedDepth(snapshotLastUpdateId) {
    const applicable = this.depthBuffer.filter((event) => Number(event?.u) > snapshotLastUpdateId);
    if (!applicable.length) return false;
    const bridgeIndex = applicable.findIndex((event) => Number(event?.U) <= snapshotLastUpdateId + 1 && Number(event?.u) >= snapshotLastUpdateId + 1);
    if (bridgeIndex < 0) return false;
    this.lastUpdateId = snapshotLastUpdateId;
    for (let index = bridgeIndex; index < applicable.length; index += 1) {
      if (!this.#applyDepthEvent(applicable[index], index === bridgeIndex)) return false;
    }
    this.depthBuffer = [];
    this.depthReady = true;
    return true;
  }
  #resyncDepth(text = "Пересинхронизация", count = true) {
    if (count) this.resyncCount += 1;
    this.depthReady = false;
    this.snapshotLoading = false;
    this.bids.clear();
    this.asks.clear();
    this.lastUpdateId = null;
    this.cachedDepth = null;
    this.onStatus({ state: "loading", text });
    clearTimeout(this.snapshotRetryTimer);
    const generation = this.generation;
    this.snapshotRetryTimer = setTimeout(() => this.#loadDepthSnapshot(generation), SNAPSHOT_RETRY_MS);
  }
  async #loadDepthSnapshot(generation) {
    if (generation !== this.generation || this.snapshotLoading || typeof this.fetchImpl !== "function") return;
    this.snapshotLoading = true;
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
    let snapshot = null;
    for (const host of hosts) {
      try {
        const response = await this.fetchImpl(`https://${host}/fapi/v1/depth?symbol=${this.symbol}&limit=1000`, { cache: "no-store" });
        if (!response?.ok || generation !== this.generation) continue;
        const candidate = await response.json();
        if (!Array.isArray(candidate?.bids) || !Array.isArray(candidate?.asks) || !Number.isFinite(Number(candidate?.lastUpdateId))) continue;
        snapshot = candidate;
        break;
      } catch {}
    }
    this.snapshotLoading = false;
    if (generation !== this.generation) return;
    if (!snapshot) {
      this.snapshotFailures += 1;
      this.onStatus({ state: "loading", text: "Снимок недоступен · включаю резерв" });
      this.#activatePartialFallback(generation);
      return;
    }
    this.snapshotFailures = 0;
    const firstBufferedU = Number(this.depthBuffer[0]?.U);
    if (Number.isFinite(firstBufferedU) && Number(snapshot.lastUpdateId) < firstBufferedU - 1) {
      this.snapshotRetryTimer = setTimeout(() => this.#loadDepthSnapshot(generation), SNAPSHOT_RETRY_MS);
      return;
    }
    this.bids = applyDepthUpdates(new Map(), snapshot.bids);
    this.asks = applyDepthUpdates(new Map(), snapshot.asks);
    const synced = this.#applyBufferedDepth(Number(snapshot.lastUpdateId));
    if (!synced) {
      this.bids.clear();
      this.asks.clear();
      this.lastUpdateId = null;
      this.snapshotRetryTimer = setTimeout(() => this.#loadDepthSnapshot(generation), SNAPSHOT_RETRY_MS);
      return;
    }
    this.#emit(Date.now(), true);
    this.onStatus({ state: "online", text: "LIVE 100ms · FULL" });
  }
  #startDepth(generation) {
    clearTimeout(this.depthReconnectTimer);
    clearTimeout(this.depthWatchdogTimer);
    this.depthSocket?.close();

    const mode = this.depthMode;
    const rate = this.depthAttemptIndex % 5 === 4 ? "500ms" : "100ms";
    const streamKind = mode === "partial" ? "depth20" : "depth";
    const depthStream = `${this.symbol.toLowerCase()}@${streamKind}@${rate}`;
    const transports = streamTransports(depthStream);
    const transport = transports[this.depthAttemptIndex % transports.length];

    let socket;
    try {
      socket = new this.WebSocketImpl(transport.url);
    } catch {
      this.depthAttemptIndex += 1;
      this.onStatus({ state: "offline", text: "Повтор подключения стакана" });
      this.depthReconnectTimer = setTimeout(() => this.#startDepth(generation), 500);
      return;
    }
    this.depthSocket = socket;

    // Таймер до первого сообщения, а не бесконечное ожидание CONNECTING.
    this.depthWatchdogTimer = setTimeout(() => {
      if (generation === this.generation && mode === this.depthMode) socket.close();
    }, 8_000);

    socket.addEventListener("open", () => {
      if (generation !== this.generation || mode !== this.depthMode) return;
      if (transport.subscribe) {
        socket.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: [depthStream],
          id: Date.now() % 2_147_483_647,
        }));
      }
      this.onStatus({
        state: "loading",
        text: mode === "partial" ? "Подключаю резервный стакан" : "Синхронизация книги",
      });
      if (mode === "deep") this.#loadDepthSnapshot(generation);
    });

    socket.addEventListener("message", (event) => {
      if (generation !== this.generation || mode !== this.depthMode) return;
      const update = websocketPayload(event.data);
      if (!update) return;
      const bidRows = update?.b ?? update?.bids;
      const askRows = update?.a ?? update?.asks;
      if (!Array.isArray(bidRows) || !Array.isArray(askRows)) return;

      clearTimeout(this.depthWatchdogTimer);
      // После первого события контролируем тишину потока: depth должен обновляться постоянно.
      this.depthWatchdogTimer = setTimeout(() => socket.close(), 8_000);

      if (mode === "partial") {
        this.partialBidKeys = this.#replacePartialSide(this.bids, this.partialBidKeys, bidRows);
        this.partialAskKeys = this.#replacePartialSide(this.asks, this.partialAskKeys, askRows);
        this.lastUpdateId = Number(update.u ?? update.lastUpdateId) || this.lastUpdateId;
        this.depthReady = true;
        this.#emit(Number(update.E) || Date.now(), true);
        this.onStatus({
          state: "online",
          text: rate === "500ms" ? "LIVE 500ms · FULL VIEW · 20" : "LIVE 100ms · FULL VIEW · 20",
        });
        return;
      }

      if (!Number.isFinite(Number(update?.U)) || !Number.isFinite(Number(update?.u))) return;
      if (!this.depthReady) {
        this.#bufferDepthEvent(update);
        if (!this.snapshotLoading) this.#loadDepthSnapshot(generation);
        return;
      }
      if (!this.#applyDepthEvent(update)) return;
      this.#emit(Number(update.E) || Date.now(), true);
      this.onStatus({
        state: "online",
        text: rate === "500ms" ? "LIVE 500ms · FULL" : "LIVE 100ms · FULL",
      });
    });

    socket.addEventListener("close", () => {
      if (generation !== this.generation || mode !== this.depthMode) return;
      clearTimeout(this.depthWatchdogTimer);
      this.depthReady = false;
      this.snapshotLoading = false;
      this.depthBuffer = [];
      this.bids.clear();
      this.asks.clear();
      this.partialBidKeys.clear();
      this.partialAskKeys.clear();
      this.lastUpdateId = null;
      this.cachedDepth = null;
      this.depthAttemptIndex += 1;
      this.onStatus({ state: "offline", text: "Переподключение стакана" });
      this.depthReconnectTimer = setTimeout(() => this.#startDepth(generation), 500);
    });

    socket.addEventListener("error", () => {
      if (generation !== this.generation || mode !== this.depthMode) return;
      this.onStatus({ state: "offline", text: "Ошибка потока стакана" });
      try { socket.close(); } catch {}
    });
  }

  #startTrades(generation) {
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.tradeWatchdogTimer);
    this.tradeSocket?.close();

    const tradeStream = `${this.symbol.toLowerCase()}@aggTrade`;
    const transports = streamTransports(tradeStream);
    const transport = transports[this.tradeAttemptIndex % transports.length];

    let socket;
    try {
      socket = new this.WebSocketImpl(transport.url);
    } catch {
      this.tradeAttemptIndex += 1;
      this.tradeReconnectTimer = setTimeout(() => this.#startTrades(generation), 500);
      return;
    }
    this.tradeSocket = socket;

    // Проверяем только установление соединения. Отсутствие сделок не означает разрыв.
    this.tradeWatchdogTimer = setTimeout(() => {
      if (generation === this.generation && socket.readyState !== 1) socket.close();
    }, 8_000);

    socket.addEventListener("open", () => {
      if (generation !== this.generation) return;
      clearTimeout(this.tradeWatchdogTimer);
      if (transport.subscribe) {
        socket.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: [tradeStream],
          id: Date.now() % 2_147_483_647,
        }));
      }
    });

    socket.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      const update = websocketPayload(event.data);
      if (!update) return;
      const trade = normalizeMarketTrade(update);
      if (!trade) return;
      this.trades.unshift(trade);
      if (this.trades.length > MAX_TRADE_HISTORY) this.trades.length = MAX_TRADE_HISTORY;
      this.#scheduleTradeHistorySave();
      this.#emit(trade.time);
    });

    socket.addEventListener("close", () => {
      if (generation !== this.generation) return;
      clearTimeout(this.tradeWatchdogTimer);
      this.tradeAttemptIndex += 1;
      this.tradeReconnectTimer = setTimeout(() => this.#startTrades(generation), 500);
    });

    socket.addEventListener("error", () => {
      if (generation !== this.generation) return;
      try { socket.close(); } catch {}
    });
  }
  destroy() {
    if (this.symbol && this.trades.length) tradeHistoryStore.set(this.symbol, this.trades).catch(() => {});
    this.generation += 1;
    clearTimeout(this.depthReconnectTimer);
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.depthWatchdogTimer);
    clearTimeout(this.tradeWatchdogTimer);
    clearTimeout(this.snapshotRetryTimer);
    clearTimeout(this.tradeHistoryTimer);
    this.depthSocket?.close();
    this.tradeSocket?.close();
    this.depthSocket = null;
    this.tradeSocket = null;
  }
}
