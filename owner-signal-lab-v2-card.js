import {
  drawSignalLabChart,
  SIGNAL_LAB_CHART_TIMEFRAMES,
} from "./owner-signal-lab-v2-chart.js";

const VERDICTS = Object.freeze([
  ["valid", "✓ Верный"],
  ["weak", "~ Слабый"],
  ["false_positive", "✕ Ложный"],
  ["missed_pattern", "Пропущен"],
  ["duplicate_episode", "Дубль"],
  ["wrong_pattern", "Другой тип"],
  ["insufficient_data", "? Мало данных"],
]);

const REASONS = Object.freeze([
  ["", "Причина (необязательно)"],
  ["wrong_structure", "Неверно собрана структура"],
  ["weak_extrema", "Слабые экстремумы"],
  ["wrong_level", "Неверный уровень"],
  ["late_trigger", "Слишком позднее подтверждение"],
  ["early_trigger", "Слишком раннее подтверждение"],
  ["ordinary_noise", "Обычный рыночный шум"],
  ["bad_liquidity", "Недостаточная ликвидность"],
  ["missing_context", "Не хватает контекста до события"],
  ["missing_post_event_path", "Не сохранено продолжение"],
  ["wrong_direction", "Неверное направление"],
  ["same_market_episode", "Продолжение того же эпизода"],
  ["other", "Другое"],
]);

