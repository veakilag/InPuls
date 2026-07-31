import { renderSignalLabEventCard } from "./owner-signal-lab-v2-card.js";

const BUILD = "26-81-signal-lab-collector-status-v1";
const WINDOWS = Object.freeze(["1d", "3d", "7d", "30d"]);
const OWNER_SIGNAL_LAB_STARTED_EVENT = "inpuls:owner-signal-lab-started";
const COLLECTOR_STATUS_MESSAGE = "inpuls:signal-lab-collector-status";
const COLLECTOR_STATUS_TIMEOUT_MS = 2_500;
const COLLECTOR_STATUS_POLL_MS = 5_000;

const elements = {
  storage: document.querySelector("#storage-state"),
  collectorOpen: document.querySelector("#collector-open"),
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
let storeStatus = null;
let collectorStatus = Object.freeze({
  active: false,
  available: false,
  checkedAt: null,
  clients: [],
  reason: "not-checked",
});

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

function totalStoredEvents() {
  return Math.max(0, finite(report?.source?.eventCount) ?? 0);
}

function collectorWindow() {
  return collectorStatus.clients?.find((client) => client.visibilityState === "visible")
    ?? collectorStatus.clients?.[0]
    ?? null;
}

function renderRuntimeStatus() {
  if (!elements.storage) return;
  const reviewStorageState = storeStatus?.reviewStorageState || storeStatus?.state || "available";
  if (reviewStorageState === "error" || reviewStorageState === "unavailable") {
    elements.storage.dataset.state = "error";
    elements.storage.textContent = storeStatus?.lastError
      ? `Ошибка локальной истории: ${String(storeStatus.lastError).slice(0, 120)}`
      : "Локальная история недоступна";
    return;
  }

  const eventCount = totalStoredEvents();
  if (collectorStatus.active) {
    const client = collectorWindow();
    const inBackground = client?.visibilityState === "hidden";
    elements.storage.dataset.state = inBackground ? "warning" : "available";
    elements.storage.textContent = inBackground
      ? `Сборщик открыт в фоне · история: ${formatInteger(eventCount)} событий`
      : `Сборщик активен · история: ${formatInteger(eventCount)} событий`;
    elements.storage.title = inBackground
      ? "Основной InPuls открыт в фоновой вкладке. Браузер может замедлять WebSocket и таймеры."
      : "Основной InPuls открыт и записывает найденные события в локальную историю.";
    if (elements.collectorOpen) elements.collectorOpen.textContent = "Открыть InPuls";
    return;
  }

  elements.storage.dataset.state = "warning";
  elements.storage.textContent = eventCount
    ? `Сбор остановлен · в истории ${formatInteger(eventCount)} событий`
    : "Сбор не запущен · открой основной InPuls";
  elements.storage.title = "Signal Lab анализирует локальную историю, но сам не подключается к Binance.";
  if (elements.collectorOpen) elements.collectorOpen.textContent = "Запустить сбор";
}

function renderEmptyState(events) {
  elements.empty.hidden = events.length > 0;
  if (events.length) return;
  const eventCount = totalStoredEvents();
  if (!collectorStatus.active && eventCount === 0) {
    elements.empty.textContent = "Сбор не запущен. Открой основной InPuls в соседней вкладке и оставь его работать — Signal Lab сам к Binance не подключается.";
    return;
  }
  if (collectorStatus.active && eventCount === 0) {
    elements.empty.textContent = "Сборщик работает. Подходящий паттерн появится здесь после первого реального срабатывания.";
    return;
  }
  elements.empty.textContent = "В выбранном периоде или фильтре подходящих событий пока нет.";
}

async function serviceWorkerForCollectorStatus() {
  if (!("serviceWorker" in navigator)) return null;
  let registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    registration = await navigator.serviceWorker.register("./sw.js");
  }
  const ready = await navigator.serviceWorker.ready;
  return ready.active || registration.active || registration.waiting || null;
}

async function requestCollectorStatus() {
  try {
    const worker = await serviceWorkerForCollectorStatus();
    if (!worker) {
      return Object.freeze({
        active: false,
        available: false,
        checkedAt: Date.now(),
        clients: [],
        reason: "service-worker-unavailable",
      });
    }
    return await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(Object.freeze({
        active: false,
        available: false,
        checkedAt: Date.now(),
        clients: [],
        reason: "collector-status-timeout",
      })), COLLECTOR_STATUS_TIMEOUT_MS);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        const payload = event.data && typeof event.data === "object" ? event.data : {};
        resolve(Object.freeze({
          active: payload.active === true,
          available: true,
          checkedAt: finite(payload.checkedAt) ?? Date.now(),
          clients: Array.isArray(payload.clients) ? payload.clients : [],
          reason: payload.active === true ? "collector-client-found" : "collector-client-missing",
        }));
      };
      worker.postMessage({ type: COLLECTOR_STATUS_MESSAGE }, [channel.port2]);
    });
  } catch (error) {
    return Object.freeze({
      active: false,
      available: false,
      checkedAt: Date.now(),
      clients: [],
      reason: String(error?.message || error).slice(0, 120),
    });
  }
}

async function refreshCollectorStatus() {
  collectorStatus = await requestCollectorStatus();
  renderRuntimeStatus();
  renderEmptyState(filteredEvents());
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
  renderEmptyState(events);
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
  renderRuntimeStatus();
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
    storeStatus = store.status();
    await refreshCollectorStatus();
    render();
  } catch (error) {
    report = null;
    elements.storage.dataset.state = "error";
    elements.storage.textContent = `Ошибка Signal Lab V2: ${String(error?.message || error).slice(0, 160)}`;
    elements.empty.hidden = false;
    elements.empty.textContent = "Не удалось прочитать локальную историю. Обнови страницу — сохранённые данные удаляться не должны.";
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
  } finally {
    window.dispatchEvent(new CustomEvent(OWNER_SIGNAL_LAB_STARTED_EVENT));
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
elements.collectorOpen?.addEventListener("click", () => {
  elements.storage.dataset.state = "loading";
  elements.storage.textContent = "Открываю основной InPuls…";
  setTimeout(refreshCollectorStatus, 1_500);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshCollectorStatus();
});
setInterval(refreshCollectorStatus, COLLECTOR_STATUS_POLL_MS);

boot();
