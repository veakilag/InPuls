const BUILD = "26-63-signal-lab-tagging-snapshot-v1";
const BOOT_TIMEOUT_MS = 12_000;
const REPORT_TIMEOUT_MS = 10_000;
const STARTED_EVENT = "inpuls:owner-signal-lab-started";

window.dispatchEvent(new Event(STARTED_EVENT));

const SIGNAL_LABELS = Object.freeze({
  impulse: "Импульс",
  knife: "Нож",
  sharpening: "Заточка",
  cascade: "Каскад",
  breakout_resistance: "Пробой УС",
  breakout_support: "Пробой УП",
  liquidation_cascade: "Каскад ликвидаций",
  rearranger: "Переставляш",
  size_supporter: "Подставляш",
  breakout: "Пробой · legacy",
  compression: "Сжатие · legacy",
});

const DIRECTION_LABELS = Object.freeze({
  up: "Вверх",
  down: "Вниз",
  neutral: "Нейтрально",
});

const HORIZON_LABELS = Object.freeze({
  "15s": "15с",
  "1m": "1м",
  "3m": "3м",
  "5m": "5м",
});

const EVIDENCE_LABELS = Object.freeze({
  none: "Нет выборки",
  insufficient: "Мало данных",
  exploratory: "Исследуем",
  substantial: "Крупная выборка",
});

const REVIEW_REASONS = Object.freeze([
  ["", "Причина (необязательно)"],
  ["wrong-structure", "Неверно собран паттерн"],
  ["weak-extremes", "Плохие экстремумы / уровень"],
  ["late-trigger", "Слишком поздний сигнал"],
  ["noise", "Обычный рыночный шум"],
  ["bad-liquidity", "Плохая ликвидность"],
  ["other", "Другое"],
]);

const MINI_CHART_INTERVALS = Object.freeze({
  "1m": { label: "1 мин", intervalMs: 60_000 },
  "5m": { label: "5 мин", intervalMs: 300_000 },
  "1h": { label: "1 час", intervalMs: 3_600_000 },
});
const miniChartCache = new Map();

const elements = {
  storageState: document.querySelector("#storage-state"),
  windowButtons: [...document.querySelectorAll("[data-window]")],
  symbolFilter: document.querySelector("#symbol-filter"),
  signalFilter: document.querySelector("#signal-filter"),
  horizonFilter: document.querySelector("#horizon-filter"),
  resultFilter: document.querySelector("#result-filter"),
  viewButtons: [...document.querySelectorAll("[data-view]")],
  refresh: document.querySelector("#refresh-report"),
  summaryHits: document.querySelector("#summary-hits"),
  summaryHitsNote: document.querySelector("#summary-hits-note"),
  summaryRate: document.querySelector("#summary-rate"),
  summaryBest: document.querySelector("#summary-best"),
  summaryBestNote: document.querySelector("#summary-best-note"),
  summaryCoverage: document.querySelector("#summary-coverage"),
  generatedAt: document.querySelector("#generated-at"),
  body: document.querySelector("#signal-lab-body"),
  empty: document.querySelector("#owner-empty"),
  emptyTitle: document.querySelector("#owner-empty-title"),
  emptyMessage: document.querySelector("#owner-empty-message"),
  eventList: document.querySelector("#event-review-list"),
  eventEmpty: document.querySelector("#event-review-empty"),
  reviewProgress: document.querySelector("#review-progress"),
  exportJson: document.querySelector("#export-json"),
  exportCsv: document.querySelector("#export-csv"),
};

let buildInPulsNavigationUrl = null;
let store = null;
let selectedWindow = "7d";
let selectedView = "winners";
let report = null;
let loading = false;
let booting = null;
let lastError = null;
let localReviews = new Map();

function normalizedError(error, fallback = "unknown-owner-signal-lab-error") {
  const message = String(error?.message || error || fallback).slice(0, 240);
  return {
    code: error?.code || fallback,
    message,
  };
}

function withTimeout(promise, timeoutMs, code) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(code);
      error.code = code;
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function updateOwnerRuntime() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.register(
    `./sw.js?v=${BUILD}`,
    { scope: "./", updateViaCache: "none" },
  );
  await registration.update();
  return registration;
}

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatInteger(value) {
  const numeric = finite(value);
  return numeric === null ? "—" : Math.round(numeric).toLocaleString("ru-RU");
}

