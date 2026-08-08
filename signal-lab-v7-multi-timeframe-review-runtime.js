import {
  LOCAL_WORKING_SET_POLICY,
  STRUCTURAL_TF_LOOKBACK_MS,
  buildHierarchicalStructuralLevelMap,
  buildStructuralVolatilityContext,
  structuralChildAdmissionDecision,
  structuralDistanceBaseNatr,
  structuralLevelLabel,
  structuralLocalPivotProminenceDecision,
  structuralLocalWorkingSetPivotDecision,
  structuralNatrAt,
  structuralTrendLegQualificationDecision,
  visibleSourceTimeframes,
} from "./signal-lab-v7-multi-timeframe-levels.js";
import { binanceFuturesTickSize } from "./signal-lab-v7-binance-market-metadata.js";
import { APPROACH_CONTEXT_RESEARCH_VERSION, APPROACH_EVIDENCE_RESEARCH_VERSION, LEVEL_CONTEXT_RESEARCH_VERSION, LOCAL_STRUCTURE_RESEARCH_VERSION, STACK_ROUTE_RESEARCH_VERSION, buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, buildStackRouteResearchContext, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";

const KLINES_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";
const EXCHANGE_INFO_ENDPOINT = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const INTERVAL_MS = Object.freeze({
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
});

// V4.4 review-only generation policy. The event detector must be recall-first:
// it records price geometry, while hierarchical admission owns cross-asset
// significance/noise filtering. This prevents the same ATR/NATR idea from
// deleting a swing twice before it can even reach the visible map.
export const STRUCTURAL_REVIEW_GENERATION_CONFIG = Object.freeze({
  // V5.2: 1m intentionally has no structural generation config. The 1m chart
  // may display inherited 5m+ levels, but native persistent structure starts here.
  "5m": Object.freeze({
    minimumSwingPercent: 0.10,
    minimumPercent: 0.08,
    atrMultiplier: 0,
    minimumBarsAfterCandidate: 1,
  }),
});
const PATCH_MARKER = Symbol.for("inpuls.structural-extremes.hierarchical-review-v1");
const cache = new Map();

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function parseKline(row, endAt) {
  if (!Array.isArray(row) || row.length < 7) return null;
  const closeTime = finite(row[6]);
  if (closeTime === null || closeTime > endAt) return null;
  const candle = {
    time: finite(row[0]),
    open: finite(row[1]),
    high: finite(row[2]),
    low: finite(row[3]),
    close: finite(row[4]),
    volume: Math.max(0, finite(row[5]) ?? 0),
    closeTime,
    closed: true,
  };
  return [candle.time, candle.open, candle.high, candle.low, candle.close]
    .every((value) => value !== null && value > 0)
    ? candle
    : null;
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);
  return response.json();
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(items.length, concurrency)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function fetchTickSize(symbol, signal) {
  const key = `tick:${symbol}`;
  if (cache.has(key)) return cache.get(key);
  const url = new URL(EXCHANGE_INFO_ENDPOINT);
  url.searchParams.set("symbol", symbol);
  const payload = await fetchJson(url, signal);
  const tickSize = binanceFuturesTickSize(payload, symbol);
  cache.set(key, tickSize);
  return tickSize;
}

async function fetchCandles(symbol, timeframe, endAt, signal) {
  const lookbackMs = STRUCTURAL_TF_LOOKBACK_MS[timeframe];
  const intervalMs = INTERVAL_MS[timeframe];
  const startAt = endAt - lookbackMs;
  const cacheKey = `candles:${symbol}:${timeframe}:${Math.floor(endAt / intervalMs)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const pageSize = 1_500;
  const pageSpan = intervalMs * pageSize;
  const alignedStart = Math.floor(startAt / intervalMs) * intervalMs;
  const windows = [];
  for (let cursor = alignedStart; cursor <= endAt; cursor += pageSpan) {
    windows.push({
      startTime: cursor,
      endTime: Math.min(endAt, cursor + pageSpan - 1),
    });
  }

  const pages = await mapWithConcurrency(windows, timeframe === "1m" ? 4 : 3, async (window) => {
    const url = new URL(KLINES_ENDPOINT);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", timeframe);
    url.searchParams.set("startTime", String(window.startTime));
    url.searchParams.set("endTime", String(window.endTime));
    url.searchParams.set("limit", String(pageSize));
    const payload = await fetchJson(url, signal);
    return (Array.isArray(payload) ? payload : [])
      .map((row) => parseKline(row, endAt))
      .filter(Boolean);
  });

  const byTime = new Map();
  for (const page of pages) {
    for (const candle of page) {
      if (candle.time < startAt || candle.time > endAt) continue;
      byTime.set(candle.time, candle);
    }
  }
  const candles = [...byTime.values()].sort((left, right) => left.time - right.time);
  cache.set(cacheKey, candles);
  while (cache.size > 48) {
    const firstKey = cache.keys().next().value;
    if (String(firstKey).startsWith("tick:")) {
      const value = cache.get(firstKey);
      cache.delete(firstKey);
      cache.set(firstKey, value);
      continue;
    }
    cache.delete(firstKey);
  }
  return candles;
}

function algorithmAnnotation(row) {
  const label = String(row?.label ?? "");
  const match = /^([HL])\s+(1m|5m|15m|1h|4h|1d)\b/.exec(label);
  if (!match) return null;
  return {
    row,
    side: match[1] === "H" ? "HIGH" : "LOW",
    sourceTimeframe: match[2],
  };
}

function annotationForLevel(level) {
  const startAt = level.displayAt ?? level.extremeAt;
  const common = {
    label: structuralLevelLabel(level),
    tone: level.side === "HIGH" ? "danger" : "success",
    state: level.status,
    hierarchical: true,
    multiTimeframe: true,
    sourceTimeframe: level.sourceTimeframe,
    sources: level.sources,
    nativeExtremeAt: level.nativeExtremeAt ?? level.extremeAt,
    refinedAt: startAt,
    refinedThroughTimeframe: level.refinedThroughTimeframe ?? level.sourceTimeframe,
    refinementPath: level.refinementPath,
  };
  if (level.active !== false) {
    return {
      ...common,
      type: "ray",
      startAt,
      price: level.price,
      pinLabelRight: true,
    };
  }
  return {
    ...common,
    type: "segment",
    a: { time: startAt, price: level.price },
    b: { time: level.endAt, price: level.price },
  };
}

function addContextStatus(state, levelMap) {
  const status = document.querySelector("#status");
  if (!status) return;
  let context = document.querySelector("#multi-tf-context-status");
  if (!context) {
    context = document.createElement("div");
    context.id = "multi-tf-context-status";
    context.style.marginTop = "6px";
    context.style.fontSize = "12px";
    context.style.opacity = "0.8";
    status.insertAdjacentElement("afterend", context);
  }
  const sources = visibleSourceTimeframes(state.viewTimeframe).slice().reverse().join(" → ");
  context.textContent = `Иерархия: ${sources} · уровней ${levelMap.length} · 1д/4ч/1ч: 6 мес · 15м/5м: 1 мес · 1м: только график`;
}

function debugNumber(value, digits = 2) {
  const number = finite(value);
  return number === null ? "—" : number.toFixed(digits);
}

function debugPercentRatio(value) {
  const number = finite(value);
  return number === null ? "—" : `${(number * 100).toFixed(1)}%`;
}


// V5.3 shadow-only diagnostics. This deliberately does NOT decide visibility.
// It measures the trader-described geometry of a meaningful 5m turn: price must
// arrive into the extremum and then separate from it. Fixed 1/3/6-bar windows
// make algorithm extrema and manual etalons comparable without using the
// detector's own confirmation threshold as the answer we are trying to learn.
export function structuralVShapeShadowMetrics({
  side,
  price,
  extremeAt,
  confirmedAt = null,
  confirmingReversalPct = null,
  candles = [],
  volatilityContext = null,
  intervalMs = 300_000,
  zoneNatr = 0.35,
} = {}) {
  if (!(side === "LOW" || side === "HIGH")) return null;
  const pivotPrice = finite(price);
  const pivotAt = finite(extremeAt);
  if (!(pivotPrice > 0) || pivotAt === null) return null;

  const rows = (Array.isArray(candles) ? candles : [])
    .filter((row) => finite(row?.time) !== null && finite(row?.high) > 0 && finite(row?.low) > 0)
    .slice()
    .sort((left, right) => Number(left.time) - Number(right.time));
  const pivotIndex = rows.findIndex((row) => finite(row?.time) === pivotAt);
  if (pivotIndex < 0) return null;

  const natrAtPivot = structuralNatrAt(volatilityContext, pivotAt);
  const baseNatrPct = finite(volatilityContext?.baseNatrPct);
  const scaleNatrPct = natrAtPivot && natrAtPivot > 0 ? natrAtPivot : baseNatrPct;
  const movePct = (reference) => {
    const value = finite(reference);
    if (!(value > 0)) return null;
    return Math.abs(value - pivotPrice) / pivotPrice * 100;
  };
  const normalize = (pct) => pct !== null && scaleNatrPct > 0 ? pct / scaleNatrPct : null;
  const reference = (window, incoming) => {
    if (!window.length) return null;
    if (side === "LOW") return Math.max(...window.map((row) => Number(row.high)));
    return Math.min(...window.map((row) => Number(row.low)));
  };

  const windows = {};
  for (const bars of [1, 3, 6]) {
    const before = rows.slice(Math.max(0, pivotIndex - bars), pivotIndex);
    const after = rows.slice(pivotIndex + 1, pivotIndex + 1 + bars);
    const incomingPct = movePct(reference(before, true));
    const outgoingPct = movePct(reference(after, false));
    const incomingNatr = normalize(incomingPct);
    const outgoingNatr = normalize(outgoingPct);
    windows[bars] = Object.freeze({
      bars,
      incomingPct,
      outgoingPct,
      incomingNatr,
      outgoingNatr,
      vBalanceNatr: incomingNatr !== null && outgoingNatr !== null
        ? Math.min(incomingNatr, outgoingNatr)
        : null,
    });
  }

  const zonePct = scaleNatrPct > 0 ? scaleNatrPct * Math.max(0, Number(zoneNatr) || 0) : null;
  const nextSix = rows.slice(pivotIndex + 1, pivotIndex + 7);
  let defenseReturns6 = null;
  if (zonePct !== null) {
    defenseReturns6 = nextSix.reduce((count, row) => {
      const touchPrice = side === "LOW" ? finite(row?.low) : finite(row?.high);
      if (!(touchPrice > 0)) return count;
      const distancePct = Math.abs(touchPrice - pivotPrice) / pivotPrice * 100;
      return count + (distancePct <= zonePct ? 1 : 0);
    }, 0);
  }

  const confirmed = finite(confirmedAt);
  const safeIntervalMs = Math.max(1, Math.round(finite(intervalMs) ?? 300_000));
  const confirmationBars = confirmed === null
    ? null
    : Math.max(0, Math.round(((confirmed + 1) - (pivotAt + safeIntervalMs)) / safeIntervalMs));
  const reversalPct = finite(confirmingReversalPct);
  const confirmingReversalNatr = normalize(reversalPct);
  const confirmingReversalNatrPerBar = confirmingReversalNatr !== null && confirmationBars !== null
    ? confirmingReversalNatr / Math.max(1, confirmationBars)
    : null;

  return Object.freeze({
    side,
    price: pivotPrice,
    extremeAt: pivotAt,
    scaleNatrPct,
    natrAtPivot,
    baseNatrPct,
    zoneNatr,
    defenseReturns6,
    confirmationBars,
    confirmingReversalPct: reversalPct,
    confirmingReversalNatr,
    confirmingReversalNatrPerBar,
    windows: Object.freeze(windows),
  });
}

function buildVShapeShadowDiagnosticRows(state, levelMap) {
  if (state?.viewTimeframe !== "5m") return Object.freeze([]);
  const timeframe = "5m";
  const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
  const snapshot = state?.snapshotsByTimeframe?.[timeframe];
  if (!snapshot || !candles.length) return Object.freeze([]);
  const volatility = buildStructuralVolatilityContext(candles);
  const visibleIds = new Set();
  for (const level of Array.isArray(levelMap) ? levelMap : []) {
    if (level?.id) visibleIds.add(level.id);
    for (const id of Array.isArray(level?.memberIds) ? level.memberIds : []) visibleIds.add(id);
  }

  const rows = [];
  const raw = (Array.isArray(snapshot?.active) ? snapshot.active : [])
    .filter((extreme) => extreme && ["LOW", "HIGH"].includes(extreme.side))
    .slice()
    .sort((left, right) => (finite(left?.extremeAt) ?? Infinity) - (finite(right?.extremeAt) ?? Infinity));
  for (const extreme of raw.slice(-40)) {
    const metrics = structuralVShapeShadowMetrics({
      side: extreme.side,
      price: extreme.price,
      extremeAt: extreme.extremeAt,
      confirmedAt: extreme.confirmedAt,
      confirmingReversalPct: extreme.confirmingReversalPct,
      candles,
      volatilityContext: volatility,
      intervalMs: INTERVAL_MS[timeframe],
    });
    if (!metrics) continue;
    rows.push(Object.freeze({
      kind: "RAW",
      id: extreme.id ?? null,
      side: extreme.side,
      price: finite(extreme.price),
      extremeAt: finite(extreme.extremeAt),
      visible: visibleIds.has(extreme.id),
      metrics,
    }));
  }

  const corrections = Array.isArray(window.__INPULS_STRUCTURAL_REVIEW_CORRECTIONS__)
    ? window.__INPULS_STRUCTURAL_REVIEW_CORRECTIONS__
    : [];
  for (const correction of corrections) {
    if (correction?.type !== "ADD_EXTREME" || correction?.timeframe !== timeframe) continue;
    if (!(correction?.side === "LOW" || correction?.side === "HIGH")) continue;
    const metrics = structuralVShapeShadowMetrics({
      side: correction.side,
      price: correction.price,
      extremeAt: correction.time,
      candles,
      volatilityContext: volatility,
      intervalMs: INTERVAL_MS[timeframe],
    });
    if (!metrics) continue;
    rows.push(Object.freeze({
      kind: "ETALON",
      id: correction.id ?? null,
      side: correction.side,
      price: finite(correction.price),
      extremeAt: finite(correction.time),
      visible: null,
      metrics,
    }));
  }

  return Object.freeze(rows.sort((left, right) => (left.extremeAt ?? 0) - (right.extremeAt ?? 0)));
}

function formatVShapeShadowDiagnosticRow(row) {
  const at = row.extremeAt === null ? "—" : new Date(row.extremeAt).toISOString().slice(11, 16);
  const metric = row.metrics ?? {};
  const windowText = (bars) => {
    const value = metric.windows?.[bars] ?? {};
    return `${bars}b=${debugNumber(value.incomingNatr, 2)}/${debugNumber(value.outgoingNatr, 2)}/V${debugNumber(value.vBalanceNatr, 2)}N`;
  };
  return [
    `VSHAPE ${row.kind} ${row.side} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)}`,
    `at=${at}`,
    row.visible === null ? "visible=etalon" : `visible=${row.visible ? "YES" : "no"}`,
    `scale=${debugNumber(metric.scaleNatrPct, 3)}%`,
    windowText(1),
    windowText(3),
    windowText(6),
    `def6=${metric.defenseReturns6 ?? "—"}`,
    `conf=${metric.confirmationBars ?? "—"}b`,
    `rev=${debugNumber(metric.confirmingReversalNatr, 2)}N`,
    `revSpeed=${debugNumber(metric.confirmingReversalNatrPerBar, 2)}N/b`,
  ].join(" | ");
}

function findNativeExtreme(state, level) {
  const snapshot = state.snapshotsByTimeframe?.[level?.sourceTimeframe];
  const rows = [
    ...(Array.isArray(snapshot?.active) ? snapshot.active : []),
    ...(Array.isArray(snapshot?.history) ? snapshot.history : []),
  ];
  const byId = rows.find((row) => row?.id && row.id === level?.id);
  if (byId) return byId;
  const targetAt = finite(level?.nativeExtremeAt ?? level?.extremeAt);
  const targetPrice = finite(level?.price);
  return rows.find((row) => {
    if (row?.side !== level?.side) return false;
    const rowAt = finite(row?.extremeAt);
    const rowPrice = finite(row?.price);
    return rowAt === targetAt && rowPrice !== null && targetPrice !== null
      && Math.abs(rowPrice - targetPrice) <= Math.max(1e-9, Math.abs(targetPrice) * 1e-8);
  }) ?? null;
}

export function buildStructuralReviewDiagnosticRows(state, levelMap) {
  const rows = [];
  for (const level of Array.isArray(levelMap) ? levelMap : []) {
    const timeframe = level?.sourceTimeframe;
    if (timeframe !== "5m" || level?.active === false) continue;
    const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
    const volatility = buildStructuralVolatilityContext(candles);
    const extreme = findNativeExtreme(state, level);
    const significance = extreme
      ? structuralChildAdmissionDecision(extreme, timeframe, { volatilityContext: volatility })
      : { admitted: null, reason: "DEBUG_NATIVE_EXTREME_NOT_FOUND" };
    const prominence = structuralLocalPivotProminenceDecision(
      extreme ?? level,
      timeframe,
      candles,
      volatility,
    );
    const workingPivot = structuralLocalWorkingSetPivotDecision(level, candles, volatility);
    const distanceBaseNatr = structuralDistanceBaseNatr(level?.price, volatility);
    const maxDistanceBaseNatr = finite(LOCAL_WORKING_SET_POLICY[timeframe]?.maxDistanceBaseNatr);
    const sources = Array.isArray(level?.sources) ? level.sources : [timeframe].filter(Boolean);
    const confluenceBypass = sources.length > 1 || Number(level?.confluenceCount) > 1;
    const attackBypass = (Number(level?.attackCount) || 1) > 1;
    rows.push(Object.freeze({
      id: level?.id ?? null,
      side: level?.side ?? null,
      timeframe,
      price: finite(level?.price),
      attackCount: Math.max(1, Number(level?.attackCount) || 1),
      sources: Object.freeze([...sources]),
      confluenceBypass,
      attackBypass,
      significance,
      prominence,
      workingPivot,
      distanceBaseNatr,
      maxDistanceBaseNatr,
      nativeExtremeFound: Boolean(extreme),
      nativeExtremeAt: finite(extreme?.extremeAt),
      levelExtremeAt: finite(level?.nativeExtremeAt ?? level?.extremeAt),
    }));
  }
  return Object.freeze(rows);
}

function formatDiagnosticRow(row) {
  const bypass = row.confluenceBypass
    ? "CONFLUENCE"
    : row.attackBypass ? "ATTACK_XN" : "none";
  const sig = `${row.significance?.admitted === false ? "FAIL" : row.significance?.admitted === true ? "PASS" : "?"}:${row.significance?.reason ?? "—"}`;
  const prom = `${row.prominence?.admitted === false ? "FAIL" : row.prominence?.admitted === true ? "PASS" : "?"}:${row.prominence?.reason ?? "—"}`;
  const work = `${row.workingPivot?.visible === false ? "FAIL" : "PASS"}:${row.workingPivot?.reason ?? "—"}`;
  return [
    `${row.side} ${row.timeframe} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)} ×${row.attackCount}`,
    `native=${row.nativeExtremeFound ? "yes" : "NO"}`,
    `bypass=${bypass}`,
    `sig=${sig}`,
    `swing=${debugNumber(row.significance?.swingPct, 3)}%/req=${debugNumber(row.significance?.requiredSwingPct, 3)}%`,
    `prom=${prom}`,
    `in=${debugNumber(row.prominence?.incomingBaseNatr, 2)}N out=${debugNumber(row.prominence?.outgoingBaseNatr, 2)}N`,
    `retr=${debugPercentRatio(row.prominence?.retracementRatio)} min=${debugPercentRatio(row.prominence?.minimumRetracementRatio)}`,
    `prior=${debugNumber(row.prominence?.priorImpulseBaseNatr, 2)}N`,
    `work=${work}`,
    `workRetr=${debugPercentRatio(row.workingPivot?.retracementRatio)} min=${debugPercentRatio(row.workingPivot?.minimumRetracementRatio)}`,
    `dist=${debugNumber(row.distanceBaseNatr, 2)}N/${debugNumber(row.maxDistanceBaseNatr, 1)}N`,
  ].join(" | ");
}

function buildRawNativeDiagnosticRows(state) {
  const timeframe = state?.viewTimeframe;
  if (timeframe !== "5m") return Object.freeze([]);
  const snapshot = state?.snapshotsByTimeframe?.[timeframe];
  if (!snapshot) return Object.freeze([]);
  const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
  const volatility = buildStructuralVolatilityContext(candles);

  const rows = [];
  const push = (extreme, bucket) => {
    if (!extreme || !(["HIGH", "LOW"].includes(extreme?.side))) return;
    const pseudoLevel = {
      ...extreme,
      id: extreme?.id ?? `raw:${bucket}:${timeframe}:${extreme?.side}:${extreme?.extremeAt}:${extreme?.price}`,
      sourceTimeframe: timeframe,
      nativeExtremeAt: extreme?.extremeAt,
      sources: [timeframe],
      confluenceCount: 1,
      attackCount: Math.max(1, Number(extreme?.attackCount) || Number(extreme?.touchCount) || 1),
      active: extreme?.active !== false,
    };
    const significance = structuralChildAdmissionDecision(extreme, timeframe, { volatilityContext: volatility });
    const prominence = structuralLocalPivotProminenceDecision(extreme, timeframe, candles, volatility);
    const workingPivot = structuralLocalWorkingSetPivotDecision(pseudoLevel, candles, volatility);
    rows.push(Object.freeze({
      bucket,
      side: extreme?.side ?? null,
      price: finite(extreme?.price),
      extremeAt: finite(extreme?.extremeAt),
      confirmedAt: finite(extreme?.confirmedAt),
      status: extreme?.status ?? null,
      swingPct: finite(extreme?.swingAmplitudePct),
      reversalPct: finite(extreme?.confirmingReversalPct),
      significance,
      prominence,
      workingPivot,
      distanceBaseNatr: structuralDistanceBaseNatr(extreme?.price, volatility),
    }));
  };

  push(snapshot?.candidate, "candidate");
  push(snapshot?.oppositeCandidate, "opposite");
  for (const extreme of Array.isArray(snapshot?.active) ? snapshot.active : []) push(extreme, "active");
  for (const extreme of Array.isArray(snapshot?.history) ? snapshot.history : []) push(extreme, "history");

  return Object.freeze(rows
    .sort((left, right) => (right.extremeAt ?? -Infinity) - (left.extremeAt ?? -Infinity))
    .slice(0, 30));
}

function formatRawNativeDiagnosticRow(row) {
  const sig = `${row.significance?.admitted === false ? "FAIL" : row.significance?.admitted === true ? "PASS" : "?"}:${row.significance?.reason ?? "—"}`;
  const prom = `${row.prominence?.admitted === false ? "FAIL" : row.prominence?.admitted === true ? "PASS" : "?"}:${row.prominence?.reason ?? "—"}`;
  const work = `${row.workingPivot?.visible === false ? "FAIL" : "PASS"}:${row.workingPivot?.reason ?? "—"}`;
  const at = row.extremeAt === null ? "—" : new Date(row.extremeAt).toISOString().slice(11, 16);
  const confirmed = row.confirmedAt === null ? "—" : new Date(row.confirmedAt).toISOString().slice(11, 16);
  return [
    `${row.bucket.toUpperCase()} ${row.side} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)}`,
    `at=${at} conf=${confirmed}`,
    `status=${row.status ?? "—"}`,
    `swing=${debugNumber(row.swingPct, 3)}% rev=${debugNumber(row.reversalPct, 3)}%`,
    `sig=${sig}`,
    `prom=${prom}`,
    `work=${work}`,
    `dist=${debugNumber(row.distanceBaseNatr, 2)}N`,
  ].join(" | ");
}

function buildV5SourceQualificationDiagnosticRows(state, levelMap) {
  const timeframe = state?.viewTimeframe;
  if (timeframe !== "5m") return Object.freeze([]);
  const snapshot = state?.snapshotsByTimeframe?.[timeframe];
  if (!snapshot) return Object.freeze([]);
  const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
  const volatility = buildStructuralVolatilityContext(candles);
  const visibleMemberIds = new Set();
  for (const level of Array.isArray(levelMap) ? levelMap : []) {
    if (level?.id) visibleMemberIds.add(level.id);
    for (const id of Array.isArray(level?.memberIds) ? level.memberIds : []) visibleMemberIds.add(id);
  }

  const active = (Array.isArray(snapshot?.active) ? snapshot.active : [])
    .filter((extreme) => extreme && ["HIGH", "LOW"].includes(extreme.side))
    .slice()
    .sort((left, right) => (finite(left?.extremeAt) ?? Infinity) - (finite(right?.extremeAt) ?? Infinity));

  const lastQualifiedBySide = new Map();
  const rows = [];
  for (const extreme of active) {
    const pseudoLevel = {
      ...extreme,
      id: extreme?.id ?? `v5debug:${timeframe}:${extreme?.side}:${extreme?.extremeAt}:${extreme?.price}`,
      sourceTimeframe: timeframe,
      nativeExtremeAt: extreme?.extremeAt,
      displayAt: extreme?.extremeAt,
      refinedThroughTimeframe: timeframe,
      refinementPath: [{ timeframe, time: extreme?.extremeAt }],
      sources: [timeframe],
      confluenceCount: 1,
      attackCount: Math.max(1, Number(extreme?.attackCount) || Number(extreme?.touchCount) || 1),
      active: extreme?.active !== false,
    };
    const significance = structuralChildAdmissionDecision(extreme, timeframe, { volatilityContext: volatility });
    const prominence = structuralLocalPivotProminenceDecision(extreme, timeframe, candles, volatility);
    const sourceQualityPassed = significance?.admitted !== false && prominence?.admitted !== false;
    const previous = lastQualifiedBySide.get(extreme.side) ?? null;
    const decision = sourceQualityPassed
      ? structuralTrendLegQualificationDecision(pseudoLevel, previous, timeframe, candles)
      : Object.freeze({ qualified: false, reason: "SOURCE_QUALITY_FILTERED_BEFORE_V5" });
    if (sourceQualityPassed && decision.qualified) lastQualifiedBySide.set(extreme.side, pseudoLevel);
    rows.push(Object.freeze({
      side: extreme.side,
      price: finite(extreme.price),
      extremeAt: finite(extreme.extremeAt),
      attackCount: pseudoLevel.attackCount,
      sourceQualityPassed,
      significance,
      prominence,
      previousPrice: finite(previous?.price),
      previousAt: finite(previous?.extremeAt),
      decision,
      visibleAfterHierarchy: visibleMemberIds.has(pseudoLevel.id),
    }));
  }

  return Object.freeze(rows.slice(-30));
}

function formatV5SourceQualificationDiagnosticRow(row) {
  const at = row.extremeAt === null ? "—" : new Date(row.extremeAt).toISOString().slice(11, 16);
  const prevAt = row.previousAt === null ? "—" : new Date(row.previousAt).toISOString().slice(11, 16);
  const verdict = `${row.decision?.qualified ? "PASS" : "FAIL"}:${row.decision?.reason ?? "—"}`;
  return [
    `V5SRC ${row.side} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)} ×${row.attackCount}`,
    `at=${at}`,
    `visible=${row.visibleAfterHierarchy ? "YES" : "no"}`,
    `quality=${row.sourceQualityPassed ? "PASS" : "FAIL"}`,
    `prev=${debugNumber(row.previousPrice, row.price >= 1000 ? 1 : 6)}@${prevAt}`,
    `v5=${verdict}`,
    `v1=${debugNumber(row.decision?.vRejection?.immediateBalanceNatr ?? row.decision?.immediateBalanceNatr, 2)}N`,
    `v6=${debugNumber(row.decision?.vRejection?.sustainedBalanceNatr ?? row.decision?.sustainedBalanceNatr, 2)}N`,
    `def6=${row.decision?.vRejection?.defenseReturns ?? row.decision?.defenseReturns ?? "—"}`,
    `bars=${debugNumber(row.decision?.anchorBars, 1)}`,
    `in=${debugNumber(row.prominence?.incomingBaseNatr, 2)}N out=${debugNumber(row.prominence?.outgoingBaseNatr, 2)}N`,
    `retr=${debugPercentRatio(row.prominence?.retracementRatio)}`,
  ].join(" | ");
}

function buildManualEtalonDiagnosticRows(state) {
  const corrections = Array.isArray(window.__INPULS_STRUCTURAL_REVIEW_CORRECTIONS__)
    ? window.__INPULS_STRUCTURAL_REVIEW_CORRECTIONS__
    : [];
  const timeframe = state?.viewTimeframe;
  if (timeframe !== "5m") return Object.freeze([]);
  const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
  const volatility = buildStructuralVolatilityContext(candles);
  const rows = [];
  for (const correction of corrections) {
    if (correction?.type !== "ADD_EXTREME" || correction?.timeframe !== timeframe) continue;
    if (!(["HIGH", "LOW"].includes(correction?.side))) continue;
    const price = finite(correction?.price);
    const extremeAt = finite(correction?.time);
    if (!(price > 0) || extremeAt === null) continue;
    const pseudoLevel = {
      id: correction.id ?? `manual:${timeframe}:${correction.side}:${extremeAt}:${price}`,
      side: correction.side,
      price,
      extremeAt,
      nativeExtremeAt: extremeAt,
      sourceTimeframe: timeframe,
      sources: [timeframe],
      attackCount: 1,
      active: true,
    };
    const workingPivot = structuralLocalWorkingSetPivotDecision(pseudoLevel, candles, volatility);
    const distanceBaseNatr = structuralDistanceBaseNatr(price, volatility);
    rows.push(Object.freeze({
      id: correction.id ?? null,
      side: correction.side,
      timeframe,
      price,
      extremeAt,
      workingPivot,
      distanceBaseNatr,
      maxDistanceBaseNatr: finite(LOCAL_WORKING_SET_POLICY[timeframe]?.maxDistanceBaseNatr),
    }));
  }
  return Object.freeze(rows);
}

function formatManualEtalonDiagnosticRow(row) {
  const work = `${row.workingPivot?.visible === false ? "FAIL" : "PASS"}:${row.workingPivot?.reason ?? "—"}`;
  return [
    `ETALON ${row.side} ${row.timeframe} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)}`,
    `work=${work}`,
    `retr=${debugPercentRatio(row.workingPivot?.retracementRatio)} min=${debugPercentRatio(row.workingPivot?.minimumRetracementRatio)}`,
    `prior=${debugNumber(row.workingPivot?.priorImpulseBaseNatr, 2)}N`,
    `peak=${debugNumber(row.workingPivot?.peakPrice, row.price >= 1000 ? 1 : 6)}`,
    `origin=${debugNumber(row.workingPivot?.originLow, row.price >= 1000 ? 1 : 6)}`,
    `dist=${debugNumber(row.distanceBaseNatr, 2)}N/${debugNumber(row.maxDistanceBaseNatr, 1)}N`,
  ].join(" | ");
}

function buildCandleTraceRows(state) {
  const params = new URL(window.location.href).searchParams;
  const traceFrom = finite(params.get("traceFrom"));
  const traceTo = finite(params.get("traceTo"));
  if (traceFrom === null || traceTo === null || traceTo < traceFrom) return Object.freeze([]);
  const timeframe = state?.viewTimeframe;
  const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
  return Object.freeze(candles
    .filter((candle) => {
      const at = finite(candle?.time);
      return at !== null && at >= traceFrom && at <= traceTo;
    })
    .map((candle) => Object.freeze({
      time: finite(candle?.time),
      open: finite(candle?.open),
      high: finite(candle?.high),
      low: finite(candle?.low),
      close: finite(candle?.close),
      volume: finite(candle?.volume),
    })));
}


function formatBoundaryContext(timeContext) {
  const labels = ["5m", "15m", "30m", "1h", "4h", "1d"];
  return labels.map((label) => {
    const row = timeContext?.[label];
    if (!row) return `${label}:—`;
    const near = row.nearBoundary ? "!" : "";
    return `${label}:${debugNumber(row.remainingMinutes, row.remainingMinutes < 1 ? 2 : 1)}m${near}`;
  }).join(" ");
}


function buildLevelContextCandidatePool(state, levelMap) {
  const hiddenCandidates = [];
  if (state?.viewTimeframe === "5m") {
    const timeframe = "5m";
    const snapshot = state?.snapshotsByTimeframe?.[timeframe];
    const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
    const volatility = buildStructuralVolatilityContext(candles);
    for (const extreme of Array.isArray(snapshot?.active) ? snapshot.active : []) {
      if (!extreme || extreme.active === false || !["HIGH", "LOW"].includes(extreme?.side)) continue;
      const significance = structuralChildAdmissionDecision(extreme, timeframe, { volatilityContext: volatility });
      const prominence = structuralLocalPivotProminenceDecision(extreme, timeframe, candles, volatility);
      if (significance?.admitted === false || prominence?.admitted === false) continue;
      hiddenCandidates.push(Object.freeze({
        ...extreme,
        sourceTimeframe: timeframe,
        nativeExtremeAt: extreme?.extremeAt,
        sources: Object.freeze([timeframe]),
        confluenceCount: 1,
        // Do not reinterpret lifecycle touchCount as Attack ×N. Exact attack
        // semantics remain owned by the structural lifecycle engine.
        attackCount: Math.max(1, Math.round(Number(extreme?.attackCount) || 1)),
        active: true,
      }));
    }
  }
  return mergeLevelResearchCandidatePool(levelMap, hiddenCandidates);
}

function formatResearchBoundary(row) {
  if (!row) return "—";
  const map = row.candidateState === "VISIBLE_MAP" ? "VISIBLE" : "shadow";
  return `${debugNumber(row.price, row.price >= 1000 ? 1 : 6)}(Q${row.qualityScore ?? "—"}/R${row.relevanceScore ?? "—"}/${map}/d${debugNumber(row.distancePct, 2)}%)`;
}

function formatResearchBracket(label, bracket) {
  if (!bracket) return `${label} | unavailable`;
  return [
    label,
    `LOW=${formatResearchBoundary(bracket.low)}`,
    `HIGH=${formatResearchBoundary(bracket.high)}`,
    `width=${debugNumber(bracket.widthPct, 3)}%/${debugNumber(bracket.widthNatr, 2)}N`,
    `pos=${debugNumber(bracket.currentPosition === null ? null : bracket.currentPosition * 100, 1)}%`,
    `inside=${bracket.containedLevels}`,
    `map=${bracket.visibleLevels}V/${bracket.shadowLevels}S`,
  ].join(" | ");
}

function formatResearchStack(label, rows) {
  const source = Array.isArray(rows) ? rows : [];
  if (!source.length) return `${label} | none`;
  return `${label} | ${source.map(formatResearchBoundary).join(" ; ")}`;
}

function formatLocalStructureResearchContext(row) {
  if (!row || row.state === "UNKNOWN") return ["LOCAL STRUCTURE | unavailable"];
  const counts = row.counts ?? {};
  return [
    `LOCAL STRUCTURE ${LOCAL_STRUCTURE_RESEARCH_VERSION} · RESEARCH ONLY · relational, no signal score`,
    [
      "STRUCT WINDOW",
      `current=${debugNumber(row.currentPrice, row.currentPrice >= 1000 ? 1 : 6)}`,
      `natr=${debugNumber(row.currentNatrPct, 3)}%`,
      `1%=${counts.within1Pct ?? 0}`,
      `2%=${counts.within2Pct ?? 0}`,
      `5%=${counts.within5Pct ?? 0}`,
      `HIGH↑=${counts.highsAbove ?? 0}`,
      `LOW↓=${counts.lowsBelow ?? 0}`,
      `mismatch=${counts.sideMismatch ?? 0}`,
      `map=${counts.visible ?? 0}V/${counts.shadow ?? 0}S`,
      `highSpread=${debugNumber(row.highStackSpreadPct, 3)}%`,
      `lowSpread=${debugNumber(row.lowStackSpreadPct, 3)}%`,
    ].join(" | "),
    formatResearchBracket("STRUCT NEAREST", row.nearestBracket),
    formatResearchBracket("STRUCT QUALITY", row.strongestBracket),
    formatResearchStack("STACK HIGH↑", row.highStack),
    formatResearchStack("STACK LOW↓", row.lowStack),
    formatResearchStack("SIDE MISMATCH", row.sideMismatch),
  ];
}


function formatStackRouteSide(label, row) {
  if (!row || !Array.isArray(row.levels) || !row.levels.length) return `ROUTE ${label} | none`;
  const levels = row.levels.map((level) => {
    const map = level.candidateState === "VISIBLE_MAP" ? "V" : "S";
    return `L${level.index}:${debugNumber(level.price, level.price >= 1000 ? 1 : 6)}(${map},Q${level.qualityScore ?? "—"},R${level.relevanceScore ?? "—"},d${debugNumber(level.distanceNatr, 2)}N)`;
  }).join(" ; ");
  const gaps = row.gaps.length
    ? row.gaps.map((gap) => `L${gap.fromIndex}→L${gap.toIndex}:${debugNumber(gap.gapPct, 3)}%/${debugNumber(gap.gapNatr, 2)}N`).join(" ; ")
    : "none";
  return [
    `ROUTE ${label}`,
    `levels=${row.levelCount}`,
    `map=${row.visibleCount}V/${row.shadowCount}S`,
    `current→L1=${debugNumber(row.currentToFirstPct, 3)}%/${debugNumber(row.currentToFirstNatr, 2)}N`,
    `span=${debugNumber(row.spanToLastPct, 3)}%/${debugNumber(row.spanToLastNatr, 2)}N`,
    `gaps=${gaps}`,
    `ladder=${levels}`,
  ].join(" | ");
}

function formatStackRouteResearchContext(row) {
  if (!row || row.state === "UNKNOWN") return ["STACK ROUTE | unavailable"];
  return [
    `STACK ROUTE ${STACK_ROUTE_RESEARCH_VERSION} · RESEARCH ONLY · ordered levels, not cascade`,
    formatStackRouteSide("HIGH↑", row.high),
    formatStackRouteSide("LOW↓", row.low),
  ];
}

function formatApproachResearchRow(row) {
  const map = row?.candidateState === "VISIBLE_MAP" ? "VISIBLE" : "shadow";
  const roles = Array.isArray(row?.roles) ? row.roles.join("+") : "?";
  const causalAt = finite(row?.causalFromAt);
  const causalAtLabel = causalAt === null ? "—" : new Date(causalAt).toISOString().slice(11, 16);
  const countOrDash = (value) => value === null || value === undefined ? "—" : value;
  return [
    `APPROACH ${row.side} ${roles}`,
    `target=${debugNumber(row.targetPrice, row.targetPrice >= 1000 ? 1 : 6)}`,
    `map=${map}`,
    `Q=${row.qualityScore ?? "—"} R=${row.relevanceScore ?? "—"}`,
    `sample=${row.sampleBars ?? 0}/${row.requestedLookbackBars ?? 12}b(${row.sampleState ?? "?"})`,
    `causal=${row.causalBasis ?? "?"}@${causalAtLabel}`,
    `dist=${debugNumber(row.currentDistancePct, 3)}%/${debugNumber(row.currentDistanceNatr, 2)}N`,
    `gap=${debugNumber(row.startGapNatr, 2)}→${debugNumber(row.endGapNatr, 2)}N`,
    `toward3/6/12=${debugNumber(row.towardDelta3Natr, 2)}/${debugNumber(row.towardDelta6Natr, 2)}/${debugNumber(row.towardDelta12Natr, 2)}N`,
    `medianCompress=${debugNumber(row.medianGapCompressionNatr, 2)}N`,
    `${row.progressionLabel === "HIGHER_FLOOR" ? "floorRise" : "ceilingDrop"}=${debugNumber(row.progressionNatr, 2)}N`,
    `near3/6/${row.sampleBars ?? 0}=${countOrDash(row.nearBars3)}/${countOrDash(row.nearBars6)}/${countOrDash(row.nearBarsWindow)}`,
    `nearGroups=${countOrDash(row.proximityGroups)}(not×N)`,
    `lastNear=${row.lastNearBarsAgo ?? "—"}b`,
    `closeBeyond=${countOrDash(row.closeBeyondBars)}`,
    `extremeBeyond=${countOrDash(row.extremeBeyondBars)}(not PIERCED)`,
    `range3v3=${debugNumber(row.rangeContractionRatio3v3, 2)}x`,
  ].join(" | ");
}

function formatApproachResearchContext(row) {
  if (!row || row.state === "UNKNOWN") return ["APPROACH CONTEXT | unavailable"];
  return [
    `APPROACH CONTEXT ${APPROACH_CONTEXT_RESEARCH_VERSION} · 5m PATH · RESEARCH ONLY · no breakout score`,
    ...(Array.isArray(row.targets) && row.targets.length
      ? row.targets.map(formatApproachResearchRow)
      : ["APPROACH TARGETS | none"]),
  ];
}


function formatApproachEvidenceResearchContext(row) {
  if (!row || row.state === "UNKNOWN") return ["APPROACH EVIDENCE | unavailable"];
  const rows = Array.isArray(row.targets) ? row.targets : [];
  return [
    `APPROACH EVIDENCE ${APPROACH_EVIDENCE_RESEARCH_VERSION} · RESEARCH ONLY · facts, no combined score`,
    ...(rows.length ? rows.map((target) => {
      const roles = Array.isArray(target.roles) ? target.roles.join("+") : "?";
      const map = target.candidateState === "VISIBLE_MAP" ? "VISIBLE" : "shadow";
      const facts = Array.isArray(target.facts) && target.facts.length ? target.facts.join(",") : "none";
      return [
        `EVIDENCE ${target.side} ${roles}`,
        `target=${debugNumber(target.targetPrice, target.targetPrice >= 1000 ? 1 : 6)}`,
        `map=${map}`,
        `ready=${target.readiness}`,
        `sample=${target.sampleBars}/${target.requestedLookbackBars}b`,
        `dist=${debugNumber(target.currentDistanceNatr, 2)}N`,
        `toward3/6/12=${debugNumber(target.towardDelta3Natr, 2)}/${debugNumber(target.towardDelta6Natr, 2)}/${debugNumber(target.towardDelta12Natr, 2)}N`,
        `${target.progressionLabel === "HIGHER_FLOOR" ? "floorRise" : "ceilingDrop"}=${debugNumber(target.progressionNatr, 2)}N`,
        `medianCompress=${debugNumber(target.medianGapCompressionNatr, 2)}N`,
        `range3v3=${debugNumber(target.rangeContractionRatio3v3, 2)}x`,
        `near=${target.nearBarsWindow ?? "—"}b/groups=${target.proximityGroups ?? "—"}`,
        `facts=${facts}`,
      ].join(" | ");
    }) : ["APPROACH EVIDENCE TARGETS | none"]),
  ];
}

function formatLevelResearchContextRow(row) {
  const missing = Object.entries(row?.coverage ?? {})
    .filter(([, state]) => state !== "AVAILABLE")
    .map(([key]) => key)
    .join(",");
  const sources = Array.isArray(row?.sources) ? row.sources.join("+") : row?.sourceTimeframe ?? "?";
  return [
    `CTX ${row.side} ${sources} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)}`,
    `map=${row.candidateState === "VISIBLE_MAP" ? "VISIBLE" : "shadow"}`,
    `Q=${row.quality?.score ?? "—"}`,
    `R=${row.relevance?.score ?? "—"}`,
    `dist=${debugNumber(row.relevance?.distancePct, 3)}%`,
    `range5=${row.relevance?.inFivePercentWindow ? "YES" : "no"}`,
    `×${row.attackCount}`,
    `conf=${row.confluenceCount}`,
    `density=${row.relevance?.neighborsWithin5PctOfLevel ?? "—"}/${row.relevance?.activeLevelsWithin5PctOfCurrent ?? "—"}`,
    `age=${debugNumber(row.ageBars, 1)}b`,
    `swing=${debugNumber(row.quality?.swingNatr, 2)}N`,
    `rev=${debugNumber(row.quality?.reversalNatr, 2)}N`,
    `v=${row.quality?.vShape ? `${debugNumber(row.quality.vShape.immediateBalanceNatr, 2)}/${debugNumber(row.quality.vShape.sustainedBalanceNatr, 2)}N def${row.quality.vShape.defenseReturns}` : "—"}`,
    `boundary=${formatBoundaryContext(row.timeContext)}`,
    `missing=${missing || "none"}`,
  ].join(" | ");
}

function formatCandleTraceRow(row) {
  const at = row.time === null ? "—" : new Date(row.time).toISOString().slice(11, 16);
  const digits = Math.max(row.open ?? 0, row.high ?? 0, row.low ?? 0, row.close ?? 0) >= 1000 ? 1 : 6;
  const rangePct = row.low > 0 && row.high !== null
    ? (row.high - row.low) / row.low * 100
    : null;
  const closeFromLowPct = row.low > 0 && row.close !== null
    ? (row.close - row.low) / row.low * 100
    : null;
  const closeFromHighPct = row.high > 0 && row.close !== null
    ? (row.high - row.close) / row.high * 100
    : null;
  return [
    `CANDLE ${at}Z`,
    `O=${debugNumber(row.open, digits)}`,
    `H=${debugNumber(row.high, digits)}`,
    `L=${debugNumber(row.low, digits)}`,
    `C=${debugNumber(row.close, digits)}`,
    `range=${debugNumber(rangePct, 3)}%`,
    `C-L=${debugNumber(closeFromLowPct, 3)}%`,
    `H-C=${debugNumber(closeFromHighPct, 3)}%`,
  ].join(" | ");
}

async function copyDiagnosticText(text) {
  const value = String(text ?? "");
  if (!value) return false;

  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // raw.githack / browser permissions can block Clipboard API. Fall back
      // to a temporary textarea so one-click copy still works where possible.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

function ensureDiagnosticPanel(message = null) {
  const params = new URL(window.location.href).searchParams;
  const debugEnabled = params.get("debug") === "1";
  let wrapper = document.querySelector("#structural-level-debug-wrapper");
  let panel = document.querySelector("#structural-level-debug");
  if (!debugEnabled) {
    wrapper?.remove();
    if (!wrapper) panel?.remove();
    return null;
  }

  if (!panel) {
    const anchor = document.querySelector("#multi-tf-context-status") ?? document.querySelector("#status");
    if (!anchor) return null;

    wrapper = document.createElement("div");
    wrapper.id = "structural-level-debug-wrapper";
    wrapper.style.margin = "8px 0 12px";

    const toolbar = document.createElement("div");
    toolbar.id = "structural-level-debug-toolbar";
    toolbar.style.display = "flex";
    toolbar.style.alignItems = "center";
    toolbar.style.gap = "8px";
    toolbar.style.marginBottom = "6px";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.id = "copy-structural-debug";
    copyButton.textContent = "Копировать debug";
    copyButton.style.cursor = "pointer";
    copyButton.style.padding = "6px 10px";
    copyButton.style.border = "1px solid rgba(255,255,255,0.20)";
    copyButton.style.borderRadius = "7px";
    copyButton.style.background = "rgba(255,255,255,0.08)";
    copyButton.style.color = "inherit";
    copyButton.style.font = "inherit";

    const researchButton = document.createElement("button");
    researchButton.type = "button";
    researchButton.id = "copy-structural-research";
    researchButton.textContent = "Копировать research";
    researchButton.style.cursor = "pointer";
    researchButton.style.padding = "6px 10px";
    researchButton.style.border = "1px solid rgba(255,255,255,0.20)";
    researchButton.style.borderRadius = "7px";
    researchButton.style.background = "rgba(255,255,255,0.08)";
    researchButton.style.color = "inherit";
    researchButton.style.font = "inherit";

    const copyStatus = document.createElement("span");
    copyStatus.id = "copy-structural-debug-status";
    copyStatus.style.fontSize = "12px";
    copyStatus.style.opacity = "0.8";

    panel = document.createElement("pre");
    panel.id = "structural-level-debug";
    panel.style.margin = "0";
    panel.style.padding = "10px";
    panel.style.border = "1px solid rgba(255,255,255,0.14)";
    panel.style.borderRadius = "8px";
    panel.style.background = "rgba(255,255,255,0.035)";
    panel.style.fontSize = "11px";
    panel.style.lineHeight = "1.45";
    panel.style.whiteSpace = "pre-wrap";
    panel.style.userSelect = "text";

    copyButton.addEventListener("click", async () => {
      const originalLabel = copyButton.textContent;
      copyButton.disabled = true;
      const copied = await copyDiagnosticText(panel.textContent);
      copyButton.textContent = copied ? "Скопировано ✓" : "Не скопировалось";
      copyStatus.textContent = copied
        ? "Вставь текст прямо в чат"
        : "Выдели текст в блоке вручную";
      window.setTimeout(() => {
        copyButton.textContent = originalLabel;
        copyButton.disabled = false;
        copyStatus.textContent = "";
      }, 2200);
    });

    researchButton.addEventListener("click", async () => {
      const originalLabel = researchButton.textContent;
      researchButton.disabled = true;
      const snapshot = String(window.__INPULS_RESEARCH_SNAPSHOT_TEXT__ ?? "");
      const copied = await copyDiagnosticText(snapshot);
      researchButton.textContent = copied ? "Research скопирован ✓" : "Не скопировалось";
      copyStatus.textContent = copied
        ? "Пришли этот короткий блок в чат"
        : "Research snapshot ещё не готов";
      window.setTimeout(() => {
        researchButton.textContent = originalLabel;
        researchButton.disabled = false;
        copyStatus.textContent = "";
      }, 2200);
    });

    toolbar.append(copyButton, researchButton, copyStatus);
    wrapper.append(toolbar, panel);
    anchor.insertAdjacentElement("afterend", wrapper);
  }

  if (message !== null) panel.textContent = String(message);
  return panel;
}

function addDiagnosticPanel(state, levelMap) {
  const panel = ensureDiagnosticPanel();
  if (!panel) return;
  const diagnostics = buildStructuralReviewDiagnosticRows(state, levelMap);
  window.__INPULS_STRUCTURAL_DEBUG__ = diagnostics;
  const localRows = diagnostics
    .filter((row) => row.timeframe === state.viewTimeframe)
    .sort((left, right) => (right.price ?? 0) - (left.price ?? 0));
  const manualEtalons = [...buildManualEtalonDiagnosticRows(state)]
    .sort((left, right) => (right.price ?? 0) - (left.price ?? 0));
  const rawNativeRows = [...buildRawNativeDiagnosticRows(state)];
  const v5SourceRows = [...buildV5SourceQualificationDiagnosticRows(state, levelMap)];
  const vShapeRows = [...buildVShapeShadowDiagnosticRows(state, levelMap)];
  const levelContextPool = buildLevelContextCandidatePool(state, levelMap);
  const levelContextRows = [...buildLevelResearchContexts(levelContextPool, {
    candlesByTimeframe: state.candlesByTimeframe,
    viewTimeframe: state.viewTimeframe,
    endAt: state.endAt,
  })];
  window.__INPULS_LEVEL_CONTEXT_CANDIDATES__ = levelContextPool;
  window.__INPULS_LEVEL_CONTEXT__ = levelContextRows;
  const viewVolatility = buildStructuralVolatilityContext(state?.candlesByTimeframe?.[state.viewTimeframe] ?? []);
  const localStructureContext = buildLocalStructureResearchContext(levelContextRows, {
    currentPrice: viewVolatility.currentPrice,
    currentNatrPct: viewVolatility.currentNatrPct,
  });
  window.__INPULS_LOCAL_STRUCTURE_CONTEXT__ = localStructureContext;
  const localStructureLines = formatLocalStructureResearchContext(localStructureContext);
  const stackRouteContext = buildStackRouteResearchContext(localStructureContext);
  window.__INPULS_STACK_ROUTE__ = stackRouteContext;
  const stackRouteLines = formatStackRouteResearchContext(stackRouteContext);
  const structural5mCandles = state?.candlesByTimeframe?.["5m"] ?? [];
  const structural5mVolatility = buildStructuralVolatilityContext(structural5mCandles);
  const approachContext = buildApproachCompressionResearchContext(structural5mCandles, localStructureContext, {
    currentPrice: localStructureContext.currentPrice,
    currentNatrPct: structural5mVolatility.currentNatrPct ?? localStructureContext.currentNatrPct,
    lookbackBars: 12,
  });
  window.__INPULS_APPROACH_CONTEXT__ = approachContext;
  const approachLines = formatApproachResearchContext(approachContext);
  const approachEvidenceContext = buildApproachEvidenceResearchContext(approachContext);
  window.__INPULS_APPROACH_EVIDENCE__ = approachEvidenceContext;
  const approachEvidenceLines = formatApproachEvidenceResearchContext(approachEvidenceContext);
  const researchParams = new URL(window.location.href).searchParams;
  const researchSymbol = String(researchParams.get("symbol") ?? "?").trim().toUpperCase() || "?";
  const localResearchRows = levelContextRows.filter((row) => row?.relevance?.inFivePercentWindow);
  const researchSnapshotText = [
    `RESEARCH SNAPSHOT v6.6-compact-cross-asset-2026-08 · ${researchSymbol} · ${state.viewTimeframe} · endAt=${new Date(state.endAt).toISOString()}`,
    ...localStructureLines,
    ...stackRouteLines,
    ...approachEvidenceLines,
    `LOCAL LEVELS 0-5% · rows=${localResearchRows.length}`,
    ...localResearchRows.map(formatLevelResearchContextRow),
  ].join("\n");
  window.__INPULS_RESEARCH_SNAPSHOT_TEXT__ = researchSnapshotText;
  const candleTraceRows = [...buildCandleTraceRows(state)];
  panel.textContent = [
    `DEBUG V6.5 LEVEL LADDER + V6.4 EVIDENCE · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,
    ...localStructureLines,
    ...stackRouteLines,
    ...approachLines,
    ...approachEvidenceLines,
    `LEVEL CONTEXT ${LEVEL_CONTEXT_RESEARCH_VERSION} · RESEARCH ONLY · pool=${levelContextPool.length} visible=${levelContextRows.filter((row) => row.candidateState === "VISIBLE_MAP").length} shadow=${levelContextRows.filter((row) => row.candidateState !== "VISIBLE_MAP").length} · Q=structural geometry · R=0-5% current relevance`,
    ...levelContextRows.map(formatLevelResearchContextRow),
    `LEGACY V5.4 LEVEL DEBUG · rows ${localRows.length}`,
    ...localRows.map(formatDiagnosticRow),
    `V-SHAPE SHADOW DEBUG · rows ${vShapeRows.length}`,
    ...vShapeRows.map(formatVShapeShadowDiagnosticRow),
    `V5 SOURCE DEBUG · recent ${v5SourceRows.length}`,
    ...v5SourceRows.map(formatV5SourceQualificationDiagnosticRow),
    `RAW NATIVE DEBUG · recent ${rawNativeRows.length}`,
    ...rawNativeRows.map(formatRawNativeDiagnosticRow),
    `CANDLE TRACE · rows ${candleTraceRows.length}`,
    ...candleTraceRows.map(formatCandleTraceRow),
    `ETALON DEBUG · manual levels ${manualEtalons.length}`,
    ...manualEtalons.map(formatManualEtalonDiagnosticRow),
  ].join("\n");
}

