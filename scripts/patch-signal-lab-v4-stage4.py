from pathlib import Path


def replace_once(path, old, new):
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"missing pattern in {path}: {old[:220]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Store manual cascade calibration next to the existing verdict.
replace_once(
    "signal-lab-v3-store.js",
    'export const SIGNAL_LAB_V3_DATABASE = "inpuls-signal-lab-v3";',
    'import { cascadeCalibrationCsvRow, normalizeCascadeCalibration } from "./signal-lab-v4-calibration.js?v=signal-lab-v4-stage4";\n\nexport const SIGNAL_LAB_V3_DATABASE = "inpuls-signal-lab-v3";',
)
replace_once(
    "signal-lab-v3-store.js",
    '''    errorLabels: Object.freeze([...new Set((Array.isArray(review.errorLabels) ? review.errorLabels : [])
      .map((value) => safeText(value, 48))
      .filter(Boolean))].slice(0, 24)),
    referencePrice: finite(review.referencePrice),''',
    '''    errorLabels: Object.freeze([...new Set((Array.isArray(review.errorLabels) ? review.errorLabels : [])
      .map((value) => safeText(value, 48))
      .filter(Boolean))].slice(0, 24)),
    calibration: normalizeCascadeCalibration(review.calibration ?? {}, now),
    referencePrice: finite(review.referencePrice),''',
)
replace_once(
    "signal-lab-v3-store.js",
    '''      limitations: Array.isArray(row.latest?.quality?.limitations)
        ? row.latest.quality.limitations.join(" | ")
        : "",
    }));''',
    '''      limitations: Array.isArray(row.latest?.quality?.limitations)
        ? row.latest.quality.limitations.join(" | ")
        : "",
      ...(cascadeCalibrationCsvRow(row) ?? {}),
    }));''',
)

# Owner page: calibration filter, summary, export and per-episode review form.
replace_once(
    "owner-signal-lab-v3.html",
    '    <link rel="stylesheet" href="./owner-signal-lab-v3-evidence.css?v=signal-lab-v4-stage3" />',
    '    <link rel="stylesheet" href="./owner-signal-lab-v3-evidence.css?v=signal-lab-v4-stage4" />\n    <link rel="stylesheet" href="./owner-signal-lab-v4-calibration.css?v=signal-lab-v4-stage4" />',
)
replace_once(
    "owner-signal-lab-v3.html",
    '''        <label>
          <span>Разметка</span>
          <select id="review-filter">
            <option value="">Все</option>
            <option value="unreviewed">Не размечено</option>
            <option value="valid">Годный</option>
            <option value="weak">Слабый</option>
            <option value="false_positive">Мусор</option>
            <option value="duplicate_episode">Дубль</option>
            <option value="wrong_pattern">Другой паттерн</option>
            <option value="insufficient_data">Мало данных</option>
          </select>
        </label>
        <button id="refresh" class="button primary" type="button">Обновить</button>''',
    '''        <label>
          <span>Разметка</span>
          <select id="review-filter">
            <option value="">Все</option>
            <option value="unreviewed">Не размечено</option>
            <option value="valid">Годный</option>
            <option value="weak">Слабый</option>
            <option value="false_positive">Мусор</option>
            <option value="duplicate_episode">Дубль</option>
            <option value="wrong_pattern">Другой паттерн</option>
            <option value="insufficient_data">Мало данных</option>
          </select>
        </label>
        <label>
          <span>Калибровка V4</span>
          <select id="calibration-filter">
            <option value="">Все каскады</option>
            <option value="unreviewed">Не откалибровано</option>
            <option value="canonical">Эталон</option>
            <option value="weak">Слабый</option>
            <option value="false">Ложный</option>
            <option value="ambiguous">Неоднозначный</option>
            <option value="unavailable">Нельзя проверить</option>
            <option value="eligible">Готово к калибровке</option>
            <option value="blocked">Заблокировано качеством</option>
          </select>
        </label>
        <button id="refresh" class="button primary" type="button">Обновить</button>''',
)
replace_once(
    "owner-signal-lab-v3.html",
    '''        <article class="stat-card">
          <span>История 1м</span>
          <strong id="warmup-count">0</strong>
        </article>
      </section>''',
    '''        <article class="stat-card">
          <span>История 1м</span>
          <strong id="warmup-count">0</strong>
        </article>
        <article class="stat-card">
          <span>Каскадов V4</span>
          <strong id="cascade-total-count">0</strong>
        </article>
        <article class="stat-card">
          <span>Размечено V4</span>
          <strong id="cascade-reviewed-count">0</strong>
        </article>
        <article class="stat-card">
          <span>Эталон / ложный</span>
          <strong id="cascade-class-count">0 / 0</strong>
        </article>
        <article class="stat-card">
          <span>Геометрия / результат</span>
          <strong id="cascade-eligible-count">0 / 0</strong>
        </article>
      </section>''',
)
replace_once(
    "owner-signal-lab-v3.html",
    '            <button id="export-csv" class="button secondary" type="button">Экспорт CSV</button>\n            <button id="clear-records"',
    '            <button id="export-csv" class="button secondary" type="button">Экспорт CSV</button>\n            <button id="export-calibration" class="button secondary" type="button">Экспорт калибровки V4</button>\n            <button id="clear-records"',
)
replace_once(
    "owner-signal-lab-v3.html",
    '''        <div id="empty-state" class="empty-state">
          Сборщик прогревает 1-минутную историю для расчёта NATR5. Эпизод появится только после прохождения
          фильтров: объём 24ч > $100 млн, NATR5 > 1% и наличие каскада, пробоя, ножа или заточки.
        </div>''',
    '''        <div id="empty-state" class="empty-state">
          Сборщик прогревает историю, активные экстремумы и зоны. Legacy-эпизоды используют прежние фильтры,
          а каскад V4 появится заранее в состоянии SETUP при наличии минимум двух активных ступеней.
        </div>''',
)

