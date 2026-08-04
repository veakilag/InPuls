import { binanceClock } from "./binance-clock.js?v=26-102-tape-live-edge-minute-boundary-v1";
import {
  adaptiveRawDiameter,
  buildReadableTapeLayout,
  selectReadableAggLabels,
} from "./orderbook-tape-layout.js?v=stable-tape-v4";
import "./orderbook-network.js?v=obs-pr1-1";
import "./orderbook-depth-projection.js?v=deep-book-v1";
import "./orderbook-flow-workspace.js?v=26-115-series-visible-fallback-v1";
import "./orderbook-events.js?v=orderbook-events-core-v1";
import "./orderbook-density.js?v=density-trades-correlation-v1";
import { observability } from "./observability.js?v=worker-bp-v1";

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

function bookSideQuoteScale(levels, sampleLimit = 1_024) {
  const totalLevels = Number.isFinite(levels?.size)
    ? levels.size
    : (Number(levels?.length) || 0);
  const limit = Math.max(32, Math.floor(Number(sampleLimit) || 1_024));
  const sampleStride = Math.max(1, Math.ceil(totalLevels / limit));
  const sample = [];
  let maximum = 1;
  let validIndex = 0;
  for (const [priceValue, quantityValue] of levels ?? []) {
    const quote = Number(priceValue) * Number(quantityValue);
    if (!Number.isFinite(quote) || quote <= 0) continue;
    if (quote > maximum) maximum = quote;
    if (validIndex % sampleStride === 0) sample.push(quote);
    validIndex += 1;
  }
  sample.sort((left, right) => left - right);
  const quantile = (ratio) => sample.length
    ? sample[Math.min(sample.length - 1, Math.floor((sample.length - 1) * ratio))]
    : 0;
  const median = quantile(.5);
  const upper = quantile(.95);
  const extreme = quantile(.99);
  return {
    maximum,
    anomalyThreshold: Math.max(1, median * 6, upper * 1.35, extreme),
    sampledLevels: sample.length,
    totalLevels: validIndex,
  };
}

export function bookQuoteScale(bids, asks, sampleLimit = 2_048) {
  const sideLimit = Math.max(32, Math.floor((Number(sampleLimit) || 2_048) / 2));
  const bid = bookSideQuoteScale(bids ?? [], sideLimit);
  const ask = bookSideQuoteScale(asks ?? [], sideLimit);
  return {
    maximum: Math.max(bid.maximum, ask.maximum),
    anomalyThreshold: Math.max(bid.anomalyThreshold, ask.anomalyThreshold),
    bidAnomalyThreshold: bid.anomalyThreshold,
    askAnomalyThreshold: ask.anomalyThreshold,
    sampledLevels: bid.sampledLevels + ask.sampledLevels,
    totalLevels: bid.totalLevels + ask.totalLevels,
  };
}

export function bookDisplayedQuote(row) {
  return Math.max(0, Number(row?.quote) || 0);
}

export function bookAnomalyQuote(row, automatic = false) {
  const total = bookDisplayedQuote(row);
  const largestRealLevel = Math.max(0, Number(row?.maxLevelQuote) || 0);
  return automatic && largestRealLevel > 0 ? largestRealLevel : total;
}

export function sessionBookAnomalyThreshold(cache, symbol, candidate, anchor = true) {
  const amount = Number(candidate);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const key = String(symbol ?? "").toUpperCase();
  const saved = Number(cache?.get?.(key));
  if (Number.isFinite(saved) && saved > 0) return saved;
  if (anchor && key && typeof cache?.set === "function") cache.set(key, amount);
  return amount;
}

export function bookDistancePercentLabel(price, currentPrice) {
  if (price === null || price === undefined || price === "") return "";
  const level = Number(price);
  const current = Number(currentPrice);
  if (!Number.isFinite(level) || !Number.isFinite(current) || current <= 0) return "";
  const percent = Math.abs(((level - current) / current) * 100);
  return `${percent.toFixed(1)}%`;
}

export function bookPsychologicalPriceUnit(referencePrice) {
  const reference = Math.abs(Number(referencePrice));
  if (!Number.isFinite(reference) || reference <= 0) return null;
  const target = reference * .01;
  return 10 ** Math.round(Math.log10(target));
}

export function bookPriceEmphasisForUnit(price, majorUnit) {
  const value = Number(price);
  const unit = Number(majorUnit);
  if (!Number.isFinite(value) || !Number.isFinite(unit) || unit <= 0) {
    return { round: false, half: false, majorUnit: null };
  }
  const halfUnit = unit / 2;
  const tolerance = Math.max(Number.EPSILON, unit * 1e-8);
  const nearMultiple = (candidate) => {
    const ratio = value / candidate;
    return Math.abs(value - Math.round(ratio) * candidate) <= tolerance;
  };
  const round = nearMultiple(unit);
  return {
    round,
    half: !round && nearMultiple(halfUnit),
    majorUnit: unit,
  };
}

export function bookPriceEmphasis(price, referencePrice) {
  return bookPriceEmphasisForUnit(price, bookPsychologicalPriceUnit(referencePrice));
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
  const receivedAt = Date.now();
  const arrivalTime = Number(binanceClock.now());
  if (![price, quantity, time].every(Number.isFinite)) return null;
  latestTradeEventTime = Math.max(latestTradeEventTime, time);
  return {
    id: Number(event?.a ?? event?.t) || `${time}-${price}-${quantity}`,
    price,
    quantity,
    quote: price * quantity,
    time,
    displayTime: Number.isFinite(arrivalTime) ? Math.max(time, arrivalTime) : time,
    tradeTime: time,
    eventTime: Number(event?.E ?? time),
    receivedAt,
    rxLatencyMs: null,
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
export const BOOK_DEPTH_PERCENT_PRESETS = [.25, .5, 1, 2, 5, 10, 20];

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

export function bookScaleIndexForWheel(currentIndex, deltaY) {
  const current = Math.max(
    0,
    Math.min(maximumBookScaleIndex(), Math.round(Number(currentIndex) || 0)),
  );
  const wheel = Number(deltaY);
  if (!Number.isFinite(wheel) || wheel === 0) return current;
  // Колесо вперёд (deltaY < 0) укрупняет шаг, назад — уменьшает.
  return Math.max(
    0,
    Math.min(maximumBookScaleIndex(), current + (wheel < 0 ? 1 : -1)),
  );
}

export function normalizeBookDepthPercent(value = 1) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 1;
  return BOOK_DEPTH_PERCENT_PRESETS.reduce(
    (nearest, candidate) => (
      Math.abs(candidate - requested) < Math.abs(nearest - requested)
        ? candidate
        : nearest
    ),
    BOOK_DEPTH_PERCENT_PRESETS[0],
  );
}

export function bookDepthLabel(value = 1) {
  return `±${normalizeBookDepthPercent(value).toLocaleString("ru-RU", {
    maximumFractionDigits: 2,
  })}%`;
}

export function priceStepForDepthPercent(
  baseTick,
  middlePrice,
  rowCount,
  depthPercent = 1,
) {
  const tick = Math.max(Number.EPSILON, Number(baseTick) || .01);
  const middle = Math.abs(Number(middlePrice));
  const halfRows = Math.max(2, Math.floor((Number(rowCount) || 5) / 2));
  const percent = normalizeBookDepthPercent(depthPercent);
  if (!Number.isFinite(middle) || middle <= 0) return tick;
  const requestedStep = middle * (percent / 100) / halfRows;
  const tickMultiple = Math.max(1, Math.round(requestedStep / tick));
  return Number((tickMultiple * tick).toPrecision(15));
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
      const quote = price * quantity;
      const sourceMaximum = Number(row?.maxLevelQuote ?? row?.[2]);
      return {
        price,
        quantity,
        quote,
        maxLevelQuote: Number.isFinite(sourceMaximum) && sourceMaximum > 0
          ? sourceMaximum
          : quote,
      };
    })
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.quantity) && row.quantity > 0)
    .sort((left, right) => side === "ask" ? left.price - right.price : right.price - left.price);
}

function aggregatedDepthRow(levels, side, displayPrice) {
  const quantity = levels.reduce((sum, level) => sum + level.quantity, 0);
  const quote = levels.reduce((sum, level) => sum + level.quote, 0);
  const maxLevel = levels.reduce(
    (best, level) => level.maxLevelQuote > best.maxLevelQuote ? level : best,
    levels[0],
  );
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
    maxLevelQuote: maxLevel.maxLevelQuote,
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
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const requestedCenter = Number.isFinite(Number(viewCenter)) ? Number(viewCenter) : market;
  if (!Number.isFinite(market) || !Number.isFinite(requestedCenter)) return [];
  const center = clampDepthViewCenter(requestedCenter, step, count);

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

  // Psychological levels are derived from the market price, never from the
  // current display step. Zooming the ladder must not change row emphasis.
  const majorUnit = bookPsychologicalPriceUnit(market);
  const normalizeGridPrice = (index) => Number((index * step).toPrecision(15));

  return Array.from({ length: count }, (_, offset) => {
    const index = topIndex - offset;
    const price = normalizeGridPrice(index);
    const source = price > market
      ? askBuckets.get(index)
      : price < market
        ? bidBuckets.get(index)
        : (bidBuckets.get(index) ?? askBuckets.get(index));

    const emphasis = bookPriceEmphasisForUnit(price, majorUnit);
    const isRound = emphasis.round;
    const isHalfRound = false;
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

export function maximumDepthQuote(bids, asks, priceStep, fullBookMaximum = null) {
  const stableMaximum = Number(fullBookMaximum);
  const values = [
    ...aggregateDepthByStep(bids, "bid", priceStep),
    ...aggregateDepthByStep(asks, "ask", priceStep),
  ];
  const aggregatedMaximum = Math.max(1, ...values.map((row) => Number(row.quote) || 0));
  return Number.isFinite(stableMaximum) && stableMaximum > 0
    ? Math.max(stableMaximum, aggregatedMaximum)
    : aggregatedMaximum;
}

export function clampDepthViewCenter(viewCenter, priceStep, rowCount) {
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const count = Math.max(3, Math.floor(Number(rowCount) || 3));
  const center = Number(viewCenter);
  if (!Number.isFinite(center)) return step * Math.floor(count / 2);
  const half = Math.floor(count / 2);
  const minimumAnchorIndex = Math.max(0, count - 1 - half);
  const anchorIndex = Math.max(minimumAnchorIndex, Math.round(center / step));
  return Number((anchorIndex * step).toPrecision(15));
}

export function marketAnchoredBookViewCenter(viewCenter, marketPrice, previousStep, nextStep, rowCount, snapToMarket = false) {
  const market = Number(marketPrice);
  const current = Number(viewCenter);
  const before = Math.max(Number.EPSILON, Number(previousStep) || Number(nextStep) || .01);
  const after = Math.max(Number.EPSILON, Number(nextStep) || before);
  if (!Number.isFinite(market)) return clampDepthViewCenter(current, after, rowCount);
  if (!Number.isFinite(current) || snapToMarket) return clampDepthViewCenter(market, after, rowCount);
  const convergence = Math.max(0, Math.min(1, after / before));
  return clampDepthViewCenter(market + (current - market) * convergence, after, rowCount);
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
  const threshold = Math.max(0, Number(minimumQuote) || 0);
  const safeLimit = Math.max(3, Math.floor(Number(limit) || 36));
  const ordered = [...(trades ?? [])]
    .filter((trade) => trade
      && [trade.price, trade.quote, trade.quantity, trade.time].every(Number.isFinite)
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
  const duration = Math.max(5_000, Number(durationMs) || 60_000);
  const safeNow = Number.isFinite(requestedNow) ? requestedNow : binanceClock.now();
  const latest = Number(latestTradeEventTime);
  const latestIsFresh = latest > 0
    && latest <= safeNow + 5_000
    && safeNow - latest <= duration;
  const liveAnchor = latestIsFresh ? latest : safeNow;
  const end = liveAnchor - Math.max(0, Number(offsetMs) || 0);
  return { start: end - duration, end, duration };
}

export function ensureFootprintLiveBucket(items, currentPrice, endTime, bucketMs = 5_000) {
  const source = Array.isArray(items) ? items : [];
  const price = Number(currentPrice);
  const end = Number(endTime);
  const duration = Math.max(250, Math.floor(Number(bucketMs) || 5_000));
  if (![price, end].every(Number.isFinite) || price <= 0) return source;
  const time = Math.floor(Math.max(0, end - 1) / duration) * duration;
  if (source.some((item) => Number(item?.time) === time)) return source;
  return [...source, {
    key: `empty-live:${time}`,
    time,
    price,
    quote: 0,
    buyQuote: 0,
    sellQuote: 0,
    count: 0,
    empty: true,
  }];
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
    { name: "combined-market", url: `wss://fstream.binance.com/market/stream?streams=${stream}`, subscribe: false },
    { name: "raw-market", url: `wss://fstream.binance.com/market/ws/${stream}`, subscribe: false },
  ];
}

function marketTransports(streams) {
  const joined = streams.join("/");
  return [
    {
      name: "combined-public",
      url: `wss://fstream.binance.com/public/stream?streams=${joined}`,
      subscribe: false,
    },
    {
      name: "raw-public",
      url: `wss://fstream.binance.com/public/ws/${joined}`,
      subscribe: false,
    },
  ];
}

async function fetchJsonWithTimeout(
  fetchImpl,
  url,
  timeoutMs = SNAPSHOT_TIMEOUT_MS,
  externalSignal = null,
) {
  let timer = null;
  let controller = null;
  const abortFromExternal = () => controller?.abort();
  try {
    controller = typeof AbortController === "function" ? new AbortController() : null;
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
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
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}

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
    this.mode = typeof this.fetchImpl === "function" ? "deep" : "partial";
    this.transportIndex = 0;
    this.tradeTransportIndex = 0;

    this.reconnectTimer = null;
    this.tradeReconnectTimer = null;
    this.firstDepthTimer = null;
    this.snapshotTimer = null;
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
    this.cachedSizeScaleMaxQuote = 1;
    this.cachedSizeAnomalyThresholdQuote = 1;
    this.cachedSizeAnomalyThresholdBidQuote = 1;
    this.cachedSizeAnomalyThresholdAskQuote = 1;
    this.resyncCount = 0;
    this.bookEvents = new globalThis.InPulsOrderBookEvents.DepthEventJournal();
    this.densityLifecycle = new globalThis.InPulsOrderBookDensity.DensityLifecycleTracker();
  }

  #diagnose(phase, details = {}) {
    observability.event("connection", phase, {
      symbol: this.symbol,
      runtime: "legacy",
      generation: this.generation,
      ...details,
    });
  }

  select(symbol) {
    if (!symbol?.endsWith("USDT")) return;
    this.symbol = symbol;
    this.bookEvents.setSymbol(symbol);
    this.densityLifecycle.setSymbol(symbol);
    this.mode = typeof this.fetchImpl === "function" ? "deep" : "partial";
    this.transportIndex = 0;
    this.tradeTransportIndex = 0;
    this.#resetBook("symbol-change");
    if (this.mode === "partial") {
      this.bookEvents.markUnavailable("partial-depth");
      this.densityLifecycle.markUnavailable("partial-depth");
    }
    this.trades = [];
    this.tradeIds.clear();

    clearTimeout(this.reconnectTimer);
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.tradeDispatchTimer);
    this.tradeDispatchTimer = null;
    this.tradeDispatchBatch = [];
    this.#dispatchTapeData({ replace: true, liveOnly: true, trades: [] });
    try { this.socket?.close(); } catch {}
    try { this.tradeSocket?.close(); } catch {}
    this.socket = null;
    this.tradeSocket = null;

    const generation = ++this.generation;
    this.#diagnose("legacy.feed.start", { state: "started" });
    this.onStatus({ state: "loading", text: "Подключение" });
    this.#connect(generation);
    this.#connectTrades(generation);
  }

  #resetBook(reason = "reset") {
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
    this.cachedSizeScaleMaxQuote = 1;
    this.cachedSizeAnomalyThresholdQuote = 1;
    this.cachedSizeAnomalyThresholdBidQuote = 1;
    this.cachedSizeAnomalyThresholdAskQuote = 1;
    const bookEpoch = this.bookEvents.reset(reason);
    this.densityLifecycle.reset({ bookEpoch, reason });
  }

  #dispatchTapeData(payload) {
    if (typeof globalThis.dispatchEvent !== "function" || typeof globalThis.CustomEvent !== "function") return;
    globalThis.dispatchEvent(new CustomEvent("inpuls:tape-data", {
      detail: { symbol: this.symbol, ...payload },
    }));
  }

  #queueTradeDispatch(trade) {
    if (!trade) return;
    this.tradeDispatchBatch.push(trade);
    if (this.tradeDispatchTimer) return;
    this.tradeDispatchTimer = setTimeout(() => {
      this.tradeDispatchTimer = null;
      const trades = this.tradeDispatchBatch.splice(0);
      if (trades.length) {
        this.#dispatchTapeData({
          replace: false,
          live: true,
          liveOnly: true,
          trades,
        });
      }
    }, 4);
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
      const quoteScale = bookQuoteScale(this.bids, this.asks);
      this.cachedSizeScaleMaxQuote = quoteScale.maximum;
      this.cachedSizeAnomalyThresholdQuote = quoteScale.anomalyThreshold;
      this.cachedSizeAnomalyThresholdBidQuote = quoteScale.bidAnomalyThreshold;
      this.cachedSizeAnomalyThresholdAskQuote = quoteScale.askAnomalyThreshold;
    }
    const fullView = this.cachedDepth;
    const view = globalThis.InPulsOrderBookDepthProjection.compactDepthView(fullView, {
      exactLimit: 900,
      densityLimit: 96,
      bandCount: 128,
    });
    if (!view.bids.length || !view.asks.length) return;
    const densityNow = Date.now();
    this.densityLifecycle.refresh({
      bids: fullView.bids,
      asks: fullView.asks,
      now: densityNow,
    });
    this.onData({
      symbol: this.symbol,
      ...view,
      trades: [],
      lastUpdateId: this.lastUpdateId,
      eventTime,
      depthReady: this.depthReady,
      coverage: depthCoverage(fullView.bids, fullView.asks),
      bookLevels: { bids: this.bids.size, asks: this.asks.size },
      sizeScaleMaxQuote: this.cachedSizeScaleMaxQuote,
      sizeAnomalyThresholdQuote: this.cachedSizeAnomalyThresholdQuote,
      sizeAnomalyThresholdBidQuote: this.cachedSizeAnomalyThresholdBidQuote,
      sizeAnomalyThresholdAskQuote: this.cachedSizeAnomalyThresholdAskQuote,
      resyncCount: this.resyncCount,
      orderBookEvents: this.bookEvents.summary(),
      densityLifecycle: this.densityLifecycle.summary(densityNow),
      depthProjection: view.metadata,
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
    const bookEvents = this.bookEvents.applyDiff({
      bids: this.bids,
      asks: this.asks,
      event: update,
      continuity: this.depthReady ? "live" : "recovered",
      receivedAt: Number(update?.__receivedAt) || Date.now(),
    });
    this.densityLifecycle.ingest(bookEvents);
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

    this.bids = new Map();
    this.asks = new Map();
    const snapshotReceivedAt = Date.now();
    const baseline = this.bookEvents.seedSnapshot({
      bids: this.bids,
      asks: this.asks,
      snapshot,
      receivedAt: snapshotReceivedAt,
    });
    this.densityLifecycle.seedSnapshot({
      bids: this.bids,
      asks: this.asks,
      bookEpoch: this.bookEvents.bookEpoch,
      receivedAt: snapshotReceivedAt,
    });
    this.lastUpdateId = baseline.snapshotId;

    for (let index = bridgeIndex; index < applicable.length; index += 1) {
      if (!this.#applyDepthEvent(applicable[index], index === bridgeIndex)) return false;
    }

    this.depthBuffer = [];
    this.pendingSnapshot = null;
    this.depthReady = true;
    this.cachedDepth = null;
    this.bookEvents.markReady();
    this.densityLifecycle.markReady();
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
    this.#diagnose("legacy.depth.snapshot", {
      state: "scheduled",
      hosts: hosts.length,
    });
    let snapshot = null;
    let winner = null;
    try {
      winner = await globalThis.InPulsOrderBookNetwork.firstSuccessful(
        hosts,
        async (host, { signal }) => {
          const candidate = await fetchJsonWithTimeout(
            this.fetchImpl,
            `https://${host}/fapi/v1/depth?symbol=${encodeURIComponent(this.symbol)}&limit=1000`,
            SNAPSHOT_TIMEOUT_MS,
            signal,
          );
          if (
            !Array.isArray(candidate?.bids)
            || !Array.isArray(candidate?.asks)
            || !Number.isFinite(Number(candidate?.lastUpdateId))
          ) throw new Error("invalid snapshot");
          return candidate;
        },
        {
          onAttempt: (event) => this.#diagnose("legacy.depth.snapshot.host", {
            ...event,
            host: event.target,
            target: undefined,
          }),
        },
      );
      snapshot = winner.value;
    } catch {}
    this.snapshotLoading = false;

    if (generation !== this.generation || this.mode !== "deep") return;
    if (!snapshot) {
      this.#diagnose("legacy.depth.snapshot", { state: "failed" });
      this.#activatePartial(generation);
      return;
    }

    this.#diagnose("legacy.depth.snapshot", {
      state: "succeeded",
      host: winner.target,
      durationMs: winner.durationMs,
      snapshotId: Number(snapshot.lastUpdateId),
    });
    this.pendingSnapshot = snapshot;
    this.#tryInstallSnapshot();
  }

  #activatePartial(generation) {
    if (generation !== this.generation || this.mode === "partial") return;
    this.mode = "partial";
    this.transportIndex = 0;
    this.#resetBook("partial-fallback");
    this.bookEvents.markUnavailable("partial-depth");
    this.densityLifecycle.markUnavailable("partial-depth");
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
    this.#resetBook(text === "Переполнение буфера" ? "buffer-overflow" : "sequence-gap");
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
          const matchedDensities = this.densityLifecycle.ingestTrades([trade]);
          if (matchedDensities.length) this.#emit(trade?.time ?? Date.now());
          this.#queueTradeDispatch(trade);
        }
        return;
      }

      const bidRows = update?.b ?? update?.bids;
      const askRows = update?.a ?? update?.asks;
      const isDepth = Array.isArray(bidRows) && Array.isArray(askRows);
      if (!isDepth) return;
      update.__receivedAt = Date.now();

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
      this.#resetBook("reconnect");
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
      const matchedDensities = this.densityLifecycle.ingestTrades([trade]);
      if (matchedDensities.length) this.#emit(trade?.time ?? Date.now());
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
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.tradeDispatchTimer);
    this.tradeDispatchTimer = null;
    this.tradeDispatchBatch = [];
    try { this.socket?.close(); } catch {}
    try { this.tradeSocket?.close(); } catch {}
    this.socket = null;
    this.tradeSocket = null;
  }
}