function formatPercent(value, digits = 2) {
  const numeric = finite(value);
  if (numeric === null) return "—";
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(digits)}%`;
}

function formatDuration(value) {
  const milliseconds = finite(value);
  if (milliseconds === null) return "—";
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)}с`;
  return `${(milliseconds / 60_000).toFixed(milliseconds < 600_000 ? 1 : 0)}м`;
}

function metricTone(value) {
  const numeric = finite(value);
  if (numeric === null || numeric === 0) return "";
  return numeric > 0 ? "metric-positive" : "metric-negative";
}

function appendTextElement(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function createMetric(label, value, note, { className = "", valueClass = "" } = {}) {
  const metric = document.createElement("div");
  metric.className = className;
  appendTextElement(metric, "span", label);
  appendTextElement(metric, "strong", value, valueClass);
  appendTextElement(metric, "small", note);
  return metric;
}

function shortEventId(id) {
  const value = String(id || "");
  const parts = value.split(":");
  return parts.length >= 5
    ? `${parts[1]}-${parts[2]}-${parts[3]}-${parts.at(-1)}`
    : value.slice(-36);
}

function candleSeriesForEvent(event, intervalMs = 60_000, sourceCandles = null) {
  const candles = (event?.context?.chartContext?.candles ?? [])
    .concat(sourceCandles ?? [])
    .map((candle) => ({
      time: Number(candle.time),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
    }))
    .filter((candle) => (
      Number.isFinite(candle.time)
      && [candle.open, candle.high, candle.low, candle.close]
        .every((value) => Number.isFinite(value) && value > 0)
    ));
  const byTime = new Map(candles.map((candle) => [candle.time, { ...candle, sampledAfter: false }]));
  for (const point of sourceCandles ? [] : (event?.observation?.pricePath ?? [])) {
    const at = Number(point?.at);
    const price = Number(point?.price);
    if (!Number.isFinite(at) || !Number.isFinite(price) || price <= 0) continue;
    const time = Math.floor(at / intervalMs) * intervalMs;
    const existing = byTime.get(time);
    if (existing) {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.sampledAfter = true;
    } else {
      byTime.set(time, {
        time,
        open: price,
        high: price,
        low: price,
        close: price,
        sampledAfter: true,
      });
    }
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

function aggregateCandles(candles, intervalMs) {
  const buckets = new Map();
  candles.forEach((candle) => {
    const time = Math.floor(candle.time / intervalMs) * intervalMs;
    const existing = buckets.get(time);
    if (existing) {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
    } else {
      buckets.set(time, { ...candle, time });
    }
  });
  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

async function loadMiniChartCandles(event, timeframe) {
  const config = MINI_CHART_INTERVALS[timeframe];
  const key = `${event.symbol}:${timeframe}:${Math.floor(event.triggeredAt / config.intervalMs)}`;
  const cached = miniChartCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    const endTime = Math.min(Date.now(), Number(event.triggeredAt) + config.intervalMs * 20);
    const url = new URL("https://fapi.binance.com/fapi/v1/klines");
    url.search = new URLSearchParams({
      symbol: event.symbol,
      interval: timeframe,
      endTime: String(endTime),
      limit: "100",
    }).toString();
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    return rows.map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
    }));
  })();
  miniChartCache.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    miniChartCache.set(key, null);
    throw error;
  }
}

