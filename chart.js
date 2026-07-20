const MARKET_WS = "wss://fstream.binance.com/market/ws";
const KLINES_REST = "https://fapi.binance.com/fapi/v1/klines";

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

  async select(symbol, interval = "1m") {
    if (symbol === this.symbol && interval === this.interval && this.socket) return;
    this.symbol = symbol;
    this.interval = interval;
    this.candles = [];
    this.generation += 1;
    const generation = this.generation;
    this.#cleanup();
    this.onStatus({ state: "loading", text: `Загружаю ${symbol} · ${interval}` });
    this.onData([], { symbol, interval });

    this.abortController = new AbortController();
    try {
      const query = new URLSearchParams({ symbol, interval, limit: "180" });
      const response = await fetch(`${KLINES_REST}?${query}`, {
        signal: this.abortController.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      if (generation !== this.generation) return;
      this.candles = rows.map(parseRestKline).filter(isValidCandle);
      this.onData(this.candles, { symbol, interval });
    } catch (error) {
      if (error.name !== "AbortError" && generation === this.generation) {
        this.onStatus({ state: "warning", text: "История недоступна — собираю новые свечи" });
      }
    }

    if (generation === this.generation) this.#connect(generation);
  }

  #connect(generation) {
    const stream = `${this.symbol.toLowerCase()}@kline_${this.interval}`;
    this.socket = new WebSocket(`${MARKET_WS}/${stream}`);
    this.socket.addEventListener("open", () => {
      if (generation === this.generation) this.onStatus({ state: "online", text: "Свечи онлайн" });
    });
    this.socket.addEventListener("message", (message) => {
      if (generation !== this.generation) return;
      try {
        const payload = JSON.parse(message.data);
        const candle = parseStreamKline(payload.data ?? payload);
        if (!isValidCandle(candle)) return;
        this.candles = upsertCandle(this.candles, candle);
        this.onData(this.candles, { symbol: this.symbol, interval: this.interval });
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
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(canvas.parentElement);
    canvas.addEventListener("pointermove", (event) => this.#handlePointer(event));
    canvas.addEventListener("pointerleave", () => {
      this.hoverX = null;
      this.tooltip.hidden = true;
      this.render();
    });
  }

  setData(candles, meta) {
    this.candles = candles;
    this.meta = meta;
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
    const maxVisible = Math.max(32, Math.floor(plotWidth / 7));
    const visible = this.candles.slice(-maxVisible);

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
    const minPrice = rawMin - priceSpan * 0.08;
    const maxPrice = rawMax + priceSpan * 0.08;
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
    this.layout = { visible, margins, step, plotWidth, height };
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
    this.hoverX = event.clientX - rect.left;
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
