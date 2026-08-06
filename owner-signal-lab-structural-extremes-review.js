import { CandlestickChart } from "./chart.js?v=26-117-chart-interaction-performance-v1";
import {
  StructuralExtremeEngine,
  STRUCTURAL_EXTREME_STATUSES,
  STRUCTURAL_TIMEFRAMES,
} from "./signal-lab-v7-structural-extremes.js";

const KLINES_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";
const EXCHANGE_INFO_ENDPOINT = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60_000;
const INTERVAL_MS = Object.freeze({
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
});

const elements = {
  symbol: document.querySelector("#symbol"),
  endAt: document.querySelector("#end-at"),
  load: document.querySelector("#load"),
  showExtremes: document.querySelector("#show-extremes"),
  showHistory: document.querySelector("#show-history"),
  showCandidate: document.querySelector("#show-candidate"),
  timeframeButtons: [...document.querySelectorAll("[data-timeframe]")],
  source: document.querySelector("#source"),
  coverage: document.querySelector("#coverage"),
  candlesCount: document.querySelector("#candles-count"),
  direction: document.querySelector("#direction"),
  activeCount: document.querySelector("#active-count"),
  historyCount: document.querySelector("#history-count"),
  status: document.querySelector("#status"),
  canvas: document.querySelector("#chart"),
  tooltip: document.querySelector("#tooltip"),
  currentDiagnostic: document.querySelector("#current-diagnostic"),
  extremeRows: document.querySelector("#extreme-rows"),
};

const chart = new CandlestickChart(elements.canvas, elements.tooltip, { storageKey: null });
chart.setVolumeVisible(true);
chart.setSessionsVisible(true);

let timeframe = "1h";
let current = null;
let generation = 0;
let abortController = null;
const cache = new Map();
const tickSizeCache = new Map();

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function validSymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,20}USDT$/.test(symbol) ? symbol : null;
}

function formatDateTime(timestamp) {
  const value = finite(timestamp);
  if (value === null) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatPercent(value) {
  const number = finite(value);
  return number === null ? "—" : `${number.toFixed(3)}%`;
}

function localDateTimeValue(timestamp) {
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseKline(row, endAt) {
  if (!Array.isArray(row) || row.length < 7) return null;
  const candle = {
    time: finite(row[0]),
    open: finite(row[1]),
    high: finite(row[2]),
    low: finite(row[3]),
    close: finite(row[4]),
    volume: Math.max(0, finite(row[5]) ?? 0),
    closeTime: finite(row[6]),
    closed: finite(row[6]) <= endAt,
  };
  return candle.closed
    && [candle.time, candle.open, candle.high, candle.low, candle.close]
      .every((value) => value !== null && value > 0)
    ? candle
    : null;
}

async function fetchTickSize(symbol, signal) {
  if (tickSizeCache.has(symbol)) return tickSizeCache.get(symbol);
  const url = new URL(EXCHANGE_INFO_ENDPOINT);
  url.searchParams.set("symbol", symbol);
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Binance exchangeInfo HTTP ${response.status}`);
  const payload = await response.json();
  const market = Array.isArray(payload?.symbols) ? payload.symbols[0] : null;
  const filter = (Array.isArray(market?.filters) ? market.filters : [])
    .find((row) => row?.filterType === "PRICE_FILTER");
  const tickSize = finite(filter?.tickSize);
  if (!(tickSize > 0)) throw new Error("Binance не вернул tickSize");
  tickSizeCache.set(symbol, tickSize);
  return tickSize;
}

async function fetchThirtyDays(symbol, selectedTimeframe, endAt, signal) {
  const intervalMs = INTERVAL_MS[selectedTimeframe];
  const startAt = endAt - THIRTY_DAYS_MS;
  const key = `${symbol}:${selectedTimeframe}:${Math.floor(endAt / intervalMs)}`;
  if (cache.has(key)) return structuredClone(cache.get(key));

  const candles = [];
  let cursor = startAt;
  let pages = 0;
  const expected = Math.ceil(THIRTY_DAYS_MS / intervalMs) + 2;
  const maximumPages = Math.min(64, Math.max(2, Math.ceil(expected / 1_500) + 2));
  while (cursor <= endAt && pages < maximumPages && candles.length < 50_500) {
    const url = new URL(KLINES_ENDPOINT);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", selectedTimeframe);
    url.searchParams.set("startTime", String(Math.floor(cursor)));
    url.searchParams.set("endTime", String(Math.floor(endAt)));
    url.searchParams.set("limit", "1500");
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Binance ${selectedTimeframe} klines HTTP ${response.status}`);
    const payload = await response.json();
    const page = (Array.isArray(payload) ? payload : [])
      .map((row) => parseKline(row, endAt))
      .filter(Boolean);
    pages += 1;
    if (!page.length) break;
    for (const row of page) {
      if (row.time < startAt || row.time > endAt) continue;
      if (!candles.length || row.time > candles.at(-1).time) candles.push(row);
    }
    const next = page.at(-1).time + intervalMs;
    if (!(next > cursor)) break;
    cursor = next;
    if (page.length < 1_500) break;
  }
  if (!candles.length) throw new Error("Binance не вернул закрытые свечи");

  const expectedFirst = Math.ceil(startAt / intervalMs) * intervalMs;
  const expectedLast = Math.floor(endAt / intervalMs) * intervalMs;
  const actualFirst = candles[0].time;
  const actualLast = candles.at(-1).time;
  const requestedSpan = Math.max(intervalMs, expectedLast - expectedFirst + intervalMs);
  const coveredSpan = Math.max(
    0,
    Math.min(expectedLast, actualLast) - Math.max(expectedFirst, actualFirst) + intervalMs,
  );
  const result = {
    candles,
    pages,
    startAt,
    endAt,
    coverageRatio: Math.min(1, coveredSpan / requestedSpan),
    complete: actualFirst <= expectedFirst + intervalMs && actualLast >= expectedLast - intervalMs,
  };
  cache.set(key, result);
  while (cache.size > 12) cache.delete(cache.keys().next().value);
  return structuredClone(result);
}

