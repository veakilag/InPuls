import {
  CANDIDATE_LABELS,
  SIGNAL_LAB_V3_FORMULA_VERSION,
} from "./signal-lab-v3-candidates.js";
import { SignalLabV3Collector } from "./signal-lab-v3-collector.js";
import { rowsToCsv, SignalLabV3Store } from "./signal-lab-v3-store.js";

const elements = {
  collectorDot: document.querySelector("#collector-dot"),
  collectorStatus: document.querySelector("#collector-status"),
  collectorToggle: document.querySelector("#collector-toggle"),
  symbolFilter: document.querySelector("#symbol-filter"),
  candidateFilter: document.querySelector("#candidate-filter"),
  reviewFilter: document.querySelector("#review-filter"),
  refresh: document.querySelector("#refresh"),
  checksCount: document.querySelector("#checks-count"),
  episodesCount: document.querySelector("#episodes-count"),
  activeCount: document.querySelector("#active-count"),
  reviewedCount: document.querySelector("#reviewed-count"),
  warmupCount: document.querySelector("#warmup-count"),
  visibleCount: document.querySelector("#visible-count"),
  emptyState: document.querySelector("#empty-state"),
  candidateList: document.querySelector("#candidate-list"),
  template: document.querySelector("#candidate-template"),
  exportJson: document.querySelector("#export-json"),
  exportCsv: document.querySelector("#export-csv"),
  dayButtons: [...document.querySelectorAll("[data-days]")],
};

const store = new SignalLabV3Store();
const liveEpisodes = new Map();
const reviewStates = new Map();
const state = {
  days: 7,
  running: true,
  collectorStatus: null,
  renderTimer: null,
  rendering: false,
};

const hypothesisLabels = Object.freeze({
  knife_reclaim: "Нож",
  sharpening_rejection: "Заточка",
  continuation_breakout: "Продолжение вверх",
  continuation_breakdown: "Продолжение вниз",
  level_breakout: "Пробой уровня",
  false_breakout: "Ложный пробой",
  liquidity_sweep: "Снятие ликвидности",
  cascade_breakout: "Пробой каскада",
  liquidity_hold: "Удержание сайза",
  liquidity_rearrangement: "Переставляш",
  participant_activity: "Направленный поток",
  directional_impulse: "Направленный импульс",
  liquidation_cascade: "Каскад ликвидаций",
  exhaustion_reversal: "Истощение движения",
});

const stageLabels = Object.freeze({
  observed: "наблюдение",
  forming: "формируется",
  triggered: "триггер",
  completed: "завершён",
});

const verdictLabels = Object.freeze({
  unreviewed: "не размечено",
  valid: "годный",
  weak: "слабый",
  false_positive: "мусор",
  duplicate_episode: "дубль",
  wrong_pattern: "другой паттерн",
  insufficient_data: "мало данных",
  missed_pattern: "пропущенный паттерн",
});

function filters() {
  const now = Date.now();
  return {
    from: now - state.days * 24 * 60 * 60 * 1_000,
    to: now,
    symbol: elements.symbolFilter.value,
    candidateType: elements.candidateFilter.value,
    reviewState: elements.reviewFilter.value,
    limit: 1_000,
  };
}

function scheduleRender(delay = 180) {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(() => render(), delay);
}

function statusText(status) {
  if (!status) return "Подготовка локального сборщика…";
  const connection = {
    idle: "ожидание",
    connecting: "подключение",
    live: "LIVE",
    reconnecting: "переподключение",
    error: "ошибка",
    stopped: "остановлен",
  }[status.connection] ?? status.connection;
  const ageSeconds = status.lastMessageAt
    ? Math.max(0, Math.round((Date.now() - status.lastMessageAt) / 1_000))
    : null;
  const age = ageSeconds === null ? "нет данных" : `${ageSeconds}с назад`;
  return `${connection} · проверки ${status.checks} · эпизоды ${status.createdEpisodes} · aggTrade ${status.trackedTrades} · история ${status.warmupLoaded} · пакет ${age}`;
}

