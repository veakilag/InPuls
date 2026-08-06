import { CandlestickChart } from "./chart.js?v=signal-lab-v9-extreme-rays";

const KLINES_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";

export const EPISODE_CHART_INTERVALS = Object.freeze({
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
});

export const EPISODE_CONTEXT_RANGES = Object.freeze({
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
});

const controllers = new Map();
const candleCache = new Map();
let activeEpisodeId = null;
let automaticFirstOpenUsed = false;

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function validSymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,20}USDT$/.test(symbol) ? symbol : null;
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function parseKline(row) {
  if (!Array.isArray(row) || row.length < 7) return null;
  const candle = {
    time: finite(row[0]),
    open: finite(row[1]),
    high: finite(row[2]),
    low: finite(row[3]),
    close: finite(row[4]),
    volume: finite(row[5]) ?? 0,
    closeTime: finite(row[6]),
    closed: true,
  };
  return [candle.time, candle.open, candle.high, candle.low, candle.close]
    .every((value) => value !== null && value > 0)
    ? candle
    : null;
}

export function aggregateEpisodePricePoints(points, intervalMs) {
  const buckets = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    const at = finite(point?.at ?? point?.time);
    const price = finite(point?.price ?? point?.close);
    if (at === null || price === null || price <= 0) continue;
    const time = Math.floor(at / intervalMs) * intervalMs;
    const current = buckets.get(time);
    if (!current) {
      buckets.set(time, {
        time,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        closeTime: time + intervalMs - 1,
        closed: true,
      });
    } else {
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
    }
  }
  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

function aggregateMinuteCandles(rows, intervalMs) {
  const buckets = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const source = {
      time: finite(row?.time),
      open: finite(row?.open),
      high: finite(row?.high),
      low: finite(row?.low),
      close: finite(row?.close),
      volume: finite(row?.volume) ?? 0,
    };
    if (![source.time, source.open, source.high, source.low, source.close]
      .every((value) => value !== null && value > 0)) continue;
    const time = Math.floor(source.time / intervalMs) * intervalMs;
    const current = buckets.get(time);
    if (!current) {
      buckets.set(time, {
        ...source,
        time,
        closeTime: time + intervalMs - 1,
        closed: true,
      });
    } else {
      current.high = Math.max(current.high, source.high);
      current.low = Math.min(current.low, source.low);
      current.close = source.close;
      current.volume += source.volume;
    }
  }
  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

function nearestOriginAt(pack, extremeAt, originPrice) {
  const rows = (Array.isArray(pack?.pricePoints) ? pack.pricePoints : [])
    .filter((point) => finite(point?.at) !== null && finite(point?.price) !== null)
    .filter((point) => Number(point.at) <= extremeAt);
  if (!rows.length || !(originPrice > 0)) return finite(pack?.window?.startAt) ?? extremeAt;
  return rows.reduce((best, row) => (
    Math.abs(Number(row.price) - originPrice) < Math.abs(Number(best.price) - originPrice)
      ? row
      : best
  ), rows[0]).at;
}

function addLevelAnnotations(target, levelEvidence, eventAt, prefix = "Уровень") {
  const level = finite(levelEvidence?.level);
  if (level === null || level <= 0) return;
  const touches = (Array.isArray(levelEvidence?.touchTimes) ? levelEvidence.touchTimes : [])
    .map(finite)
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
  const tolerancePercent = Math.max(0.02, finite(levelEvidence?.tolerancePercent) ?? 0.1);
  const lower = level * (1 - tolerancePercent / 100);
  const upper = level * (1 + tolerancePercent / 100);
  const startAt = touches[0] ?? eventAt - 20 * 60_000;
  target.push({
    type: "zone",
    startAt,
    endAt: eventAt + 60_000,
    low: lower,
    high: upper,
    label: `${prefix} · ${levelEvidence?.touchCount ?? touches.length} касания`,
    tone: "blue",
  });
  touches.slice(-8).forEach((time, index) => target.push({
    type: "point",
    time,
    price: level,
    label: `T${Math.max(1, (levelEvidence?.touchCount ?? touches.length) - touches.slice(-8).length + index + 1)}`,
    tone: "blue",
  }));
}

