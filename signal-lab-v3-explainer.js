const HYPOTHESIS_LABELS = Object.freeze({
  knife_reclaim: "Нож",
  sharpening_rejection: "Заточка",
  level_breakout: "Пробой",
  cascade_breakout: "Каскад",
  continuation_breakout: "Продолжение вверх",
  continuation_breakdown: "Продолжение вниз",
  false_breakout: "Ложный пробой",
});

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const percent = (value) => {
  const number = finite(value);
  if (number === null) return null;
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
};

function originText(origins = []) {
  const labels = origins.map((origin) => {
    if (origin === "level_breakout") return "пробоя уровня";
    if (origin === "cascade_breakout") return "пробоя каскада";
    return "сильного импульса";
  });
  return labels.length ? labels.join(" и ") : "сильного импульса";
}

function choosePrimary(candidate) {
  const type = String(candidate?.candidateType ?? "");
  if (type === "down_reversal_attempt") return "knife_reclaim";
  if (type === "up_reversal_attempt") return "sharpening_rejection";
  if (type === "level_break_attempt_up" || type === "level_break_attempt_down") return "level_breakout";
  if (type === "cascade_structure_up" || type === "cascade_structure_down") return "cascade_breakout";
  return candidate?.patternHypotheses?.[0] ?? "level_breakout";
}

function explanationFor(candidate, primary) {
  const evidence = candidate?.evidence ?? {};
  const type = String(candidate?.candidateType ?? "");
  const reasoning = [];
  const confirmation = [];
  const invalidation = [];
  let headline = "Это предварительная гипотеза, а не готовый торговый сигнал.";
  let alternative = null;

  if (type === "down_reversal_attempt" || type === "up_reversal_attempt") {
    const knife = type === "down_reversal_attempt";
    const source = originText(Array.isArray(evidence.originPatterns) ? evidence.originPatterns : []);
    headline = knife
      ? `Я выбрал гипотезу «Нож», потому что после ${source} появился быстрый измеримый выкуп от свежего минимума.`
      : `Я выбрал гипотезу «Заточка», потому что после ${source} цена потеряла продолжение и резко вернулась от свежего максимума.`;
    const impulse = percent((knife ? -1 : 1) * (finite(evidence.impulsePercent) ?? 0));
    const recovery = percent((knife ? 1 : -1) * (finite(evidence.recoveryPercent) ?? 0));
    if (impulse) reasoning.push(`размер исходного импульса ${impulse}`);
    if (recovery) reasoning.push(`обратная реакция от экстремума ${recovery}`);
    if (finite(evidence.recoveryDurationMs) !== null) {
      reasoning.push(`реакция появилась за ${(finite(evidence.recoveryDurationMs) / 1_000).toFixed(1)} секунды`);
    }
    if (finite(evidence.natr5m) !== null) reasoning.push(`NATR5 ${finite(evidence.natr5m).toFixed(2)}%`);
    confirmation.push(knife ? "выкуп в ленте и удержание минимума" : "продавец в ленте и неспособность обновить максимум");
    confirmation.push("стаканная реакция у зоны, а не одиночный случайный тик");
    invalidation.push(knife ? "повторный пролив ниже экстремума без быстрого возврата" : "закрепление выше экстремума и продолжение выноса");
    alternative = evidence.originPatterns?.includes("cascade_breakout") ? "Продолжение пробоя каскада" : "Продолжение исходного пробоя";
  } else if (type === "level_break_attempt_up" || type === "level_break_attempt_down") {
    const upward = type.endsWith("_up");
    headline = evidence.broken
      ? "Я выбрал гипотезу «Пробой», потому что цена вышла за повторно тестируемый уровень. Это ещё кандидат: нужно доказать принятие цены за уровнем."
      : "Я выбрал кандидата «Пробой», потому что цена подошла к повторно тестируемому уровню. Самого пробоя и продолжения пока нет.";
    if (finite(evidence.touchCount) !== null) reasoning.push(`у уровня найдено ${Math.round(finite(evidence.touchCount))} касания`);
    if (finite(evidence.distancePercent) !== null) reasoning.push(`расстояние относительно уровня ${percent(evidence.distancePercent)}`);
    if (finite(evidence.natr5m) !== null) reasoning.push(`NATR5 ${finite(evidence.natr5m).toFixed(2)}%`);
    if (finite(evidence.quoteVolume24h) !== null) reasoning.push(`24-часовой оборот выше обязательного порога $100 млн`);
    confirmation.push("принятие цены за уровнем и follow-through");
    confirmation.push("либо качественный ретест с реакцией в сторону пробоя");
    invalidation.push("быстрый возврат обратно без продолжения");
    alternative = upward
      ? "После сильного выхода может сформироваться заточка"
      : "После сильного выхода может сформироваться нож";
  } else if (type === "cascade_structure_up" || type === "cascade_structure_down") {
    const upward = type.endsWith("_up");
    headline = "Я выбрал кандидата «Каскад», потому что вижу направленную цепочку минимум из трёх экстремумов, а не один случайный уровень.";
    if (finite(evidence.extremaCount) !== null) reasoning.push(`в цепочке ${Math.round(finite(evidence.extremaCount))} экстремума`);
    if (finite(evidence.zoneWidthPercent) !== null) reasoning.push(`ширина конструкции ${percent(evidence.zoneWidthPercent)}`);
    if (finite(evidence.natr5m) !== null) reasoning.push(`NATR5 ${finite(evidence.natr5m).toFixed(2)}%`);
    confirmation.push("ускорение при прохождении ближайшей ступени");
    confirmation.push("быстрое прохождение цепочки и follow-through");
    invalidation.push("возврат внутрь конструкции после попытки пробоя");
    alternative = upward
      ? "После импульсного пробоя каскада может сформироваться заточка"
      : "После импульсного пробоя каскада может сформироваться нож";
  }

  return { primary, headline, reasoning, confirmation, invalidation, alternative };
}

export function buildTraderExplanation(candidate, evidencePack = {}, now = Date.now()) {
  const primary = choosePrimary(candidate);
  const core = explanationFor(candidate, primary);
  const bookCoverage = Number(evidencePack?.coverage?.bookSnapshots) || 0;
  const priceCoverage = Number(evidencePack?.coverage?.pricePoints) || 0;
  const missing = [];
  if (!bookCoverage) missing.push("глубокий стакан ещё не записан для этой точки");
  if (priceCoverage < 10) missing.push("мало секундного контекста до события");
  if (!candidate?.evidence?.tps && !candidate?.evidence?.buyShare) missing.push("нет достаточного подтверждения потоком сделок");

  return Object.freeze({
    schemaVersion: 2,
    entity: "SignalLabTraderExplanation",
    generatedAt: now,
    primaryHypothesis: primary,
    primaryLabel: HYPOTHESIS_LABELS[primary] ?? primary,
    headline: core.headline,
    reasoning: Object.freeze(core.reasoning.slice(0, 5)),
    confirmation: Object.freeze(core.confirmation.slice(0, 4)),
    invalidation: Object.freeze(core.invalidation.slice(0, 4)),
    missingEvidence: Object.freeze(missing.slice(0, 4)),
    alternative: core.alternative,
    disclaimer: "Объяснение описывает наблюдаемую гипотезу и условия её проверки. Это не команда на сделку и не доказательство намерения участника.",
  });
}

export { HYPOTHESIS_LABELS };