const ORDERBOOK_WORKER_URL = new URL("./orderbook-worker.js?v=26-115-series-visible-fallback-v1", import.meta.url);
const ORDERBOOK_WORKER_TAPE_EVENT = "inpuls:tape-data";
const ORDERBOOK_WORKER_STATUS_EVENT = "inpuls:book-status";
const ORDERBOOK_RESUBSCRIBE_STAGGER_MS = 180;
const ORDERBOOK_RESUME_PROBE_MS = 3_500;
const ORDERBOOK_PRIORITY_LIMIT = 12;

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
    this.resubscribeEpoch = 0;
    this.resumeProbeTimer = 0;
    this.resumeProbeToken = 0;
    this.prioritySymbols = [];
    this.workerStartedAt = 0;
    this.#start();
    this.#startHealthWatch();
  }

  #promoteSymbol(symbol) {
    const value = String(symbol ?? "").toUpperCase();
    if (!value.endsWith("USDT")) return;
    this.prioritySymbols = [
      value,
      ...this.prioritySymbols.filter((item) => item !== value),
    ].slice(0, ORDERBOOK_PRIORITY_LIMIT);
  }

  #orderedSymbols() {
    const active = [...this.clientsBySymbol.keys()];
    const activeSet = new Set(active);
    const priority = this.prioritySymbols.filter((symbol) => activeSet.has(symbol));
    const prioritySet = new Set(priority);
    return [...priority, ...active.filter((symbol) => !prioritySet.has(symbol))];
  }

  #visibilityPayload(visible) {
    return {
      type: "visibility",
      visible: Boolean(visible),
      prioritySymbols: visible ? this.#orderedSymbols() : [],
    };
  }

  #start() {
    if (typeof Worker !== "function") {
      this.failed = true;
      return;
    }
    try {
      this.workerStartedAt = performance.now();
      observability.event("connection", "worker.create", {
        state: "started",
        restartCount: this.restartCount,
      });
      // Worker не использует import/export, поэтому classic-режим надёжнее
      // module Worker в Chromium/Yandex при работе через Service Worker.
      this.worker = new Worker(ORDERBOOK_WORKER_URL, {
        name: "inpuls-density-trades-correlation-v1",
      });
      this.startupTimer = setTimeout(() => {
        if (this.workerReady) return;
        if (this.restartCount < 2) this.#restart("Таймаут запуска Worker");
        else this.#fail();
      }, 4_000);
      this.worker.addEventListener("message", (event) => this.#onMessage(event.data));
      this.worker.addEventListener("error", (event) => {
        observability.event("connection", "worker.error", {
          state: "failed",
          message: String(event?.message || event || "Worker error").slice(0, 180),
        });
        console.error("InPuls orderbook Worker error", event?.message || event);
        this.#restart(event?.message || "Ошибка Worker");
      });
      this.worker.addEventListener("messageerror", () => this.#restart("Ошибка сообщения Worker"));
      const visible = typeof document === "undefined" || !document.hidden;
      this.lastHeartbeatAt = Date.now();
      this.worker.postMessage(this.#visibilityPayload(visible));
      this.worker.postMessage({ type: "observability", enabled: observability.enabled });
      if (typeof document !== "undefined" && !this.visibilityHandler) {
        this.visibilityHandler = () => {
          const visible = !document.hidden;
          this.resumeProbeToken += 1;
          clearTimeout(this.resumeProbeTimer);
          this.resumeProbeTimer = 0;

          if (!visible) {
            if (this.worker && !this.failed) {
              this.worker.postMessage(this.#visibilityPayload(false));
            }
            return;
          }

          if (!this.worker || this.failed) return;
          const probeToken = this.resumeProbeToken;
          this.lastHeartbeatAt = Date.now();
          this.worker.postMessage(this.#visibilityPayload(true));

          // Сначала даём существующему Worker продолжить работу. Полный
          // перезапуск нужен только если он действительно не проснулся.
          this.resumeProbeTimer = setTimeout(() => {
            this.resumeProbeTimer = 0;
            if (document.hidden || this.failed || !this.worker || probeToken !== this.resumeProbeToken) return;
            this.#restart("Worker не проснулся после фона");
          }, ORDERBOOK_RESUME_PROBE_MS);
        };
        document.addEventListener("visibilitychange", this.visibilityHandler);
      }
    } catch (error) {
      observability.event("connection", "worker.create", {
        state: "failed",
        message: String(error?.message ?? error ?? "Worker creation failed").slice(0, 180),
      });
      this.#fail();
    }
  }

  #startHealthWatch() {
    if (this.failed || this.healthTimer || typeof setInterval !== "function") return;
    this.healthTimer = setInterval(() => {
      if (this.failed || this.restarting || !this.worker || !this.workerReady) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const age = Date.now() - this.lastHeartbeatAt;
      if (age > 9_000) this.#restart(`Worker не отвечает ${Math.round(age / 1_000)}с`);
    }, 2_500);
  }

  #notifyAll(status) {
    for (const [symbol, ids] of this.clientsBySymbol) {
      this.lastStatusBySymbol.set(symbol, status);
      if (typeof globalThis.dispatchEvent === "function"
        && typeof globalThis.CustomEvent === "function") {
        globalThis.dispatchEvent(new CustomEvent(ORDERBOOK_WORKER_STATUS_EVENT, {
          detail: { symbol, status },
        }));
      }
      for (const id of ids) {
        this.clients.get(id)?._receiveStatus(status);
      }
    }
  }

  #restart(reason = "Перезапуск Worker") {
    if (this.failed || this.restarting) return;
    observability.event("connection", "worker.restart", {
      state: "started",
      reason,
      restartCount: this.restartCount + 1,
    });
    this.restarting = true;
    this.restartCount += 1;
    this.needsResubscribe = true;
    this.resubscribeEpoch += 1;
    console.warn("InPuls orderbook Worker restart", reason);
    clearTimeout(this.startupTimer);
    this.startupTimer = 0;
    clearTimeout(this.resumeProbeTimer);
    this.resumeProbeTimer = 0;
    this.resumeProbeToken += 1;
    this.workerReady = false;
    try { this.worker?.terminate(); } catch {}
    this.worker = null;
    this.lastHeartbeatAt = Date.now();
    this.#notifyAll({ state: "stale", text: "СИНХРОНИЗАЦИЯ · последний кадр" });

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
    this.prioritySymbols = this.prioritySymbols.filter((item) => item !== symbol);
    this.lastDataBySymbol.delete(symbol);
    this.lastStatusBySymbol.delete(symbol);
    if (this.available()) this.worker.postMessage({ type: "unsubscribe", symbol });
  }

  select(id, previousSymbol, symbol) {
    this.#promoteSymbol(symbol);
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
    this.worker.postMessage({
      type: "priority",
      prioritySymbols: this.#orderedSymbols(),
    });

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
    observability.workerMessage(message);
    this.lastHeartbeatAt = Date.now();
    clearTimeout(this.resumeProbeTimer);
    this.resumeProbeTimer = 0;
    this.resumeProbeToken += 1;
    if (message.type === "ready") {
      this.workerReady = true;
      this.restartCount = 0;
      observability.event("connection", "worker.ready", {
        state: "ready",
        durationMs: this.workerStartedAt ? performance.now() - this.workerStartedAt : null,
      });
      clearTimeout(this.startupTimer);
      this.startupTimer = 0;
      const visible = typeof document === "undefined" || !document.hidden;
      this.worker?.postMessage(this.#visibilityPayload(visible));
      if (this.needsResubscribe) {
        const worker = this.worker;
        const epoch = ++this.resubscribeEpoch;
        const symbols = this.#orderedSymbols();
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
      if (typeof globalThis.dispatchEvent === "function"
        && typeof globalThis.CustomEvent === "function") {
        globalThis.dispatchEvent(new CustomEvent(ORDERBOOK_WORKER_STATUS_EVENT, {
          detail: { symbol, status },
        }));
      }
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
          live: Boolean(message.live),
          liveOnly: Boolean(message.liveOnly),
          trades: Array.isArray(message.trades) ? message.trades : [],
          aggregationTrades: Array.isArray(message.aggregationTrades) ? message.aggregationTrades : [],
          aggregationSource: message.aggregationSource === "raw" ? "raw" : "agg",
          aggregationHealth: message.aggregationHealth ?? null,
          seriesTrades: Array.isArray(message.seriesTrades) ? message.seriesTrades : [],
          seriesReplace: Boolean(message.seriesReplace),
          seriesSource: message.seriesSource === "raw" ? "raw" : "warming",
          seriesHealth: message.seriesHealth ?? null,
        },
      }));
    }
  }

  #fail() {
    if (this.failed) return;
    observability.event("connection", "worker.fallback", {
      state: "activated",
      reason: "worker-unavailable",
    });
    this.failed = true;
    clearTimeout(this.startupTimer);
    this.startupTimer = 0;
    clearTimeout(this.resumeProbeTimer);
    this.resumeProbeTimer = 0;
    this.resumeProbeToken += 1;
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

const ORDERBOOK_RUNTIME_STYLE_ID = "inpuls-orderbook-runtime-26-91-runtime-boot-cache-feed-v1";
const TAPE_EVENT_NAME = "inpuls:tape-data";
const BOOK_DATA_EVENT_NAME = "inpuls:book-data";
const FLOW_LAYER_VISIBILITY_EVENT = "inpuls:flow-layer-visibility";
const TAPE_MAX_STORED = 4_000;
const TAPE_MAX_RAW_VISIBLE = TAPE_MAX_STORED;
const TAPE_MAX_AGG_VISIBLE = 1_000;
const TAPE_RETENTION_MS = 2 * 60_000;
const TAPE_LIVE_EDGE_GUTTER_PX = 10;
const TAPE_SECOND_MS = 1_000;
const TAPE_LIVE_EDGE_LEAD_MS = 0;
const TAPE_MIN_SECOND_WIDTH = 22;
const TAPE_MIN_SECONDS = 12;
const TAPE_MAX_SECONDS = 45;
const TAPE_TIMELINE_MIN_LABEL_GAP_PX = 42;
const TAPE_PRICE_VIEWPORT_TAU_MS = 90;
const TAPE_CLOCK_CORRECTION_TAU_MS = 120;
const TAPE_VIEWPORT_SAMPLE_MS = 50;
const RAW_TAPE_MARKER_BUCKETS = 8;
const TAPE_STALE_NOTICE_MS = 3_000;
const TAPE_STATE_REFRESH_MS = 1_000;
const TAPE_FREEZE_AFTER_MS = 2_500;
const TAPE_MODE_KEY = "inpuls-tape-mode-v2";
const TAPE_MIN_FILTER_KEY = "inpuls-tape-min-filter-v3";
const TAPE_TIME_SCALE_KEY = "inpuls-tape-time-scale-v1";
const TAPE_TIME_SCALE_MIN = 35;
const TAPE_TIME_SCALE_MAX = 300;
const TAPE_TIME_SCALE_DEFAULT = 100;
const DENSITY_AGE_VISIBLE_KEY = "inpuls-density-age-visible-v1";
export const TAPE_AGGREGATION_PERIOD_MS = 0;
export const TAPE_SERIES_MAX_GAP_MS = 500;
export const TAPE_MODES = Object.freeze(["raw", "agg", "series"]);

