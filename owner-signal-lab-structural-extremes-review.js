import { CandlestickChart } from "./chart.js?v=26-117-chart-interaction-performance-v1";
import {
  StructuralExtremeEngine,
  STRUCTURAL_EXTREME_STATUSES,
  STRUCTURAL_TIMEFRAMES,
} from "./signal-lab-v7-structural-extremes.js";

const KLINES_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";
const EXCHANGE_INFO_ENDPOINT = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60_000;
const REVIEW_STORAGE_PREFIX = "inpuls-structural-extremes-review-v1";
const INTERVAL_MS = Object.freeze({
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
});

const REVIEW_TOOL_HINTS = Object.freeze({
  navigate: "Обычный режим: перемещай график мышью и меняй масштаб колёсиком.",
  "add-high": "Кликни по свече, которая должна быть структурным HIGH. Цена привяжется к её high.",
  "add-low": "Кликни по свече, которая должна быть структурным LOW. Цена привяжется к её low.",
  remove: "Кликни рядом с лишним лучом алгоритма. Он будет отмечен как лишний экстремум.",
  move: "Сначала кликни рядом с неверным лучом, затем по правильной свече.",
  confirm: "Кликни на нужной свече рядом с уровнем: здесь экстремум должен подтверждаться.",
  cross: "Кликни на свече фактического прохода рядом с уровнем: здесь уровень должен сниматься.",
  attacks: "Укажи ×N и кликни рядом с уровнем, для которого неверно посчитаны отдельные атаки.",
  line: "Поставь две точки — получится вспомогательная линия. Ctrl удерживает привязку к OHLC.",
  freehand: "Рисуй мышью прямо на графике. После отпускания рисунок сохранится в разметке.",
});

const STRUCTURED_REVIEW_TOOLS = new Set([
  "add-high",
  "add-low",
  "remove",
  "move",
  "confirm",
  "cross",
  "attacks",
]);

const elements = {
  symbol: document.querySelector("#symbol"),
  endAt: document.querySelector("#end-at"),
  load: document.querySelector("#load"),
  showExtremes: document.querySelector("#show-extremes"),
  showHistory: document.querySelector("#show-history"),
  showCandidate: document.querySelector("#show-candidate"),
  timeframeButtons: [...document.querySelectorAll("[data-timeframe]")],
  timeframes: document.querySelector(".timeframes"),
  source: document.querySelector("#source"),
  coverage: document.querySelector("#coverage"),
  candlesCount: document.querySelector("#candles-count"),
  direction: document.querySelector("#direction"),
  activeCount: document.querySelector("#active-count"),
  historyCount: document.querySelector("#history-count"),
  status: document.querySelector("#status"),
  canvas: document.querySelector("#chart"),
  chartPanel: document.querySelector(".chart-panel"),
  tooltip: document.querySelector("#tooltip"),
  currentDiagnostic: document.querySelector("#current-diagnostic"),
  extremeRows: document.querySelector("#extreme-rows"),
};

