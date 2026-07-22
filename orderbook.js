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

let latestTradeEventTime = 0;

export function normalizeMarketTrade(event) {
  const price = Number(event?.p);
  const quantity = Number(event?.q);
  const time = Number(event?.T ?? event?.E);
  if (![price, quantity, time].every(Number.isFinite)) return null;
  latestTradeEventTime = Math.max(latestTradeEventTime, time);
  return {
    id: Number(event?.a ?? event?.t) || `${time}-${price}-${quantity}`,
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

export const BOOK_SCALE_MULTIPLIERS = [1, 2, 5, 10, 20, 50, 100, 150, 200, 250, 300, 500];

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


function normalizeDepthLevels(levels, side) {
  return (levels ?? [])
    .map((row) => {
      const price = Number(row?.[0]);
      const quantity = Number(row?.[1]);
      return { price, quantity, quote: price * quantity };
    })
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.quantity) && row.quantity > 0)
    .sort((left, right) => side === "ask" ? left.price - right.price : right.price - left.price);
}

function aggregatedDepthRow(levels, side, displayPrice) {
  const quantity = levels.reduce((sum, level) => sum + level.quantity, 0);
  const quote = levels.reduce((sum, level) => sum + level.quote, 0);
  const maxLevel = levels.reduce((best, level) => level.quote > best.quote ? level : best, levels[0]);
  const prices = levels.map((level) => level.price);
  return {
    price: Number(displayPrice),
    bidQuote: side === "bid" ? quote : 0,
    askQuote: side === "ask" ? quote : 0,
    quantity,
    quote,
    isMarket: false,
    aggregated: levels.length > 1,
    levelCount: levels.length,
    rangeNear: side === "ask" ? Math.min(...prices) : Math.max(...prices),
    rangeFar: side === "ask" ? Math.max(...prices) : Math.min(...prices),
    maxLevelPrice: maxLevel.price,
    maxLevelQuote: maxLevel.quote,
  };
}

function aggregateDepthByStep(levels, side, priceStep) {
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const normalized = normalizeDepthLevels(levels, side);
  const buckets = new Map();

  for (const level of normalized) {
    const ratio = level.price / step;
    const bucketIndex = side === "ask"
      ? Math.ceil(ratio - 1e-9)
      : Math.floor(ratio + 1e-9);
    const bucketPrice = bucketIndex * step;
    const key = String(bucketIndex);
    const bucket = buckets.get(key) ?? { price: bucketPrice, levels: [] };
    bucket.levels.push(level);
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => aggregatedDepthRow(bucket.levels, side, bucket.price))
    .sort((left, right) => side === "ask" ? left.price - right.price : right.price - left.price);
}

