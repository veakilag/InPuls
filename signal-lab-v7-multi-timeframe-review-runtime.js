import {
  STRUCTURAL_TF_LOOKBACK_MS,
  buildStructuralLevelMap,
  structuralLevelLabel,
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
const PATCH_MARKER = Symbol.for("inpuls.structural-extremes.multi-tf-review-v1");
const cache = new Map();

const finite = (value) => {
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

  const pages = await Promise.all(windows.map(async (window) => {
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
  }));

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
  const price = finite(row?.a?.price ?? row?.price);
  const extremeAt = finite(row?.a?.time ?? row?.startAt ?? row?.time);
  if (!(price > 0) || extremeAt === null) return null;
  return {
    row,
    side: match[1] === "H" ? "HIGH" : "LOW",
    sourceTimeframe: match[2],
    price,
    extremeAt,
  };
}

function annotationForLevel(level) {
  return {
    type: "segment",
    a: { time: level.extremeAt, price: level.price },
    b: { time: level.endAt, price: level.price },
    label: structuralLevelLabel(level),
    tone: level.side === "HIGH" ? "danger" : "success",
    state: level.status,
    multiTimeframe: true,
    sourceTimeframe: level.sourceTimeframe,
    sources: level.sources,
  };
}

function nearLevel(annotation, level, tickSize) {
  if (!annotation || annotation.side !== level.side) return false;
  const tolerance = Math.max(
    Math.max(0, Number(tickSize) || 0) * 3,
    Math.max(annotation.price, level.price) * 0.03 / 100,
  );
  return Math.abs(annotation.price - level.price) <= tolerance;
}

function addContextStatus(chart, state, levelMap) {
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
  const sources = visibleSourceTimeframes(state.viewTimeframe).join(" + ");
  context.textContent = `Multi-TF: ${sources} · уровней ${levelMap.length} · 1м/5м только последние 24ч`;
}

function combineAnnotations(chart, state) {
  const baseRows = Array.isArray(state.baseAnnotations) ? state.baseAnnotations : [];
  const showExtremes = document.querySelector("#show-extremes")?.checked !== false;
  if (!showExtremes || !state.snapshotsByTimeframe || !state.tickSize) {
    return baseRows;
  }

  const includeHistory = Boolean(document.querySelector("#show-history")?.checked);
  const levelMap = buildStructuralLevelMap({
    snapshotsByTimeframe: state.snapshotsByTimeframe,
    viewTimeframe: state.viewTimeframe,
    endAt: state.endAt,
    includeHistory,
    tickSize: state.tickSize,
  });

  const higherLevels = levelMap.filter((level) => level.sourceTimeframe !== state.viewTimeframe);
  const keptBase = [];
  for (const row of baseRows) {
    const parsed = algorithmAnnotation(row);
    if (!parsed) {
      keptBase.push(row);
      continue;
    }

    if ((parsed.sourceTimeframe === "1m" || parsed.sourceTimeframe === "5m")
      && parsed.extremeAt < state.endAt - 24 * 60 * 60_000) {
      continue;
    }

    const coveredByStronger = higherLevels.some((level) => nearLevel(parsed, level, state.tickSize));
    if (!coveredByStronger) keptBase.push(row);
  }

  const overlays = higherLevels.map(annotationForLevel);
  addContextStatus(chart, state, levelMap);
  return [...keptBase, ...overlays];
}

async function loadMultiTfContext({
  symbol,
  viewTimeframe,
  endAt,
  EngineClass,
  signal,
}) {
  const tickSize = await fetchTickSize(symbol, signal);
  const sourceTimeframes = visibleSourceTimeframes(viewTimeframe);
  const snapshotsByTimeframe = {};

  const higherTimeframes = sourceTimeframes.filter((row) => row !== viewTimeframe);
  await Promise.all(higherTimeframes.map(async (sourceTimeframe) => {
    const candles = await fetchCandles(symbol, sourceTimeframe, endAt, signal);
    if (!candles.length) return;
    const engine = new EngineClass({ symbol, timeframe: sourceTimeframe, tickSize });
    engine.ingestCandles(candles);
    snapshotsByTimeframe[sourceTimeframe] = engine.snapshot();
  }));

  return { tickSize, snapshotsByTimeframe };
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

  prototype.setAnnotations = function setAnnotationsWithMultiTf(rows) {
    const state = stateByChart.get(this) ?? {
      baseAnnotations: [],
      snapshotsByTimeframe: null,
      tickSize: null,
      viewTimeframe: null,
      endAt: null,
      generation: 0,
      abortController: null,
    };
    state.baseAnnotations = Array.isArray(rows) ? rows : [];
    stateByChart.set(this, state);
    return originalSetAnnotations.call(this, combineAnnotations(this, state));
  };

  prototype.setData = function setDataWithMultiTf(candles, meta = {}) {
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
      snapshotsByTimeframe: { [viewTimeframe]: null },
      tickSize: null,
      viewTimeframe,
      endAt,
      generation: (previous?.generation ?? 0) + 1,
      abortController,
    };
    const localGeneration = state.generation;
    stateByChart.set(this, state);

    queueMicrotask(async () => {
      try {
        const loaded = await loadMultiTfContext({
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
        originalSetAnnotations.call(this, combineAnnotations(this, latest));
        this.render?.();
      } catch (error) {
        if (error?.name === "AbortError") return;
        const context = document.querySelector("#multi-tf-context-status");
        if (context) context.textContent = `Multi-TF context error: ${String(error?.message ?? error)}`;
      }
    });

    return result;
  };
}