export function normalizeTapeMode(value) {
  const mode = String(value ?? "").toLowerCase();
  return TAPE_MODES.includes(mode) ? mode : "raw";
}

export function nextTapeMode(value) {
  const mode = normalizeTapeMode(value);
  return TAPE_MODES[(TAPE_MODES.indexOf(mode) + 1) % TAPE_MODES.length];
}
const TAPE_VISIBLE_KEY = "inpuls-tape-visible-v1";
const CLUSTERS_VISIBLE_KEY = "inpuls-clusters-visible-v1";

const tapeTradesBySymbol = new Map();
const tapeAggregationTradesBySymbol = new Map();
const tapeSeriesTradesBySymbol = new Map();
const latestBookDataBySymbol = new Map();
const tapeMetaBySymbol = new Map();
const bookStatusBySymbol = new Map();
const tapePendingBySymbol = new Map();
const liquidityTimersBySymbol = new Map();
const liquidityLastDrawBySymbol = new Map();
const tapeRecentRateBySymbol = new Map();
const tapeDataVersionBySymbol = new Map();
const tapeCardStates = new WeakMap();
const boundTapeCards = new Set();
let tapeDrawFrame = 0;
let tapeDrawTimer = 0;
let tapeLastDrawAt = 0;
let tapeNeedsDraw = true;
let tapeDocumentHidden = typeof document !== "undefined" ? document.hidden : false;
let tapeStateTimer = 0;
let tapeIngestFrame = 0;

const TAPE_INGEST_PER_FRAME = 220;
const TAPE_RESUME_MAX_PENDING = 500;
const TAPE_LIVE_MAX_PENDING = 900;
const TAPE_DRAW_BUDGET_MS = 8;
const TAPE_DRAW_MAX_CARDS = 2;
const LIQUIDITY_REFRESH_MS = 420;

const BOOK_SPLIT_STORAGE_KEY = "inpuls-orderbook-split-v3";
const BOOK_MIN_TAPE_PX = 58;
const BOOK_MIN_LADDER_PX = 96;
const bookInteractionStates = new WeakMap();
const dirtyTapeCards = new Set();
let tapeDrawAllRequested = true;
let cachedTapeSurfaceColor = null;

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

export function resolveTapeWindowEnd(latestTime, frozen, now = binanceClock.now()) {
  const latest = Number(latestTime) || Number(now) || Date.now();
  return latest + (frozen ? 1 : TAPE_LIVE_EDGE_LEAD_MS);
}