const STATE_LABELS = Object.freeze({
  hypothesis: "Гипотеза",
  candidate: "Кандидат",
  triggered: "Сработал",
  confirmed: "Подтверждён",
  weakening: "Ослабевает",
  invalidated: "Отменён",
  completed: "Завершён",
});

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const percent = (value) => {
  const number = finite(value);
  return number === null ? "—" : `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
};

function addText(parent, tag, value, className = "") {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function selectFrom(options, value = "") {
  const select = document.createElement("select");
  for (const [optionValue, label] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    select.append(option);
  }
  select.value = value;
  return select;
}

function field(labelText, control) {
  const label = document.createElement("label");
  label.className = "lab-field";
  addText(label, "span", labelText);
  label.append(control);
  return label;
}

function timeLabel(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function outcomeMetric(label, value, note) {
  const item = document.createElement("div");
  addText(item, "span", label);
  addText(item, "strong", value);
  addText(item, "small", note);
  return item;
}

export function renderSignalLabEventCard(event, {
  patternDefinitions,
  patternStates,
  currentReview,
  saveReview,
  onReviewChanged,
} = {}) {
  const review = currentReview(event);
  const card = document.createElement("article");
  card.className = "lab-event";
  if (event.duplicateEpisode) card.dataset.duplicate = "true";

  const header = document.createElement("header");
  const identity = document.createElement("div");
  addText(identity, "strong", String(event.symbol || "").replace(/USDT$/, ""));
  addText(identity, "span", event.explanation?.label || event.patternId || event.signalType);
  if (event.duplicateEpisode) addText(identity, "b", "ДУБЛЬ ЭПИЗОДА", "duplicate-badge");
  const meta = document.createElement("div");
  addText(meta, "time", timeLabel(event.triggeredAt));
  addText(meta, "code", event.episodeId ? event.episodeId.split(":").slice(-2).join(":") : "без episodeId");
  header.append(identity, meta);

  const explanation = document.createElement("section");
  explanation.className = "lab-explanation";
  addText(
    explanation,
    "strong",
    `${event.explanation?.label || "Кандидат"} · ${STATE_LABELS[event.patternState] || event.patternState}`,
  );
  const facts = event.explanation?.facts ?? [];
  if (facts.length) {
    const list = document.createElement("ul");
    facts.forEach((fact) => addText(list, "li", fact));
    explanation.append(list);
  } else addText(explanation, "p", "Формальных фактов недостаточно. Событие требует ручной проверки.");
  const limitations = event.explanation?.limitations ?? [];
  if (limitations.length) {
    const details = document.createElement("details");
    addText(details, "summary", "Ограничения данных");
    addText(details, "p", limitations.join(" · "));
    explanation.append(details);
  }

  const chart = document.createElement("section");
  chart.className = "lab-chart";
  const chartButtons = document.createElement("div");
  chartButtons.className = "lab-chart-buttons";
  const canvas = document.createElement("canvas");
  const chartNote = addText(chart, "p", "Синим — событие, зелёным — подтверждение, красным — отмена, жёлтым — экстремумы.");
  chart.prepend(chartButtons, canvas);
  const detectorExtrema = Array.isArray(event?.detectorEvidence?.extrema)
    ? event.detectorEvidence.extrema
    : [];
  const extrema = review?.extrema?.length ? review.extrema : detectorExtrema;
  let timeframe = "1m";
  const redraw = () => {
    const drawn = drawSignalLabChart(canvas, event, {
      timeframe,
      extrema,
      referencePrice: review?.referencePrice ?? event.price,
      invalidationPrice: review?.invalidationPrice,
    });
    canvas.hidden = !drawn;
    chartNote.textContent = drawn
      ? "Показывается только сохранённый ценовой путь. Таймфреймы агрегируются из реальных данных."
      : "Для этой записи не сохранено достаточно цен. График не дорисовывается выдуманными свечами.";
  };
  for (const value of Object.keys(SIGNAL_LAB_CHART_TIMEFRAMES)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = value;
    button.classList.toggle("is-active", value === timeframe);
    button.addEventListener("click", () => {
      timeframe = value;
      chartButtons.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
      redraw();
    });
    chartButtons.append(button);
  }
  requestAnimationFrame(redraw);

  const outcome = document.createElement("section");
  outcome.className = "lab-outcome";
  outcome.append(
    outcomeMetric("Лучший ход", percent(event.observation?.mfePercent), "MFE"),
    outcomeMetric("Против сценария", percent(event.observation?.maePercent), "MAE"),
    outcomeMetric("Итог", percent(event.observation?.directionalReturnPercent), event.observation?.horizon || "—"),
  );

  const controls = document.createElement("section");
  controls.className = "lab-review";
  const verdicts = document.createElement("div");
  verdicts.className = "lab-verdicts";
  const pattern = selectFrom(
    Object.values(patternDefinitions).map((item) => [item.id, item.label]),
    review?.patternId || event.patternId || "",
  );
  const state = selectFrom(
    patternStates.map((item) => [item, STATE_LABELS[item] || item]),
    review?.reviewedState || event.patternState || "triggered",
  );
  const reference = document.createElement("input");
  reference.type = "number";
  reference.step = "any";
  reference.value = finite(review?.referencePrice ?? event.price) ?? "";
  const invalidation = document.createElement("input");
  invalidation.type = "number";
  invalidation.step = "any";
  invalidation.placeholder = "Не задана";
  invalidation.value = finite(review?.invalidationPrice) ?? "";
  const episode = document.createElement("input");
  episode.type = "text";
  episode.maxLength = 180;
  episode.value = review?.episodeId || event.episodeId || "";
  const reason = selectFrom(REASONS, review?.reasonCodes?.[0] || review?.reason || "");
  const comment = document.createElement("textarea");
  comment.rows = 2;
  comment.maxLength = 2_000;
  comment.placeholder = "Почему это верный, слабый, ложный или дублирующий эпизод?";
  comment.value = review?.comment || "";
  const grid = document.createElement("div");
  grid.className = "lab-review-grid";
  grid.append(
    field("Паттерн", pattern),
    field("Состояние", state),
    field("Подтверждение", reference),
    field("Отмена", invalidation),
    field("Эпизод", episode),
    field("Причина", reason),
  );
  const payload = () => ({
    patternId: pattern.value || event.patternId || event.signalType,
    reviewedState: state.value || "triggered",
    episodeId: episode.value || event.episodeId || null,
    referencePrice: finite(reference.value),
    invalidationPrice: finite(invalidation.value),
    extrema,
    reasonCodes: reason.value ? [reason.value] : [],
    comment: comment.value,
  });
  const buttons = new Map();
  for (const [verdict, label] of VERDICTS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.verdict = verdict;
    button.textContent = label;
    button.classList.toggle("is-active", review?.verdict === verdict);
    button.addEventListener("click", async () => {
      const next = currentReview(event)?.verdict === verdict ? null : verdict;
      for (const item of buttons.values()) item.disabled = true;
      try {
        await saveReview(event, next, payload());
        for (const [value, item] of buttons) item.classList.toggle("is-active", value === next);
        onReviewChanged?.();
      } finally {
        for (const item of buttons.values()) item.disabled = false;
      }
    });
    buttons.set(verdict, button);
    verdicts.append(button);
  }
  const saveDetails = async () => {
    const active = currentReview(event)?.verdict;
    if (!active) return;
    await saveReview(event, active, payload());
    onReviewChanged?.();
  };
  for (const input of [pattern, state, reference, invalidation, episode, reason, comment]) {
    input.addEventListener("change", saveDetails);
  }
  controls.append(verdicts, grid, comment);

  card.append(header, explanation, chart, outcome, controls);
  return card;
}
