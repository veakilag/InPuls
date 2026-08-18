import { binanceClock } from "./binance-clock.js?v=26-102-tape-live-edge-minute-boundary-v1";
import { normalizeOrderBookMarketKey } from "./orderbook-market-key.js?v=26-125-aster-alpha-v1";
import { observability } from "./observability.js?v=render-scheduler-v1";

export const FLOW_WORKSPACE = Object.freeze({
  historyMs: 5 * 60_000,
  minimumBucketMs: 250,
  maximumColumns: 28,
  maximumTrades: 6_000,
  minimumPanePx: 88,
  minimumTapePx: 160,
  minimumBookPx: 104,
});

export const FOOTPRINT_TIMEFRAMES = Object.freeze([
  "1s", "5s", "15s", "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "12h", "1d", "3d", "1w", "1M",
]);
const FOOTPRINT_TIMEFRAME_KEY = "inpuls-footprint-timeframe-v2";
const FOOTPRINT_FAVORITES_KEY = "inpuls-footprint-favorite-timeframes-v1";
const FLOW_LAYER_VISIBILITY_EVENT = "inpuls:flow-layer-visibility";
const FOOTPRINT_BASE_BUCKET_MS = 1_000;
const FOOTPRINT_RETAIN_MS = 30 * 60_000;
const FOOTPRINT_MAX_RETAINED_CELLS = 40_000;
const FOOTPRINT_MAX_RETAINED_TRADE_KEYS = 120_000;
const FOOTPRINT_MAX_SEALED_INTERVALS = 160;
const FOOTPRINT_INTERVAL_MS = Object.freeze({
  "1s": 1_000, "5s": 5_000, "15s": 15_000,
  "1m": 60_000, "3m": 180_000, "5m": 300_000,
  "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000,
  "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000,
});
const FOOTPRINT_DEFAULT_FAVORITES = Object.freeze(["1m", "5m", "15m"]);
const FOOTPRINT_DEFAULT_COLUMN_PX = 54;
const FOOTPRINT_MIN_COLUMN_PX = 34;
const FOOTPRINT_MAX_COLUMN_PX = 90;
const FOOTPRINT_COLUMN_STEP_PX = 7;
const FOOTPRINT_MAX_VISIBLE_COLUMNS = 16;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function footprintExchangeNow() {
  const perfNow = typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : undefined;
  const exchangeNow = binanceClock.now(perfNow);
  return Number.isFinite(Number(exchangeNow)) ? Number(exchangeNow) : Date.now();
}

export function flowDisplayTimeFromReceipt(
  receivedAt,
  executionTime,
  exchangeNow = footprintExchangeNow(),
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

export function footprintColumnWidthForWheel(currentWidth, deltaY) {
  const current = clamp(
    Number(currentWidth) || FOOTPRINT_DEFAULT_COLUMN_PX,
    FOOTPRINT_MIN_COLUMN_PX,
    FOOTPRINT_MAX_COLUMN_PX,
  );
  const wheel = Number(deltaY);
  if (!Number.isFinite(wheel) || wheel === 0) return current;
  return clamp(
    current + (wheel < 0 ? -FOOTPRINT_COLUMN_STEP_PX : FOOTPRINT_COLUMN_STEP_PX),
    FOOTPRINT_MIN_COLUMN_PX,
    FOOTPRINT_MAX_COLUMN_PX,
  );
}

export function normalizeFlowTrade(trade) {
  const price = Number(trade?.price);
  const quantity = Number(trade?.quantity);
  const quote = Number(trade?.quote ?? price * quantity);
  const executionTime = Number(trade?.tradeTime ?? trade?.eventTime ?? trade?.time);
  const receivedAt = Number(trade?.receivedAt);
  const alignedTime = flowDisplayTimeFromReceipt(receivedAt, executionTime);
  const legacyDisplayTime = Number(trade?.displayTime);
  const time = Number.isFinite(receivedAt)
    ? alignedTime
    : (Number.isFinite(legacyDisplayTime)
      ? Math.max(executionTime, legacyDisplayTime)
      : executionTime);
  if (![price, quantity, quote, time].every(Number.isFinite) || price <= 0 || quantity <= 0 || quote <= 0) {
    return null;
  }
  return {
    id: trade?.id ?? `${time}:${price}:${quantity}`,
    price,
    quantity,
    quote,
    time,
    executionTime,
    side: trade?.side === "sell" ? "sell" : "buy",
  };
}

function flowTradeKey(trade) {
  const executionTime = Number(trade?.executionTime ?? trade?.time);
  return `${String(trade.id)}:${executionTime}:${trade.price}:${trade.quantity}`;
}

function compareFlowTrades(left, right) {
  const leftTime = Number(left?.executionTime ?? left?.time);
  const rightTime = Number(right?.executionTime ?? right?.time);
  return rightTime - leftTime || String(right.id).localeCompare(String(left.id));
}

function mergeSortedFlowTrades(current, incoming, limit) {
  const seen = new Set();
  const result = [];
  let currentIndex = 0;
  let incomingIndex = 0;

  while (
    result.length < limit
    && (currentIndex < current.length || incomingIndex < incoming.length)
  ) {
    const currentTrade = current[currentIndex];
    const incomingTrade = incoming[incomingIndex];
    const takeIncoming = currentTrade === undefined
      || (incomingTrade !== undefined && compareFlowTrades(incomingTrade, currentTrade) <= 0);
    const trade = takeIncoming ? incomingTrade : currentTrade;
    if (takeIncoming) incomingIndex += 1;
    else currentIndex += 1;
    if (!trade) continue;
    const key = flowTradeKey(trade);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trade);
  }
  return result;
}

export function mergeFlowTrades(current, incoming, limit = FLOW_WORKSPACE.maximumTrades, replace = false) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || FLOW_WORKSPACE.maximumTrades));
  const normalizedIncoming = (incoming ?? [])
    .map(normalizeFlowTrade)
    .filter(Boolean)
    .sort(compareFlowTrades);
  const normalizedCurrent = replace
    ? []
    : (current ?? []).map(normalizeFlowTrade).filter(Boolean).sort(compareFlowTrades);
  return mergeSortedFlowTrades(normalizedCurrent, normalizedIncoming, safeLimit);
}

function mergeLiveFlowTrades(current, incoming, limit = FLOW_WORKSPACE.maximumTrades, replace = false) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || FLOW_WORKSPACE.maximumTrades));
  const normalizedIncoming = (incoming ?? [])
    .map(normalizeFlowTrade)
    .filter(Boolean)
    .sort(compareFlowTrades);
  return mergeSortedFlowTrades(replace ? [] : (current ?? []), normalizedIncoming, safeLimit);
}

export function flowWindow(endTime, durationMs = FLOW_WORKSPACE.historyMs) {
  const end = Number(endTime) || Date.now();
  const duration = Math.max(1_000, Number(durationMs) || FLOW_WORKSPACE.historyMs);
  return { startTime: end - duration, endTime: end, duration };
}

export function footprintBucketMs(width, durationMs = FLOW_WORKSPACE.historyMs) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const targetColumns = clamp(Math.floor(safeWidth / 34), 6, FLOW_WORKSPACE.maximumColumns);
  const raw = Math.max(FLOW_WORKSPACE.minimumBucketMs, Number(durationMs) / targetColumns);
  return Math.ceil(raw / FLOW_WORKSPACE.minimumBucketMs) * FLOW_WORKSPACE.minimumBucketMs;
}