calibration_block = r'''
            <details data-field="cascade-calibration" class="cascade-calibration" hidden open>
              <summary>Калибровка каскада V4 — машина отдельно, ручная оценка отдельно</summary>
              <div class="cascade-machine-summary">
                <div><span>Состояние машины</span><strong data-field="calibration-machine-state">—</strong></div>
                <div><span>Ступени и ×N</span><strong data-field="calibration-machine-levels">—</strong></div>
                <div><span>Время lifecycle</span><strong data-field="calibration-machine-timing">—</strong></div>
                <div><span>Качество</span><strong data-field="calibration-machine-quality">—</strong></div>
                <div><span>Формула</span><strong data-field="calibration-machine-formula">—</strong></div>
                <div><span>Результаты</span><strong data-field="calibration-machine-outcomes">—</strong></div>
              </div>

              <div class="calibration-primary-grid">
                <label>
                  <span>Класс эпизода</span>
                  <select data-field="calibration-class">
                    <option value="">Не определён</option>
                    <option value="canonical">Эталонный каскад</option>
                    <option value="weak">Слабый, но допустимый</option>
                    <option value="false">Ложное срабатывание</option>
                    <option value="ambiguous">Неоднозначно</option>
                    <option value="unavailable">Нельзя проверить по данным</option>
                  </select>
                </label>
                <label>
                  <span>Уверенность разметки</span>
                  <select data-field="calibration-confidence">
                    <option value="1">1 — низкая</option>
                    <option value="2">2</option>
                    <option value="3" selected>3 — средняя</option>
                    <option value="4">4</option>
                    <option value="5">5 — высокая</option>
                  </select>
                </label>
              </div>

              <span class="calibration-subtitle">Проверка каждого слоя</span>
              <div class="calibration-checklist">
                <label class="calibration-check-row"><span>Экстремумы выбраны верно</span><select data-calibration-check="EXTREMES_CORRECT"><option value="unknown">—</option><option value="pass">Да</option><option value="fail">Нет</option><option value="unavailable">Не проверить</option></select></label>
                <label class="calibration-check-row"><span>Зоны объединены верно</span><select data-calibration-check="LEVEL_ZONES_CORRECT"><option value="unknown">—</option><option value="pass">Да</option><option value="fail">Нет</option><option value="unavailable">Не проверить</option></select></label>
                <label class="calibration-check-row"><span>Количество атак ×N верно</span><select data-calibration-check="TOUCH_COUNT_CORRECT"><option value="unknown">—</option><option value="pass">Да</option><option value="fail">Нет</option><option value="unavailable">Не проверить</option></select></label>
                <label class="calibration-check-row"><span>SETUP существовал до движения</span><select data-calibration-check="SETUP_BEFORE_TRIGGER"><option value="unknown">—</option><option value="pass">Да</option><option value="fail">Нет</option><option value="unavailable">Не проверить</option></select></label>
                <label class="calibration-check-row"><span>К1 → К2 → К3 идут по порядку</span><select data-calibration-check="LEVEL_ORDER_CORRECT"><option value="unknown">—</option><option value="pass">Да</option><option value="fail">Нет</option><option value="unavailable">Не проверить</option></select></label>
                <label class="calibration-check-row"><span>TRIGGER отмечен верно</span><select data-calibration-check="TRIGGER_CORRECT"><option value="unknown">—</option><option value="pass">Да</option><option value="fail">Нет</option><option value="unavailable">Не проверить</option></select></label>
                <label class="calibration-check-row"><span>CONFIRMATION отмечен верно</span><select data-calibration-check="CONFIRMATION_CORRECT"><option value="unknown">—</option><option value="pass">Да</option><option value="fail">Нет</option><option value="unavailable">Не проверить</option></select></label>
                <label class="calibration-check-row"><span>Отмена/FAILED определена верно</span><select data-calibration-check="INVALIDATION_CORRECT"><option value="unknown">—</option><option value="pass">Да</option><option value="fail">Нет</option><option value="unavailable">Не проверить</option></select></label>
                <label class="calibration-check-row"><span>Нет look-ahead</span><select data-calibration-check="NO_LOOKAHEAD"><option value="unknown">—</option><option value="pass">Да</option><option value="fail">Нет</option><option value="unavailable">Не проверить</option></select></label>
                <label class="calibration-check-row"><span>Хватает результата 15с/1м/3м/5м</span><select data-calibration-check="OUTCOMES_SUFFICIENT"><option value="unknown">—</option><option value="pass">Да</option><option value="fail">Нет</option><option value="unavailable">Не проверить</option></select></label>
              </div>

              <div class="calibration-actions">
                <button type="button" data-calibration-action="mark-pass">Все слои подтверждены</button>
                <button type="button" data-calibration-action="mark-unavailable">Данных недостаточно</button>
                <button type="button" data-calibration-action="copy-machine">Скопировать машинные значения</button>
              </div>

              <span class="calibration-subtitle">Как должно быть по ручной разметке</span>
              <div class="calibration-correction-grid">
                <label><span>Направление</span><select data-field="calibration-direction"><option value="">Без правки</option><option value="UP">Вверх</option><option value="DOWN">Вниз</option></select></label>
                <label><span>Ожидаемое состояние</span><select data-field="calibration-state"><option value="">Без правки</option><option value="SETUP">SETUP</option><option value="TRIGGERED">TRIGGERED</option><option value="CONFIRMED">CONFIRMED</option><option value="EXTENDED">EXTENDED</option><option value="PARTIAL">PARTIAL</option><option value="FAILED">FAILED</option></select></label>
                <label><span>Количество уровней</span><input data-field="calibration-level-count" type="number" min="2" max="12" step="1" placeholder="Например, 3" /></label>
                <label><span>Цены уровней через запятую</span><input data-field="calibration-level-prices" type="text" inputmode="decimal" placeholder="100, 102, 104" /></label>
                <label><span>×N через запятую</span><input data-field="calibration-touch-counts" type="text" inputmode="numeric" placeholder="2, 1, 3" /></label>
                <label><span>Комментарий к исправлению</span><textarea data-field="calibration-note" rows="2" placeholder="Что именно машина поняла неверно"></textarea></label>
              </div>

              <details class="calibration-reasons">
                <summary>Причины расхождения</summary>
                <div data-field="calibration-reasons" class="calibration-reason-grid">
                  <label><input type="checkbox" value="PRIMARY_LEVEL_WRONG" />Неверный К1</label>
                  <label><input type="checkbox" value="LEVEL_COUNT_WRONG" />Неверное число уровней</label>
                  <label><input type="checkbox" value="LEVEL_ORDER_WRONG" />Неверный порядок</label>
                  <label><input type="checkbox" value="LEVEL_GAPS_WRONG" />Неверные расстояния</label>
                  <label><input type="checkbox" value="TOUCH_COUNT_WRONG" />Неверный ×N</label>
                  <label><input type="checkbox" value="SETUP_LATE" />SETUP появился поздно</label>
                  <label><input type="checkbox" value="SETUP_TOO_EARLY" />SETUP появился слишком рано</label>
                  <label><input type="checkbox" value="TRIGGER_EARLY" />TRIGGER слишком рано</label>
                  <label><input type="checkbox" value="TRIGGER_LATE" />TRIGGER слишком поздно</label>
                  <label><input type="checkbox" value="CONFIRM_EARLY" />CONFIRM слишком рано</label>
                  <label><input type="checkbox" value="CONFIRM_LATE" />CONFIRM слишком поздно</label>
                  <label><input type="checkbox" value="FAILURE_REASON_WRONG" />Неверная отмена</label>
                  <label><input type="checkbox" value="DUPLICATE_EVENT" />Дубль события</label>
                  <label><input type="checkbox" value="DATA_GAP" />Разрыв данных</label>
                  <label><input type="checkbox" value="INSUFFICIENT_CONTEXT" />Не хватает контекста</label>
                  <label><input type="checkbox" value="WRONG_DIRECTION" />Неверное направление</label>
                  <label><input type="checkbox" value="OTHER" />Другая причина</label>
                </div>
              </details>
              <p data-field="calibration-eligibility" class="calibration-eligibility">Разметка ещё не сохранена.</p>
            </details>
'''
replace_once(
    "owner-signal-lab-v3.html",
    '            <h3>Ручная разметка</h3>\n            <label>',
    '            <h3>Ручная разметка</h3>\n' + calibration_block + '            <label>',
)
replace_once(
    "owner-signal-lab-v3.html",
    'owner-signal-lab-v3.js?v=signal-lab-v4-stage3',
    'owner-signal-lab-v3.js?v=signal-lab-v4-stage4',
)

