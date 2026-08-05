import {
  aggregateTradePath,
  bookAnomalyQuote,
  bookDisplayedQuote,
  bookDistancePercentLabel,
  bookQuoteScale,
  bookScaleIndexForWheel,
  bookScaleLabel,
  buildDepthLadder,
  clampDepthViewCenter,
  inferPriceTick,
  installOrderBookStyles,
  maximumBookScaleIndex,
  maximumDepthQuote,
  priceStepForScale,
} from "./orderbook.js?v=signal-lab-v5-shared-orderbook";
import {
  buildFootprintColumns,
  normalizeFlowTrade,
} from "./orderbook-flow-workspace.js?v=signal-lab-v5-shared-orderbook";
import { reconstructOrderBook } from "./signal-lab-v4-orderflow-recorder.js?v=signal-lab-v5-orderflow-v2";

export const SIGNAL_LAB_V5_REPLAY_VIEW_VERSION = "signal-lab-v5-shared-orderbook-replay-v1-2026-08";

const TRADE_WINDOWS = Object.freeze([15_000, 30_000, 60_000, 120_000, 300_000]);
const FOOTPRINT_BUCKETS = Object.freeze({
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "1m": 60_000,
});

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function formatPrice(value, baseTick = null) {
  const number = finite(value);
  if (number === null) return "—";
  const tick = Math.abs(finite(baseTick) ?? 0);
  const fractionDigits = tick > 0 && tick < 1
    ? Math.min(10, Math.max(0, Math.ceil(-Math.log10(tick) - 1e-10)))
    : number >= 1_000 ? 2 : number >= 1 ? 4 : 8;
  return number.toLocaleString("en-US", {
    minimumFractionDigits: tick > 0 ? fractionDigits : 0,
    maximumFractionDigits: fractionDigits,
  });
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

function formatTradeWindow(value) {
  const duration = finite(value) ?? 60_000;
  if (duration < 60_000) return `${Math.round(duration / 1_000)}с`;
  return `${Math.round(duration / 60_000)}м`;
}

function eventTime(row) {
  return finite(row?.tradeTime ?? row?.executionTime ?? row?.time ?? row?.eventTime);
}

function normalizeReplayTrades(replay, mode) {
  const source = mode === "raw" ? replay?.rawTrades : replay?.trades;
  return (Array.isArray(source) ? source : [])
    .map((trade) => normalizeFlowTrade({
      ...trade,
      time: eventTime(trade),
      tradeTime: eventTime(trade),
    }))
    .filter(Boolean)
    .sort((left, right) => right.executionTime - left.executionTime);
}

function resizeCanvas(canvas) {
  const ratio = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
  const width = Math.max(280, Math.round(canvas.clientWidth || 520));
  const height = Math.max(220, Math.round(canvas.clientHeight || 340));
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width, height };
}

function drawEmpty(canvas, text) {
  const { context, width, height } = resizeCanvas(canvas);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#081018";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#7892a5";
  context.font = "12px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(text, width / 2, height / 2);
}

