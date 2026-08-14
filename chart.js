import { binanceClock } from "./binance-clock.js?v=26-102-tape-live-edge-minute-boundary-v1";

const MARKET_WS = "wss://fstream.binance.com/market/ws";
const KLINES_REST = "https://fapi.binance.com/fapi/v1/klines";
const AGG_TRADES_REST = "https://fapi.binance.com/fapi/v1/aggTrades";
const RANGE_MS = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000, "90d": 7_776_000_000, "365d": 31_536_000_000 };
const INTERVAL_MS = { "1s": 1_000, "5s": 5_000, "15s": 15_000, "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000, "1w": 604_800_000, "1M": 2_592_000_000 };

export function parseRestKline(row) {
  return {
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Number(row[6]),
    closed: true,
  };
}

export function parseStreamKline(event) {
  const kline = event?.k;
  if (!kline) return null;
  return {
    time: Number(kline.t),
    open: Number(kline.o),
    high: Number(kline.h),
    low: Number(kline.l),
    close: Number(kline.c),
    volume: Number(kline.v),
    closeTime: Number(kline.T),
    closed: Boolean(kline.x),
  };
}

export function upsertCandle(candles, candle, limit = 180) {
  if (!candle || !Number.isFinite(candle.time)) return candles;
  const next = candles.slice();
  const last = next.at(-1);
  if (last?.time === candle.time) next[next.length - 1] = candle;
  else if (!last || candle.time > last.time) next.push(candle);
  else {
    const index = next.findIndex((item) => item.time === candle.time);
    if (index >= 0) next[index] = candle;
  }
  return next.slice(-limit);
}

export function upsertLiveCandleInPlace(candles, candle, limit = 180) {
  if (!Array.isArray(candles) || !candle || !Number.isFinite(candle.time)) return candles;
  const last = candles.at(-1);
  if (last?.time === candle.time) candles[candles.length - 1] = candle;
  else if (!last || candle.time > last.time) candles.push(candle);
  else {
    const index = candles.findIndex((item) => item.time === candle.time);
    if (index >= 0) candles[index] = candle;
  }
  const overflow = candles.length - Math.max(1, Math.floor(Number(limit) || 1));
  if (overflow > 0) candles.splice(0, overflow);
  return candles;
}

export function buildProvisionalCandle(previous, bucketStart, bucketMs) {
  const source = previous && typeof previous === "object" ? previous : null;
  const time = Number(bucketStart);
  const duration = Number(bucketMs);
  const close = Number(source?.close);
  if (![time, duration, close].every(Number.isFinite) || duration <= 0 || time <= Number(source?.time)) return null;
  return {
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
    closeTime: time + duration - 1,
    closed: false,
    provisional: true,
  };
}

export function scaleFromDrag(initialScale, delta, sensitivity = 120) {
  return Math.max(.15, Math.min(8, initialScale * Math.exp(delta / sensitivity)));
}

export function visibleCountFromDrag(initialCount, delta, total) {
  return Math.round(Math.max(Math.min(20, total), Math.min(total, initialCount * Math.exp(delta / 180))));
}

export function maximumVisibleCandles(plotWidth, minimumSpacing = 1.25) {
  return Math.max(20, Math.floor(Math.max(1, Number(plotWidth) || 1) / Math.max(1, Number(minimumSpacing) || 1)));
}

export function calculateNatr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) return null;
  const ranges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    ranges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < ranges.length; index += 1) atr = ((atr * (period - 1)) + ranges[index]) / period;
  const close = candles.at(-1)?.close;
  return Number.isFinite(close) && close !== 0 ? (atr / close) * 100 : null;
}

export function pearsonCorrelation(left, right) {
  const length = Math.min(left?.length ?? 0, right?.length ?? 0);
  if (length < 3) return null;
  const a = left.slice(-length);
  const b = right.slice(-length);
  const meanA = a.reduce((sum, value) => sum + value, 0) / length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / length;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < length; index += 1) {
    const deltaA = a[index] - meanA;
    const deltaB = b[index] - meanB;
    covariance += deltaA * deltaB;
    varianceA += deltaA ** 2;
    varianceB += deltaB ** 2;
  }
  const denominator = Math.sqrt(varianceA * varianceB);
  return denominator ? covariance / denominator : null;
}

export function drawingPercentChange(startPrice, endPrice) {
  if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice) || startPrice === 0) return null;
  return ((endPrice - startPrice) / startPrice) * 100;
}

export function snapPriceToCandle(candle, price) {
  const levels = [candle?.low, candle?.high, candle?.open, candle?.close].filter(Number.isFinite);
  if (!levels.length || !Number.isFinite(price)) return price;
  return levels.reduce((nearest, level) => Math.abs(level - price) < Math.abs(nearest - price) ? level : nearest, levels[0]);
}

export function snapPointToCandle(candles, slot, price) {
  if (!Array.isArray(candles) || !candles.length || !Number.isFinite(slot)) return null;
  const index = candleIndexAtSlot(slot, candles.length);
  const candle = candles[index];
  if (!candle || !Number.isFinite(candle.time)) return null;
  return { time: candle.time, price: snapPriceToCandle(candle, price), snapped: true, candleIndex: index };
}

export function candleIndexAtSlot(slot, length) {
  return Math.max(0, Math.min(Math.max(0, length - 1), Math.round(Number(slot) - .5)));
}

export function candleCenterSlot(index) {
  return Number(index) + .5;
}

export function preserveViewFraction(nextAnchor, previousViewStart) {
  return nextAnchor + (previousViewStart - Math.floor(previousViewStart));
}

const TIME_TICK_STEPS = [
  1_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000,
  3_600_000, 2 * 3_600_000, 3 * 3_600_000, 4 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000,
  86_400_000, 2 * 86_400_000, 7 * 86_400_000, 14 * 86_400_000, 30 * 86_400_000,
  90 * 86_400_000, 180 * 86_400_000, 365 * 86_400_000,
];

export function niceTimeTickStep(rangeMs, targetTicks = 6) {
  const rough = Math.max(1, rangeMs) / Math.max(2, targetTicks);
  return TIME_TICK_STEPS.find((step) => step >= rough) ?? TIME_TICK_STEPS.at(-1);
}

export function nicePriceStep(range, targetTicks = 6) {
  const rough = Math.max(Number.MIN_VALUE, Math.abs(range) / Math.max(2, targetTicks));
  const exponent = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return niceFraction * exponent;
}

class SecondHistoryStore {
  constructor() { this.dbPromise = null; }

  #open() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      const request = indexedDB.open("inpuls-second-history-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("series", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return this.dbPromise;
  }

  async get(key) {
    const db = await this.#open();
    if (!db) return [];
    return new Promise((resolve) => {
      const request = db.transaction("series", "readonly").objectStore("series").get(key);
      request.onsuccess = () => resolve(Array.isArray(request.result?.candles) ? request.result.candles : []);
      request.onerror = () => resolve([]);
    });
  }

  async set(key, candles) {
    const db = await this.#open();
    if (!db) return;
    await new Promise((resolve) => {
      const transaction = db.transaction("series", "readwrite");
      transaction.objectStore("series").put({ key, candles: candles.slice(-30_000), updatedAt: Date.now() });
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
    });
  }
}

const secondHistoryStore = new SecondHistoryStore();

export class KlineFeed {
  constructor({ onData, onStatus }) {
    this.onData = onData;
    this.onStatus = onStatus;
    this.symbol = null;
    this.interval = null;
    this.candles = [];
    this.socket = null;
    this.abortController = null;
    this.reconnectTimer = null;
    this.generation = 0;
    this.seriesCache = new Map();
    this.historyFlushTimer = null;
    this.liveEmitHandle = null;
    this.liveEmitKind = null;
    this.pendingLiveMeta = null;
    this.cacheFlushTimer = null;
    this.boundaryTimer = null;
    this.clockStateHandler = () => this.#scheduleBoundaryTick(this.generation);
    binanceClock.addEventListener("statechange", this.clockStateHandler);
  }