function tapeRecoveryFrozen(symbol) {
  const status = bookStatusBySymbol.get(symbol);
  if (!status) return false;
  const state = String(status.state ?? "").toLowerCase();
  const text = String(status.text ?? "").toUpperCase();
  const tapeStateKnown = text.includes("RAW") || text.includes("AGG") || text.includes("TAPE");
  const tapeLive = text.includes("RAW SHADOW") || text.includes("AGG LIVE");
  return state !== "online" || (tapeStateKnown && !tapeLive);
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
      background: var(--panel) !important;
    }
    .orderbook-card .trade-flow .book-hover-percent {
      position: absolute !important;
      z-index: 12 !important;
      right: 1px !important;
      left: auto !important;
      width: 34px !important;
      height: 18px !important;
      box-sizing: border-box;
      display: grid !important;
      place-items: center;
      padding: 0 !important;
      border-radius: 2px !important;
      transform: translateY(-50%) !important;
      pointer-events: none !important;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .orderbook-card .orderbook-tape,
    .orderbook-card .trade-tape-body {
      background: var(--panel) !important;
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
      border: 1px solid var(--line-soft);
      border-radius: 6px;
      background: color-mix(in srgb, var(--panel) 92%, transparent);
      color: var(--muted);
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
      border: 1px solid var(--line-soft);
      border-radius: 4px;
      background: color-mix(in srgb, var(--panel) 92%, transparent);
      color: var(--muted);
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
      border: 1px solid var(--line-soft);
      border-radius: 4px;
      background: color-mix(in srgb, var(--panel-2) 90%, transparent);
      color: var(--muted);
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
      color: var(--text);
      font: 700 10px/20px Inter, system-ui, sans-serif;
    }
    .orderbook-card .inpuls-tape-time-scale {
      flex: 0 1 174px;
      min-width: 156px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 4px;
      border: 1px solid var(--line-soft);
      border-radius: 4px;
      background: color-mix(in srgb, var(--panel-2) 90%, transparent);
      color: var(--muted);
      font: 800 7px/1 Inter, system-ui, sans-serif;
    }
    .orderbook-card .inpuls-tape-time-scale input {
      flex: 1 1 118px;
      width: 118px;
      min-width: 92px;
      accent-color: var(--accent);
      cursor: ew-resize;
    }
    .orderbook-card .inpuls-tape-mode {
      margin-left: auto;
      min-width: 58px;
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
    .orderbook-card .inpuls-tape-mode[data-mode="series"] {
      color: #d8b3ff;
      border-color: rgba(170, 134, 255, .52);
      background: rgba(170, 134, 255, .11);
    }
    .orderbook-card .inpuls-agg-step {
      width: 22px;
      min-width: 22px;
      height: 22px;
      padding: 0;
      border-radius: 4px;
      font-weight: 900;
    }
    .orderbook-card .inpuls-agg-step:disabled {
      opacity: .28;
      cursor: default;
    }
    .orderbook-card .inpuls-density-age-toggle {
      min-width: 42px;
      height: 18px;
      padding: 0 4px;
      border: 1px solid var(--line-soft);
      border-radius: 4px;
      background: var(--panel-2);
      color: var(--muted);
      font: 800 8px/1 Inter, system-ui, sans-serif;
      cursor: pointer;
    }
    .orderbook-card .inpuls-density-age-toggle.is-active {
      color: #5de1b5;
      border-color: rgba(93, 225, 181, .45);
      background: rgba(45, 179, 132, .1);
    }
    .orderbook-card .book-size[data-density-age]::after {
      content: attr(data-density-age);
      position: absolute;
      z-index: 3;
      right: 2px;
      top: 50%;
      transform: translateY(-50%);
      min-width: 27px;
      padding: 1px 3px;
      border: 1px solid rgba(224, 235, 239, .28);
      border-radius: 3px;
      background: rgba(4, 8, 11, .82);
      color: #e7f0f3;
      font: 800 7px/1 Inter, system-ui, sans-serif;
      text-align: center;
      font-variant-numeric: tabular-nums;
      pointer-events: none;
    }
    .orderbook-card .orderbook-heading [data-book-ticker] {
      max-width: min(38%, 210px);
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
      column-gap: 4px !important;
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
      z-index: 0;
      padding: 0 5px 0 2px;
      border-right: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
      justify-content: flex-start;
      color: #050708 !important;
      text-align: left;
      text-shadow: none !important;
      font-weight: 850 !important;
    }
    .orderbook-card .book-ladder-row strong {
      width: 100% !important;
      min-width: 0 !important;
      overflow: hidden !important;
      padding: 0 1px 0 2px !important;
      border-left: 0 !important;
      justify-self: stretch !important;
      justify-content: flex-start !important;
      text-align: left !important;
      white-space: nowrap;
    }
    .orderbook-card .book-ladder-row .book-size::before {
      right: auto !important;
      left: 0 !important;
      width: var(--size) !important;
      max-width: 100% !important;
      min-width: 0 !important;
      opacity: .86 !important;
      transform-origin: left center !important;
    }
    .orderbook-card .book-ladder-row .book-size {
      overflow: hidden !important;
      isolation: isolate;
    }
    .orderbook-card .book-ladder-row.is-bid .book-size::before {
      background: var(--green) !important;
    }
    .orderbook-card .book-ladder-row.is-ask .book-size::before {
      background: var(--red) !important;
    }
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) {
      background: transparent !important;
      box-shadow: none !important;
    }
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) strong {
      border-left: 2px solid color-mix(in srgb, var(--accent) 72%, #fff);
      color: inherit !important;
      font-size: inherit !important;
      font-weight: 800 !important;
      text-shadow: none !important;
      letter-spacing: 0 !important;
    }
    .orderbook-card .book-ladder-row.is-market strong {
      color: #f6fbfd !important;
      text-shadow: 0 1px 2px rgba(0, 0, 0, .92);
      font-weight: 900 !important;
    }
    .orderbook-card .book-ladder-row.is-anomaly .book-size,
    .orderbook-card .book-ladder-row.is-market .book-size {
      color: #050708 !important;
      text-shadow: none !important;
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
    .orderbook-card.is-flow-hidden .orderbook-stage:not(.inpuls-flow-workspace) {
      grid-template-columns: 0 0 minmax(0, 1fr) !important;
    }
    .orderbook-card.is-flow-hidden .orderbook-ladder {
      min-width: 0 !important;
    }
    .orderbook-card.is-flow-hidden .orderbook-stage:not(.inpuls-flow-workspace) .orderbook-tape,
    .orderbook-card.is-flow-hidden .orderbook-stage:not(.inpuls-flow-workspace) .book-splitter {
      display: none !important;
    }
    .orderbook-card .inpuls-layer-dock {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
    }
    .orderbook-card .orderbook-heading > .inpuls-layer-dock {
      margin-left: 1px;
    }
    .orderbook-card .inpuls-liquidity-meter {
      position: absolute;
      left: 4px;
      right: 4px;
      top: 22px;
      z-index: 35;
      height: 18px;
      display: grid;
      grid-template-columns: var(--liq-bid, 50%) var(--liq-ask, 50%);
      overflow: hidden;
      border: 1px solid rgba(92, 119, 132, .2);
      border-radius: 4px;
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
      font: 850 9px/1 Inter, system-ui, sans-serif;
      letter-spacing: .005em;
      text-shadow: 0 1px 2px #000;
      white-space: nowrap;
    }
    .orderbook-card .orderbook-rows {
      padding-top: 19px;
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

function stableBookPsychologicalUnit(card, referencePrice) {
  const symbol = cardSymbol(card) ?? "";
  if (card.dataset.inpulsPsychologicalSymbol !== symbol) {
    card.dataset.inpulsPsychologicalSymbol = symbol;
    delete card.dataset.inpulsPsychologicalUnit;
  }
  const saved = Number(card.dataset.inpulsPsychologicalUnit);
  if (Number.isFinite(saved) && saved > 0) return saved;
  const unit = bookPsychologicalPriceUnit(referencePrice);
  if (Number.isFinite(unit) && unit > 0) {
    card.dataset.inpulsPsychologicalUnit = String(unit);
    return unit;
  }
  return null;
}

function decorateRuntimeBookRows(card) {
  const rows = [...card.querySelectorAll(".orderbook-rows .book-ladder-row")];
  const priceElements = rows
    .map((row) => row.querySelector("strong"))
    .filter(Boolean);

  const prices = rows
    .map((row) => parseRuntimeNumber(row.querySelector("strong")?.textContent))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const referencePrice = prices.length
    ? prices[Math.floor((prices.length - 1) / 2)]
    : null;
  const majorUnit = stableBookPsychologicalUnit(card, referencePrice);
  for (const row of rows) {
    const price = parseRuntimeNumber(row.querySelector("strong")?.textContent);
    const emphasis = bookPriceEmphasisForUnit(price, majorUnit);
    row.classList.toggle("is-price-round", emphasis.round);
    row.classList.remove("is-price-half");
  }

  const maximumTextPixels = priceElements.reduce((maximum, element) => {
    let measured = 0;
    try {
      const range = document.createRange();
      range.selectNodeContents(element);
      measured = range.getBoundingClientRect().width;
      range.detach?.();
    } catch {}
    if (!Number.isFinite(measured) || measured <= 0) measured = element.scrollWidth;
    return Math.max(maximum, Number(measured) || 0);
  }, 0);
  if (maximumTextPixels > 0) {
    const symbol = cardSymbol(card) ?? "";
    if (card.dataset.inpulsPriceWidthSymbol !== symbol) {
      card.dataset.inpulsPriceWidthSymbol = symbol;
      card.dataset.inpulsPriceWidthPx = "0";
    }
    const previousWidth = Number(card.dataset.inpulsPriceWidthPx) || 0;
    // Measure the actual enlarged round/half-round text, not only its chars.
    const width = Math.max(previousWidth, Math.ceil(maximumTextPixels + 10));
    card.dataset.inpulsPriceWidthPx = String(width);
    card.style.setProperty("--book-price-width", `${width}px`);
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
  if (!button) return;
  const mode = normalizeTapeMode(state.mode);
  const aggregationSource = state.aggregationSource === "raw" ? "@trade RAW" : "@aggTrade fallback";
  const seriesReady = state.seriesRenderSource === "raw";
  button.textContent = mode === "series" ? "СЕРИЯ" : mode.toUpperCase();
  button.dataset.mode = mode;
  button.dataset.aggregationSource = state.aggregationSource === "raw" ? "raw" : "agg";
  button.dataset.seriesSource = seriesReady ? "raw" : "agg";
  button.classList.toggle("is-active", mode !== "raw");
  button.setAttribute("aria-pressed", String(mode !== "raw"));
  button.setAttribute("aria-label", `Режим ленты ${button.textContent}. Нажмите для переключения.`);
  if (mode === "series") {
    button.title = seriesReady
      ? `СЕРИЯ RAW ≤${TAPE_SERIES_MAX_GAP_MS} мс: непрерывный агрессивный покупатель или продавец. Первая встречная рыночная сделка немедленно закрывает серию.`
      : `СЕРИЯ AGG ≤${TAPE_SERIES_MAX_GAP_MS} мс: стабильный fallback по taker-агрессору. При подтверждённом непрерывном @trade источник автоматически переключается на RAW.`;
  } else if (mode === "agg") {
    button.title = `AGG 0 мс · ${aggregationSource}: объединяются последовательные исполнения с одинаковым биржевым временем и направлением.`;
  } else {
    button.title = "RAW: каждое исполнение стабильного визуального @aggTrade-потока отображается отдельно";
  }
}

function formatObservedAge(value) {
  const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}с`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}м${String(seconds).padStart(2, "0")}с`;
  const hours = Math.floor(minutes / 60);
  return `${hours}ч${String(minutes % 60).padStart(2, "0")}м`;
}

function decorateDensityAges(card, state = tapeCardStates.get(card)) {
  if (!state?.densityAgeVisible) {
    if (state?.densityAgeDecorated) {
      card.querySelectorAll(".orderbook-rows .book-size[data-density-age]").forEach((size) => {
        size.removeAttribute("data-density-age");
        if (size.title?.startsWith("Наблюдаемый возраст плотности")) size.removeAttribute("title");
      });
      state.densityAgeDecorated = false;
    }
    return;
  }
  const rows = [...card.querySelectorAll(".orderbook-rows .book-ladder-row")];
  for (const row of rows) row.querySelector(".book-size")?.removeAttribute("data-density-age");
  state.densityAgeDecorated = false;
  const symbol = cardSymbol(card);
  const data = symbol ? latestBookDataBySymbol.get(symbol) : null;
  const densities = data?.densityLifecycle?.densities;
  if (!Array.isArray(densities) || !densities.length) return;
  const step = Math.max(Number.EPSILON, runtimePriceStep(card) || 0);
  const now = Date.now();
  for (const row of rows) {
    if (!row.classList.contains("is-anomaly")) continue;
    const price = parseRuntimeNumber(row.querySelector("strong")?.textContent);
    const side = row.classList.contains("is-ask") ? "ask" : "bid";
    if (!Number.isFinite(price)) continue;
    const matches = densities.filter((density) => (
      density?.side === side
      && Number.isFinite(Number(density?.price))
      && Math.abs(Number(density.price) - price) <= Math.max(Number.EPSILON, step * .55)
    ));
    if (!matches.length) continue;
    matches.sort((left, right) => Number(right.currentQuote) - Number(left.currentQuote));
    const density = matches[0];
    const observedAt = Number(density.firstObservedAt);
    const age = Number.isFinite(observedAt)
      ? Math.max(0, now - observedAt)
      : Math.max(0, Number(density.ageMs) || 0);
    const size = row.querySelector(".book-size");
    if (size) {
      const ageLabel = formatObservedAge(age);
      size.dataset.densityAge = ageLabel;
      size.title = `Наблюдаемый возраст плотности ${ageLabel} · ${density.state || "active"}`;
      state.densityAgeDecorated = true;
    }
  }
}

function syncDensityAgeButton(button, state, card) {
  if (!button) return;
  button.classList.toggle("is-active", state.densityAgeVisible);
  button.setAttribute("aria-pressed", String(state.densityAgeVisible));
  button.title = state.densityAgeVisible
    ? "Скрыть наблюдаемый возраст аномальных плотностей"
    : "Показать наблюдаемый возраст аномальных плотностей";
  card.classList.toggle("is-density-age-visible", state.densityAgeVisible);
}

function syncLayerButtons(card, state) {
  const tapeButton = state.layerControls?.querySelector("[data-inpuls-tape-visible]");
  const clustersButton = state.layerControls?.querySelector("[data-inpuls-clusters-visible]");
  tapeButton?.classList.toggle("is-active", state.tapeVisible);
  tapeButton?.setAttribute("aria-pressed", String(state.tapeVisible));
  clustersButton?.classList.toggle("is-active", state.clustersVisible);
  clustersButton?.setAttribute("aria-pressed", String(state.clustersVisible));
  card.classList.toggle("is-tape-hidden", !state.tapeVisible);
  card.classList.toggle("is-clusters-hidden", !state.clustersVisible);
  card.classList.toggle("is-flow-hidden", !state.tapeVisible && !state.clustersVisible);
}

function notifyFlowLayerVisibility(card, state) {
  globalThis.dispatchEvent?.(new CustomEvent(FLOW_LAYER_VISIBILITY_EVENT, {
    detail: {
      card,
      tapeVisible: state.tapeVisible,
      clustersVisible: state.clustersVisible,
    },
  }));
}

function ensureTapeUi(card) {
  arrangeOrderBookChrome(card);
  disableLegacyBookCenter(card);
  applyStoredBookSplit(card);
  decorateRuntimeBookRows(card);
  const flow = card.querySelector(".trade-flow");
  const toolbar = card.querySelector(".trade-tape-toolbar");
  if (!flow || !toolbar) return null;
  flow.dataset.inpulsTapeRenderer = "canvas";

  let state = tapeCardStates.get(card);
  if (!state) {
    const savedMinimum = localStorage.getItem(TAPE_MIN_FILTER_KEY);
    const savedTimeScale = localStorage.getItem(TAPE_TIME_SCALE_KEY);
    state = {
      canvas: null,
      context: null,
      mode: normalizeTapeMode(localStorage.getItem(TAPE_MODE_KEY)),
      densityAgeVisible: localStorage.getItem(DENSITY_AGE_VISIBLE_KEY) === "1",
      densityAgeDecorated: false,
      minQuote: savedMinimum === null ? 0 : Math.max(0, Number(savedMinimum) || 0),
      timeScale: clampTape(
        savedTimeScale === null ? TAPE_TIME_SCALE_DEFAULT : Number(savedTimeScale),
        TAPE_TIME_SCALE_MIN,
        TAPE_TIME_SCALE_MAX,
      ),
      aggregationSource: "agg",
      seriesSource: "warming",
      seriesRenderSource: "agg",
      seriesHealth: null,
      tapeVisible: localStorage.getItem(TAPE_VISIBLE_KEY) !== "0",
      clustersVisible: localStorage.getItem(CLUSTERS_VISIBLE_KEY) !== "0",
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
      hasFrame: false,
      lastRenderSignature: null,
      clockEndTime: null,
      clockPerfAt: null,
      priceViewport: null,
      priceViewportAt: null,
      targetPriceViewport: null,
      priceRange: null,
      viewportSampleAt: null,
      viewportDirty: true,
      renderModelKey: null,
      rawNodeByKey: new Map(),
      rawRenderNodes: [],
      aggSourceBuckets: [],
      aggSnapshots: new Map(),
      seriesSourceBuckets: [],
      seriesSnapshots: new Map(),
      recentRawScratch: [],
      finalizedAggScratch: [],
      closedAggScratch: [],
      finalizedSeriesScratch: [],
      closedSeriesScratch: [],
      candidateScratch: [],
      pathProjectionScratch: [],
      markerProjectionScratch: [],
      rawMarkerBatches: Array.from({ length: RAW_TAPE_MARKER_BUCKETS * 2 }, () => []),
      lastStatusText: null,
      lastStatusTone: null,
      lastRangeAbove: null,
      lastRangeBelow: null,
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
    state.context = canvas.getContext("2d", { alpha: false, desynchronized: false });
  }

  if (!state.status?.isConnected || state.status.parentElement !== flow) {
    state.status?.remove();
    const status = document.createElement("div");
    status.className = "inpuls-tape-state";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    flow.append(status);
    state.status = status;
    state.lastStatusText = null;
    state.lastStatusTone = null;
  }

  if (!state.rangeSummary?.isConnected || state.rangeSummary.parentElement !== flow) {
    state.rangeSummary?.remove();
    const summary = document.createElement("div");
    summary.className = "inpuls-tape-range-summary";
    summary.innerHTML = '<span data-inpuls-tape-above></span><span data-inpuls-tape-below></span>';
    flow.append(summary);
    state.rangeSummary = summary;
    state.lastRangeAbove = null;
    state.lastRangeBelow = null;
  }

  const nativeMinimum = toolbar.querySelector("[data-trade-min]");
  nativeMinimum?.closest("label")?.classList.add("inpuls-native-min-filter");

  if (!state.controls?.isConnected) {
    const controls = document.createElement("div");
    controls.className = "inpuls-tape-controls";
    controls.innerHTML = `
      <label class="inpuls-tape-filter" title="Показывать маркеры RAW/AGG/СЕРИЯ не меньше указанного объёма. Линия строится по всем сделкам.">
        <span>ОТ $</span>
        <input data-inpuls-trade-min type="number" min="0" step="100" value="${state.minQuote}" aria-label="Минимальный объём отображаемой сделки или агрегата" />
      </label>
      <label class="inpuls-tape-time-scale" title="Точный временной масштаб ленты. История ограничена последними двумя минутами.">
        <span>ВРЕМЯ</span>
        <input data-inpuls-tape-time-scale type="range" min="${TAPE_TIME_SCALE_MIN}" max="${TAPE_TIME_SCALE_MAX}" step="1" value="${state.timeScale}" aria-label="Временной масштаб ленты" />
      </label>
      <button data-inpuls-tape-mode class="inpuls-tape-mode" type="button"></button>`;
    toolbar.append(controls);
    state.controls = controls;

    const minInput = controls.querySelector("[data-inpuls-trade-min]");
    const timeScaleInput = controls.querySelector("[data-inpuls-tape-time-scale]");
    const modeButton = controls.querySelector("[data-inpuls-tape-mode]");
    const syncTimeScale = () => {
      state.timeScale = clampTape(
        Number(timeScaleInput.value) || TAPE_TIME_SCALE_DEFAULT,
        TAPE_TIME_SCALE_MIN,
        TAPE_TIME_SCALE_MAX,
      );
      timeScaleInput.value = String(state.timeScale);
      localStorage.setItem(TAPE_TIME_SCALE_KEY, String(state.timeScale));
      scheduleTapeDraw(true, card);
    };
    const applyMinimum = () => {
      state.minQuote = Math.max(0, Number(minInput.value) || 0);
      localStorage.setItem(TAPE_MIN_FILTER_KEY, String(state.minQuote));
      scheduleTapeDraw(true, card);
    };
    minInput.addEventListener("input", applyMinimum);
    minInput.addEventListener("change", applyMinimum);
    timeScaleInput.addEventListener("input", syncTimeScale);
    timeScaleInput.addEventListener("change", syncTimeScale);
    modeButton.addEventListener("click", () => {
      state.mode = nextTapeMode(state.mode);
      localStorage.setItem(TAPE_MODE_KEY, state.mode);
      syncTapeModeButton(modeButton, state);
      scheduleTapeDraw(true, card);
    });
    syncTapeModeButton(modeButton, state);
    syncLayerButtons(card, state);
  } else {
    const minInput = state.controls.querySelector("[data-inpuls-trade-min]");
    const timeScaleInput = state.controls.querySelector("[data-inpuls-tape-time-scale]");
    if (minInput && document.activeElement !== minInput) minInput.value = String(state.minQuote);
    if (timeScaleInput && document.activeElement !== timeScaleInput) timeScaleInput.value = String(state.timeScale);
    syncTapeModeButton(state.controls.querySelector("[data-inpuls-tape-mode]"), state);
  }

  if (flow.dataset.inpulsTapeShiftWheel !== "1") {
    flow.dataset.inpulsTapeShiftWheel = "1";
    flow.addEventListener("wheel", (event) => {
      if (!event.shiftKey || !Number.isFinite(Number(event.deltaY)) || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const activeState = tapeCardStates.get(card);
      if (!activeState) return;
      activeState.timeScale = clampTape(
        activeState.timeScale + (event.deltaY < 0 ? -10 : 10),
        TAPE_TIME_SCALE_MIN,
        TAPE_TIME_SCALE_MAX,
      );
      localStorage.setItem(TAPE_TIME_SCALE_KEY, String(activeState.timeScale));
      const input = activeState.controls?.querySelector("[data-inpuls-tape-time-scale]");
      if (input) input.value = String(activeState.timeScale);
      scheduleTapeDraw(true, card);
    }, { passive: false });
  }

  const heading = card.querySelector(".orderbook-heading");
  const ticker = heading?.querySelector("[data-book-ticker]");
  if (heading && ticker && (!state.layerControls?.isConnected || state.layerControls.parentElement !== heading)) {
    state.layerControls?.remove();
    const layerControls = document.createElement("div");
    layerControls.className = "inpuls-layer-dock";
    layerControls.innerHTML = `
      <button data-inpuls-clusters-visible class="inpuls-layer-toggle" type="button" title="Показать или скрыть footprint-кластеры">КЛАСТЕРЫ</button>
      <button data-inpuls-tape-visible class="inpuls-layer-toggle" type="button" title="Показать или скрыть ленту">ЛЕНТА</button>`;
    ticker.after(layerControls);
    state.layerControls = layerControls;

    layerControls.querySelector("[data-inpuls-tape-visible]").addEventListener("click", () => {
      state.tapeVisible = !state.tapeVisible;
      localStorage.setItem(TAPE_VISIBLE_KEY, state.tapeVisible ? "1" : "0");
      syncLayerButtons(card, state);
      notifyFlowLayerVisibility(card, state);
      scheduleTapeDraw(true, card);
    });
    layerControls.querySelector("[data-inpuls-clusters-visible]").addEventListener("click", () => {
      state.clustersVisible = !state.clustersVisible;
      localStorage.setItem(CLUSTERS_VISIBLE_KEY, state.clustersVisible ? "1" : "0");
      syncLayerButtons(card, state);
      notifyFlowLayerVisibility(card, state);
      scheduleTapeDraw(true, card);
    });
  }
  syncLayerButtons(card, state);

  const bookActions = card.querySelector(".inpuls-book-pane-actions");
  if (bookActions) {
    let densityButton = bookActions.querySelector("[data-inpuls-density-age]");
    if (!densityButton) {
      densityButton = document.createElement("button");
      densityButton.type = "button";
      densityButton.className = "inpuls-density-age-toggle";
      densityButton.dataset.inpulsDensityAge = "1";
      densityButton.textContent = "ВРЕМЯ";
      bookActions.append(densityButton);
      densityButton.addEventListener("click", () => {
        state.densityAgeVisible = !state.densityAgeVisible;
        localStorage.setItem(DENSITY_AGE_VISIBLE_KEY, state.densityAgeVisible ? "1" : "0");
        syncDensityAgeButton(densityButton, state, card);
        decorateDensityAges(card, state);
      });
    }
    syncDensityAgeButton(densityButton, state, card);
  }
  decorateDensityAges(card, state);

  const rows = card.querySelector(".orderbook-rows");
  if (state.rowTarget !== rows) {
    state.rowObserver?.disconnect();
    state.rowObserver = null;
    state.rowTarget = rows;
    if (rows) {
      state.rowObserver = new MutationObserver(() => {
        decorateRuntimeBookRows(card);
        state.viewportDirty = true;
        scheduleTapeDraw(false, card);
      });
      state.rowObserver.observe(rows, { childList: true });
    }
  }

  if (typeof ResizeObserver === "function" && state.resizeTarget !== flow) {
    state.resizeObserver?.disconnect();
    state.resizeObserver = new ResizeObserver(() => {
      state.viewportDirty = true;
      scheduleTapeDraw(true, card);
    });
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
          state.hasFrame = false;
          state.clockEndTime = null;
          state.clockPerfAt = null;
          state.priceViewport = null;
          state.priceViewportAt = null;
          state.targetPriceViewport = null;
          state.priceRange = null;
          state.viewportSampleAt = null;
          state.viewportDirty = true;
          state.renderModelKey = null;
          state.rawNodeByKey?.clear?.();
          state.rawRenderNodes = [];
          state.aggSourceBuckets = [];
          state.seriesSourceBuckets = [];
          state.aggSnapshots?.clear?.();
          state.seriesSnapshots?.clear?.();
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
  requestAnimationFrame(function refreshVisibleDensityAgesAfterBookData() {
    for (const card of boundTapeCards) {
      if (!card?.isConnected) {
        boundTapeCards.delete(card);
        continue;
      }
      const state = tapeCardStates.get(card);
      if (!state?.densityAgeVisible || cardSymbol(card) !== symbol) continue;
      decorateDensityAges(card, state);
    }
  });
}

function acceptBookStatus(event) {
  const symbol = String(event?.detail?.symbol ?? "").toUpperCase();
  const status = event?.detail?.status;
  if (!symbol.endsWith("USDT") || !status) return;
  bookStatusBySymbol.set(symbol, status);
  document.querySelectorAll(".orderbook-card").forEach((card) => {
    if (cardSymbol(card) === symbol) scheduleTapeDraw(true, card);
  });
}

function setTapeState(state, text = "", tone = "neutral") {
  const element = state?.status;
  if (!element) return;
  const value = String(text || "");
  const nextTone = String(tone || "neutral");
  if (state.lastStatusText === value && state.lastStatusTone === nextTone) return;
  state.lastStatusText = value;
  state.lastStatusTone = nextTone;
  if (element.textContent !== value) element.textContent = value;
  if (element.dataset.tone !== nextTone) element.dataset.tone = nextTone;
  element.classList.toggle("is-visible", Boolean(value));
}

function setTapeRangeSummary(state, above = 0, below = 0) {
  const summary = state?.rangeSummary;
  if (!summary) return;
  const safeAbove = Math.max(0, Math.floor(Number(above) || 0));
  const safeBelow = Math.max(0, Math.floor(Number(below) || 0));
  if (state.lastRangeAbove === safeAbove && state.lastRangeBelow === safeBelow) return;
  state.lastRangeAbove = safeAbove;
  state.lastRangeBelow = safeBelow;
  const aboveElement = summary.querySelector("[data-inpuls-tape-above]");
  const belowElement = summary.querySelector("[data-inpuls-tape-below]");
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

export function tapePricePosition(rows, price) {
  const target = Number(price);
  const ordered = (rows ?? []).map((row) => ({
    ...row,
    price: Number(row?.price),
    y: Number(row?.y),
    height: Math.max(1, Number(row?.height) || 1),
  })).filter((row) => Number.isFinite(row.price) && Number.isFinite(row.y))
    .sort((left, right) => left.price - right.price);
  if (!ordered.length || !Number.isFinite(target)) return null;
  if (ordered.length === 1) return Math.abs(target - ordered[0].price) <= Number.EPSILON ? { ...ordered[0], price: target } : null;
  let step = Infinity;
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index].price - ordered[index - 1].price;
    if (gap > Number.EPSILON && gap < step) step = gap;
  }
  if (!Number.isFinite(step)) return null;
  const low = ordered[0];
  const high = ordered.at(-1);
  if (target < low.price - step * .5 - Number.EPSILON || target > high.price + step * .5 + Number.EPSILON) return null;
  const interpolate = (left, right) => {
    const span = right.price - left.price;
    const ratio = Math.abs(span) <= Number.EPSILON ? 0 : (target - left.price) / span;
    return { price: target, y: left.y + (right.y - left.y) * ratio, height: left.height + (right.height - left.height) * ratio };
  };
  if (target <= low.price) return interpolate(low, ordered[1]);
  if (target >= high.price) return interpolate(ordered.at(-2), high);
  for (let index = 1; index < ordered.length; index += 1) {
    if (target <= ordered[index].price) return interpolate(ordered[index - 1], ordered[index]);
  }
  return null;
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

export function tapeViewportFromRows(rows) {
  const ordered = (rows ?? [])
    .map((row) => ({
      price: Number(row?.price),
      y: Number(row?.y),
      height: Math.max(1, Number(row?.height) || 1),
    }))
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.y))
    .sort((left, right) => left.price - right.price);
  if (ordered.length < 2) return null;
  let step = Infinity;
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index].price - ordered[index - 1].price;
    if (gap > Number.EPSILON && gap < step) step = gap;
  }
  const low = ordered[0];
  const high = ordered.at(-1);
  if (!Number.isFinite(step) || high.price <= low.price) return null;
  return {
    lowPrice: low.price,
    highPrice: high.price,
    lowY: low.y,
    highY: high.y,
    step,
    rowHeight: ordered.reduce((sum, row) => sum + row.height, 0) / ordered.length,
  };
}

export function advanceTapePriceViewport(
  previous,
  target,
  elapsedMs,
  tauMs = TAPE_PRICE_VIEWPORT_TAU_MS,
) {
  if (!target) return previous ?? null;
  if (!previous) return { ...target };
  const previousSpan = Math.max(Number.EPSILON, previous.highPrice - previous.lowPrice);
  const targetSpan = Math.max(Number.EPSILON, target.highPrice - target.lowPrice);
  const spanRatio = targetSpan / previousSpan;
  const hardReset = spanRatio > 4 || spanRatio < .25;
  const elapsed = Math.max(0, Math.min(250, Number(elapsedMs) || 0));
  const tau = Math.max(1, Number(tauMs) || TAPE_PRICE_VIEWPORT_TAU_MS);
  const alpha = hardReset ? 1 : 1 - Math.exp(-elapsed / tau);
  const mix = (left, right) => Number(left) + (Number(right) - Number(left)) * alpha;
  return {
    lowPrice: mix(previous.lowPrice, target.lowPrice),
    highPrice: mix(previous.highPrice, target.highPrice),
    lowY: mix(previous.lowY, target.lowY),
    highY: mix(previous.highY, target.highY),
    step: mix(previous.step, target.step),
    rowHeight: mix(previous.rowHeight, target.rowHeight),
  };
}

function projectTapePriceInto(viewport, price, output) {
  const target = Number(price);
  if (!viewport || !Number.isFinite(target)) return null;
  const low = Number(viewport.lowPrice);
  const high = Number(viewport.highPrice);
  const span = high - low;
  const step = Math.max(Number.EPSILON, Number(viewport.step) || 0);
  if (!Number.isFinite(span) || span <= Number.EPSILON) return null;
  if (target < low - step * .65 || target > high + step * .65) return null;
  const ratio = (target - low) / span;
  const result = output ?? {};
  result.price = target;
  result.y = Number(viewport.lowY) + (Number(viewport.highY) - Number(viewport.lowY)) * ratio;
  result.height = Math.max(1, Number(viewport.rowHeight) || 1);
  return result;
}

export function projectTapePrice(viewport, price) {
  return projectTapePriceInto(viewport, price, {});
}

export function advanceWaterTapeClock(
  previousEnd,
  previousAt,
  latestTradeTime,
  packetAt,
  nowPerf,
  frozen = false,
  exchangeNow = null,
) {
  const latest = Number(latestTradeTime);
  const now = Number(nowPerf);
  const packet = Number(packetAt);
  const exchange = Number(exchangeNow);
  if (!Number.isFinite(latest) || !Number.isFinite(now)) return null;
  const hasPrevious = previousEnd !== null
    && previousEnd !== undefined
    && Number.isFinite(Number(previousEnd));
  if (frozen) return hasPrevious ? Number(previousEnd) : latest + 1;
  const packetAge = Number.isFinite(packet) ? Math.max(0, now - packet) : 0;
  const packetAdvanced = latest + packetAge;
  const target = Number.isFinite(exchange)
    ? Math.max(exchange, packetAdvanced)
    : packetAdvanced;
  const desired = target + TAPE_LIVE_EDGE_LEAD_MS;
  if (!hasPrevious) return desired;
  const previous = Number(previousEnd);
  const previousTime = Number(previousAt);
  const elapsed = Number.isFinite(previousTime)
    ? Math.max(0, Math.min(250, now - previousTime))
    : 0;
  const base = previous + elapsed;
  if (desired - base > 500) return Math.max(previous, desired);
  const alpha = 1 - Math.exp(-elapsed / TAPE_CLOCK_CORRECTION_TAU_MS);
  const corrected = base + (desired - base) * alpha;
  return Math.max(previous, corrected);
}

export function tapeSecondsForScale(width, scalePercent = TAPE_TIME_SCALE_DEFAULT) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const baseSeconds = clampTape(
    Math.floor(safeWidth / TAPE_MIN_SECOND_WIDTH),
    TAPE_MIN_SECONDS,
    TAPE_MAX_SECONDS,
  );
  const scale = clampTape(
    Number(scalePercent) || TAPE_TIME_SCALE_DEFAULT,
    TAPE_TIME_SCALE_MIN,
    TAPE_TIME_SCALE_MAX,
  );
  return clampTape(baseSeconds * scale / 100, 4, TAPE_RETENTION_MS / TAPE_SECOND_MS);
}

function buildContinuousTapeWindow(
  width,
  latestTime,
  requestedEndTime = null,
  scalePercent = TAPE_TIME_SCALE_DEFAULT,
) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const duration = tapeSecondsForScale(safeWidth, scalePercent) * TAPE_SECOND_MS;
  const latest = Number(latestTime) || binanceClock.now();
  const requested = Number(requestedEndTime);
  const endTime = Number.isFinite(requested)
    ? Math.max(latest + 1, requested)
    : latest + 1;
  return {
    duration,
    startTime: endTime - duration,
    endTime,
    plotRight: Math.max(1, safeWidth - TAPE_LIVE_EDGE_GUTTER_PX),
  };
}

