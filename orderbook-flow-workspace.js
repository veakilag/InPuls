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

export const FOOTPRINT_TIMEFRAMES = Object.freeze([60_000, 5 * 60_000]);
const FOOTPRINT_TIMEFRAME_KEY = "inpuls-footprint-timeframe-v1";
const FLOW_LAYER_VISIBILITY_EVENT = "inpuls:flow-layer-visibility";
const FOOTPRINT_MINUTE_MS = 60_000;
const FOOTPRINT_RETAIN_MINUTES = 30;
const FOOTPRINT_DEFAULT_COLUMN_PX = 54;
const FOOTPRINT_MIN_COLUMN_PX = 34;
const FOOTPRINT_MAX_COLUMN_PX = 90;
const FOOTPRINT_COLUMN_STEP_PX = 7;
const FOOTPRINT_MAX_VISIBLE_COLUMNS = 16;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
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
  const time = Number(trade?.time ?? trade?.tradeTime ?? trade?.eventTime);
  if (![price, quantity, quote, time].every(Number.isFinite) || price <= 0 || quantity <= 0 || quote <= 0) {
    return null;
  }
  return {
    id: trade?.id ?? `${time}:${price}:${quantity}`,
    price,
    quantity,
    quote,
    time,
    side: trade?.side === "sell" ? "sell" : "buy",
  };
}

function flowTradeKey(trade) {
  return `${String(trade.id)}:${trade.time}:${trade.price}:${trade.quantity}`;
}

function compareFlowTrades(left, right) {
  return right.time - left.time || String(right.id).localeCompare(String(left.id));
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
    if (!trade || trade.time < startTime || trade.time > endTime) continue;
    const timeIndex = Math.floor((trade.time - startTime) / bucketMs);
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
    const time = Number(trade?.time);
    if (Number.isFinite(time) && time >= startTime && time <= endTime) count += 1;
  }
  return count;
}

export function footprintIntervalStart(time, timeframeMs = FOOTPRINT_TIMEFRAMES[0]) {
  const at = Number(time) || Date.now();
  const timeframe = FOOTPRINT_TIMEFRAMES.includes(Number(timeframeMs))
    ? Number(timeframeMs)
    : FOOTPRINT_TIMEFRAMES[0];
  return Math.floor(at / timeframe) * timeframe;
}

export function createFootprintAccumulator() {
  return { minutes: new Map() };
}

function minuteBucket(accumulator, startTime) {
  const bucket = accumulator.minutes.get(startTime) ?? {
    startTime,
    endTime: startTime + FOOTPRINT_MINUTE_MS,
    count: 0,
    quote: 0,
    firstTradeTime: Infinity,
    lastTradeTime: -Infinity,
    openPrice: null,
    closePrice: null,
    highPrice: null,
    lowPrice: null,
    cells: new Map(),
  };
  accumulator.minutes.set(startTime, bucket);
  return bucket;
}

function pruneFootprintAccumulator(accumulator, referenceTime = Date.now()) {
  const currentMinute = footprintIntervalStart(referenceTime, FOOTPRINT_MINUTE_MS);
  const minimum = currentMinute - (FOOTPRINT_RETAIN_MINUTES - 1) * FOOTPRINT_MINUTE_MS;
  for (const startTime of accumulator.minutes.keys()) {
    if (startTime < minimum || startTime > currentMinute) {
      accumulator.minutes.delete(startTime);
    }
  }
}