function closestRowIndex(rows, targetPrice) {
  if (!rows.length) return 0;
  let bestIndex = 0;
  let bestDistance = Math.abs(Number(rows[0].price) - targetPrice);
  for (let index = 1; index < rows.length; index += 1) {
    const distance = Math.abs(Number(rows[index].price) - targetPrice);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

export function buildDepthLadder(bids, asks, marketPrice, viewCenter, priceStep, rowCount) {
  const count = Math.max(3, Math.floor(Number(rowCount) || 3));
  const market = Number(marketPrice);
  const center = Number.isFinite(Number(viewCenter)) ? Number(viewCenter) : market;
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  if (!Number.isFinite(market) || !Number.isFinite(center)) return [];

  const askRows = aggregateDepthByStep(asks, "ask", step).reverse();
  const bidRows = aggregateDepthByStep(bids, "bid", step);
  const marketRow = {
    price: market,
    bidQuote: 0,
    askQuote: 0,
    quantity: 0,
    quote: 0,
    isMarket: true,
    aggregated: false,
    levelCount: 0,
  };

  // Полная книга представлена как непрерывный список реальных уровней:
  // дальние asks → ближние asks → рынок → ближние bids → дальние bids.
  const allRows = [...askRows, marketRow, ...bidRows];
  if (allRows.length <= count) return allRows;

  // Обычное колесо меняет viewCenter в app.js. Здесь оно листает
  // реальные строки книги, а не пустую математическую ценовую сетку.
  const anchorIndex = closestRowIndex(allRows, center);
  const half = Math.floor(count / 2);
  const start = Math.max(0, Math.min(allRows.length - count, anchorIndex - half));
  return allRows.slice(start, start + count);
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
  const safeLimit = Math.max(3, Math.floor(Number(limit) || 36));
  const ordered = [...(trades ?? [])]
    .filter((trade) => trade
      && [trade.price, trade.quote, trade.quantity, trade.time].every(Number.isFinite)
      && trade.quote > 0
      && trade.quote >= threshold)
    .sort((left, right) => left.time - right.time || Number(left.id) - Number(right.id))
    .slice(-safeLimit);

  // Каждое событие потока отображается отдельно без временной агрегации.
  return ordered.map((trade) => ({
    key: `raw:${String(trade.id)}:${trade.time}:${trade.price}`,
    time: trade.time,
    lastTime: trade.time,
    price: trade.price,
    quote: trade.quote,
    quantity: trade.quantity,
    buyQuote: trade.side === "buy" ? trade.quote : 0,
    sellQuote: trade.side === "sell" ? trade.quote : 0,
    count: 1,
    executions: [trade],
  }));
}

export function tradeTimeWindow(now, durationMs, offsetMs = 0) {
  const requestedNow = Number(now);
  const liveAnchor = latestTradeEventTime > 0 ? latestTradeEventTime : requestedNow;
  const end = liveAnchor - Math.max(0, Number(offsetMs) || 0);
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
const SNAPSHOT_TIMEOUT_MS = 2_800;

function parseWebSocketPayload(raw) {
  let payload;
  try { payload = JSON.parse(raw); } catch { return null; }
  if (payload?.result === null || payload?.id) return null;
  return {
    stream: String(payload?.stream ?? ""),
    data: payload?.data ?? payload,
  };
}

function marketStreams(symbol, mode) {
  const name = String(symbol).toLowerCase();
  const depth = `${name}@${mode === "partial" ? "depth20" : "depth"}@100ms`;
  const trades = `${name}@aggTrade`;
  return { depth, trades, all: [depth, trades] };
}

function marketTransports(streams) {
  const joined = streams.join("/");
  return [
    {
      name: "combined",
      url: `wss://fstream.binance.com/stream?streams=${joined}`,
      subscribe: false,
    },
    {
      name: "subscribe",
      url: "wss://fstream.binance.com/ws",
      subscribe: true,
    },
  ];
}

async function fetchJsonWithTimeout(fetchImpl, url, timeoutMs = SNAPSHOT_TIMEOUT_MS) {
  let timer = null;
  let controller = null;
  try {
    controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    const request = fetchImpl(url, {
      cache: "no-store",
      ...(controller ? { signal: controller.signal } : {}),
    }).then(async (response) => {
      if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 0}`);
      return response.json();
    });
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

class TradeHistoryStore {
  constructor() {
    this.dbPromise = null;
  }

  #open() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      const request = indexedDB.open("inpuls-market-trades-v1", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("symbols")) {
          request.result.createObjectStore("symbols", { keyPath: "symbol" });
        }
      };
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
      transaction.objectStore("symbols").put({
        symbol,
        trades: trades.slice(0, MAX_TRADE_HISTORY),
        updatedAt: Date.now(),
      });
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

    this.socket = null;
    this.symbol = null;
    this.generation = 0;
    this.mode = "deep";
    this.transportIndex = 0;

    this.reconnectTimer = null;
    this.firstDepthTimer = null;
    this.snapshotTimer = null;
    this.tradeHistoryTimer = null;

    this.bids = new Map();
    this.asks = new Map();
    this.partialBidKeys = new Set();
    this.partialAskKeys = new Set();
    this.trades = [];
    this.tradeIds = new Set();

    this.lastUpdateId = null;
    this.depthBuffer = [];
    this.pendingSnapshot = null;
    this.depthReady = false;
    this.snapshotLoading = false;
    this.cachedDepth = null;
    this.resyncCount = 0;
  }

  select(symbol) {
    if (!symbol?.endsWith("USDT")) return;
    if (this.symbol && this.trades.length) {
      tradeHistoryStore.set(this.symbol, this.trades).catch(() => {});
    }

    this.symbol = symbol;
    this.mode = "deep";
    this.transportIndex = 0;
    this.#resetBook();
    this.trades = [];
    this.tradeIds.clear();

    clearTimeout(this.reconnectTimer);
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.tradeHistoryTimer);
    try { this.socket?.close(); } catch {}
    this.socket = null;

    const generation = ++this.generation;
    this.onStatus({ state: "loading", text: "Подключение" });
    this.#connect(generation);
    this.#loadTradeHistory(symbol, generation);
  }

  #resetBook() {
    this.bids.clear();
    this.asks.clear();
    this.partialBidKeys.clear();
    this.partialAskKeys.clear();
    this.lastUpdateId = null;
    this.depthBuffer = [];
    this.pendingSnapshot = null;
    this.depthReady = false;
    this.snapshotLoading = false;
    this.cachedDepth = null;
  }

  async #loadTradeHistory(symbol, generation) {
    const saved = await tradeHistoryStore.get(symbol);
    if (generation !== this.generation || symbol !== this.symbol || !saved.length) return;
    for (const trade of saved) this.#insertTrade(trade, false);
    this.#emit(Date.now());
  }

  #scheduleTradeHistorySave() {
    clearTimeout(this.tradeHistoryTimer);
    const symbol = this.symbol;
    this.tradeHistoryTimer = setTimeout(() => {
      if (symbol === this.symbol) {
        tradeHistoryStore.set(symbol, this.trades).catch(() => {});
      }
    }, 4_000);
  }

  #insertTrade(trade, newestFirst = true) {
    if (!trade) return false;
    const key = `${trade.id}:${trade.time}:${trade.price}:${trade.quantity}`;
    if (this.tradeIds.has(key)) return false;
    this.tradeIds.add(key);
    if (newestFirst) this.trades.unshift(trade);
    else this.trades.push(trade);
    if (this.trades.length > MAX_TRADE_HISTORY) {
      this.trades.length = MAX_TRADE_HISTORY;
      this.tradeIds = new Set(this.trades.map((item) => `${item.id}:${item.time}:${item.price}:${item.quantity}`));
    }
    return true;
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

  #emit(eventTime = Date.now(), refreshDepth = false) {
    if (refreshDepth || !this.cachedDepth) {
      this.cachedDepth = depthView(this.bids, this.asks, MAX_EMITTED_LEVELS_PER_SIDE);
    }
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

  #trimBook() {
    if (this.bids.size > MAX_BOOK_LEVELS_PER_SIDE) {
      const prices = [...this.bids.keys()].sort((a, b) => b - a);
      for (const price of prices.slice(MAX_BOOK_LEVELS_PER_SIDE)) this.bids.delete(price);
    }
    if (this.asks.size > MAX_BOOK_LEVELS_PER_SIDE) {
      const prices = [...this.asks.keys()].sort((a, b) => a - b);
      for (const price of prices.slice(MAX_BOOK_LEVELS_PER_SIDE)) this.asks.delete(price);
    }
  }

  #applyDepthEvent(update, firstEvent = false) {
    const decision = canApplyDepthEvent(this.lastUpdateId, update, firstEvent);
    if (decision.action === "ignore") return true;
    if (decision.action === "resync") {
      this.#resync("Разрыв последовательности");
      return false;
    }
    applyDepthUpdates(this.bids, update.b ?? update.bids);
    applyDepthUpdates(this.asks, update.a ?? update.asks);
    this.lastUpdateId = Number(update.u);
    this.#trimBook();
    return true;
  }

  #bufferDepth(update) {
    this.depthBuffer.push(update);
    if (this.depthBuffer.length > MAX_BUFFERED_DEPTH_EVENTS) {
      this.depthBuffer.splice(0, this.depthBuffer.length - MAX_BUFFERED_DEPTH_EVENTS);
      this.#resync("Переполнение буфера");
    }
  }

  #tryInstallSnapshot() {
    const snapshot = this.pendingSnapshot;
    if (!snapshot) return false;

    const snapshotId = Number(snapshot.lastUpdateId);
    const applicable = this.depthBuffer.filter((event) => Number(event?.u) > snapshotId);
    const bridgeIndex = applicable.findIndex(
      (event) => Number(event?.U) <= snapshotId + 1 && Number(event?.u) >= snapshotId + 1,
    );

    if (bridgeIndex < 0) {
      const firstU = Number(applicable[0]?.U);
      if (Number.isFinite(firstU) && firstU > snapshotId + 1) {
        this.pendingSnapshot = null;
        this.snapshotTimer = setTimeout(() => this.#loadSnapshot(this.generation), 250);
      }
      return false;
    }

    this.bids = applyDepthUpdates(new Map(), snapshot.bids);
    this.asks = applyDepthUpdates(new Map(), snapshot.asks);
    this.lastUpdateId = snapshotId;

    for (let index = bridgeIndex; index < applicable.length; index += 1) {
      if (!this.#applyDepthEvent(applicable[index], index === bridgeIndex)) return false;
    }

    this.depthBuffer = [];
    this.pendingSnapshot = null;
    this.depthReady = true;
    this.cachedDepth = null;
    this.#emit(Date.now(), true);
    this.onStatus({ state: "online", text: "LIVE 100ms · FULL" });
    return true;
  }

  async #loadSnapshot(generation) {
    if (
      generation !== this.generation
      || this.mode !== "deep"
      || this.snapshotLoading
      || typeof this.fetchImpl !== "function"
    ) return;

    this.snapshotLoading = true;
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
    const attempts = hosts.map(async (host) => {
      const candidate = await fetchJsonWithTimeout(
        this.fetchImpl,
        `https://${host}/fapi/v1/depth?symbol=${encodeURIComponent(this.symbol)}&limit=1000`,
      );
      if (
        !Array.isArray(candidate?.bids)
        || !Array.isArray(candidate?.asks)
        || !Number.isFinite(Number(candidate?.lastUpdateId))
      ) throw new Error("invalid snapshot");
      return candidate;
    });

    let snapshot = null;
    try {
      snapshot = await Promise.any(attempts);
    } catch {}
    this.snapshotLoading = false;

    if (generation !== this.generation || this.mode !== "deep") return;
    if (!snapshot) {
      this.#activatePartial(generation);
      return;
    }

    this.pendingSnapshot = snapshot;
    this.#tryInstallSnapshot();
  }

  #activatePartial(generation) {
    if (generation !== this.generation || this.mode === "partial") return;
    this.mode = "partial";
    this.transportIndex = 0;
    this.#resetBook();
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    this.onStatus({ state: "loading", text: "Резервный live-стакан" });
    try { this.socket?.close(); } catch {}
    this.socket = null;
    this.reconnectTimer = setTimeout(() => this.#connect(generation), 0);
  }

  #resync(text = "Пересинхронизация") {
    if (this.mode !== "deep") return;
    this.resyncCount += 1;
    this.#resetBook();
    this.onStatus({ state: "loading", text });
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => this.#loadSnapshot(this.generation), 250);
  }

  #connect(generation) {
    if (generation !== this.generation || !this.symbol) return;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.firstDepthTimer);

    const streams = marketStreams(this.symbol, this.mode);
    const transports = marketTransports(streams.all);
    const transport = transports[this.transportIndex % transports.length];

    let socket;
    try {
      socket = new this.WebSocketImpl(transport.url);
    } catch {
      this.transportIndex += 1;
      this.reconnectTimer = setTimeout(() => this.#connect(generation), 500);
      return;
    }
    this.socket = socket;

    this.firstDepthTimer = setTimeout(() => {
      if (generation === this.generation && socket === this.socket) {
        try { socket.close(); } catch {}
      }
    }, 8_000);

    socket.addEventListener("open", () => {
      if (generation !== this.generation || socket !== this.socket) return;
      if (transport.subscribe) {
        socket.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: streams.all,
          id: Date.now() % 2_147_483_647,
        }));
      }
      this.onStatus({
        state: "loading",
        text: this.mode === "deep" ? "Синхронизация книги" : "Подключаю резервный стакан",
      });
      if (this.mode === "deep") this.#loadSnapshot(generation);
    });

    socket.addEventListener("message", (event) => {
      if (generation !== this.generation || socket !== this.socket) return;
      const payload = parseWebSocketPayload(event.data);
      if (!payload) return;
      const update = payload.data;
      const stream = payload.stream.toLowerCase();

      const isTrade = update?.e === "aggTrade" || stream.endsWith("@aggtrade");
      if (isTrade) {
        const trade = normalizeMarketTrade(update);
        if (this.#insertTrade(trade, true)) {
          this.#scheduleTradeHistorySave();
          this.#emit(trade.time);
        }
        return;
      }

      const bidRows = update?.b ?? update?.bids;
      const askRows = update?.a ?? update?.asks;
      const isDepth = Array.isArray(bidRows) && Array.isArray(askRows);
      if (!isDepth) return;

      clearTimeout(this.firstDepthTimer);

      if (this.mode === "partial") {
        this.partialBidKeys = this.#replacePartialSide(this.bids, this.partialBidKeys, bidRows);
        this.partialAskKeys = this.#replacePartialSide(this.asks, this.partialAskKeys, askRows);
        this.lastUpdateId = Number(update.u ?? update.lastUpdateId) || this.lastUpdateId;
        this.depthReady = true;
        this.cachedDepth = null;
        this.#emit(Number(update.E) || Date.now(), true);
        this.onStatus({ state: "online", text: "LIVE 100ms · FULL VIEW · 20" });
        return;
      }

      if (!Number.isFinite(Number(update?.U)) || !Number.isFinite(Number(update?.u))) return;
      if (!this.depthReady) {
        this.#bufferDepth(update);
        if (!this.pendingSnapshot && !this.snapshotLoading) this.#loadSnapshot(generation);
        this.#tryInstallSnapshot();
        return;
      }

      if (!this.#applyDepthEvent(update)) return;
      this.cachedDepth = null;
      this.#emit(Number(update.E) || Date.now(), true);
      this.onStatus({ state: "online", text: "LIVE 100ms · FULL" });
    });

    socket.addEventListener("close", () => {
      if (generation !== this.generation || socket !== this.socket) return;
      clearTimeout(this.firstDepthTimer);
      this.socket = null;
      this.transportIndex += 1;
      this.#resetBook();
      this.onStatus({ state: "offline", text: "Переподключение стакана" });
      this.reconnectTimer = setTimeout(() => this.#connect(generation), 500);
    });

    socket.addEventListener("error", () => {
      if (generation !== this.generation || socket !== this.socket) return;
      try { socket.close(); } catch {}
    });
  }

  destroy() {
    if (this.symbol && this.trades.length) {
      tradeHistoryStore.set(this.symbol, this.trades).catch(() => {});
    }
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.tradeHistoryTimer);
    try { this.socket?.close(); } catch {}
    this.socket = null;
  }
}