function combineAnnotations(state) {
  const baseRows = Array.isArray(state.baseAnnotations) ? state.baseAnnotations : [];
  const showExtremes = document.querySelector("#show-extremes")?.checked !== false;
  if (!showExtremes || !state.snapshotsByTimeframe || !state.tickSize) return baseRows;

  const includeHistory = Boolean(document.querySelector("#show-history")?.checked);
  const levelMap = buildHierarchicalStructuralLevelMap({
    snapshotsByTimeframe: state.snapshotsByTimeframe,
    candlesByTimeframe: state.candlesByTimeframe,
    viewTimeframe: state.viewTimeframe,
    endAt: state.endAt,
    includeHistory,
    tickSize: state.tickSize,
  });

  // The hierarchy owns every algorithmic H/L line. Manual trader annotations,
  // candidate markers and auxiliary drawings remain untouched.
  const keptBase = baseRows.filter((row) => !algorithmAnnotation(row));
  const overlays = levelMap.map(annotationForLevel);
  state.levelMap = levelMap;
  addContextStatus(state, levelMap);
  addDiagnosticPanel(state, levelMap);
  return [...keptBase, ...overlays];
}

async function loadHierarchicalContext({
  symbol,
  viewTimeframe,
  endAt,
  EngineClass,
  signal,
}) {
  const tickSize = await fetchTickSize(symbol, signal);
  const sourceTimeframes = visibleSourceTimeframes(viewTimeframe);
  const snapshotsByTimeframe = {};
  const candlesByTimeframe = {};

  await Promise.all(sourceTimeframes.map(async (sourceTimeframe) => {
    const sourceCandles = await fetchCandles(symbol, sourceTimeframe, endAt, signal);
    if (!sourceCandles.length) return;
    candlesByTimeframe[sourceTimeframe] = sourceCandles;
    const engine = new EngineClass({
      symbol,
      timeframe: sourceTimeframe,
      tickSize,
      config: STRUCTURAL_REVIEW_GENERATION_CONFIG[sourceTimeframe] ?? {},
    });
    engine.ingestCandles(sourceCandles);
    snapshotsByTimeframe[sourceTimeframe] = engine.snapshot();
  }));

  return { tickSize, snapshotsByTimeframe, candlesByTimeframe };
}