function tapeTimeX(time, window, width) {
  const safeRight = Math.max(
    1,
    Math.min(Number(window?.plotRight) || Number(width) || 1, Number(width) || 1),
  );
  const ratio = (Number(time) - window.startTime) / Math.max(1, window.duration);
  return clampTape(ratio * safeRight, 1, safeRight);
}

export function tapeSecondSlotTime(time, window = null) {
  const value = Number(time);
  if (!Number.isFinite(value)) return null;
  // Preserve exact exchange time. BinanceClock owns the live edge; executions
  // must retain their natural spacing instead of collapsing to second centers.
  if (!window) return value;
  const start = Number(window.startTime);
  const end = Number(window.endTime);
  if (![start, end].every(Number.isFinite) || end <= start) return value;
  return clampTape(value, start + 1, end - 1);
}

function tapeTradeX(time, window, width) {
  const slotTime = tapeSecondSlotTime(time, window);
  return tapeTimeX(slotTime ?? time, window, width);
}

function layoutTapeSequence(items, window, width) {
  return buildReadableTapeLayout(items, window, width);
}

function snapTapeCoordinate(value, dpr = 1) {
  const scale = Math.max(1, Number(dpr) || 1);
  return Math.round(Number(value) * scale) / scale;
}

function formatTapeClock(time) {
  return binanceClock.formatTime(time, { seconds: true });
}

function drawTapeTimeline(context, rect, window) {
  const right = Math.max(2, Math.min(Number(window?.plotRight) || rect.width, rect.width));
  const seconds = Math.max(1, window.duration / TAPE_SECOND_MS);
  const pixelsPerSecond = right / seconds;
  const stepSeconds = pixelsPerSecond >= TAPE_TIMELINE_MIN_LABEL_GAP_PX
    ? 1
    : pixelsPerSecond * 2 >= TAPE_TIMELINE_MIN_LABEL_GAP_PX
      ? 2
      : pixelsPerSecond * 5 >= TAPE_TIMELINE_MIN_LABEL_GAP_PX
        ? 5
        : 10;
  const stepMs = stepSeconds * TAPE_SECOND_MS;
  const firstTick = Math.ceil(window.startTime / stepMs) * stepMs;

  context.save();
  context.lineWidth = .95;
  context.strokeStyle = "rgba(66, 225, 173, .46)";
  context.fillStyle = "rgba(177, 205, 197, .88)";
  context.font = "750 8px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "bottom";

  for (let time = firstTick; time < window.endTime; time += stepMs) {
    const x = tapeTimeX(time, window, rect.width);
    if (x < 20 || x > right - 20) continue;
    context.beginPath();
    context.moveTo(x, rect.height - 6);
    context.lineTo(x, rect.height);
    context.stroke();
    context.fillText(formatTapeClock(time), x, rect.height - 7);
  }

  context.restore();
}

function drawTapeLiveEdge(context, rect, window) {
  const x = Math.max(1, Math.min(Number(window?.plotRight) || rect.width, rect.width - 1));
  context.save();
  context.setLineDash([3, 3]);
  context.lineWidth = 1;
  context.strokeStyle = "rgba(66, 225, 173, .58)";
  context.beginPath();
  context.moveTo(x, 3);
  context.lineTo(x, Math.max(3, rect.height - 15));
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "rgba(93, 225, 181, .9)";
  context.font = "800 7px Inter, system-ui, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "top";
  context.fillText("NOW · LIVE", x - 3, 4);
  context.restore();
}

function rawTapeItemsContinuous(trades, rows, window) {
  return trades
    .slice(0, TAPE_MAX_RAW_VISIBLE)
    .reverse()
    .filter((trade) => trade.time >= window.startTime && trade.time <= window.endTime)
    .map((trade) => {
      const position = tapePricePosition(rows, trade.price);
      if (!position) return null;
      return {
        key: `raw:${String(trade.id)}:${trade.time}`,
        time: trade.time,
        lastTime: trade.time,
        price: trade.price,
        row: position,
        quote: trade.quote,
        buyQuote: trade.side === "buy" ? trade.quote : 0,
        sellQuote: trade.side === "sell" ? trade.quote : 0,
        count: 1,
      };
    })
    .filter(Boolean);
}

export function stableTapeQuoteStrength(value) {
  const quote = Math.max(0, Number(value) || 0);
  return clampTape(Math.log10(1 + quote / 100) / 3, 0, 1.35);
}

export function aggregateTapeZeroMs(trades) {
  const ordered = [...(trades ?? [])]
    .filter((trade) => {
      const time = Number(trade?.time);
      const price = Number(trade?.price);
      const quote = Number(trade?.quote);
      return [time, price, quote].every(Number.isFinite) && quote > 0;
    })
    .sort((left, right) => {
      const timeDelta = Number(left.time) - Number(right.time);
      if (timeDelta) return timeDelta;
      const leftId = Number(left.id);
      const rightId = Number(right.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
        return leftId - rightId;
      }
      return String(left.id).localeCompare(String(right.id));
    });

  const groups = [];
  const ordinalByTime = new Map();
  let current = null;
  const finish = () => {
    if (!current) return;
    const timeOrdinal = ordinalByTime.get(current.eventTime) ?? 0;
    current.timeOrdinal = timeOrdinal;
    ordinalByTime.set(current.eventTime, timeOrdinal + 1);
    current.vwapPrice = current.quantity > 0
      ? current.quote / current.quantity
      : current.firstPrice;
    // The marker is anchored to the first execution. Its volume may grow while
    // OPEN, but it never jumps between price rows.
    current.price = current.firstPrice;
    current.lastTime = current.time;
    current.bucketStart = current.eventTime;
    current.bucketEnd = current.eventTime;
    current.bucketMs = TAPE_AGGREGATION_PERIOD_MS;
    groups.push(current);
    current = null;
  };

  for (const trade of ordered) {
    const eventTime = Number(trade.tradeTime ?? trade.eventTime ?? trade.time);
    const displayTime = Number(trade.displayTime ?? trade.time);
    const side = trade.side === "sell" ? "sell" : "buy";
    const price = Number(trade.price);
    const quote = Number(trade.quote);
    const quantity = Number.isFinite(Number(trade.quantity)) && Number(trade.quantity) > 0
      ? Number(trade.quantity)
      : quote / price;
    const continues = current
      && current.eventTime === eventTime
      && current.side === side;

    if (!continues) {
      finish();
      current = {
        key: `agg0:${eventTime}:${side}:${tapeTradeKey(trade)}`,
        time: displayTime,
        lastTime: displayTime,
        eventTime,
        side,
        firstPrice: price,
        lastPrice: price,
        minPrice: price,
        maxPrice: price,
        price,
        vwapPrice: price,
        quantity: 0,
        quote: 0,
        buyQuote: 0,
        sellQuote: 0,
        count: 0,
      };
    }

    current.time = Math.max(Number(current.time) || displayTime, displayTime);
    current.lastTime = current.time;
    current.lastPrice = price;
    current.minPrice = Math.min(current.minPrice, price);
    current.maxPrice = Math.max(current.maxPrice, price);
    current.quantity += quantity;
    current.quote += quote;
    current[side === "sell" ? "sellQuote" : "buyQuote"] += quote;
    current.count += 1;
  }
  finish();
  return groups;
}

export function aggregateTapeSeries(trades, maximumGapMs = TAPE_SERIES_MAX_GAP_MS) {
  const gapLimit = Math.max(20, Number(maximumGapMs) || TAPE_SERIES_MAX_GAP_MS);
  const ordered = [...(trades ?? [])]
    .filter((trade) => {
      const executionTime = Number(trade?.tradeTime ?? trade?.eventTime ?? trade?.time);
      const displayTime = Number(trade?.displayTime ?? trade?.time);
      const price = Number(trade?.price);
      const quote = Number(trade?.quote);
      return [executionTime, displayTime, price, quote].every(Number.isFinite) && quote > 0;
    })
    .sort((left, right) => {
      const leftTime = Number(left.tradeTime ?? left.eventTime ?? left.time);
      const rightTime = Number(right.tradeTime ?? right.eventTime ?? right.time);
      const timeDelta = leftTime - rightTime;
      if (timeDelta) return timeDelta;
      const leftId = Number(left.id);
      const rightId = Number(right.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) return leftId - rightId;
      return String(left.id).localeCompare(String(right.id));
    });

  const groups = [];
  const ordinalByTime = new Map();
  let current = null;
  const finish = () => {
    if (!current) return;
    current.vwapPrice = current.quantity > 0 ? current.quote / current.quantity : current.firstPrice;
    current.price = current.lastPrice;
    current.lastTime = current.time;
    current.durationMs = Math.max(0, current.lastEventTime - current.firstEventTime);
    current.bucketStart = current.firstEventTime;
    current.bucketEnd = current.lastEventTime;
    current.bucketMs = gapLimit;
    const ordinal = ordinalByTime.get(current.time) ?? 0;
    current.timeOrdinal = ordinal;
    ordinalByTime.set(current.time, ordinal + 1);
    groups.push(current);
    current = null;
  };

  for (const trade of ordered) {
    const executionTime = Number(trade.tradeTime ?? trade.eventTime ?? trade.time);
    const displayTime = Number(trade.displayTime ?? trade.time);
    const side = trade.side === "sell" ? "sell" : "buy";
    const price = Number(trade.price);
    const quote = Number(trade.quote);
    const quantity = Number.isFinite(Number(trade.quantity)) && Number(trade.quantity) > 0
      ? Number(trade.quantity)
      : quote / price;
    const continues = current && current.side === side && executionTime - current.lastEventTime <= gapLimit;

    if (!continues) {
      finish();
      current = {
        key: `series:${executionTime}:${side}:${tapeTradeKey(trade)}`,
        time: displayTime,
        lastTime: displayTime,
        eventTime: executionTime,
        firstEventTime: executionTime,
        lastEventTime: executionTime,
        side,
        firstPrice: price,
        lastPrice: price,
        minPrice: price,
        maxPrice: price,
        price,
        vwapPrice: price,
        quantity: 0,
        quote: 0,
        buyQuote: 0,
        sellQuote: 0,
        count: 0,
        steps: [],
      };
    }

    current.time = Math.max(Number(current.time) || displayTime, displayTime);
    current.lastTime = current.time;
    current.lastEventTime = executionTime;
    current.lastPrice = price;
    current.minPrice = Math.min(current.minPrice, price);
    current.maxPrice = Math.max(current.maxPrice, price);
    current.quantity += quantity;
    current.quote += quote;
    current[side === "sell" ? "sellQuote" : "buyQuote"] += quote;
    current.count += 1;

    const previousStep = current.steps.at(-1);
    if (previousStep && previousStep.time === displayTime) {
      previousStep.price = price;
      previousStep.quote += quote;
      previousStep.count += 1;
    } else {
      current.steps.push({ time: displayTime, eventTime: executionTime, price, quote, count: 1 });
    }
  }

  finish();
  return groups;
}
export function materializeZeroMsAggregates(state, groups, output = []) {
  if (!(state.aggSnapshots instanceof Map)) state.aggSnapshots = new Map();
  output.length = 0;
  const lastIndex = Math.max(-1, (groups?.length ?? 0) - 1);

  for (let index = 0; index <= lastIndex; index += 1) {
    const group = groups[index];
    if (index === lastIndex) {
      // The right-most group is OPEN and is the only marker allowed to grow.
      output.push(Object.freeze({
        ...group,
        status: "open",
        showLabel: stableTapeQuoteStrength(group.quote) >= .62,
      }));
      continue;
    }
    let snapshot = state.aggSnapshots.get(group.key);
    if (!snapshot) {
      snapshot = Object.freeze({
        ...group,
        status: "sealed",
        sealedAt: Number(groups[index + 1]?.eventTime ?? group.eventTime),
        showLabel: stableTapeQuoteStrength(group.quote) >= .62,
      });
      state.aggSnapshots.set(group.key, snapshot);
    }
    output.push(snapshot);
  }

  while (state.aggSnapshots.size > 1_800) {
    state.aggSnapshots.delete(state.aggSnapshots.keys().next().value);
  }
  return output;
}

