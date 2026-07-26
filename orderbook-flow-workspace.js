export const FLOW_WORKSPACE = Object.freeze({
  historyMs: 15_000,
  minimumBucketMs: 250,
  maximumColumns: 28,
  maximumTrades: 6_000,
  minimumPanePx: 108,
  minimumTapePx: 160,
  minimumBookPx: 104,
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
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

export function mergeFlowTrades(current, incoming, limit = FLOW_WORKSPACE.maximumTrades, replace = false) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || FLOW_WORKSPACE.maximumTrades));
  const source = replace ? [] : (current ?? []);
  const combined = [
    ...(incoming ?? []).map(normalizeFlowTrade).filter(Boolean),
    ...source.map(normalizeFlowTrade).filter(Boolean),
  ].sort((left, right) => right.time - left.time || String(right.id).localeCompare(String(left.id)));

  const seen = new Set();
  const result = [];
  for (const trade of combined) {
    const key = flowTradeKey(trade);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trade);
    if (result.length >= safeLimit) break;
  }
  return result;
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

export function visibleFlowCount(trades, startTime, endTime) {
  let count = 0;
  for (const trade of trades ?? []) {
    const time = Number(trade?.time);
    if (Number.isFinite(time) && time >= startTime && time <= endTime) count += 1;
  }
  return count;
}

