import { renderSignalLabEventCard } from "./owner-signal-lab-v2-card.js";

const BUILD = "26-80-signal-lab-v2-training-v1";
const WINDOWS = Object.freeze(["1d", "3d", "7d", "30d"]);

const elements = {
  storage: document.querySelector("#storage-state"),
  refresh: document.querySelector("#refresh-report"),
  symbol: document.querySelector("#symbol-filter"),
  pattern: document.querySelector("#pattern-filter"),
  verdict: document.querySelector("#verdict-filter"),
  windowButtons: [...document.querySelectorAll("[data-window]")],
  events: document.querySelector("#event-review-list"),
  empty: document.querySelector("#event-review-empty"),
  progress: document.querySelector("#review-progress"),
  generated: document.querySelector("#generated-at"),
  summaryEvents: document.querySelector("#summary-events"),
  summaryReviewed: document.querySelector("#summary-reviewed"),
  summaryDuplicates: document.querySelector("#summary-duplicates"),
  summaryLive: document.querySelector("#summary-live"),
  groups: document.querySelector("#pattern-groups"),
  exportJson: document.querySelector("#export-json"),
  exportCsv: document.querySelector("#export-csv"),
};

let store = null;
let report = null;
let selectedWindow = "7d";
let patternDefinitions = {};
let patternStates = [];
let localReviews = new Map();
let loading = false;

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function text(parent, tag, value, className = "") {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function formatInteger(value) {
  const number = finite(value);
  return number === null ? "—" : Math.round(number).toLocaleString("ru-RU");
}

function formatPercent(value, digits = 2) {
  const number = finite(value);
  return number === null ? "—" : `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function formatTime(value) {
  const number = finite(value);
  if (number === null) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(number));
}

function currentWindow() {
  return report?.windows?.find((item) => item.key === selectedWindow) ?? null;
}

function currentReview(event) {
  return localReviews.has(event.id) ? localReviews.get(event.id) : event.review;
}

function filteredEvents() {
  const symbol = elements.symbol.value.trim().toUpperCase();
  const pattern = elements.pattern.value;
  const verdict = elements.verdict.value;
  return (currentWindow()?.events ?? []).filter((event) => {
    if (symbol && !String(event.symbol).includes(symbol)) return false;
    if (pattern && event.patternId !== pattern) return false;
    if (verdict && currentReview(event)?.verdict !== verdict) return false;
    return true;
  }).slice(0, 120);
}

async function saveReview(event, verdict, details) {
  await store.review(event.id, verdict, details);
  localReviews.set(event.id, verdict ? {
    entity: "SignalLabReview",
    reviewVersion: 2,
    eventId: event.id,
    verdict,
    ...details,
    reviewedAt: Date.now(),
  } : null);
}

function renderSummary() {
  const events = filteredEvents();
  const reviewed = events.filter((event) => currentReview(event)?.verdict).length;
  const duplicates = events.filter((event) => (
    event.duplicateEpisode || currentReview(event)?.verdict === "duplicate_episode"
  )).length;
  elements.summaryEvents.textContent = formatInteger(events.length);
  elements.summaryReviewed.textContent = formatInteger(reviewed);
  elements.summaryDuplicates.textContent = formatInteger(duplicates);
  elements.summaryLive.textContent = formatInteger(currentWindow()?.counts?.usableLive ?? 0);
  elements.progress.textContent = `${reviewed} из ${events.length} размечено`;
}

function renderEvents() {
  const events = filteredEvents();
  const fragment = document.createDocumentFragment();
  for (const event of events) {
    fragment.append(renderSignalLabEventCard(event, {
      patternDefinitions,
      patternStates,
      currentReview,
      saveReview,
      onReviewChanged: renderSummary,
    }));
  }
  elements.events.replaceChildren(fragment);
  elements.empty.hidden = events.length > 0;
  renderSummary();
}

function renderGroups() {
  const groups = (currentWindow()?.signalGroups ?? []).slice(0, 30);
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    const card = document.createElement("article");
    const definition = Object.values(patternDefinitions).find((item) => (
      item.id === group.signalType || item.aliases.includes(group.signalType)
    ));
    text(card, "strong", definition?.label || group.signalType || "Неизвестный паттерн");
    text(card, "span", `${formatInteger(group.sample?.usableLive)} LIVE-наблюдений · ${group.horizon || "—"}`);
    const metrics = document.createElement("div");
    text(metrics, "b", `MFE ${formatPercent(group.outcome?.mfePercent?.median)}`);
    text(metrics, "b", `MAE ${formatPercent(group.outcome?.maePercent?.median)}`);
    text(metrics, "b", `>1% ${formatPercent(group.target?.ratePercent, 1)}`);
    card.append(metrics);
    fragment.append(card);
  }
  elements.groups.replaceChildren(fragment);
}

function render() {
  renderEvents();
  renderGroups();
  elements.generated.textContent = report?.generatedAt
    ? `Обновлено ${formatTime(report.generatedAt)}`
    : "—";
  for (const button of elements.windowButtons) {
    const active = button.dataset.window === selectedWindow;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

async function refresh() {
  if (!store || loading) return;
  loading = true;
  elements.refresh.disabled = true;
  elements.refresh.textContent = "Обновляю…";
  try {
    report = await store.report();
    localReviews = new Map();
    const status = store.status();
    elements.storage.dataset.state = status.reviewStorageState || status.state || "available";
    elements.storage.textContent = status.migratedLegacyReviews
      ? `Signal Lab V2 подключён · перенесено старых оценок: ${status.migratedLegacyReviews}`
      : "Signal Lab V2 подключён · данные остаются на этом устройстве";
    render();
  } catch (error) {
    report = null;
    elements.storage.dataset.state = "error";
    elements.storage.textContent = `Ошибка Signal Lab V2: ${String(error?.message || error).slice(0, 160)}`;
    elements.empty.hidden = false;
  } finally {
    loading = false;
    elements.refresh.disabled = false;
    elements.refresh.textContent = "Обновить";
  }
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvCell(value) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${raw.replaceAll('"', '""')}"`;
}

async function exportReviews(format) {
  const rows = await store.reviewExport();
  if (!rows.length) {
    elements.progress.textContent = "Сначала разметь хотя бы одно событие";
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    download(`inpuls-signal-lab-v2-${stamp}.json`, JSON.stringify({
      exportVersion: 2,
      exportedAt: new Date().toISOString(),
      reviews: rows,
    }, null, 2), "application/json;charset=utf-8");
    return;
  }
  const headers = [
    "eventId", "symbol", "signalType", "patternId", "direction", "triggeredAt",
    "verdict", "reviewedState", "episodeId", "referencePrice", "invalidationPrice",
    "extrema", "reasonCodes", "comment", "reviewedAt", "formulaVersion",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([
      row.eventId,
      row.symbol,
      row.signalType,
      row.patternId,
      row.direction,
      new Date(row.triggeredAt).toISOString(),
      row.review.verdict,
      row.review.reviewedState,
      row.review.episodeId || row.episodeId,
      row.review.referencePrice,
      row.review.invalidationPrice,
      row.review.extrema,
      row.review.reasonCodes,
      row.review.comment,
      new Date(row.review.reviewedAt).toISOString(),
      row.formula?.version || "",
    ].map(csvCell).join(","));
  }
  download(`inpuls-signal-lab-v2-${stamp}.csv`, `\uFEFF${lines.join("\n")}`, "text/csv;charset=utf-8");
}

async function boot() {
  elements.storage.dataset.state = "loading";
  elements.storage.textContent = "Подключаю Signal Lab V2…";
  try {
    const [storeModule, catalogModule] = await Promise.all([
      import(`./signal-lab-v2-store.js?v=${BUILD}`),
      import(`./signal-lab-v2-catalog.js?v=${BUILD}`),
    ]);
    patternDefinitions = catalogModule.PATTERN_DEFINITIONS;
    patternStates = catalogModule.PATTERN_STATES;
    for (const definition of Object.values(patternDefinitions)) {
      const option = document.createElement("option");
      option.value = definition.id;
      option.textContent = definition.label;
      elements.pattern.append(option);
    }
    store = new storeModule.SignalLabV2Store();
    await store.initialize();
    await refresh();
  } catch (error) {
    elements.storage.dataset.state = "error";
    elements.storage.textContent = `Не удалось запустить Signal Lab V2: ${String(error?.message || error).slice(0, 160)}`;
    elements.refresh.disabled = false;
  }
}

for (const button of elements.windowButtons) {
  button.addEventListener("click", () => {
    selectedWindow = WINDOWS.includes(button.dataset.window) ? button.dataset.window : "7d";
    render();
  });
}
for (const control of [elements.symbol, elements.pattern, elements.verdict]) {
  control.addEventListener("input", render);
  control.addEventListener("change", render);
}
elements.refresh.addEventListener("click", refresh);
elements.exportJson.addEventListener("click", () => exportReviews("json"));
elements.exportCsv.addEventListener("click", () => exportReviews("csv"));

boot();