export function materializeTapeSeries(
  state,
  groups,
  output = [],
  now = binanceClock.now(),
  maximumGapMs = TAPE_SERIES_MAX_GAP_MS,
) {
  if (!(state.seriesSnapshots instanceof Map)) state.seriesSnapshots = new Map();
  output.length = 0;
  const gapLimit = Math.max(20, Number(maximumGapMs) || TAPE_SERIES_MAX_GAP_MS);
  const currentTime = Number(now);
  const lastIndex = Math.max(-1, (groups?.length ?? 0) - 1);

  for (let index = 0; index <= lastIndex; index += 1) {
    const group = groups[index];
    const isLast = index === lastIndex;
    const timedOut = isLast
      && Number.isFinite(currentTime)
      && currentTime - Number(group.time) > gapLimit;
    const showLabel = Number(group.count) > 1 || stableTapeQuoteStrength(group.quote) >= .62;

    if (isLast && !timedOut) {
      output.push(Object.freeze({
        ...group,
        status: "open",
        showLabel,
      }));
      continue;
    }

    if (isLast) {
      // A silence timeout closes the visual series, but it is not cached yet.
      // A delayed packet can still complete it before a following series exists.
      output.push(Object.freeze({
        ...group,
        status: "sealed",
        sealedAt: Number(group.time) + gapLimit,
        showLabel,
      }));
      continue;
    }

    let snapshot = state.seriesSnapshots.get(group.key);
    if (!snapshot) {
      snapshot = Object.freeze({
        ...group,
        status: "sealed",
        sealedAt: Number(groups[index + 1]?.firstEventTime ?? group.lastEventTime),
        showLabel,
      });
      state.seriesSnapshots.set(group.key, snapshot);
    }
    output.push(snapshot);
  }

  while (state.seriesSnapshots.size > 1_800) {
    state.seriesSnapshots.delete(state.seriesSnapshots.keys().next().value);
  }
  return output;
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

function tapeSurfaceColor() {
  if (cachedTapeSurfaceColor) return cachedTapeSurfaceColor;
  if (typeof document === "undefined") return "#181b20";
  cachedTapeSurfaceColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--panel")
    .trim() || "#181b20";
  return cachedTapeSurfaceColor;
}

function paintTapeSurface(context, rect) {
  context.clearRect(0, 0, rect.width, rect.height);
  context.fillStyle = tapeSurfaceColor();
  context.fillRect(0, 0, rect.width, rect.height);
}

function refreshTapeRenderModel(state, symbol, stored, aggregationStored = stored, seriesStored = []) {
  const version = Number(tapeDataVersionBySymbol.get(symbol)) || 0;
  const aggregationInput = aggregationStored?.length ? aggregationStored : stored;
  const seriesRawReady = state.seriesSource === "raw" && Boolean(seriesStored?.length);
  const seriesRenderSource = seriesRawReady ? "raw" : "agg";
  const seriesInput = seriesRawReady ? seriesStored : aggregationInput;
  const modelKey = [symbol, version, seriesRenderSource, "zero-ms-series-fallback-500"].join(":");
  state.seriesRenderSource = seriesRenderSource;
  if (state.renderModelKey === modelKey) return;
  state.renderModelKey = modelKey;

  const previousNodes = state.rawNodeByKey instanceof Map
    ? state.rawNodeByKey
    : new Map();
  const nextNodesByKey = new Map();
  const nextNodes = [];
  for (let index = stored.length - 1; index >= 0; index -= 1) {
    const trade = stored[index];
    const key = `raw:${tapeTradeKey(trade)}`;
    const node = previousNodes.get(key) ?? Object.freeze({
      key,
      id: trade.id,
      time: Number(trade.displayTime ?? trade.time),
      lastTime: Number(trade.displayTime ?? trade.time),
      price: Number(trade.price),
      quote: Number(trade.quote),
      buyQuote: trade.side === "buy" ? Number(trade.quote) : 0,
      sellQuote: trade.side === "sell" ? Number(trade.quote) : 0,
      count: 1,
    });
    nextNodesByKey.set(key, node);
    nextNodes.push(node);
  }
  state.rawNodeByKey = nextNodesByKey;
  state.rawRenderNodes = nextNodes;
  state.aggSourceBuckets = aggregateTapeZeroMs(aggregationInput);
  state.seriesSourceBuckets = aggregateTapeSeries(seriesInput);
}

function visibleWaterTapeNodes(nodes, window, output = []) {
  output.length = 0;
  const retentionStart = Math.max(window.startTime, window.endTime - TAPE_RETENTION_MS);
  for (const item of nodes ?? []) {
    const time = Number(item.time);
    if (time < retentionStart) continue;
    if (time > window.endTime) break;
    output.push(item);
  }
  return output;
}

function filterWaterTapeCandidates(nodes, minimum, output = []) {
  output.length = 0;
  for (const item of nodes ?? []) {
    if (passesTapeFilter(item, minimum, 0)) output.push(item);
  }
  return output;
}

function projectWaterTapeNodes(nodes, viewport, output = []) {
  let count = 0;
  for (const source of nodes ?? []) {
    const slot = output[count] ?? { source: null, position: {} };
    const position = projectTapePriceInto(viewport, source.price, slot.position);
    if (!position) continue;
    slot.source = source;
    slot.position = position;
    output[count] = slot;
    count += 1;
  }
  output.length = count;
  return output;
}

function prepareRawTapeMarkerBatches(state) {
  if (!Array.isArray(state.rawMarkerBatches)) {
    state.rawMarkerBatches = Array.from(
      { length: RAW_TAPE_MARKER_BUCKETS * 2 },
      () => [],
    );
  }
  for (const batch of state.rawMarkerBatches) batch.length = 0;
  return state.rawMarkerBatches;
}

function rawTapeMarkerBucket(strength, buy) {
  const normalized = clampTape(Number(strength) || 0, 0, 1.35) / 1.35;
  const sizeIndex = Math.max(0, Math.min(
    RAW_TAPE_MARKER_BUCKETS - 1,
    Math.round(normalized * (RAW_TAPE_MARKER_BUCKETS - 1)),
  ));
  return (buy ? 0 : RAW_TAPE_MARKER_BUCKETS) + sizeIndex;
}

export function aggregateLabelPrice(item) {
  const minimum = Number(item?.minPrice);
  const maximum = Number(item?.maxPrice);
  if (Number.isFinite(minimum) && Number.isFinite(maximum)) return (minimum + maximum) / 2;
  const vwap = Number(item?.vwapPrice);
  if (Number.isFinite(vwap)) return vwap;
  return Number(item?.price);
}

export function aggregateStableX(baseX, ordinal, markerWidth, plotRight) {
  const right = Math.max(1, Number(plotRight) || 1);
  const width = Math.max(4, Number(markerWidth) || 4);
  const index = Math.max(0, Math.floor(Number(ordinal) || 0));
  const spacing = clampTape(width + 3, 12, 48);
  let offset = 0;
  if (index > 0) {
    if (baseX >= right * .68) offset = -index * spacing;
    else if (baseX <= right * .32) offset = index * spacing;
    else {
      const ring = Math.ceil(index / 2);
      offset = (index % 2 ? 1 : -1) * ring * spacing;
    }
  }
  return clampTape(
    Number(baseX) + offset,
    width / 2 + .5,
    Math.max(width / 2 + .5, right - width / 2 - .5),
  );
}

function aggregateLabelY(viewport, item, fallbackY) {
  const position = projectTapePrice(viewport, aggregateLabelPrice(item));
  return position ? position.y : fallbackY;
}

function drawAggregatePriceRange(
  context,
  viewport,
  item,
  x,
  buy,
  stroke,
  strength,
  openAggregate = false,
) {
  const minimum = Number(item?.minPrice);
  const maximum = Number(item?.maxPrice);
  if (![minimum, maximum].every(Number.isFinite) || maximum - minimum <= Number.EPSILON) return false;
  const low = projectTapePrice(viewport, minimum);
  const high = projectTapePrice(viewport, maximum);
  if (!low || !high) return false;
  const top = Math.min(low.y, high.y);
  const bottom = Math.max(low.y, high.y);
  const height = Math.max(1, bottom - top);
  const minimumVisibleSpan = Math.max(1.5, (Number(viewport?.rowHeight) || 1) * .38);
  if (height < minimumVisibleSpan) return false;

  const width = clampTape(4 + strength * 3.2, 4, 8.5);
  roundedRectPath(context, x - width / 2, top, width, height, Math.min(2.5, width / 2));
  context.fillStyle = buy
    ? `rgba(42, 191, 137, ${openAggregate ? .22 : .30})`
    : `rgba(222, 70, 87, ${openAggregate ? .23 : .31})`;
  context.fill();
  context.lineWidth = .8;
  context.strokeStyle = stroke;
  context.stroke();
  return true;
}

function drawRawTapeMarkerBatches(context, batches) {
  for (let batchIndex = 0; batchIndex < (batches?.length ?? 0); batchIndex += 1) {
    const batch = batches[batchIndex];
    if (!batch?.length) continue;
    const buy = batchIndex < RAW_TAPE_MARKER_BUCKETS;
    const sizeIndex = batchIndex % RAW_TAPE_MARKER_BUCKETS;
    const strength = sizeIndex / Math.max(1, RAW_TAPE_MARKER_BUCKETS - 1) * 1.35;
    const diameter = clampTape(1.8 + strength * 7, 1.8, 10.8);
    const radius = diameter / 2;
    context.beginPath();
    for (let index = 0; index < batch.length; index += 2) {
      const x = batch[index];
      const y = batch[index + 1];
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, Math.PI * 2);
    }
    context.fillStyle = buy
      ? `rgba(50, 205, 151, ${clampTape(.32 + strength * .26, .32, .84)})`
      : `rgba(238, 91, 108, ${clampTape(.32 + strength * .26, .32, .84)})`;
    context.fill();
    if (diameter >= 4.2) {
      context.lineWidth = diameter >= 7 ? .95 : .6;
      context.strokeStyle = buy ? "rgba(88, 239, 184, .9)" : "rgba(255, 121, 137, .9)";
      context.stroke();
    }
  }
}


function drawTapeSeriesLadder(context, item, viewport, window, rect, stroke, openSeries) {
  const points = [];
  for (const step of item?.steps ?? []) {
    const position = projectTapePrice(viewport, step.price);
    if (!position) continue;
    points.push({
      x: tapeTradeX(step.time, window, rect.width),
      y: position.y,
      time: step.time,
      price: step.price,
    });
  }
  if (!points.length) return null;

  context.save();
  context.beginPath();
  context.rect(0, 0, Math.max(1, window.plotRight), Math.max(1, rect.height - 16));
  context.clip();
  context.strokeStyle = stroke;
  context.lineWidth = openSeries ? 3.2 : 2.35;
  context.lineJoin = "round";
  context.lineCap = "square";
  context.globalAlpha = openSeries ? 1 : .94;
  context.shadowColor = stroke;
  context.shadowBlur = openSeries ? 7 : 4;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    context.lineTo(next.x, previous.y);
    context.lineTo(next.x, next.y);
  }
  context.stroke();
  const terminal = points.at(-1);
  context.beginPath();
  context.arc(terminal.x, terminal.y, openSeries ? 3.6 : 2.8, 0, Math.PI * 2);
  context.fillStyle = stroke;
  context.fill();
  context.restore();
  return terminal;
}