function drawTape(canvas, trades, selectedAt, windowMs, minimumQuote) {
  const visible = trades
    .filter((trade) => trade.executionTime <= selectedAt && trade.executionTime >= selectedAt - windowMs)
    .filter((trade) => trade.quote >= minimumQuote)
    .sort((left, right) => left.executionTime - right.executionTime);
  if (!visible.length) {
    drawEmpty(canvas, "Сделки для выбранного окна не записаны");
    return;
  }
  const { context, width, height } = resizeCanvas(canvas);
  const path = aggregateTradePath(visible, 220);
  const prices = visible.map((trade) => trade.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const range = Math.max(high - low, high * 0.0001, Number.EPSILON);
  const padding = { left: 8, right: 58, top: 10, bottom: 24 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const from = selectedAt - windowMs;
  const xFor = (time) => padding.left + (time - from) / windowMs * chartWidth;
  const yFor = (price) => padding.top + (1 - (price - low) / range) * chartHeight;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#081018";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(120,146,165,.18)";
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + chartHeight * index / 4;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }
  if (path.length > 1) {
    context.strokeStyle = "rgba(222,234,242,.68)";
    context.beginPath();
    path.forEach((point, index) => {
      const x = xFor(point.time);
      const y = yFor(point.price);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }
  const maximumQuote = Math.max(1, ...visible.map((trade) => trade.quote));
  for (const trade of visible.slice(-1_200)) {
    const x = xFor(trade.executionTime);
    const y = yFor(trade.price);
    const radius = clamp(2 + Math.sqrt(trade.quote / maximumQuote) * 8, 2, 10);
    context.fillStyle = trade.side === "sell" ? "rgba(242,125,134,.78)" : "rgba(95,224,167,.78)";
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.font = "10px Inter, system-ui, sans-serif";
  context.fillStyle = "#7892a5";
  context.textAlign = "right";
  context.fillText(formatPrice(high), width - 4, padding.top + 5);
  context.fillText(formatPrice(low), width - 4, padding.top + chartHeight);
  context.textAlign = "left";
  context.fillText(formatClock(from), padding.left, height - 7);
  context.textAlign = "right";
  context.fillText(formatClock(selectedAt), width - padding.right, height - 7);
}

function drawFootprint(canvas, trades, selectedAt, timeframe, priceStep, minimumQuote) {
  const bucketMs = FOOTPRINT_BUCKETS[timeframe] ?? 5_000;
  const startTime = selectedAt - bucketMs * 12;
  const visible = trades
    .filter((trade) => trade.executionTime >= startTime && trade.executionTime <= selectedAt)
    .filter((trade) => trade.quote >= minimumQuote);
  const columns = buildFootprintColumns(visible, {
    startTime,
    endTime: selectedAt,
    priceStep,
    bucketMs,
  });
  if (!columns.length) {
    drawEmpty(canvas, "Сделки для кластера не записаны");
    return;
  }
  const { context, width, height } = resizeCanvas(canvas);
  const cells = columns.flatMap((column) => column.cells);
  const prices = cells.map((cell) => cell.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const maximum = Math.max(1, ...cells.map((cell) => cell.quote));
  const padding = { left: 64, right: 8, top: 10, bottom: 25 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const columnWidth = chartWidth / Math.max(1, columns.length);
  const rowCount = Math.max(1, Math.round((high - low) / priceStep) + 1);
  const rowHeight = clamp(chartHeight / rowCount, 7, 22);
  const visibleHeight = rowCount * rowHeight;
  const top = padding.top + Math.max(0, (chartHeight - visibleHeight) / 2);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#081018";
  context.fillRect(0, 0, width, height);
  context.font = "9px Inter, system-ui, sans-serif";
  context.textBaseline = "middle";
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    for (const cell of columns[columnIndex].cells) {
      const rowIndex = Math.round((high - cell.price) / priceStep);
      const x = padding.left + columnIndex * columnWidth;
      const y = top + rowIndex * rowHeight;
      const intensity = clamp(Math.sqrt(cell.quote / maximum), .08, .84);
      const buyShare = cell.quote > 0 ? cell.buyQuote / cell.quote : .5;
      context.fillStyle = buyShare >= .5
        ? `rgba(95,224,167,${intensity})`
        : `rgba(242,125,134,${intensity})`;
      context.fillRect(x + 1, y + 1, Math.max(2, columnWidth - 2), Math.max(5, rowHeight - 2));
      if (columnWidth >= 44 && rowHeight >= 12) {
        context.fillStyle = "#e7f2f7";
        context.textAlign = "center";
        context.fillText(formatQuote(cell.quote), x + columnWidth / 2, y + rowHeight / 2);
      }
    }
  }
  context.fillStyle = "#7892a5";
  context.textAlign = "right";
  [high, (high + low) / 2, low].forEach((price, index) => {
    context.fillText(formatPrice(price), padding.left - 5, top + index * visibleHeight / 2 + 4);
  });
  context.textAlign = "left";
  context.fillText(formatClock(startTime), padding.left, height - 7);
  context.textAlign = "right";
  context.fillText(formatClock(selectedAt), width - padding.right, height - 7);
}

function anomalyTierForQuote(quote, threshold) {
  const amount = Math.max(0, finite(quote) ?? 0);
  const base = Math.max(1, finite(threshold) ?? 1);
  if (amount < base) return 0;
  if (amount >= base * 3.5) return 3;
  if (amount >= base * 2) return 2;
  return 1;
}

function createBookRow() {
  const row = document.createElement("div");
  row.className = "book-ladder-row";
  const size = document.createElement("span");
  size.className = "book-size";
  const price = document.createElement("strong");
  row.append(size, price);
  return row;
}

function patchRows(body, rows, middle, maximumQuote, threshold, baseTick) {
  let elements = [...body.children];
  if (elements.length !== rows.length || elements.some((row) => !row.classList.contains("book-ladder-row"))) {
    elements = rows.map(createBookRow);
    body.replaceChildren(...elements);
  }
  rows.forEach((source, index) => {
    const element = elements[index];
    const side = source.askQuote > source.bidQuote ? "ask" : source.bidQuote > source.askQuote ? "bid" : source.price >= middle ? "ask" : "bid";
    const displayedQuote = bookDisplayedQuote(source);
    const anomalyReference = bookAnomalyQuote(source, true);
    const tier = anomalyTierForQuote(anomalyReference, threshold);
    element.className = [
      "book-ladder-row",
      `is-${side}`,
      tier ? "is-anomaly" : "",
      tier ? `is-anomaly-tier-${tier}` : "",
      source.isMarket ? "is-market" : "",
      source.isRound ? "is-price-round" : "",
    ].filter(Boolean).join(" ");
    element.style.setProperty("--size", `${Math.min(100, displayedQuote / Math.max(1, maximumQuote) * 100).toFixed(1)}%`);
    element.firstElementChild.textContent = displayedQuote > 0 ? formatQuote(displayedQuote) : "";
    element.lastElementChild.textContent = formatPrice(source.isMarket ? middle : source.price, baseTick);
  });
}

function workspaceMarkup(symbol, rawAvailable) {
  return `
    <article class="orderbook-card signal-lab-replay-card" data-market="futures">
      <header class="orderbook-heading">
        <h2 data-book-ticker>${String(symbol ?? "").replace("USDT", "")}/USDT · REPLAY</h2>
        <span class="book-status" data-replay-status>SYNCING</span>
        <div class="book-highlight-controls">
          <button class="book-highlight-toggle is-active" type="button" data-replay-auto>AUTO</button>
        </div>
        <button class="book-center-toggle is-active" data-book-center type="button" aria-pressed="true" title="Текущая цена по центру">◎</button>
      </header>
      <div class="orderbook-stage" style="--tape-percent:52%">
        <section class="orderbook-tape" aria-label="Лента и кластеры Replay">
          <div class="trade-tape-toolbar">
            <button class="book-cluster-toggle" data-replay-view type="button" title="Переключить TAPE / КЛ">TAPE</button>
            <button class="book-cluster-toggle" data-replay-source type="button" ${rawAvailable ? "" : "disabled"} title="RAW записывается в shadow-режиме">AGG</button>
            <label title="Показывать сделки не меньше суммы"><span>≥ $</span><input data-trade-min type="number" min="0" step="1000" value="0" /></label>
            <button data-trade-window class="trade-window-button" type="button">1м</button>
            <button data-trade-live class="trade-live-button is-active" type="button">К СОБЫТИЮ</button>
          </div>
          <div class="trade-tape-body">
            <div class="trade-flow" data-replay-flow>
              <canvas class="inpuls-tape-canvas" data-replay-canvas></canvas>
              <span class="book-hover-percent" hidden></span>
              <span class="trade-flow-hint">Колесо — время · КЛ/TAPE · RAW/AGG</span>
            </div>
          </div>
        </section>
        <button class="book-splitter" type="button" aria-label="Изменить ширину ленты"></button>
        <section class="orderbook-ladder" aria-label="Стакан заявок Replay">
          <div class="book-pane-title"><span>САЙЗ</span><span data-book-scale>×10</span><span>ЦЕНА</span></div>
          <div class="orderbook-rows"><div class="orderbook-empty">Восстанавливаю локальную книгу…</div></div>
        </section>
        <span class="book-wheel-hint">Колесо · ручной скролл · Ctrl + колесо — шаг ×1…×1000</span>
      </div>
    </article>`;
}

function qualityAt(replay, selectedAt) {
  let state = replay?.initialCheckpoint?.state ?? replay?.coverage?.state ?? "UNKNOWN";
  for (const row of replay?.qualityEvents ?? []) {
    if ((finite(row?.at) ?? Infinity) > selectedAt) break;
    state = row.state ?? state;
  }
  return state;
}

export function mountSignalLabV4OrderFlowPanel(card, replay) {
  installOrderBookStyles?.();
  const mount = card.querySelector('[data-field="orderbook-workspace"]');
  const quality = card.querySelector('[data-field="flow-quality"]');
  if (!mount) return null;
  if (!replay?.initialCheckpoint) {
    mount.innerHTML = '<div class="book-empty">Полная локальная книга не была записана до этого события.</div>';
    return null;
  }
  const rawAvailable = Array.isArray(replay.rawTrades) && replay.rawTrades.length > 0;
  mount.innerHTML = workspaceMarkup(replay.symbol, rawAvailable);
  const article = mount.querySelector(".orderbook-card");
  const body = article.querySelector(".orderbook-rows");
  const flow = article.querySelector("[data-replay-flow]");
  const canvas = article.querySelector("[data-replay-canvas]");
  const scaleLabel = article.querySelector("[data-book-scale]");
  const centerButton = article.querySelector("[data-book-center]");
  const sourceButton = article.querySelector("[data-replay-source]");
  const viewButton = article.querySelector("[data-replay-view]");
  const minimumInput = article.querySelector("[data-trade-min]");
  const windowButton = article.querySelector("[data-trade-window]");
  const eventButton = article.querySelector("[data-trade-live]");
  const status = article.querySelector("[data-replay-status]");
  const splitter = article.querySelector(".book-splitter");
  const stage = article.querySelector(".orderbook-stage");
  const hover = article.querySelector(".book-hover-percent");

  const model = {
    scaleIndex: 3,
    centered: true,
    viewCenter: null,
    manual: false,
    source: "agg",
    view: "tape",
    timeframe: "5s",
    windowMs: 60_000,
    minimumQuote: 0,
    tapePercent: 52,
  };
  let selectedAt = finite(replay.requestedTo) ?? Date.now();
  let baseTick = null;
  let priceStep = null;
  let lastMiddle = null;

  const trades = () => normalizeReplayTrades(replay, model.source);

  const syncButtons = () => {
    centerButton.classList.toggle("is-active", model.centered);
    centerButton.setAttribute("aria-pressed", String(model.centered));
    sourceButton.textContent = model.source.toUpperCase();
    sourceButton.classList.toggle("is-active", model.source === "raw");
    viewButton.textContent = model.view === "cluster" ? "КЛ" : "TAPE";
    viewButton.classList.toggle("is-active", model.view === "cluster");
    windowButton.textContent = formatTradeWindow(model.windowMs);
  };

  const renderFlow = () => {
    const rows = trades();
    if (model.view === "cluster") {
      drawFootprint(canvas, rows, selectedAt, model.timeframe, Math.max(Number.EPSILON, priceStep ?? baseTick ?? .01), model.minimumQuote);
    } else {
      drawTape(canvas, rows, selectedAt, model.windowMs, model.minimumQuote);
    }
  };

  const render = (nextAt = selectedAt) => {
    selectedAt = finite(nextAt) ?? selectedAt;
    const reconstructed = reconstructOrderBook(replay, selectedAt);
    if (!reconstructed?.bids?.length || !reconstructed?.asks?.length) {
      body.innerHTML = '<div class="orderbook-empty">Локальная книга недоступна в этой точке Replay.</div>';
      renderFlow();
      return;
    }
    const bestBid = reconstructed.bids[0]?.[0];
    const bestAsk = reconstructed.asks[0]?.[0];
    const middle = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? (bestBid + bestAsk) / 2 : null;
    if (!(middle > 0)) return;
    baseTick ??= finite(replay.tickSize) ?? inferPriceTick(reconstructed.bids, reconstructed.asks, middle);
    priceStep = priceStepForScale(baseTick, model.scaleIndex);
    lastMiddle = middle;
    let rowCount = Math.max(9, Math.floor((body.clientHeight || 440) / 18));
    if (rowCount % 2 === 0) rowCount -= 1;
    if (model.centered || !Number.isFinite(model.viewCenter)) model.viewCenter = middle;
    model.viewCenter = clampDepthViewCenter(model.viewCenter, priceStep, rowCount);
    const ladder = buildDepthLadder(
      reconstructed.bids,
      reconstructed.asks,
      middle,
      model.viewCenter,
      priceStep,
      rowCount,
    );
    const scale = bookQuoteScale(reconstructed.bids, reconstructed.asks);
    const maximum = maximumDepthQuote(reconstructed.bids, reconstructed.asks, priceStep, scale.maximum);
    patchRows(body, ladder, middle, maximum, scale.anomalyThreshold, baseTick);
    scaleLabel.textContent = bookScaleLabel(model.scaleIndex);
    scaleLabel.title = `Шаг цены ${formatPrice(priceStep, baseTick)}`;
    const state = qualityAt(replay, selectedAt);
    status.textContent = `${state} · ${formatClock(selectedAt)}`;
    status.classList.toggle("is-live", state === "LIVE" || state === "RECOVERED");
    if (quality) {
      quality.textContent = `${state} · snapshot+diff · ${replay.events?.length ?? 0} diff · ${replay.trades?.length ?? 0} AGG · ${replay.rawTrades?.length ?? 0} RAW`;
      quality.dataset.state = state;
    }
    renderFlow();
  };

  centerButton.addEventListener("click", () => {
    model.centered = !model.centered;
    if (model.centered) model.viewCenter = lastMiddle;
    syncButtons();
    render();
  });
  sourceButton.addEventListener("click", () => {
    if (!rawAvailable) return;
    model.source = model.source === "agg" ? "raw" : "agg";
    syncButtons();
    renderFlow();
  });
  viewButton.addEventListener("click", () => {
    model.view = model.view === "tape" ? "cluster" : "tape";
    syncButtons();
    renderFlow();
  });
  minimumInput.addEventListener("input", () => {
    model.minimumQuote = Math.max(0, finite(minimumInput.value) ?? 0);
    renderFlow();
  });
  windowButton.addEventListener("click", () => {
    const index = Math.max(0, TRADE_WINDOWS.indexOf(model.windowMs));
    model.windowMs = TRADE_WINDOWS[(index + 1) % TRADE_WINDOWS.length];
    syncButtons();
    renderFlow();
  });
  eventButton.addEventListener("click", () => {
    selectedAt = finite(replay.requestedTo) ?? selectedAt;
    render();
    globalThis.dispatchEvent?.(new CustomEvent("inpuls:signal-lab-replay-seek", {
      detail: { episodeId: card.dataset.episodeId ?? null, at: selectedAt },
    }));
  });
  flow.addEventListener("wheel", (event) => {
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault();
    const index = Math.max(0, TRADE_WINDOWS.indexOf(model.windowMs));
    model.windowMs = TRADE_WINDOWS[clamp(index + (event.deltaY > 0 ? 1 : -1), 0, TRADE_WINDOWS.length - 1)];
    syncButtons();
    renderFlow();
  }, { passive: false });
  body.addEventListener("wheel", (event) => {
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0 || !Number.isFinite(priceStep)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      model.scaleIndex = bookScaleIndexForWheel(model.scaleIndex, event.deltaY);
    } else {
      model.centered = false;
      model.manual = true;
      model.viewCenter = clampDepthViewCenter(
        (finite(model.viewCenter) ?? lastMiddle) - Math.sign(event.deltaY) * priceStep * 3,
        priceStep,
        Math.max(9, Math.floor((body.clientHeight || 440) / 18)),
      );
    }
    syncButtons();
    render();
  }, { passive: false });
  body.addEventListener("pointermove", (event) => {
    const row = event.target.closest?.(".book-ladder-row");
    const price = finite(String(row?.lastElementChild?.textContent ?? "").replace(/,/g, ""));
    const label = bookDistancePercentLabel(price, lastMiddle);
    if (!row || !label) {
      hover.hidden = true;
      return;
    }
    hover.textContent = label;
    const rowRect = row.getBoundingClientRect();
    const flowRect = flow.getBoundingClientRect();
    hover.style.top = `${rowRect.top + rowRect.height / 2 - flowRect.top}px`;
    hover.classList.toggle("is-bid", price < lastMiddle);
    hover.classList.toggle("is-ask", price > lastMiddle);
    hover.hidden = false;
  });
  body.addEventListener("pointerleave", () => { hover.hidden = true; });
  splitter.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    splitter.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      const rect = stage.getBoundingClientRect();
      model.tapePercent = clamp((moveEvent.clientX - rect.left) / Math.max(1, rect.width) * 100, 24, 72);
      stage.style.setProperty("--tape-percent", `${model.tapePercent}%`);
      render();
    };
    const stop = () => {
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", stop);
      splitter.removeEventListener("pointercancel", stop);
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", stop);
    splitter.addEventListener("pointercancel", stop);
  });

  syncButtons();
  render(selectedAt);
  return Object.freeze({
    version: SIGNAL_LAB_V5_REPLAY_VIEW_VERSION,
    render,
    destroy() {
      mount.replaceChildren();
    },
  });
}
