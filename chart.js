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
  }

  async select(symbol, interval = "1m", range = "1h") {
    if (symbol === this.symbol && interval === this.interval && range === this.range && this.socket) return;
    this.symbol = symbol;
    this.interval = interval;
    this.range = range;
    this.candles = [];
    this.generation += 1;
    const generation = this.generation;
    this.#cleanup();
    this.onStatus({ state: "loading", text: `Загружаю ${symbol} · ${interval}` });
    this.onData([], { symbol, interval, range });

    this.abortController = new AbortController();
    try {
      const secondsMode = interval.endsWith("s");
      const targetCandles = Math.max(30, Math.ceil((RANGE_MS[range] ?? RANGE_MS["1h"]) / (INTERVAL_MS[interval] ?? 60_000)));
      const query = secondsMode
        ? new URLSearchParams({ symbol, limit: "1000" })
        : new URLSearchParams({ symbol, interval, limit: String(Math.min(1500, targetCandles + 2)) });
      const response = await fetch(`${secondsMode ? AGG_TRADES_REST : KLINES_REST}?${query}`, {
        signal: this.abortController.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      if (generation !== this.generation) return;
      this.candles = secondsMode ? aggregateTrades(rows, INTERVAL_MS[interval]) : rows.map(parseRestKline).filter(isValidCandle);
      this.candles = this.candles.slice(-Math.min(1500, targetCandles));
      this.onData(this.candles, { symbol, interval, range, targetCandles });
    } catch (error) {
      if (error.name !== "AbortError" && generation === this.generation) {
        this.onStatus({ state: "warning", text: "История недоступна — собираю новые свечи" });
      }
    }

    if (generation === this.generation) this.#connect(generation);
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
    this.layout = null;
    this.visibleCount = null;
    this.viewStart = null;
    this.priceScale = 1;
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
      this.tooltip.hidden = true;
      this.render();
    });
    canvas.addEventListener("wheel", (event) => this.#handleWheel(event), { passive: false });
  }

  setData(candles, meta) {
    const nextKey = `${meta?.symbol ?? ""}:${meta?.interval ?? ""}:${meta?.range ?? ""}`;
    if (nextKey !== this.seriesKey) {
      this.seriesKey = nextKey;
      this.visibleCount = null;
      this.viewStart = null;
      this.autoViewport = true;
      this.priceScale = 1;
    }
    const wasAtEnd = this.viewStart === null || !this.candles.length || this.viewStart + (this.visibleCount ?? 0) >= this.candles.length - 1;
    this.candles = candles;
    this.meta = meta;
    if (wasAtEnd && this.visibleCount) this.viewStart = Math.max(0, candles.length - this.visibleCount);
    this.render();
  }

  render() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(260, Math.floor(rect.height));
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
    const volumeHeight = Math.max(48, Math.round(height * 0.18));
    const plotWidth = width - margins.left - margins.right;
    const priceBottom = height - margins.bottom - volumeHeight - 14;
    const plotHeight = priceBottom - margins.top;
    const requested = this.meta?.targetCandles ?? this.candles.length;
    const defaultVisible = Math.max(20, Math.min(Math.floor(plotWidth / 2), requested, this.candles.length));
    if (!this.visibleCount || (this.autoViewport && this.candles.length)) {
      this.visibleCount = defaultVisible;
      this.autoViewport = false;
    }
    this.visibleCount = Math.max(20, Math.min(this.visibleCount, this.candles.length || 20));
    if (this.viewStart === null) this.viewStart = Math.max(0, this.candles.length - this.visibleCount);
    this.viewStart = Math.max(0, Math.min(this.viewStart, Math.max(0, this.candles.length - this.visibleCount)));
    const visible = this.candles.slice(this.viewStart, this.viewStart + this.visibleCount);

    this.#drawBackground(ctx, width, height, margins, priceBottom, volumeHeight);
    if (!visible.length) {
      ctx.fillStyle = "#627086";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Свечной график загружается…", margins.left + plotWidth / 2, margins.top + plotHeight / 2);
      return;
    }

    const rawMin = Math.min(...visible.map((item) => item.low));
    const rawMax = Math.max(...visible.map((item) => item.high));
    const priceSpan = rawMax - rawMin || rawMax * 0.001 || 1;
    const priceCenter = (rawMax + rawMin) / 2;
    const scaledSpan = priceSpan * 1.16 * this.priceScale;
    const minPrice = priceCenter - scaledSpan / 2;
    const maxPrice = priceCenter + scaledSpan / 2;
    const maxVolume = Math.max(...visible.map((item) => item.volume), 1);
    const step = plotWidth / visible.length;
    const bodyWidth = Math.max(2, Math.min(9, step * 0.68));
    const y = (price) => margins.top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight;

    this.#drawPriceGrid(ctx, width, margins, minPrice, maxPrice, y);
    this.#drawTimeGrid(ctx, visible, margins, plotWidth, height);

    visible.forEach((candle, index) => {
      const x = margins.left + step * index + step / 2;
      const up = candle.close >= candle.open;
      const color = up ? "#50e3a4" : "#ff6b7a";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y(candle.high));
      ctx.lineTo(x, y(candle.low));
      ctx.stroke();
      const bodyTop = y(Math.max(candle.open, candle.close));
      const bodyBottom = y(Math.min(candle.open, candle.close));
      ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, Math.max(1.5, bodyBottom - bodyTop));

      const volumeTop = height - margins.bottom - (candle.volume / maxVolume) * volumeHeight;
      ctx.globalAlpha = 0.28;
      ctx.fillRect(x - bodyWidth / 2, volumeTop, bodyWidth, height - margins.bottom - volumeTop);
      ctx.globalAlpha = 1;
    });

    const last = visible.at(-1);
    this.#drawLastPrice(ctx, width, margins, y(last.close), last.close, last.close >= last.open);
    this.layout = { visible, margins, step, plotWidth, width, height, startIndex: this.viewStart };
    if (this.hoverX !== null) this.#drawCrosshair(ctx);
  }

  #drawBackground(ctx, width, height, margins, priceBottom, volumeHeight) {
    ctx.fillStyle = "#0a0f16";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(113,139,171,.09)";
    ctx.beginPath();
    ctx.moveTo(margins.left, priceBottom + 14);
    ctx.lineTo(width - margins.right, priceBottom + 14);
    ctx.stroke();
    ctx.fillStyle = "#536176";
    ctx.font = "8px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("VOLUME", margins.left + 4, height - margins.bottom - volumeHeight + 11);
  }

  #drawPriceGrid(ctx, width, margins, minPrice, maxPrice, y) {
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "left";
    for (let index = 0; index <= 5; index += 1) {
      const price = maxPrice - ((maxPrice - minPrice) / 5) * index;
      const lineY = y(price);
      ctx.strokeStyle = "rgba(113,139,171,.09)";
      ctx.beginPath();
      ctx.moveTo(margins.left, lineY);
      ctx.lineTo(width - margins.right, lineY);
      ctx.stroke();
      ctx.fillStyle = "#64738a";
      ctx.fillText(formatChartPrice(price), width - margins.right + 9, lineY + 3);
    }
  }

  #drawTimeGrid(ctx, visible, margins, plotWidth, height) {
    const divisions = Math.min(5, Math.max(2, Math.floor(plotWidth / 140)));
    ctx.font = "8px Inter, sans-serif";
    ctx.textAlign = "center";
    for (let index = 0; index <= divisions; index += 1) {
      const x = margins.left + (plotWidth / divisions) * index;
      const candleIndex = Math.min(visible.length - 1, Math.round((visible.length - 1) * (index / divisions)));
      ctx.strokeStyle = "rgba(113,139,171,.06)";
      ctx.beginPath();
      ctx.moveTo(x, margins.top);
      ctx.lineTo(x, height - margins.bottom);
      ctx.stroke();
      ctx.fillStyle = "#64738a";
      ctx.fillText(formatTime(visible[candleIndex].time), x, height - 9);
    }
  }

  #drawLastPrice(ctx, width, margins, lineY, price, up) {
    const color = up ? "#50e3a4" : "#ff6b7a";
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(margins.left, lineY);
    ctx.lineTo(width - margins.right, lineY);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = color;
    ctx.fillRect(width - margins.right, lineY - 9, margins.right, 18);
    ctx.fillStyle = "#07110d";
    ctx.font = "bold 9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(formatChartPrice(price), width - margins.right / 2, lineY + 3);
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
      this.viewStart = Math.max(0, Math.min(this.drag.endIndex - nextCount, Math.max(0, this.candles.length - nextCount)));
      this.tooltip.hidden = true;
      this.render();
      return;
    }
    const axis = this.#axisAt(x, y);
    this.canvas.style.cursor = axis === "price" ? "ns-resize" : axis === "time" ? "ew-resize" : "crosshair";
    this.hoverX = axis ? null : x;
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
    if (!axis) return;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.hoverX = null;
    this.tooltip.hidden = true;
    this.drag = axis === "price"
      ? { type: "price", startY: y, startScale: this.priceScale }
      : { type: "time", startX: x, startCount: this.visibleCount, endIndex: this.viewStart + this.visibleCount };
    this.canvas.style.cursor = axis === "price" ? "ns-resize" : "ew-resize";
  }

  #handlePointerUp(event) {
    if (!this.drag) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.drag = null;
  }

  #handleWheel(event) {
    if (!event.ctrlKey || !this.layout || this.candles.length < 20) return;
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(this.layout.margins.left, Math.min(event.clientX - rect.left, this.layout.margins.left + this.layout.plotWidth));
    const anchorRatio = (x - this.layout.margins.left) / this.layout.plotWidth;
    const anchorIndex = this.layout.startIndex + anchorRatio * this.visibleCount;
    const factor = event.deltaY < 0 ? 0.78 : 1.28;
    const nextCount = Math.round(Math.max(20, Math.min(this.candles.length, this.visibleCount * factor)));
    this.visibleCount = nextCount;
    this.viewStart = Math.round(anchorIndex - anchorRatio * nextCount);
    this.viewStart = Math.max(0, Math.min(this.viewStart, Math.max(0, this.candles.length - nextCount)));
    this.tooltip.hidden = true;
    this.render();
  }

  #drawCrosshair(ctx) {
    if (!this.layout) return;
    const { visible, margins, step, plotWidth, height } = this.layout;
    const rawIndex = Math.floor((this.hoverX - margins.left) / step);
    const index = Math.max(0, Math.min(visible.length - 1, rawIndex));
    const candle = visible[index];
    const x = margins.left + step * index + step / 2;
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = "rgba(200,214,232,.4)";
    ctx.beginPath();
    ctx.moveTo(x, margins.top);
    ctx.lineTo(x, height - margins.bottom);
    ctx.stroke();
    ctx.restore();

    this.tooltip.hidden = false;
    this.tooltip.innerHTML = `<strong>${formatTime(candle.time, true)}</strong><span>O ${formatChartPrice(candle.open)}</span><span>H ${formatChartPrice(candle.high)}</span><span>L ${formatChartPrice(candle.low)}</span><span>C ${formatChartPrice(candle.close)}</span>`;
    const tooltipWidth = 150;
    this.tooltip.style.left = `${Math.min(plotWidth - tooltipWidth + margins.left, Math.max(margins.left, x + 12))}px`;
    this.tooltip.style.top = "16px";
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

function formatTime(timestamp, withDate = false) {
  return new Intl.DateTimeFormat("ru-RU", {
    ...(withDate ? { day: "2-digit", month: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatChartPrice(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(value >= 100 ? 2 : 4);
  if (value >= 0.01) return value.toFixed(5);
  return value.toPrecision(5);
}