function installReviewUi() {
  elements.timeframes.insertAdjacentHTML("afterend", `
    <section class="review-tools" aria-label="Инструменты разметки экстремумов">
      <div class="review-tools__title">
        <div>
          <strong>Разметка для обучения</strong>
          <span>Выбери действие и кликни по графику</span>
        </div>
        <span id="review-save-state">Сохраняется в браузере</span>
      </div>
      <div class="review-tool-buttons">
        <button type="button" data-review-tool="navigate" class="is-active">↔ Навигация</button>
        <button type="button" data-review-tool="add-high">+ HIGH</button>
        <button type="button" data-review-tool="add-low">+ LOW</button>
        <button type="button" data-review-tool="remove">✕ Лишний</button>
        <button type="button" data-review-tool="move">⇢ Перенести</button>
        <button type="button" data-review-tool="confirm">│ Подтверждение</button>
        <button type="button" data-review-tool="cross">⚡ Пробой</button>
        <button type="button" data-review-tool="attacks">×N Атаки</button>
        <button type="button" data-review-tool="line">／ Линия</button>
        <button type="button" data-review-tool="freehand">✎ Карандаш</button>
      </div>
      <div class="review-tool-options">
        <label>Атаки ×N <input id="review-attack-count" type="number" min="1" max="20" value="2" /></label>
        <label class="review-comment">Комментарий к следующей метке
          <input id="review-comment" maxlength="180" placeholder="Например: движение ещё не закончилось" />
        </label>
        <button id="review-undo" type="button">Отменить метку</button>
        <button id="review-clear" type="button">Очистить</button>
        <button id="review-copy" type="button">Скопировать JSON</button>
        <button id="review-export" type="button" class="is-primary">Скачать разметку</button>
      </div>
      <p id="review-tool-hint" class="review-tool-hint"></p>
    </section>
  `);

  elements.chartPanel.insertAdjacentHTML("afterend", `
    <section class="review-feedback">
      <div class="review-feedback__head">
        <div>
          <h2>Моя разметка <span id="review-count">0</span></h2>
          <p>После проверки скачай JSON и отправь его в чат. В нём будут монета, ТФ, свечи, все метки и рисунки.</p>
        </div>
      </div>
      <ol id="review-notes" class="review-notes"><li class="review-empty">Пока нет правок.</li></ol>
    </section>
  `);

  return {
    toolButtons: [...document.querySelectorAll("[data-review-tool]")],
    attackCount: document.querySelector("#review-attack-count"),
    comment: document.querySelector("#review-comment"),
    undo: document.querySelector("#review-undo"),
    clear: document.querySelector("#review-clear"),
    copy: document.querySelector("#review-copy"),
    export: document.querySelector("#review-export"),
    hint: document.querySelector("#review-tool-hint"),
    count: document.querySelector("#review-count"),
    notes: document.querySelector("#review-notes"),
    saveState: document.querySelector("#review-save-state"),
  };
}

const reviewUi = installReviewUi();
const chart = new CandlestickChart(elements.canvas, elements.tooltip, { storageKey: null });
chart.setVolumeVisible(true);
chart.setSessionsVisible(true);

let timeframe = "1h";
let current = null;
let generation = 0;
let abortController = null;
let reviewTool = "navigate";
let pendingMoveExtreme = null;
let reviewCorrections = [];
const cache = new Map();
const tickSizeCache = new Map();

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function validSymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,20}USDT$/.test(symbol) ? symbol : null;
}