function addCascadeAnnotations(target, cascade, eventAt, prefix = "") {
  const extrema = (Array.isArray(cascade?.extrema) ? cascade.extrema : [])
    .map((row) => ({ time: finite(row?.at ?? row?.time), price: finite(row?.price) }))
    .filter((row) => row.time !== null && row.price !== null && row.price > 0);
  if (!extrema.length) return;
  const highSide = cascade?.side === "high";
  const marker = highSide ? "H" : "L";
  const low = finite(cascade?.zoneLower) ?? Math.min(...extrema.map((row) => row.price));
  const high = finite(cascade?.zoneUpper) ?? Math.max(...extrema.map((row) => row.price));
  target.push({
    type: "zone",
    startAt: extrema[0].time,
    endAt: eventAt + 60_000,
    low,
    high,
    label: `${prefix}${prefix ? " · " : ""}зона каскада ${extrema.length} экстремума`,
    tone: "warning",
  });
  extrema.forEach((row, index) => {
    target.push({
      type: "ray",
      startAt: row.time,
      price: row.price,
      label: `${marker}${index + 1}`,
      tone: highSide ? "danger" : "success",
      state: "ACTIVE",
    });
    if (index > 0) {
      target.push({
        type: "segment",
        a: extrema[index - 1],
        b: row,
        label: index === extrema.length - 1 ? "ступени каскада" : "",
        tone: "warning",
      });
    }
  });
  const nearest = finite(cascade?.nearestStepPrice);
  if (nearest !== null) {
    target.push({
      type: "line",
      price: nearest,
      startAt: extrema[0].time,
      endAt: eventAt + 60_000,
      label: "ближайшая ступень",
      tone: "warning",
    });
  }
}

function addExtremeMapAnnotations(target, extremeMap, eventAt, eventPrice) {
  const rows = [];
  for (const [timeframe, map] of Object.entries(extremeMap?.timeframes ?? {})) {
    for (const extreme of map?.active ?? []) {
      const price = finite(extreme?.price);
      const extremeTime = finite(extreme?.extremeTime ?? extreme?.time ?? extreme?.at);
      if (!(price > 0) || extremeTime === null) continue;
      const distance = eventPrice > 0 ? Math.abs(price - eventPrice) / eventPrice * 100 : 0;
      if (distance > 8) continue;
      rows.push({ ...extreme, timeframe, price, extremeTime, distance });
    }
  }
  rows.sort((left, right) => left.distance - right.distance || right.confirmedAt - left.confirmedAt);

  // The same physical swing can be present on several timeframes. Keep one ray at
  // the actual extremum point and combine its TF labels instead of painting duplicate
  // lines on top of each other.
  const groups = [];
  for (const row of rows.slice(0, 64)) {
    const side = row.side === "HIGH" ? "HIGH" : "LOW";
    const match = groups.find((group) => {
      if (group.side !== side) return false;
      const priceDistance = Math.abs(group.price - row.price) / Math.max(group.price, row.price) * 100;
      const timeDistance = Math.abs(group.extremeTime - row.extremeTime);
      return priceDistance <= 0.015 && timeDistance <= 2 * 60_000;
    });
    if (match) {
      match.timeframes.add(row.timeframe);
      match.touchCount = Math.max(match.touchCount, Number(row.touchCount) || 1);
      match.confirmedAt = Math.min(match.confirmedAt, finite(row.confirmedAt) ?? match.confirmedAt);
      if (side === "HIGH" && row.price > match.price) {
        match.price = row.price;
        match.extremeTime = row.extremeTime;
      }
      if (side === "LOW" && row.price < match.price) {
        match.price = row.price;
        match.extremeTime = row.extremeTime;
      }
      continue;
    }
    groups.push({
      side,
      price: row.price,
      extremeTime: row.extremeTime,
      confirmedAt: finite(row.confirmedAt) ?? eventAt,
      touchCount: Math.max(1, Number(row.touchCount) || 1),
      timeframes: new Set([row.timeframe]),
      distance: row.distance,
    });
  }

  for (const extreme of groups.slice(0, 32)) {
    const high = extreme.side === "HIGH";
    const timeframes = [...extreme.timeframes]
      .sort((left, right) => (EPISODE_CHART_INTERVALS[left] ?? Infinity) - (EPISODE_CHART_INTERVALS[right] ?? Infinity));
    const label = `${high ? "H" : "L"} ${timeframes.join("/")} ×${extreme.touchCount}`;
    target.push({
      type: "ray",
      startAt: extreme.extremeTime,
      price: extreme.price,
      label,
      tone: high ? "danger" : "success",
      state: "ACTIVE",
      side: extreme.side,
      timeframes,
    });
  }
}

