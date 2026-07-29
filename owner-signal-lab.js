const BUILD = "26-56-signal-lab-readable-v1";
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
};

let buildInPulsNavigationUrl = null;
let store = null;
let selectedWindow = "7d";
let selectedView = "winners";
let report = null;
let loading = false;
let booting = null;
let lastError = null;

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
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    if (store) refreshReport();
    else boot();
  }
});

updateOwnerRuntime().catch(() => null);
boot();
setInterval(() => {
  if (store) refreshReport();
}, 30_000);
