import fs from "node:fs";

const BUILD = "26-80-signal-lab-v2-training-v1";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, before, after, label) {
  if (!content.includes(before)) throw new Error(`Missing integration anchor: ${label}`);
  return content.replace(before, after);
}

let owner = read("owner-signal-lab.js");
owner = replaceOnce(
  owner,
  'const BUILD = "26-64-signal-lab-without-impulse-v1";',
  `const BUILD = "${BUILD}";`,
  "owner build",
);
owner = replaceOnce(
  owner,
  `const REVIEW_REASONS = Object.freeze([\n  ["", "Причина (необязательно)"],\n  ["wrong-structure", "Неверно собран паттерн"],\n  ["weak-extremes", "Плохие экстремумы / уровень"],\n  ["late-trigger", "Слишком поздний сигнал"],\n  ["noise", "Обычный рыночный шум"],\n  ["bad-liquidity", "Плохая ликвидность"],\n  ["other", "Другое"],\n]);`,
  `const REVIEW_REASONS = Object.freeze([\n  ["", "Причина (необязательно)"],\n  ["wrong_structure", "Неверно собрана структура"],\n  ["weak_extrema", "Слабые экстремумы"],\n  ["wrong_level", "Неверный уровень"],\n  ["late_trigger", "Слишком позднее подтверждение"],\n  ["early_trigger", "Слишком раннее подтверждение"],\n  ["ordinary_noise", "Обычный рыночный шум"],\n  ["bad_liquidity", "Недостаточная ликвидность"],\n  ["missing_context", "Не хватает контекста до события"],\n  ["missing_post_event_path", "Не сохранено продолжение после события"],\n  ["wrong_direction", "Неверно определено направление"],\n  ["same_market_episode", "Это продолжение того же эпизода"],\n  ["other", "Другое"],\n]);\n\nconst REVIEW_VERDICTS = Object.freeze([\n  ["valid", "✓ Верный"],\n  ["weak", "~ Слабый"],\n  ["false_positive", "✕ Ложный"],\n  ["missed_pattern", "Пропущен"],\n  ["duplicate_episode", "Дубль"],\n  ["wrong_pattern", "Другой тип"],\n  ["insufficient_data", "? Мало данных"],\n]);\n\nconst PATTERN_STATE_LABELS = Object.freeze({\n  hypothesis: "Гипотеза",\n  candidate: "Кандидат",\n  triggered: "Сработал",\n  confirmed: "Подтверждён",\n  weakening: "Ослабевает",\n  invalidated: "Отменён",\n  completed: "Завершён",\n});`,
  "review dictionaries",
);
owner = replaceOnce(
  owner,
  "let localReviews = new Map();",
  "let localReviews = new Map();\nlet patternDefinitions = {};\nlet patternStates = [];",
  "catalog runtime state",
);
owner = replaceOnce(
  owner,
  `function detectorExplanation(event) {\n  const evidence = event?.detectorEvidence ?? {};`,
  `function detectorExplanation(event) {\n  if (event?.explanation) {\n    const state = PATTERN_STATE_LABELS[event.explanation.state] || event.explanation.state || "Кандидат";\n    const limitations = Array.isArray(event.explanation.limitations)\n      ? event.explanation.limitations\n      : [];\n    return {\n      lead: \`${"${event.explanation.label} · ${state}. Показаны только факты, которые реально сохранены в событии."}\`,\n      facts: [...(event.explanation.facts ?? [])].slice(0, 5),\n      limitations,\n    };\n  }\n  const evidence = event?.detectorEvidence ?? {};`,
  "facts-only explanation",
);
owner = replaceOnce(
  owner,
  `function eventReviewData(event, overrides = {}) {\n  const review = currentEventReview(event);\n  return {\n    reason: overrides.reason ?? review?.reason ?? "",\n    comment: overrides.comment ?? review?.comment ?? "",\n  };\n}`,
  `function eventReviewData(event, overrides = {}) {\n  const review = currentEventReview(event);\n  const detectorExtrema = Array.isArray(event?.detectorEvidence?.extrema)\n    ? event.detectorEvidence.extrema\n    : [];\n  return {\n    patternId: overrides.patternId ?? review?.patternId ?? event?.patternId ?? event?.signalType ?? null,\n    reviewedState: overrides.reviewedState ?? review?.reviewedState ?? event?.patternState ?? "triggered",\n    episodeId: overrides.episodeId ?? review?.episodeId ?? event?.episodeId ?? null,\n    referencePrice: overrides.referencePrice ?? review?.referencePrice ?? event?.price ?? null,\n    invalidationPrice: overrides.invalidationPrice ?? review?.invalidationPrice ?? null,\n    extrema: overrides.extrema ?? (review?.extrema?.length ? review.extrema : detectorExtrema),\n    reasonCodes: overrides.reasonCodes ?? review?.reasonCodes ?? (review?.reason ? [review.reason] : []),\n    comment: overrides.comment ?? review?.comment ?? "",\n  };\n}`,
  "V2 review payload",
);
owner = replaceOnce(
  owner,
  `  for (const [verdict, label] of [\n    ["good", "✓ Годный"],\n    ["bad", "✕ Мусор"],\n    ["unsure", "? Не уверен"],\n  ]) {`,
  "  for (const [verdict, label] of REVIEW_VERDICTS) {",
  "V2 verdict buttons",
);
owner = replaceOnce(
  owner,
  `      await persistReview(next, {\n        reason: reason.value,\n        comment: comment.value,\n      });`,
  "      await persistReview(next, collectReviewOverrides());",
  "verdict payload",
);
owner = replaceOnce(
  owner,
  `  reason.value = currentEventReview(event)?.reason || "";`,
  `  reason.value = currentEventReview(event)?.reasonCodes?.[0]\n    || currentEventReview(event)?.reason\n    || "";`,
  "reason migration",
);
owner = replaceOnce(
  owner,
  `  comment.maxLength = 1_000;\n  comment.placeholder = "Твой комментарий: что именно детектор увидел неправильно?";\n  comment.value = currentEventReview(event)?.comment || "";`,
  `  comment.maxLength = 2_000;\n  comment.placeholder = "Что именно верно или неверно: экстремумы, уровень, подтверждение, отмена, дубль?";\n  comment.value = currentEventReview(event)?.comment || "";\n\n  const detailGrid = document.createElement("div");\n  detailGrid.className = "event-review-v2-grid";\n  const addField = (labelText, control) => {\n    const label = document.createElement("label");\n    label.className = "event-review-v2-field";\n    appendTextElement(label, "span", labelText);\n    label.append(control);\n    detailGrid.append(label);\n  };\n\n  const pattern = document.createElement("select");\n  pattern.setAttribute("aria-label", "Канонический паттерн");\n  for (const definition of Object.values(patternDefinitions)) {\n    const option = document.createElement("option");\n    option.value = definition.id;\n    option.textContent = definition.label;\n    pattern.append(option);\n  }\n  if (!pattern.options.length && event.patternId) {\n    const option = document.createElement("option");\n    option.value = event.patternId;\n    option.textContent = event.explanation?.label || event.patternId;\n    pattern.append(option);\n  }\n  pattern.value = currentEventReview(event)?.patternId || event.patternId || "";\n\n  const reviewedState = document.createElement("select");\n  reviewedState.setAttribute("aria-label", "Состояние паттерна");\n  for (const value of patternStates) {\n    const option = document.createElement("option");\n    option.value = value;\n    option.textContent = PATTERN_STATE_LABELS[value] || value;\n    reviewedState.append(option);\n  }\n  reviewedState.value = currentEventReview(event)?.reviewedState || event.patternState || "triggered";\n\n  const referencePrice = document.createElement("input");\n  referencePrice.type = "number";\n  referencePrice.step = "any";\n  referencePrice.inputMode = "decimal";\n  referencePrice.placeholder = "Цена подтверждения";\n  referencePrice.value = finite(currentEventReview(event)?.referencePrice ?? event.price) ?? "";\n\n  const invalidationPrice = document.createElement("input");\n  invalidationPrice.type = "number";\n  invalidationPrice.step = "any";\n  invalidationPrice.inputMode = "decimal";\n  invalidationPrice.placeholder = "Цена отмены";\n  invalidationPrice.value = finite(currentEventReview(event)?.invalidationPrice) ?? "";\n\n  const episodeId = document.createElement("input");\n  episodeId.type = "text";\n  episodeId.maxLength = 180;\n  episodeId.placeholder = "ID рыночного эпизода";\n  episodeId.value = currentEventReview(event)?.episodeId || event.episodeId || "";\n\n  addField("Паттерн", pattern);\n  addField("Состояние", reviewedState);\n  addField("Подтверждение", referencePrice);\n  addField("Отмена", invalidationPrice);\n  addField("Эпизод / дубль", episodeId);\n\n  const collectReviewOverrides = () => ({\n    patternId: pattern.value || event.patternId || event.signalType,\n    reviewedState: reviewedState.value || "triggered",\n    episodeId: episodeId.value || event.episodeId || null,\n    referencePrice: finite(referencePrice.value),\n    invalidationPrice: finite(invalidationPrice.value),\n    extrema: currentEventReview(event)?.extrema?.length\n      ? currentEventReview(event).extrema\n      : (event?.detectorEvidence?.extrema ?? []),\n    reasonCodes: reason.value ? [reason.value] : [],\n    comment: comment.value,\n  });`,
  "V2 review controls",
);
owner = replaceOnce(
  owner,
  `    await persistReview(activeReview.verdict, {\n      reason: reason.value,\n      comment: comment.value,\n    });`,
  "    await persistReview(activeReview.verdict, collectReviewOverrides());",
  "details payload",
);
owner = replaceOnce(
  owner,
  `  reason.addEventListener("change", saveDetails);\n  comment.addEventListener("change", saveDetails);\n  review.append(actions, reason, comment);`,
  `  for (const control of [pattern, reviewedState, referencePrice, invalidationPrice, episodeId, reason, comment]) {\n    control.addEventListener("change", saveDetails);\n  }\n  review.append(actions, detailGrid, reason, comment);`,
  "V2 review listeners",
);
owner = replaceOnce(owner, "        exportVersion: 1,", "        exportVersion: 2,", "JSON export version");
owner = replaceOnce(
  owner,
  `  const headers = [\n    "eventId", "symbol", "signalType", "direction", "triggeredAt", "verdict",\n    "reason", "comment", "reviewedAt", "formulaVersion", "detectorEvidence",\n    "chartContext", "observations",\n  ];`,
  `  const headers = [\n    "eventId", "symbol", "signalType", "patternId", "direction", "triggeredAt",\n    "verdict", "reviewedState", "episodeId", "referencePrice", "invalidationPrice",\n    "extrema", "reasonCodes", "comment", "reviewedAt", "formulaVersion",\n    "detectorEvidence", "chartContext", "observations",\n  ];`,
  "CSV headers",
);
owner = replaceOnce(
  owner,
  `      row.signalType,\n      row.direction,\n      new Date(row.triggeredAt).toISOString(),\n      row.review.verdict,\n      row.review.reason,\n      row.review.comment,\n      new Date(row.review.reviewedAt).toISOString(),`,
  `      row.signalType,\n      row.patternId || row.review.patternId || "",\n      row.direction,\n      new Date(row.triggeredAt).toISOString(),\n      row.review.verdict,\n      row.review.reviewedState || "",\n      row.review.episodeId || row.episodeId || "",\n      row.review.referencePrice,\n      row.review.invalidationPrice,\n      row.review.extrema || [],\n      row.review.reasonCodes || [],\n      row.review.comment,\n      new Date(row.review.reviewedAt).toISOString(),`,
  "CSV V2 fields",
);
owner = replaceOnce(
  owner,
  `    const [navigationModule, signalLabModule] = await withTimeout(\n      Promise.all([\n        import(\`./owner-navigation.js?v=${"${BUILD}"}\`),\n        import(\`./signal-lab.js?v=${"${BUILD}"}\`),\n      ]),`,
  `    const [navigationModule, signalLabModule, catalogModule] = await withTimeout(\n      Promise.all([\n        import(\`./owner-navigation.js?v=${"${BUILD}"}\`),\n        import(\`./signal-lab-v2-store.js?v=${"${BUILD}"}\`),\n        import(\`./signal-lab-v2-catalog.js?v=${"${BUILD}"}\`),\n      ]),`,
  "V2 module imports",
);
owner = replaceOnce(
  owner,
  `    buildInPulsNavigationUrl = navigationModule.buildInPulsNavigationUrl;\n    store = new signalLabModule.SignalLabLocalStore();`,
  `    buildInPulsNavigationUrl = navigationModule.buildInPulsNavigationUrl;\n    patternDefinitions = catalogModule.PATTERN_DEFINITIONS;\n    patternStates = catalogModule.PATTERN_STATES;\n    store = new signalLabModule.SignalLabV2Store();`,
  "V2 store boot",
);
write("owner-signal-lab.js", owner);