function addLevelMapAnnotations(target, levelMap, eventAt, eventPrice) {
  const zones = (Array.isArray(levelMap?.activeZones) ? levelMap.activeZones : [])
    .map((zone) => {
      const lower = finite(zone?.lowerPrice);
      const upper = finite(zone?.upperPrice);
      const boundary = zone?.side === "HIGH" ? upper : lower;
      const distance = eventPrice > 0 && boundary > 0 ? Math.abs(boundary - eventPrice) / eventPrice * 100 : 0;
      return { ...zone, lower, upper, boundary, distance };
    })
    .filter((zone) => zone.lower > 0 && zone.upper > 0 && zone.distance <= 8)
    .sort((left, right) => left.distance - right.distance);
  for (const zone of zones.slice(0, 8)) {
    const high = zone.side === "HIGH";
    const timeframes = (Array.isArray(zone.timeframes) ? zone.timeframes : []).join("/");
    const compression = zone?.setupFeatures?.compressionType;
    const label = `${high ? "H" : "L"} зона ×${zone.touchCount ?? 1}${timeframes ? ` · ${timeframes}` : ""}`;
    target.push({
      type: "zone",
      startAt: finite(zone.firstFormedAt) ?? eventAt - 60_000,
      endAt: eventAt + 60_000,
      low: zone.lower,
      high: zone.upper,
      label: compression && compression !== "NO_COMPRESSION" ? `${label} · ${compression}` : label,
      tone: high ? "danger" : "success",
    });
  }
  for (const event of Array.isArray(levelMap?.eventHistory) ? levelMap.eventHistory.slice(-8) : []) {
    const triggeredAt = finite(event?.triggeredAt);
    if (triggeredAt === null) continue;
    target.push({
      type: "event",
      time: triggeredAt,
      label: `ПРОХОД ${event.direction === "UP" ? "ВВЕРХ" : "ВНИЗ"}`,
      tone: "warning",
    });
    if (finite(event?.acceptedAt) !== null) {
      target.push({ type: "event", time: event.acceptedAt, label: "ПРИНЯТИЕ", tone: "success" });
    }
    if (finite(event?.reclaimedAt) !== null) {
      target.push({ type: "event", time: event.reclaimedAt, label: "ПРОКОЛ И ВОЗВРАТ", tone: "danger" });
    }
    if (finite(event?.retestedAt) !== null) {
      target.push({ type: "event", time: event.retestedAt, label: "РЕТЕСТ", tone: "blue" });
    }
  }
}

