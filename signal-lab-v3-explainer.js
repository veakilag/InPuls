const HYPOTHESIS_LABELS = Object.freeze({
  knife_reclaim: "Нож",
  sharpening_rejection: "Заточка",
  continuation_breakout: "Продолжение вверх",
  continuation_breakdown: "Продолжение вниз",
  level_breakout: "Пробой уровня",
  false_breakout: "Ложный пробой",
  liquidity_sweep: "Снятие ликвидности",
  cascade_breakout: "Пробой каскада",
  liquidity_hold: "Удержание сайза",
  liquidity_rearrangement: "Переставляш / алгоритм",
  participant_activity: "Направленный поток",
  directional_impulse: "Направленный импульс",
  liquidation_cascade: "Каскад ликвидаций",
  exhaustion_reversal: "Истощение движения",
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

function choosePrimary(candidate) {
  const type = String(candidate?.candidateType ?? "");
  const evidence = candidate?.evidence ?? {};
  if (type === "down_reversal_attempt") return "knife_reclaim";
  if (type === "up_reversal_attempt") return "sharpening_rejection";
  if (type === "level_break_attempt_up" || type === "level_break_attempt_down") return "level_breakout";
  if (type === "level_pressure_up" || type === "level_pressure_down") return "liquidity_sweep";
  if (type === "cascade_structure_up" || type === "cascade_structure_down") return "cascade_breakout";
  if (type === "flow_acceleration_up" || type === "flow_acceleration_down") return "participant_activity";
  if (type === "liquidity_event_bid" || type === "liquidity_event_ask") {
    return evidence.moved === true ? "liquidity_rearrangement" : "liquidity_hold";
  }
  if (type === "liquidation_burst_up" || type === "liquidation_burst_down") return "liquidation_cascade";
  if (type === "up_displacement") return "continuation_breakout";
  if (type === "down_displacement") return "continuation_breakdown";
  return candidate?.patternHypotheses?.[0] ?? "directional_impulse";
}

function explanationFor(candidate, primary) {
  const evidence = candidate?.evidence ?? {};
  const type = String(candidate?.candidateType ?? "");
  const direction = candidate?.direction === "down" ? "down" : candidate?.direction === "up" ? "up" : "neutral";
  const reasoning = [];
  const confirmation = [];
  const invalidation = [];
  let headline = "Это предварительная гипотеза, а не готовый торговый сигнал.";
  let alternative = null;

  if (type === "up_displacement" || type === "down_displacement") {
    const move = percent(evidence.move15sPercent);
    const range = percent(evidence.range60sPercent);
    headline = direction === "up"
      ? "Я поставил продолжение вверх основной гипотезой, потому что пока вижу импульс, но ещё не вижу подтверждённого разворота от края."
      : "Я поставил продолжение вниз основной гипотезой, потому что пока вижу импульс, но ещё не вижу подтверждённого выкупа от экстремума.";
    if (move) reasoning.push(`за 15 секунд цена прошла ${move}`);
    if (range) reasoning.push(`минутный диапазон расширился до ${range}`);
    if (finite(evidence.volumeBoost) !== null) reasoning.push(`объём ускорился примерно в ${finite(evidence.volumeBoost).toFixed(1)} раза`);
    confirmation.push("удержание цены за зоной импульса или качественный ретест");
    confirmation.push("направленный поток сделок без быстрого встречного поглощения");
    invalidation.push("быстрый возврат внутрь исходного диапазона");
    invalidation.push("отсутствие продолжения после всплеска активности");
    alternative = direction === "up" ? "Заточка" : "Нож";
  } else if (type === "down_reversal_attempt" || type === "up_reversal_attempt") {
    const knife = type === "down_reversal_attempt";
    headline = knife
      ? "Я выбрал гипотезу «Нож», потому что после быстрого выноса вниз появился измеримый возврат от свежего экстремума."
      : "Я выбрал гипотезу «Заточка», потому что после быстрого выноса вверх цена начала терять продолжение и возвращаться от свежего экстремума.";
    const impulse = percent((knife ? -1 : 1) * (finite(evidence.impulsePercent) ?? 0));
    const recovery = percent((knife ? 1 : -1) * (finite(evidence.recoveryPercent) ?? 0));
    if (impulse) reasoning.push(`размер выноса составил ${impulse}`);
    if (recovery) reasoning.push(`реакция от экстремума составила ${recovery}`);
    if (finite(evidence.recoveryDurationMs) !== null) reasoning.push(`реакция появилась за ${(finite(evidence.recoveryDurationMs) / 1_000).toFixed(1)} секунды`);
    confirmation.push(knife ? "выкуп в ленте и удержание экстремума" : "продавец в ленте и неспособность обновить максимум");
    confirmation.push("стаканная реакция у зоны, а не одиночный случайный тик");
    invalidation.push(knife ? "повторный пролив ниже экстремума без быстрого возврата" : "закрепление выше экстремума и продолжение выноса");
    alternative = "Ложный пробой";
  } else if (type.includes("level_")) {
    headline = evidence.broken
      ? "Я выбрал гипотезу пробоя, потому что цена вышла за повторно тестируемый уровень."
      : "Я отметил подход к уровню как кандидата, потому что цена вернулась к зоне нескольких касаний, но самого пробоя ещё нет.";
    if (finite(evidence.touchCount) !== null) reasoning.push(`у уровня найдено ${Math.round(finite(evidence.touchCount))} касания`);
    if (finite(evidence.distancePercent) !== null) reasoning.push(`текущее расстояние до уровня ${percent(evidence.distancePercent)}`);
    confirmation.push("принятие цены за уровнем и продолжение после выхода");
    confirmation.push("либо ретест уровня с реакцией в сторону пробоя");
    invalidation.push("быстрый возврат обратно без продолжения");
    alternative = "Ложный пробой";
  } else if (type.includes("cascade_structure")) {
    headline = "Я выбрал гипотезу каскада, потому что вижу направленную цепочку последовательных экстремумов, а не один случайный уровень.";
    if (finite(evidence.extremaCount) !== null) reasoning.push(`в цепочке ${Math.round(finite(evidence.extremaCount))} экстремума`);
    if (finite(evidence.zoneWidthPercent) !== null) reasoning.push(`ширина конструкции ${percent(evidence.zoneWidthPercent)}`);
    confirmation.push("ускорение при прохождении ближайшей ступени");
    confirmation.push("быстрое прохождение всей цепочки и follow-through");
    invalidation.push("возврат внутрь конструкции после попытки пробоя");
    alternative = "Ложный пробой каскада";
  } else if (type.includes("flow_acceleration")) {
    headline = "Я выбрал гипотезу направленного потока, потому что одновременно выросли скорость сделок, объём и доля одной стороны.";
    if (finite(evidence.tps) !== null) reasoning.push(`${finite(evidence.tps).toFixed(1)} сделок в секунду`);
    if (finite(evidence.buyShare) !== null) reasoning.push(`доля агрессивных покупок ${finite(evidence.buyShare).toFixed(0)}%`);
    if (finite(evidence.volumeBoost) !== null) reasoning.push(`объём ускорился в ${finite(evidence.volumeBoost).toFixed(1)} раза`);
    confirmation.push("цена должна отвечать на агрессию и удерживать направление");
    invalidation.push("высокая агрессия без движения цены — возможное поглощение");
    alternative = "Истощение движения";
  } else if (type.includes("liquidity_event")) {
    headline = evidence.moved === true
      ? "Я выбрал гипотезу переставляша, потому что крупная отображаемая ликвидность повторилась на другой цене с близким размером."
      : "Я выбрал гипотезу удержания сайза, потому что лучшая котировка заметно крупнее своей локальной нормы и повторяется.";
    if (finite(evidence.quoteUsd) !== null) reasoning.push(`видимый объём около $${Math.round(finite(evidence.quoteUsd)).toLocaleString("ru-RU")}`);
    if (finite(evidence.sizeMultiple) !== null) reasoning.push(`${finite(evidence.sizeMultiple).toFixed(1)}× к локальной медиане`);
    if (finite(evidence.touchCount) !== null) reasoning.push(`${Math.round(finite(evidence.touchCount))} повторения`);
    confirmation.push("реакция цены и ленты на присутствие ликвидности");
    invalidation.push("сайз снят или проеден без реакции цены");
    alternative = "Обычная крупная заявка без намерения";
  } else if (type.includes("liquidation_burst")) {
    headline = "Я выбрал гипотезу каскада ликвидаций, потому что объём принудительных закрытий стал аномальным относительно текущего оборота.";
    if (finite(evidence.totalQuoteUsd) !== null) reasoning.push(`общий объём ликвидаций около $${Math.round(finite(evidence.totalQuoteUsd)).toLocaleString("ru-RU")}`);
    confirmation.push("цена продолжает движение вслед за ликвидациями");
    invalidation.push("ликвидации закончились, а цена сразу вернулась");
    alternative = "Истощение движения";
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
    schemaVersion: 1,
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
