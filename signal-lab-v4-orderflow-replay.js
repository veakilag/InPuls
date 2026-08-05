import { buildFootprintColumns } from "./orderbook-flow-workspace.js?v=signal-lab-v4-orderflow-v1";
import { reconstructOrderBook } from "./signal-lab-v4-orderflow-recorder.js?v=signal-lab-v4-orderflow-v1";

const FLOW_TIMEFRAMES = Object.freeze({
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "1m": 60_000,
});

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function formatPrice(value) {
  const number = finite(value);
  if (number === null) return "—";
  const digits = number >= 1_000 ? 2 : number >= 1 ? 5 : 8;
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatQuote(value) {
  const number = finite(value);
  if (number === null) return "—";
  return `$${new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number)}`;
}

function formatClock(timestamp) {
  const value = finite(timestamp);
  if (value === null) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  }).format(new Date(value));
}

function inferTickSize(replay) {
  const prices = [
    ...(replay?.initialCheckpoint?.bids ?? []),
    ...(replay?.initialCheckpoint?.asks ?? []),
  ].slice(0, 80).map((row) => finite(row?.[0])).filter((value) => value !== null);
  const trades = (replay?.trades ?? []).slice(0, 80).map((row) => finite(row?.price)).filter((value) => value !== null);
  const sorted = [...new Set([...prices, ...trades])].sort((left, right) => left - right);
  let minimum = Infinity;
  for (let index = 1; index < sorted.length; index += 1) {
    const difference = sorted[index] - sorted[index - 1];
    if (difference > 0) minimum = Math.min(minimum, difference);
  }
  if (Number.isFinite(minimum)) return minimum;
  const reference = sorted[0] ?? 1;
  return reference >= 100 ? 0.01 : reference >= 1 ? 0.001 : 0.00001;
}

function resizeCanvas(canvas) {
  const ratio = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
  const width = Math.max(300, Math.round(canvas.clientWidth || 520));
  const height = Math.max(260, Math.round(canvas.clientHeight || 360));
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

function drawCluster(canvas, replay, selectedAt, timeframe, priceStep) {
  const { context, width, height } = resizeCanvas(canvas);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#081018";
  context.fillRect(0, 0, width, height);
  const bucketMs = FLOW_TIMEFRAMES[timeframe] ?? 5_000;
  const startTime = selectedAt - bucketMs * 12;
  const trades = (replay?.trades ?? []).filter((row) => row.tradeTime >= startTime && row.tradeTime <= selectedAt);
  const columns = buildFootprintColumns(trades, {
    startTime,
    endTime: selectedAt,
    priceStep,
    bucketMs,
  });
  if (!columns.length) {
    context.fillStyle = "#7892a5";
    context.font = "12px Inter, system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("Сделки для кластера ещё не записаны", width / 2, height / 2);
    return;
  }
  const cells = columns.flatMap((column) => column.cells);
  const prices = cells.map((cell) => cell.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const maximum = Math.max(1, ...cells.map((cell) => cell.quote));
  const padding = { left: 58, right: 8, top: 12, bottom: 26 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const columnWidth = chartWidth / Math.max(1, columns.length);
  const rowCount = Math.max(1, Math.round((high - low) / priceStep) + 1);
  const rowHeight = Math.max(8, Math.min(22, chartHeight / rowCount));
  const visibleHeight = rowCount * rowHeight;
  const top = padding.top + Math.max(0, (chartHeight - visibleHeight) / 2);

  context.font = "9px Inter, system-ui, sans-serif";
  context.textBaseline = "middle";
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex];
    for (const cell of column.cells) {
      const rowIndex = Math.round((high - cell.price) / priceStep);
      const x = padding.left + columnIndex * columnWidth;
      const y = top + rowIndex * rowHeight;
      const intensity = Math.max(0.08, Math.min(0.82, Math.sqrt(cell.quote / maximum)));
      const buyShare = cell.quote > 0 ? cell.buyQuote / cell.quote : 0.5;
      context.fillStyle = buyShare >= 0.5
        ? `rgba(95,224,167,${intensity})`
        : `rgba(242,125,134,${intensity})`;
      context.fillRect(x + 1, y + 1, Math.max(2, columnWidth - 2), Math.max(6, rowHeight - 2));
      if (columnWidth >= 42 && rowHeight >= 12) {
        context.fillStyle = "#e7f2f7";
        context.textAlign = "center";
        context.fillText(formatQuote(cell.quote), x + columnWidth / 2, y + rowHeight / 2);
      }
    }
  }
  context.fillStyle = "#7892a5";
  context.textAlign = "right";
  const labels = [high, (high + low) / 2, low];
  labels.forEach((price, index) => {
    const y = top + index * visibleHeight / 2;
    context.fillText(formatPrice(price), padding.left - 5, y + 5);
  });
  context.textAlign = "left";
  context.fillText(formatClock(startTime), padding.left, height - 8);
  context.textAlign = "right";
  context.fillText(formatClock(selectedAt), width - padding.right, height - 8);
}

class VirtualBookRenderer {
  constructor(target) {
    this.target = target;
    this.rowHeight = 22;
    this.rows = [];
    this.initialized = false;
    this.scrollTopBeforeUpdate = 0;
    this.spacer = document.createElement("div");
    this.spacer.className = "virtual-book-spacer";
    this.layer = document.createElement("div");
    this.layer.className = "virtual-book-layer";
    this.target.replaceChildren(this.spacer, this.layer);
    this.onScroll = () => this.#renderVisible();
    this.target.addEventListener("scroll", this.onScroll, { passive: true });
  }

  update(book) {
    if (!book) {
      this.rows = [{ type: "empty", text: "Локальная книга недоступна для выбранной точки" }];
      this.#renderVisible();
      return;
    }
    const asks = [...(book.asks ?? [])].reverse().map((row) => ({ type: "ask", row }));
    const bids = [...(book.bids ?? [])].map((row) => ({ type: "bid", row }));
    const bestAsk = finite(book.asks?.[0]?.[0]);
    const bestBid = finite(book.bids?.[0]?.[0]);
    this.rows = [
      ...asks,
      {
        type: "mid",
        text: bestAsk !== null && bestBid !== null
          ? `${formatPrice((bestAsk + bestBid) / 2)} · спред ${(((bestAsk - bestBid) / bestBid) * 100).toFixed(3)}%`
          : formatClock(book.at),
      },
      ...bids,
    ];
    this.spacer.style.height = `${this.rows.length * this.rowHeight}px`;
    if (!this.initialized) {
      this.initialized = true;
      const midpointIndex = asks.length;
      this.target.scrollTop = Math.max(0, midpointIndex * this.rowHeight - this.target.clientHeight / 2);
    }
    this.#renderVisible();
  }

  #renderVisible() {
    const height = Math.max(200, this.target.clientHeight || 400);
    const start = Math.max(0, Math.floor(this.target.scrollTop / this.rowHeight) - 8);
    const end = Math.min(this.rows.length, start + Math.ceil(height / this.rowHeight) + 16);
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      const item = this.rows[index];
      const row = document.createElement("div");
      row.className = `virtual-book-row is-${item.type}`;
      row.style.transform = `translateY(${index * this.rowHeight}px)`;
      if (item.type === "ask" || item.type === "bid") {
        const [price, quantity] = item.row;
        row.innerHTML = `<span>${formatPrice(price)}</span><span>${Number(quantity).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span><span>${formatQuote(price * quantity)}</span>`;
      } else {
        row.textContent = item.text;
      }
      fragment.append(row);
    }
    this.layer.replaceChildren(fragment);
  }

  destroy() {
    this.target.removeEventListener("scroll", this.onScroll);
  }
}

