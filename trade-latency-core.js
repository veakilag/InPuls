export function percentile(values, quantile) {
  const clean = (values ?? []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const q = Math.max(0, Math.min(1, Number(quantile) || 0));
  const position = (clean.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return clean[lower];
  const weight = position - lower;
  return clean[lower] * (1 - weight) + clean[upper] * weight;
}

export function summarize(values) {
  const clean = (values ?? []).map(Number).filter(Number.isFinite);
  if (!clean.length) {
    return { count: 0, min: null, mean: null, p50: null, p95: null, p99: null, max: null };
  }
  const sum = clean.reduce((total, value) => total + value, 0);
  return {
    count: clean.length,
    min: Math.min(...clean),
    mean: sum / clean.length,
    p50: percentile(clean, .5),
    p95: percentile(clean, .95),
    p99: percentile(clean, .99),
    max: Math.max(...clean),
  };
}

export function estimateClockOffset(samples) {
  const clean = (samples ?? [])
    .map((sample) => {
      const sentAt = Number(sample?.sentAt);
      const receivedAt = Number(sample?.receivedAt);
      const serverTime = Number(sample?.serverTime);
      const rttMs = receivedAt - sentAt;
      const offsetMs = serverTime - (sentAt + receivedAt) / 2;
      return { sentAt, receivedAt, serverTime, rttMs, offsetMs };
    })
    .filter((sample) => [sample.sentAt, sample.receivedAt, sample.serverTime, sample.rttMs, sample.offsetMs].every(Number.isFinite) && sample.rttMs >= 0)
    .sort((left, right) => left.rttMs - right.rttMs);

  if (!clean.length) return { offsetMs: 0, rttMs: null, sampleCount: 0 };
  const selected = clean.slice(0, Math.min(3, clean.length));
  return {
    offsetMs: percentile(selected.map((sample) => sample.offsetMs), .5) ?? 0,
    rttMs: percentile(selected.map((sample) => sample.rttMs), .5),
    sampleCount: selected.length,
  };
}

export function sourceFromTradePayload(payload) {
  const stream = String(payload?.stream ?? "").toLowerCase();
  const data = payload?.data ?? payload;
  const eventType = String(data?.e ?? "").toLowerCase();
  if (eventType === "aggtrade" || stream.endsWith("@aggtrade")) return "aggTrade";
  if (eventType === "trade" || (stream.endsWith("@trade") && !stream.endsWith("@aggtrade"))) return "trade";
  return null;
}

export function normalizeTradeEvent(event, source, receiveAt, expectedSymbol = null) {
  const normalizedSource = source === "trade" ? "trade" : "aggTrade";
  const symbol = String(event?.s ?? "").toUpperCase();
  const price = Number(event?.p);
  const quantity = Number(event?.q);
  const eventTime = Number(event?.E ?? event?.T);
  const tradeTime = Number(event?.T ?? event?.E);
  const received = Number(receiveAt);
  const id = normalizedSource === "trade" ? Number(event?.t) : Number(event?.a);
  const firstTradeId = normalizedSource === "trade" ? id : Number(event?.f);
  const lastTradeId = normalizedSource === "trade" ? id : Number(event?.l);

  if (expectedSymbol && symbol !== String(expectedSymbol).toUpperCase()) return null;
  if (!symbol || ![price, quantity, eventTime, tradeTime, received, id, firstTradeId, lastTradeId].every(Number.isFinite)) return null;
  if (price <= 0 || quantity <= 0 || eventTime <= 0 || tradeTime <= 0) return null;
  if (![id, firstTradeId, lastTradeId].every(Number.isInteger) || id < 0 || firstTradeId < 0 || lastTradeId < firstTradeId) return null;

  return {
    source: normalizedSource,
    symbol,
    id,
    firstTradeId,
    lastTradeId,
    price,
    quantity,
    quote: price * quantity,
    eventTime,
    tradeTime,
    receiveAt: received,
    maker: Boolean(event?.m),
    side: event?.m ? "sell" : "buy",
    renderAt: null,
  };
}

export function matchAggregateToRaw(aggregate, rawById, maximumRange = 10_000) {
  const first = Number(aggregate?.firstTradeId);
  const last = Number(aggregate?.lastTradeId);
  const aggregateReceiveAt = Number(aggregate?.receiveAt);
  const aggregateHasRenderAt = aggregate?.renderAt !== null && aggregate?.renderAt !== undefined;
  const aggregateRenderAt = aggregateHasRenderAt ? Number(aggregate.renderAt) : NaN;
  const aggregateQuantity = Number(aggregate?.quantity);
  if (![first, last, aggregateReceiveAt, aggregateQuantity].every(Number.isFinite) || last < first) return null;

  const expectedCount = last - first + 1;
  if (expectedCount > Math.max(1, Number(maximumRange) || 10_000)) {
    return {
      expectedCount,
      availableCount: 0,
      renderedCount: 0,
      coverage: 0,
      renderCoverage: 0,
      rawQuantity: 0,
      volumeDifference: null,
      volumeDifferencePercent: null,
      rawFirstLeadMs: null,
      rawCompleteLeadMs: null,
      rawFirstPaintLeadMs: null,
      rawCompletePaintLeadMs: null,
      tooLarge: true,
    };
  }

  let availableCount = 0;
  let renderedCount = 0;
  let rawQuantity = 0;
  let earliestReceiveAt = Infinity;
  let latestReceiveAt = -Infinity;
  let earliestRenderAt = Infinity;
  let latestRenderAt = -Infinity;

  for (let tradeId = first; tradeId <= last; tradeId += 1) {
    const raw = rawById?.get?.(tradeId);
    if (!raw) continue;
    availableCount += 1;
    rawQuantity += Number(raw.quantity) || 0;
    earliestReceiveAt = Math.min(earliestReceiveAt, Number(raw.receiveAt));
    latestReceiveAt = Math.max(latestReceiveAt, Number(raw.receiveAt));
    const rawHasRenderAt = raw.renderAt !== null && raw.renderAt !== undefined;
    const rawRenderAt = rawHasRenderAt ? Number(raw.renderAt) : NaN;
    if (Number.isFinite(rawRenderAt)) {
      renderedCount += 1;
      earliestRenderAt = Math.min(earliestRenderAt, rawRenderAt);
      latestRenderAt = Math.max(latestRenderAt, rawRenderAt);
    }
  }

  const volumeDifference = availableCount ? rawQuantity - aggregateQuantity : null;
  const volumeDifferencePercent = availableCount && aggregateQuantity !== 0
    ? Math.abs(volumeDifference) / Math.abs(aggregateQuantity) * 100
    : null;
  const aggregateRendered = Number.isFinite(aggregateRenderAt);

  return {
    expectedCount,
    availableCount,
    renderedCount,
    coverage: expectedCount > 0 ? availableCount / expectedCount : 0,
    renderCoverage: expectedCount > 0 ? renderedCount / expectedCount : 0,
    rawQuantity,
    volumeDifference,
    volumeDifferencePercent,
    rawFirstLeadMs: availableCount ? aggregateReceiveAt - earliestReceiveAt : null,
    rawCompleteLeadMs: availableCount ? aggregateReceiveAt - latestReceiveAt : null,
    rawFirstPaintLeadMs: aggregateRendered && renderedCount ? aggregateRenderAt - earliestRenderAt : null,
    rawCompletePaintLeadMs: aggregateRendered && renderedCount ? aggregateRenderAt - latestRenderAt : null,
    tooLarge: false,
  };
}

export function buildRunValidity({ phase, reconnects = 0, invalidEvents = 0, paintDrops = 0, hiddenDuringMeasurement = false, socketClosedDuringMeasurement = false, missingStreams = false } = {}) {
  if (!["finished", "invalid"].includes(phase)) {
    return { valid: null, title: "Подготовка", reasons: [] };
  }
  const reasons = [];
  if (Number(reconnects) > 0) reasons.push("WebSocket переподключался");
  if (Number(invalidEvents) > 0) reasons.push("получены некорректные события");
  if (Number(paintDrops) > 0) reasons.push("есть потери очереди отрисовки");
  if (hiddenDuringMeasurement) reasons.push("вкладка была скрыта");
  if (socketClosedDuringMeasurement) reasons.push("соединение закрылось во время измерения");
  if (missingStreams) reasons.push("не получены оба потока");
  return reasons.length
    ? { valid: false, title: "Тест невалиден", reasons }
    : { valid: true, title: "Тест валиден", reasons: [] };
}

export function buildVerdict({
  runValid,
  invalidReasons = [],
  matchedComplete,
  rawEarlierRatio,
  medianLeadMs,
  medianCompleteLeadMs,
  medianPaintLeadMs,
  medianCoverage,
  medianVolumeDifferencePercent,
  rawGapCount,
} = {}) {
  if (runValid === false) {
    return {
      tone: "negative",
      title: "Тест невалиден",
      text: invalidReasons.length ? invalidReasons.join("; ") : "Запуск нельзя использовать для продуктового решения.",
    };
  }
  if (!Number.isFinite(matchedComplete) || matchedComplete < 30) {
    return { tone: "neutral", title: "Недостаточно данных", text: "Нужно минимум 30 полностью сопоставленных групп." };
  }
  if ((medianCoverage ?? 0) < .999 || (medianVolumeDifferencePercent ?? Infinity) > .1 || (rawGapCount ?? 0) > 0) {
    return { tone: "warning", title: "Качество raw-потока не подтверждено", text: "Есть пропуски, неполное покрытие или расхождение объёма." };
  }
  if (
    (rawEarlierRatio ?? 0) >= .7
    && (medianLeadMs ?? 0) >= 30
    && (medianCompleteLeadMs ?? -Infinity) >= 0
    && (medianPaintLeadMs ?? -Infinity) > 0
  ) {
    return { tone: "positive", title: "@trade подтверждает преимущество", text: "Сырой поток стабильно раньше на получении и фактической отрисовке." };
  }
  if ((rawEarlierRatio ?? 0) <= .4 && (medianLeadMs ?? 0) < -2 && (medianPaintLeadMs ?? 0) < 0) {
    return { tone: "negative", title: "@aggTrade быстрее", text: "Агрегированный поток чаще приходит и рисуется раньше на этой сессии." };
  }
  return { tone: "neutral", title: "Преимущество не доказано", text: "Разница мала, нестабильна или исчезает к моменту отрисовки." };
}