# Owner runtime: collect, display, filter and export the manual calibration dataset.
replace_once(
    "owner-signal-lab-v3.js",
    'import { rowsToCsv, SignalLabV3Store } from "./signal-lab-v3-store.js";',
    '''import {
  buildCascadeCalibrationSample,
  CASCADE_CALIBRATION_CHECKS,
  CASCADE_CHECK_STATES,
  isCascadeV4Episode,
  resolveCascadeMachineEvent,
  summarizeCascadeCalibration,
} from "./signal-lab-v4-calibration.js?v=signal-lab-v4-stage4";
import { rowsToCsv, SignalLabV3Store } from "./signal-lab-v3-store.js?v=signal-lab-v4-stage4";''',
)
replace_once(
    "owner-signal-lab-v3.js",
    '  reviewFilter: document.querySelector("#review-filter"),\n  refresh:',
    '  reviewFilter: document.querySelector("#review-filter"),\n  calibrationFilter: document.querySelector("#calibration-filter"),\n  refresh:',
)
replace_once(
    "owner-signal-lab-v3.js",
    '  warmupCount: document.querySelector("#warmup-count"),\n  visibleCount:',
    '''  warmupCount: document.querySelector("#warmup-count"),
  cascadeTotalCount: document.querySelector("#cascade-total-count"),
  cascadeReviewedCount: document.querySelector("#cascade-reviewed-count"),
  cascadeClassCount: document.querySelector("#cascade-class-count"),
  cascadeEligibleCount: document.querySelector("#cascade-eligible-count"),
  visibleCount:''',
)
replace_once(
    "owner-signal-lab-v3.js",
    '  exportCsv: document.querySelector("#export-csv"),\n  clearRecords:',
    '  exportCsv: document.querySelector("#export-csv"),\n  exportCalibration: document.querySelector("#export-calibration"),\n  clearRecords:',
)
replace_once(
    "owner-signal-lab-v3.js",
    '    reviewState: elements.reviewFilter.value,\n    limit: 1_000,',
    '    reviewState: elements.reviewFilter.value,\n    calibrationClass: elements.calibrationFilter.value,\n    limit: 1_000,',
)