function drawMiniChart(canvas, event, {
  timeframe = "1m",
  sourceCandles = null,
  offset = 0,
  visibleCount = 34,
} = {}) {
  const intervalMs = MINI_CHART_INTERVALS[timeframe]?.intervalMs ?? 60_000;
  let candles = candleSeriesForEvent(event, intervalMs, sourceCandles);
  if (intervalMs > 60_000 && !sourceCandles) candles = aggregateCandles(candles, intervalMs);
  const maximumOffset = Math.max(0, candles.length - visibleCount);
  const safeOffset = Math.max(0, Math.min(maximumOffset, offset));
  candles = candles.slice(safeOffset, safeOffset + visibleCount);
  const context = canvas.getContext("2d");
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(280, canvas.clientWidth);
  const height = 150;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  if (candles.length < 2) return false;
  const prices = candles.flatMap((candle) => [candle.high, candle.low]);
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const range = Math.max(maximum - minimum, Math.abs(maximum) * 0.0001);
  const minimumAt = candles[0].time;
  const maximumAt = candles.at(-1).time + intervalMs;
  const timeRange = Math.max(1, maximumAt - minimumAt);
  const x = (at) => 8 + ((at - minimumAt) / timeRange) * (width - 16);
  const y = (price) => 8 + ((maximum - price) / range) * (height - 16);
  context.strokeStyle = "rgba(142, 155, 167, .16)";
  context.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach((fraction) => {
    context.beginPath();
    context.moveTo(0, height * fraction);
    context.lineTo(width, height * fraction);
    context.stroke();
  });
  const triggerAt = Number(event.triggeredAt);
  const triggerX = x(triggerAt);
  context.fillStyle = "rgba(101, 183, 255, .07)";
  context.fillRect(triggerX, 0, width - triggerX, height);
  context.strokeStyle = "#65b7ff";
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(triggerX, 0);
  context.lineTo(triggerX, height);
  context.stroke();
  context.setLineDash([]);
  const candleWidth = Math.max(2, Math.min(9, (width - 20) / candles.length * 0.58));
  candles.forEach((candle) => {
    const center = x(candle.time + intervalMs / 2);
    const rising = candle.close >= candle.open;
    context.strokeStyle = rising ? "#42d9b1" : "#ff6b7a";
    context.fillStyle = rising ? "rgba(66,217,177,.82)" : "rgba(255,107,122,.82)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(center, y(candle.high));
    context.lineTo(center, y(candle.low));
    context.stroke();
    const top = y(Math.max(candle.open, candle.close));
    const bottom = y(Math.min(candle.open, candle.close));
    context.fillRect(center - candleWidth / 2, top, candleWidth, Math.max(1.5, bottom - top));
  });

  const evidence = event?.detectorEvidence;
  if (event?.signalType === "cascade" && evidence) {
    const lower = finite(evidence.zoneLower);
    const upper = finite(evidence.zoneUpper);
    if (lower !== null && upper !== null) {
      context.fillStyle = "rgba(255, 190, 92, .11)";
      context.fillRect(0, y(upper), width, Math.max(2, y(lower) - y(upper)));
    }
    context.fillStyle = "#ffbe5c";
    for (const extreme of evidence.extrema ?? []) {
      const at = finite(extreme?.at);
      const price = finite(extreme?.price);
      if (at === null || price === null) continue;
      context.beginPath();
      context.arc(x(at + intervalMs / 2), y(price), 3, 0, Math.PI * 2);
      context.fill();
    }
  }
  return { candleCount: candles.length, maximumOffset, offset: safeOffset };
}

function formatQuote(value) {
  const numeric = finite(value);
  if (numeric === null) return "—";
  return new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numeric);
}

function detectorExplanation(event) {
  const evidence = event?.detectorEvidence ?? {};
  const facts = [];
  const lead = event?.reason
    ? `Детектор включил событие: ${event.reason}.`
    : "Событие прошло формальные условия детектора.";
  if (event?.signalType === "cascade") {
    const count = finite(evidence.extremaCount);
    const width = finite(evidence.zoneWidthPercent);
    const distance = finite(evidence.breakoutDistancePercent);
    if (count !== null) facts.push(`нашёл ${count} однотипных экстремума`);
    if (width !== null) facts.push(`они лежали в зоне шириной ${width.toFixed(2)}%`);
    if (distance !== null) facts.push(`цена вышла за границу на ${distance.toFixed(2)}%`);
  } else if (event?.signalType === "rearranger") {
    const multiple = finite(evidence.sizeMultiple);
    const move = finite(evidence.movePercent);
    if (multiple !== null) facts.push(`сайз был в ${multiple.toFixed(1)}× больше медианного`);
    if (move !== null) facts.push(`его переставили на ${move.toFixed(3)}%`);
    if (evidence.side) facts.push(`сторона книги: ${evidence.side}`);
  } else if (event?.signalType === "size_supporter") {
    const multiple = finite(evidence.sizeMultiple);
    const touches = finite(evidence.touchCount);
    if (multiple !== null) facts.push(`сайз был в ${multiple.toFixed(1)}× больше медианного`);
    if (touches !== null) facts.push(`повторился ${Math.round(touches)} раза у спреда`);
    if (evidence.quoteUsd) facts.push(`объём около $${formatQuote(evidence.quoteUsd)}`);
  } else {
    const market = event?.context?.market;
    if (finite(market?.change15s) !== null) facts.push(`изменение 15с: ${formatPercent(market.change15s)}`);
    if (finite(market?.volumeAcceleration) !== null) {
      facts.push(`ускорение объёма: ${Number(market.volumeAcceleration).toFixed(1)}×`);
    }
    const liquidations = finite(event?.context?.liquidations?.totalQuote);
    if (liquidations !== null && liquidations > 0) facts.push(`ликвидации: $${formatQuote(liquidations)}`);
  }
  return { lead, facts: facts.slice(0, 4) };
}