function drawTapeCard(card) {
  const drawStartedAt = performance.now();
  const initialSymbol = cardSymbol(card);
  const skip = (reason, tags = null) => observability.skipRender("tape", reason, {
    symbol: initialSymbol || null,
    ...(tags ?? {}),
  });
  const state = ensureTapeUi(card);
  const flow = card.querySelector(".trade-flow");
  const canvas = state?.canvas;
  const context = state?.context;
  if (!state || !flow || !canvas || !context) {
    skip("missing-dom");
    return;
  }
  if (tapeDocumentHidden) {
    skip("document-hidden");
    return;
  }

  const rect = flow.getBoundingClientRect();
  if (rect.width <= 2 || rect.height <= 2) {
    skip("zero-size");
    return;
  }
  const dprLimit = rect.width >= 900 ? 1.1 : 1.4;
  const dpr = Math.max(1, Math.min(dprLimit, globalThis.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
  const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    state.hasFrame = false;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (!state.tapeVisible) {
    context.clearRect(0, 0, rect.width, rect.height);
    state.hasFrame = false;
    setTapeRangeSummary(state, 0, 0);
    setTapeState(state, "");
    skip("layer-hidden");
    return;
  }

  const symbol = initialSymbol;
  if (!symbol) {
    paintTapeSurface(context, rect);
    state.hasFrame = false;
    setTapeState(state, "Выберите монету");
    skip("missing-symbol");
    return;
  }

  const stored = tapeTradesBySymbol.get(symbol) ?? [];
  const aggregationStored = tapeAggregationTradesBySymbol.get(symbol) ?? [];
  const seriesStored = tapeSeriesTradesBySymbol.get(symbol) ?? [];
  if (!stored.length && !aggregationStored.length && !seriesStored.length) {
    if (!state.hasFrame) paintTapeSurface(context, rect);
    const live = tapeStatusText(card).includes("TAPE");
    setTapeState(
      state,
      live ? "Поток подключён · ждём сделку" : "Подключаю поток сделок…",
      live ? "neutral" : "attention",
    );
    skip(live ? "waiting-trade" : "stream-not-live");
    return;
  }

  const frozen = tapeRecoveryFrozen(symbol);
  if (frozen && state.hasFrame) {
    setTapeState(state, "ПОСЛЕДНИЙ КАДР · ждём свежий поток", "attention");
    skip("recovery-frozen");
    return;
  }

  const perfNow = performance.now();
  const shouldSampleViewport = state.viewportDirty
    || !state.targetPriceViewport
    || state.viewportSampleAt === null
    || perfNow - Number(state.viewportSampleAt) >= TAPE_VIEWPORT_SAMPLE_MS;
  if (shouldSampleViewport) {
    const sampledRows = visibleBookRows(card, flow);
    const sampledViewport = tapeViewportFromRows(sampledRows);
    if (sampledViewport) {
      state.targetPriceViewport = sampledViewport;
      state.priceRange = visiblePriceRange(sampledRows);
      state.viewportSampleAt = perfNow;
      state.viewportDirty = false;
    }
  }
  const targetViewport = state.targetPriceViewport;
  if (!targetViewport) {
    setTapeState(state, "Жду ценовую шкалу стакана…", "attention");
    skip("missing-price-viewport");
    return;
  }

  const viewportElapsed = state.priceViewportAt === null
    ? 16
    : perfNow - Number(state.priceViewportAt);
  state.priceViewport = advanceTapePriceViewport(
    state.priceViewport,
    targetViewport,
    viewportElapsed,
  );
  state.priceViewportAt = perfNow;

  const meta = tapeMetaBySymbol.get(symbol) ?? {};
  state.aggregationSource = meta.aggregationSource === "raw" ? "raw" : "agg";
  state.seriesSource = meta.seriesSource === "raw" ? "raw" : "warming";
  state.seriesHealth = meta.seriesHealth ?? null;
  const exchangeNow = binanceClock.now(perfNow);
  const latestTime = Number(meta.lastTradeTime)
    || Number(stored[0]?.time)
    || Number(aggregationStored[0]?.time)
    || Number(seriesStored[0]?.time)
    || exchangeNow;
  const endTime = advanceWaterTapeClock(
    state.clockEndTime,
    state.clockPerfAt,
    latestTime,
    meta.lastPacketPerfAt,
    perfNow,
    frozen,
    exchangeNow,
  );
  state.clockEndTime = endTime;
  state.clockPerfAt = perfNow;
  const window = buildContinuousTapeWindow(rect.width, latestTime, endTime, state.timeScale);
  const range = state.priceRange;
  refreshTapeRenderModel(state, symbol, stored, aggregationStored, seriesStored);
  syncTapeModeButton(state.controls?.querySelector("[data-inpuls-tape-mode]"), state);

  const recentRaw = visibleWaterTapeNodes(
    state.rawRenderNodes,
    window,
    state.recentRawScratch,
  );
  const liveAggregates = visibleWaterTapeNodes(
    materializeZeroMsAggregates(
      state,
      state.aggSourceBuckets,
      state.finalizedAggScratch,
    ),
    window,
    state.closedAggScratch,
  );
  const liveSeries = visibleWaterTapeNodes(
    materializeTapeSeries(
      state,
      state.seriesSourceBuckets,
      state.finalizedSeriesScratch,
      exchangeNow,
    ),
    window,
    state.closedSeriesScratch,
  );

  paintTapeSurface(context, rect);
  state.hasFrame = false;
  drawTapeTimeline(context, rect, window);
  drawTapeLiveEdge(context, rect, window);

  const minQuote = Math.max(0, Number(state.minQuote) || 0);
  const pathItems = projectWaterTapeNodes(
    recentRaw,
    state.priceViewport,
    state.pathProjectionScratch,
  );
  if (pathItems.length > 1) {
    context.save();
    context.strokeStyle = "rgba(130, 151, 160, .34)";
    context.lineWidth = .7;
    context.beginPath();
    let previous = null;
    for (const projected of pathItems) {
      const item = projected.source;
      const x = tapeTradeX(item.time, window, rect.width);
      const y = projected.position.y;
      if (!previous || item.time - previous.time > 1_500) context.moveTo(x, y);
      else context.lineTo(x, y);
      previous = item;
    }
    context.stroke();
    context.restore();
  }

  const sourceItems = state.mode === "agg"
    ? liveAggregates
    : state.mode === "series"
      ? liveSeries
      : recentRaw;
  const candidates = filterWaterTapeCandidates(
    sourceItems,
    minQuote,
    state.candidateScratch,
  );
  const visibility = classifyTapeCandidates(candidates, range);
  setTapeRangeSummary(state, visibility.above, visibility.below);
  const items = projectWaterTapeNodes(
    candidates,
    state.priceViewport,
    state.markerProjectionScratch,
  );

  if (!candidates.length) {
    setTapeState(
      state,
      state.mode === "agg"
        ? "Жду агрегированную сделку…"
        : state.mode === "series"
          ? (state.seriesRenderSource === "raw"
            ? "Жду агрессивную серию RAW…"
            : "Жду агрессивную серию · источник AGG…")
          : "Жду сделку…",
    );
    state.hasFrame = true;
    skip("filter-empty", { recent: recentRaw.length });
    return;
  }
  if (!items.length) {
    setTapeState(state, "Сделки находятся вне видимой ценовой шкалы");
    state.hasFrame = true;
    skip("no-visible-items", { candidates: candidates.length });
    return;
  }

  const staleSuffix = staleTradeSuffix(symbol);
  setTapeState(
    state,
    frozen
      ? "ПОСЛЕДНИЙ КАДР · ждём свежий поток"
      : staleSuffix
        ? `НЕТ НОВЫХ СДЕЛОК${staleSuffix}`
        : "",
    frozen || staleSuffix ? "attention" : "neutral",
  );

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "800 8px Inter, system-ui, sans-serif";

  const rawMarkerBatches = state.mode === "raw" && minQuote === 0
    ? prepareRawTapeMarkerBatches(state)
    : null;

  for (const projected of items) {
    const item = projected.source;
    const projectedY = projected.position.y;
    const y = state.mode !== "raw"
      ? aggregateLabelY(state.priceViewport, item, projectedY)
      : projectedY;
    const buy = item.buyQuote >= item.sellQuote;
    const stroke = buy ? "rgba(88, 239, 184, .9)" : "rgba(255, 121, 137, .9)";
    const strength = stableTapeQuoteStrength(item.quote);
    const baseX = tapeTradeX(item.time, window, rect.width);

    if (state.mode === "series") {
      const openSeries = item.status === "open";
      const terminal = drawTapeSeriesLadder(
        context,
        item,
        state.priceViewport,
        window,
        rect,
        stroke,
        openSeries,
      );
      if (!terminal) continue;
      const label = formatTapeUsd(item.quote);
      context.font = "900 9px Inter, system-ui, sans-serif";
      const labelHeight = clampTape(10 + strength * 6, 10, 17);
      const measured = context.measureText(label).width;
      const labelWidth = clampTape(measured + 10, 22, Math.min(88, rect.width * .28));
      const labelX = clampTape(
        terminal.x,
        labelWidth / 2 + .5,
        Math.max(labelWidth / 2 + .5, window.plotRight - labelWidth / 2 - .5),
      );
      const labelY = clampTape(
        terminal.y,
        labelHeight / 2 + .5,
        Math.max(labelHeight / 2 + .5, rect.height - 17 - labelHeight / 2),
      );
      roundedRectPath(
        context,
        labelX - labelWidth / 2,
        labelY - labelHeight / 2,
        labelWidth,
        labelHeight,
        labelHeight * .28,
      );
      context.fillStyle = buy
        ? `rgba(42, 191, 137, ${openSeries ? .84 : .9})`
        : `rgba(222, 70, 87, ${openSeries ? .86 : .92})`;
      context.fill();
      context.lineWidth = 1.4;
      context.strokeStyle = stroke;
      context.stroke();
      context.fillStyle = "rgba(244, 250, 248, .99)";
      context.fillText(label, labelX, labelY + .2);
      continue;
    }

    if (state.mode === "raw") {
      if (minQuote > 0) {
        const label = formatTapeUsd(item.quote);
        const measured = context.measureText(label).width;
        const height = clampTape(9 + strength * 4, 9, 15);
        const width = clampTape(measured + 9, 24, Math.min(88, rect.width * .28));
        const x = clampTape(
          baseX,
          width / 2 + .5,
          Math.max(width / 2 + .5, window.plotRight - width / 2 - .5),
        );
        roundedRectPath(context, x - width / 2, y - height / 2, width, height, 2);
        context.fillStyle = buy ? "rgba(42, 191, 137, .82)" : "rgba(222, 70, 87, .84)";
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = stroke;
        context.stroke();
        context.fillStyle = "rgba(244, 250, 248, .99)";
        context.fillText(label, x, y + .2);
      } else {
        const bucketIndex = rawTapeMarkerBucket(strength, buy);
        const sizeIndex = bucketIndex % RAW_TAPE_MARKER_BUCKETS;
        const bucketStrength = sizeIndex / Math.max(1, RAW_TAPE_MARKER_BUCKETS - 1) * 1.35;
        const diameter = clampTape(1.8 + bucketStrength * 7, 1.8, 10.8);
        const x = clampTape(
          baseX,
          diameter / 2 + .5,
          Math.max(diameter / 2 + .5, window.plotRight - diameter / 2 - .5),
        );
        rawMarkerBatches[bucketIndex].push(x, y);
      }
      continue;
    }

    const showLabel = minQuote > 0 || Boolean(item.showLabel);
    const openAggregate = item.status === "open";
    const label = formatTapeUsd(item.quote);
    const diameter = clampTape(4 + strength * 6, 4, 12);
    if (!showLabel) {
      const x = aggregateStableX(
        baseX,
        item.timeOrdinal,
        diameter,
        window.plotRight,
      );
      drawAggregatePriceRange(
        context,
        state.priceViewport,
        item,
        x,
        buy,
        stroke,
        strength,
        openAggregate,
      );
      context.beginPath();
      context.arc(x, y, diameter / 2, 0, Math.PI * 2);
      context.fillStyle = buy ? "rgba(42, 191, 137, .68)" : "rgba(222, 70, 87, .7)";
      context.fill();
      context.lineWidth = item.count > 1 ? .95 : .6;
      context.strokeStyle = stroke;
      context.stroke();
      continue;
    }

    const measured = context.measureText(label).width;
    const height = clampTape(7 + strength * 6, 7, 14);
    const width = clampTape(measured + 9, 18, Math.min(84, rect.width * .26));
    const x = aggregateStableX(
      baseX,
      item.timeOrdinal,
      width,
      window.plotRight,
    );
    drawAggregatePriceRange(
      context,
      state.priceViewport,
      item,
      x,
      buy,
      stroke,
      strength,
      openAggregate,
    );
    roundedRectPath(context, x - width / 2, y - height / 2, width, height, height * .28);
    context.fillStyle = buy
      ? `rgba(42, 191, 137, ${openAggregate ? .66 : .76})`
      : `rgba(222, 70, 87, ${openAggregate ? .68 : .78})`;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = stroke;
    context.stroke();
    context.fillStyle = "rgba(244, 250, 248, .98)";
    context.fillText(label, x, y + .2);
  }

  if (rawMarkerBatches) drawRawTapeMarkerBatches(context, rawMarkerBatches);

  state.hasFrame = true;
  if (observability.enabled) {
    observability.rendered(symbol, "tape");
    observability.record("tape.render-card", performance.now() - drawStartedAt, {
      symbol,
      trades: stored.length,
      items: items.length,
      renderer: "water-v1",
    });
  }
}

function drawAllTapes() {
  if (tapeDocumentHidden) {
    observability.skipRender("tape", "document-hidden");
    return;
  }

  if (tapeDrawAllRequested) {
    document.querySelectorAll(".orderbook-card").forEach((card) => dirtyTapeCards.add(card));
    tapeDrawAllRequested = false;
  }

  const drawStartedAt = performance.now();
  let rendered = 0;
  let disconnected = 0;
  for (const card of dirtyTapeCards) {
    dirtyTapeCards.delete(card);
    if (!card?.isConnected) {
      disconnected += 1;
      continue;
    }
    drawTapeCard(card);
    rendered += 1;
    if (
      rendered >= TAPE_DRAW_MAX_CARDS
      || performance.now() - drawStartedAt >= TAPE_DRAW_BUDGET_MS
    ) break;
  }
  tapeNeedsDraw = dirtyTapeCards.size > 0;
  if (observability.enabled) {
    observability.record("tape.draw-all", performance.now() - drawStartedAt, {
      cards: rendered,
      remaining: dirtyTapeCards.size,
      yielded: tapeNeedsDraw,
      disconnected,
    });
    if (tapeNeedsDraw) observability.increment("tape.scheduler-yield");
  }
}

function cancelTapeDraw() {
  if (tapeDrawFrame) cancelAnimationFrame(tapeDrawFrame);
  if (tapeDrawTimer) clearTimeout(tapeDrawTimer);
  tapeDrawFrame = 0;
  tapeDrawTimer = 0;
}

function targetTapeFrameMs() {
  const count = Math.max(1, document.querySelectorAll(".orderbook-card").length);
  const base = count >= 6 ? 50 : count >= 3 ? 32 : 16;
  const symbols = new Set(
    [...document.querySelectorAll(".orderbook-card")]
      .map((card) => cardSymbol(card))
      .filter(Boolean),
  );
  const recentRate = [...symbols]
    .reduce((total, symbol) => total + (tapeRecentRateBySymbol.get(symbol) || 0), 0);
  if (recentRate > 2_000) return Math.max(base, 32);
  if (recentRate > 1_000) return Math.max(base, 24);
  if (recentRate > 500) return Math.max(base, 20);
  return base;
}

function activeTapeCards() {
  return [...document.querySelectorAll(".orderbook-card")].filter((card) => {
    const state = tapeCardStates.get(card);
    const symbol = cardSymbol(card);
    return Boolean(
      card.isConnected
      && state?.tapeVisible
      && symbol
      && (tapeTradesBySymbol.get(symbol)?.length ?? 0) > 0
      && !tapeRecoveryFrozen(symbol)
    );
  });
}

function runTapeDrawFrame(frameNow) {
  tapeDrawFrame = 0;
  if (tapeDocumentHidden) return;
  const activeCards = activeTapeCards();
  const frameMs = targetTapeFrameMs();
  const due = Number(frameNow) - tapeLastDrawAt >= frameMs;
  if (due) {
    activeCards.forEach((card) => dirtyTapeCards.add(card));
    tapeNeedsDraw = tapeNeedsDraw || dirtyTapeCards.size > 0;
    if (tapeNeedsDraw) drawAllTapes();
    tapeLastDrawAt = Number(frameNow);
  }
  if (tapeNeedsDraw || activeCards.length) {
    tapeDrawFrame = requestAnimationFrame(runTapeDrawFrame);
  }
}

function scheduleTapeDraw(force = false, card = null) {
  if (typeof document === "undefined") return;
  tapeNeedsDraw = true;
  if (card?.isConnected) dirtyTapeCards.add(card);
  else tapeDrawAllRequested = true;
  if (tapeDocumentHidden) return;
  if (force) tapeLastDrawAt = 0;
  if (!tapeDrawFrame) tapeDrawFrame = requestAnimationFrame(runTapeDrawFrame);
}

export function tapeVisualTime(tradeTime, eventTime, rxLatencyMs) {
  const trade = Number(tradeTime);
  const event = Number(eventTime);
  const latency = Number.isFinite(Number(rxLatencyMs))
    ? clampTape(Number(rxLatencyMs), 0, 10_000)
    : 0;
  const source = Number.isFinite(event) ? event : trade;
  if (!Number.isFinite(source)) return null;
  const receivedExchangeTime = source + latency;
  return Number.isFinite(trade)
    ? Math.max(trade, receivedExchangeTime)
    : receivedExchangeTime;
}

export function tapeDisplayTimeFromReceipt(
  receivedAt,
  executionTime,
  exchangeNow = binanceClock.now(),
  localNow = Date.now(),
) {
  const received = Number(receivedAt);
  const execution = Number(executionTime);
  const exchange = Number(exchangeNow);
  const local = Number(localNow);
  if ([received, exchange, local].every(Number.isFinite)) {
    const aligned = received + (exchange - local);
    return Number.isFinite(execution) ? Math.max(execution, aligned) : aligned;
  }
  return Number.isFinite(execution) ? execution : null;
}

function normalizeTapeTrade(trade) {
  const price = Number(trade?.price);
  const quantity = Number(trade?.quantity);
  const quote = Number(trade?.quote);
  const time = Number(trade?.time ?? trade?.tradeTime);
  const tradeTime = Number(trade?.tradeTime ?? time);
  const eventTime = Number(trade?.eventTime ?? time);
  const receivedAt = Number(trade?.receivedAt);
  const rxLatencyMs = Number(trade?.rxLatencyMs);
  const displayTime = tapeDisplayTimeFromReceipt(receivedAt, time);
  if (![price, quantity, quote, time].every(Number.isFinite) || quote <= 0) return null;
  return {
    id: trade?.id ?? `${time}-${price}-${quantity}`,
    firstTradeId: Number.isInteger(Number(trade?.firstTradeId)) ? Number(trade.firstTradeId) : null,
    lastTradeId: Number.isInteger(Number(trade?.lastTradeId)) ? Number(trade.lastTradeId) : null,
    source: trade?.source === "raw" ? "raw" : "agg",
    price,
    quantity,
    quote,
    time,
    displayTime: Number.isFinite(displayTime) ? displayTime : time,
    tradeTime: Number.isFinite(tradeTime) ? tradeTime : time,
    eventTime: Number.isFinite(eventTime) ? eventTime : time,
    receivedAt: Number.isFinite(receivedAt) ? receivedAt : null,
    rxLatencyMs: Number.isFinite(rxLatencyMs) ? rxLatencyMs : null,
    side: trade?.side === "sell" ? "sell" : "buy",
  };
}

function tapeTradeKey(trade) {
  const executionTime = Number(trade?.tradeTime ?? trade?.eventTime ?? trade?.time);
  return `${String(trade.id)}:${executionTime}:${trade.price}:${trade.quantity}`;
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
  const frameStartedAt = performance.now();
  let budget = TAPE_INGEST_PER_FRAME;
  const cardCount = Math.max(1, document.querySelectorAll(".orderbook-card").length);
  if (cardCount >= 6) budget = 120;
  else if (cardCount >= 3) budget = 170;
  const pendingEntries = [...tapePendingBySymbol.entries()];
  const liveShare = Math.max(1, Math.floor(budget / Math.max(1, pendingEntries.length)));
  let processedSymbols = 0;
  let processedTrades = 0;

  for (const [symbol, pending] of pendingEntries) {
    if (budget <= 0) break;
    const allowance = pending.resume
      ? TAPE_RESUME_MAX_PENDING
      : Math.min(budget, liveShare);
    let primaryTake = Math.min(pending.trades.length, Math.ceil(allowance / 3));
    let aggregationTake = Math.min(
      pending.aggregationTrades.length,
      Math.ceil(Math.max(0, allowance - primaryTake) / 2),
    );
    let seriesTake = Math.min(
      pending.seriesTrades.length,
      Math.max(0, allowance - primaryTake - aggregationTake),
    );
    let unused = allowance - primaryTake - aggregationTake - seriesTake;
    for (const channel of ["trades", "aggregationTrades", "seriesTrades"]) {
      if (unused <= 0) break;
      const current = channel === "trades"
        ? primaryTake
        : channel === "aggregationTrades"
          ? aggregationTake
          : seriesTake;
      const extra = Math.min(unused, pending[channel].length - current);
      if (channel === "trades") primaryTake += extra;
      else if (channel === "aggregationTrades") aggregationTake += extra;
      else seriesTake += extra;
      unused -= extra;
    }

    const primaryChunk = pending.trades.splice(0, primaryTake);
    const aggregationChunk = pending.aggregationTrades.splice(0, aggregationTake);
    const seriesChunk = pending.seriesTrades.splice(0, seriesTake);
    const changed = pending.replace
      || pending.seriesReplace
      || primaryChunk.length
      || aggregationChunk.length
      || seriesChunk.length;
    if (!changed) {
      tapePendingBySymbol.delete(symbol);
      continue;
    }

    processedSymbols += 1;
    processedTrades += primaryChunk.length + aggregationChunk.length + seriesChunk.length;
    tapeTradesBySymbol.set(
      symbol,
      mergeTapeHistory(tapeTradesBySymbol.get(symbol) ?? [], primaryChunk, pending.replace),
    );
    tapeAggregationTradesBySymbol.set(
      symbol,
      mergeTapeHistory(tapeAggregationTradesBySymbol.get(symbol) ?? [], aggregationChunk, pending.replace),
    );
    tapeSeriesTradesBySymbol.set(
      symbol,
      mergeTapeHistory(
        tapeSeriesTradesBySymbol.get(symbol) ?? [],
        seriesChunk,
        pending.replace || pending.seriesReplace,
      ),
    );
    tapeDataVersionBySymbol.set(
      symbol,
      (Number(tapeDataVersionBySymbol.get(symbol)) || 0) + 1,
    );
    pending.replace = false;
    pending.seriesReplace = false;
    if (pending.resume) {
      pending.resume = false;
      budget = 0;
    } else {
      budget -= Math.max(1, primaryChunk.length + aggregationChunk.length + seriesChunk.length);
    }

    const stored = tapeTradesBySymbol.get(symbol) ?? [];
    const aggregationStored = tapeAggregationTradesBySymbol.get(symbol) ?? [];
    const seriesStored = tapeSeriesTradesBySymbol.get(symbol) ?? [];
    const latestTime = Math.max(
      Number(stored[0]?.time) || 0,
      Number(aggregationStored[0]?.time) || 0,
      Number(seriesStored[0]?.time) || 0,
    ) || Date.now();
    const previousMeta = tapeMetaBySymbol.get(symbol) ?? {};
    tapeMetaBySymbol.set(symbol, {
      lastPacketAt: Date.now(),
      lastPacketPerfAt: performance.now(),
      lastTradeTime: latestTime,
      packets: (Number(previousMeta.packets) || 0) + 1,
      aggregationSource: pending.aggregationSource === "raw" ? "raw" : "agg",
      aggregationHealth: pending.aggregationHealth ?? previousMeta.aggregationHealth ?? null,
      seriesSource: pending.seriesSource === "raw" ? "raw" : "warming",
      seriesHealth: pending.seriesHealth ?? previousMeta.seriesHealth ?? null,
    });
    tapeRecentRateBySymbol.set(symbol, stored.reduce(
      (count, trade) => count + (trade.time >= latestTime - 1_000 ? 1 : 0),
      0,
    ));

    const cards = [...document.querySelectorAll(".orderbook-card")]
      .filter((card) => cardSymbol(card) === symbol && flowLayerVisible(card));
    cards.forEach((card) => scheduleTapeDraw(false, card));

    if (
      !pending.trades.length
      && !pending.aggregationTrades.length
      && !pending.seriesTrades.length
      && !pending.replace
      && !pending.seriesReplace
    ) {
      tapePendingBySymbol.delete(symbol);
    }
  }

  if (observability.enabled) {
    observability.record("tape.ingest-frame", performance.now() - frameStartedAt, {
      symbols: processedSymbols,
      trades: processedTrades,
      pendingSymbols: tapePendingBySymbol.size,
    });
  }
  if (tapePendingBySymbol.size) scheduleTapeIngest();
}

function acceptTapeData(event) {
  const detail = event?.detail;
  const symbol = String(detail?.symbol ?? "").toUpperCase();
  if (!symbol.endsWith("USDT")) return;
  if (!detail?.replace && !detail?.seriesReplace && !detail?.live) return;
  const carriesData = Boolean(detail?.live || detail?.replace || detail?.seriesReplace);
  const incoming = carriesData && Array.isArray(detail?.trades)
    ? detail.trades.map(normalizeTapeTrade).filter(Boolean)
    : [];
  const incomingAggregation = carriesData && Array.isArray(detail?.aggregationTrades)
    ? detail.aggregationTrades.map(normalizeTapeTrade).filter(Boolean)
    : [];
  const incomingSeries = carriesData && Array.isArray(detail?.seriesTrades)
    ? detail.seriesTrades.map(normalizeTapeTrade).filter(Boolean)
    : [];
  if (
    !detail?.replace
    && !detail?.seriesReplace
    && !incoming.length
    && !incomingAggregation.length
    && !incomingSeries.length
  ) return;
  if (detail?.replace) {
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      if (cardSymbol(card) !== symbol) return;
      const state = tapeCardStates.get(card);
      if (state) {
        state.hasFrame = false;
        state.clockEndTime = null;
        state.clockPerfAt = null;
        state.priceViewport = null;
        state.priceViewportAt = null;
        state.targetPriceViewport = null;
        state.priceRange = null;
        state.viewportSampleAt = null;
        state.viewportDirty = true;
        state.renderModelKey = null;
        state.rawNodeByKey?.clear?.();
        state.rawRenderNodes = [];
        state.aggSourceBuckets = [];
        state.seriesSourceBuckets = [];
        state.aggSnapshots?.clear?.();
        state.seriesSnapshots?.clear?.();
      }
    });
  }

  const pending = tapePendingBySymbol.get(symbol) ?? {
    trades: [],
    aggregationTrades: [],
    seriesTrades: [],
    aggregationSource: "agg",
    aggregationHealth: null,
    seriesSource: "warming",
    seriesHealth: null,
    replace: false,
    seriesReplace: false,
    resume: false,
  };
  pending.aggregationSource = detail?.aggregationSource === "raw" ? "raw" : "agg";
  pending.aggregationHealth = detail?.aggregationHealth ?? pending.aggregationHealth;
  pending.seriesSource = detail?.seriesSource === "raw" ? "raw" : "warming";
  pending.seriesHealth = detail?.seriesHealth ?? pending.seriesHealth;
  if (detail.resume) {
    pending.trades = incoming.slice(0, TAPE_RESUME_MAX_PENDING);
    pending.aggregationTrades = incomingAggregation.slice(0, TAPE_RESUME_MAX_PENDING);
    pending.seriesTrades = incomingSeries.slice(0, TAPE_RESUME_MAX_PENDING);
    pending.replace = false;
    pending.seriesReplace = Boolean(detail.seriesReplace);
    pending.resume = true;
  } else if (detail.replace) {
    pending.trades = incoming.slice(0, TAPE_MAX_STORED);
    pending.aggregationTrades = incomingAggregation.slice(0, TAPE_MAX_STORED);
    pending.seriesTrades = incomingSeries.slice(0, TAPE_MAX_STORED);
    pending.replace = true;
    pending.seriesReplace = true;
    pending.resume = false;
  } else {
    if (incoming.length) pending.trades.push(...incoming);
    if (incomingAggregation.length) pending.aggregationTrades.push(...incomingAggregation);
    if (detail.seriesReplace) {
      pending.seriesTrades = incomingSeries.slice(0, TAPE_MAX_STORED);
      pending.seriesReplace = true;
    } else if (incomingSeries.length) {
      pending.seriesTrades.push(...incomingSeries);
    }
    for (const [name, queue] of [
      ["primary", pending.trades],
      ["aggregation", pending.aggregationTrades],
      ["series", pending.seriesTrades],
    ]) {
      if (queue.length <= TAPE_LIVE_MAX_PENDING) continue;
      const dropped = queue.length - TAPE_LIVE_MAX_PENDING;
      queue.splice(0, dropped);
      observability.record("tape.main-dropped", dropped, { symbol, channel: name });
    }
  }
  tapePendingBySymbol.set(symbol, pending);
  scheduleTapeIngest();
}