helpers = r'''
const calibrationClassByVerdict = Object.freeze({
  valid: "canonical",
  weak: "weak",
  false_positive: "false",
  duplicate_episode: "ambiguous",
  wrong_pattern: "false",
  insufficient_data: "unavailable",
});

function readCascadeCalibration(card, verdict = null) {
  const classField = card.querySelector('[data-field="calibration-class"]');
  const classification = classField?.value || calibrationClassByVerdict[verdict] || null;
  if (classField && !classField.value && classification) classField.value = classification;
  return {
    classification,
    confidence: card.querySelector('[data-field="calibration-confidence"]')?.value,
    checks: Object.fromEntries([...card.querySelectorAll("[data-calibration-check]")]
      .map((field) => [field.dataset.calibrationCheck, field.value])),
    corrections: {
      direction: card.querySelector('[data-field="calibration-direction"]')?.value,
      expectedState: card.querySelector('[data-field="calibration-state"]')?.value,
      levelCount: card.querySelector('[data-field="calibration-level-count"]')?.value,
      levelPrices: card.querySelector('[data-field="calibration-level-prices"]')?.value,
      touchCounts: card.querySelector('[data-field="calibration-touch-counts"]')?.value,
      note: card.querySelector('[data-field="calibration-note"]')?.value,
    },
    reasonCodes: [...card.querySelectorAll('[data-field="calibration-reasons"] input:checked')]
      .map((input) => input.value),
  };
}

function formatLifecycleTime(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(Number(value)));
}

function outcomeSummary(machine) {
  const anchor = machine?.anchors?.confirm ?? machine?.anchors?.trigger ?? machine?.anchors?.setup;
  const outcomes = anchor?.outcomes ?? {};
  const observed = ["15s", "1m", "3m", "5m"]
    .filter((horizon) => ["OBSERVED", "PARTIAL"].includes(outcomes?.[horizon]?.state));
  return observed.length ? observed.join(" / ") : "ещё собираются";
}

function calibrationMatches(episode, value) {
  if (!value) return true;
  if (!isCascadeV4Episode(episode)) return false;
  const sample = buildCascadeCalibrationSample(episode);
  if (!sample) return false;
  if (value === "unreviewed") return !sample.calibration.classification;
  if (value === "eligible") return sample.geometryEligible;
  if (value === "blocked") return !sample.geometryEligible && Boolean(sample.calibration.classification);
  return sample.calibration.classification === value;
}

function bindCascadeCalibration(episode, card) {
  const shell = card.querySelector('[data-field="cascade-calibration"]');
  if (!shell || !isCascadeV4Episode(episode)) {
    if (shell) shell.hidden = true;
    return;
  }
  shell.hidden = false;
  card.classList.add("is-v4-cascade");
  const machine = resolveCascadeMachineEvent(episode);
  const calibration = episode.review?.calibration ?? {};
  const checks = calibration.checks ?? {};
  card.querySelector('[data-field="calibration-machine-state"]').textContent = machine
    ? `${machine.state ?? "—"} · geom ${machine.geometricState ?? "—"}`
    : "машинное событие не найдено";
  card.querySelector('[data-field="calibration-machine-levels"]').textContent = machine
    ? (machine.levelPrices ?? []).map((price, index) => `К${index + 1} ${Number(price).toPrecision(7)} ×${machine.touchCounts?.[index] ?? 1}`).join(" · ")
    : "—";
  card.querySelector('[data-field="calibration-machine-timing"]').textContent = machine
    ? `S ${formatLifecycleTime(machine.setupDetectedAt)} · T ${formatLifecycleTime(machine.triggeredAt)} · C ${formatLifecycleTime(machine.confirmedAt)}`
    : "—";
  card.querySelector('[data-field="calibration-machine-quality"]').textContent = machine?.dataQuality ?? episode.latest?.quality?.state ?? "UNKNOWN";
  card.querySelector('[data-field="calibration-machine-formula"]').textContent = machine?.formulaVersion ?? episode.latest?.formulaVersion ?? "—";
  card.querySelector('[data-field="calibration-machine-outcomes"]').textContent = outcomeSummary(machine);

  card.querySelector('[data-field="calibration-class"]').value = calibration.classification ?? "";
  card.querySelector('[data-field="calibration-confidence"]').value = String(calibration.confidence ?? 3);
  card.querySelectorAll("[data-calibration-check]").forEach((field) => {
    field.value = checks[field.dataset.calibrationCheck] ?? CASCADE_CHECK_STATES.UNKNOWN;
  });
  card.querySelector('[data-field="calibration-direction"]').value = calibration.corrections?.direction ?? "";
  card.querySelector('[data-field="calibration-state"]').value = calibration.corrections?.expectedState ?? "";
  card.querySelector('[data-field="calibration-level-count"]').value = calibration.corrections?.levelCount ?? "";
  card.querySelector('[data-field="calibration-level-prices"]').value = calibration.corrections?.levelPrices?.join(", ") ?? "";
  card.querySelector('[data-field="calibration-touch-counts"]').value = calibration.corrections?.touchCounts?.join(", ") ?? "";
  card.querySelector('[data-field="calibration-note"]').value = calibration.corrections?.note ?? "";
  const reasonCodes = new Set(calibration.reasonCodes ?? []);
  card.querySelectorAll('[data-field="calibration-reasons"] input').forEach((input) => {
    input.checked = reasonCodes.has(input.value);
  });

  card.querySelector('[data-calibration-action="mark-pass"]').addEventListener("click", () => {
    card.querySelectorAll("[data-calibration-check]").forEach((field) => { field.value = CASCADE_CHECK_STATES.PASS; });
    const classField = card.querySelector('[data-field="calibration-class"]');
    if (!classField.value) classField.value = "canonical";
  });
  card.querySelector('[data-calibration-action="mark-unavailable"]').addEventListener("click", () => {
    card.querySelectorAll("[data-calibration-check]").forEach((field) => { field.value = CASCADE_CHECK_STATES.UNAVAILABLE; });
    card.querySelector('[data-field="calibration-class"]').value = "unavailable";
  });
  card.querySelector('[data-calibration-action="copy-machine"]').addEventListener("click", () => {
    if (!machine) return;
    card.querySelector('[data-field="calibration-direction"]').value = machine.direction ?? "";
    card.querySelector('[data-field="calibration-state"]').value = machine.state ?? "";
    card.querySelector('[data-field="calibration-level-count"]').value = machine.levelIds?.length ?? "";
    card.querySelector('[data-field="calibration-level-prices"]').value = machine.levelPrices?.join(", ") ?? "";
    card.querySelector('[data-field="calibration-touch-counts"]').value = machine.touchCounts?.join(", ") ?? "";
  });

  const eligibility = card.querySelector('[data-field="calibration-eligibility"]');
  const sample = buildCascadeCalibrationSample(episode);
  eligibility.classList.remove("is-eligible", "is-blocked");
  if (!sample?.calibration.classification) {
    eligibility.textContent = "Выбери класс, проверь слои и сохрани разметку кнопкой вердикта ниже.";
  } else if (sample.geometryEligible) {
    eligibility.classList.add("is-eligible");
    eligibility.textContent = sample.outcomeEligible
      ? "Разрешено использовать для калибровки геометрии и результатов."
      : "Разрешено использовать для калибровки геометрии; результаты пока не подтверждены.";
  } else {
    eligibility.classList.add("is-blocked");
    eligibility.textContent = `Не включать в калибровку: ${sample.blockers.join(", ") || "неполная разметка"}.`;
  }
}
'''
replace_once(
    "owner-signal-lab-v3.js",
    '\nasync function saveReview(episode, card, verdict) {',
    '\n' + helpers + '\nasync function saveReview(episode, card, verdict) {',
)
replace_once(
    "owner-signal-lab-v3.js",
    '''      finalPatternId: pattern.value,
      comment: comment.value,
    errorLabels: [...card.querySelectorAll('[data-field="error-labels"] input:checked')].map((input) => input.value),
    });''',
    '''      finalPatternId: pattern.value,
      comment: comment.value,
      errorLabels: [...card.querySelectorAll('[data-field="error-labels"] input:checked')].map((input) => input.value),
      calibration: isCascadeV4Episode(episode) ? readCascadeCalibration(card, verdict) : undefined,
    });''',
)
replace_once(
    "owner-signal-lab-v3.js",
    '''  card.querySelectorAll("[data-verdict]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.verdict === episode.reviewState);
    button.addEventListener("click", () => saveReview(episode, card, button.dataset.verdict));
  });
  return card;''',
    '''  bindCascadeCalibration(episode, card);
  card.querySelectorAll("[data-verdict]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.verdict === episode.reviewState);
    button.addEventListener("click", () => saveReview(episode, card, button.dataset.verdict));
  });
  return card;''',
)
replace_once(
    "owner-signal-lab-v3.js",
    '''    const merged = rows.map(mergeEpisode);
    const summary = await store.summary(filters());
    elements.episodesCount.textContent = String(summary.episodes);
    elements.reviewedCount.textContent = String(summary.reviewed);
    elements.activeCount.textContent = String(activeEpisodeCount());
    elements.visibleCount.textContent = `${merged.length} эпизодов`;''',
    '''    const allMerged = rows.map(mergeEpisode);
    const cascadeSummary = summarizeCascadeCalibration(allMerged);
    const merged = allMerged.filter((episode) => calibrationMatches(episode, elements.calibrationFilter.value));
    const summary = await store.summary(filters());
    elements.episodesCount.textContent = String(summary.episodes);
    elements.reviewedCount.textContent = String(summary.reviewed);
    elements.activeCount.textContent = String(activeEpisodeCount());
    elements.cascadeTotalCount.textContent = String(cascadeSummary.episodes);
    elements.cascadeReviewedCount.textContent = String(cascadeSummary.reviewed);
    elements.cascadeClassCount.textContent = `${cascadeSummary.canonical} / ${cascadeSummary.false}`;
    elements.cascadeEligibleCount.textContent = `${cascadeSummary.geometryEligible} / ${cascadeSummary.outcomeEligible}`;
    elements.visibleCount.textContent = `${merged.length} эпизодов`;''',
)