  async select(symbol, interval = "1m", range = "1h") {
    if (symbol === this.symbol && interval === this.interval && range === this.range && this.socket) return;
    if (this.symbol && this.interval && this.candles.length) {
      this.seriesCache.set(`${this.symbol}:${this.interval}`, this.candles.slice(-(this.interval.endsWith("s") ? 30_000 : 1500)));
    }
    this.symbol = symbol;
    this.interval = interval;
    this.range = range;
    const cacheKey = `${symbol}:${interval}`;
    this.candles = this.seriesCache.get(cacheKey)?.slice() ?? [];
    this.generation += 1;
    const generation = this.generation;
    this.#cleanup();
    this.onStatus({ state: "loading", text: `Загружаю ${symbol} · ${interval}` });
    this.onData(this.candles, { symbol, interval, range, targetCandles: this.candles.length || undefined });

    this.abortController = new AbortController();
    try {
      const secondsMode = interval.endsWith("s");
      const targetCandles = Math.max(30, Math.ceil((RANGE_MS[range] ?? RANGE_MS["1h"]) / (INTERVAL_MS[interval] ?? 60_000)));
      let loadedCandles;
      if (secondsMode) {
        const saved = await secondHistoryStore.get(cacheKey);
        if (generation !== this.generation) return;
        if (saved.length) {
          this.candles = mergeCandles(saved.filter(isValidCandle), this.candles).slice(-30_000);
          this.onData(this.candles, { symbol, interval, range, targetCandles, historySource: "device" });
          this.onStatus({ state: "loading", text: `История устройства: ${this.candles.length.toLocaleString("ru-RU")} свечей` });
        }
        loadedCandles = await this.#fetchSecondCandles(symbol, INTERVAL_MS[interval], Math.min(30_000, targetCandles), generation);
      } else {
        const query = new URLSearchParams({ symbol, interval, limit: "1500" });
        const response = await fetch(`${KLINES_REST}?${query}`, { signal: this.abortController.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rows = await response.json();
        loadedCandles = rows.map(parseRestKline).filter(isValidCandle);
      }
      if (generation !== this.generation) return;
      this.candles = mergeCandles(loadedCandles, this.candles).slice(-(secondsMode ? 30_000 : 1500));
      this.seriesCache.set(cacheKey, this.candles.slice());
      this.onData(this.candles, { symbol, interval, range, targetCandles });
      if (secondsMode) this.#scheduleSecondHistorySave();
    } catch (error) {
      if (error.name !== "AbortError" && generation === this.generation) {
        this.onStatus({ state: "warning", text: "История недоступна — собираю новые свечи" });
      }
    }

    if (generation === this.generation) {
      this.#connect(generation);
      this.#scheduleBoundaryTick(generation);
    }
  }

  async #fetchSecondCandles(symbol, bucketMs, desiredCandles, generation) {
    const rows = await this.#fetchAggregateTradeHistory(symbol, bucketMs, desiredCandles, generation);
    return aggregateTrades(rows, bucketMs).slice(-desiredCandles);
  }

  async #fetchAggregateTradeHistory(symbol, bucketMs, desiredCandles, generation) {
    const fetchPage = async (endTime) => {
      const query = new URLSearchParams({ symbol, limit: "1000" });
      if (Number.isFinite(endTime)) query.set("endTime", String(Math.floor(endTime)));
      const response = await fetch(`${AGG_TRADES_REST}?${query}`, { signal: this.abortController.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    };
    const byId = new Map();
    let endTime = Date.now();
    const desiredDuration = Math.max(60_000, desiredCandles * bucketMs);
    let newestTime = null;
    for (let page = 0; page < 12 && generation === this.generation; page += 1) {
      const rows = await fetchPage(endTime);
      if (!Array.isArray(rows) || !rows.length) break;
      for (const trade of rows) byId.set(Number(trade.a), trade);
      const oldestTime = Number(rows[0]?.T);
      newestTime ??= Number(rows.at(-1)?.T);
      if (!Number.isFinite(oldestTime) || oldestTime >= endTime) break;
      endTime = oldestTime - 1;
      if (Number.isFinite(newestTime) && newestTime - oldestTime >= desiredDuration) break;
    }
    if (generation !== this.generation) return [];
    if (!byId.size) throw new Error("Aggregate trade history unavailable");
    return [...byId.values()].sort((left, right) => Number(left.T) - Number(right.T));
  }

  #scheduleSecondHistorySave() {
    if (!this.interval?.endsWith("s") || !this.symbol) return;
    clearTimeout(this.historyFlushTimer);
    const key = `${this.symbol}:${this.interval}`;
    this.historyFlushTimer = setTimeout(() => secondHistoryStore.set(key, this.candles), 900);
  }

  #scheduleLiveEmit(meta) {
    this.pendingLiveMeta = meta;
    if (this.liveEmitHandle !== null) return;
    const emit = () => {
      this.liveEmitHandle = null;
      this.liveEmitKind = null;
      const pending = this.pendingLiveMeta;
      this.pendingLiveMeta = null;
      if (!pending) return;
      this.onData(this.candles, pending);
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      this.liveEmitKind = "raf";
      this.liveEmitHandle = globalThis.requestAnimationFrame(emit);
    } else {
      this.liveEmitKind = "timeout";
      this.liveEmitHandle = setTimeout(emit, 16);
    }
  }

  #scheduleSeriesCacheFlush() {
    if (this.cacheFlushTimer !== null || !this.symbol || !this.interval) return;
    this.cacheFlushTimer = setTimeout(() => {
      this.cacheFlushTimer = null;
      if (!this.symbol || !this.interval) return;
      const limit = this.interval.endsWith("s") ? 30_000 : 1_500;
      this.seriesCache.set(`${this.symbol}:${this.interval}`, this.candles.slice(-limit));
    }, 250);
  }

  #cancelLiveEmit() {
    if (this.liveEmitHandle === null) return;
    if (this.liveEmitKind === "raf" && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(this.liveEmitHandle);
    } else {
      clearTimeout(this.liveEmitHandle);
    }
    this.liveEmitHandle = null;
    this.liveEmitKind = null;
    this.pendingLiveMeta = null;
  }

  #scheduleBoundaryTick(generation) {
    clearTimeout(this.boundaryTimer);
    this.boundaryTimer = null;
    const intervalMs = Number(INTERVAL_MS[this.interval]);
    if (generation !== this.generation || !Number.isFinite(intervalMs) || intervalMs < 60_000) return;
    const now = Number(binanceClock.now());
    if (!Number.isFinite(now)) return;
    const nextBoundary = Math.floor(now / intervalMs) * intervalMs + intervalMs;
    const delay = Math.max(20, Math.min(2_000_000_000, nextBoundary - now + 12));
    this.boundaryTimer = setTimeout(() => this.#advanceBoundary(generation), delay);
  }

  #advanceBoundary(generation) {
    this.boundaryTimer = null;
    const intervalMs = Number(INTERVAL_MS[this.interval]);
    const now = Number(binanceClock.now());
    if (generation !== this.generation || !Number.isFinite(intervalMs) || intervalMs < 60_000 || !Number.isFinite(now)) return;
    const currentBucket = Math.floor(now / intervalMs) * intervalMs;
    let previous = this.candles.at(-1);
    let changed = false;
    let guard = 0;
    while (previous && Number(previous.time) < currentBucket && guard < 120) {
      const provisional = buildProvisionalCandle(previous, Number(previous.time) + intervalMs, intervalMs);
      if (!provisional) break;
      upsertLiveCandleInPlace(this.candles, provisional, 1_500);
      previous = this.candles.at(-1);
      changed = true;
      guard += 1;
    }
    if (changed) {
      this.#scheduleSeriesCacheFlush();
      this.#scheduleLiveEmit({
        symbol: this.symbol,
        interval: this.interval,
        range: this.range,
        provisionalBoundary: true,
      });
      globalThis.dispatchEvent?.(new CustomEvent("inpuls:kline-boundary", {
        detail: { symbol: this.symbol, interval: this.interval, time: currentBucket },
      }));
    }
    this.#scheduleBoundaryTick(generation);
  }

  destroy() {
    this.generation += 1;
    this.#cleanup();
    binanceClock.removeEventListener("statechange", this.clockStateHandler);
  }

  #connect(generation) {
    const secondsMode = this.interval.endsWith("s");
    const stream = secondsMode ? `${this.symbol.toLowerCase()}@aggTrade` : `${this.symbol.toLowerCase()}@kline_${this.interval}`;
    this.socket = new WebSocket(`${MARKET_WS}/${stream}`);
    this.socket.addEventListener("open", () => {
      if (generation === this.generation) this.onStatus({ state: "online", text: "Свечи онлайн" });
    });
    this.socket.addEventListener("message", (message) => {
      if (generation !== this.generation) return;
      try {
        const payload = JSON.parse(message.data);
        const data = payload.data ?? payload;
        const candle = secondsMode ? tradeToCandle(data, INTERVAL_MS[this.interval]) : parseStreamKline(data);
        if (!isValidCandle(candle)) return;
        if (secondsMode && this.candles.at(-1)?.time === candle.time) {
          const last = this.candles.at(-1);
          candle.open = last.open;
          candle.high = Math.max(last.high, candle.high);
          candle.low = Math.min(last.low, candle.low);
          candle.volume += last.volume;
        }
        upsertLiveCandleInPlace(this.candles, candle, secondsMode ? 30_000 : 1_500);
        this.#scheduleSeriesCacheFlush();
        this.#scheduleLiveEmit({ symbol: this.symbol, interval: this.interval, range: this.range });
        if (secondsMode) this.#scheduleSecondHistorySave();
      } catch {
        // Ignore one malformed market message and keep the stream alive.
      }
    });
    this.socket.addEventListener("close", () => {
      if (generation !== this.generation) return;
      this.onStatus({ state: "warning", text: "Переподключаю свечи…" });
      this.reconnectTimer = setTimeout(() => this.#connect(generation), 1800);
    });
    this.socket.addEventListener("error", () => {
      if (generation === this.generation) this.onStatus({ state: "warning", text: "Ошибка потока свечей" });
    });
  }

  #cleanup() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.historyFlushTimer);
    clearTimeout(this.cacheFlushTimer);
    clearTimeout(this.boundaryTimer);
    this.cacheFlushTimer = null;
    this.boundaryTimer = null;
    this.#cancelLiveEmit();
    this.abortController?.abort();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
    }
    this.socket = null;
  }
}