function bindTapeCard(card) {
  if (!card?.isConnected) return;
  boundTapeCards.add(card);
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
  globalThis.addEventListener(ORDERBOOK_WORKER_STATUS_EVENT, acceptBookStatus);
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
  globalThis.addEventListener("inpuls:theme-change", () => {
    cachedTapeSurfaceColor = null;
    scheduleTapeDraw(true);
  });
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
    const state = tapeCardStates.get(card);
    if (state) state.viewportDirty = true;
    setTimeout(() => scheduleTapeDraw(false, card), 0);
  }, { capture: true, passive: true });

  clearTimeout(tapeStateTimer);
  const refreshTapeStateHeartbeat = () => {
    for (const card of boundTapeCards) {
      if (!card?.isConnected) {
        boundTapeCards.delete(card);
        continue;
      }
      const state = tapeCardStates.get(card);
      if (!state) {
        boundTapeCards.delete(card);
        continue;
      }
      const symbol = cardSymbol(card);
      const suffix = staleTradeSuffix(symbol);
      if (suffix) setTapeState(state, `НЕТ НОВЫХ СДЕЛОК${suffix}`, "attention");
      else if (state.lastStatusText?.startsWith("НЕТ НОВЫХ СДЕЛОК")) setTapeState(state, "");
    }
  };
  const runTapeStateHeartbeat = () => {
    tapeStateTimer = 0;
    if (!tapeDocumentHidden) refreshTapeStateHeartbeat();
    tapeStateTimer = setTimeout(runTapeStateHeartbeat, TAPE_STATE_REFRESH_MS);
  };
  tapeStateTimer = setTimeout(runTapeStateHeartbeat, TAPE_STATE_REFRESH_MS);

  scheduleTapeDraw(true);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installOrderBookRuntime, { once: true });
  } else {
    installOrderBookRuntime();
  }
}

function installOrderbookVisualPriorityStyles() {
  if (typeof document === "undefined" || document.getElementById("inpuls-orderbook-visual-priority-v1")) return;
  const style = document.createElement("style");
  style.id = "inpuls-orderbook-visual-priority-v1";
  style.textContent = `
    .orderbook-card .book-ladder-row {
      grid-template-columns: minmax(0, 1fr) var(--book-price-width, 8.25ch) !important;
      column-gap: 4px !important;
      align-items: stretch !important;
      position: relative;
    }
    .orderbook-card .book-hover-percent {
      position: absolute;
      left: 3px;
      z-index: 70;
      width: 45px;
      height: 16px;
      display: grid;
      place-items: center;
      transform: translateY(-50%);
      border: 1px solid color-mix(in srgb, var(--accent) 58%, var(--line));
      border-radius: 3px;
      color: var(--text);
      background: color-mix(in srgb, var(--panel) 92%, #000);
      box-shadow: 0 2px 8px rgba(0, 0, 0, .42);
      pointer-events: none;
      font: 850 7px/1 Inter, system-ui, sans-serif;
      font-variant-numeric: tabular-nums;
    }
    .orderbook-card .book-hover-percent[hidden] {
      display: none !important;
    }
    .orderbook-card .book-hover-percent.is-bid {
      border-color: color-mix(in srgb, var(--green) 72%, var(--line));
      color: color-mix(in srgb, var(--green) 82%, var(--text));
    }
    .orderbook-card .book-hover-percent.is-ask {
      border-color: color-mix(in srgb, var(--red) 72%, var(--line));
      color: color-mix(in srgb, var(--red) 82%, var(--text));
    }
    .orderbook-card .book-ladder-row strong {
      width: 100% !important;
      min-width: 0 !important;
      overflow: hidden !important;
      padding: 0 3px 0 2px !important;
      border-left: 0 !important;
      justify-self: stretch !important;
      justify-content: flex-end !important;
      text-align: right !important;
      white-space: nowrap;
      box-sizing: border-box;
    }
    .orderbook-card .book-ladder-row .book-size::before,
    .orderbook-card .book-ladder-row.is-bid .book-size::before,
    .orderbook-card .book-ladder-row.is-ask .book-size::before {
      background: linear-gradient(90deg, rgba(232, 237, 240, .88), rgba(151, 161, 169, .48)) !important;
      opacity: .84 !important;
    }
    .orderbook-card .book-ladder-row.is-market {
      z-index: 5;
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--green) 18%, var(--panel)),
        color-mix(in srgb, var(--green) 34%, var(--panel))
      ) !important;
      box-shadow:
        inset 4px 0 var(--green),
        inset 0 1px color-mix(in srgb, var(--green) 82%, transparent),
        inset 0 -1px color-mix(in srgb, var(--green) 82%, transparent),
        0 0 8px color-mix(in srgb, var(--green) 22%, transparent);
    }
    .orderbook-card .book-ladder-row.is-market strong {
      margin: 0 !important;
      border: 0 !important;
      border-left: 1px solid color-mix(in srgb, var(--green) 66%, var(--line)) !important;
      border-radius: 0 !important;
      color: #effff9 !important;
      background: transparent !important;
      box-shadow: none !important;
      text-shadow: 0 0 5px color-mix(in srgb, var(--green) 52%, transparent);
      font-weight: 950 !important;
    }
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) {
      background: transparent !important;
      box-shadow: none !important;
    }
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) strong {
      border-left: 2px solid color-mix(in srgb, var(--accent) 72%, #fff);
      color: inherit !important;
      font-size: inherit !important;
      font-weight: 800 !important;
      text-shadow: none !important;
      letter-spacing: 0 !important;
    }
    .orderbook-card .book-ladder-row.is-anomaly:not(.is-market) {
      background: transparent !important;
      box-shadow: none !important;
    }
    .orderbook-card .book-ladder-row.is-anomaly .book-size {
      color: #f4f8fa !important;
      text-shadow:
        0 1px 2px rgba(0, 0, 0, .98),
        0 0 3px rgba(0, 0, 0, .88) !important;
      font-weight: 950 !important;
    }
    .orderbook-card .book-ladder-row:not(.is-anomaly) .book-size {
      color: #e5edf1 !important;
      text-shadow:
        0 1px 2px rgba(0, 0, 0, .96),
        0 0 3px rgba(0, 0, 0, .82) !important;
    }
    .orderbook-card .book-ladder-row.is-market:not(.is-anomaly) .book-size {
      color: #effff9 !important;
      text-shadow: 0 1px 2px rgba(0, 0, 0, .74) !important;
      font-weight: 950 !important;
    }
    .orderbook-card .book-ladder-row.is-anomaly .book-size::before {
      opacity: .98 !important;
    }
    .orderbook-card .book-ladder-row.is-anomaly-tier-1 .book-size::before {
      background: linear-gradient(90deg, #82e4ff, #3ab6e8) !important;
      box-shadow: inset 2px 0 #e3faff;
    }
    .orderbook-card .book-ladder-row.is-anomaly-tier-2 .book-size::before {
      background: linear-gradient(90deg, #d0a8ff, #8c5df3) !important;
      box-shadow: inset 3px 0 #f0e2ff;
    }
    .orderbook-card .book-ladder-row.is-anomaly-tier-3 .book-size::before {
      background: linear-gradient(90deg, #fff49c, #ffb43f 64%, #ff685d) !important;
      box-shadow: inset 4px 0 #fffbd7;
    }
  `;
  document.head.append(style);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installOrderbookVisualPriorityStyles, { once: true });
  } else {
    installOrderbookVisualPriorityStyles();
  }
}