function eventReviewData(event, overrides = {}) {
  const review = currentEventReview(event);
  return {
    reason: overrides.reason ?? review?.reason ?? "",
    comment: overrides.comment ?? review?.comment ?? "",
  };
}

function currentEventReview(event) {
  return localReviews.has(event.id) ? localReviews.get(event.id) : event.review;
}

async function saveEventReview(event, verdict, overrides = {}) {
  const review = eventReviewData(event, overrides);
  const saved = await store.review(event.id, verdict, review);
  if (!saved) return false;

  // Разметка должна оставаться локальным действием. Полный report() здесь
  // пересоздавал все карточки и сбрасывал открытые/перетянутые мини-графики.
  // Свежую сводку пользователь получает только по явной кнопке «Обновить».
  // Report rows are deliberately immutable snapshots. Keep the immediate
  // visual choice separately until the next explicit manual refresh.
  localReviews.set(event.id, verdict
    ? { verdict, ...review, reviewedAt: Date.now() }
    : null);
  return true;
}

function renderEvent(event) {
  const article = document.createElement("article");
  article.className = "event-review-item";
  const header = document.createElement("header");
  const identity = document.createElement("div");
  appendTextElement(identity, "strong", String(event.symbol || "").replace(/USDT$/, ""));
  appendTextElement(identity, "span", SIGNAL_LABELS[event.signalType] || event.signalType || "—");
  const id = appendTextElement(identity, "code", `#${shortEventId(event.id)}`);
  id.title = event.id;
  const time = appendTextElement(header, "time", new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(event.triggeredAt)));
  time.dateTime = new Date(event.triggeredAt).toISOString();
  header.prepend(identity);
  const chart = document.createElement("div");
  chart.className = "event-mini-chart";
  const toolbar = document.createElement("div");
  toolbar.className = "event-chart-toolbar";
  const timeframeButtons = document.createElement("div");
  timeframeButtons.className = "event-chart-timeframes";
  const chartHint = appendTextElement(toolbar, "span", "Тяни график · колесо — масштаб");
  chartHint.className = "event-chart-hint";
  toolbar.prepend(timeframeButtons);
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Свечной график события. Перетаскивайте по горизонтали, колесом меняйте масштаб.");
  chart.append(toolbar, canvas);
  const note = appendTextElement(
    chart,
    "p",
    "Свечи 1м из сохранённого OHLC и реальных цен после события. Синяя линия — срабатывание; жёлтая зона и точки — признаки каскада.",
  );
  article.append(header, chart);
  const chartState = {
    timeframe: "1m",
    sourceCandles: null,
    offset: 1_000_000,
    visibleCount: 34,
    dragging: false,
    dragX: 0,
    dragOffset: 0,
  };
  const redraw = () => {
    const result = drawMiniChart(canvas, event, chartState);
    if (!result) {
      canvas.hidden = true;
      note.textContent = "Для этой старой записи реальный ценовой путь не сохранён — график не дорисовываем.";
      chart.classList.add("is-empty");
      return;
    }
    canvas.hidden = false;
    chart.classList.remove("is-empty");
    chartState.offset = result.offset;
    canvas.classList.toggle("is-draggable", result.maximumOffset > 0);
  };
  for (const [timeframe, config] of Object.entries(MINI_CHART_INTERVALS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = config.label;
    button.classList.toggle("is-active", timeframe === chartState.timeframe);
    button.addEventListener("click", async () => {
      chartState.timeframe = timeframe;
      chartState.offset = 1_000_000;
      timeframeButtons.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
      note.textContent = `Загружаю реальные свечи ${config.label} Binance Futures…`;
      try {
        chartState.sourceCandles = await loadMiniChartCandles(event, timeframe);
        note.textContent = `Реальные свечи ${config.label} Binance Futures. Синяя линия — событие; график можно двигать и масштабировать.`;
      } catch {
        chartState.sourceCandles = timeframe === "1m" ? null : [];
        note.textContent = "Binance не отдал исторические свечи. Показываю только честно сохранённый локальный контекст.";
      }
      redraw();
    });
    timeframeButtons.append(button);
  }
  canvas.addEventListener("pointerdown", (event_) => {
    chartState.dragging = true;
    chartState.dragX = event_.clientX;
    chartState.dragOffset = chartState.offset;
    canvas.setPointerCapture(event_.pointerId);
  });
  canvas.addEventListener("pointermove", (event_) => {
    if (!chartState.dragging) return;
    const pixelsPerCandle = Math.max(4, canvas.clientWidth / chartState.visibleCount);
    chartState.offset = Math.round(chartState.dragOffset - (event_.clientX - chartState.dragX) / pixelsPerCandle);
    redraw();
  });
  const stopDragging = () => { chartState.dragging = false; };
  canvas.addEventListener("pointerup", stopDragging);
  canvas.addEventListener("pointercancel", stopDragging);
  canvas.addEventListener("wheel", (event_) => {
    event_.preventDefault();
    chartState.visibleCount = Math.max(12, Math.min(80, chartState.visibleCount + (event_.deltaY > 0 ? 4 : -4)));
    redraw();
  }, { passive: false });
  requestAnimationFrame(redraw);
  const explanation = detectorExplanation(event);
  const why = document.createElement("section");
  why.className = "event-detector-explanation";
  appendTextElement(why, "strong", "Почему событие вошло");
  appendTextElement(why, "p", explanation.lead);
  if (explanation.facts.length) {
    const list = document.createElement("ul");
    explanation.facts.forEach((fact) => appendTextElement(list, "li", fact));
    why.append(list);
  }
  article.append(why);
  const result = document.createElement("div");
  result.className = "event-result";
  const outcome = event.observation;
  result.append(
    createMetric("Лучший ход", formatPercent(outcome?.mfePercent), "MFE"),
    createMetric("Против паттерна", formatPercent(outcome?.maePercent), "MAE"),
    createMetric(
      "Итог",
      formatPercent(outcome?.directionalReturnPercent),
      `через ${HORIZON_LABELS[outcome?.horizon] || outcome?.horizon || "—"}`,
    ),
  );
  article.append(result);
  const review = document.createElement("div");
  review.className = "event-review-controls";
  const actions = document.createElement("div");
  actions.className = "event-verdicts";
  const verdictButtons = new Map();
  let reviewSaving = false;
  const syncReviewControls = () => {
    for (const [verdict, button] of verdictButtons) {
      button.classList.toggle("is-active", currentEventReview(event)?.verdict === verdict);
    }
    const visibleEvents = (selectedReportWindow()?.events ?? []).filter((item) => {
      const symbolQuery = elements.symbolFilter.value.trim().toUpperCase();
      const signal = elements.signalFilter.value;
      if (symbolQuery && !String(item.symbol).includes(symbolQuery)) return false;
      if (signal && item.signalType !== signal) return false;
      if (selectedView === "cascades" && item.signalType !== "cascade") return false;
      if (selectedView === "algorithms" && !["rearranger", "size_supporter"].includes(item.signalType)) return false;
      if (selectedView === "winners" && Number(item.observation?.mfePercent || 0) <= 1) return false;
      return true;
    }).slice(0, 100);
    elements.reviewProgress.textContent = `${visibleEvents.filter((item) => currentEventReview(item)?.verdict).length} из ${visibleEvents.length} отмечено`;
  };
  const persistReview = async (verdict, overrides) => {
    if (reviewSaving) return false;
    reviewSaving = true;
    for (const button of verdictButtons.values()) button.disabled = true;
    try {
      const saved = await saveEventReview(event, verdict, overrides);
      if (saved) syncReviewControls();
      return saved;
    } finally {
      reviewSaving = false;
      for (const button of verdictButtons.values()) button.disabled = false;
    }
  };
  for (const [verdict, label] of [
    ["good", "✓ Годный"],
    ["bad", "✕ Мусор"],
    ["unsure", "? Не уверен"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.verdict = verdict;
    button.classList.toggle("is-active", currentEventReview(event)?.verdict === verdict);
    button.addEventListener("click", async () => {
      const next = currentEventReview(event)?.verdict === verdict ? null : verdict;
      await persistReview(next, {
        reason: reason.value,
        comment: comment.value,
      });
    });
    verdictButtons.set(verdict, button);
    actions.append(button);
  }
  const reason = document.createElement("select");
  reason.setAttribute("aria-label", "Причина оценки");
  for (const [value, label] of REVIEW_REASONS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    reason.append(option);
  }
  reason.value = currentEventReview(event)?.reason || "";
  const comment = document.createElement("textarea");
  comment.rows = 2;
  comment.maxLength = 1_000;
  comment.placeholder = "Твой комментарий: что именно детектор увидел неправильно?";
  comment.value = currentEventReview(event)?.comment || "";
  const saveDetails = async () => {
    const activeReview = currentEventReview(event);
    if (!activeReview?.verdict) return;
    await persistReview(activeReview.verdict, {
      reason: reason.value,
      comment: comment.value,
    });
  };
  reason.addEventListener("change", saveDetails);
  comment.addEventListener("change", saveDetails);
  review.append(actions, reason, comment);
  article.append(review);
  return article;
}

function renderEvents(windowReport) {
  const events = (windowReport?.events ?? [])
    .filter((event) => {
      const symbolQuery = elements.symbolFilter.value.trim().toUpperCase();
      const signal = elements.signalFilter.value;
      if (symbolQuery && !String(event.symbol).includes(symbolQuery)) return false;
      if (signal && event.signalType !== signal) return false;
      if (selectedView === "cascades" && event.signalType !== "cascade") return false;
      if (selectedView === "algorithms" && !["rearranger", "size_supporter"].includes(event.signalType)) return false;
      if (selectedView === "winners" && Number(event.observation?.mfePercent || 0) <= 1) return false;
      return true;
    })
    .slice(0, 100);
  const fragment = document.createDocumentFragment();
  for (const event of events) fragment.append(renderEvent(event));
  elements.eventList.replaceChildren(fragment);
  elements.eventEmpty.hidden = events.length > 0;
  const reviewed = events.filter((event) => currentEventReview(event)?.verdict).length;
  elements.reviewProgress.textContent = `${reviewed} из ${events.length} отмечено`;
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvCell(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

async function exportReviews(format) {
  const rows = await store.reviewExport();
  if (!rows.length) {
    elements.reviewProgress.textContent = "Сначала отметь хотя бы одно событие";
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    downloadText(
      `inpuls-signal-lab-reviews-${stamp}.json`,
      JSON.stringify({
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        source: "local-browser-profile",
        reviews: rows,
      }, null, 2),
      "application/json;charset=utf-8",
    );
    return;
  }
  const headers = [
    "eventId", "symbol", "signalType", "direction", "triggeredAt", "verdict",
    "reason", "comment", "reviewedAt", "formulaVersion", "detectorEvidence",
    "chartContext", "observations",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([
      row.eventId,
      row.symbol,
      row.signalType,
      row.direction,
      new Date(row.triggeredAt).toISOString(),
      row.review.verdict,
      row.review.reason,
      row.review.comment,
      new Date(row.review.reviewedAt).toISOString(),
      row.formula?.version || "",
      row.detectorEvidence,
      row.context?.chartContext || null,
      row.observations,
    ].map(csvCell).join(","));
  }
  downloadText(
    `inpuls-signal-lab-reviews-${stamp}.csv`,
    `\uFEFF${lines.join("\n")}`,
    "text/csv;charset=utf-8",
  );
}

function selectedReportWindow() {
  return report?.windows?.find((window) => window.key === selectedWindow) ?? null;
}

function filteredRows(windowReport) {
  const symbolQuery = elements.symbolFilter.value.trim().toUpperCase();
  const signal = elements.signalFilter.value;
  const horizon = elements.horizonFilter.value;
  const viewMatches = (group) => {
    if (selectedView === "cascades") return group.signalType === "cascade";
    if (selectedView === "algorithms") return ["rearranger", "size_supporter"].includes(group.signalType);
    if (selectedView === "winners") return Number(group.target?.hits || 0) > 0;
    return true;
  };
  return (windowReport?.symbolGroups ?? []).filter((group) => (
    (!symbolQuery || String(group.symbol).includes(symbolQuery))
    && (!signal || group.signalType === signal)
    && (!horizon || group.horizon === horizon)
    && (elements.resultFilter.value !== "target" || Number(group.target?.hits || 0) > 0)
    && viewMatches(group)
  )).sort((left, right) => (
    Number(right.target?.ratePercent || 0) - Number(left.target?.ratePercent || 0)
    || Number(right.sample?.usableLive || 0) - Number(left.sample?.usableLive || 0)
    || Number(right.outcome?.mfePercent?.median || 0) - Number(left.outcome?.mfePercent?.median || 0)
  ));
}

function renderStatus() {
  const state = lastError
    ? "error"
    : report?.source?.storageState || store?.status().state || "loading";
  const labels = {
    available: "Локальная история подключена",
    idle: "Локальная история запускается",
    unavailable: "IndexedDB недоступна",
    error: "Ошибка локального хранилища",
    loading: "Подключаю локальную историю…",
  };
  elements.storageState.dataset.state = state;
  elements.storageState.textContent = labels[state] || "Состояние истории неизвестно";
  elements.storageState.title = lastError?.message || "";
}

function renderSummary(windowReport, rows) {
  if (!windowReport) {
    elements.summaryHits.textContent = "—";
    elements.summaryRate.textContent = "—";
    elements.summaryBest.textContent = "—";
    elements.summaryCoverage.textContent = "—";
    return;
  }
  const counts = windowReport?.counts ?? {};
  const due = Math.max(0, Number(counts.observed || 0) + Number(counts.unavailable || 0) + Number(counts.overduePending || 0));
  const usable = Number(counts.usableLive || 0);
  const hits = rows.reduce((sum, group) => sum + Number(group.target?.hits || 0), 0);
  const sample = rows.reduce((sum, group) => sum + Number(group.sample?.usableLive || 0), 0);
  const best = rows.find((group) => Number(group.sample?.usableLive || 0) >= 5) || rows[0];
  elements.summaryHits.textContent = formatInteger(hits);
  elements.summaryHitsNote.textContent = `из ${formatInteger(sample)} полных наблюдений`;
  elements.summaryRate.textContent = sample > 0 ? `${((hits / sample) * 100).toFixed(1)}%` : "—";
  elements.summaryBest.textContent = best ? (SIGNAL_LABELS[best.signalType] || best.signalType) : "—";
  elements.summaryBestNote.textContent = best
    ? `${String(best.symbol || "").replace(/USDT$/, "")} · ${formatPercent(best.target?.ratePercent, 1)} дали >1%`
    : "по выбранным фильтрам";
  elements.summaryCoverage.textContent = due > 0 ? `${((usable / due) * 100).toFixed(1)}%` : "—";
}

function renderRow(group) {
  const card = document.createElement("article");
  card.className = "pattern-card";
  const symbol = String(group.symbol || "—").replace(/USDT$/, "");
  const name = SIGNAL_LABELS[group.signalType] || group.signalType || "—";
  const direction = DIRECTION_LABELS[group.direction] || group.direction || "—";
  const horizon = HORIZON_LABELS[group.horizon] || group.horizon || "—";
  const hits = Number(group.target?.hits || 0);
  const sample = Number(group.sample?.usableLive || 0);
  const median = finite(group.outcome?.directionalReturnPercent?.median);
  const mfe = finite(group.outcome?.mfePercent?.median);
  const mae = finite(group.outcome?.maePercent?.median);
  const header = document.createElement("header");
  const identity = document.createElement("div");
  appendTextElement(identity, "strong", symbol);
  appendTextElement(identity, "span", name);
  header.append(identity);
  appendTextElement(header, "span", `${direction} · ${horizon}`, "direction-badge");
  const metrics = document.createElement("div");
  metrics.className = "pattern-metrics";
  const excursion = document.createElement("div");
  appendTextElement(excursion, "span", "Лучший ход / риск");
  const excursionValue = document.createElement("strong");
  appendTextElement(excursionValue, "i", formatPercent(mfe), metricTone(mfe));
  appendTextElement(excursionValue, "b", " / ");
  appendTextElement(excursionValue, "i", formatPercent(mae), metricTone(mae));
  excursion.append(excursionValue);
  appendTextElement(excursion, "small", "MFE / MAE");
  metrics.append(
    createMetric("Дали больше 1%", formatPercent(group.target?.ratePercent, 1), `${formatInteger(hits)} из ${formatInteger(sample)} случаев`, { className: "target-metric" }),
    createMetric("Типичный результат", formatPercent(median), `к концу ${horizon}`, { valueClass: metricTone(median) }),
    excursion,
  );
  const footer = document.createElement("footer");
  const evidence = document.createElement("span");
  evidence.className = "quality-badge";
  evidence.dataset.level = group.evidence?.level || "none";
  evidence.textContent = EVIDENCE_LABELS[group.evidence?.level] || group.evidence?.level || "—";
  evidence.title = (group.evidence?.limitations ?? []).join(", ") || "Без дополнительных ограничений";
  const link = document.createElement("a");
  link.textContent = `Открыть ${symbol} ↗`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.href = buildInPulsNavigationUrl?.(window.location.href, {
    symbol: group.symbol,
  }) || "./";
  link.setAttribute("aria-label", `Открыть ${group.symbol} в InPuls со стаканом`);
  const details = document.createElement("details");
  appendTextElement(details, "summary", "Подробнее");
  appendTextElement(
    details,
    "p",
    `Продолжение движения: ${formatPercent(group.continuation?.ratePercent, 1)} · До лучшего движения: ${formatDuration(group.outcome?.effectDurationMs?.median)} · Полная выборка: ${formatInteger(sample)}.`,
  );
  footer.append(evidence, details, link);
  card.append(header, metrics, footer);
  return card;
}

function render() {
  const windowReport = selectedReportWindow();
  renderStatus();
  const rows = filteredRows(windowReport);
  renderSummary(windowReport, rows);
  renderEvents(windowReport);
  const fragment = document.createDocumentFragment();
  for (const group of rows) fragment.append(renderRow(group));
  elements.body.replaceChildren(fragment);
  elements.empty.hidden = rows.length > 0;
  elements.emptyTitle.textContent = lastError
    ? "Не удалось подключить локальную историю"
    : "Подходящих наблюдений пока нет";
  elements.emptyMessage.textContent = lastError
    ? "Нажми «Повторить». История не удалена: ошибка касается только подключения страницы к хранилищу."
    : "Оставь InPuls открытым: статистика начнёт появляться после завершения горизонтов 15с / 1м / 3м / 5м.";
  elements.generatedAt.textContent = report?.generatedAt
    ? `Обновлено ${new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(report.generatedAt))}`
    : "—";
  for (const button of elements.windowButtons) {
    const active = button.dataset.window === selectedWindow;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const button of elements.viewButtons) {
    const active = button.dataset.view === selectedView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

async function refreshReport() {
  if (loading || !store) return;
  loading = true;
  elements.refresh.disabled = true;
  elements.refresh.textContent = "Обновляю…";
  try {
    report = await withTimeout(
      store.report(),
      REPORT_TIMEOUT_MS,
      "signal-lab-report-timeout",
    );
    localReviews = new Map();
    lastError = null;
  } catch (error) {
    report = null;
    lastError = normalizedError(error, "signal-lab-report-failed");
  } finally {
    loading = false;
    elements.refresh.disabled = false;
    elements.refresh.textContent = lastError ? "Повторить" : "Обновить";
    render();
  }
}

async function boot() {
  if (booting) return booting;
  lastError = null;
  report = null;
  delete elements.refresh.dataset.bootFallback;
  elements.storageState.dataset.state = "loading";
  elements.storageState.textContent = "Подключаю локальную историю…";
  elements.refresh.disabled = true;
  elements.refresh.textContent = "Подключаю…";
  booting = (async () => {
    const [navigationModule, signalLabModule] = await withTimeout(
      Promise.all([
        import(`./owner-navigation.js?v=${BUILD}`),
        import(`./signal-lab.js?v=${BUILD}`),
      ]),
      BOOT_TIMEOUT_MS,
      "signal-lab-module-timeout",
    );
    buildInPulsNavigationUrl = navigationModule.buildInPulsNavigationUrl;
    store = new signalLabModule.SignalLabLocalStore();
    await withTimeout(
      store.initialize(),
      BOOT_TIMEOUT_MS,
      "signal-lab-storage-timeout",
    );
    await refreshReport();
  })()
    .catch((error) => {
      store = null;
      report = null;
      lastError = normalizedError(error, "signal-lab-boot-failed");
      elements.refresh.disabled = false;
      elements.refresh.textContent = "Повторить";
      render();
    })
    .finally(() => {
      booting = null;
    });
  return booting;
}

for (const button of elements.windowButtons) {
  button.addEventListener("click", () => {
    selectedWindow = button.dataset.window;
    render();
  });
}
for (const button of elements.viewButtons) {
  button.addEventListener("click", () => {
    selectedView = button.dataset.view;
    elements.resultFilter.value = selectedView === "winners" ? "target" : "";
    render();
  });
}
for (const control of [
  elements.symbolFilter,
  elements.signalFilter,
  elements.horizonFilter,
  elements.resultFilter,
]) {
  control.addEventListener("input", render);
  control.addEventListener("change", render);
}
elements.refresh.addEventListener("click", () => {
  if (lastError || !store) {
    boot();
    return;
  }
  refreshReport();
});
elements.exportJson.addEventListener("click", () => exportReviews("json"));
elements.exportCsv.addEventListener("click", () => exportReviews("csv"));
updateOwnerRuntime().catch(() => null);
boot();