const tradesBySymbol = new Map();
const cardStates = new WeakMap();
let drawFrame = 0;

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
        minmax(${FLOW_WORKSPACE.minimumPanePx}px, var(--flow-cluster-width, 24%))
        7px
        minmax(${FLOW_WORKSPACE.minimumBookPx}px, var(--flow-book-width, 22%))
        7px
        minmax(${FLOW_WORKSPACE.minimumTapePx}px, 1fr) !important;
      grid-template-areas: "clusters split-a book split-b tape" !important;
      min-width: 0;
    }
    .orderbook-card .inpuls-footprint-pane {
      grid-area: clusters;
      position: relative;
      min-width: 0;
      overflow: hidden;
      border-right: 1px solid rgba(111, 82, 168, .24);
      background: rgba(4, 7, 10, .72);
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
      border-bottom: 1px solid rgba(98, 126, 139, .18);
      background: rgba(7, 10, 14, .9);
      color: #8299a4;
      font: 800 8px/1 Inter, system-ui, sans-serif;
    }
    .orderbook-card .inpuls-footprint-toolbar button {
      min-width: 28px;
      height: 18px;
      padding: 0 5px;
      border: 1px solid rgba(105, 132, 145, .28);
      border-radius: 4px;
      background: rgba(12, 17, 22, .88);
      color: #8ba1ac;
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
      color: #a8bbc3;
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
      background: rgba(92, 70, 135, .08);
    }
    .orderbook-card .inpuls-flow-splitter::before {
      content: "";
      position: absolute;
      inset: 0 -4px;
    }
    .orderbook-card .inpuls-flow-splitter[data-flow-split="clusters"] { grid-area: split-a; }
    .orderbook-card .inpuls-flow-splitter[data-flow-split="tape"] { grid-area: split-b; }
    .orderbook-card .book-splitter { display: none !important; }
    .orderbook-card [data-book-clusters] { display: none !important; }
    .orderbook-card .trade-tape-toolbar::before {
      content: "TAPE";
      color: #8fa5af;
      font: 800 8px/1 Inter, system-ui, sans-serif;
    }
    .orderbook-card .inpuls-flow-count {
      flex: 0 0 auto;
      color: #8fa5af;
      font: 800 8px/1 Inter, system-ui, sans-serif;
      white-space: nowrap;
    }
    .orderbook-card .book-ladder-row .book-size::before {
      left: 0 !important;
      right: auto !important;
      transform-origin: left center !important;
    }
  `;
  document.head.append(style);
}

function requestDraw() {
  if (drawFrame) return;
  drawFrame = requestAnimationFrame(() => {
    drawFrame = 0;
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      const state = ensureCard(card);
      if (state) renderCard(card, state);
    });
  });
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
          `${clamp(bookWidth + delta, FLOW_WORKSPACE.minimumBookPx, stageRect.width * .48)}px`,
        );
      }
      requestDraw();
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
      <span>КЛАСТЕРЫ</span>
      <button type="button" data-footprint-toggle class="is-active" aria-pressed="true">КЛ</button>
      <span>Δ</span>
      <strong data-footprint-count>0 trades</strong>
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

  const toolbar = tape.querySelector(".trade-tape-toolbar");
  const flowCount = document.createElement("span");
  flowCount.className = "inpuls-flow-count";
  flowCount.textContent = "0 trades";
  toolbar?.append(flowCount);

  const canvas = pane.querySelector("canvas");
  const state = {
    pane,
    canvas,
    context: canvas.getContext("2d"),
    count: pane.querySelector("[data-footprint-count]"),
    flowCount,
    visible: true,
  };
  cardStates.set(card, state);

  pane.querySelector("[data-footprint-toggle]").addEventListener("click", (event) => {
    state.visible = !state.visible;
    event.currentTarget.classList.toggle("is-active", state.visible);
    event.currentTarget.setAttribute("aria-pressed", String(state.visible));
    canvas.style.display = state.visible ? "" : "none";
    requestDraw();
  });

  bindSplitter(card, splitClusters, "clusters");
  bindSplitter(card, splitTape, "tape");

  const observer = new MutationObserver(requestDraw);
  observer.observe(card, { childList: true, subtree: true, characterData: true });
  state.observer = observer;
  return state;
}

function renderCard(card, state) {
  const symbol = cardSymbol(card);
  if (!symbol || !state.context) return;
  const trades = tradesBySymbol.get(symbol) ?? [];
  const paneRect = state.pane.getBoundingClientRect();
  const width = Math.max(1, paneRect.width);
  const height = Math.max(1, paneRect.height - 23);
  if (width <= 2 || height <= 2) return;

  const rows = visibleRows(card, state.pane);
  if (!rows.length) return;

  const latestTime = trades[0]?.time || Date.now();
  const window = flowWindow(latestTime);
  const bucketMs = footprintBucketMs(width, window.duration);
  const columns = buildFootprintColumns(trades, {
    ...window,
    bucketMs,
    priceStep: rowStep(rows),
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

  const maximum = Math.max(1, ...columns.flatMap((column) => column.cells.map((cell) => cell.quote)));
  const columnCount = Math.max(1, Math.ceil(window.duration / bucketMs));
  const columnWidth = width / columnCount;
  const labelThreshold = maximum * .42;

  state.context.font = "800 7px Inter, system-ui, sans-serif";
  state.context.textAlign = "center";
  state.context.textBaseline = "middle";

  if (state.visible) {
    for (const column of columns) {
      const x = column.timeIndex * columnWidth;
      for (const cell of column.cells) {
        const row = nearestRow(rows, cell.price);
        if (!row) continue;
        const tone = footprintTone(cell);
        const alpha = clamp(.12 + Math.sqrt(cell.quote / maximum) * .65, .12, .78);
        const cellHeight = Math.max(2, Math.min(row.height * .84, 13));
        const cellWidth = Math.max(1, columnWidth - 1);
        state.context.fillStyle = tone >= 0
          ? `rgba(39, 192, 137, ${alpha})`
          : `rgba(225, 73, 91, ${alpha})`;
        state.context.fillRect(x + .5, row.y - cellHeight / 2, cellWidth, cellHeight);

        if (cell.quote >= labelThreshold && cellWidth >= 22 && cellHeight >= 8) {
          state.context.fillStyle = "rgba(237, 245, 242, .95)";
          state.context.fillText(formatUsd(cell.quote), x + columnWidth / 2, row.y);
        }
      }
    }

    state.context.strokeStyle = "rgba(103, 224, 183, .38)";
    state.context.lineWidth = .7;
    state.context.beginPath();
    state.context.moveTo(width - .5, 0);
    state.context.lineTo(width - .5, height);
    state.context.stroke();
  }

  const visibleCount = visibleFlowCount(trades, window.startTime, window.endTime);
  state.count.textContent = `${visibleCount} trades`;
  state.flowCount.textContent = `${visibleCount} trades`;
}

function acceptTape(event) {
  const detail = event?.detail;
  const symbol = String(detail?.symbol ?? "").toUpperCase();
  if (!symbol.endsWith("USDT")) return;
  const incoming = Array.isArray(detail?.trades) ? detail.trades : [];
  const current = tradesBySymbol.get(symbol) ?? [];
  tradesBySymbol.set(
    symbol,
    mergeFlowTrades(
      current,
      incoming,
      FLOW_WORKSPACE.maximumTrades,
      Boolean(detail?.replace),
    ),
  );
  requestDraw();
}

function install() {
  if (typeof document === "undefined") return;
  injectStyles();
  globalThis.addEventListener("inpuls:tape-data", acceptTape);
  document.querySelectorAll(".orderbook-card").forEach(ensureCard);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(".orderbook-card")) ensureCard(node);
        node.querySelectorAll?.(".orderbook-card").forEach(ensureCard);
      }
    }
    requestDraw();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("resize", requestDraw, { passive: true });
  window.addEventListener("orientationchange", requestDraw, { passive: true });
  document.addEventListener("scroll", requestDraw, true);
  requestDraw();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
}
