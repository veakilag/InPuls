import { percentile, summarize } from "./trade-latency-core.js?v=2.1";

export const RAW_STABILITY_SCHEMA_VERSION = 2;
export const RAW_STABILITY_MIN_VISIBLE_MS = 15 * 60 * 1_000;

const DIAGNOSTIC_FIELDS = ["e", "E", "T", "s", "ps", "st", "t", "a", "f", "l", "p", "q", "nq", "m"];

export function diagnoseTradePayload(event, source, receiveAt, expectedSymbol = null) {
  const raw = source === "trade";
  const object = event && typeof event === "object" && !Array.isArray(event) ? event : {};
  const symbol = String(object.s ?? "").toUpperCase();
  const price = Number(object.p);
  const quantity = Number(object.q);
  const eventTime = Number(object.E ?? object.T);
  const tradeTime = Number(object.T ?? object.E);
  const received = Number(receiveAt);
  const id = raw ? Number(object.t) : Number(object.a);
  const firstTradeId = raw ? id : Number(object.f);
  const lastTradeId = raw ? id : Number(object.l);
  const expected = expectedSymbol ? String(expectedSymbol).toUpperCase() : null;

  let reason = null;
  if (event !== object) reason = "payload-not-object";
  else if (!symbol) reason = "missing-symbol";
  else if (expected && symbol !== expected) reason = "symbol-mismatch";
  else if (!Number.isFinite(price)) reason = "invalid-price";
  else if (!Number.isFinite(quantity)) reason = "invalid-quantity";
  else if (price <= 0) reason = "non-positive-price";
  else if (quantity <= 0) reason = "non-positive-quantity";
  else if (!Number.isFinite(eventTime) || eventTime <= 0) reason = "invalid-event-time";
  else if (!Number.isFinite(tradeTime) || tradeTime <= 0) reason = "invalid-trade-time";
  else if (!Number.isFinite(received)) reason = "invalid-receive-time";
  else if (!Number.isInteger(id) || id < 0) reason = "invalid-event-id";
  else if (!Number.isInteger(firstTradeId) || firstTradeId < 0) reason = "invalid-first-trade-id";
  else if (!Number.isInteger(lastTradeId) || lastTradeId < firstTradeId) reason = "invalid-last-trade-id";

  const sequenceSample = Number.isInteger(id)
    && id >= 0
    && Number.isInteger(firstTradeId)
    && Number.isInteger(lastTradeId)
    && firstTradeId >= 0
    && lastTradeId >= firstTradeId
    ? { id, firstTradeId, lastTradeId }
    : null;

  return {
    valid: reason === null,
    reason,
    symbol: symbol || "UNKNOWN",
    sequenceSample,
  };
}

export function sanitizeTradePayload(event) {
  const object = event && typeof event === "object" && !Array.isArray(event) ? event : {};
  const fields = {};
  for (const key of DIAGNOSTIC_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
    const value = object[key];
    fields[key] = value === null || ["string", "number", "boolean"].includes(typeof value)
      ? value
      : `[${Array.isArray(value) ? "array" : typeof value}]`;
  }
  return {
    keys: Object.keys(object).sort(),
    fields,
  };
}

export function advanceSourceStallCandidate(candidate, receiveAt, thresholdMs = 3_000, continuityMs = 2_000) {
  const at = Number(receiveAt);
  if (!Number.isFinite(at)) return { candidate: candidate ?? null, confirmedNow: false };
  const continuity = Math.max(0, Number(continuityMs) || 0);
  if (!candidate || at - Number(candidate.lastEvidenceAt) > continuity) {
    return {
      candidate: {
        startedAt: at,
        lastEvidenceAt: at,
        confirmed: false,
        reason: "source-only",
      },
      confirmedNow: false,
    };
  }

  const next = {
    ...candidate,
    lastEvidenceAt: at,
  };
  const threshold = Math.max(0, Number(thresholdMs) || 0);
  const confirmedNow = !next.confirmed && at - Number(next.startedAt) >= threshold;
  if (confirmedNow) next.confirmed = true;
  return { candidate: next, confirmedNow };
}

export function normalizeSymbols(value, limit = 4) {
  const maximum = Math.max(1, Math.floor(Number(limit) || 4));
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[\s,;|/]+/);
  const symbols = [];
  const seen = new Set();
  for (const item of values) {
    const symbol = String(item ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{5,20}$/.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
    if (symbols.length >= maximum) break;
  }
  return symbols;
}

export function sequenceDelta(source, previousLast, sample) {
  const raw = source === "trade";
  const first = raw ? Number(sample?.id) : Number(sample?.firstTradeId);
  const last = raw ? Number(sample?.id) : Number(sample?.lastTradeId);
  const previous = previousLast === null || previousLast === undefined ? NaN : Number(previousLast);
  if (![first, last].every(Number.isFinite) || !Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first) {
    return { valid: false, nextLast: Number.isFinite(previous) ? previous : null, gapCount: 0, outOfOrder: false, overlap: false };
  }
  if (!Number.isFinite(previous)) {
    return { valid: true, nextLast: last, gapCount: 0, outOfOrder: false, overlap: false };
  }
  return {
    valid: true,
    nextLast: Math.max(previous, last),
    gapCount: first > previous + 1 ? first - previous - 1 : 0,
    outOfOrder: last < previous,
    overlap: first <= previous,
  };
}