function renderTape(target, replay, selectedAt) {
  const trades = (replay?.trades ?? [])
    .filter((row) => row.tradeTime <= selectedAt)
    .slice(-240)
    .reverse();
  if (!trades.length) {
    target.textContent = "Сделки до выбранного момента не записаны";
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const trade of trades) {
    const row = document.createElement("div");
    row.className = `replay-tape-row is-${trade.side}`;
    row.innerHTML = `<span>${formatClock(trade.tradeTime)}</span><span>${formatPrice(trade.price)}</span><strong>${formatQuote(trade.quote)}</strong>`;
    fragment.append(row);
  }
  target.replaceChildren(fragment);
}

function qualityAt(replay, selectedAt) {
  let state = replay?.initialCheckpoint?.state ?? replay?.coverage?.state ?? "UNKNOWN";
  for (const row of replay?.qualityEvents ?? []) {
    if (row.at > selectedAt) break;
    state = row.state ?? state;
  }
  return state;
}

export function mountSignalLabV4OrderFlowPanel(card, replay) {
  const cluster = card.querySelector('[data-field="flow-cluster"]');
  const tape = card.querySelector('[data-field="flow-tape"]');
  const bookTarget = card.querySelector('[data-field="book"]');
  const quality = card.querySelector('[data-field="flow-quality"]');
  if (!cluster || !tape || !bookTarget) return null;
  const book = new VirtualBookRenderer(bookTarget);
  let timeframe = "5s";
  let stepMultiplier = 1;
  const tickSize = inferTickSize(replay);
  let lastSelectedAt = finite(replay?.requestedTo) ?? Date.now();

  const timeframeButtons = [...card.querySelectorAll("[data-flow-timeframe]")];
  const stepButtons = [...card.querySelectorAll("[data-flow-step]")];
  timeframeButtons.forEach((button) => button.addEventListener("click", () => {
    timeframe = button.dataset.flowTimeframe;
    timeframeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    drawCluster(cluster, replay, lastSelectedAt, timeframe, tickSize * stepMultiplier);
  }));
  stepButtons.forEach((button) => button.addEventListener("click", () => {
    stepMultiplier = Math.max(1, Number(button.dataset.flowStep) || 1);
    stepButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    drawCluster(cluster, replay, lastSelectedAt, timeframe, tickSize * stepMultiplier);
  }));

  return Object.freeze({
    render(selectedAt) {
      lastSelectedAt = finite(selectedAt) ?? lastSelectedAt;
      const reconstructed = reconstructOrderBook(replay, lastSelectedAt);
      book.update(reconstructed);
      renderTape(tape, replay, lastSelectedAt);
      drawCluster(cluster, replay, lastSelectedAt, timeframe, tickSize * stepMultiplier);
      if (quality) {
        const state = qualityAt(replay, lastSelectedAt);
        quality.textContent = `${state} · snapshot+diff · ${replay.events?.length ?? 0} diff · ${replay.trades?.length ?? 0} aggTrade`;
        quality.dataset.state = state;
      }
    },
    destroy() {
      book.destroy();
    },
  });
}