function addCascadeMapAnnotations(target, cascadeMap, eventAt, eventPrice) {
  const events = Array.isArray(cascadeMap?.history) ? cascadeMap.history : [];
  const ranked = events
    .filter((event) => Array.isArray(event?.levelPrices) && event.levelPrices.length >= 2)
    .map((event) => ({
      ...event,
      distance: eventPrice > 0
        ? Math.abs((finite(event.levelPrices[0]) ?? eventPrice) - eventPrice) / eventPrice * 100
        : 0,
    }))
    .filter((event) => event.distance <= 8)
    .sort((left, right) => right.setupDetectedAt - left.setupDetectedAt || left.distance - right.distance)
    .slice(0, 1);
  for (const event of ranked) {
    const endAt = finite(event.completedAt) ?? finite(event.failedAt) ?? eventAt + 60_000;
    event.levelPrices.forEach((price, index) => {
      const value = finite(price);
      if (!(value > 0)) return;
      const gap = index > 0 ? finite(event.adjacentGapPct?.[index - 1]) : null;
      const touches = event.touchCounts?.[index] ?? 1;
      target.push({
        type: "line",
        price: value,
        startAt: event.setupDetectedAt,
        endAt,
        label: `К${index + 1} ×${touches}${gap === null ? "" : ` · gap ${gap.toFixed(2)}%`}`,
        tone: index < event.levelsBroken ? "success" : "warning",
      });
    });
    target.push({ type: "event", time: event.setupDetectedAt, label: `КАСКАД SETUP · ${event.levelIds.length} уровня`, tone: "blue" });
    if (finite(event.triggeredAt) !== null) target.push({ type: "event", time: event.triggeredAt, label: "КАСКАД TRIGGERED · снят К1", tone: "warning" });
    if (finite(event.confirmedAt) !== null) target.push({ type: "event", time: event.confirmedAt, label: "КАСКАД CONFIRMED · снят К2", tone: "success" });
    if (event.state === "EXTENDED") target.push({ type: "event", time: event.brokenAt?.[2] ?? event.completedAt, label: `КАСКАД EXTENDED · ${event.levelsBroken} уровня`, tone: "success" });
    if (event.state === "PARTIAL") target.push({ type: "event", time: event.failedAt, label: "КАСКАД PARTIAL", tone: "warning" });
    if (event.state === "FAILED") target.push({ type: "event", time: event.failedAt, label: `КАСКАД FAILED · ${event.failureReasons?.[0] ?? "отмена"}`, tone: "danger" });
  }
}

export function buildPatternAnnotations(episode) {
  const latest = episode?.latest ?? {};
  const evidence = latest?.evidence ?? {};
  const pack = episode?.evidencePack ?? null;
  const eventAt = finite(pack?.window?.eventAt) ?? finite(episode?.firstSeenAt) ?? Date.now();
  const eventPrice = finite(latest?.price) ?? finite(pack?.pricePoints?.find?.((row) => row.at >= eventAt)?.price);
  const annotations = [{
    type: "event",
    time: eventAt,
    label: "КАНДИДАТ",
    tone: "accent",
  }];

  if (String(episode?.candidateType ?? "").startsWith("level_break_attempt")) {
    addLevelAnnotations(annotations, evidence, eventAt, "Уровень пробоя");
  }

  if (String(episode?.candidateType ?? "").startsWith("cascade_structure")) {
    addCascadeAnnotations(annotations, evidence, eventAt);
  }

  const canonicalLevelMap = pack?.levelMapLatest ?? pack?.levelMap;
  // Every active extremum remains visible as a ray from its actual swing point until
  // the detector invalidates it. Canonical zones stay as context, not as a substitute
  // for the underlying extrema.
  addExtremeMapAnnotations(annotations, pack?.extremeMap, eventAt, eventPrice);
  addLevelMapAnnotations(annotations, canonicalLevelMap, eventAt, eventPrice);
  addCascadeMapAnnotations(annotations, pack?.cascadeMapLatest ?? pack?.cascadeMap, eventAt, eventPrice);

  if (episode?.candidateType === "down_reversal_attempt" || episode?.candidateType === "up_reversal_attempt") {
    const extremeAt = finite(evidence?.extremeAt);
    const extremePrice = finite(evidence?.extremePrice);
    const originPrice = finite(evidence?.originPrice);
    if (extremeAt !== null && extremePrice !== null) {
      const downImpulse = evidence?.impulseSide === "down";
      annotations.push({
        type: "ray",
        startAt: extremeAt,
        price: extremePrice,
        label: downImpulse ? "LOW" : "HIGH",
        tone: downImpulse ? "success" : "danger",
        state: "ACTIVE",
      });
      if (originPrice !== null) {
        const originAt = nearestOriginAt(pack, extremeAt, originPrice);
        annotations.push({
          type: "segment",
          a: { time: originAt, price: originPrice },
          b: { time: extremeAt, price: extremePrice },
          label: downImpulse ? "импульс вниз" : "импульс вверх",
          tone: "danger",
        });
      }
      if (eventPrice !== null) {
        annotations.push({
          type: "segment",
          a: { time: extremeAt, price: extremePrice },
          b: { time: eventAt, price: eventPrice },
          label: downImpulse ? "резкий выкуп" : "резкий слив",
          tone: downImpulse ? "success" : "danger",
        });
      }
    }
    addLevelAnnotations(annotations, evidence?.originLevel, eventAt, "Исходный уровень");
    addCascadeAnnotations(annotations, evidence?.originCascade, eventAt, "Исходный каскад");
  }

  return annotations.filter((annotation) => annotation && annotation.type);
}

