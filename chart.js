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
        : new URLSearchParams({ symbol, interval, limit: "1500" });
      const response = await fetch(`${secondsMode ? AGG_TRADES_REST : KLINES_REST}?${query}`, {
        signal: this.abortController.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      if (generation !== this.generation) return;
      this.candles = secondsMode ? aggregateTrades(rows, INTERVAL_MS[interval]) : rows.map(parseRestKline).filter(isValidCandle);
      this.candles = this.candles.slice(-1500);
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
    this.hoverY = null;
    this.layout = null;
    this.visibleCount = null;
    this.viewStart = null;
    this.priceScale = 1;
    this.pricePan = 0;
    this.followLatest = true;
    this.timeZone = "Europe/Moscow";
    this.volumeVisible = true;
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

  setData(candles, meta) {
    const nextKey = `${meta?.symbol ?? ""}:${meta?.interval ?? ""}:${meta?.range ?? ""}`;
    const seriesChanged = nextKey !== this.seriesKey;
    const symbolChanged = this.meta?.symbol && this.meta.symbol !== meta?.symbol;
    const oldAnchorTime = !seriesChanged && !this.followLatest && this.candles.length
      ? this.candles[Math.max(0, Math.floor(this.viewStart ?? 0))]?.time
      : null;
    if (seriesChanged) {
      this.seriesKey = nextKey;
      this.viewStart = null;
      this.followLatest = true;
      if (symbolChanged) this.pricePan = 0;
    }
    this.candles = candles;
    this.meta = meta;
    if (oldAnchorTime !== null) {
      const nextAnchor = candles.findIndex((candle) => candle.time === oldAnchorTime);
      if (nextAnchor >= 0) this.viewStart = nextAnchor;
    }
    if (this.followLatest && this.visibleCount) this.viewStart = Math.max(0, candles.length - this.visibleCount);
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
    const volumeHeight = this.volumeVisible ? Math.max(48, Math.round(height * 0.18)) : 0;
    const plotWidth = width - margins.left - margins.right;
    const priceBottom = height - margins.bottom - volumeHeight - (this.volumeVisible ? 14 : 0);
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
      ctx.fillStyle = "#627086";
      ctx.font = "11px Inter, sans-serif";
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
    const maxVolume = Math.max(...visible.map((item) => item.volume), 1);
    const step = plotWidth / this.visibleCount;
    const bodyWidth = Math.max(2, Math.min(9, step * 0.68));
    const y = (price) => margins.top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight;

    this.#drawPriceGrid(ctx, width, margins, minPrice, maxPrice, y);
    this.#drawTimeGrid(ctx, margins, plotWidth, height);
    this.#drawSessionMarkers(ctx, margins, height);

    visible.forEach((candle, index) => {
      const globalIndex = sliceStart + index;
      const x = margins.left + (globalIndex - this.viewStart + .5) * step;
      const up = candle.close >= candle.open;
      const fill = up ? "#f2f2ef" : "#050505";
      const stroke = up ? "#ffffff" : "#9a9a9a";
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

      if (this.volumeVisible) {
        const volumeTop = height - margins.bottom - (candle.volume / maxVolume) * volumeHeight;
        ctx.globalAlpha = up ? .3 : .2;
        ctx.fillStyle = up ? "#ffffff" : "#777777";
        ctx.fillRect(x - bodyWidth / 2, volumeTop, bodyWidth, height - margins.bottom - volumeTop);
        ctx.globalAlpha = 1;
      }
    });

    const current = this.candles.at(-1);
    if (current) this.#drawLastPrice(ctx, width, margins, y(current.close), current.close, current.close >= current.open, margins.top, priceBottom);
    this.layout = { visible, margins, step, plotWidth, plotHeight, priceBottom, width, height, startIndex: this.viewStart, minPrice, maxPrice };
    if (this.hoverX !== null && this.hoverY !== null) this.#drawCrosshair(ctx);
  }

  #drawBackground(ctx, width, height, margins, priceBottom, volumeHeight) {
    ctx.fillStyle = "#090909";
    ctx.fillRect(0, 0, width, height);
    if (this.volumeVisible) {
      ctx.strokeStyle = "rgba(180,180,180,.12)";
      ctx.beginPath();
      ctx.moveTo(margins.left, priceBottom + 14);
      ctx.lineTo(width - margins.right, priceBottom + 14);
      ctx.stroke();
    }
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

  #drawTimeGrid(ctx, margins, plotWidth, height) {
    const divisions = Math.min(5, Math.max(2, Math.floor(plotWidth / 140)));
    ctx.font = "8px Inter, sans-serif";
    ctx.textAlign = "center";
    for (let index = 0; index <= divisions; index += 1) {
      const x = margins.left + (plotWidth / divisions) * index;
      const globalIndex = this.viewStart + this.visibleCount * (index / divisions);
      ctx.strokeStyle = "rgba(113,139,171,.06)";
      ctx.beginPath();
      ctx.moveTo(x, margins.top);
      ctx.lineTo(x, height - margins.bottom);
      ctx.stroke();
      ctx.fillStyle = "#64738a";
      ctx.fillText(formatTime(this.#timeAtIndex(globalIndex), false, this.timeZone), x, height - 9);
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
        ctx.strokeStyle = "rgba(157,108,255,.24)";
        ctx.beginPath();
        ctx.moveTo(x, margins.top);
        ctx.lineTo(x, height - margins.bottom);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#b99ce8";
        ctx.font = "bold 7px Inter, sans-serif";
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

  #drawLastPrice(ctx, width, margins, lineY, price, up, top, bottom) {
    const color = up ? "#f2f2ef" : "#090909";
    const visibleY = Math.max(top + 9, Math.min(bottom - 9, lineY));
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = up ? "#f2f2ef" : "#a0a0a0";
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
      ctx.strokeStyle = "#8b8b8b";
      ctx.strokeRect(width - margins.right + .5, visibleY - 8.5, margins.right - 1, 17);
    }
    ctx.fillStyle = up ? "#080808" : "#f2f2ef";
    ctx.font = "bold 9px Inter, sans-serif";
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
    ctx.strokeStyle = "rgba(210,200,230,.24)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(width - margins.right, y);
    ctx.moveTo(x, y);
    ctx.lineTo(x, height - margins.bottom);
    ctx.stroke();
    ctx.restore();
    this.tooltip.hidden = true;
    ctx.fillStyle = "rgba(91,75,120,.92)";
    ctx.fillRect(width - margins.right, y - 8, margins.right, 16);
    ctx.fillRect(x - 36, height - margins.bottom, 72, margins.bottom);
    ctx.fillStyle = "#e5dff0";
    ctx.font = "bold 8px Inter, sans-serif";
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

const zoneFormatters = new Map();

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

function formatChartPrice(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(value >= 100 ? 2 : 4);
  if (value >= 0.01) return value.toFixed(5);
  return value.toPrecision(5);
}
