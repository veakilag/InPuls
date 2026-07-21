export function applyDepthUpdates(levels, updates) {
  for (const [priceValue, quantityValue] of updates ?? []) {
    const price = Number(priceValue);
    const quantity = Number(quantityValue);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
    if (quantity === 0) levels.delete(price);
    else levels.set(price, quantity);
  }
  return levels;
}

export function depthView(bids, asks, limit = 24) {
  const safeLimit = Math.max(1, Math.floor(limit));
  return {
    bids: [...bids.entries()].sort((left, right) => right[0] - left[0]).slice(0, safeLimit),
    asks: [...asks.entries()].sort((left, right) => left[0] - right[0]).slice(0, safeLimit),
  };
}

export function partialDepthView(event, limit = 20) {
  const bids = new Map();
  const asks = new Map();
  applyDepthUpdates(bids, event?.b ?? event?.bids);
  applyDepthUpdates(asks, event?.a ?? event?.asks);
  return depthView(bids, asks, limit);
}

export function normalizeMarketTrade(event) {
  const price = Number(event?.p);
  const quantity = Number(event?.q);
  const time = Number(event?.T ?? event?.E);
  if (![price, quantity, time].every(Number.isFinite)) return null;
  return {
    id: Number(event?.a) || `${time}-${price}-${quantity}`,
    price,
    quantity,
    quote: price * quantity,
    time,
    side: event?.m ? "sell" : "buy",
  };
}

export function aggregateDepthBands(levels, middlePrice, rangePercent, rowCount, side) {
  const count = Math.max(1, Math.floor(Number(rowCount) || 1));
  const middle = Number(middlePrice);
  const percent = Math.max(.5, Math.min(100, Number(rangePercent) || .5));
  if (!Number.isFinite(middle) || middle <= 0) return [];
  const span = middle * percent / 100;
  const step = span / count;
  const bands = Array.from({ length: count }, (_, index) => ({
    price: side === "ask" ? middle + step * (index + .5) : middle - step * (index + .5),
    quantity: 0,
    quote: 0,
  }));
  for (const [priceValue, quantityValue] of levels ?? []) {
    const price = Number(priceValue);
    const quantity = Number(quantityValue);
    if (![price, quantity].every(Number.isFinite) || quantity <= 0) continue;
    const distance = side === "ask" ? price - middle : middle - price;
    if (distance < 0 || distance > span) continue;
    const index = Math.min(count - 1, Math.floor(distance / Math.max(Number.MIN_VALUE, step)));
    bands[index].quantity += quantity;
    bands[index].quote += price * quantity;
  }
  return bands;
}

export const BOOK_SCALE_MULTIPLIERS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

export function inferPriceTick(bids, asks, middlePrice) {
  const prices = [...(bids ?? []), ...(asks ?? [])]
    .slice(0, 160)
    .map((row) => Number(row?.[0]))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  let minimum = Infinity;
  for (let index = 1; index < prices.length; index += 1) {
    const difference = prices[index] - prices[index - 1];
    if (difference > Number.EPSILON && difference < minimum) minimum = difference;
  }
  if (Number.isFinite(minimum)) return minimum;
  const middle = Math.abs(Number(middlePrice));
  if (!Number.isFinite(middle) || middle === 0) return .01;
  return 10 ** Math.floor(Math.log10(middle) - 5);
}

export function priceStepForScale(baseTick, scaleIndex = 3) {
  const tick = Math.max(Number.EPSILON, Number(baseTick) || .01);
  const index = Math.max(0, Math.min(BOOK_SCALE_MULTIPLIERS.length - 1, Math.round(Number(scaleIndex) || 0)));
  return tick * BOOK_SCALE_MULTIPLIERS[index];
}

export function bookScaleLabel(scaleIndex = 3) {
  const index = Math.max(0, Math.min(BOOK_SCALE_MULTIPLIERS.length - 1, Math.round(Number(scaleIndex) || 0)));
  return `×${BOOK_SCALE_MULTIPLIERS[index]}`;
}