export function reconnectDelay(attempt, random = Math.random()) {
  const exponent = Math.min(5, Math.max(0, Math.floor(Number(attempt) || 0)));
  const jitter = Math.max(0, Math.min(1, Number(random) || 0)) * 250;
  return Math.min(10_000, 500 * (2 ** exponent) + jitter);
}

export function reservoirPush(state, value, random = Math.random()) {
  if (!state || !Array.isArray(state.values)) return false;
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  state.seen = Math.max(0, Math.floor(Number(state.seen) || 0)) + 1;
  const limit = Math.max(1, Math.floor(Number(state.limit) || 1));
  if (state.values.length < limit) {
    state.values.push(number);
    return true;
  }
  const index = Math.floor(Math.max(0, Math.min(.999999999, Number(random) || 0)) * state.seen);
  if (index >= limit) return false;
  state.values[index] = number;
  return true;
}

export function summarizeReservoir(state) {
  return {
    ...summarize(state?.values ?? []),
    seen: Math.max(0, Math.floor(Number(state?.seen) || 0)),
    sampled: Array.isArray(state?.values) ? state.values.length : 0,
  };
}

export function buildStabilityAssessment({
  phase,
  completed,
  visibleMs,
  minimumVisibleMs = RAW_STABILITY_MIN_VISIBLE_MS,
  connections = {},
  symbols = [],
} = {}) {
  if (!["finished", "stopped"].includes(String(phase)) || !completed) {
    return {
      tone: "neutral",
      title: "Прогон не завершён",
      text: "Результат нельзя использовать для решения по production-источнику.",
      blockers: ["измерение не завершено"],
    };
  }

  const blockers = [];
  if (Number(visibleMs) < Number(minimumVisibleMs)) {
    blockers.push(`видимое время меньше ${Math.ceil(Number(minimumVisibleMs) / 60_000)} минут`);
  }
  if (!symbols.length) blockers.push("нет символов");
  for (const source of ["trade", "aggTrade"]) {
    const label = source === "trade" ? "RAW" : "AGG";
    const connection = connections?.[source] ?? {};
    if ((Number(connection.invalidEvents) || 0) > 0) blockers.push(`${label}: отклонённый payload`);
    if ((Number(connection.unplannedReconnects) || 0) > 0) blockers.push(`${label}: аварийный reconnect`);
    if ((Number(connection.openFailures) || 0) > 0) blockers.push(`${label}: endpoint/open failure`);
    if (connection.recoveryPending) blockers.push(`${label}: recovery не завершён`);
    if (Number(connection?.recovery?.p95) > 10_000) blockers.push(`${label}: recovery P95 больше 10 секунд`);
  }

  for (const item of symbols) {
    const symbol = String(item?.symbol ?? "UNKNOWN");
    const raw = item?.streams?.trade ?? {};
    const aggregate = item?.streams?.aggTrade ?? {};
    const matches = item?.matching ?? {};
    if ((Number(raw.messages) || 0) <= 0) blockers.push(`${symbol}: нет @trade`);
    if ((Number(aggregate.messages) || 0) <= 0) blockers.push(`${symbol}: нет @aggTrade`);
    if ((Number(raw.invalidEvents) || 0) > 0) blockers.push(`${symbol}: отклонённые RAW-события`);
    if ((Number(raw.gaps) || 0) > 0) blockers.push(`${symbol}: RAW gap внутри сегмента`);
    if ((Number(raw.duplicates) || 0) > 0) blockers.push(`${symbol}: RAW duplicates`);
    if ((Number(raw.outOfOrder) || 0) > 0) blockers.push(`${symbol}: RAW out-of-order`);
    if ((Number(raw.unplannedStalls) || 0) > 0) blockers.push(`${symbol}: RAW source-only stall`);
    if ((Number(matches.total) || 0) <= 0) blockers.push(`${symbol}: нет сопоставленных групп`);
    if ((Number(matches.fullCoverageRatio) || 0) < .9999) blockers.push(`${symbol}: покрытие RAW ниже 99,99%`);
    if (Number(matches.volumeDifferenceP99) > .1) blockers.push(`${symbol}: P99 расхождения объёма выше 0,1%`);
  }

  if (blockers.length) {
    return {
      tone: "negative",
      title: "RAW stability не подтверждена",
      text: blockers.join("; "),
      blockers,
    };
  }

  return {
    tone: "positive",
    title: "RAW-прогон чистый",
    text: "Этот файл подтверждает только один прогон. Переключение production допустимо после чистой матрицы 1 / 2 / 4 символа и проверки background/reconnect.",
    blockers: [],
  };
}

export function summarizeMatching(state) {
  const total = Math.max(0, Number(state?.total) || 0);
  const complete = Math.max(0, Number(state?.complete) || 0);
  const firstLead = summarizeReservoir(state?.firstLead);
  const completeLead = summarizeReservoir(state?.completeLead);
  const coverage = summarizeReservoir(state?.coverage);
  const volumeDifference = summarizeReservoir(state?.volumeDifference);
  return {
    total,
    complete,
    abandoned: Math.max(0, Number(state?.abandoned) || 0),
    fullCoverageRatio: total > 0 ? complete / total : 0,
    rawEarlierRatio: firstLead.seen > 0 ? (Number(state?.rawEarlier) || 0) / firstLead.seen : null,
    firstLead,
    completeLead,
    coverage,
    volumeDifference,
    volumeDifferenceP99: percentile(state?.volumeDifference?.values ?? [], .99),
  };
}