export_calibration = r'''
async function exportCalibration() {
  const episodes = await store.list({ ...filters(), calibrationClass: undefined, limit: 5_000 });
  const samples = episodes
    .map((episode) => buildCascadeCalibrationSample(episode))
    .filter((sample) => sample?.calibration?.classification);
  download(
    `inpuls-signal-lab-v4-cascade-calibration-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json;charset=utf-8",
    JSON.stringify({
      schemaVersion: 1,
      entity: "SignalLabCascadeCalibrationExport",
      exportedAt: Date.now(),
      summary: summarizeCascadeCalibration(episodes),
      samples,
    }, null, 2),
  );
}
'''
replace_once(
    "owner-signal-lab-v3.js",
    '\nfunction shouldPersist(episode, force = false, now = Date.now()) {',
    '\n' + export_calibration + '\nfunction shouldPersist(episode, force = false, now = Date.now()) {',
)
replace_once(
    "owner-signal-lab-v3.js",
    'elements.reviewFilter.addEventListener("change", () => scheduleRender(0));\n',
    'elements.reviewFilter.addEventListener("change", () => scheduleRender(0));\nelements.calibrationFilter.addEventListener("change", () => scheduleRender(0));\n',
)
replace_once(
    "owner-signal-lab-v3.js",
    'elements.exportCsv.addEventListener("click", exportCsv);\n',
    'elements.exportCsv.addEventListener("click", exportCsv);\nelements.exportCalibration.addEventListener("click", exportCalibration);\n',
)

