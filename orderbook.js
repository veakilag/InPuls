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

const AUTO_BOOK_MAX_MULTIPLIER = 50;

export function depthCoverageScaleIndex(baseTick, bids, asks, middlePrice, rowCount, coverage = .82) {
  const middle = Number(middlePrice);
  const tick = Math.max(Number.EPSILON, Number(baseTick) || .01);
  if (!Number.isFinite(middle)) return 0;

  const distances = [...(bids ?? []), ...(asks ?? [])]
    .map((row) => Math.abs(Number(row?.[0]) - middle))
    .filter((distance) => Number.isFinite(distance) && distance > 0)
    .sort((left, right) => left - right);
  if (!distances.length) return 0;

  const halfRows = Math.max(2, Math.floor((Number(rowCount) || 3) / 2));

  // AUTO должен показывать рабочую область около рынка, а не пытаться
  // упаковать 92% всей глубокой книги в один экран. Берём только ближайшие
  // несколько экранов реальных уровней; дальняя книга остаётся доступна
  // обычным скроллом и ручным масштабом до ×500.
  const localSampleSize = Math.min(
    distances.length,
    Math.max(24, halfRows * 3),
  );
  const localDistances = distances.slice(0, localSampleSize);
  const localCoverage = Math.max(.65, Math.min(.9, Number(coverage) || .82));
  const percentile = Math.max(
    0,
    Math.min(
      localDistances.length - 1,
      Math.floor((localDistances.length - 1) * localCoverage),
    ),
  );

  const requiredMultiplier = (localDistances[percentile] / halfRows) / tick;
  const requestedIndex = BOOK_SCALE_MULTIPLIERS.findIndex(
    (multiplier) => multiplier >= requiredMultiplier,
  );
  const maxAutoIndex = BOOK_SCALE_MULTIPLIERS.findIndex(
    (multiplier) => multiplier >= AUTO_BOOK_MAX_MULTIPLIER,
  );
  const safeRequested = requestedIndex < 0 ? maximumBookScaleIndex() : requestedIndex;
  return Math.min(safeRequested, maxAutoIndex < 0 ? maximumBookScaleIndex() : maxAutoIndex);
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

const depthAggregationCache = new WeakMap();

function cachedDepthAggregation(levels, side, priceStep) {
  if (!Array.isArray(levels)) return null;
  let entries = depthAggregationCache.get(levels);
  if (!entries) {
    entries = new Map();
    depthAggregationCache.set(levels, entries);
  }
  const key = `${side}:${Number(priceStep).toPrecision(14)}`;
  return { entries, key, value: entries.get(key) };
}

function aggregateDepthByStep(levels, side, priceStep) {
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const cached = cachedDepthAggregation(levels, side, step);
  if (cached?.value) return cached.value;

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

  const result = [...buckets.values()]
    .map((bucket) => aggregatedDepthRow(bucket.levels, side, bucket.price))
    .sort((left, right) => side === "ask" ? left.price - right.price : right.price - left.price);
  cached?.entries.set(cached.key, result);
  return result;
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
  const safeLimit = Math.max(3, Math.floor(Number(limit) || 36));
  const ordered = [...(trades ?? [])]
    .filter((trade) => trade
      && [trade.price, trade.quote, trade.quantity, trade.time].every(Number.isFinite)
      && trade.quote > 0)
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
  return { depth, all: [depth] };
}

function tradeStreamCandidates(symbol) {
  const name = String(symbol).toLowerCase();
  return [`${name}@aggTrade`];
}

function tradeTransports(stream) {
  return [
    { name: "raw-market", url: `wss://fstream.binance.com/market/ws/${stream}`, subscribe: false },
    { name: "combined-market", url: `wss://fstream.binance.com/market/stream?streams=${stream}`, subscribe: false },
    { name: "subscribe-market", url: "wss://fstream.binance.com/market/stream", subscribe: true },
  ];
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

class LegacyOrderBookFeed {
  constructor({ onData, onStatus, WebSocketImpl = globalThis.WebSocket, fetchImpl = globalThis.fetch } = {}) {
    this.onData = onData ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.WebSocketImpl = WebSocketImpl;
    this.fetchImpl = fetchImpl;

    this.socket = null;
    this.tradeSocket = null;
    this.symbol = null;
    this.generation = 0;
    this.mode = "deep";
    this.transportIndex = 0;
    this.tradeTransportIndex = 0;

    this.reconnectTimer = null;
    this.tradeReconnectTimer = null;
    this.firstDepthTimer = null;
    this.snapshotTimer = null;
    this.tradeHistoryTimer = null;
    this.tradeDispatchTimer = null;
    this.tradeDispatchBatch = [];

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
    this.tradeTransportIndex = 0;
    this.#resetBook();
    this.trades = [];
    this.tradeIds.clear();

    clearTimeout(this.reconnectTimer);
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.tradeHistoryTimer);
    clearTimeout(this.tradeDispatchTimer);
    this.tradeDispatchTimer = null;
    this.tradeDispatchBatch = [];
    this.#dispatchTapeData({ replace: true, trades: [] });
    try { this.socket?.close(); } catch {}
    try { this.tradeSocket?.close(); } catch {}
    this.socket = null;
    this.tradeSocket = null;

    const generation = ++this.generation;
    this.onStatus({ state: "loading", text: "Подключение" });
    this.#connect(generation);
    this.#connectTrades(generation);
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
    this.#publishTradeSnapshot();
  }

  #dispatchTapeData(payload) {
    if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
    globalThis.dispatchEvent(new CustomEvent("inpuls:tape-data", {
      detail: { symbol: this.symbol, ...payload },
    }));
  }

  #publishTradeSnapshot() {
    this.#dispatchTapeData({
      replace: true,
      trades: this.trades.slice(0, 5_000),
    });
  }

  #queueTradeDispatch(trade) {
    if (!trade) return;
    this.tradeDispatchBatch.push(trade);
    if (this.tradeDispatchTimer) return;
    this.tradeDispatchTimer = setTimeout(() => {
      this.tradeDispatchTimer = null;
      const trades = this.tradeDispatchBatch.splice(0);
      if (trades.length) this.#dispatchTapeData({ replace: false, trades });
    }, 16);
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
      trades: [],
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
          this.#queueTradeDispatch(trade);
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

  #connectTrades(generation) {
    if (generation !== this.generation || !this.symbol) return;
    clearTimeout(this.tradeReconnectTimer);

    const candidates = tradeStreamCandidates(this.symbol);
    const streamIndex = Math.floor(this.tradeTransportIndex / 3) % candidates.length;
    const stream = candidates[streamIndex];
    const transports = tradeTransports(stream);
    const transport = transports[this.tradeTransportIndex % transports.length];

    let socket;
    try {
      socket = new this.WebSocketImpl(transport.url);
    } catch {
      this.tradeTransportIndex += 1;
      this.tradeReconnectTimer = setTimeout(() => this.#connectTrades(generation), 500);
      return;
    }
    this.tradeSocket = socket;

    socket.addEventListener("open", () => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      if (transport.subscribe) {
        socket.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: [stream],
          id: Date.now() % 2_147_483_647,
        }));
      }
    });

    socket.addEventListener("message", (event) => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      const payload = parseWebSocketPayload(event.data);
      if (!payload) return;
      const update = payload.data;
      const eventType = String(update?.e ?? "").toLowerCase();
      if (eventType !== "aggtrade") return;

      const trade = normalizeMarketTrade(update);
      if (!this.#insertTrade(trade, true)) return;
      this.tradeTransportIndex = 0;
      this.#scheduleTradeHistorySave();
      this.#queueTradeDispatch(trade);
    });

    socket.addEventListener("close", () => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      this.tradeSocket = null;
      this.tradeTransportIndex += 1;
      this.tradeReconnectTimer = setTimeout(() => this.#connectTrades(generation), 500);
    });

    socket.addEventListener("error", () => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      try { socket.close(); } catch {}
    });
  }

  destroy() {
    if (this.symbol && this.trades.length) {
      tradeHistoryStore.set(this.symbol, this.trades).catch(() => {});
    }
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.tradeHistoryTimer);
    clearTimeout(this.tradeDispatchTimer);
    this.tradeDispatchTimer = null;
    this.tradeDispatchBatch = [];
    try { this.socket?.close(); } catch {}
    try { this.tradeSocket?.close(); } catch {}
    this.socket = null;
    this.tradeSocket = null;
  }
}