const ORDERBOOK_RUNTIME_STYLE_ID = "inpuls-orderbook-runtime-v26";

function parseRuntimeNumber(text) {
  const normalized = String(text ?? "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^0-9.+-]/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function tradePriceFromRuntimeKey(key) {
  const value = String(key ?? "");
  if (!value.startsWith("raw:")) return null;
  const separator = value.lastIndexOf(":");
  return separator >= 0 ? parseRuntimeNumber(value.slice(separator + 1)) : null;
}

function installOrderBookStyles() {
  if (typeof document === "undefined" || document.getElementById(ORDERBOOK_RUNTIME_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = ORDERBOOK_RUNTIME_STYLE_ID;
  style.textContent = `
    .orderbook-card .trade-price-axis,
    .orderbook-card .trade-time-axis,
    .orderbook-card .trade-flow-grid,
    .orderbook-card .trade-flow-line,
    .orderbook-card .trade-flow-hint,
    .orderbook-card [data-trade-window],
    .orderbook-card [data-book-clusters] {
      display: none !important;
    }
    .orderbook-card .trade-flow-node {
      transition: none !important;
    }
    .orderbook-card .trade-flow-nodes {
      inset: 0 !important;
    }
  `;
  document.head.append(style);
}

function forceIndividualTrades(card) {
  const clusterButton = card.querySelector("[data-book-clusters]");
  if (clusterButton?.getAttribute("aria-pressed") === "true") clusterButton.click();
}

function alignTradeNodesToBook(card) {
  forceIndividualTrades(card);
  const flow = card.querySelector(".trade-flow");
  const rows = [...card.querySelectorAll(".orderbook-rows .book-ladder-row")];
  if (!flow || !rows.length) return;

  const flowRect = flow.getBoundingClientRect();
  if (flowRect.width <= 0 || flowRect.height <= 0) return;

  const levels = rows.map((row) => {
    const rect = row.getBoundingClientRect();
    return {
      price: parseRuntimeNumber(row.querySelector("strong")?.textContent),
      y: ((rect.top + rect.height / 2 - flowRect.top) / flowRect.height) * 100,
    };
  }).filter((row) => Number.isFinite(row.price));

  if (!levels.length) return;

  for (const node of card.querySelectorAll(".trade-flow-node[data-trade-path-key]")) {
    const price = tradePriceFromRuntimeKey(node.dataset.tradePathKey);
    if (!Number.isFinite(price)) continue;

    let closest = levels[0];
    let distance = Math.abs(price - closest.price);
    for (let index = 1; index < levels.length; index += 1) {
      const candidateDistance = Math.abs(price - levels[index].price);
      if (candidateDistance < distance) {
        closest = levels[index];
        distance = candidateDistance;
      }
    }
    node.style.setProperty("--y", `${Math.max(.5, Math.min(99.5, closest.y)).toFixed(3)}%`);

    const savedX = parseRuntimeNumber(node.dataset.inpulsRawX);
    const sourceX = Number.isFinite(savedX)
      ? savedX
      : parseRuntimeNumber(node.style.getPropertyValue("--x"));
    if (Number.isFinite(sourceX)) {
      node.dataset.inpulsRawX = String(sourceX);
      const expandedX = 2 + ((sourceX - 3) / 82) * 96;
      node.style.setProperty("--x", `${Math.max(1, Math.min(99, expandedX)).toFixed(3)}%`);
    }
  }
}

let orderBookAlignmentFrame = 0;

function scheduleOrderBookAlignment() {
  if (orderBookAlignmentFrame || typeof document === "undefined") return;
  orderBookAlignmentFrame = requestAnimationFrame(() => {
    orderBookAlignmentFrame = 0;
    document.querySelectorAll(".orderbook-card").forEach(alignTradeNodesToBook);
  });
}

function installOrderBookRuntime() {
  if (typeof document === "undefined") return;
  installOrderBookStyles();

  const observer = new MutationObserver(scheduleOrderBookAlignment);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", scheduleOrderBookAlignment, { passive: true });

  // Первое обычное движение колеса автоматически снимает фиксацию центра.
  // После этого штатный обработчик app.js листает реальные уровни книги.
  document.addEventListener("wheel", (event) => {
    if (event.ctrlKey || event.metaKey) return;
    const ladder = event.target.closest?.(".orderbook-card .orderbook-ladder");
    if (!ladder) return;
    const centerButton = ladder.closest(".orderbook-card")?.querySelector("[data-book-center]");
    if (centerButton?.classList.contains("is-active")) centerButton.click();
  }, { capture: true, passive: true });

  scheduleOrderBookAlignment();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installOrderBookRuntime, { once: true });
  } else {
    installOrderBookRuntime();
  }
}