export function maximumBookScaleIndex() {
  return BOOK_SCALE_MULTIPLIERS.length - 1;
}

export function adaptiveBookScaleIndex(baseTick, currentIndex, movement, rowCount, coverage = .7) {
  const tick = Math.max(Number.EPSILON, Number(baseTick) || .01);
  const safeIndex = Math.max(0, Math.min(maximumBookScaleIndex(), Math.round(Number(currentIndex) || 0)));
  const halfRows = Math.max(2, Math.floor((Number(rowCount) || 3) / 2));
  const requiredStep = Math.max(0, Number(movement) || 0) / (halfRows * Math.max(.35, Math.min(.9, Number(coverage) || .7)));
  const requiredMultiplier = requiredStep / tick;
  const adaptiveIndex = BOOK_SCALE_MULTIPLIERS.findIndex((multiplier) => multiplier >= requiredMultiplier);
  return Math.max(safeIndex, adaptiveIndex < 0 ? maximumBookScaleIndex() : adaptiveIndex);
}

export function depthCoverageScaleIndex(baseTick, bids, asks, middlePrice, rowCount, coverage = .92) {
  const middle = Number(middlePrice);
  const tick = Math.max(Number.EPSILON, Number(baseTick) || .01);
  if (!Number.isFinite(middle)) return 0;
  const distances = [...(bids ?? []), ...(asks ?? [])]
    .map((row) => Math.abs(Number(row?.[0]) - middle))
    .filter((distance) => Number.isFinite(distance) && distance > 0)
    .sort((left, right) => left - right);
  if (!distances.length) return 0;
  const percentile = Math.max(0, Math.min(distances.length - 1, Math.floor((distances.length - 1) * Math.max(.5, Math.min(1, Number(coverage) || .92)))));
  const halfRows = Math.max(2, Math.floor((Number(rowCount) || 3) / 2));
  const requiredMultiplier = (distances[percentile] / halfRows) / tick;
  const index = BOOK_SCALE_MULTIPLIERS.findIndex((multiplier) => multiplier >= requiredMultiplier);
  return index < 0 ? maximumBookScaleIndex() : index;
}

export function recoverBookScaleIndex(userIndex, adaptiveIndex, calmTicks = 1) {
  const user = Math.max(0, Math.min(maximumBookScaleIndex(), Math.round(Number(userIndex) || 0)));
  const adaptive = Math.max(user, Math.min(maximumBookScaleIndex(), Math.round(Number(adaptiveIndex) || user)));
  return Math.max(user, adaptive - Math.max(1, Math.round(Number(calmTicks) || 1)));
}

export function buildDepthLadder(bids, asks, marketPrice, viewCenter, priceStep, rowCount) {
  const count = Math.max(3, Math.floor(Number(rowCount) || 3));
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const market = Number(marketPrice);
  const center = Number.isFinite(Number(viewCenter)) ? Number(viewCenter) : market;
  if (!Number.isFinite(market) || !Number.isFinite(center)) return [];
  const middleIndex = Math.floor(count / 2);
  const topPrice = Math.round((center + middleIndex * step) / step) * step;
  const rows = Array.from({ length: count }, (_, index) => ({
    price: topPrice - index * step,
    bidQuote: 0,
    askQuote: 0,
    quantity: 0,
    quote: 0,
    isMarket: false,
  }));
  const add = (levels, side) => {
    for (const row of levels ?? []) {
      const price = Number(row?.[0]);
      const quantity = Number(row?.[1]);
      if (![price, quantity].every(Number.isFinite) || quantity <= 0) continue;
      const index = Math.round((topPrice - price) / step);
      if (index < 0 || index >= count) continue;
      const quote = price * quantity;
      rows[index].quantity += quantity;
      rows[index].quote += quote;
      rows[index][side === "bid" ? "bidQuote" : "askQuote"] += quote;
    }
  };
  add(bids, "bid");
  add(asks, "ask");
  const marketIndex = Math.max(0, Math.min(count - 1, Math.round((topPrice - market) / step)));
  rows[marketIndex].isMarket = true;
  return rows;
}