const ORDERBOOK_WORKER_URL = new URL("./orderbook-worker.js?v=26-6-tape-v2", import.meta.url);
const ORDERBOOK_WORKER_TAPE_EVENT = "inpuls:tape-data";

class OrderBookWorkerManager {
  constructor() {
    this.worker = null;
    this.failed = false;
    this.nextClientId = 1;
    this.clients = new Map();
    this.clientsBySymbol = new Map();
    this.lastDataBySymbol = new Map();
    this.lastStatusBySymbol = new Map();
    this.visibilityHandler = null;
    this.workerReady = false;
    this.startupTimer = 0;
    this.#start();
  }

  #start() {
    if (typeof Worker !== "function") {
      this.failed = true;
      return;
    }
    try {
      // Worker не использует import/export, поэтому classic-режим надёжнее
      // module Worker в Chromium/Yandex при работе через Service Worker.
      this.worker = new Worker(ORDERBOOK_WORKER_URL, {
        name: "inpuls-orderbook-worker-v26-6",
      });
      this.startupTimer = setTimeout(() => {
        if (!this.workerReady) this.#fail();
      }, 4_000);
      this.worker.addEventListener("message", (event) => this.#onMessage(event.data));
      this.worker.addEventListener("error", (event) => {
        console.error("InPuls orderbook Worker error", event?.message || event);
        this.#fail();
      });
      this.worker.addEventListener("messageerror", () => this.#fail());
      const visible = typeof document === "undefined" || !document.hidden;
      this.worker.postMessage({ type: "visibility", visible });
      if (typeof document !== "undefined") {
        this.visibilityHandler = () => {
          if (!this.worker || this.failed) return;
          this.worker.postMessage({ type: "visibility", visible: !document.hidden });
        };
        document.addEventListener("visibilitychange", this.visibilityHandler);
      }
    } catch {
      this.#fail();
    }
  }

  available() {
    return Boolean(this.worker) && !this.failed;
  }

  register(client) {
    const id = this.nextClientId++;
    this.clients.set(id, client);
    return id;
  }

  unregister(id, symbol) {
    this.clients.delete(id);
    if (!symbol) return;
    const group = this.clientsBySymbol.get(symbol);
    group?.delete(id);
    if (group?.size) return;
    this.clientsBySymbol.delete(symbol);
    this.lastDataBySymbol.delete(symbol);
    this.lastStatusBySymbol.delete(symbol);
    if (this.available()) this.worker.postMessage({ type: "unsubscribe", symbol });
  }

  select(id, previousSymbol, symbol) {
    if (!this.available()) return false;
    if (previousSymbol && previousSymbol !== symbol) {
      const previous = this.clientsBySymbol.get(previousSymbol);
      previous?.delete(id);
      if (previous && previous.size === 0) {
        this.clientsBySymbol.delete(previousSymbol);
        this.lastDataBySymbol.delete(previousSymbol);
        this.lastStatusBySymbol.delete(previousSymbol);
        this.worker.postMessage({ type: "unsubscribe", symbol: previousSymbol });
      }
    }

    let group = this.clientsBySymbol.get(symbol);
    const first = !group;
    if (!group) {
      group = new Set();
      this.clientsBySymbol.set(symbol, group);
    }
    group.add(id);

    const client = this.clients.get(id);
    const status = this.lastStatusBySymbol.get(symbol);
    const data = this.lastDataBySymbol.get(symbol);
    if (status) queueMicrotask(() => client?._receiveStatus(status));
    if (data) queueMicrotask(() => client?._receiveData(data));
    this.worker.postMessage({ type: first ? "subscribe" : "refresh", symbol });
    return true;
  }

  #onMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "ready") {
      this.workerReady = true;
      clearTimeout(this.startupTimer);
      this.startupTimer = 0;
      return;
    }
    if (message.type === "fatal") {
      this.#fail();
      return;
    }
    const symbol = String(message.symbol ?? "").toUpperCase();
    if (!symbol.endsWith("USDT")) return;