export class CandlestickChart {
  constructor(canvas, tooltip, { onAlert = null, storageKey = null } = {}) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.context = canvas.getContext("2d");
    this.candles = [];
    this.hoverX = null;
    this.hoverY = null;
    this.layout = null;
    this.visibleCount = null;
    this.viewStart = null;
    this.priceScale = 1;
    this.pricePan = 0;
    this.fixedPriceDomain = null;
    this.followLatest = true;
    this.timeZone = "Europe/Moscow";
    this.volumeVisible = true;
    this.sessionsVisible = true;
    this.activeTool = null;
    this.drawings = [];
    this.annotations = [];
    this.annotationBuckets = { zone: [], line: [], ray: [], segment: [], event: [], point: [] };
    this.storageKey = storageKey;
    this.drawingStore = this.#loadDrawingStore();
    this.viewportStore = this.#loadViewportStore();
    this.drawingSymbol = null;
    this.undoStack = [];
    this.draftDrawing = null;
    this.drawingGesture = null;
    this.magnetHeld = false;
    this.magnetEnabled = true;
    this.drawingSnap = false;
    this.centerLatest = true;
    this.onAlert = onAlert;
    this.onToolChange = null;
    this.fontScale = 1;
    this.theme = {
      background: "#07090e",
      bullFill: "#4fd1a5",
      bullStroke: "#4fd1a5",
      bearFill: "#25191f",
      bearStroke: "#f2788b",
      grid: "#303746",
      text: "#8992a8",
      crosshair: "#9ba4b8",
      crosshairFill: "#252b38",
      crosshairText: "#fbfbfd",
      session: "#7c83ff",
    };
    this.drag = null;
    this.renderFrame = null;
    this.viewportPersistTimer = null;
    this.wheelIdleTimer = null;
    this.wheelActive = false;
    this.resizeObserver = new ResizeObserver(() => this.#requestRender());
    this.resizeObserver.observe(canvas.parentElement);
    canvas.addEventListener("pointermove", (event) => this.#handlePointer(event));
    canvas.addEventListener("pointerdown", (event) => this.#handlePointerDown(event));
    canvas.addEventListener("pointerup", (event) => this.#handlePointerUp(event));
    canvas.addEventListener("pointercancel", (event) => this.#handlePointerUp(event));
    canvas.addEventListener("pointerenter", () => { CandlestickChart.activeChart = this; });
    canvas.addEventListener("contextmenu", (event) => this.#handleContextMenu(event));
    canvas.addEventListener("pointerleave", () => {
      if (this.drag) return;
      this.hoverX = null;
      this.hoverY = null;
      this.tooltip.hidden = true;
      this.#requestRender();
    });
    canvas.addEventListener("wheel", (event) => this.#handleWheel(event), { passive: false });
    canvas.addEventListener("dblclick", () => this.resetView());
    this.keyHandler = (event) => {
      if (event.key === "Control" || event.key === "Meta") this.magnetHeld = true;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && CandlestickChart.activeChart === this) {
        event.preventDefault();
        this.undoDrawing();
      }
    };
    this.keyUpHandler = (event) => {
      if (event.key === "Control" || event.key === "Meta") this.magnetHeld = false;
    };
    this.blurHandler = () => { this.magnetHeld = false; };
    window.addEventListener("keydown", this.keyHandler, true);
    window.addEventListener("keyup", this.keyUpHandler, true);
    window.addEventListener("blur", this.blurHandler);
  }

  setTimeZone(timeZone) {
    this.timeZone = timeZone || "Europe/Moscow";
    this.#requestRender();
  }

  setVolumeVisible(visible) {
    this.volumeVisible = Boolean(visible);
    this.#requestRender();
  }

  setSessionsVisible(visible) {
    this.sessionsVisible = Boolean(visible);
    this.#requestRender();
  }

  setFontScale(scale) {
    this.fontScale = Math.max(.8, Math.min(1.3, Number(scale) || 1));
    this.#requestRender();
  }

  resetView() {
    this.followLatest = true;
    this.centerLatest = true;
    this.pricePan = 0;
    this.priceScale = 1;
    this.fixedPriceDomain = null;
    this.viewStart = Math.max(0, this.candles.length - (this.visibleCount ?? 80) / 2);
    this.#persistViewport();
    this.#requestRender();
  }

  lockPriceDomain() {
    this.#lockPriceDomain();
  }

  #font(size, bold = false) {
    return `${bold ? "bold " : ""}${Math.max(6, size * this.fontScale).toFixed(1)}px Arial, sans-serif`;
  }

  #requestRender() {
    if (this.renderFrame !== null) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  #shouldSnap(event) {
    return Boolean(
      this.magnetEnabled
      || this.magnetHeld
      || event?.ctrlKey
      || event?.metaKey
      || event?.getModifierState?.("Control")
      || event?.getModifierState?.("Meta"),
    );
  }

  setMagnetEnabled(enabled) {
    this.magnetEnabled = Boolean(enabled);
    this.onToolChange?.(this.activeTool);
    this.#requestRender();
  }

  setTool(tool) {
    const allowed = new Set(["trend", "horizontal", "ruler", "rectangle", "ray", "freehand", "alert"]);
    this.activeTool = allowed.has(tool) ? tool : null;
    this.draftDrawing = null;
    this.drawingGesture = null;
    this.drawingSnap = false;
    this.canvas.style.cursor = this.activeTool ? "crosshair" : "crosshair";
    this.onToolChange?.(this.activeTool);
    this.#requestRender();
  }

  clearDrawings() {
    if (!this.drawings.length) return;
    this.undoStack.push({ type: "clear", drawings: this.drawings.map((item) => structuredClone(item)) });
    this.drawings = [];
    this.draftDrawing = null;
    this.drawingGesture = null;
    this.setTool(null);
    this.#persistDrawings();
  }

  undoDrawing() {
    const action = this.undoStack.pop();
    if (!action) return;
    if (action.type === "add") this.drawings = this.drawings.filter((item) => item.id !== action.drawing.id);
    else if (action.type === "delete") this.drawings.splice(Math.min(action.index, this.drawings.length), 0, action.drawing);
    else if (action.type === "clear") this.drawings = action.drawings.map((item) => structuredClone(item));
    else if (action.type === "move") {
      const index = this.drawings.findIndex((item) => item.id === action.before.id);
      if (index >= 0) this.drawings[index] = structuredClone(action.before);
    }
    this.#persistDrawings();
    this.#requestRender();
  }

  #loadDrawingStore() {
    if (!this.storageKey || typeof localStorage === "undefined") return new Map();
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey) || "{}");
      return new Map(Object.entries(saved).filter(([, value]) => Array.isArray(value)));
    } catch {
      return new Map();
    }
  }

  #loadViewportStore() {
    if (!this.storageKey || typeof localStorage === "undefined") return new Map();
    try {
      const saved = JSON.parse(localStorage.getItem(`${this.storageKey}-viewport`) || "{}");
      return new Map(Object.entries(saved));
    } catch {
      return new Map();
    }
  }

  #persistViewport() {
    const symbol = this.meta?.symbol;
    if (!symbol || !this.storageKey || typeof localStorage === "undefined") return;
    const anchorTime = this.candles[Math.max(0, Math.min(this.candles.length - 1, Math.floor(this.viewStart ?? 0)))]?.time ?? null;
    this.viewportStore.set(symbol, {
      anchorTime,
      visibleCount: this.visibleCount,
      priceScale: this.priceScale,
      pricePan: this.pricePan,
      followLatest: this.followLatest,
      fixedPriceDomain: this.fixedPriceDomain,
      centerLatest: this.centerLatest,
    });
    try { localStorage.setItem(`${this.storageKey}-viewport`, JSON.stringify(Object.fromEntries(this.viewportStore))); } catch {}
  }

  #scheduleViewportPersist(delay = 180) {
    clearTimeout(this.viewportPersistTimer);
    this.viewportPersistTimer = setTimeout(() => {
      this.viewportPersistTimer = null;
      this.#persistViewport();
    }, delay);
  }

  #persistDrawings() {
    if (this.drawingSymbol) this.drawingStore.set(this.drawingSymbol, this.drawings.map((item) => structuredClone(item)));
    if (!this.storageKey || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(Object.fromEntries(this.drawingStore)));
    } catch {}
  }

  setAnnotations(annotations = []) {
    const next = (Array.isArray(annotations) ? annotations : [])
      .filter((item) => item && typeof item === "object");
    const buckets = { zone: [], line: [], ray: [], segment: [], event: [], point: [] };
    for (const annotation of next) {
      if (buckets[annotation.type]) buckets[annotation.type].push(annotation);
    }
    this.annotations = next;
    this.annotationBuckets = buckets;
    this.#requestRender();
  }

  setTheme(theme) {
    this.theme = { ...this.theme, ...theme };
    this.#requestRender();
  }

  destroy() {
    this.#persistDrawings();
    this.#persistViewport();
    this.resizeObserver.disconnect();
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    clearTimeout(this.viewportPersistTimer);
    clearTimeout(this.wheelIdleTimer);
    this.renderFrame = null;
    this.viewportPersistTimer = null;
    this.wheelIdleTimer = null;
    this.wheelActive = false;
    this.drag = null;
    window.removeEventListener("keydown", this.keyHandler, true);
    window.removeEventListener("keyup", this.keyUpHandler, true);
    window.removeEventListener("blur", this.blurHandler);
  }

  setData(candles, meta) {
    const nextKey = `${meta?.symbol ?? ""}:${meta?.interval ?? ""}:${meta?.range ?? ""}`;
    const seriesChanged = nextKey !== this.seriesKey;
    const symbolChanged = Boolean(meta?.symbol && this.meta?.symbol !== meta.symbol);
    if (symbolChanged && this.meta?.symbol) this.#persistViewport();
    if (meta?.symbol && meta.symbol !== this.drawingSymbol) {
      if (this.drawingSymbol) this.#persistDrawings();
      this.drawingSymbol = meta.symbol;
      this.drawings = (this.drawingStore.get(meta.symbol) ?? []).map((item) => structuredClone(item));
      this.undoStack = [];
      this.draftDrawing = null;
      this.drawingGesture = null;
    }
    const oldViewStart = this.viewStart ?? 0;
    const oldAnchorIndex = Math.max(0, Math.floor(oldViewStart));
    const oldAnchorTime = !seriesChanged && !this.followLatest && this.candles.length
      ? this.candles[oldAnchorIndex]?.time
      : null;
    if (seriesChanged) {
      this.pendingViewport = !symbolChanged && this.candles.length && this.visibleCount
        ? {
            latestRatio: (this.candles.length - 1 - (this.viewStart ?? 0)) / this.visibleCount,
            followLatest: this.followLatest,
          }
        : null;
      this.seriesKey = nextKey;
      this.viewStart = null;
      this.followLatest = !this.pendingViewport;
      this.centerLatest = true;
      if (symbolChanged) this.pricePan = 0;
    }
    this.candles = candles;
    this.meta = meta;
    if (symbolChanged) {
      // A newly selected instrument always starts from the neutral centered view.
      // Manual navigation remains intact while the same series receives live ticks.
      this.priceScale = 1;
      this.pricePan = 0;
      this.fixedPriceDomain = null;
      this.followLatest = true;
      this.centerLatest = true;
      this.viewStart = candles.length ? Math.max(0, candles.length - (this.visibleCount ?? 80) / 2) : null;
    }
    this.#checkAlerts();
    if (oldAnchorTime !== null) {
      const nextAnchor = candles.findIndex((candle) => candle.time === oldAnchorTime);
      if (nextAnchor >= 0) this.viewStart = preserveViewFraction(nextAnchor, oldViewStart);
    }
    if (candles.length && this.pendingViewport && this.visibleCount) {
      this.viewStart = candles.length - 1 - this.pendingViewport.latestRatio * this.visibleCount;
      this.viewStart = Math.max(0, Math.min(this.viewStart, Math.max(0, candles.length - 1)));
      this.followLatest = this.pendingViewport.followLatest;
      this.pendingViewport = null;
    } else if (this.followLatest && this.visibleCount) this.viewStart = Math.max(0, candles.length - this.visibleCount * (this.centerLatest ? .5 : 1));
    this.#requestRender();
  }

  render() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const width = Math.max(180, Math.floor(rect.width));
    const height = Math.max(96, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const margins = { left: 12, right: 72, top: 18, bottom: 28 };
    const showVolume = this.volumeVisible && height >= 170;
    const plotWidth = width - margins.left - margins.right;
    const priceBottom = height - margins.bottom;
    const plotHeight = priceBottom - margins.top;
    const volumeHeight = showVolume ? Math.max(34, Math.round(plotHeight * 0.24)) : 0;
    const requested = this.meta?.targetCandles ?? this.candles.length;
    const defaultVisible = Math.max(20, Math.min(Math.floor(plotWidth / 2), requested, this.candles.length));
    if (!this.visibleCount && this.candles.length) this.visibleCount = defaultVisible;
    const pixelVisibleLimit = maximumVisibleCandles(plotWidth);
    this.visibleCount = Math.max(20, Math.min(1500, pixelVisibleLimit, this.visibleCount ?? 80));
    if (this.viewStart === null) this.viewStart = Math.max(0, this.candles.length - this.visibleCount * (this.centerLatest ? .5 : 1));
    this.viewStart = Math.max(0, Math.min(this.viewStart, Math.max(0, this.candles.length - 1)));
    const sliceStart = Math.max(0, Math.floor(this.viewStart));
    const sliceEnd = Math.min(this.candles.length, Math.ceil(this.viewStart + this.visibleCount));
    const visible = this.candles.slice(sliceStart, sliceEnd);

    this.#drawBackground(ctx, width, height);
    if (!visible.length) {
      ctx.fillStyle = this.theme.text;
      ctx.font = this.#font(11);
      ctx.textAlign = "center";
      ctx.fillText("Свечной график загружается…", margins.left + plotWidth / 2, margins.top + plotHeight / 2);
      return;
    }

    const displayCandles = visible;
    let rawMin = Infinity;
    let rawMax = -Infinity;
    let maxVolume = 1;
    for (const candle of displayCandles) {
      if (candle.low < rawMin) rawMin = candle.low;
      if (candle.high > rawMax) rawMax = candle.high;
      if (candle.volume > maxVolume) maxVolume = candle.volume;
    }
    const priceSpan = rawMax - rawMin || rawMax * 0.001 || 1;
    const centeredMarketPrice = this.followLatest && this.centerLatest && Number.isFinite(this.candles.at(-1)?.close)
      ? this.candles.at(-1).close
      : (rawMax + rawMin) / 2;
    const priceCenter = centeredMarketPrice + priceSpan * this.pricePan;
    const scaledSpan = priceSpan * 1.16 * this.priceScale;
    const autoMinPrice = priceCenter - scaledSpan / 2;
    const autoMaxPrice = priceCenter + scaledSpan / 2;
    const minPrice = this.fixedPriceDomain?.min ?? autoMinPrice;
    const maxPrice = this.fixedPriceDomain?.max ?? autoMaxPrice;
    // Never merge exchange candles into screen buckets. Bucket boundaries changed
    // after a one-pixel pan and made the same place appear to have different OHLC.
    // The zoom-out limit above guarantees a distinct screen slot for every candle.
    const step = plotWidth / this.visibleCount;
    const y = (price) => margins.top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight;
    const interactionLite = Boolean(
      this.wheelActive
      || (this.drag && (this.drag.type === "pan" || this.drag.type === "time" || this.drag.type === "price")),
    );

    this.#drawPriceGrid(ctx, width, margins, minPrice, maxPrice, y, plotHeight);
    if (!interactionLite) {
      this.#drawTimeGrid(ctx, margins, plotWidth, height);
      this.#drawSessionMarkers(ctx, margins, height);
    }

    if (showVolume) {
      const volumeAreaTop = priceBottom - volumeHeight;
      ctx.save();
      ctx.beginPath();
      ctx.rect(margins.left, volumeAreaTop, plotWidth, volumeHeight);
      ctx.clip();
      displayCandles.forEach((candle, sourceOffset) => {
        const globalIndex = sliceStart + sourceOffset;
        const x = margins.left + (candleCenterSlot(globalIndex) - this.viewStart) * step;
        const bodyWidth = Math.max(1, Math.min(8, step * 0.68));
        const up = candle.close >= candle.open;
        const volumeTop = priceBottom - (candle.volume / maxVolume) * volumeHeight;
        ctx.globalAlpha = up ? .18 : .13;
        ctx.fillStyle = up ? this.theme.bullFill : this.theme.bearStroke;
        ctx.shadowColor = up ? this.theme.bullStroke : this.theme.bearStroke;
        ctx.shadowBlur = 4;
        ctx.fillRect(x - bodyWidth / 2, volumeTop, bodyWidth, priceBottom - volumeTop);
      });
      ctx.restore();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(margins.left, margins.top, plotWidth, plotHeight);
    ctx.clip();
    displayCandles.forEach((candle, sourceOffset) => {
      const globalIndex = sliceStart + sourceOffset;
      const x = margins.left + (candleCenterSlot(globalIndex) - this.viewStart) * step;
      const bodyWidth = Math.max(1, Math.min(8, step * 0.68));
      const up = candle.close >= candle.open;
      const fill = this.theme.bearFill;
      const stroke = up ? this.theme.bullStroke : this.theme.bearStroke;
      ctx.strokeStyle = stroke;
      ctx.fillStyle = fill;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y(candle.high));
      ctx.lineTo(x, y(candle.low));
      ctx.stroke();
      const bodyTop = y(Math.max(candle.open, candle.close));
      const bodyBottom = y(Math.min(candle.open, candle.close));
      const bodyHeight = Math.max(1.5, bodyBottom - bodyTop);
      ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
      ctx.strokeRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);

    });
    ctx.restore();

    this.layout = { visible, margins, step, plotWidth, plotHeight, priceBottom, width, height, startIndex: this.viewStart, minPrice, maxPrice };
    const current = this.candles.at(-1);
    if (current) this.#drawLastPrice(ctx, width, margins, y(current.close), current.close, current.close >= current.open, margins.top, priceBottom);
    this.#drawAnnotations(ctx, !interactionLite);
    this.#drawDrawings(ctx);
    if (this.hoverX !== null && this.hoverY !== null) this.#drawCrosshair(ctx);
  }

  #drawBackground(ctx, width, height) {
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, width, height);
  }

  #drawPriceGrid(ctx, width, margins, minPrice, maxPrice, y, plotHeight) {
    const targetTicks = Math.max(3, Math.floor(plotHeight / 52));
    const step = nicePriceStep(maxPrice - minPrice, targetTicks);
    const first = Math.ceil(minPrice / step) * step;
    ctx.font = this.#font(9);
    ctx.textAlign = "left";
    for (let price = first, guard = 0; price <= maxPrice + step * .001 && guard < 40; price += step, guard += 1) {
      const lineY = y(price);
      ctx.strokeStyle = `${this.theme.grid}22`;
      ctx.beginPath();
      ctx.moveTo(margins.left, lineY);
      ctx.lineTo(width - margins.right, lineY);
      ctx.stroke();
      ctx.fillStyle = this.theme.text;
      ctx.fillText(formatAxisPrice(price, step), width - margins.right + 9, lineY + 3);
    }
  }

  #drawTimeGrid(ctx, margins, plotWidth, height) {
    const startTime = this.#timeAtIndex(this.viewStart);
    const endTime = this.#timeAtIndex(this.viewStart + this.visibleCount);
    const range = Math.max(1_000, endTime - startTime);
    const targetTicks = Math.max(2, Math.floor(plotWidth / 105));
    const tickStep = niceTimeTickStep(range, targetTicks);
    const firstTick = alignedTimeTick(startTime, tickStep, this.timeZone);
    ctx.font = this.#font(8);
    ctx.textAlign = "center";
    for (let tick = firstTick, guard = 0; tick <= endTime && guard < 60; tick += tickStep, guard += 1) {
      const globalIndex = this.#indexAtTime(tick);
      const x = margins.left + ((globalIndex - this.viewStart) / this.visibleCount) * plotWidth;
      if (x < margins.left - 1 || x > margins.left + plotWidth + 1) continue;
      ctx.strokeStyle = `${this.theme.grid}18`;
      ctx.beginPath();
      ctx.moveTo(x, margins.top);
      ctx.lineTo(x, height - margins.bottom);
      ctx.stroke();
      ctx.fillStyle = this.theme.text;
      ctx.fillText(formatAxisTime(tick, range, tickStep, this.timeZone), x, height - 9);
    }
  }

  #drawSessionMarkers(ctx, margins, height) {
    if (this.candles.length < 2) return;
    const start = Math.max(1, Math.floor(this.viewStart));
    const end = Math.min(this.candles.length - 1, Math.ceil(this.viewStart + this.visibleCount));
    for (let index = start; index <= end; index += 1) {
      const previous = this.candles[index - 1].time;
      const current = this.candles[index].time;
      const events = sessionEvents(previous, current, this.timeZone);
      for (const event of events) {
        if (event.label === "D" || !this.sessionsVisible) continue;
        const fraction = Math.max(0, Math.min(1, (event.time - previous) / Math.max(1, current - previous)));
        const x = margins.left + (index - 1 + fraction - this.viewStart + .5) * this.layoutStep(margins);
        ctx.save();
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = `${this.theme.session}55`;
        ctx.beginPath();
        ctx.moveTo(x, margins.top);
        ctx.lineTo(x, height - margins.bottom);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = this.theme.session;
        ctx.font = this.#font(7, true);
        ctx.textAlign = "center";
        ctx.fillText(event.label, x, height - margins.bottom + 9);
      }
    }
  }

  layoutStep(margins) {
    const width = this.canvas.getBoundingClientRect().width;
    return (width - margins.left - margins.right) / this.visibleCount;
  }

  #timeAtIndex(index) {
    if (!this.candles.length) return Date.now();
    const rounded = Math.round(index);
    if (this.candles[rounded]) return this.candles[rounded].time;
    const interval = INTERVAL_MS[this.meta?.interval] ?? 60_000;
    if (rounded < 0) return this.candles[0].time + rounded * interval;
    return this.candles.at(-1).time + (rounded - this.candles.length + 1) * interval;
  }

  #indexAtTime(timestamp) {
    if (!this.candles.length) return 0;
    const interval = INTERVAL_MS[this.meta?.interval] ?? 60_000;
    if (timestamp <= this.candles[0].time) return (timestamp - this.candles[0].time) / interval;
    if (timestamp >= this.candles.at(-1).time) return this.candles.length - 1 + (timestamp - this.candles.at(-1).time) / interval;
    let low = 0;
    let high = this.candles.length - 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (this.candles[middle].time <= timestamp) low = middle;
      else high = middle;
    }
    const span = Math.max(1, this.candles[high].time - this.candles[low].time);
    return low + (timestamp - this.candles[low].time) / span;
  }

  #drawLastPrice(ctx, width, margins, lineY, price, up, top, bottom) {
    const color = up ? this.theme.bullFill : this.theme.bearFill;
    const visibleY = Math.max(top + 9, Math.min(bottom - 9, lineY));
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = up ? this.theme.bullStroke : this.theme.bearStroke;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    if (lineY >= top && lineY <= bottom) {
      ctx.moveTo(margins.left, lineY);
      ctx.lineTo(width - margins.right, lineY);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = color;
    ctx.fillRect(width - margins.right, visibleY - 9, margins.right, 18);
    if (!up) {
      ctx.strokeStyle = this.theme.bearStroke;
      ctx.strokeRect(width - margins.right + .5, visibleY - 8.5, margins.right - 1, 17);
    }
    ctx.fillStyle = up ? this.theme.bearFill : this.theme.bullFill;
    ctx.font = this.#font(9, true);
    ctx.textAlign = "center";
    ctx.fillText(formatChartPrice(price), width - margins.right / 2, visibleY + 3);
  }

  #pointAt(x, y, snap = false) {
    if (!this.layout) return null;
    const { margins, plotWidth, plotHeight, priceBottom, minPrice, maxPrice } = this.layout;
    const safeX = Math.max(margins.left, Math.min(x, margins.left + plotWidth));
    const safeY = Math.max(margins.top, Math.min(y, priceBottom));
    const slot = this.viewStart + ((safeX - margins.left) / plotWidth) * this.visibleCount;
    const price = maxPrice - ((safeY - margins.top) / plotHeight) * (maxPrice - minPrice);
    if (snap && this.candles.length) {
      return snapPointToCandle(this.candles, slot, price);
    }
    return { time: this.#timeAtIndex(slot), price };
  }

  #screenPoint(point) {
    const { margins, plotWidth, plotHeight, minPrice, maxPrice } = this.layout;
    const index = this.#indexAtTime(point.time);
    return {
      // Candle timestamps describe the start of a slot, while candles are drawn
      // at its centre. Keeping the same half-slot offset makes Ctrl-snapped
      // anchors sit exactly on the visible OHLC candle instead of between bars.
      x: margins.left + ((candleCenterSlot(index) - this.viewStart) / this.visibleCount) * plotWidth,
      y: margins.top + ((maxPrice - point.price) / (maxPrice - minPrice)) * plotHeight,
    };
  }

  #commitDrawing(drawing) {
    const committed = {
      ...drawing,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ...(drawing.type === "alert" ? { triggered: false, referencePrice: this.candles.at(-1)?.close ?? drawing.a.price } : {}),
    };
    this.drawings.push(committed);
    this.undoStack.push({ type: "add", drawing: committed });
    this.draftDrawing = null;
    this.drawingGesture = null;
    this.drawingSnap = false;
    this.activeTool = null;
    this.onToolChange?.(null);
    this.#persistDrawings();
    this.#requestRender();
  }

  #checkAlerts() {
    const current = this.candles.at(-1)?.close;
    if (!Number.isFinite(current)) return;
    let changed = false;
    for (const alert of this.drawings.filter((item) => item.type === "alert" && !item.triggered)) {
      const previous = Number(alert.referencePrice);
      const target = Number(alert.a?.price);
      if (Number.isFinite(previous) && Number.isFinite(target) && previous !== current && (previous - target) * (current - target) <= 0) {
        alert.triggered = true;
        changed = true;
        this.onAlert?.({ symbol: this.meta?.symbol ?? "", price: target });
      }
      alert.referencePrice = current;
    }
    if (changed) this.#persistDrawings();
  }


  #drawAnnotations(ctx, showLabels = true) {
    if (!this.layout || !this.annotations.length) return;
    const { margins, plotWidth, plotHeight, priceBottom, minPrice, maxPrice } = this.layout;
    const tones = {
      accent: "#7c83ff",
      blue: "#70b7ff",
      warning: "#f1bf62",
      danger: "#f27d86",
      success: "#5fe0a7",
      muted: "#8fa8ba",
    };
    const viewStartTime = this.#timeAtIndex(this.viewStart - 1);
    const viewEndTime = this.#timeAtIndex(this.viewStart + this.visibleCount + 1);
    const xForTime = (time) => {
      const index = this.#indexAtTime(Number(time));
      return margins.left + ((candleCenterSlot(index) - this.viewStart) / this.visibleCount) * plotWidth;
    };
    const yForPrice = (price) => margins.top
      + ((maxPrice - Number(price)) / (maxPrice - minPrice)) * plotHeight;
    const colorFor = (annotation) => tones[annotation?.tone] ?? tones.accent;
    const inTime = (time) => {
      const value = Number(time);
      return Number.isFinite(value) && value >= viewStartTime && value <= viewEndTime;
    };
    const spansTime = (startAt, endAt) => {
      const spanStart = Number(startAt);
      const spanEnd = Number(endAt);
      if (!Number.isFinite(spanStart) || !Number.isFinite(spanEnd)) return false;
      return Math.max(spanStart, spanEnd) >= viewStartTime && Math.min(spanStart, spanEnd) <= viewEndTime;
    };
    const inPrice = (price) => {
      const value = Number(price);
      return Number.isFinite(value) && value >= minPrice && value <= maxPrice;
    };
    const occupiedLabels = [];
    let labelCount = 0;
    const label = (text, x, y, color) => {
      if (!showLabels || !text || labelCount >= 56 || !Number.isFinite(x) || !Number.isFinite(y)) return;
      ctx.save();
      ctx.font = this.#font(8, true);
      const width = Math.min(190, ctx.measureText(String(text)).width + 10);
      const left = Math.max(margins.left, Math.min(margins.left + plotWidth - width, x));
      const top = Math.max(margins.top, Math.min(priceBottom - 17, y - 16));
      const box = { left, right: left + width, top, bottom: top + 15 };
      const overlaps = occupiedLabels.some((item) => !(
        box.right + 3 < item.left
        || box.left - 3 > item.right
        || box.bottom + 2 < item.top
        || box.top - 2 > item.bottom
      ));
      if (overlaps) {
        ctx.restore();
        return;
      }
      occupiedLabels.push(box);
      labelCount += 1;
      ctx.fillStyle = "rgba(6, 11, 16, .88)";
      ctx.fillRect(left, top, width, 15);
      ctx.strokeStyle = `${color}99`;
      ctx.strokeRect(left + .5, top + .5, width - 1, 14);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.fillText(String(text).slice(0, 42), left + 5, top + 11);
      ctx.restore();
    };

    const visibleZones = [];
    for (const annotation of this.annotationBuckets.zone) {
      const low = Math.min(Number(annotation.low), Number(annotation.high));
      const high = Math.max(Number(annotation.low), Number(annotation.high));
      if (spansTime(annotation.startAt, annotation.endAt) && high >= minPrice && low <= maxPrice) visibleZones.push(annotation);
    }
    const visibleLines = [];
    for (const annotation of this.annotationBuckets.line) {
      if (inPrice(annotation.price) && spansTime(annotation.startAt, annotation.endAt)) visibleLines.push(annotation);
    }
    const visibleRays = [];
    for (const annotation of this.annotationBuckets.ray) {
      const startAt = Number(annotation.startAt);
      if (Number.isFinite(startAt) && startAt <= viewEndTime && inPrice(annotation.price)) visibleRays.push(annotation);
    }
    const visibleSegments = [];
    for (const annotation of this.annotationBuckets.segment) {
      if (!annotation.a || !annotation.b) continue;
      const a = this.#screenPoint(annotation.a);
      const b = this.#screenPoint(annotation.b);
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
      if (Math.max(a.x, b.x) < margins.left || Math.min(a.x, b.x) > margins.left + plotWidth) continue;
      if (Math.max(a.y, b.y) < margins.top || Math.min(a.y, b.y) > priceBottom) continue;
      visibleSegments.push({ annotation, a, b });
    }
    const visibleEvents = [];
    for (const annotation of this.annotationBuckets.event) {
      if (inTime(annotation.time)) visibleEvents.push(annotation);
    }
    const visiblePoints = [];
    for (const annotation of this.annotationBuckets.point) {
      if (!inTime(annotation.time) || !inPrice(annotation.price)) continue;
      const point = this.#screenPoint({ time: annotation.time, price: annotation.price });
      if ([point.x, point.y].every(Number.isFinite)) visiblePoints.push({ annotation, point });
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(margins.left, margins.top, plotWidth, plotHeight);
    ctx.clip();

    for (const annotation of visibleZones) {
      const x1 = xForTime(annotation.startAt);
      const x2 = xForTime(annotation.endAt);
      const y1 = yForPrice(annotation.high);
      const y2 = yForPrice(annotation.low);
      const color = colorFor(annotation);
      ctx.fillStyle = `${color}18`;
      ctx.strokeStyle = `${color}88`;
      ctx.setLineDash([5, 4]);
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.max(2, Math.abs(y2 - y1)));
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.max(2, Math.abs(y2 - y1)));
      ctx.setLineDash([]);
    }

    for (const annotation of visibleLines) {
      const y = yForPrice(annotation.price);
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xForTime(annotation.startAt), y);
      ctx.lineTo(xForTime(annotation.endAt), y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const annotation of visibleRays) {
      const y = yForPrice(annotation.price);
      const originX = xForTime(annotation.startAt);
      const startX = Math.max(margins.left, originX);
      const endX = margins.left + plotWidth;
      if (startX > endX) continue;
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.setLineDash(annotation.state === "BROKEN" ? [3, 5] : [7, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      if (originX >= margins.left && originX <= endX) {
        ctx.fillStyle = "#071018";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(originX, y, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    for (const item of visibleSegments) {
      const color = colorFor(item.annotation);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(item.a.x, item.a.y);
      ctx.lineTo(item.b.x, item.b.y);
      ctx.stroke();
    }

    for (const annotation of visibleEvents) {
      const x = xForTime(annotation.time);
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, margins.top);
      ctx.lineTo(x, priceBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const item of visiblePoints) {
      const color = colorFor(item.annotation);
      ctx.fillStyle = "#071018";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(item.point.x, item.point.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    if (!showLabels) return;
    for (const annotation of visibleZones) {
      label(annotation.label, xForTime(annotation.startAt) + 4, yForPrice(annotation.high), colorFor(annotation));
    }
    for (const annotation of visibleLines) {
      label(annotation.label, xForTime(annotation.endAt) - 110, yForPrice(annotation.price), colorFor(annotation));
    }
    for (const annotation of visibleRays) {
      const originX = xForTime(annotation.startAt);
      label(annotation.label, Math.max(margins.left + 4, originX + 6), yForPrice(annotation.price), colorFor(annotation));
    }
    for (const item of visibleSegments) {
      label(item.annotation.label, (item.a.x + item.b.x) / 2, (item.a.y + item.b.y) / 2, colorFor(item.annotation));
    }
    for (const annotation of visibleEvents) {
      label(annotation.label, xForTime(annotation.time) + 5, margins.top + 17, colorFor(annotation));
    }
    for (const item of visiblePoints) {
      label(item.annotation.label, item.point.x + 6, item.point.y, colorFor(item.annotation));
    }
  }

  #drawDrawings(ctx) {
    if (!this.layout) return;
    const { margins, plotWidth, plotHeight, priceBottom, width } = this.layout;
    const items = this.draftDrawing ? [...this.drawings, this.draftDrawing] : this.drawings;
    ctx.save();
    ctx.beginPath();
    ctx.rect(margins.left, margins.top, plotWidth, plotHeight);
    ctx.clip();
    ctx.strokeStyle = this.theme.session;
    ctx.fillStyle = `${this.theme.session}22`;
    ctx.lineWidth = 1.35;
    ctx.setLineDash([]);
    for (const drawing of items) {
      const a = this.#screenPoint(drawing.a);
      const b = drawing.b ? this.#screenPoint(drawing.b) : a;
      ctx.beginPath();
      if (drawing.type === "trend" || drawing.type === "ruler") {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if (drawing.type === "horizontal" || drawing.type === "alert") {
        if (drawing.type === "alert") {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = drawing.triggered ? "#ff9f5c" : this.theme.session;
        }
        ctx.moveTo(margins.left, a.y);
        ctx.lineTo(margins.left + plotWidth, a.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = this.theme.session;
      } else if (drawing.type === "ray") {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(margins.left + plotWidth, a.y);
        ctx.stroke();
      } else if (drawing.type === "rectangle") {
        const left = Math.min(a.x, b.x);
        const top = Math.min(a.y, b.y);
        const rectWidth = Math.abs(b.x - a.x);
        const rectHeight = Math.abs(b.y - a.y);
        ctx.fillRect(left, top, rectWidth, rectHeight);
        ctx.strokeRect(left, top, rectWidth, rectHeight);
      } else if (drawing.type === "freehand" && drawing.points?.length > 1) {
        const first = this.#screenPoint(drawing.points[0]);
        ctx.moveTo(first.x, first.y);
        for (const point of drawing.points.slice(1)) {
          const screen = this.#screenPoint(point);
          ctx.lineTo(screen.x, screen.y);
        }
        ctx.stroke();
      }
      if (drawing.type === "ruler" && drawing.b && drawing.a.price) {
        const percent = drawingPercentChange(drawing.a.price, drawing.b.price);
        const text = `${percent >= 0 ? "+" : ""}${percent.toFixed(Math.abs(percent) >= 10 ? 1 : 2)}%`;
        const x = (a.x + b.x) / 2;
        const y = (a.y + b.y) / 2;
        ctx.font = this.#font(9, true);
        const textWidth = ctx.measureText(text).width + 10;
        ctx.fillStyle = this.theme.crosshairFill;
        ctx.fillRect(x - textWidth / 2, y - 16, textWidth, 15);
        ctx.fillStyle = this.theme.crosshairText;
        ctx.textAlign = "center";
        ctx.fillText(text, x, y - 5);
        ctx.fillStyle = `${this.theme.session}22`;
      }
    }
    ctx.restore();

    for (const alert of items.filter((item) => item.type === "alert")) {
      const point = this.#screenPoint(alert.a);
      const labelY = Math.max(margins.top + 8, Math.min(priceBottom - 8, point.y));
      const fill = alert.triggered ? "#ff9f5c" : this.theme.session;
      ctx.fillStyle = fill;
      ctx.fillRect(width - margins.right, labelY - 8, margins.right, 16);
      ctx.fillStyle = this.theme.crosshairText;
      ctx.font = this.#font(8, true);
      ctx.textAlign = "center";
      ctx.fillText(`! ${formatChartPrice(alert.a.price)}`, width - margins.right / 2, labelY + 3);
    }

    const rays = items.filter((item) => item.type === "ray").map((item) => ({ item, y: this.#screenPoint(item.a).y }));
    for (const ray of rays) {
      if (ray.y < margins.top || ray.y > priceBottom) continue;
      const crowd = rays.filter((other) => Math.abs(other.y - ray.y) < 13).length;
      const fontSize = Math.max(6, 9 - Math.max(0, crowd - 1));
      const label = formatChartPrice(ray.item.a.price);
      ctx.font = this.#font(fontSize, true);
      ctx.textAlign = "center";
      ctx.fillStyle = this.theme.crosshairFill;
      ctx.fillRect(width - margins.right, ray.y - 7, margins.right, 14);
      ctx.fillStyle = this.theme.crosshairText;
      ctx.fillText(label, width - margins.right / 2, ray.y + fontSize / 3);
    }
  }

  #distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
  }

  #drawingDistance(drawing, point) {
    const a = this.#screenPoint(drawing.a);
    const b = drawing.b ? this.#screenPoint(drawing.b) : a;
    if (drawing.type === "horizontal" || drawing.type === "alert") return Math.abs(point.y - a.y);
    if (drawing.type === "ray") return point.x >= a.x ? Math.abs(point.y - a.y) : Math.hypot(point.x - a.x, point.y - a.y);
    if (drawing.type === "trend" || drawing.type === "ruler") return this.#distanceToSegment(point, a, b);
    if (drawing.type === "rectangle") {
      if (point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return 0;
      const corners = [{ x: a.x, y: b.y }, { x: b.x, y: a.y }];
      return Math.min(
        this.#distanceToSegment(point, a, corners[0]),
        this.#distanceToSegment(point, corners[0], b),
        this.#distanceToSegment(point, b, corners[1]),
        this.#distanceToSegment(point, corners[1], a),
      );
    }
    if (drawing.type === "freehand") {
      const points = drawing.points?.map((item) => this.#screenPoint(item)) ?? [];
      let distance = Infinity;
      for (let index = 1; index < points.length; index += 1) distance = Math.min(distance, this.#distanceToSegment(point, points[index - 1], points[index]));
      return distance;
    }
    return Infinity;
  }

  #drawingAt(point, maximum = 10) {
    let best = null;
    for (let index = this.drawings.length - 1; index >= 0; index -= 1) {
      const drawing = this.drawings[index];
      const distance = this.#drawingDistance(drawing, point);
      if (distance <= maximum && (!best || distance < best.distance)) best = { drawing, distance };
    }
    return best?.drawing ?? null;
  }

  #drawingHandleAt(drawing, point, maximum = 7) {
    if (!drawing || drawing.type === "freehand") return null;
    const a = this.#screenPoint(drawing.a);
    if (Math.hypot(point.x - a.x, point.y - a.y) <= maximum) return "a";
    if (drawing.b) {
      const b = this.#screenPoint(drawing.b);
      if (Math.hypot(point.x - b.x, point.y - b.y) <= maximum) return "b";
    }
    return null;
  }

  #moveDrawing(drawing, original, startPoint, nextPoint) {
    const deltaTime = nextPoint.time - startPoint.time;
    const deltaPrice = nextPoint.price - startPoint.price;
    const movePoint = (point) => ({ ...point, time: point.time + deltaTime, price: point.price + deltaPrice });
    if (drawing.type === "horizontal" || drawing.type === "alert") drawing.a = { ...original.a, price: original.a.price + deltaPrice };
    else {
      drawing.a = movePoint(original.a);
      if (original.b) drawing.b = movePoint(original.b);
      if (original.points) drawing.points = original.points.map(movePoint);
    }
    if (drawing.type === "alert") {
      drawing.triggered = false;
      drawing.referencePrice = this.candles.at(-1)?.close ?? drawing.a.price;
    }
  }

  #lockPriceDomain() {
    if (this.fixedPriceDomain || !this.layout) return;
    this.fixedPriceDomain = { min: this.layout.minPrice, max: this.layout.maxPrice };
  }

  #handleContextMenu(event) {
    event.preventDefault();
    this.draftDrawing = null;
    if (!this.layout || !this.drawings.length) {
      this.render();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    let best = { index: -1, distance: 9 };
    this.drawings.forEach((drawing, index) => {
      const distance = this.#drawingDistance(drawing, point);
      if (distance < best.distance) best = { index, distance };
    });
    if (best.index >= 0) {
      const [drawing] = this.drawings.splice(best.index, 1);
      this.undoStack.push({ type: "delete", drawing, index: best.index });
      this.#persistDrawings();
    }
    this.render();
  }

  #handlePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (this.drawingGesture?.type === "freehand") {
      const point = this.#pointAt(x, y, this.#shouldSnap(event) || this.drawingSnap);
      if (point) this.drawingGesture.drawing.points.push(point);
      this.#requestRender();
      return;
    }
    if (this.activeTool && this.draftDrawing) {
      const point = this.#pointAt(x, y, this.#shouldSnap(event) || this.drawingSnap);
      if (point) this.draftDrawing.b = point;
      this.hoverX = x;
      this.hoverY = y;
      this.#requestRender();
      return;
    }
    if (this.drag?.type === "price") {
      const deltaY = y - this.drag.startY;
      const factor = scaleFromDrag(1, deltaY);
      const center = (this.drag.startDomain.min + this.drag.startDomain.max) / 2;
      const span = (this.drag.startDomain.max - this.drag.startDomain.min) * factor;
      this.fixedPriceDomain = { min: center - span / 2, max: center + span / 2 };
      this.tooltip.hidden = true;
      this.#requestRender();
      return;
    }
    if (this.drag?.type === "drawing" || this.drag?.type === "drawing-handle") {
      const point = this.#pointAt(x, y, this.#shouldSnap(event));
      if (point) {
        if (this.drag.type === "drawing-handle") {
          if ((this.drag.drawing.type === "horizontal" || this.drag.drawing.type === "alert") && this.drag.handle === "a") this.drag.drawing.a = { ...this.drag.drawing.a, price: point.price };
          else this.drag.drawing[this.drag.handle] = point;
          if (this.drag.drawing.type === "alert") {
            this.drag.drawing.triggered = false;
            this.drag.drawing.referencePrice = this.candles.at(-1)?.close ?? point.price;
          }
        } else this.#moveDrawing(this.drag.drawing, this.drag.before, this.drag.startPoint, point);
        this.drag.moved = true;
      }
      this.tooltip.hidden = true;
      this.#requestRender();
      return;
    }
    if (this.drag?.type === "time") {
      const deltaX = x - this.drag.startX;
      const nextCount = Math.min(maximumVisibleCandles(this.layout.plotWidth), visibleCountFromDrag(this.drag.startCount, deltaX, this.candles.length));
      this.visibleCount = nextCount;
      this.viewStart = Math.max(0, Math.min(this.drag.endIndex - nextCount, Math.max(0, this.candles.length - 1)));
      this.followLatest = false;
      this.tooltip.hidden = true;
      this.#requestRender();
      return;
    }
    if (this.drag?.type === "pan") {
      const deltaX = x - this.drag.startX;
      const deltaY = y - this.drag.startY;
      const candleShift = deltaX / Math.max(this.drag.step, 1);
      this.viewStart = Math.max(0, Math.min(this.drag.startView - candleShift, Math.max(0, this.candles.length - 1)));
      const shift = (deltaY / Math.max(this.drag.plotHeight, 1)) * (this.drag.startDomain.max - this.drag.startDomain.min);
      this.fixedPriceDomain = { min: this.drag.startDomain.min + shift, max: this.drag.startDomain.max + shift };
      this.followLatest = false;
      this.tooltip.hidden = true;
      this.#requestRender();
      return;
    }
    const axis = this.#axisAt(x, y);
    const nearDrawing = !axis && this.#drawingAt({ x, y });
    this.canvas.style.cursor = axis === "price" ? "ns-resize" : axis === "time" ? "ew-resize" : nearDrawing ? "move" : "crosshair";
    this.hoverX = axis ? null : x;
    this.hoverY = axis ? null : y;
    this.#requestRender();
  }

  #axisAt(x, y) {
    if (!this.layout) return null;
    if (x >= this.layout.width - this.layout.margins.right) return "price";
    if (y >= this.layout.height - this.layout.margins.bottom) return "time";
    return null;
  }

  #handlePointerDown(event) {
    if (!this.layout) return;
    if (event.button === 2) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const axis = this.#axisAt(x, y);
    CandlestickChart.activeChart = this;
    if (this.activeTool && !axis) {
      event.preventDefault();
      const snap = this.#shouldSnap(event) || this.drawingSnap;
      const point = this.#pointAt(x, y, snap);
      if (!point) return;
      if (this.activeTool === "horizontal" || this.activeTool === "ray" || this.activeTool === "alert") {
        this.#commitDrawing({ type: this.activeTool, a: point });
      } else if (this.activeTool === "freehand") {
        this.drawingSnap = snap;
        this.canvas.setPointerCapture(event.pointerId);
        const drawing = { type: "freehand", a: point, points: [point] };
        this.drawingGesture = { type: "freehand", drawing };
        this.draftDrawing = drawing;
      } else if (!this.draftDrawing) {
        this.drawingSnap = snap;
        this.draftDrawing = { type: this.activeTool, a: point, b: point };
      } else {
        this.draftDrawing.b = point;
        this.#commitDrawing(this.draftDrawing);
      }
      this.tooltip.hidden = true;
      this.#requestRender();
      return;
    }
    const drawing = !axis ? this.#drawingAt({ x, y }) : null;
    const drawingHandle = drawing ? this.#drawingHandleAt(drawing, { x, y }) : null;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.hoverX = null;
    this.tooltip.hidden = true;
    if (!drawing) this.#lockPriceDomain();
    this.drag = drawing
      ? {
          type: drawingHandle ? "drawing-handle" : "drawing",
          drawing,
          handle: drawingHandle,
          before: structuredClone(drawing),
          startPoint: this.#pointAt(x, y, false),
          moved: false,
        }
      : axis === "price"
      ? { type: "price", startY: y, startDomain: { ...this.fixedPriceDomain } }
      : axis === "time"
        ? { type: "time", startX: x, startCount: this.visibleCount, endIndex: this.viewStart + this.visibleCount }
        : { type: "pan", startX: x, startY: y, startView: this.viewStart, startDomain: { ...this.fixedPriceDomain }, step: this.layout.step, plotHeight: this.layout.plotHeight };
    this.canvas.style.cursor = axis === "price" ? "ns-resize" : axis === "time" ? "ew-resize" : drawing ? "move" : "grabbing";
  }

  #handlePointerUp(event) {
    if (this.drawingGesture?.type === "freehand") {
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      const drawing = this.drawingGesture.drawing;
      if (drawing.points.length > 1) this.#commitDrawing(drawing);
      else {
        this.draftDrawing = null;
        this.drawingGesture = null;
        this.setTool(null);
      }
      return;
    }
    if (!this.drag) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if ((this.drag.type === "drawing" || this.drag.type === "drawing-handle") && this.drag.moved) {
      this.undoStack.push({ type: "move", before: this.drag.before, after: structuredClone(this.drag.drawing) });
      this.#persistDrawings();
    }
    this.#persistViewport();
    this.drag = null;
    this.canvas.style.cursor = "crosshair";
    this.#requestRender();
  }

  #handleWheel(event) {
    event.preventDefault();
    if (!this.layout || this.candles.length < 2) return;
    const rect = this.canvas.getBoundingClientRect();
    this.wheelActive = true;
    clearTimeout(this.wheelIdleTimer);
    this.wheelIdleTimer = setTimeout(() => {
      this.wheelIdleTimer = null;
      this.wheelActive = false;
      this.#requestRender();
    }, 140);
    this.#lockPriceDomain();
    const x = Math.max(this.layout.margins.left, Math.min(event.clientX - rect.left, this.layout.margins.left + this.layout.plotWidth));
    const anchorRatio = (x - this.layout.margins.left) / this.layout.plotWidth;
    const anchorIndex = this.layout.startIndex + anchorRatio * this.visibleCount;
    const factor = event.deltaY < 0 ? 0.78 : 1.28;
    const nextCount = Math.round(Math.max(20, Math.min(1500, maximumVisibleCandles(this.layout.plotWidth), this.visibleCount * factor)));
    this.visibleCount = nextCount;
    this.viewStart = Math.round(anchorIndex - anchorRatio * nextCount);
    this.viewStart = Math.max(0, Math.min(this.viewStart, Math.max(0, this.candles.length - 1)));
    this.followLatest = false;
    this.tooltip.hidden = true;
    this.#scheduleViewportPersist();
    this.#requestRender();
  }

  #drawCrosshair(ctx) {
    if (!this.layout) return;
    const { margins, plotWidth, plotHeight, priceBottom, width, height, minPrice, maxPrice } = this.layout;
    const x = Math.max(margins.left, Math.min(this.hoverX, margins.left + plotWidth));
    const y = Math.max(margins.top, Math.min(this.hoverY, priceBottom));
    const slot = this.viewStart + ((x - margins.left) / plotWidth) * this.visibleCount;
    const price = maxPrice - ((y - margins.top) / plotHeight) * (maxPrice - minPrice);
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = `${this.theme.crosshair}66`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(width - margins.right, y);
    ctx.moveTo(x, y);
    ctx.lineTo(x, height - margins.bottom);
    ctx.stroke();
    ctx.restore();
    this.tooltip.hidden = true;
    ctx.fillStyle = this.theme.crosshairFill;
    ctx.fillRect(width - margins.right, y - 8, margins.right, 16);
    ctx.fillRect(x - 36, height - margins.bottom, 72, margins.bottom);
    ctx.fillStyle = this.theme.crosshairText;
    ctx.font = this.#font(8, true);
    ctx.textAlign = "center";
    ctx.fillText(formatChartPrice(price), width - margins.right / 2, y + 3);
    ctx.fillText(formatTime(this.#timeAtIndex(slot), true, this.timeZone), x, height - 9);
  }
}

function isValidCandle(candle) {
  return candle && [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite);
}

function tradeToCandle(trade, bucketMs) {
  const price = Number(trade?.p);
  const volume = Number(trade?.q);
  const timestamp = Number(trade?.T ?? trade?.E);
  if (![price, volume, timestamp].every(Number.isFinite)) return null;
  const time = Math.floor(timestamp / bucketMs) * bucketMs;
  return { time, open: price, high: price, low: price, close: price, volume, closeTime: time + bucketMs - 1, closed: false };
}

function aggregateTrades(rows, bucketMs) {
  const candles = [];
  for (const trade of rows) {
    const next = tradeToCandle(trade, bucketMs);
    if (!next) continue;
    const last = candles.at(-1);
    if (last?.time === next.time) {
      last.high = Math.max(last.high, next.high);
      last.low = Math.min(last.low, next.low);
      last.close = next.close;
      last.volume += next.volume;
    } else candles.push(next);
  }
  return candles;
}

export function aggregateCandles(candles, bucketMs) {
  const result = [];
  for (const candle of candles) {
    if (!isValidCandle(candle)) continue;
    const time = Math.floor(candle.time / bucketMs) * bucketMs;
    const last = result.at(-1);
    if (last?.time === time) {
      last.high = Math.max(last.high, candle.high);
      last.low = Math.min(last.low, candle.low);
      last.close = candle.close;
      last.volume += candle.volume;
      last.closeTime = Math.max(last.closeTime, candle.closeTime);
      last.closed &&= candle.closed;
    } else {
      result.push({ ...candle, time, closeTime: time + bucketMs - 1 });
    }
  }
  return result;
}

function mergeCandles(primary, secondary) {
  const byTime = new Map();
  for (const candle of [...primary, ...secondary]) {
    if (isValidCandle(candle)) byTime.set(candle.time, candle);
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

const zoneOffsetFormatters = new Map();

function alignedTimeTick(timestamp, step, timeZone) {
  if (!timeZone || step < 60_000) return Math.ceil(timestamp / step) * step;
  if (!zoneOffsetFormatters.has(timeZone)) {
    zoneOffsetFormatters.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }));
  }
  const values = {};
  for (const part of zoneOffsetFormatters.get(timeZone).formatToParts(new Date(timestamp))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const roundedTimestamp = Math.floor(timestamp / 60_000) * 60_000;
  const representedAsUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute);
  const offset = representedAsUtc - roundedTimestamp;
  return Math.ceil((timestamp + offset) / step) * step - offset;
}