export function patternAnnotationSummary(annotations) {
  const rows = [];
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    if (!annotation?.label || annotation.type === "event") continue;
    if (!rows.includes(annotation.label)) rows.push(annotation.label);
  }
  return rows.slice(0, 12);
}

export function episodeHistoryBounds(eventAt, intervalMs, contextMs) {
  const event = finite(eventAt);
  const interval = finite(intervalMs);
  const context = finite(contextMs);
  if (event === null || interval === null || context === null) {
    throw new TypeError("Некорректные границы свечного контекста");
  }
  if (context >= EPISODE_CONTEXT_RANGES["30d"]) {
    return {
      startTime: Math.max(0, event - EPISODE_CONTEXT_RANGES["30d"]),
      endTime: Math.min(Date.now(), event + interval),
      coverageEndTime: event,
      mode: "THIRTY_DAYS_BEFORE_EVENT",
    };
  }
  return {
    startTime: Math.max(0, event - context),
    endTime: Math.min(Date.now(), event + context),
    coverageEndTime: Math.min(Date.now(), event + context),
    mode: "SYMMETRIC_CONTEXT",
  };
}

export function buildCandleCoverage(candles, {
  startTime,
  endTime,
  coverageEndTime = endTime,
  intervalMs,
  source = "BINANCE_FUTURES_KLINES",
  pages = 0,
} = {}) {
  const rows = Array.isArray(candles) ? candles : [];
  const requestedFrom = finite(startTime);
  const requestedTo = finite(coverageEndTime);
  const interval = finite(intervalMs);
  const actualFrom = finite(rows[0]?.time);
  const actualTo = finite(rows.at(-1)?.time);
  if (requestedFrom === null || requestedTo === null || interval === null || interval <= 0) {
    return Object.freeze({ source, complete: false, ratio: 0, reason: "INVALID_BOUNDS", pages, candles: rows.length });
  }
  const expectedFirstOpen = Math.ceil(requestedFrom / interval) * interval;
  const expectedLastOpen = Math.floor(requestedTo / interval) * interval;
  const requestedSpan = Math.max(interval, expectedLastOpen - expectedFirstOpen + interval);
  const coveredFrom = actualFrom === null ? requestedTo : Math.max(expectedFirstOpen, actualFrom);
  const coveredTo = actualTo === null ? requestedFrom : Math.min(expectedLastOpen, actualTo);
  const coveredSpan = Math.max(0, coveredTo - coveredFrom + interval);
  const ratio = Math.max(0, Math.min(1, coveredSpan / requestedSpan));
  const complete = actualFrom !== null
    && actualTo !== null
    && actualFrom <= expectedFirstOpen + interval
    && actualTo >= expectedLastOpen - interval;
  return Object.freeze({
    source,
    requestedFrom,
    requestedTo,
    requestedEndTime: finite(endTime),
    actualFrom,
    actualTo,
    expectedFirstOpen,
    expectedLastOpen,
    intervalMs: interval,
    requestedDays: (requestedTo - requestedFrom) / 86_400_000,
    actualDays: actualFrom === null || actualTo === null ? 0 : Math.max(0, (actualTo - actualFrom + interval) / 86_400_000),
    ratio,
    complete,
    reason: complete ? null : rows.length ? "PARTIAL_BINANCE_COVERAGE" : "NO_CANDLES",
    pages,
    candles: rows.length,
  });
}