function annotationRows(snapshot) {
  if (!elements.showExtremes.checked || !snapshot) return [];
  const rows = [];
  const source = elements.showHistory.checked ? snapshot.history : snapshot.active;
  for (const extreme of source) {
    if (!elements.showHistory.checked && !extreme.active) continue;
    const endAt = extreme.active
      ? current?.loaded?.endAt
      : extreme.crossedAt ?? current?.loaded?.endAt;
    rows.push({
      type: "segment",
      a: { time: extreme.extremeAt, price: extreme.price },
      b: { time: endAt, price: extreme.price },
      label: `${extreme.side === "HIGH" ? "H" : "L"} ${snapshot.timeframe} · атак ${extreme.touchCount}`,
      tone: extreme.side === "HIGH" ? "danger" : "success",
      state: extreme.status,
    });
  }
  if (elements.showCandidate.checked && snapshot.candidate) {
    rows.push({
      type: "ray",
      startAt: snapshot.candidate.extremeAt,
      price: snapshot.candidate.price,
      label: `${snapshot.candidate.side === "HIGH" ? "H" : "L"} candidate`,
      tone: "warning",
      state: STRUCTURAL_EXTREME_STATUSES.CANDIDATE,
    });
  }
  return rows;
}

function renderDiagnostics(snapshot) {
  elements.direction.textContent = snapshot?.direction ?? "—";
  elements.activeCount.textContent = String(snapshot?.active?.length ?? 0);
  elements.historyCount.textContent = String(snapshot?.history?.length ?? 0);
  elements.currentDiagnostic.textContent = snapshot
    ? JSON.stringify(snapshot.diagnostics, null, 2)
    : "—";

  const rows = [...(snapshot?.history ?? [])].reverse().slice(0, 200);
  elements.extremeRows.replaceChildren(...rows.map((extreme) => {
    const row = document.createElement("tr");
    row.dataset.active = String(Boolean(extreme.active));
    const values = [
      extreme.side,
      String(extreme.price),
      formatDateTime(extreme.extremeAt),
      formatDateTime(extreme.confirmedAt),
      formatPercent(extreme.swingAmplitudePct),
      formatPercent(extreme.confirmingReversalPct),
      formatPercent(extreme.reversalThresholdPct),
      extreme.atrAtConfirmation ?? "—",
      extreme.status,
      extreme.touchCount,
    ];
    row.replaceChildren(...values.map((value) => {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      return cell;
    }));
    return row;
  }));
}

