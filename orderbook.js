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

export const BOOK_SCALE_MULTIPLIERS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

export function inferPriceTick(bids, asks, middlePrice) {
  const prices = [...(bids ?? []), ...(asks ?? [])]
    .slice(0, 240)
    .map((row) => Number(row?.[0]))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  const middle = Math.abs(Number(middlePrice));
  const noiseFloor = Math.max(Number.EPSILON * Math.max(1, middle) * 16, 1e-15);
  const differences = [];
  for (let index = 1; index < prices.length; index += 1) {
    const difference = prices[index] - prices[index - 1];
    if (difference > noiseFloor) differences.push(difference);
  }

  const raw = differences.length ? Math.min(...differences) : (
    Number.isFinite(middle) && middle > 0
      ? 10 ** Math.floor(Math.log10(middle) - 5)
      : .01
  );

  // Убираем плавающий двоичный хвост и приводим тик к биржевой
  // последовательности 1 / 2 / 5 × 10^n.
  const exponent = Math.floor(Math.log10(Math.max(Number.EPSILON, raw)));
  const power = 10 ** exponent;
  const ratio = raw / power;
  const normalizedRatio = [1, 2, 5, 10].reduce(
    (best, candidate) => Math.abs(candidate - ratio) < Math.abs(best - ratio) ? candidate : best,
    1,
  );
  return Number((normalizedRatio * power).toPrecision(15));
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

export function adaptiveBookScaleIndex(baseTick, currentIndex) {
  // v26.17: импульс больше не меняет выбранный пользователем шаг цены.
  return Math.max(
    0,
    Math.min(maximumBookScaleIndex(), Math.round(Number(currentIndex) || 0)),
  );
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
  // обычным скроллом и ручным шагом цены до ×1000.
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

export function recoverBookScaleIndex(userIndex) {
  return Math.max(
    0,
    Math.min(maximumBookScaleIndex(), Math.round(Number(userIndex) || 0)),
  );
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

  const askBuckets = new Map(
    aggregateDepthByStep(asks, "ask", step).map((row) => [
      Math.round(Number(row.price) / step),
      row,
    ]),
  );
  const bidBuckets = new Map(
    aggregateDepthByStep(bids, "bid", step).map((row) => [
      Math.round(Number(row.price) / step),
      row,
    ]),
  );

  // Сетка всегда привязана к абсолютному нулю шага, а не к плавающему
  // midPrice. Поэтому ×5 действительно даёт ...580, ...575, ...570...
  const anchorIndex = Math.round(center / step);
  const marketIndex = Math.round(market / step);
  const half = Math.floor(count / 2);
  const topIndex = anchorIndex + half;

  const majorUnit = 10 ** Math.ceil(Math.log10(step * 20));
  const halfUnit = majorUnit / 2;
  const normalizeGridPrice = (index) => Number((index * step).toPrecision(15));
  const isMultiple = (price, unit) => {
    if (!Number.isFinite(unit) || unit <= 0) return false;
    const ratio = price / unit;
    return Math.abs(ratio - Math.round(ratio)) <= 1e-7;
  };

  return Array.from({ length: count }, (_, offset) => {
    const index = topIndex - offset;
    const price = normalizeGridPrice(index);
    const source = price > market
      ? askBuckets.get(index)
      : price < market
        ? bidBuckets.get(index)
        : (bidBuckets.get(index) ?? askBuckets.get(index));

    const isRound = isMultiple(price, majorUnit);
    const isHalfRound = !isRound && isMultiple(price, halfUnit);
    const base = source ?? {
      price,
      bidQuote: 0,
      askQuote: 0,
      quantity: 0,
      quote: 0,
      aggregated: false,
      levelCount: 0,
    };

    return {
      ...base,
      price,
      gridIndex: index,
      isMarket: index === marketIndex,
      isRound,
      isHalfRound,
    };
  });
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

export function aggregateTradeBursts(
  trades,
  minimumQuote = 0,
  priceStep = .01,
  maximumGapMs = 180,
  maximumRows = 1,
) {
  const threshold = Math.max(0, Number(minimumQuote) || 0);
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const gapLimit = Math.max(20, Number(maximumGapMs) || 180);
  const rowLimit = Math.max(0, Number(maximumRows) || 0);
  const ordered = [...(trades ?? [])]
    .filter((trade) => trade
      && [trade.price, trade.quote, trade.quantity, trade.time].every(Number.isFinite)
      && trade.quote > 0)
    .sort((left, right) => left.time - right.time || String(left.id).localeCompare(String(right.id)));

  const bursts = [];
  let current = null;

  const finish = () => {
    if (!current) return;
    current.price = current.quantity > 0
      ? current.notional / current.quantity
      : current.lastPrice;
    current.quote = current.buyQuote + current.sellQuote;
    if (current.quote >= threshold) bursts.push(current);
    current = null;
  };

  for (const trade of ordered) {
    const side = trade.side === "sell" ? "sell" : "buy";
    const priceIndex = Math.round(Number(trade.price) / step);
    const canMerge = current
      && current.side === side
      && Number(trade.time) - current.lastTime <= gapLimit
      && Math.abs(priceIndex - current.lastPriceIndex) <= rowLimit;

    if (!canMerge) {
      finish();
      current = {
        key: `burst:${String(trade.id)}:${trade.time}`,
        side,
        time: trade.time,
        lastTime: trade.time,
        firstTime: trade.time,
        lastPrice: trade.price,
        lastPriceIndex: priceIndex,
        quantity: 0,
        notional: 0,
        buyQuote: 0,
        sellQuote: 0,
        quote: 0,
        count: 0,
        executions: [],
      };
    }

    current.lastTime = trade.time;
    current.lastPrice = trade.price;
    current.lastPriceIndex = priceIndex;
    current.quantity += trade.quantity;
    current.notional += trade.price * trade.quantity;
    current[side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    current.count += 1;
    current.executions.push(trade);
  }

  finish();
  return bursts;
}

export function depthLiquidityWithinPercent(bids, asks, middlePrice, percent = 1) {
  const middle = Number(middlePrice);
  const range = Math.max(0, Number(percent) || 0) / 100;
  if (!Number.isFinite(middle) || middle <= 0) {
    return { bidQuote: 0, askQuote: 0, totalQuote: 0, imbalance: 0 };
  }

  const bidFloor = middle * (1 - range);
  const askCeiling = middle * (1 + range);
  let bidQuote = 0;
  let askQuote = 0;

  // Worker отдаёт bids по убыванию. Как только цена ниже −1%,
  // остальные уровни уже не могут попасть в диапазон.
  for (const row of bids ?? []) {
    const price = Number(row?.[0]);
    const quantity = Number(row?.[1]);
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || quantity <= 0) continue;
    if (price < bidFloor) break;
    if (price <= middle) bidQuote += price * quantity;
  }

  // Asks отсортированы по возрастанию — после +1% прекращаем обход.
  for (const row of asks ?? []) {
    const price = Number(row?.[0]);
    const quantity = Number(row?.[1]);
    if (!Number.isFinite(price) || !Number.isFinite(quantity) || quantity <= 0) continue;
    if (price > askCeiling) break;
    if (price >= middle) askQuote += price * quantity;
  }

  const totalQuote = bidQuote + askQuote;
  return {
    bidQuote,
    askQuote,
    totalQuote,
    imbalance: totalQuote > 0 ? (bidQuote - askQuote) / totalQuote : 0,
  };
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


const ORDERBOOK_WORKER_URL = new URL("./orderbook-worker.js?v=26-22-background-restart", import.meta.url);
const ORDERBOOK_WORKER_TAPE_EVENT = "inpuls:tape-data";
const ORDERBOOK_BACKGROUND_HARD_RESTART_MS = 15_000;
const ORDERBOOK_RESUBSCRIBE_STAGGER_MS = 160;

class OrderBookWorkerManager {
  constructor() {
    this.worker = null;
    this.failed = false;
    this.restarting = false;
    this.nextClientId = 1;
    this.clients = new Map();
    this.clientsBySymbol = new Map();
    this.lastDataBySymbol = new Map();
    this.lastStatusBySymbol = new Map();
    this.visibilityHandler = null;
    this.workerReady = false;
    this.startupTimer = 0;
    this.healthTimer = 0;
    this.lastHeartbeatAt = 0;
    this.restartCount = 0;
    this.needsResubscribe = false;
    this.hiddenAt = typeof document !== "undefined" && document.hidden ? Date.now() : 0;
    this.resubscribeEpoch = 0;
    this.#start();
    this.#startHealthWatch();
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
        name: "inpuls-orderbook-worker-v26-22",
      });
      this.startupTimer = setTimeout(() => {
        if (this.workerReady) return;
        if (this.restartCount < 2) this.#restart("Таймаут запуска Worker");
        else this.#fail();
      }, 4_000);
      this.worker.addEventListener("message", (event) => this.#onMessage(event.data));
      this.worker.addEventListener("error", (event) => {
        console.error("InPuls orderbook Worker error", event?.message || event);
        this.#restart(event?.message || "Ошибка Worker");
      });
      this.worker.addEventListener("messageerror", () => this.#restart("Ошибка сообщения Worker"));
      const visible = typeof document === "undefined" || !document.hidden;
      this.lastHeartbeatAt = Date.now();
      this.worker.postMessage({ type: "visibility", visible });
      if (typeof document !== "undefined" && !this.visibilityHandler) {
        this.visibilityHandler = () => {
          const visible = !document.hidden;
          if (!visible) {
            this.hiddenAt = Date.now();
            if (this.worker && !this.failed) {
              this.worker.postMessage({ type: "visibility", visible: false });
            }
            return;
          }

          const hiddenFor = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
          this.hiddenAt = 0;
          this.lastHeartbeatAt = Date.now();

          // После долгой заморозки Chromium может оставить WebSocket в OPEN,
          // хотя sequence и сетевой поток уже мертвы. Не пытаемся оживлять
          // такой Worker — создаём чистый и подписываем символы заново.
          if (hiddenFor >= ORDERBOOK_BACKGROUND_HARD_RESTART_MS) {
            this.#restart(`Возврат из фона ${Math.round(hiddenFor / 1_000)}с`);
            return;
          }

          if (!this.worker || this.failed) return;
          this.worker.postMessage({ type: "visibility", visible: true });
        };
        document.addEventListener("visibilitychange", this.visibilityHandler);
      }
    } catch {
      this.#fail();
    }
  }

  #startHealthWatch() {
    if (this.healthTimer || typeof setInterval !== "function") return;
    this.healthTimer = setInterval(() => {
      if (this.failed || this.restarting || !this.worker || !this.workerReady) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const age = Date.now() - this.lastHeartbeatAt;
      if (age > 9_000) this.#restart(`Worker не отвечает ${Math.round(age / 1_000)}с`);
    }, 2_500);
  }

  #notifyAll(status) {
    for (const client of this.clients.values()) client?._receiveStatus(status);
  }

  #restart(reason = "Перезапуск Worker") {
    if (this.failed || this.restarting) return;
    this.restarting = true;
    this.restartCount += 1;
    this.needsResubscribe = true;
    this.resubscribeEpoch += 1;
    console.warn("InPuls orderbook Worker restart", reason);
    clearTimeout(this.startupTimer);
    this.startupTimer = 0;
    this.workerReady = false;
    try { this.worker?.terminate(); } catch {}
    this.worker = null;
    this.lastHeartbeatAt = Date.now();
    this.#notifyAll({ state: "loading", text: "Восстановление Worker" });

    setTimeout(() => {
      if (this.failed) return;
      this.restarting = false;
      this.#start();
    }, Math.min(2_000, 250 * Math.max(1, this.restartCount)));
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
    this.lastHeartbeatAt = Date.now();
    if (message.type === "ready") {
      this.workerReady = true;
      this.restartCount = 0;
      clearTimeout(this.startupTimer);
      this.startupTimer = 0;
      const visible = typeof document === "undefined" || !document.hidden;
      this.worker?.postMessage({ type: "visibility", visible });
      if (this.needsResubscribe) {
        const worker = this.worker;
        const epoch = ++this.resubscribeEpoch;
        const symbols = [...this.clientsBySymbol.keys()];
        this.needsResubscribe = false;
        symbols.forEach((symbol, index) => {
          setTimeout(() => {
            if (this.failed || !this.workerReady || this.worker !== worker || epoch !== this.resubscribeEpoch) return;
            worker?.postMessage({ type: "subscribe", symbol });
          }, index * ORDERBOOK_RESUBSCRIBE_STAGGER_MS);
        });
      } else {
        this.needsResubscribe = false;
      }
      return;
    }
    if (message.type === "heartbeat") return;
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
          resume: Boolean(message.resume),
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
    clearInterval(this.healthTimer);
    this.healthTimer = 0;
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
    if (this.destroyed || data?.symbol !== this.symbol) return;
    if (typeof globalThis.dispatchEvent === "function"
      && typeof globalThis.CustomEvent === "function") {
      globalThis.dispatchEvent(new CustomEvent("inpuls:book-data", {
        detail: { symbol: this.symbol, data },
      }));
    }
    this.onData(data);
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

const ORDERBOOK_RUNTIME_STYLE_ID = "inpuls-orderbook-runtime-v26-22-background-restart";
const TAPE_EVENT_NAME = "inpuls:tape-data";
const BOOK_DATA_EVENT_NAME = "inpuls:book-data";
const TAPE_MAX_STORED = 4_000;
const TAPE_MAX_RAW_VISIBLE = 1_200;
const TAPE_MAX_AGG_VISIBLE = 900;
const TAPE_SECOND_MS = 1_000;
const TAPE_MIN_SECOND_WIDTH = 22;
const TAPE_MIN_SECONDS = 12;
const TAPE_MAX_SECONDS = 45;
const TAPE_STALE_NOTICE_MS = 60_000;
const TAPE_STATE_REFRESH_MS = 1_000;
const TAPE_MODE_KEY = "inpuls-tape-mode-v2";
const TAPE_VISIBLE_KEY = "inpuls-tape-visible-v1";
const CLUSTERS_VISIBLE_KEY = "inpuls-clusters-visible-v1";
const TAPE_MIN_FILTER_KEY = "inpuls-tape-min-filter-v3";

const tapeTradesBySymbol = new Map();
const latestBookDataBySymbol = new Map();
const tapeMetaBySymbol = new Map();
const tapePendingBySymbol = new Map();
const liquidityTimersBySymbol = new Map();
const liquidityLastDrawBySymbol = new Map();
const tapeCardStates = new WeakMap();
let tapeDrawFrame = 0;
let tapeDrawTimer = 0;
let tapeLastDrawAt = 0;
let tapeNeedsDraw = true;
let tapeDocumentHidden = typeof document !== "undefined" ? document.hidden : false;
let tapeRecentRate = 0;
let tapeStateTimer = 0;
let tapeIngestFrame = 0;

const TAPE_INGEST_PER_FRAME = 220;
const TAPE_RESUME_MAX_PENDING = 500;
const LIQUIDITY_REFRESH_MS = 420;

const BOOK_SPLIT_STORAGE_KEY = "inpuls-orderbook-split-v3";
const BOOK_MIN_TAPE_PX = 58;
const BOOK_MIN_LADDER_PX = 96;
const bookInteractionStates = new WeakMap();
const dirtyTapeCards = new Set();
let tapeDrawAllRequested = true;

export function parseRuntimeNumber(text) {
  let normalized = String(text ?? "")
    .trim()
    .replace(/[\s\u00A0\u202F']/g, "")
    .replace(/[^0-9,\.\-+]/g, "");

  if (!normalized) return null;

  const commaCount = (normalized.match(/,/g) ?? []).length;
  const dotCount = (normalized.match(/\./g) ?? []).length;

  if (commaCount && dotCount) {
    // Последний разделитель считаем десятичным:
    // 1,888.34 → 1888.34; 1.888,34 → 1888.34.
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized.split(thousandsSeparator).join("");
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".");
  } else if (commaCount) {
    // Одиночная/групповая запятая из интерфейса может быть разделителем тысяч.
    // 64,750 → 64750, но 0,025123 → 0.025123.
    const thousandsPattern = /^[+-]?\d{1,3}(,\d{3})+$/;
    if (thousandsPattern.test(normalized)) {
      normalized = normalized.replace(/,/g, "");
    } else {
      normalized = normalized.replace(",", ".");
    }
  } else if (dotCount > 1) {
    // Поддержка формата 1.234.567 без повреждения обычных десятичных цен.
    const thousandsPattern = /^[+-]?\d{1,3}(\.\d{3})+$/;
    if (thousandsPattern.test(normalized)) normalized = normalized.replace(/\./g, "");
  }

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
    .orderbook-card [data-book-center] {
      display: none !important;
    }
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
    .orderbook-card .inpuls-tape-state {
      position: absolute;
      left: 50%;
      top: 50%;
      z-index: 3;
      transform: translate(-50%, -50%);
      max-width: min(84%, 280px);
      padding: 5px 8px;
      border: 1px solid rgba(106, 132, 145, .22);
      border-radius: 6px;
      background: rgba(7, 11, 15, .78);
      color: #7f95a0;
      font: 600 10px/1.35 Inter, system-ui, sans-serif;
      text-align: center;
      pointer-events: none;
      opacity: 0;
      transition: opacity .12s ease;
    }
    .orderbook-card .inpuls-tape-state.is-visible { opacity: 1; }
    .orderbook-card .inpuls-tape-state[data-tone="attention"] {
      color: #d4b35f;
      border-color: rgba(212, 179, 95, .28);
    }
    .orderbook-card .inpuls-tape-state[data-tone="error"] {
      color: #ef7d89;
      border-color: rgba(239, 125, 137, .3);
    }
    .orderbook-card .inpuls-tape-range-summary {
      position: absolute;
      right: 6px;
      top: 6px;
      z-index: 4;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 3px;
      pointer-events: none;
    }
    .orderbook-card .inpuls-tape-range-summary span {
      display: none;
      padding: 2px 5px;
      border: 1px solid rgba(107, 132, 145, .22);
      border-radius: 4px;
      background: rgba(7, 11, 15, .78);
      color: #8fa5af;
      font: 700 9px/1.2 Inter, system-ui, sans-serif;
      white-space: nowrap;
    }
    .orderbook-card .inpuls-tape-range-summary span.is-visible { display: block; }
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
    .orderbook-card .orderbook-heading [data-book-ticker] {
      max-width: min(42%, 210px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .orderbook-card .book-pane-title {
      display: flex !important;
      grid-template-columns: none !important;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
      padding: 0 3px 0 2px !important;
      text-align: left !important;
    }
    .orderbook-card .inpuls-book-pane-actions {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .orderbook-card .book-pane-title .book-highlight-controls {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 2px;
      margin: 0;
    }
    .orderbook-card .book-pane-title [data-book-scale] {
      flex: 0 0 auto;
      margin-left: auto;
      color: var(--accent, #9d6cff);
      text-align: right;
      font-weight: 800;
    }
    .orderbook-card .book-pane-title > span:not([data-book-scale]) {
      display: none !important;
    }
    .orderbook-card .orderbook-rows {
      contain: layout paint style;
      transform: none !important;
    }
    .orderbook-card .book-ladder-row {
      transform: none !important;
      transition: none !important;
      will-change: auto !important;
      backface-visibility: visible;
    }
    .orderbook-card .book-ladder-row .book-size::before {
      transition: none !important;
      will-change: auto !important;
    }
    .orderbook-card .book-ladder-row {
      grid-template-columns: minmax(0, 1fr) var(--book-price-width, 7.5ch) !important;
      column-gap: 0 !important;
      align-items: stretch !important;
    }
    .orderbook-card .book-ladder-row .book-size,
    .orderbook-card .book-ladder-row strong {
      min-height: 100%;
      display: flex !important;
      align-items: center !important;
      line-height: 1 !important;
      box-sizing: border-box;
      font-variant-numeric: tabular-nums;
    }
    .orderbook-card .book-ladder-row .book-size {
      min-width: 0;
      padding-right: 4px;
      justify-content: flex-end;
      text-align: right;
    }
    .orderbook-card .book-ladder-row strong {
      width: 100% !important;
      min-width: 0 !important;
      padding: 0 1px 0 3px !important;
      justify-self: stretch !important;
      justify-content: flex-start !important;
      text-align: left !important;
      white-space: nowrap;
    }
    .orderbook-card .book-ladder-row .book-size::before {
      width: max(var(--size), 3px) !important;
      min-width: 3px !important;
      opacity: .78 !important;
    }
    .orderbook-card .book-ladder-row .book-size {
      overflow: visible !important;
      isolation: isolate;
    }
    .orderbook-card .book-ladder-row.is-price-half:not(.is-market) {
      background: rgba(151, 166, 177, .035);
    }
    .orderbook-card .book-ladder-row.is-price-half:not(.is-market) strong {
      color: color-mix(in srgb, currentColor 88%, #dce8ed);
      font-weight: 760;
    }
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) {
      background: rgba(166, 181, 192, .075);
      box-shadow: inset 0 1px rgba(190, 204, 214, .09),
                  inset 0 -1px rgba(190, 204, 214, .06);
    }
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) strong {
      color: #e6eef2;
      font-weight: 900;
    }
    .orderbook-card .book-ladder-row.is-anomaly .book-size,
    .orderbook-card .book-ladder-row.is-anomaly strong,
    .orderbook-card .book-ladder-row.is-market .book-size,
    .orderbook-card .book-ladder-row.is-market strong {
      color: #f6fbfd !important;
      text-shadow: 0 1px 2px rgba(0, 0, 0, .92);
      font-weight: 900 !important;
    }
    .orderbook-card .book-ladder-row.is-anomaly .book-size::before {
      opacity: .48 !important;
    }
    .orderbook-card .inpuls-layer-toggle {
      min-width: 32px;
      height: 20px;
      padding: 0 5px;
      border: 1px solid rgba(95, 122, 135, .34);
      border-radius: 4px;
      background: rgba(8, 13, 17, .78);
      color: #758d98;
      font: 800 8px/1 Inter, system-ui, sans-serif;
      cursor: pointer;
    }
    .orderbook-card .inpuls-layer-toggle.is-active {
      color: var(--accent);
      border-color: color-mix(in srgb, var(--accent) 62%, var(--line));
      background: color-mix(in srgb, var(--accent) 11%, transparent);
    }
    .orderbook-card.is-flow-hidden .orderbook-stage {
      grid-template-columns: 0 0 minmax(0, 1fr) !important;
    }
    .orderbook-card.is-flow-hidden .orderbook-tape,
    .orderbook-card.is-flow-hidden .book-splitter {
      display: none !important;
    }
    .orderbook-card .inpuls-layer-dock {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
    }
    .orderbook-card .inpuls-liquidity-meter {
      position: absolute;
      left: 4px;
      right: 4px;
      top: 22px;
      z-index: 35;
      height: 13px;
      display: grid;
      grid-template-columns: var(--liq-bid, 50%) var(--liq-ask, 50%);
      overflow: hidden;
      border: 1px solid rgba(92, 119, 132, .2);
      border-radius: 3px;
      background: rgba(5, 9, 12, .82);
      pointer-events: none;
    }
    .orderbook-card .inpuls-liquidity-meter i {
      min-width: 0;
      opacity: .5;
    }
    .orderbook-card .inpuls-liquidity-meter .is-bid {
      background: linear-gradient(90deg, rgba(30, 174, 126, .58), rgba(30, 174, 126, .16));
    }
    .orderbook-card .inpuls-liquidity-meter .is-ask {
      background: linear-gradient(90deg, rgba(207, 67, 82, .16), rgba(207, 67, 82, .58));
    }
    .orderbook-card .inpuls-liquidity-meter b {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #aebfc7;
      font: 800 7px/1 Inter, system-ui, sans-serif;
      text-shadow: 0 1px 2px #000;
      white-space: nowrap;
    }
    .orderbook-card .orderbook-rows {
      padding-top: 14px;
    }
    .orderbook-card .inpuls-tape-controls {
      justify-content: flex-start;
    }
    .orderbook-card .inpuls-tape-filter {
      flex: 1 1 auto;
      max-width: 104px;
    }
    .orderbook-card .orderbook-stage {
      overflow: hidden !important;
    }
    .orderbook-card .orderbook-tape {
      min-width: 58px !important;
    }
    .orderbook-card .orderbook-ladder {
      position: relative;
      z-index: 5;
      min-width: 96px !important;
      overflow: visible !important;
    }
    .orderbook-card .orderbook-rows {
      position: relative;
      z-index: 1;
      overflow: hidden !important;
    }
    .orderbook-card .book-pane-title {
      position: relative;
      z-index: 40;
      overflow: visible !important;
    }
    .orderbook-card .inpuls-book-pane-actions,
    .orderbook-card .book-highlight-controls {
      position: relative;
      z-index: 45;
      overflow: visible !important;
    }
    .orderbook-card .book-highlight-popover {
      position: absolute !important;
      z-index: 1000 !important;
      top: calc(100% + 3px) !important;
      left: 0 !important;
      min-width: 126px;
      padding: 5px;
      border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--line));
      border-radius: 5px;
      background: color-mix(in srgb, var(--panel) 98%, #000);
      box-shadow: 0 8px 24px rgba(0,0,0,.55);
    }
    .orderbook-card .book-splitter {
      position: relative;
      z-index: 60;
      min-width: 7px !important;
      width: 7px !important;
      margin-inline: -3px;
      cursor: ew-resize;
      touch-action: none;
    }
    .orderbook-card .book-splitter::before {
      content: "";
      position: absolute;
      inset: 0 -4px;
    }
    .orderbook-card .inpuls-tape-controls {
      justify-content: flex-start;
    }
  `;
  document.head.append(style);
}


function normalizeOrderBookTitle(card) {
  const title = card?.querySelector?.("[data-book-ticker]");
  if (!title) return;
  const clean = String(title.textContent ?? "")
    .replace(/\s*[·•]\s*Стакан\s*$/i, "")
    .trim();
  if (clean && title.textContent !== clean) title.textContent = clean;
}

function arrangeOrderBookChrome(card) {
  if (!card) return;
  normalizeOrderBookTitle(card);
  const pane = card.querySelector(".book-pane-title");
  const scale = card.querySelector("[data-book-scale]");
  const highlights = card.querySelector(".book-highlight-controls");
  if (!pane || !scale || !highlights) return;

  let actions = pane.querySelector(".inpuls-book-pane-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "inpuls-book-pane-actions";
    pane.prepend(actions);
  }
  if (highlights.parentElement !== actions) actions.append(highlights);
  if (scale.parentElement !== pane || pane.lastElementChild !== scale) pane.append(scale);

  for (const child of [...pane.children]) {
    if (child !== actions && child !== scale) child.remove();
  }
}


function runtimePriceStep(card) {
  const rows = [...card.querySelectorAll(".orderbook-rows .book-ladder-row")];
  const prices = rows
    .map((row) => parseRuntimeNumber(row.querySelector("strong")?.textContent))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  let step = Infinity;
  for (let index = 1; index < prices.length; index += 1) {
    const gap = prices[index] - prices[index - 1];
    if (gap > Number.EPSILON && gap < step) step = gap;
  }
  return Number.isFinite(step) ? step : null;
}

function decorateRuntimeBookRows(card) {
  const rows = [...card.querySelectorAll(".orderbook-rows .book-ladder-row")];
  const priceElements = rows
    .map((row) => row.querySelector("strong"))
    .filter(Boolean);
  const maximumCharacters = priceElements.reduce(
    (maximum, element) => Math.max(
      maximum,
      String(element.textContent ?? "").replace(/\s/g, "").length,
    ),
    0,
  );
  if (maximumCharacters > 0) {
    const width = clampTape(maximumCharacters + .55, 5.5, 14);
    card.style.setProperty("--book-price-width", `${width}ch`);
  }

  const step = runtimePriceStep(card);
  if (!Number.isFinite(step) || step <= 0) return;

  const majorUnit = 10 ** Math.ceil(Math.log10(step * 20));
  const halfUnit = majorUnit / 2;
  const nearMultiple = (price, unit) => {
    const ratio = price / unit;
    return Math.abs(ratio - Math.round(ratio)) <= 1e-6;
  };

  for (const row of rows) {
    const price = parseRuntimeNumber(row.querySelector("strong")?.textContent);
    const round = Number.isFinite(price) && nearMultiple(price, majorUnit);
    const half = !round && Number.isFinite(price) && nearMultiple(price, halfUnit);
    row.classList.toggle("is-price-round", round);
    row.classList.toggle("is-price-half", half);
  }
}

function createTapeStrengthScale(values) {
  const sorted = [...values]
    .map(Number)
    .filter((item) => Number.isFinite(item) && item > 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return () => 0;

  const low = Math.max(1, sorted[Math.floor((sorted.length - 1) * .08)] || 1);
  const high = Math.max(low + 1, sorted[Math.floor((sorted.length - 1) * .88)] || low + 1);
  const denominator = Math.max(.0001, Math.log1p(high / low));

  return (value) => {
    const amount = Math.max(0, Number(value) || 0);
    const base = Math.log1p(amount / low) / denominator;
    const outlierBoost = amount > high
      ? Math.log2(1 + amount / high) * .28
      : 0;
    return clampTape(base + outlierBoost, 0, 1.9);
  };
}

function disableLegacyBookCenter(card) {
  const button = card.querySelector("[data-book-center]");
  if (!button || button.dataset.inpulsCenterDisabled === "1") return;
  button.dataset.inpulsCenterDisabled = "1";
  if (button.classList.contains("is-active")) button.click();
  button.hidden = true;
}


function splitStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BOOK_SPLIT_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function splitCardKey(card) {
  return String(card?.dataset?.panelId || cardSymbol(card) || "orderbook");
}

function applyStoredBookSplit(card) {
  const stage = card.querySelector(".orderbook-stage");
  if (!stage || stage.dataset.inpulsSplitApplied === "1") return;
  const value = Number(splitStorage()[splitCardKey(card)]);
  if (Number.isFinite(value)) stage.style.setProperty("--tape-percent", `${value}%`);
  stage.dataset.inpulsSplitApplied = "1";
}

function saveBookSplit(card, percent) {
  const storage = splitStorage();
  storage[splitCardKey(card)] = Number(percent.toFixed(3));
  try { localStorage.setItem(BOOK_SPLIT_STORAGE_KEY, JSON.stringify(storage)); } catch {}
}

function handleRuntimeSplitter(event) {
  const splitter = event.target.closest?.(".book-splitter");
  if (!splitter) return;
  const card = splitter.closest(".orderbook-card");
  const stage = card?.querySelector(".orderbook-stage");
  if (!card || !stage) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  try { splitter.setPointerCapture(event.pointerId); } catch {}

  const move = (moveEvent) => {
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const minimumTape = Math.min(BOOK_MIN_TAPE_PX, width * .28);
    const minimumBook = Math.min(
      Math.max(BOOK_MIN_LADDER_PX, width * .075),
      width * .52,
    );
    const tapePixels = clampTape(
      moveEvent.clientX - rect.left,
      minimumTape,
      Math.max(minimumTape, width - minimumBook),
    );
    const percent = tapePixels / width * 100;
    stage.style.setProperty("--tape-percent", `${percent}%`);
    scheduleTapeDraw(true, card);
  };

  const stop = (stopEvent) => {
    const rect = stage.getBoundingClientRect();
    const raw = parseFloat(stage.style.getPropertyValue("--tape-percent"));
    if (Number.isFinite(raw)) saveBookSplit(card, raw);
    try { splitter.releasePointerCapture(stopEvent.pointerId); } catch {}
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", stop, true);
    document.removeEventListener("pointercancel", stop, true);
  };

  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", stop, true);
  document.addEventListener("pointercancel", stop, true);
}

function syncTapeModeButton(button, state) {
  const aggregated = state.mode === "agg";
  button.textContent = aggregated ? "AGG" : "RAW";
  button.classList.toggle("is-active", aggregated);
  button.setAttribute("aria-pressed", String(aggregated));
  button.title = aggregated
    ? "Агрегация последовательного рыночного удара без секундных корзин"
    : "Каждое исполнение отображается отдельно по точному времени";
}

function syncLayerButtons(card, state) {
  const tapeButton = state.layerControls?.querySelector("[data-inpuls-tape-visible]");
  const clusterButton = state.layerControls?.querySelector("[data-inpuls-clusters-visible]");
  tapeButton?.classList.toggle("is-active", state.tapeVisible);
  tapeButton?.setAttribute("aria-pressed", String(state.tapeVisible));
  clusterButton?.classList.toggle("is-active", state.clustersVisible);
  clusterButton?.setAttribute("aria-pressed", String(state.clustersVisible));
  card.classList.toggle("is-flow-hidden", !state.tapeVisible && !state.clustersVisible);
}

function ensureTapeUi(card) {
  arrangeOrderBookChrome(card);
  disableLegacyBookCenter(card);
  applyStoredBookSplit(card);
  decorateRuntimeBookRows(card);
  const flow = card.querySelector(".trade-flow");
  const toolbar = card.querySelector(".trade-tape-toolbar");
  if (!flow || !toolbar) return null;

  let state = tapeCardStates.get(card);
  if (!state) {
    const savedMinimum = localStorage.getItem(TAPE_MIN_FILTER_KEY);
    state = {
      canvas: null,
      context: null,
      mode: localStorage.getItem(TAPE_MODE_KEY) === "raw" ? "raw" : "agg",
      minQuote: savedMinimum === null ? 0 : Math.max(0, Number(savedMinimum) || 0),
      tapeVisible: localStorage.getItem(TAPE_VISIBLE_KEY) !== "0",
      clustersVisible: localStorage.getItem(CLUSTERS_VISIBLE_KEY) === "1",
      controls: null,
      layerControls: null,
      liquidity: null,
      status: null,
      rangeSummary: null,
      rowObserver: null,
      rowTarget: null,
      resizeObserver: null,
      resizeTarget: null,
      titleObserver: null,
      titleTarget: null,
      lastSymbol: null,
    };
    tapeCardStates.set(card, state);
  }

  if (!state.canvas?.isConnected || state.canvas.parentElement !== flow) {
    state.canvas?.remove();
    const canvas = document.createElement("canvas");
    canvas.className = "inpuls-tape-canvas";
    canvas.setAttribute("aria-label", "Лента рыночных сделок");
    flow.append(canvas);
    state.canvas = canvas;
    state.context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  }

  if (!state.status?.isConnected || state.status.parentElement !== flow) {
    state.status?.remove();
    const status = document.createElement("div");
    status.className = "inpuls-tape-state";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    flow.append(status);
    state.status = status;
  }

  if (!state.rangeSummary?.isConnected || state.rangeSummary.parentElement !== flow) {
    state.rangeSummary?.remove();
    const summary = document.createElement("div");
    summary.className = "inpuls-tape-range-summary";
    summary.innerHTML = '<span data-inpuls-tape-above></span><span data-inpuls-tape-below></span>';
    flow.append(summary);
    state.rangeSummary = summary;
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
      <button data-inpuls-tape-mode class="inpuls-tape-mode" type="button"></button>`;
    toolbar.append(controls);
    state.controls = controls;

    const minInput = controls.querySelector("[data-inpuls-trade-min]");
    const modeButton = controls.querySelector("[data-inpuls-tape-mode]");

    const applyMinimum = () => {
      state.minQuote = Math.max(0, Number(minInput.value) || 0);
      localStorage.setItem(TAPE_MIN_FILTER_KEY, String(state.minQuote));
      scheduleTapeDraw(true);
    };
    minInput.addEventListener("input", applyMinimum);
    minInput.addEventListener("change", applyMinimum);
    modeButton.addEventListener("click", () => {
      state.mode = state.mode === "agg" ? "raw" : "agg";
      localStorage.setItem(TAPE_MODE_KEY, state.mode);
      syncTapeModeButton(modeButton, state);
      scheduleTapeDraw(true, card);
    });
    syncTapeModeButton(modeButton, state);
    syncLayerButtons(card, state);
  } else {
    syncTapeModeButton(state.controls.querySelector("[data-inpuls-tape-mode]"), state);
  }

  const paneActions = card.querySelector(".inpuls-book-pane-actions");
  if (paneActions && (!state.layerControls?.isConnected || state.layerControls.parentElement !== paneActions)) {
    state.layerControls?.remove();
    const layerControls = document.createElement("div");
    layerControls.className = "inpuls-layer-dock";
    layerControls.innerHTML = `
      <button data-inpuls-tape-visible class="inpuls-layer-toggle" type="button" title="Показать или скрыть ленту">TAPE</button>
      <button data-inpuls-clusters-visible class="inpuls-layer-toggle" type="button" title="Показать или скрыть кластеры">КЛ</button>`;
    paneActions.prepend(layerControls);
    state.layerControls = layerControls;

    layerControls.querySelector("[data-inpuls-tape-visible]").addEventListener("click", () => {
      state.tapeVisible = !state.tapeVisible;
      localStorage.setItem(TAPE_VISIBLE_KEY, state.tapeVisible ? "1" : "0");
      syncLayerButtons(card, state);
      scheduleTapeDraw(true, card);
    });
    layerControls.querySelector("[data-inpuls-clusters-visible]").addEventListener("click", () => {
      state.clustersVisible = !state.clustersVisible;
      localStorage.setItem(CLUSTERS_VISIBLE_KEY, state.clustersVisible ? "1" : "0");
      syncLayerButtons(card, state);
      scheduleTapeDraw(true, card);
    });
  }
  syncLayerButtons(card, state);

  const rows = card.querySelector(".orderbook-rows");
  if (state.rowTarget !== rows) {
    state.rowObserver?.disconnect();
    state.rowObserver = null;
    state.rowTarget = rows;
    if (rows) {
      state.rowObserver = new MutationObserver(() => {
        decorateRuntimeBookRows(card);
        scheduleTapeDraw(false, card);
      });
      state.rowObserver.observe(rows, { childList: true, subtree: true, characterData: true });
    }
  }

  if (typeof ResizeObserver === "function" && state.resizeTarget !== flow) {
    state.resizeObserver?.disconnect();
    state.resizeObserver = new ResizeObserver(() => scheduleTapeDraw(true, card));
    state.resizeObserver.observe(flow);
    state.resizeTarget = flow;
  }

  const titleTarget = card.querySelector("[data-book-ticker]") ?? card.querySelector("h2");
  if (state.titleTarget !== titleTarget) {
    state.titleObserver?.disconnect();
    state.titleObserver = null;
    state.titleTarget = titleTarget;
    if (titleTarget) {
      state.titleObserver = new MutationObserver(() => {
        const nextSymbol = cardSymbol(card);
        if (nextSymbol !== state.lastSymbol) {
          state.lastSymbol = nextSymbol;
          scheduleTapeDraw(true, card);
        }
      });
      state.titleObserver.observe(titleTarget, { childList: true, subtree: true, characterData: true });
    }
  }
  state.lastSymbol = cardSymbol(card);

  const ladder = card.querySelector(".orderbook-ladder");
  if (ladder && (!state.liquidity?.isConnected || state.liquidity.parentElement !== ladder)) {
    state.liquidity?.remove();
    const liquidity = document.createElement("div");
    liquidity.className = "inpuls-liquidity-meter";
    liquidity.innerHTML = '<i class="is-bid"></i><i class="is-ask"></i><b>±1% —</b>';
    ladder.append(liquidity);
    state.liquidity = liquidity;
  }
  updateLiquidityMeter(card, state);
  syncLayerButtons(card, state);

  return state;
}


function updateLiquidityMeter(card, state = tapeCardStates.get(card)) {
  const meter = state?.liquidity;
  const symbol = cardSymbol(card);
  const data = symbol ? latestBookDataBySymbol.get(symbol) : null;
  if (!meter || !data) return;

  const bestBid = Number(data.bids?.[0]?.[0]);
  const bestAsk = Number(data.asks?.[0]?.[0]);
  const middle = Number.isFinite(bestBid) && Number.isFinite(bestAsk)
    ? (bestBid + bestAsk) / 2
    : null;
  const liquidity = depthLiquidityWithinPercent(data.bids, data.asks, middle, 1);
  const total = Math.max(1, liquidity.totalQuote);
  const bidPercent = liquidity.bidQuote / total * 100;
  meter.style.setProperty("--liq-bid", `${bidPercent.toFixed(2)}%`);
  meter.style.setProperty("--liq-ask", `${(100 - bidPercent).toFixed(2)}%`);
  const label = meter.querySelector("b");
  if (label) {
    label.textContent = `−1% ${formatTapeUsd(liquidity.bidQuote)} · +1% ${formatTapeUsd(liquidity.askQuote)}`;
  }
  meter.title = `Глубина ±1% · BID ${formatTapeUsd(liquidity.bidQuote)} · ASK ${formatTapeUsd(liquidity.askQuote)}`;
}

function flushLiquidityForSymbol(symbol) {
  liquidityTimersBySymbol.delete(symbol);
  liquidityLastDrawBySymbol.set(symbol, performance.now());
  document.querySelectorAll(".orderbook-card").forEach((card) => {
    if (cardSymbol(card) !== symbol) return;
    updateLiquidityMeter(card);
  });
}

function scheduleLiquidityForSymbol(symbol) {
  if (liquidityTimersBySymbol.has(symbol)) return;
  const elapsed = performance.now() - (liquidityLastDrawBySymbol.get(symbol) || 0);
  const delay = Math.max(0, LIQUIDITY_REFRESH_MS - elapsed);
  const timer = setTimeout(() => flushLiquidityForSymbol(symbol), delay);
  liquidityTimersBySymbol.set(symbol, timer);
}

function acceptBookData(event) {
  const symbol = String(event?.detail?.symbol ?? "").toUpperCase();
  const data = event?.detail?.data;
  if (!symbol.endsWith("USDT") || !data) return;
  latestBookDataBySymbol.set(symbol, data);
  scheduleLiquidityForSymbol(symbol);
}

function setTapeState(state, text = "", tone = "neutral") {
  const element = state?.status;
  if (!element) return;
  const value = String(text || "");
  if (element.textContent !== value) element.textContent = value;
  element.dataset.tone = tone;
  element.classList.toggle("is-visible", Boolean(value));
}

function setTapeRangeSummary(state, above = 0, below = 0) {
  const summary = state?.rangeSummary;
  if (!summary) return;
  const aboveElement = summary.querySelector("[data-inpuls-tape-above]");
  const belowElement = summary.querySelector("[data-inpuls-tape-below]");
  const safeAbove = Math.max(0, Math.floor(Number(above) || 0));
  const safeBelow = Math.max(0, Math.floor(Number(below) || 0));
  if (aboveElement) {
    aboveElement.textContent = `↑ ${safeAbove} выше`;
    aboveElement.classList.toggle("is-visible", safeAbove > 0);
  }
  if (belowElement) {
    belowElement.textContent = `↓ ${safeBelow} ниже`;
    belowElement.classList.toggle("is-visible", safeBelow > 0);
  }
}

function visiblePriceRange(rows) {
  const prices = rows.map((row) => Number(row.price)).filter(Number.isFinite);
  if (!prices.length) return null;
  const sorted = [...new Set(prices)].sort((left, right) => left - right);
  let step = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap > 0 && (!step || gap < step)) step = gap;
  }
  const low = sorted[0];
  const high = sorted.at(-1);
  const tolerance = Math.max(Number.EPSILON, step || Math.abs(high - low) / Math.max(1, sorted.length - 1)) * .65;
  return { low, high, step: Math.max(Number.EPSILON, step || tolerance), tolerance };
}

function aggregateDiagnosticItems(trades, window, step) {
  const safeStep = Math.max(Number.EPSILON, Number(step) || .01);
  const buckets = new Map();
  for (const trade of trades) {
    const second = Math.floor(Number(trade.time) / TAPE_SECOND_MS);
    if (second < window.firstSecond || second > window.latestSecond) continue;
    const priceBucket = Math.round(Number(trade.price) / safeStep);
    const key = `${second}:${priceBucket}`;
    const item = buckets.get(key) ?? {
      second,
      price: priceBucket * safeStep,
      quote: 0,
      count: 0,
    };
    item.quote += Number(trade.quote) || 0;
    item.count += 1;
    buckets.set(key, item);
  }
  return [...buckets.values()];
}

function classifyTapeCandidates(candidates, range) {
  if (!range) return { above: 0, below: 0, visible: 0 };
  let above = 0;
  let below = 0;
  let visible = 0;
  for (const item of candidates) {
    const price = Number(item?.price);
    if (!Number.isFinite(price)) continue;
    if (price > range.high + range.tolerance) above += 1;
    else if (price < range.low - range.tolerance) below += 1;
    else visible += 1;
  }
  return { above, below, visible };
}

function tapeStatusText(card) {
  return String(card?.textContent ?? "").toUpperCase();
}

function staleTradeSuffix(symbol) {
  const meta = symbol ? tapeMetaBySymbol.get(symbol) : null;
  const lastAt = Number(meta?.lastPacketAt) || 0;
  if (!lastAt) return "";
  const age = Date.now() - lastAt;
  if (age < TAPE_STALE_NOTICE_MS) return "";
  return ` · данные ${Math.max(1, Math.floor(age / 1_000))}с назад`;
}

function visibleBookRows(card, flow) {
  const flowRect = flow.getBoundingClientRect();
  if (flowRect.width <= 0 || flowRect.height <= 0) return [];
  return [...card.querySelectorAll(".orderbook-rows .book-ladder-row")]
    .map((row, index) => {
      const price = parseRuntimeNumber(row.querySelector("strong")?.textContent);
      const rect = row.getBoundingClientRect();
      const y = rect.top + rect.height / 2 - flowRect.top;
      return {
        index,
        price,
        y,
        height: rect.height,
        intersects: rect.bottom >= flowRect.top && rect.top <= flowRect.bottom,
      };
    })
    .filter((row) => row.intersects
      && Number.isFinite(row.price)
      && Number.isFinite(row.y)
      && row.y >= -row.height
      && row.y <= flowRect.height + row.height)
    .map(({ intersects, ...row }) => row);
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

function buildContinuousTapeWindow(width, latestTime) {
  const seconds = clampTape(
    Math.floor(width / TAPE_MIN_SECOND_WIDTH),
    TAPE_MIN_SECONDS,
    TAPE_MAX_SECONDS,
  );
  const duration = seconds * TAPE_SECOND_MS;
  const endTime = Number(latestTime) + 1;
  return {
    duration,
    startTime: endTime - duration,
    endTime,
  };
}

function tapeTimeX(time, window, width) {
  const ratio = (Number(time) - window.startTime) / Math.max(1, window.duration);
  return clampTape(ratio * width, 1, Math.max(1, width - 1));
}

function rawTapeItemsContinuous(trades, rows, window) {
  return trades
    .slice(0, TAPE_MAX_RAW_VISIBLE)
    .reverse()
    .filter((trade) => trade.time >= window.startTime && trade.time <= window.endTime)
    .map((trade) => {
      const row = nearestVisibleRow(rows, trade.price);
      if (!row) return null;
      return {
        key: `raw:${String(trade.id)}:${trade.time}`,
        time: trade.time,
        lastTime: trade.time,
        price: trade.price,
        row,
        quote: trade.quote,
        buyQuote: trade.side === "buy" ? trade.quote : 0,
        sellQuote: trade.side === "sell" ? trade.quote : 0,
        count: 1,
      };
    })
    .filter(Boolean);
}

function aggregateTapeBurstsContinuous(trades, rows, window, step) {
  return aggregateTradeBursts(
    trades.filter((trade) => trade.time >= window.startTime && trade.time <= window.endTime),
    0,
    step,
    180,
    1,
  )
    .map((burst) => {
      const row = nearestVisibleRow(rows, burst.price);
      return row ? { ...burst, row } : null;
    })
    .filter(Boolean)
    .slice(-TAPE_MAX_AGG_VISIBLE);
}

function aggregateVisibleRowClusters(trades, rows, window, minimumQuote = 0) {
  const buckets = new Map();
  for (const trade of trades) {
    if (trade.time < window.startTime || trade.time > window.endTime) continue;
    const row = nearestVisibleRow(rows, trade.price);
    if (!row) continue;
    const item = buckets.get(row.index) ?? {
      row,
      price: row.price,
      buyQuote: 0,
      sellQuote: 0,
      quote: 0,
      count: 0,
    };
    item[trade.side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    item.quote += trade.quote;
    item.count += 1;
    buckets.set(row.index, item);
  }
  return [...buckets.values()].filter((item) => item.quote >= minimumQuote);
}

function drawPriceClusters(context, rect, clusters, strong = false) {
  if (!clusters.length) return;
  const maximum = Math.max(...clusters.map((item) => item.quote), 1);
  const centerX = rect.width * .5;
  const maximumSideWidth = Math.max(12, rect.width * .46);

  context.save();
  context.font = "800 8px Inter, system-ui, sans-serif";
  context.textBaseline = "middle";

  for (const item of clusters) {
    const buyWidth = Math.sqrt(item.buyQuote / maximum) * maximumSideWidth;
    const sellWidth = Math.sqrt(item.sellQuote / maximum) * maximumSideWidth;
    const height = Math.max(2, Math.min(item.row.height * .72, strong ? 11 : 7));

    if (sellWidth > 0) {
      context.fillStyle = strong ? "rgba(222, 70, 87, .44)" : "rgba(222, 70, 87, .18)";
      context.fillRect(centerX - sellWidth, item.row.y - height / 2, sellWidth, height);
    }
    if (buyWidth > 0) {
      context.fillStyle = strong ? "rgba(38, 191, 138, .44)" : "rgba(38, 191, 138, .18)";
      context.fillRect(centerX, item.row.y - height / 2, buyWidth, height);
    }

    if (strong && item.quote >= maximum * .32) {
      const label = formatTapeUsd(item.quote);
      context.textAlign = "center";
      context.fillStyle = "rgba(230, 241, 238, .96)";
      context.fillText(label, centerX, item.row.y);
    }
  }
  context.restore();
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


function drawTapeCard(card) {
  const state = ensureTapeUi(card);
  const flow = card.querySelector(".trade-flow");
  const canvas = state?.canvas;
  const context = state?.context;
  if (!state || !flow || !canvas || !context || tapeDocumentHidden) return;

  const rect = flow.getBoundingClientRect();
  if (rect.width <= 2 || rect.height <= 2) return;
  const dprLimit = rect.width >= 900 ? 1.1 : 1.4;
  const dpr = Math.max(1, Math.min(dprLimit, globalThis.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
  const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  setTapeRangeSummary(state, 0, 0);

  if (!state.tapeVisible && !state.clustersVisible) {
    setTapeState(state, "");
    return;
  }

  const symbol = cardSymbol(card);
  if (!symbol) {
    setTapeState(state, "Выберите монету");
    return;
  }

  const stored = tapeTradesBySymbol.get(symbol) ?? [];
  if (!stored.length) {
    const live = tapeStatusText(card).includes("TAPE");
    setTapeState(
      state,
      live ? "Поток подключён · ждём сделку" : "Подключаю поток сделок…",
      live ? "neutral" : "attention",
    );
    return;
  }

  const rows = visibleBookRows(card, flow);
  if (!rows.length) {
    setTapeState(state, "Жду ценовые строки стакана…", "attention");
    return;
  }

  const latestTime = stored.reduce(
    (latest, trade) => Math.max(latest, Number(trade?.time) || 0),
    0,
  ) || Date.now();
  const window = buildContinuousTapeWindow(rect.width, latestTime);
  const recent = stored.filter(
    (trade) => trade.time >= window.startTime && trade.time <= window.endTime,
  );
  if (!recent.length) {
    setTapeState(state, `Нет сделок в текущем окне${staleTradeSuffix(symbol)}`);
    return;
  }

  const minQuote = Math.max(0, Number(state.minQuote) || 0);
  const range = visiblePriceRange(rows);
  const step = range?.step ?? .01;

  // Кластеры считаются только когда слой включён.
  if (state.clustersVisible) {
    const clusters = aggregateVisibleRowClusters(recent, rows, window, minQuote);
    drawPriceClusters(context, rect, clusters, !state.tapeVisible);
  }

  if (!state.tapeVisible) {
    setTapeState(state, "");
    return;
  }

  const rawCandidates = recent.filter((trade) => passesTapeFilter(trade, minQuote, 0));
  const items = state.mode === "agg"
    ? aggregateTapeBurstsContinuous(recent, rows, window, step)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : rawTapeItemsContinuous(rawCandidates, rows, window);

  const candidates = state.mode === "agg"
    ? aggregateTradeBursts(recent, minQuote, step, 180, 1)
    : rawCandidates;

  if (!candidates.length) {
    setTapeState(state, "Нет сделок по текущему фильтру");
    return;
  }

  const visibility = classifyTapeCandidates(candidates, range);
  setTapeRangeSummary(state, visibility.above, visibility.below);

  if (!items.length) {
    setTapeState(state, "");
    return;
  }

  setTapeState(state, "");
  const quotes = items.map((item) => Number(item.quote) || 0).filter((value) => value > 0);
  const strengthFor = createTapeStrengthScale(quotes);
  const sortedQuotes = [...quotes].sort((a, b) => a - b);
  const rawLabelThreshold = sortedQuotes[Math.floor((sortedQuotes.length - 1) * .86)] || Infinity;

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "800 8px Inter, system-ui, sans-serif";

  const drawItems = state.mode === "raw"
    ? [...items].sort((left, right) => Number(left.quote) - Number(right.quote))
    : items;

  for (let index = 0; index < drawItems.length; index += 1) {
    const item = drawItems[index];
    const y = item.row.y;
    const buy = item.buyQuote >= item.sellQuote;
    const stroke = buy ? "rgba(88, 239, 184, .9)" : "rgba(255, 121, 137, .9)";
    const strength = strengthFor(item.quote);
    const baseX = tapeTimeX(item.lastTime ?? item.time, window, rect.width);

    if (state.mode === "raw") {
      const jitter = (((index * 1103515245 + 12345) >>> 8) % 1000) / 1000 - .5;
      const maximumDiameter = Math.min(30, Math.max(6, rect.width * .035));
      const diameter = clampTape(
        1.7 + Math.pow(strength, 1.12) * 13.5,
        1.7,
        maximumDiameter,
      );
      const x = clampTape(
        baseX + jitter * Math.min(7, diameter * .45),
        diameter / 2 + .5,
        rect.width - diameter / 2 - .5,
      );
      context.beginPath();
      context.arc(x, y, diameter / 2, 0, Math.PI * 2);
      context.fillStyle = buy
        ? `rgba(50, 205, 151, ${clampTape(.4 + strength * .23, .4, .9)})`
        : `rgba(238, 91, 108, ${clampTape(.4 + strength * .23, .4, .9)})`;
      context.fill();
      if (diameter >= 4.5) {
        context.lineWidth = diameter >= 14 ? 1.25 : .7;
        context.strokeStyle = stroke;
        context.stroke();
      }
      if (item.quote >= rawLabelThreshold && diameter >= 14) {
        const label = formatTapeUsd(item.quote);
        const measured = context.measureText(label).width;
        if (measured + 2 <= diameter) {
          context.fillStyle = "rgba(244, 250, 248, .98)";
          context.fillText(label, x, y + .2);
        }
      }
      continue;
    }

    // AGG: каждый последовательный удар всегда показывает суммарный объём.
    const label = formatTapeUsd(item.quote);
    const measured = context.measureText(label).width;
    const height = clampTape(8 + strength * 8, 8, 18);
    const width = clampTape(measured + 9, 18, Math.min(92, rect.width * .32));
    const x = clampTape(baseX, width / 2 + .5, rect.width - width / 2 - .5);

    roundedRectPath(context, x - width / 2, y - height / 2, width, height, height * .28);
    context.fillStyle = buy ? "rgba(42, 191, 137, .72)" : "rgba(222, 70, 87, .74)";
    context.fill();
    context.lineWidth = item.count > 1 ? 1.1 : .7;
    context.strokeStyle = stroke;
    context.stroke();
    context.fillStyle = "rgba(244, 250, 248, .98)";
    context.fillText(label, x, y + .2);
  }
}

function drawAllTapes() {
  if (tapeDocumentHidden) return;

  const cards = tapeDrawAllRequested
    ? [...document.querySelectorAll(".orderbook-card")]
    : [...dirtyTapeCards].filter((card) => card?.isConnected);

  for (const card of cards) drawTapeCard(card);

  dirtyTapeCards.clear();
  tapeDrawAllRequested = false;
  tapeNeedsDraw = false;
}

function cancelTapeDraw() {
  if (tapeDrawFrame) cancelAnimationFrame(tapeDrawFrame);
  if (tapeDrawTimer) clearTimeout(tapeDrawTimer);
  tapeDrawFrame = 0;
  tapeDrawTimer = 0;
}

function targetTapeFrameMs() {
  const count = Math.max(1, document.querySelectorAll(".orderbook-card").length);
  const base = count >= 6 ? 84 : count >= 3 ? 66 : 50;
  if (tapeRecentRate > 1_200) return Math.max(base, 90);
  if (tapeRecentRate > 600) return Math.max(base, 72);
  if (tapeRecentRate > 250) return Math.max(base, 58);
  return base;
}

function scheduleTapeDraw(force = false, card = null) {
  if (typeof document === "undefined") return;
  tapeNeedsDraw = true;
  if (card?.isConnected) dirtyTapeCards.add(card);
  else tapeDrawAllRequested = true;
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

function normalizeTapeTrade(trade) {
  const price = Number(trade?.price);
  const quantity = Number(trade?.quantity);
  const quote = Number(trade?.quote);
  const time = Number(trade?.time);
  if (![price, quantity, quote, time].every(Number.isFinite) || quote <= 0) return null;
  return {
    id: trade?.id ?? `${time}-${price}-${quantity}`,
    price,
    quantity,
    quote,
    time,
    side: trade?.side === "sell" ? "sell" : "buy",
  };
}

function tapeTradeKey(trade) {
  return `${String(trade.id)}:${trade.time}:${trade.price}:${trade.quantity}`;
}

function mergeTapeHistory(current, incoming, replace = false) {
  const normalizedIncoming = incoming
    .map(normalizeTapeTrade)
    .filter(Boolean)
    .sort((left, right) => right.time - left.time);

  if (replace) {
    const seen = new Set();
    return normalizedIncoming
      .filter((trade) => {
        const key = tapeTradeKey(trade);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, TAPE_MAX_STORED);
  }

  const existing = current ?? [];
  const incomingKeys = new Set();
  const uniqueIncoming = normalizedIncoming.filter((trade) => {
    const key = tapeTradeKey(trade);
    if (incomingKeys.has(key)) return false;
    incomingKeys.add(key);
    return true;
  });

  const result = [];
  let incomingIndex = 0;
  let currentIndex = 0;
  const seen = new Set();

  while (
    result.length < TAPE_MAX_STORED
    && (incomingIndex < uniqueIncoming.length || currentIndex < existing.length)
  ) {
    const incomingTrade = uniqueIncoming[incomingIndex];
    const currentTrade = existing[currentIndex];
    const takeIncoming = currentTrade === undefined
      || (incomingTrade !== undefined && incomingTrade.time >= currentTrade.time);
    const trade = takeIncoming ? incomingTrade : currentTrade;
    if (takeIncoming) incomingIndex += 1;
    else currentIndex += 1;
    if (!trade) continue;

    const key = tapeTradeKey(trade);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trade);
  }

  return result;
}

function flowLayerVisible(card) {
  const state = tapeCardStates.get(card);
  return !state || state.tapeVisible || state.clustersVisible;
}

function scheduleTapeIngest() {
  if (tapeIngestFrame || tapeDocumentHidden || !tapePendingBySymbol.size) return;
  tapeIngestFrame = requestAnimationFrame(drainTapeIngest);
}

function drainTapeIngest() {
  tapeIngestFrame = 0;
  let budget = TAPE_INGEST_PER_FRAME;
  const cardCount = Math.max(1, document.querySelectorAll(".orderbook-card").length);
  if (cardCount >= 6) budget = 120;
  else if (cardCount >= 3) budget = 170;

  for (const [symbol, pending] of tapePendingBySymbol) {
    if (budget <= 0) break;
    const take = pending.resume
      ? Math.min(TAPE_RESUME_MAX_PENDING, pending.trades.length)
      : Math.min(budget, pending.trades.length);
    const chunk = pending.trades.splice(0, take);
    const current = tapeTradesBySymbol.get(symbol) ?? [];
    tapeTradesBySymbol.set(
      symbol,
      mergeTapeHistory(current, chunk, pending.replace),
    );
    pending.replace = false;
    if (pending.resume) {
      pending.resume = false;
      budget = 0;
    } else {
      budget -= take;
    }

    const stored = tapeTradesBySymbol.get(symbol) ?? [];
    const latestTime = stored[0]?.time || Date.now();
    const previousMeta = tapeMetaBySymbol.get(symbol) ?? {};
    tapeMetaBySymbol.set(symbol, {
      lastPacketAt: Date.now(),
      lastTradeTime: latestTime,
      packets: (Number(previousMeta.packets) || 0) + 1,
    });
    tapeRecentRate = stored.reduce(
      (count, trade) => count + (trade.time >= latestTime - 1_000 ? 1 : 0),
      0,
    );

    const cards = [...document.querySelectorAll(".orderbook-card")]
      .filter((card) => cardSymbol(card) === symbol && flowLayerVisible(card));
    cards.forEach((card) => scheduleTapeDraw(false, card));

    if (!pending.trades.length) tapePendingBySymbol.delete(symbol);
  }

  if (tapePendingBySymbol.size) scheduleTapeIngest();
}

function acceptTapeData(event) {
  const detail = event?.detail;
  const symbol = String(detail?.symbol ?? "").toUpperCase();
  if (!symbol.endsWith("USDT")) return;
  const incoming = Array.isArray(detail?.trades)
    ? detail.trades.map(normalizeTapeTrade).filter(Boolean)
    : [];
  if (!detail?.replace && !incoming.length) return;

  const pending = tapePendingBySymbol.get(symbol) ?? {
    trades: [],
    replace: false,
    resume: false,
  };
  if (detail.resume) {
    pending.trades = incoming.slice(0, TAPE_RESUME_MAX_PENDING);
    pending.replace = false;
    pending.resume = true;
  } else if (detail.replace) {
    pending.trades = incoming.slice(0, TAPE_MAX_STORED);
    pending.replace = true;
    pending.resume = false;
  } else if (incoming.length) {
    pending.trades.push(...incoming);
    if (pending.trades.length > TAPE_MAX_STORED) {
      pending.trades.splice(0, pending.trades.length - TAPE_MAX_STORED);
    }
  }
  tapePendingBySymbol.set(symbol, pending);
  scheduleTapeIngest();
}

function bindTapeCard(card) {
  arrangeOrderBookChrome(card);
  ensureTapeUi(card);
  scheduleTapeDraw(true, card);
}

function scanTapeCards(root = document) {
  if (root instanceof Element && root.matches(".orderbook-card")) bindTapeCard(root);
  root.querySelectorAll?.(".orderbook-card").forEach(bindTapeCard);
}

function installOrderBookRuntime() {
  if (typeof document === "undefined") return;
  installOrderBookStyles();
  globalThis.addEventListener(TAPE_EVENT_NAME, acceptTapeData);
  globalThis.addEventListener(BOOK_DATA_EVENT_NAME, acceptBookData);
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
  window.addEventListener("focus", () => scheduleTapeDraw(true), { passive: true });
  window.addEventListener("pageshow", () => scheduleTapeDraw(true), { passive: true });
  window.addEventListener("orientationchange", () => scheduleTapeDraw(true), { passive: true });
  document.addEventListener("fullscreenchange", () => scheduleTapeDraw(true));
  document.addEventListener("transitionend", (event) => {
    if (event.target?.closest?.(".orderbook-card")) scheduleTapeDraw(true);
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    tapeDocumentHidden = document.hidden;
    if (tapeDocumentHidden) {
      cancelTapeDraw();
      if (tapeIngestFrame) cancelAnimationFrame(tapeIngestFrame);
      tapeIngestFrame = 0;
      tapePendingBySymbol.clear();
      tapeNeedsDraw = true;
      return;
    }
    // Не догоняем пропущенные кадры: рисуем один актуальный снимок,
    // а накопленные сделки добавляем небольшими порциями между кадрами.
    scheduleTapeIngest();
    scheduleTapeDraw(true);
  });

  document.addEventListener("pointerdown", handleRuntimeSplitter, true);

  document.addEventListener("wheel", (event) => {
    const card = event.target.closest?.(".orderbook-card");
    if (!card) return;
    // Центрирование удалено: обычный скролл остаётся там,
    // где его оставил пользователь. Ctrl + колесо меняет только шаг.
    setTimeout(() => scheduleTapeDraw(false, card), 0);
  }, { capture: true, passive: true });

  clearInterval(tapeStateTimer);
  tapeStateTimer = setInterval(() => {
    if (!tapeDocumentHidden) {
      scanTapeCards(document);
      scheduleTapeDraw();
    }
  }, TAPE_STATE_REFRESH_MS);

  scheduleTapeDraw(true);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installOrderBookRuntime, { once: true });
  } else {
    installOrderBookRuntime();
  }
}
