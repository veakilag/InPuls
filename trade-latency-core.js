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

export function normalizeTradeEvent(event, source, receiveAt) {
  const price = Number(event?.p);
  const quantity = Number(event?.q);
  const eventTime = Number(event?.E ?? event?.T);
  const tradeTime = Number(event?.T ?? event?.E);
  if (![price, quantity, eventTime, tradeTime, receiveAt].every(Number.isFinite)) return null;

  const normalizedSource = source === "trade" ? "trade" : "aggTrade";
  const id = normalizedSource === "trade" ? Number(event?.t) : Number(event?.a);
  if (!Number.isFinite(id)) return null;

  return {
    source: normalizedSource,
    id,
    firstTradeId: normalizedSource === "trade" ? id : Number(event?.f),
    lastTradeId: normalizedSource === "trade" ? id : Number(event?.l),
    price,
    quantity,
    quote: price * quantity,
    eventTime,
    tradeTime,
    receiveAt: Number(receiveAt),
    maker: Boolean(event?.m),
    side: event?.m ? "sell" : "buy",
    renderAt: null,
  };
}

export function matchAggregateToRaw(aggregate, rawById, maximumRange = 10_000) {
  const first = Number(aggregate?.firstTradeId);
  const last = Number(aggregate?.lastTradeId);
  const aggregateReceiveAt = Number(aggregate?.receiveAt);
  const aggregateQuantity = Number(aggregate?.quantity);
  if (![first, last, aggregateReceiveAt, aggregateQuantity].every(Number.isFinite) || last < first) return null;

  const expectedCount = last - first + 1;
  if (expectedCount > Math.max(1, Number(maximumRange) || 10_000)) {
    return {
      expectedCount,
      availableCount: 0,
      coverage: 0,
      rawQuantity: 0,
      volumeDifference: null,
      volumeDifferencePercent: null,
      rawFirstLeadMs: null,
      rawCompleteLeadMs: null,
      tooLarge: true,
    };
  }

  let availableCount = 0;
  let rawQuantity = 0;
  let earliestReceiveAt = Infinity;
  let latestReceiveAt = -Infinity;

  for (let tradeId = first; tradeId <= last; tradeId += 1) {
    const raw = rawById?.get?.(tradeId);
    if (!raw) continue;
    availableCount += 1;
    rawQuantity += Number(raw.quantity) || 0;
    earliestReceiveAt = Math.min(earliestReceiveAt, Number(raw.receiveAt));
    latestReceiveAt = Math.max(latestReceiveAt, Number(raw.receiveAt));
  }

  const volumeDifference = availableCount ? rawQuantity - aggregateQuantity : null;
  const volumeDifferencePercent = availableCount && aggregateQuantity !== 0
    ? Math.abs(volumeDifference) / Math.abs(aggregateQuantity) * 100
    : null;

  return {
    expectedCount,
    availableCount,
    coverage: expectedCount > 0 ? availableCount / expectedCount : 0,
    rawQuantity,
    volumeDifference,
    volumeDifferencePercent,
    rawFirstLeadMs: availableCount ? aggregateReceiveAt - earliestReceiveAt : null,
    rawCompleteLeadMs: availableCount ? aggregateReceiveAt - latestReceiveAt : null,
    tooLarge: false,
  };
}

export function buildVerdict({ matched, rawEarlierRatio, medianLeadMs, medianCoverage, medianVolumeDifferencePercent, rawGapCount }) {
  if (!Number.isFinite(matched) || matched < 30) {
    return { tone: "neutral", title: "Недостаточно данных", text: "Нужно минимум 30 сопоставленных групп." };
  }
  if ((medianCoverage ?? 0) < .98 || (medianVolumeDifferencePercent ?? Infinity) > .1 || (rawGapCount ?? 0) > 0) {
    return { tone: "warning", title: "Качество raw-потока не подтверждено", text: "Есть пропуски, неполное покрытие или расхождение объёма." };
  }
  if ((rawEarlierRatio ?? 0) >= .6 && (medianLeadMs ?? 0) > 2) {
    return { tone: "positive", title: "@trade — кандидат на преимущество", text: "Raw-поток чаще приходит раньше и проходит проверку качества." };
  }
  if ((rawEarlierRatio ?? 0) <= .4 && (medianLeadMs ?? 0) < -2) {
    return { tone: "negative", title: "@aggTrade быстрее", text: "Агрегированный поток чаще приходит раньше на этой сессии." };
  }
  return { tone: "neutral", title: "Практический паритет", text: "Разница мала или нестабильна; переключать рабочую ленту рано." };
}
