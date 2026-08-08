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
  visibleSourceTimeframes,
} from "./signal-lab-v7-multi-timeframe-levels.js";
import { binanceFuturesTickSize } from "./signal-lab-v7-binance-market-metadata.js";

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
  "1m": Object.freeze({
    minimumSwingPercent: 0.08,
    minimumPercent: 0.06,
    atrMultiplier: 0,
    minimumBarsAfterCandidate: 1,
  }),
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
  context.textContent = `Иерархия: ${sources} · уровней ${levelMap.length} · 1д/4ч/1ч: 6 мес · 15м/5м/1м: 1 мес`;
}

function debugNumber(value, digits = 2) {
  const number = finite(value);
  return number === null ? "—" : number.toFixed(digits);
}

function debugPercentRatio(value) {
  const number = finite(value);
  return number === null ? "—" : `${(number * 100).toFixed(1)}%`;
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
    if (!(["1m", "5m"].includes(timeframe)) || level?.active === false) continue;
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
  if (!(["1m", "5m"].includes(timeframe))) return Object.freeze([]);
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

function buildManualEtalonDiagnosticRows(state) {
  const corrections = Array.isArray(window.__INPULS_STRUCTURAL_REVIEW_CORRECTIONS__)
    ? window.__INPULS_STRUCTURAL_REVIEW_CORRECTIONS__
    : [];
  const timeframe = state?.viewTimeframe;
  if (!(["1m", "5m"].includes(timeframe))) return Object.freeze([]);
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

function ensureDiagnosticPanel(message = null) {
  const params = new URL(window.location.href).searchParams;
  const debugEnabled = params.get("debug") === "1";
  let panel = document.querySelector("#structural-level-debug");
  if (!debugEnabled) {
    panel?.remove();
    return null;
  }
  if (!panel) {
    const anchor = document.querySelector("#multi-tf-context-status") ?? document.querySelector("#status");
    if (!anchor) return null;
    panel = document.createElement("pre");
    panel.id = "structural-level-debug";
    panel.style.margin = "8px 0 12px";
    panel.style.padding = "10px";
    panel.style.border = "1px solid rgba(255,255,255,0.14)";
    panel.style.borderRadius = "8px";
    panel.style.background = "rgba(255,255,255,0.035)";
    panel.style.fontSize = "11px";
    panel.style.lineHeight = "1.45";
    panel.style.whiteSpace = "pre-wrap";
    panel.style.userSelect = "text";
    anchor.insertAdjacentElement("afterend", panel);
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
  panel.textContent = [
    `DEBUG V4.19 · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,
    ...localRows.map(formatDiagnosticRow),
    `RAW NATIVE DEBUG · recent ${rawNativeRows.length}`,
    ...rawNativeRows.map(formatRawNativeDiagnosticRow),
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
    ensureDiagnosticPanel(`DEBUG V4.19 · ${viewTimeframe} · STATE=LOADING\nsymbol=${symbol} endAt=${endAt}`);

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
        ensureDiagnosticPanel(`DEBUG V4.19 · ${viewTimeframe} · STATE=ERROR\nsymbol=${symbol} endAt=${endAt}\n${message}`);
      }
    });

    return result;
  };
}