    if (message.type === "status") {
      const status = { state: message.state, text: message.text };
      this.lastStatusBySymbol.set(symbol, status);
      for (const id of this.clientsBySymbol.get(symbol) ?? []) {
        this.clients.get(id)?._receiveStatus(status);
      }
      return;
    }

    if (message.type === "data") {
      const data = message.data;
      if (!data) return;
      this.lastDataBySymbol.set(symbol, data);
      for (const id of this.clientsBySymbol.get(symbol) ?? []) {
        this.clients.get(id)?._receiveData(data);
      }
      return;
    }

    if (message.type === "tape"
      && typeof globalThis.dispatchEvent === "function"
      && typeof globalThis.CustomEvent === "function") {
      globalThis.dispatchEvent(new CustomEvent(ORDERBOOK_WORKER_TAPE_EVENT, {
        detail: {
          symbol,
          replace: Boolean(message.replace),
          trades: Array.isArray(message.trades) ? message.trades : [],
        },
      }));
    }
  }

  #fail() {
    if (this.failed) return;
    this.failed = true;
    clearTimeout(this.startupTimer);
    this.startupTimer = 0;
    this.workerReady = false;
    if (typeof document !== "undefined" && this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    try { this.worker?.terminate(); } catch {}
    this.worker = null;
    const clients = [...this.clients.values()];
    this.clientsBySymbol.clear();
    this.lastDataBySymbol.clear();
    this.lastStatusBySymbol.clear();
    for (const client of clients) client._activateFallback();
  }
}