export function aggregateTradeClusters(trades, minimumQuote = 0, priceStep = .01, limit = 40) {
  const threshold = Math.max(0, Number(minimumQuote) || 0);
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const clusters = new Map();
  for (const trade of trades ?? []) {
    if (!trade || !Number.isFinite(trade.quote) || trade.quote < threshold) continue;
    const price = Math.round(trade.price / step) * step;
    const key = String(price);
    const cluster = clusters.get(key) ?? { price, buyQuote: 0, sellQuote: 0, quote: 0, count: 0, time: 0 };
    cluster[trade.side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    cluster.quote += trade.quote;
    cluster.count += 1;
    cluster.time = Math.max(cluster.time, trade.time);
    clusters.set(key, cluster);
  }
  return [...clusters.values()].sort((left, right) => right.time - left.time).slice(0, Math.max(1, Math.floor(limit)));
}

export function aggregateTradePath(trades, minimumQuote = 0, priceStep = .01, limit = 36, bucketMs = 750) {
  const threshold = Math.max(0, Number(minimumQuote) || 0);
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const duration = Math.max(100, Math.floor(Number(bucketMs) || 750));
  const clusters = new Map();
  const ordered = [...(trades ?? [])].filter((trade) => trade && Number.isFinite(trade.time)).sort((left, right) => left.time - right.time);
  for (const trade of ordered) {
    if (![trade.price, trade.quote, trade.quantity].every(Number.isFinite) || trade.quote <= 0) continue;
    const bucketTime = Math.floor(trade.time / duration) * duration;
    const price = Math.round(trade.price / step) * step;
    const key = `${bucketTime}:${price}`;
    const cluster = clusters.get(key) ?? {
      key,
      time: bucketTime,
      lastTime: trade.time,
      price,
      quote: 0,
      quantity: 0,
      buyQuote: 0,
      sellQuote: 0,
      count: 0,
      executions: [],
    };
    cluster.quote += trade.quote;
    cluster.quantity += trade.quantity;
    cluster[trade.side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    cluster.count += 1;
    cluster.lastTime = Math.max(cluster.lastTime, trade.time);
    cluster.executions.push(trade);
    clusters.set(key, cluster);
  }
  return [...clusters.values()]
    .filter((cluster) => cluster.quote >= threshold)
    .sort((left, right) => left.time - right.time || left.price - right.price)
    .slice(-Math.max(3, Math.floor(Number(limit) || 36)));
}

export function tradeTimeWindow(now, durationMs, offsetMs = 0) {
  const end = Number(now) - Math.max(0, Number(offsetMs) || 0);
  const duration = Math.max(5_000, Number(durationMs) || 60_000);
  return { start: end - duration, end, duration };
}

export function aggregateFootprintClusters(trades, minimumQuote = 0, priceStep = .01, bucketMs = 5_000) {
  const threshold = Math.max(0, Number(minimumQuote) || 0);
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const duration = Math.max(250, Math.floor(Number(bucketMs) || 5_000));
  const cells = new Map();
  for (const trade of trades ?? []) {
    if (![trade?.price, trade?.quote, trade?.time].every(Number.isFinite) || trade.quote <= 0) continue;
    const time = Math.floor(trade.time / duration) * duration;
    const price = Math.round(trade.price / step) * step;
    const key = `${time}:${price}`;
    const cell = cells.get(key) ?? { key, time, lastTime: trade.time, price, buyQuote: 0, sellQuote: 0, quote: 0, count: 0, executions: [] };
    cell[trade.side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    cell.quote += trade.quote;
    cell.count += 1;
    cell.lastTime = Math.max(cell.lastTime, trade.time);
    cell.executions.push(trade);
    cells.set(key, cell);
  }
  return [...cells.values()]
    .filter((cell) => cell.quote >= threshold)
    .sort((left, right) => left.time - right.time || right.price - left.price);
}

const MAX_TRADE_HISTORY = 20_000;

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
    this.snapshotTimer = null;
    this.tradeHistoryTimer = null;
    this.bids = new Map();
    this.asks = new Map();
    this.partialBidKeys = new Set();
    this.partialAskKeys = new Set();
    this.trades = [];
    this.lastUpdateId = null;
    this.cachedDepth = null;
  }

  select(symbol) {
    if (!symbol?.endsWith("USDT")) return;
    if (this.symbol && this.trades.length) tradeHistoryStore.set(this.symbol, this.trades).catch(() => {});
    this.symbol = symbol;
    this.bids.clear();
    this.asks.clear();
    this.partialBidKeys.clear();
    this.partialAskKeys.clear();
    this.trades = [];
    this.lastUpdateId = null;
    this.cachedDepth = null;
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.tradeHistoryTimer);
    const generation = ++this.generation;
    this.#start(generation);
    this.#loadDeepSnapshot(generation);
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
    for (const price of previousKeys) if (!nextKeys.has(price)) target.delete(price);
    return nextKeys;
  }

  #emit(eventTime = Date.now(), refreshDepth = false) {
    if (refreshDepth || !this.cachedDepth) this.cachedDepth = depthView(this.bids, this.asks, 1000);
    const view = this.cachedDepth;
    if (!view.bids.length || !view.asks.length) return;
    this.onData({
      symbol: this.symbol,
      ...view,
      trades: this.trades,
      lastUpdateId: this.lastUpdateId,
      eventTime,
    });
  }

  async #loadDeepSnapshot(generation) {
    if (typeof this.fetchImpl !== "function") return;
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
    for (const host of hosts) {
      try {
        const response = await this.fetchImpl(`https://${host}/fapi/v1/depth?symbol=${this.symbol}&limit=1000`, { cache: "no-store" });
        if (!response?.ok || generation !== this.generation) continue;
        const snapshot = await response.json();
        if (generation !== this.generation || !Array.isArray(snapshot?.bids) || !Array.isArray(snapshot?.asks)) return;
        this.bids = applyDepthUpdates(new Map(), snapshot.bids);
        this.asks = applyDepthUpdates(new Map(), snapshot.asks);
        this.lastUpdateId = Number(snapshot.lastUpdateId) || this.lastUpdateId;
        this.#emit(Date.now(), true);
        break;
      } catch {}
    }
    if (generation === this.generation) this.snapshotTimer = setTimeout(() => this.#loadDeepSnapshot(generation), 15_000);
  }

  #start(generation) {
    this.onStatus({ state: "loading", text: "Подключение" });
    this.#startDepth(generation);
    this.#startTrades(generation);
  }

  #startDepth(generation) {
    clearTimeout(this.depthReconnectTimer);
    clearTimeout(this.depthWatchdogTimer);
    this.depthSocket?.close();
    const rate = this.depthAttemptIndex % 4 === 3 ? "500ms" : "100ms";
    const depthStream = `${this.symbol.toLowerCase()}@depth20@${rate}`;
    const transports = [
      { url: `wss://fstream.binance.com/public/stream?streams=${depthStream}`, subscribe: false },
      { url: `wss://fstream.binance.com/public/ws/${depthStream}`, subscribe: false },
      { url: "wss://fstream.binance.com/public/stream", subscribe: true },
      { url: `wss://fstream.binance.com/public/stream?streams=${depthStream}`, subscribe: false },
    ];
    const transport = transports[this.depthAttemptIndex % transports.length];
    const socket = new this.WebSocketImpl(transport.url);
    this.depthSocket = socket;
    socket.addEventListener("open", () => {
      if (generation !== this.generation) return;
      if (transport.subscribe) socket.send(JSON.stringify({ method: "SUBSCRIBE", params: [depthStream], id: Date.now() % 2_147_483_647 }));
      this.onStatus({ state: "loading", text: "Синхронизация" });
      this.depthWatchdogTimer = setTimeout(() => socket.close(), 7000);
    });
    socket.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      let update;
      try { update = JSON.parse(event.data); } catch { return; }
      if (update.result === null || update.id) return;
      update = update.data ?? update;
      const bidRows = update?.b ?? update?.bids;
      const askRows = update?.a ?? update?.asks;
      if (!Array.isArray(bidRows) || !Array.isArray(askRows)) return;
      this.partialBidKeys = this.#replacePartialSide(this.bids, this.partialBidKeys, bidRows);
      this.partialAskKeys = this.#replacePartialSide(this.asks, this.partialAskKeys, askRows);
      this.lastUpdateId = Number(update.u) || this.lastUpdateId;
      clearTimeout(this.depthWatchdogTimer);
      this.#emit(Number(update.E) || Date.now(), true);
      this.depthAttemptIndex = 0;
      this.onStatus({ state: "online", text: rate === "500ms" ? "LIVE 500ms" : "LIVE 100ms" });
    });
    socket.addEventListener("close", () => {
      if (generation !== this.generation) return;
      clearTimeout(this.depthWatchdogTimer);
      this.depthAttemptIndex += 1;
      this.onStatus({ state: "offline", text: "Переподключение" });
      this.depthReconnectTimer = setTimeout(() => this.#startDepth(generation), 450);
    });
    socket.addEventListener("error", () => this.onStatus({ state: "offline", text: "Ошибка стакана" }));
  }

  #startTrades(generation) {
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.tradeWatchdogTimer);
    this.tradeSocket?.close();
    const tradeStream = `${this.symbol.toLowerCase()}@aggTrade`;
    const transports = [
      { url: `wss://fstream.binance.com/market/stream?streams=${tradeStream}`, subscribe: false },
      { url: `wss://fstream.binance.com/market/ws/${tradeStream}`, subscribe: false },
      { url: "wss://fstream.binance.com/market/stream", subscribe: true },
    ];
    const transport = transports[this.tradeAttemptIndex % transports.length];
    const socket = new this.WebSocketImpl(transport.url);
    this.tradeSocket = socket;
    socket.addEventListener("open", () => {
      if (generation !== this.generation) return;
      if (transport.subscribe) socket.send(JSON.stringify({ method: "SUBSCRIBE", params: [tradeStream], id: Date.now() % 2_147_483_647 }));
      this.tradeWatchdogTimer = setTimeout(() => socket.close(), 7000);
    });
    socket.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      let update;
      try { update = JSON.parse(event.data); } catch { return; }
      if (update.result === null || update.id) return;
      update = update.data ?? update;
      const trade = normalizeMarketTrade(update);
      if (!trade) return;
      clearTimeout(this.tradeWatchdogTimer);
      this.tradeAttemptIndex = 0;
      this.trades.unshift(trade);
      if (this.trades.length > MAX_TRADE_HISTORY) this.trades.length = MAX_TRADE_HISTORY;
      this.#scheduleTradeHistorySave();
      this.#emit(trade.time);
    });
    socket.addEventListener("close", () => {
      if (generation !== this.generation) return;
      clearTimeout(this.tradeWatchdogTimer);
      this.tradeAttemptIndex += 1;
      this.tradeReconnectTimer = setTimeout(() => this.#startTrades(generation), 450);
    });
    socket.addEventListener("error", () => {});
  }

  destroy() {
    if (this.symbol && this.trades.length) tradeHistoryStore.set(this.symbol, this.trades).catch(() => {});
    this.generation += 1;
    clearTimeout(this.depthReconnectTimer);
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.depthWatchdogTimer);
    clearTimeout(this.tradeWatchdogTimer);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.tradeHistoryTimer);
    this.depthSocket?.close();
    this.tradeSocket?.close();
    this.depthSocket = null;
    this.tradeSocket = null;
  }
}