function updateAnnotations() {
  chart.setAnnotations(annotationRows(current?.snapshot));
  renderDiagnostics(current?.snapshot ?? null);
}

async function load() {
  const symbol = validSymbol(elements.symbol.value);
  const endAt = new Date(elements.endAt.value).getTime();
  if (!symbol || !Number.isFinite(endAt)) {
    elements.status.dataset.state = "error";
    elements.status.textContent = "Проверь символ и конец периода.";
    return;
  }
  generation += 1;
  const localGeneration = generation;
  abortController?.abort();
  abortController = new AbortController();
  elements.status.dataset.state = "loading";
  elements.status.textContent = `Загружаю ${symbol} · ${timeframe} · 30 дней закрытых свечей…`;
  elements.load.disabled = true;
  try {
    const [tickSize, loaded] = await Promise.all([
      fetchTickSize(symbol, abortController.signal),
      fetchThirtyDays(symbol, timeframe, endAt, abortController.signal),
    ]);
    if (localGeneration !== generation) return;
    const engine = new StructuralExtremeEngine({ symbol, timeframe, tickSize });
    engine.ingestCandles(loaded.candles);
    const snapshot = engine.snapshot();
    current = { symbol, timeframe, tickSize, loaded, snapshot };

    chart.setData(loaded.candles, {
      symbol,
      interval: timeframe,
      range: "structural-review-30d",
      targetCandles: loaded.candles.length,
    });
    chart.followLatest = false;
    chart.centerLatest = false;
    chart.visibleCount = Math.min(300, loaded.candles.length);
    chart.viewStart = Math.max(0, loaded.candles.length - chart.visibleCount);
    chart.priceScale = 1;
    chart.pricePan = 0;
    chart.fixedPriceDomain = null;
    updateAnnotations();
    chart.render();

    elements.source.textContent = "BINANCE USDⓈ-M FUTURES";
    elements.coverage.textContent = `${(loaded.coverageRatio * 100).toFixed(1)}% · ${loaded.complete ? "COMPLETE" : "PARTIAL"}`;
    elements.candlesCount.textContent = `${loaded.candles.length} · ${loaded.pages} стр.`;
    elements.status.dataset.state = loaded.complete ? "complete" : "error";
    elements.status.textContent = `${symbol} · ${timeframe} · ${formatDateTime(loaded.startAt)} → ${formatDateTime(loaded.endAt)} · новая карта изолирована от боевых сигналов.`;
  } catch (error) {
    if (error?.name === "AbortError") return;
    elements.status.dataset.state = "error";
    elements.status.textContent = `Не удалось загрузить проверку: ${String(error?.message ?? error)}`;
  } finally {
    if (localGeneration === generation) elements.load.disabled = false;
  }
}

for (const button of elements.timeframeButtons) {
  button.addEventListener("click", () => {
    const next = button.dataset.timeframe;
    if (!STRUCTURAL_TIMEFRAMES.includes(next) || next === timeframe) return;
    timeframe = next;
    elements.timeframeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    load();
  });
}

elements.load.addEventListener("click", load);
elements.showExtremes.addEventListener("change", updateAnnotations);
elements.showHistory.addEventListener("change", updateAnnotations);
elements.showCandidate.addEventListener("change", updateAnnotations);
window.addEventListener("beforeunload", () => chart.destroy(), { once: true });

elements.endAt.value = localDateTimeValue(Date.now() - 5 * 60_000);
load();