const orderBookWorkerManager = new OrderBookWorkerManager();

export class OrderBookFeed {
  constructor(options = {}) {
    this.options = options;
    this.onData = options.onData ?? (() => {});
    this.onStatus = options.onStatus ?? (() => {});
    this.symbol = null;
    this.destroyed = false;
    this.fallback = null;
    this.clientId = orderBookWorkerManager.register(this);
    if (!orderBookWorkerManager.available()) this._activateFallback();
  }

  select(symbol) {
    if (this.destroyed || !symbol?.endsWith("USDT")) return;
    const previous = this.symbol;
    this.symbol = symbol;
    if (this.fallback) {
      this.fallback.select(symbol);
      return;
    }
    if (!orderBookWorkerManager.select(this.clientId, previous, symbol)) {
      this._activateFallback();
    }
  }

  _receiveData(data) {
    if (!this.destroyed && data?.symbol === this.symbol) this.onData(data);
  }

  _receiveStatus(status) {
    if (!this.destroyed) this.onStatus(status);
  }

  _activateFallback() {
    if (this.destroyed || this.fallback) return;
    this.fallback = new LegacyOrderBookFeed(this.options);
    this.onStatus({ state: "loading", text: "Совместимый режим" });
    if (this.symbol) this.fallback.select(this.symbol);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    orderBookWorkerManager.unregister(this.clientId, this.symbol);
    this.fallback?.destroy();
    this.fallback = null;
  }
}

const ORDERBOOK_RUNTIME_STYLE_ID = "inpuls-orderbook-runtime-v26-6-tape-v2";
const TAPE_EVENT_NAME = "inpuls:tape-data";
const TAPE_MAX_STORED = 4_000;
const TAPE_MAX_RAW_VISIBLE = 2_000;
const TAPE_MAX_AGG_VISIBLE = 1_200;
const TAPE_SECOND_MS = 1_000;
const TAPE_MIN_SECOND_WIDTH = 22;
const TAPE_MIN_SECONDS = 12;
const TAPE_MAX_SECONDS = 45;
const TAPE_MODE_KEY = "inpuls-tape-mode-v1";
const TAPE_MIN_FILTER_KEY = "inpuls-tape-min-filter-v2";
const TAPE_MAX_FILTER_KEY = "inpuls-tape-max-filter-v1";

const tapeTradesBySymbol = new Map();
const tapeCardStates = new WeakMap();
let tapeDrawFrame = 0;
let tapeDrawTimer = 0;
let tapeLastDrawAt = 0;
let tapeNeedsDraw = true;
let tapeDocumentHidden = typeof document !== "undefined" ? document.hidden : false;
let tapeRecentRate = 0;