# Static documentation and integration tests.
Path("docs/signal-lab-v4-cascade-calibration-stage4.md").write_text(r'''# Signal Lab V4 — Stage 4: manual cascade calibration

## Goal

Stage 4 does not change detector thresholds. It converts every V4 cascade episode into a reproducible comparison between machine output and manual review.

## Human label

Each cascade receives one class:

- `canonical` — canonical episode;
- `weak` — weak but admissible;
- `false` — false machine event;
- `ambiguous` — reviewer cannot choose one interpretation;
- `unavailable` — data is not sufficient.

The reviewer separately checks extrema, zone merge, touch count, setup timing, level order, trigger, confirmation, invalidation, look-ahead and outcome coverage.

## Corrections

Manual correction may store expected direction, lifecycle state, level count, level prices and touch counts. Machine values are never overwritten.

## Calibration eligibility

A sample is allowed into geometry calibration only when:

- a non-ambiguous class is explicitly selected;
- the machine event is available;
- data quality is not GAP, STALE or ERROR;
- no look-ahead error is flagged;
- every required geometry check is explicitly pass or fail rather than unknown/unavailable.

Outcome calibration additionally requires `OUTCOMES_SUFFICIENT = pass`.

False examples are retained because they are necessary for precision calibration. Ambiguous and unavailable examples remain in the dataset but are blocked from threshold fitting.

Formula: `signal-lab-v4-cascade-calibration-v1-2026-08`.
''', encoding="utf-8")