export function ingestFootprintTrades(accumulator, incoming, { replace = false } = {}) {
  const target = accumulator?.minutes instanceof Map
    ? accumulator
    : createFootprintAccumulator();
  if (replace) target.minutes.clear();
  let latestTime = 0;

  for (const rawTrade of incoming ?? []) {
    const trade = normalizeFlowTrade(rawTrade);
    if (!trade) continue;
    latestTime = Math.max(latestTime, trade.time);
    const startTime = footprintIntervalStart(trade.time, FOOTPRINT_MINUTE_MS);
    const bucket = minuteBucket(target, startTime);
    const priceKey = Number(trade.price).toPrecision(15);
    const cell = bucket.cells.get(priceKey) ?? {
      price: trade.price,
      buyQuote: 0,
      sellQuote: 0,
      quote: 0,
      count: 0,
    };
    cell[trade.side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    cell.quote += trade.quote;
    cell.count += 1;
    bucket.cells.set(priceKey, cell);
    bucket.quote += trade.quote;
    bucket.count += 1;
    if (trade.time < bucket.firstTradeTime) {
      bucket.firstTradeTime = trade.time;
      bucket.openPrice = trade.price;
    }
    if (trade.time >= bucket.lastTradeTime) {
      bucket.lastTradeTime = trade.time;
      bucket.closePrice = trade.price;
    }
    bucket.highPrice = bucket.highPrice === null
      ? trade.price
      : Math.max(bucket.highPrice, trade.price);
    bucket.lowPrice = bucket.lowPrice === null
      ? trade.price
      : Math.min(bucket.lowPrice, trade.price);
  }

  pruneFootprintAccumulator(target, latestTime || Date.now());
  return target;
}

function footprintSnapshotAt(
  accumulator,
  timeframe,
  startTime,
  now,
) {
  const endTime = startTime + timeframe;
  const cells = new Map();
  let count = 0;
  let quote = 0;
  let firstTradeTime = Infinity;
  let lastTradeTime = -Infinity;
  let openPrice = null;
  let closePrice = null;
  let highPrice = null;
  let lowPrice = null;

  for (const bucket of accumulator?.minutes?.values?.() ?? []) {
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
    if (Number.isFinite(bucket.highPrice)) {
      highPrice = highPrice === null ? bucket.highPrice : Math.max(highPrice, bucket.highPrice);
    }
    if (Number.isFinite(bucket.lowPrice)) {
      lowPrice = lowPrice === null ? bucket.lowPrice : Math.min(lowPrice, bucket.lowPrice);
    }
    for (const source of bucket.cells.values()) {
      const priceKey = Number(source.price).toPrecision(15);
      const cell = cells.get(priceKey) ?? {
        price: source.price,
        buyQuote: 0,
        sellQuote: 0,
        quote: 0,
        count: 0,
      };
      cell.buyQuote += source.buyQuote;
      cell.sellQuote += source.sellQuote;
      cell.quote += source.quote;
      cell.count += source.count;
      cells.set(priceKey, cell);
    }
  }

  return {
    timeframe,
    startTime,
    endTime,
    partial: Number(now) < endTime,
    count,
    quote,
    openPrice,
    closePrice,
    highPrice,
    lowPrice,
    cells: [...cells.values()].sort((left, right) => right.price - left.price),
  };
}

export function footprintIntervalSnapshot(
  accumulator,
  timeframeMs = FOOTPRINT_TIMEFRAMES[0],
  now = Date.now(),
) {
  const timeframe = FOOTPRINT_TIMEFRAMES.includes(Number(timeframeMs))
    ? Number(timeframeMs)
    : FOOTPRINT_TIMEFRAMES[0];
  const startTime = footprintIntervalStart(now, timeframe);
  return footprintSnapshotAt(accumulator, timeframe, startTime, now);
}

export function footprintIntervalHistory(
  accumulator,
  timeframeMs = FOOTPRINT_TIMEFRAMES[0],
  now = Date.now(),
  limit = FOOTPRINT_MAX_VISIBLE_COLUMNS,
  offset = 0,
) {
  const timeframe = FOOTPRINT_TIMEFRAMES.includes(Number(timeframeMs))
    ? Number(timeframeMs)
    : FOOTPRINT_TIMEFRAMES[0];
  const maximum = Math.max(
    1,
    Math.min(FOOTPRINT_MAX_VISIBLE_COLUMNS, Math.floor(Number(limit) || 1)),
  );
  const currentStart = footprintIntervalStart(now, timeframe);
  const earliestMinute = Math.min(
    currentStart,
    ...[...(accumulator?.minutes?.keys?.() ?? [])].map(Number).filter(Number.isFinite),
  );
  const earliestInterval = footprintIntervalStart(earliestMinute, timeframe);
  const latestOffset = Math.max(
    0,
    Math.floor((currentStart - earliestInterval) / timeframe),
  );
  const safeOffset = Math.min(
    latestOffset,
    Math.max(0, Math.floor(Number(offset) || 0)),
  );
  const endStart = currentStart - safeOffset * timeframe;
  const available = Math.max(
    1,
    Math.floor((endStart - earliestInterval) / timeframe) + 1,
  );
  const count = Math.min(maximum, available);

  return Array.from({ length: count }, (_, index) => {
    const startTime = endStart - (count - index - 1) * timeframe;
    return footprintSnapshotAt(accumulator, timeframe, startTime, now);
  });
}

export function footprintHistoryOffsetLimit(
  accumulator,
  timeframeMs = FOOTPRINT_TIMEFRAMES[0],
  now = Date.now(),
) {
  const timeframe = FOOTPRINT_TIMEFRAMES.includes(Number(timeframeMs))
    ? Number(timeframeMs)
    : FOOTPRINT_TIMEFRAMES[0];
  const starts = [...(accumulator?.minutes?.keys?.() ?? [])]
    .map(Number)
    .filter(Number.isFinite);
  if (!starts.length) return 0;
  const earliest = footprintIntervalStart(Math.min(...starts), timeframe);
  const latest = footprintIntervalStart(now, timeframe);
  return Math.max(0, Math.floor((latest - earliest) / timeframe));
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
  return pair.endsWith("USDT") ? pair : null;
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
    green: mixHex(panel2, green, .55),
    red: mixHex(panel2, red, .55),
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

function rowStep(rows) {
  const prices = [...new Set(rows.map((row) => row.price))].sort((a, b) => a - b);
  let step = Infinity;
  for (let index = 1; index < prices.length; index += 1) {
    const gap = prices[index] - prices[index - 1];
    if (gap > Number.EPSILON && gap < step) step = gap;
  }
  return Number.isFinite(step) ? step : .01;
}

function nearestRow(rows, price) {
  if (!rows.length) return null;
  let best = rows[0];
  let distance = Math.abs(price - best.price);
  for (let index = 1; index < rows.length; index += 1) {
    const nextDistance = Math.abs(price - rows[index].price);
    if (nextDistance < distance) {
      best = rows[index];
      distance = nextDistance;
    }
  }
  return best;
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
      background: color-mix(in srgb, var(--chart-bg) 72%, var(--panel));
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
      background: color-mix(in srgb, var(--chart-bg) 72%, var(--panel)) !important;
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
      <button type="button" data-footprint-timeframe="60000" class="is-active" aria-pressed="true">1М</button>
      <button type="button" data-footprint-timeframe="300000" aria-pressed="false">5М</button>
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
    timeframeMs: FOOTPRINT_TIMEFRAMES.includes(
      Number(localStorage.getItem(FOOTPRINT_TIMEFRAME_KEY)),
    )
      ? Number(localStorage.getItem(FOOTPRINT_TIMEFRAME_KEY))
      : FOOTPRINT_TIMEFRAMES[0],
    columnWidthPx: FOOTPRINT_DEFAULT_COLUMN_PX,
    historyOffset: 0,
    hasFrame: false,
    lastSymbol: null,
  };
  cardStates.set(card, state);

  const syncTimeframes = () => {
    pane.querySelectorAll("[data-footprint-timeframe]").forEach((button) => {
      const active = Number(button.dataset.footprintTimeframe) === state.timeframeMs;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  };
  pane.querySelectorAll("[data-footprint-timeframe]").forEach((button) => {
    button.addEventListener("click", () => {
      state.timeframeMs = Number(button.dataset.footprintTimeframe);
      state.historyOffset = 0;
      localStorage.setItem(FOOTPRINT_TIMEFRAME_KEY, String(state.timeframeMs));
      syncTimeframes();
      state.hasFrame = false;
      requestDraw(card);
    });
  });
  syncTimeframes();

  pane.addEventListener("wheel", (event) => {
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
      Date.now(),
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
  state.historyOffset = Math.min(
    state.historyOffset,
    footprintHistoryOffsetLimit(accumulator, state.timeframeMs, Date.now()),
  );
  const visibleColumnLimit = Math.max(
    1,
    Math.min(
      FOOTPRINT_MAX_VISIBLE_COLUMNS,
      Math.floor(width / Math.max(FOOTPRINT_MIN_COLUMN_PX, state.columnWidthPx)),
    ),
  );
  const intervals = footprintIntervalHistory(
    accumulator,
    state.timeframeMs,
    Date.now(),
    visibleColumnLimit,
    state.historyOffset,
  );
  const columns = intervals.map((interval) => {
    const clustersByRow = new Map();
    for (const source of interval.cells) {
      const row = nearestRow(rows, source.price);
      if (!row) continue;
      const cluster = clustersByRow.get(row.index) ?? {
        row,
        buyQuote: 0,
        sellQuote: 0,
        quote: 0,
        count: 0,
      };
      cluster.buyQuote += source.buyQuote;
      cluster.sellQuote += source.sellQuote;
      cluster.quote += source.quote;
      cluster.count += source.count;
      clustersByRow.set(row.index, cluster);
    }
    return { interval, clusters: [...clustersByRow.values()] };
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
    navigation.textContent = state.historyOffset > 0
      ? `−${state.historyOffset}`
      : "LIVE";
  }

  state.context.font = "800 7px Inter, system-ui, sans-serif";
  state.context.textBaseline = "middle";

  if (state.visible) {
    columns.forEach(({ interval, clusters }, columnIndex) => {
      const columnLeft = columnsLeft + columnIndex * columnWidth;
      const centerX = columnLeft + columnWidth / 2;

      for (const cluster of clusters) {
        const totalQuote = Math.max(Number.EPSILON, cluster.quote);
        const sellShare = Math.max(0, cluster.sellQuote) / totalQuote;
        const buyShare = Math.max(0, cluster.buyQuote) / totalQuote;
        const dominantSide = buyShare > sellShare ? "B" : sellShare > buyShare ? "S" : "·";
        const dominantShare = Math.max(buyShare, sellShare);
        const clusterStrength = footprintCellIntensity(cluster.quote, maximumCluster);
        const cellHeight = Math.max(3, Math.min(cluster.row.height * .92, 14));
        const cellTop = cluster.row.y - cellHeight / 2;
        const cellLeft = columnLeft + 1;
        const cellWidth = Math.max(1, columnWidth - 2);
        const sellWidth = cellWidth * sellShare;
        const buyWidth = Math.max(0, cellWidth - sellWidth);
        const alpha = .24 + clusterStrength * .42;

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

        state.context.strokeStyle = dominantSide === "B"
          ? rgbaHex(theme.green, .82)
          : dominantSide === "S"
            ? rgbaHex(theme.red, .82)
            : rgbaHex(theme.muted, .36);
        state.context.lineWidth = .75;
        state.context.strokeRect(cellLeft, cellTop, cellWidth, cellHeight);

        state.context.textAlign = "center";
        state.context.fillStyle = theme.text;
        state.context.fillText(
          `${dominantSide} ${Math.round(dominantShare * 100)}% · ${formatUsd(cluster.quote)}`,
          centerX,
          cluster.row.y,
        );
      }

      const highRow = nearestRow(rows, interval.highPrice);
      const lowRow = nearestRow(rows, interval.lowPrice);
      const openRow = nearestRow(rows, interval.openPrice);
      const closeRow = nearestRow(rows, interval.closePrice);
      if (highRow && lowRow && openRow && closeRow) {
        const rising = Number(interval.closePrice) >= Number(interval.openPrice);
        state.context.strokeStyle = rising
          ? rgbaHex(theme.green, .94)
          : rgbaHex(theme.red, .94);
        state.context.fillStyle = rising
          ? rgbaHex(theme.green, .9)
          : rgbaHex(theme.red, .9);
        state.context.lineWidth = 1;
        state.context.beginPath();
        state.context.moveTo(centerX, highRow.y);
        state.context.lineTo(centerX, lowRow.y);
        state.context.stroke();
        const bodyTop = Math.min(openRow.y, closeRow.y);
        const bodyHeight = Math.max(2, Math.abs(closeRow.y - openRow.y));
        state.context.fillRect(centerX - 2, bodyTop, 4, bodyHeight);
        state.context.strokeRect(centerX - 2, bodyTop, 4, bodyHeight);
      }

      state.context.fillStyle = theme.panel;
      state.context.fillRect(columnLeft + 1, height - 11, Math.max(0, columnWidth - 2), 11);
      state.context.textAlign = "center";
      state.context.fillStyle = interval.partial
        ? rgbaHex(theme.green, .96)
        : rgbaHex(theme.muted, .82);
      state.context.font = "700 6.5px Inter, system-ui, sans-serif";
      state.context.fillText(
        `${formatIntervalClock(interval.startTime)}${interval.partial ? " · LIVE" : ""}`,
        centerX,
        height - 5,
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
  const symbol = String(detail?.symbol ?? "").toUpperCase();
  if (!symbol.endsWith("USDT")) return;
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
    if (detail?.replace) {
      const state = cardStates.get(card);
      if (state) state.hasFrame = false;
    }
    requestDraw(card);
  });
}

function acceptBookStatus(event) {
  const symbol = String(event?.detail?.symbol ?? "").toUpperCase();
  const status = event?.detail?.status;
  if (!symbol.endsWith("USDT") || !status) return;
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