function parseRuntimeNumber(text) {
  const normalized = String(text ?? "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^0-9.+-]/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function clampTape(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function formatTapeUsd(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(amount >= 100_000 ? 0 : 1)}K`;
  return amount >= 100 ? Math.round(amount).toString() : amount.toFixed(amount >= 10 ? 0 : 1);
}

function cardSymbol(card) {
  const title = String(card.querySelector("[data-book-ticker]")?.textContent ?? card.querySelector("h2")?.textContent ?? "");
  const pair = title.split("·")[0].trim().replace("/", "").toUpperCase();
  return pair.endsWith("USDT") ? pair : null;
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
    .orderbook-card .trade-flow-nodes,
    .orderbook-card [data-trade-window],
    .orderbook-card [data-trade-live],
    .orderbook-card [data-book-clusters],
    .orderbook-card .inpuls-native-min-filter {
      display: none !important;
    }
    .orderbook-card .trade-flow {
      position: relative !important;
      overflow: hidden !important;
      contain: layout paint style;
    }
    .orderbook-card .inpuls-tape-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2;
    }
    .orderbook-card .trade-tape-toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .orderbook-card .inpuls-tape-controls {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      width: 100%;
    }
    .orderbook-card .inpuls-tape-filter {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      min-width: 0;
      padding: 0 4px;
      border: 1px solid rgba(108, 137, 150, .28);
      border-radius: 4px;
      background: rgba(10, 15, 20, .75);
      color: #78909c;
      font-size: 9px;
      line-height: 20px;
      height: 22px;
      box-sizing: border-box;
    }
    .orderbook-card .inpuls-tape-filter input {
      width: 58px;
      min-width: 36px;
      padding: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: #d7e4ea;
      font: 700 10px/20px Inter, system-ui, sans-serif;
    }
    .orderbook-card .inpuls-tape-mode {
      margin-left: auto;
      min-width: 42px;
      height: 22px;
      padding-inline: 7px;
      font-weight: 800;
      letter-spacing: .03em;
    }
    .orderbook-card .inpuls-tape-mode.is-active {
      color: #42e1ad;
      border-color: rgba(66, 225, 173, .48);
      background: rgba(66, 225, 173, .09);
    }
  `;
  document.head.append(style);
}

function syncTapeModeButton(button, state) {
  const aggregated = state.mode === "agg";
  button.textContent = aggregated ? "AGG" : "RAW";
  button.classList.toggle("is-active", aggregated);
  button.setAttribute("aria-pressed", String(aggregated));
  button.title = aggregated
    ? "Агрегация включена: сделки одной секунды и ценовой строки объединяются"
    : "Без агрегации: каждое исполнение отображается отдельно внутри своей секунды";
}

function ensureTapeUi(card) {
  const flow = card.querySelector(".trade-flow");
  const toolbar = card.querySelector(".trade-tape-toolbar");
  if (!flow || !toolbar) return null;

  let state = tapeCardStates.get(card);
  if (!state) {
    const nativeMinimum = Math.max(0, Number(toolbar.querySelector("[data-trade-min]")?.value) || 0);
    const savedMinimum = localStorage.getItem(TAPE_MIN_FILTER_KEY);
    state = {
      canvas: null,
      context: null,
      mode: localStorage.getItem(TAPE_MODE_KEY) === "raw" ? "raw" : "agg",
      minQuote: savedMinimum === null ? nativeMinimum : Math.max(0, Number(savedMinimum) || 0),
      maxQuote: Math.max(0, Number(localStorage.getItem(TAPE_MAX_FILTER_KEY)) || 0),
      controls: null,
      rowObserver: null,
      resizeObserver: null,
    };
    tapeCardStates.set(card, state);
  }

  if (!state.canvas?.isConnected) {
    const canvas = document.createElement("canvas");
    canvas.className = "inpuls-tape-canvas";
    canvas.setAttribute("aria-label", "Лента рыночных сделок");
    flow.append(canvas);
    state.canvas = canvas;
    state.context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  }

  const nativeMinimum = toolbar.querySelector("[data-trade-min]");
  nativeMinimum?.closest("label")?.classList.add("inpuls-native-min-filter");

  if (!state.controls?.isConnected) {
    const controls = document.createElement("div");
    controls.className = "inpuls-tape-controls";
    controls.innerHTML = `
      <label class="inpuls-tape-filter" title="Показывать сделки или агрегаты не меньше суммы">
        <span>ОТ $</span><input data-inpuls-trade-min type="number" min="0" step="100" value="${state.minQuote}" aria-label="Минимальный размер сделки или агрегата" />
      </label>
      <label class="inpuls-tape-filter" title="Скрывать сделки или агрегаты больше суммы; 0 — без ограничения">
        <span>ДО $</span><input data-inpuls-trade-max type="number" min="0" step="1000" value="${state.maxQuote}" aria-label="Максимальный размер сделки или агрегата" />
      </label>
      <button data-inpuls-tape-mode class="inpuls-tape-mode" type="button"></button>`;
    toolbar.append(controls);
    state.controls = controls;

    const minInput = controls.querySelector("[data-inpuls-trade-min]");
    const maxInput = controls.querySelector("[data-inpuls-trade-max]");
    const modeButton = controls.querySelector("[data-inpuls-tape-mode]");

    const applyMinimum = () => {
      state.minQuote = Math.max(0, Number(minInput.value) || 0);
      localStorage.setItem(TAPE_MIN_FILTER_KEY, String(state.minQuote));
      scheduleTapeDraw(true);
    };
    const applyMaximum = () => {
      state.maxQuote = Math.max(0, Number(maxInput.value) || 0);
      localStorage.setItem(TAPE_MAX_FILTER_KEY, String(state.maxQuote));
      scheduleTapeDraw(true);
    };
    minInput.addEventListener("input", applyMinimum);
    minInput.addEventListener("change", applyMinimum);
    maxInput.addEventListener("input", applyMaximum);
    maxInput.addEventListener("change", applyMaximum);
    modeButton.addEventListener("click", () => {
      state.mode = state.mode === "agg" ? "raw" : "agg";
      localStorage.setItem(TAPE_MODE_KEY, state.mode);
      syncTapeModeButton(modeButton, state);
      scheduleTapeDraw(true);
    });
    syncTapeModeButton(modeButton, state);
  } else {
    syncTapeModeButton(state.controls.querySelector("[data-inpuls-tape-mode]"), state);
  }

  if (!state.rowObserver) {
    const rows = card.querySelector(".orderbook-rows");
    if (rows) {
      state.rowObserver = new MutationObserver(() => scheduleTapeDraw());
      state.rowObserver.observe(rows, { childList: true, subtree: true, characterData: true });
    }
  }

  if (!state.resizeObserver && typeof ResizeObserver === "function") {
    state.resizeObserver = new ResizeObserver(() => scheduleTapeDraw(true));
    state.resizeObserver.observe(flow);
  }

  return state;
}

function visibleBookRows(card, flow) {
  const flowRect = flow.getBoundingClientRect();
  if (flowRect.width <= 0 || flowRect.height <= 0) return [];
  return [...card.querySelectorAll(".orderbook-rows .book-ladder-row")]
    .map((row, index) => {
      const price = parseRuntimeNumber(row.querySelector("strong")?.textContent);
      const rect = row.getBoundingClientRect();
      return {
        index,
        price,
        y: rect.top + rect.height / 2 - flowRect.top,
        height: rect.height,
      };
    })
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.y));
}

function nearestVisibleRow(rows, price) {
  if (!rows.length || !Number.isFinite(price)) return null;
  let best = rows[0];
  let distance = Math.abs(price - best.price);
  for (let index = 1; index < rows.length; index += 1) {
    const nextDistance = Math.abs(price - rows[index].price);
    if (nextDistance < distance) {
      best = rows[index];
      distance = nextDistance;
    }
  }

  const prices = rows.map((row) => row.price);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const sorted = [...new Set(prices)].sort((a, b) => a - b);
  let tolerance = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap > 0 && (!tolerance || gap < tolerance)) tolerance = gap;
  }
  tolerance = Math.max(Number.EPSILON, tolerance || Math.abs(high - low) / Math.max(1, rows.length - 1)) * .65;
  if (price > high + tolerance || price < low - tolerance) return null;
  return best;
}

function buildSecondWindow(width, latestTime) {
  const secondCount = clampTape(Math.floor(width / TAPE_MIN_SECOND_WIDTH), TAPE_MIN_SECONDS, TAPE_MAX_SECONDS);
  const latestSecond = Math.floor(Number(latestTime) / TAPE_SECOND_MS);
  const firstSecond = latestSecond - secondCount + 1;
  return {
    secondCount,
    latestSecond,
    firstSecond,
    columnWidth: width / secondCount,
    startTime: firstSecond * TAPE_SECOND_MS,
    endTime: (latestSecond + 1) * TAPE_SECOND_MS,
  };
}

function aggregateTapeItemsBySecond(trades, rows, window) {
  const buckets = new Map();
  for (const trade of trades) {
    const second = Math.floor(trade.time / TAPE_SECOND_MS);
    if (second < window.firstSecond || second > window.latestSecond) continue;
    const row = nearestVisibleRow(rows, trade.price);
    if (!row) continue;
    const key = `${second}:${row.index}`;
    const item = buckets.get(key) ?? {
      second,
      time: trade.time,
      price: trade.price,
      row,
      quote: 0,
      buyQuote: 0,
      sellQuote: 0,
      count: 0,
    };
    item.time = Math.max(item.time, trade.time);
    item.price = trade.price;
    item.quote += trade.quote;
    item[trade.side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    item.count += 1;
    buckets.set(key, item);
  }
  return [...buckets.values()]
    .sort((left, right) => left.second - right.second || left.row.index - right.row.index)
    .slice(-TAPE_MAX_AGG_VISIBLE);
}

function rawTapeItemsBySecond(trades, rows, window) {
  const groups = new Map();
  const selected = trades.slice(0, TAPE_MAX_RAW_VISIBLE).reverse();
  for (const trade of selected) {
    const second = Math.floor(trade.time / TAPE_SECOND_MS);
    if (second < window.firstSecond || second > window.latestSecond) continue;
    const row = nearestVisibleRow(rows, trade.price);
    if (!row) continue;
    const group = groups.get(second) ?? [];
    group.push({
      second,
      time: trade.time,
      price: trade.price,
      row,
      quote: trade.quote,
      buyQuote: trade.side === "buy" ? trade.quote : 0,
      sellQuote: trade.side === "sell" ? trade.quote : 0,
      count: 1,
    });
    groups.set(second, group);
  }

  const items = [];
  for (const group of groups.values()) {
    group.sort((left, right) => left.time - right.time || left.price - right.price);
    const slotCount = group.length;
    group.forEach((item, slotIndex) => items.push({ ...item, slotIndex, slotCount }));
  }
  return items;
}

function passesTapeFilter(item, minimum, maximum) {
  const quote = Number(item?.quote);
  return Number.isFinite(quote)
    && quote >= minimum
    && (!maximum || quote <= maximum);
}

function roundedRectPath(context, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawSecondColumns(context, rect, window) {
  context.save();
  context.lineWidth = 1;
  for (let index = 1; index < window.secondCount; index += 1) {
    const x = Math.round(index * window.columnWidth) + .5;
    context.strokeStyle = index % 5 === 0 ? "rgba(117, 145, 157, .075)" : "rgba(117, 145, 157, .035)";
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, rect.height);
    context.stroke();
  }
  context.restore();
}

function drawTapeCard(card) {
  const state = ensureTapeUi(card);
  const flow = card.querySelector(".trade-flow");
  const canvas = state?.canvas;
  const context = state?.context;
  if (!state || !flow || !canvas || !context || tapeDocumentHidden) return;

  const rect = flow.getBoundingClientRect();
  if (rect.width <= 2 || rect.height <= 2) return;
  const dpr = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
  const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const symbol = cardSymbol(card);
  const stored = symbol ? tapeTradesBySymbol.get(symbol) : null;
  if (!stored?.length) return;

  const rows = visibleBookRows(card, flow);
  if (!rows.length) return;

  const latestTime = Number(stored[0]?.time) || Date.now();
  const window = buildSecondWindow(rect.width, latestTime);
  drawSecondColumns(context, rect, window);

  const recent = stored.filter((trade) => trade.time >= window.startTime && trade.time < window.endTime);
  if (!recent.length) return;

  const minQuote = Math.max(0, Number(state.minQuote) || 0);
  const maxQuote = Math.max(0, Number(state.maxQuote) || 0);
  let items;
  if (state.mode === "agg") {
    // В AGG фильтр применяется к итоговой сумме секундного агрегата.
    items = aggregateTapeItemsBySecond(recent, rows, window)
      .filter((item) => passesTapeFilter(item, minQuote, maxQuote));
  } else {
    // В RAW фильтр применяется к каждому отдельному исполнению.
    const filteredTrades = recent.filter((trade) => passesTapeFilter(trade, minQuote, maxQuote));
    items = rawTapeItemsBySecond(filteredTrades, rows, window);
  }
  if (!items.length) return;

  const quotes = items.map((item) => item.quote).sort((a, b) => a - b);
  const p90 = Math.max(1, quotes[Math.floor((quotes.length - 1) * .9)] || 1);
  const p75 = Math.max(1, quotes[Math.floor((quotes.length - 1) * .75)] || 1);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "700 8px Inter, system-ui, sans-serif";

  for (const item of items) {
    const columnIndex = item.second - window.firstSecond;
    if (columnIndex < 0 || columnIndex >= window.secondCount) continue;
    const columnLeft = columnIndex * window.columnWidth;
    const columnRight = columnLeft + window.columnWidth;
    const columnCenter = columnLeft + window.columnWidth / 2;
    const y = item.row.y;
    const buy = item.buyQuote >= item.sellQuote;
    const fill = buy ? "rgba(50, 205, 151, .52)" : "rgba(238, 91, 108, .52)";
    const stroke = buy ? "rgba(88, 239, 184, .84)" : "rgba(255, 121, 137, .84)";

    if (state.mode === "raw") {
      const slots = Math.max(1, item.slotCount || 1);
      const slot = Math.max(0, item.slotIndex || 0);
      const x = columnLeft + ((slot + .5) / slots) * window.columnWidth;
      const width = clampTape((window.columnWidth / slots) * .82, 1.1, 5.5);
      const height = clampTape(Math.sqrt(item.quote / p90) * 5 + 1.5, 1.5, 7);
      roundedRectPath(context, x - width / 2, y - height / 2, width, height, Math.min(2, width / 2));
      context.fillStyle = fill;
      context.fill();
      continue;
    }

    const maxWidth = Math.max(2, window.columnWidth - 2);
    const strength = Math.min(1.35, Math.sqrt(item.quote / p90));
    const height = clampTape(7 + strength * 8 + (item.count > 1 ? 1 : 0), 8, 18);
    const label = formatTapeUsd(item.quote);
    const measured = context.measureText(label).width;
    const width = clampTape(measured + 7, Math.min(height, maxWidth), maxWidth);
    const x = clampTape(columnCenter, columnLeft + width / 2 + .5, columnRight - width / 2 - .5);

    roundedRectPath(context, x - width / 2, y - height / 2, width, height, Math.min(5, height / 2));
    context.fillStyle = fill;
    context.fill();
    context.lineWidth = item.count > 1 ? 1.1 : .7;
    context.strokeStyle = stroke;
    context.stroke();

    if (item.quote >= p75 && measured + 4 <= width) {
      context.fillStyle = "rgba(235, 247, 244, .96)";
      context.fillText(label, x, y + .2);
    }
  }
}

function drawAllTapes() {
  if (tapeDocumentHidden) return;
  document.querySelectorAll(".orderbook-card").forEach(drawTapeCard);
  tapeNeedsDraw = false;
}

function cancelTapeDraw() {
  if (tapeDrawFrame) cancelAnimationFrame(tapeDrawFrame);
  if (tapeDrawTimer) clearTimeout(tapeDrawTimer);
  tapeDrawFrame = 0;
  tapeDrawTimer = 0;
}

function targetTapeFrameMs() {
  if (tapeRecentRate > 500) return 120;
  if (tapeRecentRate > 200) return 85;
  return 50;
}

function scheduleTapeDraw(force = false) {
  if (typeof document === "undefined") return;
  tapeNeedsDraw = true;
  if (tapeDocumentHidden) return;
  if (force) {
    cancelTapeDraw();
    tapeLastDrawAt = 0;
  }
  if (tapeDrawFrame || tapeDrawTimer) return;
  const frameMs = targetTapeFrameMs();
  const elapsed = performance.now() - tapeLastDrawAt;
  if (elapsed < frameMs) {
    tapeDrawTimer = setTimeout(() => {
      tapeDrawTimer = 0;
      scheduleTapeDraw();
    }, Math.max(1, frameMs - elapsed));
    return;
  }
  tapeDrawFrame = requestAnimationFrame(() => {
    tapeDrawFrame = 0;
    tapeLastDrawAt = performance.now();
    if (tapeNeedsDraw) drawAllTapes();
  });
}

function acceptTapeData(event) {
  const detail = event?.detail;
  const symbol = String(detail?.symbol ?? "").toUpperCase();
  if (!symbol.endsWith("USDT")) return;
  const incoming = Array.isArray(detail?.trades)
    ? detail.trades.filter((trade) => trade && Number.isFinite(Number(trade.time)))
    : [];

  if (detail.replace) {
    tapeTradesBySymbol.set(symbol, incoming.slice(0, TAPE_MAX_STORED));
  } else if (incoming.length) {
    const current = tapeTradesBySymbol.get(symbol) ?? [];
    tapeTradesBySymbol.set(symbol, [...incoming].reverse().concat(current).slice(0, TAPE_MAX_STORED));
  }

  const now = incoming.length ? Math.max(...incoming.map((trade) => Number(trade.time) || 0)) : Date.now();
  const stored = tapeTradesBySymbol.get(symbol) ?? [];
  tapeRecentRate = stored.reduce((count, trade) => count + (trade.time >= now - 1_000 ? 1 : 0), 0);
  scheduleTapeDraw();
}

function bindTapeCard(card) {
  ensureTapeUi(card);
  scheduleTapeDraw(true);
}

function scanTapeCards(root = document) {
  if (root instanceof Element && root.matches(".orderbook-card")) bindTapeCard(root);
  root.querySelectorAll?.(".orderbook-card").forEach(bindTapeCard);
}

function installOrderBookRuntime() {
  if (typeof document === "undefined") return;
  installOrderBookStyles();
  globalThis.addEventListener(TAPE_EVENT_NAME, acceptTapeData);
  scanTapeCards(document);

  const discoveryObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) scanTapeCards(node);
      }
    }
  });
  discoveryObserver.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("resize", () => scheduleTapeDraw(true), { passive: true });
  document.addEventListener("visibilitychange", () => {
    tapeDocumentHidden = document.hidden;
    if (tapeDocumentHidden) {
      cancelTapeDraw();
      tapeNeedsDraw = true;
      return;
    }
    // Не догоняем пропущенные кадры: рисуем один актуальный снимок.
    scheduleTapeDraw(true);
  });

  document.addEventListener("wheel", (event) => {
    const card = event.target.closest?.(".orderbook-card");
    if (!card) return;
    if (!event.ctrlKey && !event.metaKey) {
      const ladder = event.target.closest?.(".orderbook-ladder");
      const centerButton = card.querySelector("[data-book-center]");
      if (ladder && centerButton?.classList.contains("is-active")) centerButton.click();
    }
    setTimeout(() => scheduleTapeDraw(true), 0);
  }, { capture: true, passive: true });

  scheduleTapeDraw(true);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installOrderBookRuntime, { once: true });
  } else {
    installOrderBookRuntime();
  }
}