export function sessionEvents(previous, current) {
  const events = [];
  const dayMs = 86_400_000;
  const firstDay = Math.floor(previous / dayMs) * dayMs;
  for (let day = firstDay; day <= current; day += dayMs) {
    const asia = day;
    const usa = day + 13.5 * 3_600_000;
    if (previous < asia && asia <= current) events.push({ label: "Asia", time: asia });
    if (previous < usa && usa <= current) events.push({ label: "USA", time: usa });
  }
  return events.sort((a, b) => a.time - b.time);
}

export function sessionLabels(previous, current, timeZone = "UTC") {
  return sessionEvents(previous, current, timeZone).map((event) => event.label);
}

function formatTime(timestamp, withDate = false, timeZone) {
  return new Intl.DateTimeFormat("ru-RU", {
    ...(timeZone ? { timeZone } : {}),
    ...(withDate ? { day: "2-digit", month: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatAxisTime(timestamp, rangeMs, tickStep, timeZone) {
  const options = timeZone ? { timeZone } : {};
  if (tickStep < 60_000) return new Intl.DateTimeFormat("ru-RU", { ...options, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(timestamp));
  if (rangeMs <= 3 * 86_400_000) return new Intl.DateTimeFormat("ru-RU", { ...options, hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  if (rangeMs <= 120 * 86_400_000) return new Intl.DateTimeFormat("ru-RU", { ...options, day: "2-digit", month: "short" }).format(new Date(timestamp)).replace(".", "");
  return new Intl.DateTimeFormat("ru-RU", { ...options, month: "short", year: "2-digit" }).format(new Date(timestamp)).replace(".", "");
}

function formatAxisPrice(value, step) {
  const exponent = Math.floor(Math.log10(Math.abs(step) || 1));
  const normalized = step / (10 ** exponent);
  const decimals = Math.min(10, Math.max(0, -exponent + (Math.abs(normalized - 2.5) < .001 ? 1 : 0)));
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatChartPrice(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(value >= 100 ? 2 : 4);
  if (value >= 0.01) return value.toFixed(5);
  return value.toPrecision(5);
}