Path("test/signal-lab-v4-calibration-integration.test.js").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SignalLabV3Store } from "../signal-lab-v3-store.js";

const page = fs.readFileSync(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
const owner = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");

function allChecks(value = "pass") {
  return Object.fromEntries([
    "EXTREMES_CORRECT",
    "LEVEL_ZONES_CORRECT",
    "TOUCH_COUNT_CORRECT",
    "SETUP_BEFORE_TRIGGER",
    "LEVEL_ORDER_CORRECT",
    "TRIGGER_CORRECT",
    "CONFIRMATION_CORRECT",
    "INVALIDATION_CORRECT",
    "NO_LOOKAHEAD",
    "OUTCOMES_SUFFICIENT",
  ].map((key) => [key, value]));
}

test("owner page exposes machine-versus-human cascade calibration", () => {
  assert.match(page, /Калибровка каскада V4/);
  assert.match(page, /data-calibration-check="EXTREMES_CORRECT"/);
  assert.match(page, /data-calibration-check="SETUP_BEFORE_TRIGGER"/);
  assert.match(page, /data-calibration-check="NO_LOOKAHEAD"/);
  assert.match(page, /export-calibration/);
  assert.match(page, /signal-lab-v4-stage4/);
});

test("owner runtime stores, filters and exports calibration samples", () => {
  assert.match(owner, /readCascadeCalibration/);
  assert.match(owner, /bindCascadeCalibration/);
  assert.match(owner, /summarizeCascadeCalibration/);
  assert.match(owner, /geometryEligible/);
  assert.match(owner, /exportCalibration/);
});

test("memory store persists nested calibration and exposes it in CSV rows", async () => {
  const store = new SignalLabV3Store({ indexedDB: null });
  await store.initialize();
  const machine = {
    id: "cascade-1",
    formulaVersion: "signal-lab-v4-cascade-v1-2026-08",
    state: "CONFIRMED",
    geometricState: "CONFIRMED",
    direction: "UP",
    setupDetectedAt: 1_000,
    triggeredAt: 2_000,
    confirmedAt: 3_000,
    levelIds: ["h1", "h2"],
    levelPrices: [100, 102],
    touchCounts: [2, 1],
    adjacentGapPct: [2],
    dataQuality: "LIVE",
    anchors: {},
  };
  await store.upsertEpisodes([{
    id: "episode-1",
    symbol: "TESTUSDT",
    candidateType: "cascade_v4_up",
    label: "Каскад V4 вверх",
    direction: "up",
    stage: "triggered",
    firstSeenAt: 1_000,
    lastSeenAt: 4_000,
    observations: 3,
    peakEvidenceScore: 80,
    latest: { evidence: { cascadeV4: machine }, quality: { state: "LIVE" } },
    evidencePack: { cascadeMapLatest: { history: [machine] }, coverage: {} },
  }]);
  await store.saveReview("episode-1", {
    verdict: "valid",
    finalPatternId: "cascade_breakout",
    calibration: {
      classification: "canonical",
      confidence: 5,
      checks: allChecks(),
      corrections: {},
      reasonCodes: [],
    },
  });
  const [row] = await store.list({ limit: 10 });
  assert.equal(row.review.calibration.classification, "canonical");
  assert.equal(row.review.calibration.checks.NO_LOOKAHEAD, "pass");
  const [csv] = await store.exportRows({ limit: 10 });
  assert.equal(csv.machineState, "CONFIRMED");
  assert.equal(csv.calibrationClass, "canonical");
  assert.equal(csv.geometryEligible, "yes");
});
''', encoding="utf-8")