function formatDateTime(timestamp) {
  const value = finite(timestamp);
  if (value === null) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatShortDateTime(timestamp) {
  const value = finite(timestamp);
  if (value === null) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPercent(value) {
  const number = finite(value);
  return number === null ? "—" : `${number.toFixed(3)}%`;
}

function localDateTimeValue(timestamp) {
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseKline(row, endAt) {
  if (!Array.isArray(row) || row.length < 7) return null;
  const candle = {
    time: finite(row[0]),
    open: finite(row[1]),
    high: finite(row[2]),
    low: finite(row[3]),
    close: finite(row[4]),
    volume: Math.max(0, finite(row[5]) ?? 0),
    closeTime: finite(row[6]),
    closed: finite(row[6]) <= endAt,
  };
  return candle.closed
    && [candle.time, candle.open, candle.high, candle.low, candle.close]
      .every((value) => value !== null && value > 0)
    ? candle
    : null;
}

async function fetchTickSize(symbol, signal) {
  if (tickSizeCache.has(symbol)) return tickSizeCache.get(symbol);
  const url = new URL(EXCHANGE_INFO_ENDPOINT);
  url.searchParams.set("symbol", symbol);
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Binance exchangeInfo HTTP ${response.status}`);
  const payload = await response.json();
  const market = Array.isArray(payload?.symbols) ? payload.symbols[0] : null;
  const filter = (Array.isArray(market?.filters) ? market.filters : [])
    .find((row) => row?.filterType === "PRICE_FILTER");
  const tickSize = finite(filter?.tickSize);
  if (!(tickSize > 0)) throw new Error("Binance не вернул tickSize");
  tickSizeCache.set(symbol, tickSize);
  return tickSize;
}

async function fetchThirtyDays(symbol, selectedTimeframe, endAt, signal) {
  const intervalMs = INTERVAL_MS[selectedTimeframe];
  const startAt = endAt - THIRTY_DAYS_MS;
  const key = `${symbol}:${selectedTimeframe}:${Math.floor(endAt / intervalMs)}`;
  if (cache.has(key)) return structuredClone(cache.get(key));

  const candles = [];
  let cursor = startAt;
  let pages = 0;
  const expected = Math.ceil(THIRTY_DAYS_MS / intervalMs) + 2;
  const maximumPages = Math.min(64, Math.max(2, Math.ceil(expected / 1_500) + 2));
  while (cursor <= endAt && pages < maximumPages && candles.length < 50_500) {
    const url = new URL(KLINES_ENDPOINT);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", selectedTimeframe);
    url.searchParams.set("startTime", String(Math.floor(cursor)));
    url.searchParams.set("endTime", String(Math.floor(endAt)));
    url.searchParams.set("limit", "1500");
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Binance ${selectedTimeframe} klines HTTP ${response.status}`);
    const payload = await response.json();
    const page = (Array.isArray(payload) ? payload : [])
      .map((row) => parseKline(row, endAt))
      .filter(Boolean);
    pages += 1;
    if (!page.length) break;
    for (const row of page) {
      if (row.time < startAt || row.time > endAt) continue;
      if (!candles.length || row.time > candles.at(-1).time) candles.push(row);
    }
    const next = page.at(-1).time + intervalMs;
    if (!(next > cursor)) break;
    cursor = next;
    if (page.length < 1_500) break;
  }
  if (!candles.length) throw new Error("Binance не вернул закрытые свечи");

  const expectedFirst = Math.ceil(startAt / intervalMs) * intervalMs;
  const expectedLast = Math.floor(endAt / intervalMs) * intervalMs;
  const actualFirst = candles[0].time;
  const actualLast = candles.at(-1).time;
  const requestedSpan = Math.max(intervalMs, expectedLast - expectedFirst + intervalMs);
  const coveredSpan = Math.max(
    0,
    Math.min(expectedLast, actualLast) - Math.max(expectedFirst, actualFirst) + intervalMs,
  );
  const result = {
    candles,
    pages,
    startAt,
    endAt,
    coverageRatio: Math.min(1, coveredSpan / requestedSpan),
    complete: actualFirst <= expectedFirst + intervalMs && actualLast >= expectedLast - intervalMs,
  };
  cache.set(key, result);
  while (cache.size > 12) cache.delete(cache.keys().next().value);
  return structuredClone(result);
}

function algorithmAnnotationRows(snapshot) {
  if (!elements.showExtremes.checked || !snapshot) return [];
  const rows = [];
  const source = elements.showHistory.checked ? snapshot.history : snapshot.active;
  for (const extreme of source) {
    if (!elements.showHistory.checked && !extreme.active) continue;
    const endAt = extreme.active
      ? current?.loaded?.endAt
      : extreme.crossedAt ?? current?.loaded?.endAt;
    rows.push({
      type: "segment",
      a: { time: extreme.extremeAt, price: extreme.price },
      b: { time: endAt, price: extreme.price },
      label: `${extreme.side === "HIGH" ? "H" : "L"} ${snapshot.timeframe} · атак ${extreme.touchCount}`,
      tone: extreme.side === "HIGH" ? "danger" : "success",
      state: extreme.status,
    });
  }
  if (elements.showCandidate.checked && snapshot.candidate) {
    rows.push({
      type: "ray",
      startAt: snapshot.candidate.extremeAt,
      price: snapshot.candidate.price,
      label: `${snapshot.candidate.side === "HIGH" ? "H" : "L"} candidate`,
      tone: "warning",
      state: STRUCTURAL_EXTREME_STATUSES.CANDIDATE,
    });
  }
  return rows;
}

function reviewAnnotationRows() {
  const endAt = current?.loaded?.endAt;
  const rows = [];
  for (const correction of reviewCorrections) {
    const comment = correction.comment ? ` · ${correction.comment.slice(0, 28)}` : "";
    if (correction.type === "ADD_EXTREME") {
      const tone = correction.side === "HIGH" ? "danger" : "success";
      rows.push({
        type: "ray",
        startAt: correction.time,
        price: correction.price,
        label: `ДОЛЖЕН БЫТЬ ${correction.side}${comment}`,
        tone,
        state: "MANUAL_EXPECTED",
      });
      rows.push({ type: "point", time: correction.time, price: correction.price, tone, label: correction.side });
    } else if (correction.type === "REMOVE_EXTREME") {
      rows.push({
        type: "point",
        time: correction.extremeAt,
        price: correction.price,
        tone: "danger",
        label: `ЛИШНИЙ ${correction.side}${comment}`,
      });
    } else if (correction.type === "MOVE_EXTREME") {
      rows.push({
        type: "segment",
        a: { time: correction.from.time, price: correction.from.price },
        b: { time: correction.to.time, price: correction.to.price },
        tone: "warning",
        label: `ПЕРЕНЕСТИ ${correction.side}`,
      });
      rows.push({ type: "point", time: correction.from.time, price: correction.from.price, tone: "danger", label: "НЕ ЗДЕСЬ" });
      rows.push({ type: "point", time: correction.to.time, price: correction.to.price, tone: "success", label: `${correction.side} СЮДА${comment}` });
    } else if (correction.type === "CONFIRM_AT") {
      rows.push({ type: "event", time: correction.time, tone: "blue", label: `ПОДТВЕРДИТЬ ЗДЕСЬ${comment}` });
      rows.push({ type: "point", time: correction.time, price: correction.price, tone: "blue", label: correction.side });
    } else if (correction.type === "CROSS_AT") {
      rows.push({ type: "event", time: correction.time, tone: "accent", label: `ПРОБОЙ ЗДЕСЬ${comment}` });
      rows.push({ type: "point", time: correction.time, price: correction.price, tone: "accent", label: correction.side });
    } else if (correction.type === "ATTACK_COUNT") {
      rows.push({
        type: "point",
        time: correction.extremeAt,
        price: correction.price,
        tone: "warning",
        label: `ДОЛЖНО БЫТЬ ×${correction.count}${comment}`,
      });
      if (Number.isFinite(endAt)) {
        rows.push({
          type: "segment",
          a: { time: correction.extremeAt, price: correction.price },
          b: { time: endAt, price: correction.price },
          tone: "warning",
          label: `×${correction.count}`,
        });
      }
    }
  }
  return rows;
}

function annotationRows(snapshot) {
  return [...algorithmAnnotationRows(snapshot), ...reviewAnnotationRows()];
}

function renderDiagnostics(snapshot) {
  elements.direction.textContent = snapshot?.direction ?? "—";
  elements.activeCount.textContent = String(snapshot?.active?.length ?? 0);
  elements.historyCount.textContent = String(snapshot?.history?.length ?? 0);
  elements.currentDiagnostic.textContent = snapshot
    ? JSON.stringify(snapshot.diagnostics, null, 2)
    : "—";

  const rows = [...(snapshot?.history ?? [])].reverse().slice(0, 200);
  elements.extremeRows.replaceChildren(...rows.map((extreme) => {
    const row = document.createElement("tr");
    row.dataset.active = String(Boolean(extreme.active));
    const values = [
      extreme.side,
      String(extreme.price),
      formatDateTime(extreme.extremeAt),
      formatDateTime(extreme.confirmedAt),
      formatPercent(extreme.swingAmplitudePct),
      formatPercent(extreme.confirmingReversalPct),
      formatPercent(extreme.reversalThresholdPct),
      extreme.atrAtConfirmation ?? "—",
      extreme.status,
      extreme.touchCount,
    ];
    row.replaceChildren(...values.map((value) => {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      return cell;
    }));
    return row;
  }));
}

function correctionDescription(correction) {
  const time = correction.time ?? correction.extremeAt ?? correction.to?.time;
  const suffix = correction.comment ? ` — ${correction.comment}` : "";
  if (correction.type === "ADD_EXTREME") return `Добавить ${correction.side} на ${formatShortDateTime(time)} по ${correction.price}${suffix}`;
  if (correction.type === "REMOVE_EXTREME") return `Лишний ${correction.side} ${formatShortDateTime(correction.extremeAt)} по ${correction.price}${suffix}`;
  if (correction.type === "MOVE_EXTREME") return `Перенести ${correction.side}: ${formatShortDateTime(correction.from.time)} → ${formatShortDateTime(correction.to.time)}${suffix}`;
  if (correction.type === "CONFIRM_AT") return `${correction.side} должен подтвердиться ${formatShortDateTime(correction.time)}${suffix}`;
  if (correction.type === "CROSS_AT") return `${correction.side} должен быть пробит ${formatShortDateTime(correction.time)}${suffix}`;
  if (correction.type === "ATTACK_COUNT") return `${correction.side} по ${correction.price}: должно быть ×${correction.count}${suffix}`;
  return correction.type;
}

function renderReviewList() {
  reviewUi.count.textContent = String(reviewCorrections.length + chart.drawings.length);
  const items = [];
  for (const correction of reviewCorrections) {
    const item = document.createElement("li");
    item.dataset.type = correction.type;
    const text = document.createElement("span");
    text.textContent = correctionDescription(correction);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Удалить";
    remove.addEventListener("click", () => {
      reviewCorrections = reviewCorrections.filter((row) => row.id !== correction.id);
      persistReviewState();
      updateAnnotations();
    });
    item.append(text, remove);
    items.push(item);
  }
  if (chart.drawings.length) {
    const item = document.createElement("li");
    item.dataset.type = "DRAWINGS";
    const text = document.createElement("span");
    text.textContent = `Рисунки на графике: ${chart.drawings.length}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Очистить рисунки";
    remove.addEventListener("click", () => {
      chart.drawings = [];
      chart.undoStack = [];
      persistReviewState();
      chart.render();
      renderReviewList();
    });
    item.append(text, remove);
    items.push(item);
  }
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "review-empty";
    empty.textContent = "Пока нет правок.";
    items.push(empty);
  }
  reviewUi.notes.replaceChildren(...items);
}

function updateAnnotations() {
  chart.setAnnotations(annotationRows(current?.snapshot));
  renderDiagnostics(current?.snapshot ?? null);
  renderReviewList();
}

function reviewStorageKey(symbol = current?.symbol, selectedTimeframe = current?.timeframe ?? timeframe) {
  return symbol ? `${REVIEW_STORAGE_PREFIX}:${symbol}:${selectedTimeframe}` : null;
}

function persistReviewState() {
  const key = reviewStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      corrections: reviewCorrections,
      drawings: chart.drawings,
      updatedAt: Date.now(),
    }));
    reviewUi.saveState.textContent = `Сохранено ${new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    reviewUi.saveState.textContent = "Не удалось сохранить локально";
  }
  renderReviewList();
}

function restoreReviewState() {
  reviewCorrections = [];
  chart.drawings = [];
  chart.undoStack = [];
  const key = reviewStorageKey();
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    reviewCorrections = Array.isArray(saved?.corrections) ? saved.corrections : [];
    chart.drawings = Array.isArray(saved?.drawings) ? saved.drawings : [];
    reviewUi.saveState.textContent = saved?.updatedAt
      ? `Восстановлено ${new Date(saved.updatedAt).toLocaleString("ru-RU")}`
      : "Сохраняется в браузере";
  } catch {
    reviewCorrections = [];
    chart.drawings = [];
  }
}

function exportReviewPayload() {
  const snapshot = current?.snapshot;
  return {
    schemaVersion: 1,
    entity: "InPulsStructuralExtremesTraderReview",
    exportedAt: Date.now(),
    symbol: current?.symbol ?? validSymbol(elements.symbol.value),
    timeframe: current?.timeframe ?? timeframe,
    source: "BINANCE_USDM_FUTURES",
    algorithmVersion: snapshot?.algorithmVersion ?? null,
    range: current?.loaded ? {
      startAt: current.loaded.startAt,
      endAt: current.loaded.endAt,
      candles: current.loaded.candles.length,
      coverageRatio: current.loaded.coverageRatio,
      complete: current.loaded.complete,
    } : null,
    corrections: structuredClone(reviewCorrections),
    drawings: structuredClone(chart.drawings),
    algorithmExtremes: (snapshot?.history ?? []).map((row) => ({
      id: row.id,
      side: row.side,
      price: row.price,
      extremeAt: row.extremeAt,
      confirmedAt: row.confirmedAt,
      status: row.status,
      active: row.active,
      touchCount: row.touchCount,
      swingAmplitudePct: row.swingAmplitudePct,
      confirmingReversalPct: row.confirmingReversalPct,
      reversalThresholdPct: row.reversalThresholdPct,
    })),
  };
}

function reviewJson() {
  return JSON.stringify(exportReviewPayload(), null, 2);
}

function downloadReview() {
  const payload = reviewJson();
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const symbol = current?.symbol ?? "UNKNOWN";
  const selectedTimeframe = current?.timeframe ?? timeframe;
  anchor.href = url;
  anchor.download = `inpuls-extremes-review-${symbol}-${selectedTimeframe}-${Date.now()}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  elements.status.dataset.state = "complete";
  elements.status.textContent = "Разметка скачана. Отправь JSON-файл в чат — по нему можно точно менять алгоритм.";
}

async function copyReview() {
  try {
    await navigator.clipboard.writeText(reviewJson());
    elements.status.dataset.state = "complete";
    elements.status.textContent = "JSON разметки скопирован в буфер обмена.";
  } catch {
    elements.status.dataset.state = "error";
    elements.status.textContent = "Браузер не дал доступ к буферу. Используй «Скачать разметку».";
  }
}

function setReviewTool(nextTool) {
  reviewTool = REVIEW_TOOL_HINTS[nextTool] ? nextTool : "navigate";
  pendingMoveExtreme = null;
  chart.setTool(reviewTool === "line" ? "trend" : reviewTool === "freehand" ? "freehand" : null);
  reviewUi.toolButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.reviewTool === reviewTool);
  });
  reviewUi.hint.textContent = REVIEW_TOOL_HINTS[reviewTool];
  elements.canvas.dataset.reviewTool = reviewTool;
}

function candleIndexForTime(timestamp) {
  const candles = current?.loaded?.candles ?? [];
  if (!candles.length) return -1;
  let low = 0;
  let high = candles.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].time < timestamp) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(candles[low - 1].time - timestamp) < Math.abs(candles[low].time - timestamp)) return low - 1;
  return low;
}

function pointerChartPoint(event) {
  if (!chart.layout || !chart.candles.length) return null;
  const rect = elements.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const { margins, plotWidth, plotHeight, priceBottom, minPrice, maxPrice } = chart.layout;
  if (x < margins.left || x > margins.left + plotWidth || y < margins.top || y > priceBottom) return null;
  const slot = chart.viewStart + ((x - margins.left) / plotWidth) * chart.visibleCount - 0.5;
  const index = clamp(Math.round(slot), 0, chart.candles.length - 1);
  const candle = chart.candles[index];
  const rawPrice = maxPrice - ((y - margins.top) / plotHeight) * (maxPrice - minPrice);
  return { x, y, index, candle, rawPrice };
}

function nearestAlgorithmExtreme(point) {
  const snapshot = current?.snapshot;
  if (!snapshot || !chart.layout) return null;
  const source = elements.showHistory.checked ? snapshot.history : snapshot.active;
  const { margins, plotWidth, plotHeight, minPrice, maxPrice } = chart.layout;
  let best = null;
  for (const extreme of source) {
    const index = candleIndexForTime(extreme.extremeAt);
    if (index < 0) continue;
    const originX = margins.left + ((index + 0.5 - chart.viewStart) / chart.visibleCount) * plotWidth;
    if (point.candle.time < extreme.extremeAt || point.x < originX - 10) continue;
    const levelY = margins.top + ((maxPrice - extreme.price) / (maxPrice - minPrice)) * plotHeight;
    const verticalDistance = Math.abs(point.y - levelY);
    if (verticalDistance > 30) continue;
    const score = verticalDistance + Math.min(10, Math.max(0, originX - point.x));
    if (!best || score < best.score) best = { extreme, score };
  }
  return best?.extreme ?? null;
}

function correctionBase(type) {
  return {
    id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    symbol: current?.symbol,
    timeframe: current?.timeframe,
    createdAt: Date.now(),
    comment: reviewUi.comment.value.trim() || undefined,
  };
}

function addCorrection(correction) {
  reviewCorrections.push(correction);
  reviewUi.comment.value = "";
  persistReviewState();
  updateAnnotations();
  chart.render();
}

function requireExtreme(point) {
  const extreme = nearestAlgorithmExtreme(point);
  if (!extreme) {
    elements.status.dataset.state = "error";
    elements.status.textContent = "Не попал в луч экстремума. Приблизь график и кликни ближе к горизонтальному уровню.";
    return null;
  }
  return extreme;
}

function handleStructuredReviewClick(event) {
  if (!STRUCTURED_REVIEW_TOOLS.has(reviewTool)) return;
  const point = pointerChartPoint(event);
  if (!point) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  if (reviewTool === "add-high" || reviewTool === "add-low") {
    const side = reviewTool === "add-high" ? "HIGH" : "LOW";
    addCorrection({
      ...correctionBase("ADD_EXTREME"),
      side,
      time: point.candle.time,
      closeTime: point.candle.closeTime,
      price: side === "HIGH" ? point.candle.high : point.candle.low,
    });
    return;
  }

  if (reviewTool === "move" && pendingMoveExtreme) {
    const side = pendingMoveExtreme.side;
    addCorrection({
      ...correctionBase("MOVE_EXTREME"),
      extremeId: pendingMoveExtreme.id,
      side,
      from: { time: pendingMoveExtreme.extremeAt, price: pendingMoveExtreme.price },
      to: {
        time: point.candle.time,
        closeTime: point.candle.closeTime,
        price: side === "HIGH" ? point.candle.high : point.candle.low,
      },
    });
    pendingMoveExtreme = null;
    reviewUi.hint.textContent = REVIEW_TOOL_HINTS.move;
    return;
  }

  const extreme = requireExtreme(point);
  if (!extreme) return;

  if (reviewTool === "remove") {
    addCorrection({
      ...correctionBase("REMOVE_EXTREME"),
      extremeId: extreme.id,
      side: extreme.side,
      extremeAt: extreme.extremeAt,
      price: extreme.price,
    });
  } else if (reviewTool === "move") {
    pendingMoveExtreme = extreme;
    reviewUi.hint.textContent = `${extreme.side} ${extreme.price} выбран. Теперь кликни по правильной свече.`;
  } else if (reviewTool === "confirm") {
    addCorrection({
      ...correctionBase("CONFIRM_AT"),
      extremeId: extreme.id,
      side: extreme.side,
      levelPrice: extreme.price,
      price: extreme.price,
      time: point.candle.time,
      closeTime: point.candle.closeTime,
    });
  } else if (reviewTool === "cross") {
    addCorrection({
      ...correctionBase("CROSS_AT"),
      extremeId: extreme.id,
      side: extreme.side,
      levelPrice: extreme.price,
      price: extreme.price,
      time: point.candle.time,
      closeTime: point.candle.closeTime,
    });
  } else if (reviewTool === "attacks") {
    const count = clamp(Math.round(finite(reviewUi.attackCount.value) ?? 2), 1, 20);
    reviewUi.attackCount.value = String(count);
    addCorrection({
      ...correctionBase("ATTACK_COUNT"),
      extremeId: extreme.id,
      side: extreme.side,
      extremeAt: extreme.extremeAt,
      price: extreme.price,
      count,
    });
  }
}

async function load() {
  persistReviewState();
  const symbol = validSymbol(elements.symbol.value);
  const endAt = new Date(elements.endAt.value).getTime();
  if (!symbol || !Number.isFinite(endAt)) {
    elements.status.dataset.state = "error";
    elements.status.textContent = "Проверь символ и конец периода.";
    return;
  }
  generation += 1;
  const localGeneration = generation;
  abortController?.abort();
  abortController = new AbortController();
  elements.status.dataset.state = "loading";
  elements.status.textContent = `Загружаю ${symbol} · ${timeframe} · 30 дней закрытых свечей…`;
  elements.load.disabled = true;
  try {
    const [tickSize, loaded] = await Promise.all([
      fetchTickSize(symbol, abortController.signal),
      fetchThirtyDays(symbol, timeframe, endAt, abortController.signal),
    ]);
    if (localGeneration !== generation) return;
    const engine = new StructuralExtremeEngine({ symbol, timeframe, tickSize });
    engine.ingestCandles(loaded.candles);
    const snapshot = engine.snapshot();
    current = { symbol, timeframe, tickSize, loaded, snapshot };

    chart.setData(loaded.candles, {
      symbol,
      interval: timeframe,
      range: "structural-review-30d",
      targetCandles: loaded.candles.length,
    });
    chart.followLatest = false;
    chart.centerLatest = false;
    chart.visibleCount = Math.min(300, loaded.candles.length);
    chart.viewStart = Math.max(0, loaded.candles.length - chart.visibleCount);
    chart.priceScale = 1;
    chart.pricePan = 0;
    chart.fixedPriceDomain = null;
    restoreReviewState();
    updateAnnotations();
    chart.render();

    elements.source.textContent = "BINANCE USDⓈ-M FUTURES";
    elements.coverage.textContent = `${(loaded.coverageRatio * 100).toFixed(1)}% · ${loaded.complete ? "COMPLETE" : "PARTIAL"}`;
    elements.candlesCount.textContent = `${loaded.candles.length} · ${loaded.pages} стр.`;
    elements.status.dataset.state = loaded.complete ? "complete" : "error";
    elements.status.textContent = `${symbol} · ${timeframe} · ${formatDateTime(loaded.startAt)} → ${formatDateTime(loaded.endAt)} · выбери инструмент разметки над графиком.`;
  } catch (error) {
    if (error?.name === "AbortError") return;
    elements.status.dataset.state = "error";
    elements.status.textContent = `Не удалось загрузить проверку: ${String(error?.message ?? error)}`;
  } finally {
    if (localGeneration === generation) elements.load.disabled = false;
  }
}

for (const button of elements.timeframeButtons) {
  button.addEventListener("click", () => {
    const next = button.dataset.timeframe;
    if (!STRUCTURAL_TIMEFRAMES.includes(next) || next === timeframe) return;
    persistReviewState();
    timeframe = next;
    elements.timeframeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    setReviewTool("navigate");
    load();
  });
}

for (const button of reviewUi.toolButtons) {
  button.addEventListener("click", () => setReviewTool(button.dataset.reviewTool));
}

reviewUi.undo.addEventListener("click", () => {
  if (reviewCorrections.length) reviewCorrections.pop();
  else chart.undoDrawing();
  persistReviewState();
  updateAnnotations();
  chart.render();
});

reviewUi.clear.addEventListener("click", () => {
  if (!reviewCorrections.length && !chart.drawings.length) return;
  if (!window.confirm("Удалить всю ручную разметку для этой монеты и таймфрейма?")) return;
  reviewCorrections = [];
  chart.drawings = [];
  chart.undoStack = [];
  persistReviewState();
  updateAnnotations();
  chart.render();
});

reviewUi.copy.addEventListener("click", copyReview);
reviewUi.export.addEventListener("click", downloadReview);
elements.load.addEventListener("click", load);
elements.showExtremes.addEventListener("change", updateAnnotations);
elements.showHistory.addEventListener("change", updateAnnotations);
elements.showCandidate.addEventListener("change", updateAnnotations);
elements.canvas.addEventListener("pointerdown", handleStructuredReviewClick, true);
elements.canvas.addEventListener("pointerup", () => {
  setTimeout(() => {
    if ((reviewTool === "line" || reviewTool === "freehand") && !chart.activeTool) setReviewTool("navigate");
    persistReviewState();
    renderReviewList();
  }, 0);
});
elements.canvas.addEventListener("contextmenu", () => setTimeout(persistReviewState, 0));
window.addEventListener("beforeunload", () => {
  persistReviewState();
  chart.destroy();
}, { once: true });

setReviewTool("navigate");
elements.endAt.value = localDateTimeValue(Date.now() - 5 * 60_000);
load();