export function buildFootprintColumns(trades, options = {}) {
  const startTime = Number(options.startTime);
  const endTime = Number(options.endTime);
  const priceStep = Math.max(Number.EPSILON, Number(options.priceStep) || .01);
  const bucketMs = Math.max(
    FLOW_WORKSPACE.minimumBucketMs,
    Number(options.bucketMs) || FLOW_WORKSPACE.minimumBucketMs,
  );
  if (![startTime, endTime].every(Number.isFinite) || endTime <= startTime) return [];

  const cells = new Map();
  for (const rawTrade of trades ?? []) {
    const trade = normalizeFlowTrade(rawTrade);
    const executionTime = Number(trade?.executionTime ?? trade?.time);
    if (!trade || executionTime < startTime || executionTime > endTime) continue;
    const timeIndex = Math.floor((executionTime - startTime) / bucketMs);
    const priceIndex = Math.round(trade.price / priceStep);
    const key = `${timeIndex}:${priceIndex}`;
    const cell = cells.get(key) ?? {
      timeIndex,
      priceIndex,
      time: startTime + timeIndex * bucketMs,
      price: Number((priceIndex * priceStep).toPrecision(15)),
      buyQuote: 0,
      sellQuote: 0,
      quote: 0,
      count: 0,
    };
    cell[trade.side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    cell.quote += trade.quote;
    cell.count += 1;
    cells.set(key, cell);
  }

  const columns = new Map();
  for (const cell of cells.values()) {
    const column = columns.get(cell.timeIndex) ?? {
      timeIndex: cell.timeIndex,
      time: cell.time,
      quote: 0,
      count: 0,
      cells: [],
    };
    column.quote += cell.quote;
    column.count += cell.count;
    column.cells.push(cell);
    columns.set(cell.timeIndex, column);
  }

  return [...columns.values()]
    .sort((left, right) => left.timeIndex - right.timeIndex)
    .map((column) => ({
      ...column,
      cells: column.cells.sort((left, right) => right.price - left.price),
    }));
}

export function aggregateFootprintCellsByStep(cells, priceStep) {
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const buckets = new Map();
  for (const source of cells ?? []) {
    const price = Number(source?.price);
    if (!Number.isFinite(price)) continue;
    const bucketIndex = Math.round(price / step);
    const bucketPrice = Number((bucketIndex * step).toPrecision(15));
    const key = String(bucketIndex);
    const bucket = buckets.get(key) ?? {
      price: bucketPrice,
      buyQuote: 0,
      sellQuote: 0,
      quote: 0,
      count: 0,
    };
    bucket.buyQuote += Math.max(0, Number(source.buyQuote) || 0);
    bucket.sellQuote += Math.max(0, Number(source.sellQuote) || 0);
    bucket.quote += Math.max(0, Number(source.quote) || 0);
    bucket.count += Math.max(0, Number(source.count) || 0);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((left, right) => right.price - left.price);
}

export function footprintPocCluster(clusters, referencePrice = null) {
  let best = null;
  const reference = Number(referencePrice);
  for (const cluster of clusters ?? []) {
    const quote = Math.max(0, Number(cluster?.quote) || 0);
    if (quote <= 0) continue;
    if (!best || quote > Number(best.quote)) {
      best = cluster;
      continue;
    }
    if (quote !== Number(best.quote) || !Number.isFinite(reference)) continue;
    const distance = Math.abs(Number(cluster?.row?.price ?? cluster?.price) - reference);
    const bestDistance = Math.abs(Number(best?.row?.price ?? best?.price) - reference);
    if (distance < bestDistance) best = cluster;
  }
  return best;
}

function cloneFootprintInterval(interval) {
  return Object.freeze({
    ...interval,
    cells: Object.freeze((interval?.cells ?? []).map((cell) => Object.freeze({ ...cell }))),
  });
}

function stableFootprintIntervals(state, intervals) {
  if (!(state.sealedIntervals instanceof Map)) state.sealedIntervals = new Map();
  const result = intervals.map((interval) => {
    if (interval.partial) return interval;
    const key = `${interval.timeframe}:${interval.startTime}`;
    let sealed = state.sealedIntervals.get(key);
    if (!sealed) {
      sealed = cloneFootprintInterval(interval);
      state.sealedIntervals.set(key, sealed);
    }
    return sealed;
  });
  while (state.sealedIntervals.size > FOOTPRINT_MAX_SEALED_INTERVALS) {
    state.sealedIntervals.delete(state.sealedIntervals.keys().next().value);
  }
  return result;
}

export function footprintTone(cell) {
  const buy = Math.max(0, Number(cell?.buyQuote) || 0);
  const sell = Math.max(0, Number(cell?.sellQuote) || 0);
  const total = Math.max(1, buy + sell);
  return clamp((buy - sell) / total, -1, 1);
}

export function footprintCellIntensity(value, maximum) {
  const amount = Math.max(0, Number(value) || 0);
  const peak = Math.max(1, Number(maximum) || 1);
  return clamp(Math.sqrt(amount / peak), 0, 1);
}

export function visibleFlowCount(trades, startTime, endTime) {
  let count = 0;
  for (const trade of trades ?? []) {
    const time = Number(trade?.executionTime ?? trade?.time);
    if (Number.isFinite(time) && time >= startTime && time <= endTime) count += 1;
  }
  return count;
}

export function normalizeFootprintTimeframe(value) {
  const text = String(value ?? "");
  if (FOOTPRINT_TIMEFRAMES.includes(text)) return text;
  const legacy = Number(value);
  if (legacy === 60_000) return "1m";
  if (legacy === 300_000) return "5m";
  return "1m";
}

export function footprintIntervalStart(time, timeframeValue = "1m") {
  const at = Number(time) || Date.now();
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  if (timeframe === "1M") {
    const date = new Date(at);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  if (timeframe === "1w") {
    const week = FOOTPRINT_INTERVAL_MS[timeframe];
    const mondayEpoch = 4 * 86_400_000;
    return Math.floor((at - mondayEpoch) / week) * week + mondayEpoch;
  }
  const duration = FOOTPRINT_INTERVAL_MS[timeframe] || 60_000;
  return Math.floor(at / duration) * duration;
}

export function shiftFootprintInterval(startTime, timeframeValue, amount) {
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  const shift = Math.trunc(Number(amount) || 0);
  if (timeframe === "1M") {
    const date = new Date(Number(startTime));
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + shift, 1);
  }
  return Number(startTime) + (FOOTPRINT_INTERVAL_MS[timeframe] || 60_000) * shift;
}

export function footprintIntervalEnd(startTime, timeframeValue = "1m") {
  return shiftFootprintInterval(startTime, timeframeValue, 1);
}

export function createFootprintAccumulator() {
  return {
    seconds: new Map(),
    firstObservedAt: null,
    lastObservedAt: null,
    retainedFromAt: null,
    cellCount: 0,
    tradeKeyCount: 0,
  };
}

function footprintSecondBucket(accumulator, startTime) {
  const bucket = accumulator.seconds.get(startTime) ?? {
    startTime,
    endTime: startTime + FOOTPRINT_BASE_BUCKET_MS,
    count: 0,
    quote: 0,
    firstTradeTime: Infinity,
    lastTradeTime: -Infinity,
    openPrice: null,
    closePrice: null,
    highPrice: null,
    lowPrice: null,
    cells: new Map(),
    tradeKeys: new Set(),
  };
  accumulator.seconds.set(startTime, bucket);
  return bucket;
}

function removeFootprintBucket(accumulator, startTime) {
  const bucket = accumulator.seconds.get(startTime);
  if (!bucket) return false;
  accumulator.cellCount = Math.max(0, Number(accumulator.cellCount) - bucket.cells.size);
  accumulator.tradeKeyCount = Math.max(
    0,
    Number(accumulator.tradeKeyCount) - Number(bucket.tradeKeys?.size || 0),
  );
  accumulator.seconds.delete(startTime);
  return true;
}

function pruneFootprintAccumulator(accumulator, referenceTime = Date.now()) {
  const cutoff = Number(referenceTime) - FOOTPRINT_RETAIN_MS;
  for (const startTime of [...accumulator.seconds.keys()]) {
    if (startTime < cutoff || startTime > Number(referenceTime) + FOOTPRINT_BASE_BUCKET_MS) {
      removeFootprintBucket(accumulator, startTime);
    }
  }
  while (
    Number(accumulator.cellCount) > FOOTPRINT_MAX_RETAINED_CELLS
    && accumulator.seconds.size
  ) {
    const oldest = accumulator.seconds.keys().next().value;
    if (!removeFootprintBucket(accumulator, oldest)) break;
  }
  if (Number(accumulator.tradeKeyCount) > FOOTPRINT_MAX_RETAINED_TRADE_KEYS) {
    for (const bucket of accumulator.seconds.values()) {
      if (Number(accumulator.tradeKeyCount) <= FOOTPRINT_MAX_RETAINED_TRADE_KEYS) break;
      const size = Number(bucket.tradeKeys?.size || 0);
      bucket.tradeKeys?.clear?.();
      accumulator.tradeKeyCount = Math.max(0, Number(accumulator.tradeKeyCount) - size);
    }
  }
  const retained = accumulator.seconds.keys().next().value;
  accumulator.retainedFromAt = Number.isFinite(Number(retained)) ? Number(retained) : null;
}

export function ingestFootprintTrades(accumulator, incoming, { replace = false } = {}) {
  const target = accumulator?.seconds instanceof Map ? accumulator : createFootprintAccumulator();
  if (replace) {
    target.seconds.clear();
    target.firstObservedAt = null;
    target.lastObservedAt = null;
    target.retainedFromAt = null;
    target.cellCount = 0;
    target.tradeKeyCount = 0;
  }
  let latestTime = 0;
  for (const rawTrade of incoming ?? []) {
    const trade = normalizeFlowTrade(rawTrade);
    if (!trade) continue;
    const executionTime = Number(trade.executionTime ?? trade.time);
    latestTime = Math.max(latestTime, executionTime);
    target.firstObservedAt = target.firstObservedAt === null
      ? executionTime
      : Math.min(target.firstObservedAt, executionTime);
    target.lastObservedAt = target.lastObservedAt === null
      ? executionTime
      : Math.max(target.lastObservedAt, executionTime);
    const startTime = Math.floor(executionTime / FOOTPRINT_BASE_BUCKET_MS) * FOOTPRINT_BASE_BUCKET_MS;
    const bucket = footprintSecondBucket(target, startTime);
    const tradeKey = flowTradeKey(trade);
    if (bucket.tradeKeys.has(tradeKey)) continue;
    bucket.tradeKeys.add(tradeKey);
    target.tradeKeyCount = Math.max(0, Number(target.tradeKeyCount) || 0) + 1;
    const priceKey = Number(trade.price).toPrecision(15);
    const existingCell = bucket.cells.get(priceKey);
    const cell = existingCell ?? {
      price: trade.price,
      buyQuote: 0,
      sellQuote: 0,
      quote: 0,
      count: 0,
    };
    if (!existingCell) target.cellCount = Math.max(0, Number(target.cellCount) || 0) + 1;
    cell[trade.side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    cell.quote += trade.quote;
    cell.count += 1;
    bucket.cells.set(priceKey, cell);
    bucket.quote += trade.quote;
    bucket.count += 1;
    if (executionTime < bucket.firstTradeTime) {
      bucket.firstTradeTime = executionTime;
      bucket.openPrice = trade.price;
    }
    if (executionTime >= bucket.lastTradeTime) {
      bucket.lastTradeTime = executionTime;
      bucket.closePrice = trade.price;
    }
    bucket.highPrice = bucket.highPrice === null ? trade.price : Math.max(bucket.highPrice, trade.price);
    bucket.lowPrice = bucket.lowPrice === null ? trade.price : Math.min(bucket.lowPrice, trade.price);
  }
  pruneFootprintAccumulator(target, latestTime || Date.now());
  return target;
}

function footprintSnapshotAt(accumulator, timeframeValue, startTime, now) {
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  const endTime = footprintIntervalEnd(startTime, timeframe);
  const cells = new Map();
  let count = 0;
  let quote = 0;
  let firstTradeTime = Infinity;
  let lastTradeTime = -Infinity;
  let openPrice = null;
  let closePrice = null;
  let highPrice = null;
  let lowPrice = null;
  for (const bucket of accumulator?.seconds?.values?.() ?? []) {
    if (bucket.startTime < startTime || bucket.startTime >= endTime) continue;
    count += bucket.count;
    quote += bucket.quote;
    if (Number.isFinite(bucket.firstTradeTime) && bucket.firstTradeTime < firstTradeTime) {
      firstTradeTime = bucket.firstTradeTime;
      openPrice = bucket.openPrice;
    }
    if (Number.isFinite(bucket.lastTradeTime) && bucket.lastTradeTime >= lastTradeTime) {
      lastTradeTime = bucket.lastTradeTime;
      closePrice = bucket.closePrice;
    }
    if (Number.isFinite(bucket.highPrice)) highPrice = highPrice === null ? bucket.highPrice : Math.max(highPrice, bucket.highPrice);
    if (Number.isFinite(bucket.lowPrice)) lowPrice = lowPrice === null ? bucket.lowPrice : Math.min(lowPrice, bucket.lowPrice);
    for (const source of bucket.cells.values()) {
      const priceKey = Number(source.price).toPrecision(15);
      const cell = cells.get(priceKey) ?? { price: source.price, buyQuote: 0, sellQuote: 0, quote: 0, count: 0 };
      cell.buyQuote += source.buyQuote;
      cell.sellQuote += source.sellQuote;
      cell.quote += source.quote;
      cell.count += source.count;
      cells.set(priceKey, cell);
    }
  }
  const partial = Number(now) < endTime;
  if (partial && count === 0) {
    let previousClose = null;
    let previousTradeTime = -Infinity;
    for (const bucket of accumulator?.seconds?.values?.() ?? []) {
      if (bucket.startTime >= startTime) continue;
      const candidateTime = Number(bucket.lastTradeTime);
      const candidateClose = Number(bucket.closePrice);
      if (Number.isFinite(candidateClose) && candidateTime > previousTradeTime) {
        previousTradeTime = candidateTime;
        previousClose = candidateClose;
      }
    }
    if (Number.isFinite(previousClose)) {
      openPrice = previousClose;
      closePrice = previousClose;
      highPrice = previousClose;
      lowPrice = previousClose;
    }
  }
  const firstObservedAt = Number(accumulator?.firstObservedAt);
  const retainedFromAt = Number(accumulator?.retainedFromAt);
  return {
    timeframe,
    startTime,
    endTime,
    partial,
    sessionPartial: !Number.isFinite(firstObservedAt)
      || firstObservedAt > startTime + FOOTPRINT_BASE_BUCKET_MS
      || (Number.isFinite(retainedFromAt) && retainedFromAt > startTime),
    count,
    quote,
    openPrice,
    closePrice,
    highPrice,
    lowPrice,
    cells: [...cells.values()].sort((left, right) => right.price - left.price),
  };
}

export function footprintIntervalSnapshot(accumulator, timeframeValue = "1m", now = Date.now()) {
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  const startTime = footprintIntervalStart(now, timeframe);
  return footprintSnapshotAt(accumulator, timeframe, startTime, now);
}

export function footprintIntervalHistory(
  accumulator,
  timeframeValue = "1m",
  now = Date.now(),
  limit = FOOTPRINT_MAX_VISIBLE_COLUMNS,
  offset = 0,
) {
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  const maximum = Math.max(1, Math.min(FOOTPRINT_MAX_VISIBLE_COLUMNS, Math.floor(Number(limit) || 1)));
  const starts = [...(accumulator?.seconds?.keys?.() ?? [])].map(Number).filter(Number.isFinite);
  const currentStart = footprintIntervalStart(now, timeframe);
  const earliestStart = starts.length
    ? footprintIntervalStart(Math.min(...starts), timeframe)
    : currentStart;
  const latestOffset = footprintHistoryOffsetLimit(accumulator, timeframe, now);
  const safeOffset = Math.min(latestOffset, Math.max(0, Math.floor(Number(offset) || 0)));
  let cursor = shiftFootprintInterval(currentStart, timeframe, -safeOffset);
  const reversed = [];
  while (reversed.length < maximum && cursor >= earliestStart) {
    reversed.push(footprintSnapshotAt(accumulator, timeframe, cursor, now));
    cursor = shiftFootprintInterval(cursor, timeframe, -1);
  }
  return reversed.reverse();
}

export function footprintHistoryOffsetLimit(accumulator, timeframeValue = "1m", now = Date.now()) {
  const starts = [...(accumulator?.seconds?.keys?.() ?? [])].map(Number).filter(Number.isFinite);
  if (!starts.length) return 0;
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  const earliest = footprintIntervalStart(Math.min(...starts), timeframe);
  let cursor = footprintIntervalStart(now, timeframe);
  let count = 0;
  while (cursor > earliest && count < 10_000) {
    cursor = shiftFootprintInterval(cursor, timeframe, -1);
    count += 1;
  }
  return count;
}

const footprintBySymbol = new Map();
const statusBySymbol = new Map();
const cardStates = new WeakMap();
const dirtyCards = new Set();
let drawFrame = 0;
let drawAllRequested = true;
let flowDocumentHidden = typeof document !== "undefined" ? document.hidden : false;
const FLOW_DRAW_BUDGET_MS = 8;
const FLOW_DRAW_MAX_CARDS = 2;

function cardSymbol(card) {
  const text = String(
    card?.querySelector?.("[data-book-ticker]")?.textContent
      ?? card?.querySelector?.("h2")?.textContent
      ?? "",
  );
  const pair = text.split("·")[0].replace("/", "").trim().toUpperCase();
  const market = card?.dataset?.market === "spot" ? "spot" : "futures";
  const exchange = String(card?.dataset?.exchange || "binance").trim().toLowerCase();
  return normalizeOrderBookMarketKey(exchange === "binance" ? `${market}:${pair}` : `${exchange}:${market}:${pair}`, market);
}

function parseNumber(text) {
  const normalized = String(text ?? "")
    .replace(/[\s\u00a0\u202f']/g, "")
    .replace(",", ".")
    .replace(/[^0-9.+-]/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function formatUsd(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(amount >= 100_000 ? 0 : 1)}K`;
  return amount >= 100 ? String(Math.round(amount)) : amount.toFixed(amount >= 10 ? 0 : 1);
}

function formatQuoteVolume(value) {
  return `$${formatUsd(value)}`;
}


function formatIntervalClock(time) {
  const date = new Date(Number(time));
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function readThemeColor(name, fallback) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function mixHex(left, right, amount) {
  const ratio = clamp(Number(amount) || 0, 0, 1);
  const parse = (value) => [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
  const a = parse(left);
  const b = parse(right);
  return `#${a.map((value, index) => (
    Math.round(value + (b[index] - value) * ratio)
      .toString(16)
      .padStart(2, "0")
  )).join("")}`;
}

function rgbaHex(value, alpha = 1) {
  return `rgba(${Number.parseInt(value.slice(1, 3), 16)}, ${
    Number.parseInt(value.slice(3, 5), 16)
  }, ${Number.parseInt(value.slice(5, 7), 16)}, ${clamp(alpha, 0, 1)})`;
}

function footprintTimeframeLabel(value) {
  return normalizeFootprintTimeframe(value)
    .replace("1M", "1мес")
    .replace("s", "с")
    .replace("m", "м")
    .replace("h", "ч")
    .replace("d", "д")
    .replace("w", "н");
}

function readFootprintFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOOTPRINT_FAVORITES_KEY) || "null");
    const values = Array.isArray(parsed) ? parsed : FOOTPRINT_DEFAULT_FAVORITES;
    const normalized = [...new Set(values.map(normalizeFootprintTimeframe))]
      .filter((item) => FOOTPRINT_TIMEFRAMES.includes(item))
      .sort((left, right) => FOOTPRINT_TIMEFRAMES.indexOf(left) - FOOTPRINT_TIMEFRAMES.indexOf(right));
    return normalized.length ? normalized.slice(0, 6) : [...FOOTPRINT_DEFAULT_FAVORITES];
  } catch {
    return [...FOOTPRINT_DEFAULT_FAVORITES];
  }
}

function saveFootprintFavorites(values) {
  localStorage.setItem(FOOTPRINT_FAVORITES_KEY, JSON.stringify(values));
}

function renderFootprintTimeframeControls(pane, state) {
  const favorites = readFootprintFavorites();
  const root = pane.querySelector("[data-footprint-favorites]");
  const menu = pane.querySelector("[data-footprint-menu]");
  if (root) {
    root.innerHTML = favorites.map((timeframe) => (
      `<button type="button" data-footprint-select="${timeframe}" class="${timeframe === state.timeframeMs ? "is-active" : ""}" aria-pressed="${timeframe === state.timeframeMs}">${footprintTimeframeLabel(timeframe)}</button>`
    )).join("");
  }
  if (menu) {
    menu.innerHTML = FOOTPRINT_TIMEFRAMES.map((timeframe) => {
      const favorite = favorites.includes(timeframe);
      return `<div><button type="button" data-footprint-select="${timeframe}" class="${timeframe === state.timeframeMs ? "is-active" : ""}">${footprintTimeframeLabel(timeframe)}</button><button type="button" data-footprint-favorite="${timeframe}" aria-label="${favorite ? "Убрать из избранного" : "Добавить в избранное"}">${favorite ? "★" : "☆"}</button></div>`;
    }).join("");
  }
}

function footprintTheme() {
  const panel = readThemeColor("--panel", "#181b20");
  const panel2 = readThemeColor("--panel-2", "#22262c");
  const green = readThemeColor("--green", "#42d9b1");
  const red = readThemeColor("--red", "#ff7181");
  return {
    panel,
    panel2,
    text: readThemeColor("--text", "#edf1f4"),
    muted: readThemeColor("--muted", "#9ba4ad"),
    violet: readThemeColor("--violet", "#aa86ff"),
    green: mixHex(panel2, green, .55),
    red: mixHex(panel2, red, .55),
    bullFill: readThemeColor("--chart-bull-fill", green),
    bullStroke: readThemeColor("--chart-bull-stroke", green),
    bearFill: readThemeColor("--chart-bear-fill", panel2),
    bearStroke: readThemeColor("--chart-bear-stroke", red),
  };
}

function flowRecoveryFrozen(symbol) {
  const status = statusBySymbol.get(symbol);
  if (!status) return false;
  const state = String(status.state ?? "").toLowerCase();
  const text = String(status.text ?? "").toUpperCase();
  const tapeStateKnown = text.includes("RAW") || text.includes("AGG") || text.includes("TAPE");
  const tapeLive = text.includes("RAW SHADOW") || text.includes("AGG LIVE");
  return state !== "online" || (tapeStateKnown && !tapeLive);
}

function visibleRows(card, pane) {
  const paneRect = pane.getBoundingClientRect();
  return [...card.querySelectorAll(".orderbook-rows .book-ladder-row")]
    .map((row, index) => {
      const price = parseNumber(row.querySelector("strong")?.textContent);
      const rect = row.getBoundingClientRect();
      return {
        index,
        price,
        y: rect.top + rect.height / 2 - paneRect.top - 23,
        height: rect.height,
        visible: rect.bottom >= paneRect.top && rect.top <= paneRect.bottom,
      };
    })
    .filter((row) => row.visible && Number.isFinite(row.price));
}

export function stableFootprintPriceStep(rows) {
  const prices = [...new Set((rows ?? [])
    .map((row) => Number(row?.price))
    .filter(Number.isFinite))]
    .sort((left, right) => left - right);
  const frequencies = new Map();
  for (let index = 1; index < prices.length; index += 1) {
    const gap = prices[index] - prices[index - 1];
    if (!(gap > Number.EPSILON)) continue;
    const normalized = Number(gap.toPrecision(12));
    const key = String(normalized);
    const entry = frequencies.get(key) ?? { value: normalized, count: 0 };
    entry.count += 1;
    frequencies.set(key, entry);
  }
  let best = null;
  for (const entry of frequencies.values()) {
    if (
      !best
      || entry.count > best.count
      || (entry.count === best.count && entry.value < best.value)
    ) best = entry;
  }
  return best?.value ?? .01;
}

function rowStep(rows) {
  return stableFootprintPriceStep(rows);
}

export function stableFootprintProjectionRows(rows) {
  const normalized = (rows ?? [])
    .map((row) => ({
      ...row,
      index: Number(row?.index),
      price: Number(row?.price),
      y: Number(row?.y),
      height: Math.max(1, Number(row?.height) || 1),
    }))
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.y))
    .sort((left, right) => left.price - right.price);
  if (normalized.length < 3) return normalized;
  const step = stableFootprintPriceStep(normalized);
  if (!Number.isFinite(step) || step <= Number.EPSILON) return normalized;

  let best = [];
  for (const anchor of normalized) {
    const aligned = normalized.filter((row) => {
      const units = (row.price - anchor.price) / step;
      return Math.abs(units - Math.round(units)) <= .08;
    });
    if (aligned.length > best.length) best = aligned;
  }
  return best.length >= 2 ? best : normalized;
}

export function projectFootprintPriceRow(rows, price, clampToViewport = false) {
  const target = Number(price);
  const ordered = stableFootprintProjectionRows(rows);
  if (!ordered.length || !Number.isFinite(target)) return null;
  if (ordered.length === 1) {
    if (!clampToViewport && Math.abs(target - ordered[0].price) > Number.EPSILON) return null;
    return { ...ordered[0], price: target, clipped: target !== ordered[0].price };
  }

  const step = rowStep(ordered);
  if (!Number.isFinite(step)) return null;
  const low = ordered[0];
  const high = ordered.at(-1);
  const tolerance = step * .55 + Number.EPSILON;
  if (target < low.price - tolerance) {
    return clampToViewport ? { ...low, price: target, clipped: true } : null;
  }
  if (target > high.price + tolerance) {
    return clampToViewport ? { ...high, price: target, clipped: true } : null;
  }

  const interpolate = (left, right) => {
    const span = right.price - left.price;
    const ratio = Math.abs(span) <= Number.EPSILON ? 0 : (target - left.price) / span;
    return {
      price: target,
      y: left.y + (right.y - left.y) * ratio,
      height: left.height + (right.height - left.height) * ratio,
      clipped: false,
    };
  };
  if (target <= low.price) return interpolate(low, ordered[1]);
  if (target >= high.price) return interpolate(ordered.at(-2), high);
  for (let index = 1; index < ordered.length; index += 1) {
    if (target <= ordered[index].price) return interpolate(ordered[index - 1], ordered[index]);
  }
  return null;
}

function nearestRow(rows, price, clampToViewport = false) {
  return projectFootprintPriceRow(rows, price, clampToViewport);
}

function injectStyles() {
  if (document.getElementById("inpuls-flow-workspace-v1")) return;
  const style = document.createElement("style");
  style.id = "inpuls-flow-workspace-v1";
  style.textContent = `
    .orderbook-card .orderbook-stage.inpuls-flow-workspace {
      display: grid !important;
      grid-template-columns:
        minmax(${FLOW_WORKSPACE.minimumPanePx}px, var(--flow-cluster-width, 20%))
        7px
        minmax(${FLOW_WORKSPACE.minimumTapePx}px, 1fr)
        7px
        minmax(${FLOW_WORKSPACE.minimumBookPx}px, var(--flow-book-width, 22%)) !important;
      grid-template-areas: "clusters split-a tape split-b book" !important;
      min-width: 0;
    }
    .orderbook-card.is-clusters-hidden .orderbook-stage.inpuls-flow-workspace {
      grid-template-columns:
        0
        0
        minmax(${FLOW_WORKSPACE.minimumTapePx}px, 1fr)
        7px
        minmax(${FLOW_WORKSPACE.minimumBookPx}px, var(--flow-book-width, 22%)) !important;
    }
    .orderbook-card.is-tape-hidden .orderbook-stage.inpuls-flow-workspace {
      grid-template-columns:
        minmax(${FLOW_WORKSPACE.minimumPanePx}px, var(--flow-cluster-width, 20%))
        7px
        0
        0
        minmax(${FLOW_WORKSPACE.minimumBookPx}px, 1fr) !important;
    }
    .orderbook-card.is-clusters-hidden.is-tape-hidden .orderbook-stage.inpuls-flow-workspace {
      grid-template-columns: 0 0 0 0 minmax(0, 1fr) !important;
    }
    .orderbook-card .inpuls-footprint-pane {
      grid-area: clusters;
      position: relative;
      min-width: 0;
      overflow: hidden;
      border-right: 1px solid color-mix(in srgb, var(--violet) 22%, var(--line));
      background: color-mix(in srgb, var(--panel) 78%, var(--panel-2));
      cursor: grab;
      touch-action: none;
    }
    .orderbook-card .inpuls-footprint-pane.is-panning {
      cursor: grabbing;
    }
    .orderbook-card .inpuls-footprint-toolbar {
      position: absolute;
      z-index: 8;
      inset: 0 0 auto 0;
      height: 23px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 5px;
      border-bottom: 1px solid var(--line-soft);
      background: color-mix(in srgb, var(--panel) 94%, var(--chart-bg));
      color: var(--muted);
      font: 800 8px/1 Inter, system-ui, sans-serif;
    }
    .orderbook-card .inpuls-footprint-toolbar button {
      min-width: 28px;
      height: 18px;
      padding: 0 5px;
      border: 1px solid var(--line-soft);
      border-radius: 4px;
      background: var(--panel-2);
      color: var(--muted);
      font: inherit;
      cursor: pointer;
    }
    .orderbook-card .inpuls-footprint-toolbar button.is-active {
      color: #5de1b5;
      border-color: rgba(93, 225, 181, .45);
      background: rgba(45, 179, 132, .1);
    }
    .orderbook-card .inpuls-footprint-toolbar strong {
      margin-left: auto;
      color: var(--muted);
      white-space: nowrap;
    }
    .orderbook-card .inpuls-footprint-favorites {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
      overflow: hidden;
    }
    .orderbook-card .inpuls-footprint-more { flex: 0 0 auto; }
    .orderbook-card .inpuls-footprint-menu {
      position: absolute;
      z-index: 20;
      top: 22px;
      left: 4px;
      display: grid;
      grid-template-columns: repeat(2, minmax(70px, 1fr));
      gap: 2px;
      width: min(210px, calc(100% - 8px));
      max-height: 210px;
      overflow: auto;
      padding: 4px;
      border: 1px solid var(--line);
      border-radius: 5px;
      background: color-mix(in srgb, var(--panel) 98%, #000);
      box-shadow: 0 8px 22px rgba(0,0,0,.48);
    }
    .orderbook-card .inpuls-footprint-menu[hidden] { display: none !important; }
    .orderbook-card .inpuls-footprint-menu > div {
      display: grid;
      grid-template-columns: 1fr 24px;
      gap: 2px;
    }
    .orderbook-card .inpuls-footprint-menu button { min-width: 0; }
    .orderbook-card .inpuls-footprint-canvas {
      position: absolute;
      inset: 23px 0 0;
      width: 100%;
      height: calc(100% - 23px);
      pointer-events: none;
    }
    .orderbook-card .orderbook-ladder { grid-area: book !important; }
    .orderbook-card .orderbook-tape { grid-area: tape !important; }
    .orderbook-card .inpuls-flow-splitter {
      position: relative;
      z-index: 80;
      width: 7px;
      min-width: 7px;
      cursor: ew-resize;
      touch-action: none;
      border: 0;
      padding: 0;
      background: color-mix(in srgb, var(--violet) 8%, var(--panel));
    }
    .orderbook-card .inpuls-flow-splitter::before {
      content: "";
      position: absolute;
      inset: 0 -4px;
    }
    .orderbook-card .inpuls-flow-splitter[data-flow-split="clusters"] { grid-area: split-a; }
    .orderbook-card .inpuls-flow-splitter[data-flow-split="tape"] { grid-area: split-b; }
    .orderbook-card .book-splitter { display: none !important; }
    .orderbook-card .orderbook-tape,
    .orderbook-card .trade-flow {
      background: var(--panel) !important;
    }
    .orderbook-card [data-book-clusters] { display: none !important; }
    .orderbook-card.is-clusters-hidden .inpuls-footprint-pane,
    .orderbook-card.is-clusters-hidden .inpuls-flow-splitter[data-flow-split="clusters"],
    .orderbook-card.is-tape-hidden .orderbook-tape,
    .orderbook-card.is-tape-hidden .inpuls-flow-splitter[data-flow-split="tape"] {
      display: none !important;
    }
    .orderbook-card .book-ladder-row .book-size::before {
      left: 0 !important;
      right: auto !important;
      transform-origin: left center !important;
    }
  `;
  document.head.append(style);
}

function runDrawFrame() {
  drawFrame = 0;
  if (flowDocumentHidden) return;
  if (drawAllRequested) {
    document.querySelectorAll(".orderbook-card").forEach((card) => dirtyCards.add(card));
    drawAllRequested = false;
  }

  const drawStartedAt = performance.now();
  let cardCount = 0;
  let disconnected = 0;
  for (const card of dirtyCards) {
    dirtyCards.delete(card);
    if (!card?.isConnected) {
      disconnected += 1;
      continue;
    }
    const state = ensureCard(card);
    if (state) {
      renderCard(card, state);
      cardCount += 1;
    }
    if (
      cardCount >= FLOW_DRAW_MAX_CARDS
      || performance.now() - drawStartedAt >= FLOW_DRAW_BUDGET_MS
    ) break;
  }

  if (observability.enabled) {
    observability.record("footprint.draw-all", performance.now() - drawStartedAt, {
      cardCount,
      remaining: dirtyCards.size,
      yielded: dirtyCards.size > 0,
      disconnected,
    });
    observability.record("footprint.cards-per-draw", cardCount);
    if (dirtyCards.size) observability.increment("footprint.scheduler-yield");
  }
  if (dirtyCards.size) drawFrame = requestAnimationFrame(runDrawFrame);
}

function requestDraw(card = null) {
  if (card?.isConnected) dirtyCards.add(card);
  else drawAllRequested = true;
  if (flowDocumentHidden || drawFrame) return;
  drawFrame = requestAnimationFrame(runDrawFrame);
}

function bindSplitter(card, splitter, side) {
  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const stage = card.querySelector(".orderbook-stage");
    if (!stage) return;
    const startX = event.clientX;
    const stageRect = stage.getBoundingClientRect();
    const clusterWidth = card.querySelector(".inpuls-footprint-pane")?.getBoundingClientRect().width
      || stageRect.width * .24;
    const bookWidth = card.querySelector(".orderbook-ladder")?.getBoundingClientRect().width
      || stageRect.width * .22;

    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === "clusters") {
        stage.style.setProperty(
          "--flow-cluster-width",
          `${clamp(clusterWidth + delta, FLOW_WORKSPACE.minimumPanePx, stageRect.width * .48)}px`,
        );
      } else {
        stage.style.setProperty(
          "--flow-book-width",
          `${clamp(bookWidth - delta, FLOW_WORKSPACE.minimumBookPx, stageRect.width * .48)}px`,
        );
      }
      requestDraw(card);
    };
    const stop = () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", stop, true);
      document.removeEventListener("pointercancel", stop, true);
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", stop, true);
    document.addEventListener("pointercancel", stop, true);
  });
}

function ensureCard(card) {
  if (cardStates.has(card)) return cardStates.get(card);
  const stage = card.querySelector(".orderbook-stage");
  const tape = card.querySelector(".orderbook-tape");
  const book = card.querySelector(".orderbook-ladder");
  if (!stage || !tape || !book) return null;

  stage.classList.add("inpuls-flow-workspace");

  const pane = document.createElement("section");
  pane.className = "inpuls-footprint-pane";
  pane.setAttribute("aria-label", "Footprint-кластеры исполненных сделок");
  pane.innerHTML = `
    <div class="inpuls-footprint-toolbar">
      <span class="inpuls-footprint-favorites" data-footprint-favorites></span>
      <button type="button" class="inpuls-footprint-more" data-footprint-more aria-expanded="false" title="Все таймфреймы и избранное">⋯</button>
      <div class="inpuls-footprint-menu" data-footprint-menu hidden></div>
      <strong data-footprint-navigation>LIVE</strong>
    </div>
    <canvas class="inpuls-footprint-canvas"></canvas>
  `;

  const splitClusters = document.createElement("button");
  splitClusters.type = "button";
  splitClusters.className = "inpuls-flow-splitter";
  splitClusters.dataset.flowSplit = "clusters";
  splitClusters.title = "Изменить ширину кластеров";

  const splitTape = document.createElement("button");
  splitTape.type = "button";
  splitTape.className = "inpuls-flow-splitter";
  splitTape.dataset.flowSplit = "tape";
  splitTape.title = "Изменить ширину стакана";

  stage.prepend(pane);
  pane.after(splitClusters);
  book.after(splitTape);
  splitTape.after(tape);

  const canvas = pane.querySelector("canvas");
  const state = {
    pane,
    canvas,
    context: canvas.getContext("2d"),
    visible: true,
    timeframeMs: normalizeFootprintTimeframe(localStorage.getItem(FOOTPRINT_TIMEFRAME_KEY) || "1m"),
    columnWidthPx: FOOTPRINT_DEFAULT_COLUMN_PX,
    historyOffset: 0,
    hasFrame: false,
    lastSymbol: null,
    sealedIntervals: new Map(),
  };
  cardStates.set(card, state);

  const syncTimeframes = () => renderFootprintTimeframeControls(pane, state);
  pane.querySelector(".inpuls-footprint-toolbar").addEventListener("click", (event) => {
    const select = event.target.closest("[data-footprint-select]");
    const favorite = event.target.closest("[data-footprint-favorite]");
    const more = event.target.closest("[data-footprint-more]");
    const menu = pane.querySelector("[data-footprint-menu]");
    if (more) {
      const open = menu?.hidden !== false;
      if (menu) menu.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
      return;
    }
    if (favorite) {
      const timeframe = normalizeFootprintTimeframe(favorite.dataset.footprintFavorite);
      const favorites = readFootprintFavorites();
      const next = favorites.includes(timeframe)
        ? favorites.filter((item) => item !== timeframe)
        : [...favorites, timeframe]
            .sort((left, right) => FOOTPRINT_TIMEFRAMES.indexOf(left) - FOOTPRINT_TIMEFRAMES.indexOf(right))
            .slice(0, 6);
      saveFootprintFavorites(next.length ? next : [timeframe]);
      syncTimeframes();
      return;
    }
    if (select) {
      state.timeframeMs = normalizeFootprintTimeframe(select.dataset.footprintSelect);
      state.historyOffset = 0;
      localStorage.setItem(FOOTPRINT_TIMEFRAME_KEY, state.timeframeMs);
      if (menu) menu.hidden = true;
      pane.querySelector("[data-footprint-more]")?.setAttribute("aria-expanded", "false");
      syncTimeframes();
      state.hasFrame = false;
      requestDraw(card);
    }
  });
  syncTimeframes();  pane.addEventListener("wheel", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    state.columnWidthPx = footprintColumnWidthForWheel(
      state.columnWidthPx,
      event.deltaY,
    );
    if (event.deltaY < 0) state.historyOffset = 0;
    state.hasFrame = false;
    requestDraw(card);
  }, { passive: false });

  pane.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".inpuls-footprint-toolbar")) return;
    event.preventDefault();
    event.stopPropagation();
    pane.setPointerCapture(event.pointerId);
    pane.classList.add("is-panning");
    const startX = event.clientX;
    const startOffset = state.historyOffset;
    const symbol = cardSymbol(card);
    const accumulator = footprintBySymbol.get(symbol);
    const maximumOffset = footprintHistoryOffsetLimit(
      accumulator,
      state.timeframeMs,
      footprintExchangeNow(),
    );

    const move = (moveEvent) => {
      const columns = Math.round(
        (moveEvent.clientX - startX) / Math.max(1, state.columnWidthPx),
      );
      state.historyOffset = clamp(startOffset + columns, 0, maximumOffset);
      state.hasFrame = false;
      requestDraw(card);
    };
    const stop = () => {
      pane.classList.remove("is-panning");
      if (pane.hasPointerCapture(event.pointerId)) {
        pane.releasePointerCapture(event.pointerId);
      }
      pane.removeEventListener("pointermove", move);
      pane.removeEventListener("pointerup", stop);
      pane.removeEventListener("pointercancel", stop);
    };
    pane.addEventListener("pointermove", move);
    pane.addEventListener("pointerup", stop);
    pane.addEventListener("pointercancel", stop);
  });

  bindSplitter(card, splitClusters, "clusters");
  bindSplitter(card, splitTape, "tape");

  const bookRows = card.querySelector(".orderbook-rows");
  const observer = new MutationObserver(() => requestDraw(card));
  if (bookRows) {
    observer.observe(bookRows, {
      childList: true,
    });
  }
  state.observer = observer;
  return state;
}

function renderCard(card, state) {
  const renderStartedAt = observability.enabled ? performance.now() : 0;
  const symbol = cardSymbol(card);
  const skip = (reason, tags = null) => observability.skipRender("footprint", reason, {
    symbol: symbol || null,
    ...(tags ?? {}),
  });
  if (!symbol || !state.context) {
    skip(!symbol ? "missing-symbol" : "missing-context");
    return;
  }
  state.visible = !card.classList.contains("is-clusters-hidden");
  if (!state.visible) {
    skip("layer-hidden");
    return;
  }
  if (state.lastSymbol !== symbol) {
    state.lastSymbol = symbol;
    state.historyOffset = 0;
    state.hasFrame = false;
    state.sealedIntervals.clear();
  }
  const frozen = flowRecoveryFrozen(symbol);
  if (frozen && state.hasFrame) {
    skip("recovery-frozen");
    return;
  }
  const paneRect = state.pane.getBoundingClientRect();
  const width = Math.max(1, paneRect.width);
  const height = Math.max(1, paneRect.height - 23);
  if (width <= 2 || height <= 2) {
    skip("zero-size");
    return;
  }

  const rows = visibleRows(card, state.pane);
  if (!rows.length) {
    skip("missing-ladder-rows");
    return;
  }

  const accumulator = footprintBySymbol.get(symbol) ?? createFootprintAccumulator();
  const exchangeNow = footprintExchangeNow();
  state.historyOffset = Math.min(
    state.historyOffset,
    footprintHistoryOffsetLimit(accumulator, state.timeframeMs, exchangeNow),
  );
  const visibleColumnLimit = Math.max(
    1,
    Math.min(
      FOOTPRINT_MAX_VISIBLE_COLUMNS,
      Math.floor(width / Math.max(FOOTPRINT_MIN_COLUMN_PX, state.columnWidthPx)),
    ),
  );
  const intervals = stableFootprintIntervals(state, footprintIntervalHistory(
    accumulator,
    state.timeframeMs,
    exchangeNow,
    visibleColumnLimit,
    state.historyOffset,
  ));
  const displayPriceStep = rowStep(rows);
  const columns = intervals.map((interval) => {
    const clusters = aggregateFootprintCellsByStep(interval.cells, displayPriceStep)
      .map((source) => {
        const row = nearestRow(rows, source.price);
        return row ? {
          row,
          buyQuote: source.buyQuote,
          sellQuote: source.sellQuote,
          quote: source.quote,
          count: source.count,
          price: source.price,
        } : null;
      })
      .filter(Boolean);
    return {
      interval,
      clusters,
      poc: footprintPocCluster(clusters, interval.closePrice),
    };
  });

  const dpr = Math.max(1, Math.min(1.5, globalThis.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (state.canvas.width !== pixelWidth || state.canvas.height !== pixelHeight) {
    state.canvas.width = pixelWidth;
    state.canvas.height = pixelHeight;
  }
  state.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.context.clearRect(0, 0, width, height);

  const maximumCluster = Math.max(
    1,
    ...columns.flatMap(({ clusters }) => clusters.map((cluster) => cluster.quote)),
  );
  const columnWidth = Math.min(width, state.columnWidthPx);
  const columnsLeft = Math.max(0, width - columns.length * columnWidth);
  const theme = footprintTheme();
  const navigation = state.pane.querySelector("[data-footprint-navigation]");
  if (navigation) {
    const sessionPartial = intervals.some((interval) => interval.sessionPartial);
    navigation.textContent = state.historyOffset > 0
      ? `−${state.historyOffset}${sessionPartial ? " · P" : ""}`
      : `LIVE${sessionPartial ? " · PARTIAL" : ""}`;
    navigation.title = sessionPartial
      ? "Кластеры выровнены по биржевым свечам, но поток до открытия InPuls отсутствует"
      : "Кластеры полностью наблюдались в текущей сессии";
  }

  state.context.font = "800 7px Inter, system-ui, sans-serif";
  state.context.textBaseline = "middle";

  if (state.visible) {
    columns.forEach(({ interval, clusters, poc }, columnIndex) => {
      const columnLeft = columnsLeft + columnIndex * columnWidth;
      const labelX = columnLeft + columnWidth / 2;
      const candleBodyWidth = Math.max(3, Math.min(7, columnWidth * .14));
      const candleLeft = columnLeft + 2;
      const candleX = candleLeft + candleBodyWidth / 2;
      const dataLeft = candleLeft + candleBodyWidth + 2;
      const dataWidth = Math.max(1, columnLeft + columnWidth - dataLeft - 1);

      for (const cluster of clusters) {
        const totalQuote = Math.max(Number.EPSILON, cluster.quote);
        const sellShare = Math.max(0, cluster.sellQuote) / totalQuote;
        const buyShare = Math.max(0, cluster.buyQuote) / totalQuote;
        const dominantSide = buyShare > sellShare ? "B" : sellShare > buyShare ? "S" : "·";
        const clusterStrength = footprintCellIntensity(cluster.quote, maximumCluster);
        const cellHeight = Math.max(3, Math.min(cluster.row.height * .92, 14));
        const cellTop = cluster.row.y - cellHeight / 2;
        const cellLeft = dataLeft;
        const cellWidth = dataWidth;
        const sellWidth = cellWidth * sellShare;
        const buyWidth = Math.max(0, cellWidth - sellWidth);
        const alpha = .58 + clusterStrength * .4;
        const isPoc = cluster === poc;

        state.context.fillStyle = theme.panel2;
        state.context.fillRect(cellLeft, cellTop, cellWidth, cellHeight);
        if (sellWidth > 0) {
          state.context.fillStyle = rgbaHex(theme.red, alpha);
          state.context.fillRect(cellLeft, cellTop, sellWidth, cellHeight);
        }
        if (buyWidth > 0) {
          state.context.fillStyle = rgbaHex(theme.green, alpha);
          state.context.fillRect(cellLeft + sellWidth, cellTop, buyWidth, cellHeight);
        }

        if (isPoc) {
          state.context.fillStyle = rgbaHex(theme.violet, .2);
          state.context.fillRect(cellLeft, cellTop, cellWidth, cellHeight);
          state.context.strokeStyle = rgbaHex(theme.violet, .98);
          state.context.lineWidth = 1.7;
          state.context.strokeRect(cellLeft + .5, cellTop + .5, Math.max(0, cellWidth - 1), Math.max(0, cellHeight - 1));
          state.context.fillStyle = rgbaHex(theme.violet, .98);
          state.context.fillRect(cellLeft, cellTop, Math.min(2.2, cellWidth), cellHeight);
        } else {
          state.context.strokeStyle = dominantSide === "B"
            ? rgbaHex(theme.green, .98)
            : dominantSide === "S"
              ? rgbaHex(theme.red, .98)
              : rgbaHex(theme.muted, .52);
          state.context.lineWidth = 1.15;
          state.context.strokeRect(cellLeft, cellTop, cellWidth, cellHeight);
        }

        const volumeText = formatQuoteVolume(cluster.quote);
        state.context.fillStyle = theme.text;
        state.context.font = "850 8px Inter, system-ui, sans-serif";
        state.context.textAlign = "center";
        state.context.fillText(
          volumeText,
          dataLeft + dataWidth / 2,
          cluster.row.y,
          Math.max(1, dataWidth - 4),
        );
        state.context.font = "800 7px Inter, system-ui, sans-serif";
      }

      const highRow = nearestRow(rows, interval.highPrice, true);
      const lowRow = nearestRow(rows, interval.lowPrice, true);
      const openRow = nearestRow(rows, interval.openPrice, true);
      const closeRow = nearestRow(rows, interval.closePrice, true);
      if (highRow && lowRow && openRow && closeRow) {
        const rising = Number(interval.closePrice) >= Number(interval.openPrice);
        const candleTop = 2;
        const candleBottom = Math.max(candleTop, height - 29);
        const candleY = (row) => clamp(Number(row.y), candleTop, candleBottom);
        const highY = candleY(highRow);
        const lowY = candleY(lowRow);
        const openY = candleY(openRow);
        const closeY = candleY(closeRow);
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
        const bodyWidth = Math.max(2, Math.min(8, candleBodyWidth * 1.22));
        const bodyLeft = candleX - bodyWidth / 2;

        state.context.save();
        state.context.beginPath();
        state.context.rect(columnLeft, candleTop, Math.max(1, dataLeft - columnLeft), Math.max(1, candleBottom - candleTop));
        state.context.clip();
        state.context.strokeStyle = rising ? theme.bullStroke : theme.bearStroke;
        // Match the main chart: a dark filled body with directional outline and wick.
        state.context.fillStyle = theme.bearFill;
        state.context.lineWidth = 1;
        state.context.beginPath();
        state.context.moveTo(candleX, highY);
        state.context.lineTo(candleX, lowY);
        state.context.stroke();
        state.context.fillRect(bodyLeft, bodyTop, bodyWidth, bodyHeight);
        state.context.strokeRect(bodyLeft, bodyTop, bodyWidth, bodyHeight);
        state.context.restore();
      }

      state.context.fillStyle = theme.panel;
      state.context.fillRect(columnLeft + 1, height - 28, Math.max(0, columnWidth - 2), 28);
      state.context.textAlign = "center";
      state.context.fillStyle = rgbaHex(theme.text, .97);
      state.context.font = "800 8.5px Inter, system-ui, sans-serif";
      state.context.fillText(
        formatQuoteVolume(interval.quote),
        labelX,
        height - 19,
        Math.max(1, columnWidth - 4),
      );
      state.context.fillStyle = interval.partial
        ? rgbaHex(theme.green, 1)
        : rgbaHex(theme.muted, .9);
      state.context.font = "750 7.5px Inter, system-ui, sans-serif";
      state.context.fillText(
        `${formatIntervalClock(interval.startTime)}${interval.partial ? " · LIVE" : ""}${interval.sessionPartial ? " · P" : ""}`,
        labelX,
        height - 6,
        Math.max(1, columnWidth - 4),
      );
      state.context.font = "800 7px Inter, system-ui, sans-serif";
    });
  }

  const totalCount = intervals.reduce((sum, interval) => sum + interval.count, 0);
  state.hasFrame = true;
  if (observability.enabled) {
    observability.rendered(symbol, "footprint");
    observability.record("footprint.render-card", performance.now() - renderStartedAt, {
      symbol,
      trades: totalCount,
      timeframeMs: state.timeframeMs,
      columns: columns.length,
      rows: columns.reduce((sum, column) => sum + column.clusters.length, 0),
      ladderRows: rows.length,
    });
  }
}

function acceptTape(event) {
  const detail = event?.detail;
  const symbol = normalizeOrderBookMarketKey(detail?.symbol, detail?.market);
  if (!symbol) return;
  if (!detail?.replace && !detail?.live) return;
  const incoming = detail?.live && Array.isArray(detail?.trades) ? detail.trades : [];
  const accumulator = footprintBySymbol.get(symbol) ?? createFootprintAccumulator();
  footprintBySymbol.set(
    symbol,
    ingestFootprintTrades(
      accumulator,
      incoming,
      { replace: Boolean(detail?.replace) },
    ),
  );
  document.querySelectorAll(".orderbook-card").forEach((card) => {
    if (cardSymbol(card) !== symbol) return;
    const state = cardStates.get(card);
    if (state && detail?.replace) state.sealedIntervals.clear();
    if (
      state
      && (detail?.replace || (incoming.length && state.historyOffset === 0))
    ) {
      state.hasFrame = false;
    }
    requestDraw(card);
  });
}

function acceptBookStatus(event) {
  const symbol = normalizeOrderBookMarketKey(event?.detail?.symbol, event?.detail?.market);
  const status = event?.detail?.status;
  if (!symbol || !status) return;
  statusBySymbol.set(symbol, status);
  document.querySelectorAll(".orderbook-card").forEach((card) => {
    if (cardSymbol(card) === symbol) requestDraw(card);
  });
}

function install() {
  if (typeof document === "undefined") return;
  injectStyles();
  globalThis.addEventListener("inpuls:tape-data", acceptTape);
  globalThis.addEventListener("inpuls:book-status", acceptBookStatus);
  globalThis.addEventListener("inpuls:theme-change", () => {
    document.querySelectorAll(".orderbook-card").forEach((card) => requestDraw(card));
  });
  globalThis.addEventListener(FLOW_LAYER_VISIBILITY_EVENT, (event) => {
    const card = event?.detail?.card;
    if (!(card instanceof Element) || !card.matches(".orderbook-card")) return;
    requestDraw(card);
  });
  document.querySelectorAll(".orderbook-card").forEach(ensureCard);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(".orderbook-card")) {
          ensureCard(node);
          requestDraw(node);
        }
        node.querySelectorAll?.(".orderbook-card").forEach((card) => {
          ensureCard(card);
          requestDraw(card);
        });
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("resize", requestDraw, { passive: true });
  window.addEventListener("orientationchange", requestDraw, { passive: true });
  document.addEventListener("scroll", requestDraw, true);
  document.addEventListener("visibilitychange", () => {
    flowDocumentHidden = document.hidden;
    if (flowDocumentHidden) {
      if (drawFrame) cancelAnimationFrame(drawFrame);
      drawFrame = 0;
      drawAllRequested = true;
      return;
    }
    requestDraw();
  });
  requestDraw();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
}