let html = read("owner-signal-lab.html");
html = html.replaceAll("26-64-signal-lab-without-impulse-v1", BUILD);
html = replaceOnce(
  html,
  "<h1 id=\"owner-title\">Какие паттерны дали движение</h1>",
  "<h1 id=\"owner-title\">Какие рыночные эпизоды действительно были</h1>",
  "owner heading",
);
html = replaceOnce(
  html,
  "<p>Сначала смотри долю движений больше 1%, затем выборку и риск. Это статистика прошлых событий, а не команда на сделку.</p>",
  "<p>Сначала проверь структуру, подтверждение, отмену и дубли. Результат после события — описание истории, а не команда на сделку.</p>",
  "owner intro",
);
write("owner-signal-lab.html", html);

let css = read("owner-signal-lab.css");
css += `\n\n/* Signal Lab V2 review controls */\n.event-verdicts { flex-wrap: wrap; }\n.event-verdicts button { flex: 1 1 112px; }\n.event-review-item button[data-verdict="valid"].is-active { border-color: rgba(66,217,177,.55); color: var(--green); background: rgba(66,217,177,.1); }\n.event-review-item button[data-verdict="weak"].is-active { border-color: rgba(240,191,103,.55); color: var(--amber); background: rgba(240,191,103,.1); }\n.event-review-item button[data-verdict="false_positive"].is-active,\n.event-review-item button[data-verdict="wrong_pattern"].is-active { border-color: rgba(255,111,128,.55); color: var(--red); background: rgba(255,111,128,.1); }\n.event-review-item button[data-verdict="duplicate_episode"].is-active { border-color: rgba(170,134,255,.55); color: var(--violet); background: rgba(170,134,255,.1); }\n.event-review-item button[data-verdict="missed_pattern"].is-active { border-color: rgba(101,183,255,.55); color: var(--blue); background: rgba(101,183,255,.1); }\n.event-review-item button[data-verdict="insufficient_data"].is-active { border-color: rgba(142,155,167,.55); color: var(--text); background: rgba(142,155,167,.1); }\n.event-review-v2-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }\n.event-review-v2-field { display: grid; gap: 4px; min-width: 0; }\n.event-review-v2-field span { color: var(--muted); font-size: 9px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }\n.event-review-v2-field select,\n.event-review-v2-field input { width: 100%; min-height: 36px; padding: 0 9px; border: 1px solid var(--line); border-radius: 7px; color: var(--text); background: #0b1016; }\n.event-review-v2-field:last-child { grid-column: 1 / -1; }\n@media (max-width: 620px) { .event-review-v2-grid { grid-template-columns: 1fr; } .event-review-v2-field:last-child { grid-column: auto; } }\n`;
write("owner-signal-lab.css", css);