function renderCollectorStatus() {
  const status = state.collectorStatus;
  elements.collectorStatus.textContent = statusText(status);
  elements.collectorDot.className = "status-dot";
  if (status?.connection === "live") elements.collectorDot.classList.add("is-live");
  else if (status?.connection === "error") elements.collectorDot.classList.add("is-error");
  else if (status?.connection === "stopped") elements.collectorDot.classList.add("is-stopped");
  elements.checksCount.textContent = String(status?.checks ?? 0);
  elements.warmupCount.textContent = String(status?.warmupLoaded ?? 0);
  elements.collectorToggle.textContent = state.running ? "Остановить сбор" : "Запустить сбор";
}

function mergeEpisode(row) {
  const storedReview = row.review ?? null;
  const live = liveEpisodes.get(row.id);
  const merged = live ? { ...row, ...live, review: storedReview } : row;
  const reviewState = reviewStates.get(row.id) ?? merged.reviewState ?? "unreviewed";
  return { ...merged, reviewState };
}

function activeEpisodeCount(now = Date.now()) {
  return [...liveEpisodes.values()].filter((episode) => (
    episode.stage !== "completed" && now - episode.lastSeenAt <= 30_000
  )).length;
}

function formatDate(timestamp) {
  const date = new Date(Number(timestamp));
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function scoreLabel(value) {
  const score = Math.round(Number(value) || 0);
  return `${score}/100`;
}

function setList(target, rows) {
  target.replaceChildren(...rows.map((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
}

function setChips(target, rows) {
  target.replaceChildren(...rows.map((value) => {
    const chip = document.createElement("span");
    chip.textContent = hypothesisLabels[value] ?? value;
    return chip;
  }));
}

async function saveReview(episode, card, verdict) {
  const pattern = card.querySelector('[data-field="pattern"]');
  const comment = card.querySelector('[data-field="comment"]');
  const buttons = [...card.querySelectorAll("[data-verdict]")];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const review = await store.saveReview(episode.id, {
      verdict,
      finalPatternId: pattern.value,
      comment: comment.value,
    });
    reviewStates.set(episode.id, review.verdict);
    buttons.forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.verdict === review.verdict);
    });
    scheduleRender(0);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function renderCard(episode) {
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector(".candidate-card");
  card.dataset.direction = episode.direction;
  const latest = episode.latest ?? {};
  card.querySelector('[data-field="symbol"]').textContent = episode.symbol;
  card.querySelector('[data-field="label"]').textContent = episode.label;
  card.querySelector('[data-field="stage"]').textContent = stageLabels[episode.stage] ?? episode.stage;
  card.querySelector('[data-field="time"]').textContent = `${formatDate(episode.firstSeenAt)} · ${episode.observations} наблюдений · ${episode.direction === "up" ? "вверх" : episode.direction === "down" ? "вниз" : "нейтрально"}`;
  card.querySelector('[data-field="score"]').textContent = scoreLabel(episode.peakEvidenceScore);
  setList(card.querySelector('[data-field="facts"]'), Array.isArray(latest.facts) ? latest.facts : []);
  setChips(card.querySelector('[data-field="hypotheses"]'), Array.isArray(latest.patternHypotheses) ? latest.patternHypotheses : []);
  const quality = latest.quality ?? {};
  card.querySelector('[data-field="quality"]').textContent = `Данные: ${quality.state ?? "unknown"} · формула ${latest.formulaVersion ?? SIGNAL_LAB_V3_FORMULA_VERSION}`;
  setList(card.querySelector('[data-field="limitations"]'), Array.isArray(quality.limitations) ? quality.limitations : []);

  const pattern = card.querySelector('[data-field="pattern"]');
  const comment = card.querySelector('[data-field="comment"]');
  pattern.value = episode.review?.finalPatternId ?? "";
  comment.value = episode.review?.comment ?? "";
  card.querySelectorAll("[data-verdict]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.verdict === episode.reviewState);
    button.addEventListener("click", () => saveReview(episode, card, button.dataset.verdict));
  });
  return fragment;
}

async function render() {
  if (state.rendering) return;
  state.rendering = true;
  try {
    renderCollectorStatus();
    const rows = await store.list(filters());
    for (const row of rows) {
      if (row.reviewState && row.reviewState !== "unreviewed") reviewStates.set(row.id, row.reviewState);
    }
    const merged = rows.map(mergeEpisode);
    const summary = await store.summary(filters());
    elements.episodesCount.textContent = String(summary.episodes);
    elements.reviewedCount.textContent = String(summary.reviewed);
    elements.activeCount.textContent = String(activeEpisodeCount());
    elements.visibleCount.textContent = `${merged.length} эпизодов`;
    elements.emptyState.hidden = merged.length > 0;
    elements.candidateList.hidden = merged.length === 0;
    elements.candidateList.replaceChildren(...merged.slice(0, 250).map(renderCard));
  } catch (error) {
    elements.emptyState.hidden = false;
    elements.emptyState.textContent = `Не удалось прочитать локальную историю: ${String(error?.message ?? error)}`;
  } finally {
    state.rendering = false;
  }
}

function download(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function exportJson() {
  const rows = await store.exportRows(filters());
  download(
    `inpuls-signal-lab-v3-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json;charset=utf-8",
    JSON.stringify({
      schemaVersion: 1,
      formulaVersion: SIGNAL_LAB_V3_FORMULA_VERSION,
      exportedAt: Date.now(),
      filters: filters(),
      rows,
    }, null, 2),
  );
}

async function exportCsv() {
  const rows = await store.exportRows(filters());
  download(
    `inpuls-signal-lab-v3-${new Date().toISOString().slice(0, 10)}.csv`,
    "text/csv;charset=utf-8",
    `\uFEFF${rowsToCsv(rows)}`,
  );
}

const collector = new SignalLabV3Collector({
  onEpisodes: async ({ created, updated, expired }) => {
    for (const episode of [...created, ...updated, ...expired]) {
      const reviewState = reviewStates.get(episode.id) ?? episode.reviewState;
      liveEpisodes.set(episode.id, { ...episode, reviewState });
    }
    const durableRows = [...created, ...expired].map((episode) => ({
      ...episode,
      reviewState: reviewStates.get(episode.id) ?? episode.reviewState,
    }));
    if (durableRows.length) await store.upsertEpisodes(durableRows);
    scheduleRender(created.length || expired.length ? 0 : 350);
  },
  onStatus: (status) => {
    state.collectorStatus = status;
    renderCollectorStatus();
  },
});

async function initialize() {
  await store.initialize();
  for (const [value, label] of Object.entries(CANDIDATE_LABELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    elements.candidateFilter.append(option);
  }
  collector.connect();
  await render();
}

elements.dayButtons.forEach((button) => button.addEventListener("click", () => {
  state.days = Number(button.dataset.days) || 7;
  elements.dayButtons.forEach((item) => item.classList.toggle("is-active", item === button));
  scheduleRender(0);
}));

elements.symbolFilter.addEventListener("input", () => scheduleRender(150));
elements.candidateFilter.addEventListener("change", () => scheduleRender(0));
elements.reviewFilter.addEventListener("change", () => scheduleRender(0));
elements.refresh.addEventListener("click", () => scheduleRender(0));
elements.exportJson.addEventListener("click", exportJson);
elements.exportCsv.addEventListener("click", exportCsv);
elements.collectorToggle.addEventListener("click", () => {
  state.running = !state.running;
  if (state.running) collector.connect();
  else collector.disconnect();
  renderCollectorStatus();
});

window.addEventListener("beforeunload", () => collector.disconnect());
setInterval(() => scheduleRender(0), 5_000);
initialize();
