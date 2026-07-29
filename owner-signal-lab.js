import { buildInPulsNavigationUrl } from "./owner-navigation.js?v=owner-signal-lab-v1";
import { SignalLabLocalStore } from "./signal-lab.js?v=signal-lab-analytics-v1";

const SIGNAL_LABELS = Object.freeze({
  impulse: "Импульс",
  knife: "Нож",
  breakout: "Пробой",
  cascade: "Каскад",
  compression: "Сжатие",
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
  refresh: document.querySelector("#refresh-report"),
  summaryEvents: document.querySelector("#summary-events"),
  summaryUsable: document.querySelector("#summary-usable"),
  summaryCoverage: document.querySelector("#summary-coverage"),
  summaryMissing: document.querySelector("#summary-missing"),
  generatedAt: document.querySelector("#generated-at"),
  body: document.querySelector("#signal-lab-body"),
  empty: document.querySelector("#owner-empty"),
};

const store = new SignalLabLocalStore();
let selectedWindow = "7d";
let report = null;
let loading = false;

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

function createCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function selectedReportWindow() {
  return report?.windows?.find((window) => window.key === selectedWindow) ?? null;
}

function filteredRows(windowReport) {
  const symbolQuery = elements.symbolFilter.value.trim().toUpperCase();
  const signal = elements.signalFilter.value;
  const horizon = elements.horizonFilter.value;
  return (windowReport?.symbolGroups ?? []).filter((group) => (
    (!symbolQuery || String(group.symbol).includes(symbolQuery))
    && (!signal || group.signalType === signal)
    && (!horizon || group.horizon === horizon)
  ));
}

function renderStatus() {
  const state = report?.source?.storageState || store.status().state || "loading";
  const labels = {
    available: "Локальная история подключена",
    idle: "Локальная история запускается",
    unavailable: "IndexedDB недоступна",
    error: "Ошибка локального хранилища",
    loading: "Подключаю локальную историю…",
  };
  elements.storageState.dataset.state = state;
  elements.storageState.textContent = labels[state] || "Состояние истории неизвестно";
}

function renderSummary(windowReport) {
  const counts = windowReport?.counts ?? {};
  const due = Math.max(0, Number(counts.observed || 0) + Number(counts.unavailable || 0) + Number(counts.overduePending || 0));
  const usable = Number(counts.usableLive || 0);
  const missing = Number(counts.observedPartial || 0) + Number(counts.unavailable || 0);
  elements.summaryEvents.textContent = formatInteger(counts.events);
  elements.summaryUsable.textContent = formatInteger(usable);
  elements.summaryCoverage.textContent = due > 0 ? `${((usable / due) * 100).toFixed(1)}%` : "—";
  elements.summaryMissing.textContent = formatInteger(missing);
}

function renderRow(group) {
  const row = document.createElement("tr");
  row.append(
    createCell(String(group.symbol || "—").replace(/USDT$/, "")),
    createCell(SIGNAL_LABELS[group.signalType] || group.signalType || "—"),
    createCell(DIRECTION_LABELS[group.direction] || group.direction || "—"),
    createCell(HORIZON_LABELS[group.horizon] || group.horizon || "—"),
    createCell(formatInteger(group.sample?.usableLive), "number"),
    createCell(formatPercent(group.continuation?.ratePercent, 1), "number"),
  );

  const median = finite(group.outcome?.directionalReturnPercent?.median);
  const mfe = finite(group.outcome?.mfePercent?.median);
  const mae = finite(group.outcome?.maePercent?.median);
  row.append(
    createCell(formatPercent(median), `number ${metricTone(median)}`.trim()),
    createCell(formatPercent(mfe), `number ${metricTone(mfe)}`.trim()),
    createCell(formatPercent(mae), `number ${metricTone(mae)}`.trim()),
    createCell(formatDuration(group.outcome?.effectDurationMs?.median), "number"),
  );

  const evidenceCell = document.createElement("td");
  const evidence = document.createElement("span");
  evidence.className = "quality-badge";
  evidence.dataset.level = group.evidence?.level || "none";
  evidence.textContent = EVIDENCE_LABELS[group.evidence?.level] || group.evidence?.level || "—";
  evidence.title = (group.evidence?.limitations ?? []).join(", ") || "Без дополнительных ограничений";
  evidenceCell.append(evidence);
  row.append(evidenceCell);

  const actionCell = document.createElement("td");
  const link = document.createElement("a");
  link.textContent = "Открыть ↗";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.href = buildInPulsNavigationUrl(window.location.href, {
    symbol: group.symbol,
  }) || "./";
  link.setAttribute("aria-label", `Открыть ${group.symbol} в InPuls со стаканом`);
  actionCell.append(link);
  row.append(actionCell);
  return row;
}

function render() {
  const windowReport = selectedReportWindow();
  renderStatus();
  renderSummary(windowReport);
  const rows = filteredRows(windowReport);
  const fragment = document.createDocumentFragment();
  for (const group of rows) fragment.append(renderRow(group));
  elements.body.replaceChildren(fragment);
  elements.empty.hidden = rows.length > 0;
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
}

async function refreshReport() {
  if (loading) return;
  loading = true;
  elements.refresh.disabled = true;
  elements.refresh.textContent = "Обновляю…";
  try {
    report = await store.report();
  } catch {
    report = null;
  } finally {
    loading = false;
    elements.refresh.disabled = false;
    elements.refresh.textContent = "Обновить";
    render();
  }
}

for (const button of elements.windowButtons) {
  button.addEventListener("click", () => {
    selectedWindow = button.dataset.window;
    render();
  });
}
for (const control of [elements.symbolFilter, elements.signalFilter, elements.horizonFilter]) {
  control.addEventListener("input", render);
  control.addEventListener("change", render);
}
elements.refresh.addEventListener("click", refreshReport);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshReport();
});

store.initialize()
  .catch(() => null)
  .finally(refreshReport);
setInterval(refreshReport, 30_000);