let sw = read("sw.js");
sw = replaceOnce(
  sw,
  'const CACHE = "inpuls-26-79-agg-center-tape-scale-settings-v1";',
  `const CACHE = "inpuls-${BUILD}";`,
  "service worker cache",
);
sw = sw.replaceAll("26-64-signal-lab-without-impulse-v1", BUILD);
sw = replaceOnce(
  sw,
  `  ["/signal-lab.js", "./signal-lab.js?v=signal-lab-analytics-v1"],`,
  `  ["/signal-lab.js", "./signal-lab.js?v=signal-lab-analytics-v1"],\n  ["/signal-lab-v2-store.js", "./signal-lab-v2-store.js?v=${BUILD}"],\n  ["/signal-lab-v2-catalog.js", "./signal-lab-v2-catalog.js?v=${BUILD}"],\n  ["/signal-lab-v2-review.js", "./signal-lab-v2-review.js?v=${BUILD}"],\n  ["/signal-lab-v2-episodes.js", "./signal-lab-v2-episodes.js?v=${BUILD}"],\n  ["/signal-lab-v2-training.js", "./signal-lab-v2-training.js?v=${BUILD}"],`,
  "forced V2 modules",
);
sw = replaceOnce(
  sw,
  `  "./signal-lab.js?v=signal-lab-analytics-v1",`,
  `  "./signal-lab.js?v=signal-lab-analytics-v1",\n  "./signal-lab-v2-store.js?v=${BUILD}",\n  "./signal-lab-v2-catalog.js?v=${BUILD}",\n  "./signal-lab-v2-review.js?v=${BUILD}",\n  "./signal-lab-v2-episodes.js?v=${BUILD}",\n  "./signal-lab-v2-training.js?v=${BUILD}",`,
  "shell V2 modules",
);
write("sw.js", sw);

write("test/signal-lab-v2-integration.test.js", `import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst owner = fs.readFileSync("owner-signal-lab.js", "utf8");\nconst html = fs.readFileSync("owner-signal-lab.html", "utf8");\nconst sw = fs.readFileSync("sw.js", "utf8");\n\ntest("Signal Lab page boots through V2 adapter", () => {\n  assert.match(owner, /SignalLabV2Store/);\n  assert.match(owner, /signal-lab-v2-store\\.js/);\n  assert.match(owner, /duplicate_episode/);\n  assert.match(owner, /invalidationPrice/);\n  assert.match(html, /${BUILD}/);\n});\n\ntest("service worker caches all Signal Lab V2 runtime modules", () => {\n  for (const file of [\n    "signal-lab-v2-store.js",\n    "signal-lab-v2-catalog.js",\n    "signal-lab-v2-review.js",\n    "signal-lab-v2-episodes.js",\n    "signal-lab-v2-training.js",\n  ]) assert.match(sw, new RegExp(file.replaceAll(".", "\\\\.")));\n});\n`);

console.log("Signal Lab V2 integration applied");