export function installMultiTimeframeReviewRuntime({ ChartClass, EngineClass }) {
  const prototype = ChartClass?.prototype;
  if (!prototype || typeof prototype.setData !== "function" || typeof prototype.setAnnotations !== "function") {
    throw new TypeError("CandlestickChart class is required");
  }
  if (prototype[PATCH_MARKER]) return;

  const originalSetData = prototype.setData;
  const originalSetAnnotations = prototype.setAnnotations;
  const stateByChart = new WeakMap();

  Object.defineProperty(prototype, PATCH_MARKER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  prototype.setAnnotations = function setAnnotationsWithHierarchy(rows) {
    const state = stateByChart.get(this) ?? {
      baseAnnotations: [],
      snapshotsByTimeframe: null,
      candlesByTimeframe: null,
      tickSize: null,
      viewTimeframe: null,
      endAt: null,
      generation: 0,
      abortController: null,
    };
    state.baseAnnotations = Array.isArray(rows) ? rows : [];
    stateByChart.set(this, state);
    const combined = combineAnnotations(state);
    this.structuralLevelMap = state.levelMap ?? Object.freeze([]);
    return originalSetAnnotations.call(this, combined);
  };

  prototype.setData = function setDataWithHierarchy(candles, meta = {}) {
    const result = originalSetData.call(this, candles, meta);
    const symbol = String(meta?.symbol ?? "").trim().toUpperCase();
    const viewTimeframe = String(meta?.interval ?? "");
    if (!symbol || !INTERVAL_MS[viewTimeframe] || !Array.isArray(candles) || !candles.length) return result;

    const endAtFromUrl = finite(new URL(window.location.href).searchParams.get("endAt"));
    const lastCandle = candles.at(-1);
    const endAt = endAtFromUrl
      ?? finite(lastCandle?.closeTime)
      ?? (finite(lastCandle?.time) ?? Date.now()) + INTERVAL_MS[viewTimeframe] - 1;

    const previous = stateByChart.get(this);
    previous?.abortController?.abort();
    const abortController = new AbortController();
    const state = {
      baseAnnotations: previous?.baseAnnotations ?? [],
      snapshotsByTimeframe: null,
      candlesByTimeframe: null,
      tickSize: null,
      viewTimeframe,
      endAt,
      generation: (previous?.generation ?? 0) + 1,
      abortController,
    };
    const localGeneration = state.generation;
    stateByChart.set(this, state);
    ensureDiagnosticPanel(`DEBUG V4.20 TRACE · ${viewTimeframe} · STATE=LOADING\nsymbol=${symbol} endAt=${endAt}`);

    queueMicrotask(async () => {
      try {
        const loaded = await loadHierarchicalContext({
          symbol,
          viewTimeframe,
          endAt,
          EngineClass,
          signal: abortController.signal,
        });
        const latest = stateByChart.get(this);
        if (!latest || latest.generation !== localGeneration || abortController.signal.aborted) return;
        latest.tickSize = loaded.tickSize;
        latest.snapshotsByTimeframe = loaded.snapshotsByTimeframe;
        latest.candlesByTimeframe = loaded.candlesByTimeframe;
        const extendedViewCandles = loaded.candlesByTimeframe?.[viewTimeframe];
        if (Array.isArray(extendedViewCandles) && extendedViewCandles.length > candles.length) {
          originalSetData.call(this, extendedViewCandles, meta);
        }
        const combined = combineAnnotations(latest);
        this.structuralLevelMap = latest.levelMap ?? Object.freeze([]);
        originalSetAnnotations.call(this, combined);
        this.render?.();
      } catch (error) {
        if (error?.name === "AbortError") return;
        const message = String(error?.message ?? error);
        const context = document.querySelector("#multi-tf-context-status");
        if (context) context.textContent = `Иерархия не загрузилась: ${message}`;
        ensureDiagnosticPanel(`DEBUG V4.20 TRACE · ${viewTimeframe} · STATE=ERROR\nsymbol=${symbol} endAt=${endAt}\n${message}`);
      }
    });

    return result;
  };
}