async function fetchRestCandles(symbol, interval, eventAt, contextMs, signal) {
  const intervalMs = EPISODE_CHART_INTERVALS[interval];
  const bounds = episodeHistoryBounds(eventAt, intervalMs, contextMs);
  const { startTime, endTime } = bounds;
  const key = `${symbol}:${interval}:${startTime}:${endTime}:${bounds.coverageEndTime}`;
  if (candleCache.has(key)) return clone(candleCache.get(key));
  const candles = [];
  let cursor = startTime;
  let requests = 0;
  const expectedCandles = Math.ceil((endTime - startTime) / intervalMs) + 2;
  const maximumRequests = Math.min(64, Math.max(2, Math.ceil(expectedCandles / 1_500) + 2));
  while (cursor <= endTime && candles.length < 50_500 && requests < maximumRequests) {
    const query = new URLSearchParams({
      symbol,
      interval,
      startTime: String(Math.floor(cursor)),
      endTime: String(Math.floor(endTime)),
      limit: "1500",
    });
    const response = await fetch(`${KLINES_ENDPOINT}?${query}`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Binance klines HTTP ${response.status}`);
    const payload = await response.json();
    const page = (Array.isArray(payload) ? payload : []).map(parseKline).filter(Boolean);
    requests += 1;
    if (!page.length) break;
    for (const row of page) {
      if (row.time < startTime || row.time > endTime) continue;
      if (!candles.length || row.time > candles.at(-1).time) candles.push(row);
    }
    const next = page.at(-1).time + intervalMs;
    if (!(next > cursor)) break;
    cursor = next;
    if (page.length < 1_500 && cursor > bounds.coverageEndTime) break;
  }
  if (!candles.length) throw new Error("Binance не вернул свечи за выбранный период");
  const result = Object.freeze({
    candles: Object.freeze(candles),
    coverage: buildCandleCoverage(candles, {
      ...bounds,
      intervalMs,
      pages: requests,
    }),
  });
  candleCache.set(key, result);
  while (candleCache.size > 8) candleCache.delete(candleCache.keys().next().value);
  return clone(result);
}

export async function loadEpisodeCandles(episode, interval = "1h", contextRange = "30d", { signal } = {}) {
  const symbol = validSymbol(episode?.symbol);
  const eventAt = finite(episode?.evidencePack?.window?.eventAt) ?? finite(episode?.firstSeenAt);
  const intervalMs = EPISODE_CHART_INTERVALS[interval];
  const contextMs = EPISODE_CONTEXT_RANGES[contextRange];
  if (!symbol || eventAt === null || !intervalMs || !contextMs) throw new Error("Некорректные параметры графика эпизода");
  const bounds = episodeHistoryBounds(eventAt, intervalMs, contextMs);
  if (interval.endsWith("s")) {
    const candles = aggregateEpisodePricePoints(episode?.evidencePack?.pricePoints, intervalMs);
    if (!candles.length) throw new Error("Секундная история отсутствует: она доступна только из Evidence Pack");
    return {
      candles,
      coverage: buildCandleCoverage(candles, {
        ...bounds,
        intervalMs,
        source: "EVIDENCE_PACK",
        pages: 0,
      }),
    };
  }
  try {
    return await fetchRestCandles(symbol, interval, eventAt, contextMs, signal);
  } catch (error) {
    const fallback = aggregateMinuteCandles(episode?.evidencePack?.minuteCandles, intervalMs);
    if (fallback.length) {
      return {
        candles: fallback,
        coverage: buildCandleCoverage(fallback, {
          ...bounds,
          intervalMs,
          source: "EVIDENCE_PACK_FALLBACK",
          pages: 0,
        }),
      };
    }
    throw error;
  }
}

function fillAnnotationList(target, rows) {
  if (!target) return;
  const values = rows.length ? rows : ["Авторазметка для этого эпизода ещё не сформирована."];
  target.replaceChildren(...values.map((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
}

class EpisodeFullChartController {
  constructor(card, episode) {
    this.card = card;
    this.episode = episode;
    this.id = episode.id;
    this.toggle = card.querySelector('[data-field="chart-toggle"]');
    this.shell = card.querySelector('[data-field="full-chart-shell"]');
    this.canvas = card.querySelector('[data-field="full-chart"]');
    this.tooltip = card.querySelector('[data-field="full-chart-tooltip"]');
    this.status = card.querySelector('[data-field="full-chart-status"]');
    this.annotationList = card.querySelector('[data-field="chart-annotation-list"]');
    this.annotationToggle = card.querySelector('[data-field="chart-annotations-toggle"]');
    this.volumeToggle = card.querySelector('[data-field="chart-volume-toggle"]');
    this.sessionsToggle = card.querySelector('[data-field="chart-sessions-toggle"]');
    this.timeframeButtons = [...card.querySelectorAll("[data-chart-timeframe]")];
    this.rangeButtons = [...card.querySelectorAll("[data-chart-range]")];
    this.toolButtons = [...card.querySelectorAll("[data-chart-tool]")];
    this.interval = "1h";
    this.contextRange = "30d";
    this.timeframeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.chartTimeframe === this.interval));
    this.rangeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.chartRange === this.contextRange));
    this.chart = null;
    this.abortController = null;
    this.generation = 0;
    this.annotations = buildPatternAnnotations(episode);
    this.opened = false;
    this.#bind();
  }

  #bind() {
    this.toggle?.addEventListener("click", () => this.opened ? this.close() : this.open());
    this.timeframeButtons.forEach((button) => button.addEventListener("click", () => {
      this.interval = button.dataset.chartTimeframe;
      this.timeframeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      this.#load();
    }));
    this.rangeButtons.forEach((button) => button.addEventListener("click", () => {
      this.contextRange = button.dataset.chartRange;
      this.rangeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      this.#load();
    }));
    this.toolButtons.forEach((button) => button.addEventListener("click", () => {
      this.chart?.setTool(button.dataset.chartTool);
    }));
    this.card.querySelector('[data-chart-action="undo"]')?.addEventListener("click", () => this.chart?.undoDrawing());
    this.card.querySelector('[data-chart-action="clear"]')?.addEventListener("click", () => this.chart?.clearDrawings());
    this.card.querySelector('[data-chart-action="reset"]')?.addEventListener("click", () => {
      this.#focusEvent();
    });
    this.card.querySelector('[data-chart-action="fit"]')?.addEventListener("click", () => {
      this.#fitRange();
    });
    this.annotationToggle?.addEventListener("change", () => {
      this.chart?.setAnnotations(this.annotationToggle.checked ? this.annotations : []);
    });
    this.volumeToggle?.addEventListener("change", () => this.chart?.setVolumeVisible(this.volumeToggle.checked));
    this.sessionsToggle?.addEventListener("change", () => this.chart?.setSessionsVisible(this.sessionsToggle.checked));
    const link = this.card.querySelector('[data-field="open-inpuls-chart"]');
    if (link) link.href = `./?symbol=${encodeURIComponent(this.episode.symbol)}`;
  }

  async open() {
    if (this.opened) return;
    const previous = controllers.get(activeEpisodeId);
    if (previous && previous !== this) previous.close({ preserveActive: true });
    activeEpisodeId = this.id;
    this.opened = true;
    this.shell.hidden = false;
    this.toggle.textContent = "Свернуть график";
    if (!this.chart) {
      this.chart = new CandlestickChart(this.canvas, this.tooltip, { storageKey: null });
      this.chart.setVolumeVisible(this.volumeToggle?.checked !== false);
      this.chart.setSessionsVisible(this.sessionsToggle?.checked !== false);
      this.chart.onToolChange = (tool) => {
        this.toolButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.chartTool === tool));
      };
    }
    fillAnnotationList(this.annotationList, patternAnnotationSummary(this.annotations));
    await this.#load();
  }

  close({ preserveActive = false } = {}) {
    if (!this.opened) return;
    this.opened = false;
    this.abortController?.abort();
    this.abortController = null;
    this.chart?.destroy();
    this.chart = null;
    this.shell.hidden = true;
    this.toggle.textContent = "Открыть полноценный график";
    if (!preserveActive && activeEpisodeId === this.id) {
      activeEpisodeId = null;
      globalThis.dispatchEvent?.(new CustomEvent("inpuls:signal-lab-chart-closed", {
        detail: { episodeId: this.id },
      }));
    }
  }

  async #load() {
    if (!this.opened || !this.chart) return;
    this.generation += 1;
    const generation = this.generation;
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.status.textContent = `Загружаю ${this.episode.symbol} · ${this.interval} · окно ${this.contextRange}…`;
    try {
      const loaded = await loadEpisodeCandles(this.episode, this.interval, this.contextRange, {
        signal: this.abortController.signal,
      });
      const candles = loaded.candles;
      const coverage = loaded.coverage;
      if (!this.opened || generation !== this.generation || !this.chart) return;
      this.chart.setData(candles, {
        symbol: this.episode.symbol,
        interval: this.interval,
        range: `episode-${this.contextRange}`,
        targetCandles: candles.length,
      });
      this.chart.setAnnotations(this.annotationToggle?.checked === false ? [] : this.annotations);
      if (this.contextRange === "30d" && candles.length <= 2_000) this.#fitRange(candles);
      else this.#focusEvent(candles);
      const percent = Math.round((coverage?.ratio ?? 0) * 100);
      const requestedDays = coverage?.requestedDays ?? 0;
      const actualDays = coverage?.actualDays ?? 0;
      this.status.dataset.coverage = coverage?.complete ? "complete" : "partial";
      this.status.textContent = `${coverage?.source ?? "UNKNOWN"} · ${candles.length} свечей · покрытие ${actualDays.toFixed(1)}/${requestedDays.toFixed(1)}д (${percent}%) · ${coverage?.complete ? "COMPLETE" : "PARTIAL"} · страниц ${coverage?.pages ?? 0}`;
    } catch (error) {
      if (error?.name === "AbortError") return;
      this.status.textContent = `График недоступен: ${String(error?.message ?? error)}`;
    }
  }

  #fitRange(candles = this.chart?.candles ?? []) {
    if (!this.chart || !candles.length) return;
    const maximumVisible = this.interval === "1m" ? Math.min(candles.length, 2_000) : candles.length;
    this.chart.visibleCount = Math.max(20, maximumVisible);
    this.chart.followLatest = false;
    this.chart.centerLatest = false;
    this.chart.priceScale = 1;
    this.chart.pricePan = 0;
    this.chart.fixedPriceDomain = null;
    this.chart.viewStart = Math.max(0, candles.length - maximumVisible);
    this.chart.render();
  }

  #focusEvent(candles = this.chart?.candles ?? []) {
    if (!this.chart || !candles.length) return;
    const eventAt = finite(this.episode?.evidencePack?.window?.eventAt) ?? finite(this.episode?.firstSeenAt);
    let eventIndex = candles.length - 1;
    if (eventAt !== null) {
      eventIndex = candles.reduce((bestIndex, candle, index) => (
        Math.abs(candle.time - eventAt) < Math.abs(candles[bestIndex].time - eventAt) ? index : bestIndex
      ), 0);
    }
    const preferred = this.interval.endsWith("s") ? 100 : this.interval === "1m" ? 80 : 60;
    this.chart.visibleCount = clamp(Math.min(candles.length, preferred), Math.min(20, candles.length), Math.max(20, candles.length));
    this.chart.followLatest = false;
    this.chart.centerLatest = false;
    this.chart.priceScale = 1;
    this.chart.pricePan = 0;
    this.chart.fixedPriceDomain = null;
    this.chart.viewStart = Math.max(0, eventIndex - this.chart.visibleCount * 0.52);
    this.chart.render();
  }

  destroy({ preserveActive = true } = {}) {
    if (this.opened) this.close({ preserveActive });
  }
}

export function mountEpisodeFullChart(card, episode, { autoOpen = false } = {}) {
  if (!card || !episode?.id) return null;
  const controller = new EpisodeFullChartController(card, episode);
  controllers.set(episode.id, controller);
  const shouldOpen = activeEpisodeId === episode.id || (autoOpen && !automaticFirstOpenUsed && activeEpisodeId === null);
  if (shouldOpen) {
    automaticFirstOpenUsed = true;
    queueMicrotask(() => controller.open());
  }
  return controller;
}

export function isEpisodeFullChartOpen() {
  return activeEpisodeId !== null;
}

export function disposeEpisodeFullCharts({ preserveActive = true } = {}) {
  for (const controller of controllers.values()) controller.destroy({ preserveActive });
  controllers.clear();
}

export function resetEpisodeFullChartState() {
  disposeEpisodeFullCharts({ preserveActive: false });
  activeEpisodeId = null;
  automaticFirstOpenUsed = false;
}
