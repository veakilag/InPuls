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

export function scaleFromDrag(initialScale, delta, sensitivity = 120) {
  return Math.max(.15, Math.min(8, initialScale * Math.exp(delta / sensitivity)));
}

export function visibleCountFromDrag(initialCount, delta, total) {
  return Math.round(Math.max(Math.min(20, total), Math.min(total, initialCount * Math.exp(delta / 180))));
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

export function compactCandles(candles, maxBars) {
  if (!Array.isArray(candles) || !candles.length) return [];
  const safeMax = Math.max(1, Math.floor(Number(maxBars) || 1));
  const groupSize = Math.max(1, Math.ceil(candles.length / safeMax));
  const result = [];
  for (let start = 0; start < candles.length; start += groupSize) {
    const group = candles.slice(start, start + groupSize);
    const first = group[0];
    const last = group.at(-1);
    result.push({
      time: first.time,
      open: first.open,
      high: Math.max(...group.map((item) => item.high)),
      low: Math.min(...group.map((item) => item.low)),
      close: last.close,
      volume: group.reduce((sum, item) => sum + item.volume, 0),
      closeTime: last.closeTime,
      closed: group.every((item) => item.closed),
      sourceOffset: start + (group.length - 1) / 2,
      sourceSize: group.length,
    });
  }
  return result;
}

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
  }

  async select(symbol, interval = "1m", range = "1h") {
    if (symbol === this.symbol && interval === this.interval && range === this.range && this.socket) return;
    if (this.symbol && this.interval && this.candles.length) {
      this.seriesCache.set(`${this.symbol}:${this.interval}`, this.candles.slice(-1500));
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
        loadedCandles = await this.#fetchSecondCandles(symbol, INTERVAL_MS[interval], Math.min(1500, targetCandles), generation);
      } else {
        const query = new URLSearchParams({ symbol, interval, limit: "1500" });
        const response = await fetch(`${KLINES_REST}?${query}`, { signal: this.abortController.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rows = await response.json();
        loadedCandles = rows.map(parseRestKline).filter(isValidCandle);
      }
      if (generation !== this.generation) return;
      this.candles = mergeCandles(loadedCandles, this.candles).slice(-1500);
      this.seriesCache.set(cacheKey, this.candles.slice());
      this.onData(this.candles, { symbol, interval, range, targetCandles });
    } catch (error) {
      if (error.name !== "AbortError" && generation === this.generation) {
        this.onStatus({ state: "warning", text: "История недоступна — собираю новые свечи" });
      }
    }

    if (generation === this.generation) this.#connect(generation);
  }

  async #fetchSecondCandles(symbol, bucketMs, desiredCandles, generation) {
    try {
      const secondsNeeded = Math.min(15_000, Math.max(60, Math.ceil((desiredCandles * bucketMs) / 1000)));
      const rawSeconds = [];
      let endTime;
      for (let page = 0; page < 10 && rawSeconds.length < secondsNeeded && generation === this.generation; page += 1) {
        const limit = Math.min(1500, secondsNeeded - rawSeconds.length);
        const query = new URLSearchParams({ symbol, interval: "1s", limit: String(limit) });
        if (Number.isFinite(endTime)) query.set("endTime", String(endTime));
        const response = await fetch(`${KLINES_REST}?${query}`, { signal: this.abortController.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rows = await response.json();
        const pageCandles = rows.map(parseRestKline).filter(isValidCandle);
        if (!pageCandles.length) break;
        rawSeconds.unshift(...pageCandles);
        const nextEnd = pageCandles[0].time - 1;
        if (nextEnd === endTime) break;
        endTime = nextEnd;
      }
      if (rawSeconds.length) return aggregateCandles(rawSeconds, bucketMs).slice(-desiredCandles);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      // Some USD-M clusters do not expose historical 1s klines yet.
      // Fall back to public aggregate trades and keep accumulating locally.
    }

    const rows = await this.#fetchAggregateTradeHistory(symbol, bucketMs, Math.min(300, desiredCandles), generation);
    return aggregateTrades(rows, bucketMs).slice(-Math.min(300, desiredCandles));
  }

  async #fetchAggregateTradeHistory(symbol, bucketMs, desiredCandles, generation) {
    const fetchPage = async (endTime) => {
      const query = new URLSearchParams({ symbol, limit: "1000" });
      if (Number.isFinite(endTime)) query.set("endTime", String(Math.floor(endTime)));
      const response = await fetch(`${AGG_TRADES_REST}?${query}`, { signal: this.abortController.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    };
    const now = Date.now();
    const duration = Math.max(60_000, desiredCandles * bucketMs);
    const pageCount = 10;
    const endTimes = Array.from({ length: pageCount }, (_, index) => now - Math.round((duration * index) / (pageCount - 1)));
    const results = await Promise.allSettled(endTimes.map((endTime) => fetchPage(endTime)));
    const pages = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (generation !== this.generation) return [];
    if (!pages.length) throw new Error("Aggregate trade history unavailable");
    const byId = new Map();
    for (const trade of pages.flat()) byId.set(Number(trade.a), trade);
    return [...byId.values()].sort((left, right) => Number(left.T) - Number(right.T));
  }

  destroy() {
    this.generation += 1;
    this.#cleanup();
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
        this.candles = upsertCandle(this.candles, candle, 1500);
        this.seriesCache.set(`${this.symbol}:${this.interval}`, this.candles.slice());
        this.onData(this.candles, { symbol: this.symbol, interval: this.interval, range: this.range });
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
    this.abortController?.abort();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
    }
    this.socket = null;
  }
}

export class CandlestickChart {
  constructor(canvas, tooltip) {
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
    this.followLatest = true;
    this.timeZone = "Europe/Moscow";
    this.volumeVisible = true;
    this.theme = {
      background: "#070605",
      bullFill: "#ddd2c2",
      bullStroke: "#ddd2c2",
      bearFill: "#15120f",
      bearStroke: "#8c8175",
      grid: "#4a4037",
      text: "#8e8174",
      crosshair: "#a99a8c",
      crosshairFill: "#5e4968",
      crosshairText: "#eee5d9",
      session: "#8b5f9f",
    };
    this.drag = null;
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(canvas.parentElement);
    canvas.addEventListener("pointermove", (event) => this.#handlePointer(event));
    canvas.addEventListener("pointerdown", (event) => this.#handlePointerDown(event));
    canvas.addEventListener("pointerup", (event) => this.#handlePointerUp(event));
    canvas.addEventListener("pointercancel", (event) => this.#handlePointerUp(event));
    canvas.addEventListener("pointerleave", () => {
      if (this.drag) return;
      this.hoverX = null;
      this.hoverY = null;
      this.tooltip.hidden = true;
      this.render();
    });
    canvas.addEventListener("wheel", (event) => this.#handleWheel(event), { passive: false });
    canvas.addEventListener("dblclick", () => {
      this.followLatest = true;
      this.pricePan = 0;
      this.viewStart = Math.max(0, this.candles.length - (this.visibleCount ?? 80));
      this.render();
    });
  }

  setTimeZone(timeZone) {
    this.timeZone = timeZone || "Europe/Moscow";
    this.render();
  }

  setVolumeVisible(visible) {
    this.volumeVisible = Boolean(visible);
    this.render();
  }

  setTheme(theme) {
    this.theme = { ...this.theme, ...theme };
    this.render();
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.drag = null;
  }

  setData(candles, meta) {
    const nextKey = `${meta?.symbol ?? ""}:${meta?.interval ?? ""}:${meta?.range ?? ""}`;
    const seriesChanged = nextKey !== this.seriesKey;
    const symbolChanged = this.meta?.symbol && this.meta.symbol !== meta?.symbol;
    const oldAnchorTime = !seriesChanged && !this.followLatest && this.candles.length
      ? this.candles[Math.max(0, Math.floor(this.viewStart ?? 0))]?.time
      : null;
    if (seriesChanged) {
      this.pendingViewport = this.candles.length && this.visibleCount
        ? {
            latestRatio: (this.candles.length - 1 - (this.viewStart ?? 0)) / this.visibleCount,
            followLatest: this.followLatest,
          }
        : null;
      this.seriesKey = nextKey;
      this.viewStart = null;
      this.followLatest = !this.pendingViewport;
      if (symbolChanged) this.pricePan = 0;
    }
    this.candles = candles;
    this.meta = meta;
    if (oldAnchorTime !== null) {
      const nextAnchor = candles.findIndex((candle) => candle.time === oldAnchorTime);
      if (nextAnchor >= 0) this.viewStart = nextAnchor;
    }
    if (candles.length && this.pendingViewport && this.visibleCount) {
      this.viewStart = candles.length - 1 - this.pendingViewport.latestRatio * this.visibleCount;
      this.viewStart = Math.max(0, Math.min(this.viewStart, Math.max(0, candles.length - 1)));
      this.followLatest = this.pendingViewport.followLatest;
      this.pendingViewport = null;
    } else if (this.followLatest && this.visibleCount) this.viewStart = Math.max(0, candles.length - this.visibleCount);
    this.render();
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
    const volumeHeight = showVolume ? Math.max(28, Math.round(height * 0.18)) : 0;
    const plotWidth = width - margins.left - margins.right;
    const priceBottom = height - margins.bottom - volumeHeight - (showVolume ? 14 : 0);
    const plotHeight = priceBottom - margins.top;
    const requested = this.meta?.targetCandles ?? this.candles.length;
    const defaultVisible = Math.max(20, Math.min(Math.floor(plotWidth / 2), requested, this.candles.length));
    if (!this.visibleCount && this.candles.length) this.visibleCount = defaultVisible;
    this.visibleCount = Math.max(20, Math.min(1500, this.visibleCount ?? 80));
    if (this.viewStart === null) this.viewStart = Math.max(0, this.candles.length - this.visibleCount);
    this.viewStart = Math.max(0, Math.min(this.viewStart, Math.max(0, this.candles.length - 1)));
    const sliceStart = Math.max(0, Math.floor(this.viewStart));
    const sliceEnd = Math.min(this.candles.length, Math.ceil(this.viewStart + this.visibleCount));
    const visible = this.candles.slice(sliceStart, sliceEnd);

    this.#drawBackground(ctx, width, height, margins, priceBottom, volumeHeight);
    if (!visible.length) {
      ctx.fillStyle = this.theme.text;
      ctx.font = "11px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Свечной график загружается…", margins.left + plotWidth / 2, margins.top + plotHeight / 2);
      return;
    }

    const rawMin = Math.min(...visible.map((item) => item.low));
    const rawMax = Math.max(...visible.map((item) => item.high));
    const priceSpan = rawMax - rawMin || rawMax * 0.001 || 1;
    const priceCenter = (rawMax + rawMin) / 2 + priceSpan * this.pricePan;
    const scaledSpan = priceSpan * 1.16 * this.priceScale;
    const minPrice = priceCenter - scaledSpan / 2;
    const maxPrice = priceCenter + scaledSpan / 2;
    const displayCandles = compactCandles(visible, Math.max(10, Math.floor(plotWidth / 4)));
    const maxVolume = Math.max(...displayCandles.map((item) => item.volume), 1);
    const step = plotWidth / this.visibleCount;
    const y = (price) => margins.top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight;

    this.#drawPriceGrid(ctx, width, margins, minPrice, maxPrice, y, plotHeight);
    this.#drawTimeGrid(ctx, margins, plotWidth, height);
    this.#drawSessionMarkers(ctx, margins, height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(margins.left, margins.top, plotWidth, plotHeight);
    ctx.clip();
    displayCandles.forEach((candle) => {
      const globalIndex = sliceStart + candle.sourceOffset;
      const x = margins.left + (globalIndex - this.viewStart + .5) * step;
      const bodyWidth = Math.max(1, Math.min(8, step * candle.sourceSize * 0.68));
      const up = candle.close >= candle.open;
      const fill = up ? this.theme.bullFill : this.theme.bearFill;
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

    if (showVolume) {
      const volumeAreaTop = priceBottom + 14;
      ctx.save();
      ctx.beginPath();
      ctx.rect(margins.left, volumeAreaTop, plotWidth, Math.max(0, height - margins.bottom - volumeAreaTop));
      ctx.clip();
      displayCandles.forEach((candle) => {
        const globalIndex = sliceStart + candle.sourceOffset;
        const x = margins.left + (globalIndex - this.viewStart + .5) * step;
        const bodyWidth = Math.max(1, Math.min(8, step * candle.sourceSize * 0.68));
        const up = candle.close >= candle.open;
        const volumeTop = height - margins.bottom - (candle.volume / maxVolume) * volumeHeight;
        ctx.globalAlpha = up ? .3 : .2;
        ctx.fillStyle = up ? this.theme.bullFill : this.theme.bearStroke;
        ctx.fillRect(x - bodyWidth / 2, volumeTop, bodyWidth, height - margins.bottom - volumeTop);
      });
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    const current = this.candles.at(-1);
    if (current) this.#drawLastPrice(ctx, width, margins, y(current.close), current.close, current.close >= current.open, margins.top, priceBottom);
    this.layout = { visible, margins, step, plotWidth, plotHeight, priceBottom, width, height, startIndex: this.viewStart, minPrice, maxPrice };
    if (this.hoverX !== null && this.hoverY !== null) this.#drawCrosshair(ctx);
  }

  #drawBackground(ctx, width, height, margins, priceBottom, volumeHeight) {
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, width, height);
    if (volumeHeight > 0) {
      ctx.strokeStyle = "rgba(180,180,180,.12)";
      ctx.beginPath();
      ctx.moveTo(margins.left, priceBottom + 14);
      ctx.lineTo(width - margins.right, priceBottom + 14);
      ctx.stroke();
    }
  }

  #drawPriceGrid(ctx, width, margins, minPrice, maxPrice, y, plotHeight) {
    const targetTicks = Math.max(3, Math.floor(plotHeight / 52));
    const step = nicePriceStep(maxPrice - minPrice, targetTicks);
    const first = Math.ceil(minPrice / step) * step;
    ctx.font = "9px Arial, sans-serif";
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
    ctx.font = "8px Arial, sans-serif";
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
        ctx.font = "bold 7px Arial, sans-serif";
        ctx.textAlign = "center";
        const label = event.label === "D" ? "D" : `${event.label} ${formatTime(event.time, false, this.timeZone)}`;
        ctx.fillText(label, x, height - margins.bottom + 9);
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
    ctx.font = "bold 9px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(formatChartPrice(price), width - margins.right / 2, visibleY + 3);
  }

  #handlePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (this.drag?.type === "price") {
      const deltaY = y - this.drag.startY;
      this.priceScale = scaleFromDrag(this.drag.startScale, deltaY);
      this.tooltip.hidden = true;
      this.render();
      return;
    }
    if (this.drag?.type === "time") {
      const deltaX = x - this.drag.startX;
      const nextCount = visibleCountFromDrag(this.drag.startCount, deltaX, this.candles.length);
      this.visibleCount = nextCount;
      this.viewStart = Math.max(0, Math.min(this.drag.endIndex - nextCount, Math.max(0, this.candles.length - 1)));
      this.followLatest = false;
      this.tooltip.hidden = true;
      this.render();
      return;
    }
    if (this.drag?.type === "pan") {
      const deltaX = x - this.drag.startX;
      const deltaY = y - this.drag.startY;
      const candleShift = deltaX / Math.max(this.drag.step, 1);
      this.viewStart = Math.max(0, Math.min(this.drag.startView - candleShift, Math.max(0, this.candles.length - 1)));
      this.pricePan = this.drag.startPricePan + (deltaY / Math.max(this.drag.plotHeight, 1)) * this.priceScale;
      this.followLatest = false;
      this.tooltip.hidden = true;
      this.render();
      return;
    }
    const axis = this.#axisAt(x, y);
    this.canvas.style.cursor = axis === "price" ? "ns-resize" : axis === "time" ? "ew-resize" : "crosshair";
    this.hoverX = axis ? null : x;
    this.hoverY = axis ? null : y;
    this.render();
  }

  #axisAt(x, y) {
    if (!this.layout) return null;
    if (x >= this.layout.width - this.layout.margins.right) return "price";
    if (y >= this.layout.height - this.layout.margins.bottom) return "time";
    return null;
  }

  #handlePointerDown(event) {
    if (!this.layout) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const axis = this.#axisAt(x, y);
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.hoverX = null;
    this.tooltip.hidden = true;
    this.drag = axis === "price"
      ? { type: "price", startY: y, startScale: this.priceScale }
      : axis === "time"
        ? { type: "time", startX: x, startCount: this.visibleCount, endIndex: this.viewStart + this.visibleCount }
        : { type: "pan", startX: x, startY: y, startView: this.viewStart, startPricePan: this.pricePan, step: this.layout.step, plotHeight: this.layout.plotHeight };
    this.canvas.style.cursor = axis === "price" ? "ns-resize" : axis === "time" ? "ew-resize" : "grabbing";
  }

  #handlePointerUp(event) {
    if (!this.drag) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.drag = null;
    this.canvas.style.cursor = "crosshair";
  }

  #handleWheel(event) {
    event.preventDefault();
    if (!this.layout || this.candles.length < 2) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(this.layout.margins.left, Math.min(event.clientX - rect.left, this.layout.margins.left + this.layout.plotWidth));
    const anchorRatio = (x - this.layout.margins.left) / this.layout.plotWidth;
    const anchorIndex = this.layout.startIndex + anchorRatio * this.visibleCount;
    const factor = event.deltaY < 0 ? 0.78 : 1.28;
    const nextCount = Math.round(Math.max(20, Math.min(1500, this.visibleCount * factor)));
    this.visibleCount = nextCount;
    this.viewStart = Math.round(anchorIndex - anchorRatio * nextCount);
    this.viewStart = Math.max(0, Math.min(this.viewStart, Math.max(0, this.candles.length - 1)));
    this.followLatest = false;
    this.tooltip.hidden = true;
    this.render();
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
    ctx.font = "bold 8px Arial, sans-serif";
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

const zoneFormatters = new Map();
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

function zonedClock(timestamp, timeZone) {
  if (!zoneFormatters.has(timeZone)) {
    zoneFormatters.set(timeZone, new Intl.DateTimeFormat("en-CA", {
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
  for (const part of zoneFormatters.get(timeZone).formatToParts(new Date(timestamp))) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function sessionEvents(previous, current, timeZone = "UTC") {
  const events = [];
  const before = zonedClock(previous, timeZone);
  const after = zonedClock(current, timeZone);
  if (before.date !== after.date) {
    let left = previous;
    let right = current;
    while (right - left > 60_000) {
      const middle = Math.floor((left + right) / 2);
      if (zonedClock(middle, timeZone).date === before.date) left = middle;
      else right = middle;
    }
    events.push({ label: "D", time: right });
  }
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
