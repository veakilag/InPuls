from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise RuntimeError(f"missing pattern in {path}: {old[:180]!r}")
    write(path, text.replace(old, new, 1))


# Shared main-site orderbook runtime styles are now explicitly reusable by Replay.
replace_once(
    "orderbook.js",
    "function installOrderBookStyles() {",
    "export function installOrderBookStyles() {",
)

# Knife and sharpening: strictly greater than 1%, never exactly 1.00%.
replace_once(
    "signal-lab-v3-candidates.js",
    'export const SIGNAL_LAB_V3_FORMULA_VERSION = "signal-lab-v3-four-patterns-v1-2026-08";',
    'export const SIGNAL_LAB_V3_FORMULA_VERSION = "signal-lab-v5-patterns-v1-2026-08";',
)
replace_once(
    "signal-lab-v3-candidates.js",
    "  reversalMinimumRecoveryPercent: 0.12,\n",
    "  reversalMinimumRecoveryPercent: 0.12,\n  reversalMinimumImpulsePercent: 1,\n",
)
replace_once(
    "signal-lab-v3-candidates.js",
    "    || impulse < thresholds.strongMove\n",
    "    || impulse <= settings.reversalMinimumImpulsePercent\n    || impulse < thresholds.strongMove\n",
)
replace_once(
    "signal-lab-v3-candidates.js",
    "    impulsePercent: impulse,\n    recoveryPercent: recovery,\n",
    "    impulsePercent: impulse,\n    requiredImpulsePercent: settings.reversalMinimumImpulsePercent,\n    impulseThresholdMode: \"STRICT_GREATER_THAN\",\n    recoveryPercent: recovery,\n",
)
replace_once(
    "signal-lab-v3-candidates.js",
    "        `вынос вниз ${formatPercent(-downReversal.impulsePercent)}`,\n",
    "        `вынос вниз ${formatPercent(-downReversal.impulsePercent)} · порог строго >${downReversal.requiredImpulsePercent.toFixed(2)}%`,\n",
)
replace_once(
    "signal-lab-v3-candidates.js",
    "        `вынос вверх ${formatPercent(upReversal.impulsePercent)}`,\n",
    "        `вынос вверх ${formatPercent(upReversal.impulsePercent)} · порог строго >${upReversal.requiredImpulsePercent.toFixed(2)}%`,\n",
)

# Full 30-day candles: strict requested coverage and explicit metadata.
chart_path = "signal-lab-v3-full-chart.js"
text = read(chart_path)
start = text.index("function episodeHistoryBounds(")
end = text.index("function fillAnnotationList(", start)
new_loader = r'''export function episodeHistoryBounds(eventAt, intervalMs, contextMs) {
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
  const expectedFirstOpen = Math.floor(requestedFrom / interval) * interval;
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

'''
write(chart_path, text[:start] + new_loader + text[end:])
replace_once(
    chart_path,
    '''    const structural = String(episode?.candidateType ?? "").includes("cascade")
      || String(episode?.candidateType ?? "").includes("level_break");
    this.interval = structural ? "1h" : "1m";
    this.contextRange = structural ? "30d" : "15m";''',
    '''    this.interval = "1h";
    this.contextRange = "30d";''',
)
replace_once(
    chart_path,
    '''    this.card.querySelector('[data-chart-action="reset"]')?.addEventListener("click", () => {
      this.#focusEvent();
    });''',
    '''    this.card.querySelector('[data-chart-action="reset"]')?.addEventListener("click", () => {
      this.#focusEvent();
    });
    this.card.querySelector('[data-chart-action="fit"]')?.addEventListener("click", () => {
      this.#fitRange();
    });''',
)
replace_once(
    chart_path,
    '''      const candles = await loadEpisodeCandles(this.episode, this.interval, this.contextRange, {
        signal: this.abortController.signal,
      });
      if (!this.opened || generation !== this.generation || !this.chart) return;
      this.chart.setData(candles, {
        symbol: this.episode.symbol,
        interval: this.interval,
        range: `episode-${this.contextRange}`,
        targetCandles: candles.length,
      });
      this.chart.setAnnotations(this.annotationToggle?.checked === false ? [] : this.annotations);
      this.#focusEvent(candles);
      const source = this.interval.endsWith("s") ? "Evidence Pack" : "Binance Futures klines";
      this.status.textContent = `${source} · ${candles.length} свечей · колесо: масштаб · drag: перемещение · двойной клик: сброс`;''',
    '''      const loaded = await loadEpisodeCandles(this.episode, this.interval, this.contextRange, {
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
      this.status.textContent = `${coverage?.source ?? "UNKNOWN"} · ${candles.length} свечей · покрытие ${actualDays.toFixed(1)}/${requestedDays.toFixed(1)}д (${percent}%) · ${coverage?.complete ? "COMPLETE" : "PARTIAL"} · страниц ${coverage?.pages ?? 0}`;''',
)
insert_marker = "\n  #focusEvent(candles = this.chart?.candles ?? []) {"
fit_method = r'''
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
'''
text = read(chart_path)
if insert_marker not in text:
    raise RuntimeError("missing focus method marker")
write(chart_path, text.replace(insert_marker, fit_method + insert_marker, 1))

# Recorder V2: depth + RAW shadow trade, continuous coverage and reconnect jitter.
recorder = "signal-lab-v4-orderflow-recorder.js"
replace_once(
    recorder,
    'export const SIGNAL_LAB_V4_ORDERFLOW_VERSION = "signal-lab-v4-orderflow-replay-v1-2026-08";',
    'export const SIGNAL_LAB_V4_ORDERFLOW_VERSION = "signal-lab-v5-orderflow-replay-v2-2026-08";',
)
replace_once(
    recorder,
    "const DEFAULT_CHECKPOINT_MS = 5_000;",
    "const DEFAULT_CHECKPOINT_MS = 15_000;",
)
raw_normalizer = r'''
export function normalizeRawTrade(payload, receivedAt = Date.now()) {
  const data = payload?.data ?? payload;
  const symbol = normalizeSymbol(data?.s);
  const price = finite(data?.p);
  const quantity = finite(data?.q);
  const eventTime = finite(data?.E) ?? receivedAt;
  const tradeTime = finite(data?.T) ?? eventTime;
  if (data?.e !== "trade" || !symbol || !(price > 0) || !(quantity > 0)) return null;
  return Object.freeze({
    id: String(data?.t ?? `${tradeTime}:${price}:${quantity}`),
    symbol,
    eventTime,
    tradeTime,
    receivedAt,
    price,
    quantity,
    quote: price * quantity,
    side: data?.m ? "sell" : "buy",
    source: "RAW_SHADOW",
  });
}

'''
text = read(recorder)
marker = "function createSymbolState(symbol) {"
if marker not in text:
    raise RuntimeError("missing raw normalizer marker")
write(recorder, text.replace(marker, raw_normalizer + marker, 1))
replace_once(
    recorder,
    "    trades: [],\n    checkpoints: [],",
    "    trades: [],\n    rawTrades: [],\n    aggTradeIds: new Set(),\n    rawTradeIds: new Set(),\n    checkpoints: [],",
)
replace_once(
    recorder,
    "      trades: 0,\n      checkpoints: 0,",
    "      trades: 0,\n      rawTrades: 0,\n      checkpoints: 0,",
)
replace_once(
    recorder,
    "      trades: 0,\n      checkpoints: 0,\n      gaps: 0,",
    "      trades: 0,\n      rawTrades: 0,\n      checkpoints: 0,\n      gaps: 0,",
)
replace_once(
    recorder,
    '''    state.trades.push(trade);
    state.firstObservedAt = state.firstObservedAt === null''',
    '''    if (state.aggTradeIds.has(trade.id)) return trade;
    state.aggTradeIds.add(trade.id);
    state.trades.push(trade);
    state.firstObservedAt = state.firstObservedAt === null''',
)
raw_ingest_marker = "\n  capture(symbol, from, to = Date.now()) {"
raw_ingest = r'''
  ingestRawTrade(payload, receivedAt = Date.now()) {
    const trade = normalizeRawTrade(payload, receivedAt);
    if (!trade) return null;
    const state = this.states.get(trade.symbol);
    if (!state || !this.symbols.includes(trade.symbol) || state.rawTradeIds.has(trade.id)) return trade;
    state.rawTradeIds.add(trade.id);
    state.rawTrades.push(trade);
    state.firstObservedAt = state.firstObservedAt === null
      ? trade.tradeTime
      : Math.min(state.firstObservedAt, trade.tradeTime);
    state.lastObservedAt = Math.max(state.lastObservedAt ?? 0, trade.tradeTime);
    this.#trim(state, receivedAt);
    this.#publish({ rawTrades: this.statusState.rawTrades + 1 });
    return trade;
  }
'''
text = read(recorder)
if raw_ingest_marker not in text:
    raise RuntimeError("missing raw ingest marker")
write(recorder, text.replace(raw_ingest_marker, "\n" + raw_ingest + raw_ingest_marker, 1))
replace_once(
    recorder,
    "    const trades = state.trades.filter((row) => row.tradeTime >= requestedFrom && row.tradeTime <= requestedTo);\n",
    "    const trades = state.trades.filter((row) => row.tradeTime >= requestedFrom && row.tradeTime <= requestedTo);\n    const rawTrades = state.rawTrades.filter((row) => row.tradeTime >= requestedFrom && row.tradeTime <= requestedTo);\n",
)
replace_once(
    recorder,
    "      trades: clone(trades),\n      qualityEvents: clone(qualityEvents),",
    "      trades: clone(trades),\n      rawTrades: clone(rawTrades),\n      qualityEvents: clone(qualityEvents),",
)
replace_once(
    recorder,
    '''        state: state.state,
        gaps: state.gapCount,
        recoveries: state.recoveredCount,''',
    '''        state: state.state,
        gaps: state.gapCount,
        recoveries: state.recoveredCount,
        depthContinuous: !qualityEvents.some((row) => ["GAP", "ERROR", "STALE"].includes(row.state)),
        preEventComplete: Number.isFinite(earliest) && earliest <= requestedFrom
          && !qualityEvents.some((row) => ["GAP", "ERROR", "STALE"].includes(row.state)),
        aggTrades: trades.length,
        rawTrades: rawTrades.length,
        rawMode: rawTrades.length ? "SHADOW_RECORDED" : "NOT_RECORDED",''',
)
replace_once(
    recorder,
    '    const streams = this.symbols.map((symbol) => `${symbol.toLowerCase()}@depth@100ms`);',
    '    const streams = this.symbols.flatMap((symbol) => [\n      `${symbol.toLowerCase()}@depth@100ms`,\n      `${symbol.toLowerCase()}@trade`,\n    ]);',
)
replace_once(
    recorder,
    '''      const receivedAt = Date.now();
      const diff = normalizeDepthDiff(payload, receivedAt);
      if (!diff) return;
      clearTimeout(this.watchdogTimer);
      this.#ingestDiff(diff, generation);
      this.#publish({
        connection: "live",
        packets: this.statusState.packets + 1,
        lastMessageAt: receivedAt,
        lastError: null,
      });''',
    '''      const receivedAt = Date.now();
      const data = payload?.data ?? payload;
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = setTimeout(() => {
        if (generation !== this.generation || this.manualClose) return;
        this.#publish({ connection: "stale", lastError: "order flow не обновлялся 15 секунд" });
        socket.close();
      }, 15_000);
      if (data?.e === "trade") {
        this.ingestRawTrade(payload, receivedAt);
        this.#publish({
          connection: "live",
          packets: this.statusState.packets + 1,
          lastMessageAt: receivedAt,
          lastError: null,
        });
        return;
      }
      const diff = normalizeDepthDiff(payload, receivedAt);
      if (!diff) return;
      this.#ingestDiff(diff, generation);
      this.#publish({
        connection: "live",
        packets: this.statusState.packets + 1,
        lastMessageAt: receivedAt,
        lastError: null,
      });''',
)
replace_once(
    recorder,
    "      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));",
    "      const baseDelay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));\n      const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));",
)
replace_once(
    recorder,
    '''    trimRows(state.trades, cutoff, "tradeTime");
    trimRows(state.qualityEvents, cutoff, "at");''',
    '''    trimRows(state.trades, cutoff, "tradeTime");
    trimRows(state.rawTrades, cutoff, "tradeTime");
    state.aggTradeIds = new Set(state.trades.map((row) => row.id));
    state.rawTradeIds = new Set(state.rawTrades.map((row) => row.id));
    trimRows(state.qualityEvents, cutoff, "at");''',
)

# Evidence packs preserve the original prebuffer while appending post-event order flow.
evidence = "signal-lab-v3-evidence.js"
replace_once(
    evidence,
    'export const SIGNAL_LAB_V3_EVIDENCE_VERSION = "signal-lab-v4-cascade-stage3-2026-08";',
    'export const SIGNAL_LAB_V3_EVIDENCE_VERSION = "signal-lab-v5-orderflow-candles-2026-08";',
)
merge_helper = r'''
function mergeReplayRows(left, right, key) {
  const rows = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])];
  const seen = new Map();
  for (const row of rows) {
    const value = key(row);
    if (value === null || value === undefined) continue;
    seen.set(String(value), row);
  }
  return [...seen.values()].sort((a, b) => (
    (finite(a?.at ?? a?.tradeTime) ?? 0) - (finite(b?.at ?? b?.tradeTime) ?? 0)
  ));
}

export function mergeOrderFlowReplay(previous, incoming, tickSize = null) {
  if (!previous) return incoming ? { ...clone(incoming), tickSize: finite(tickSize) } : null;
  if (!incoming) return previous;
  const initial = finite(previous?.initialCheckpoint?.at) <= finite(incoming?.initialCheckpoint?.at)
    ? previous.initialCheckpoint
    : incoming.initialCheckpoint;
  const events = mergeReplayRows(previous.events, incoming.events, (row) => `${row.U}:${row.u}:${row.at}`);
  const trades = mergeReplayRows(previous.trades, incoming.trades, (row) => row.id);
  const rawTrades = mergeReplayRows(previous.rawTrades, incoming.rawTrades, (row) => row.id);
  const checkpoints = mergeReplayRows(previous.checkpoints, incoming.checkpoints, (row) => `${row.at}:${row.lastUpdateId}`);
  const qualityEvents = mergeReplayRows(previous.qualityEvents, incoming.qualityEvents, (row) => `${row.at}:${row.state}:${row.reason ?? ""}`);
  const requestedFrom = Math.min(finite(previous.requestedFrom) ?? Infinity, finite(incoming.requestedFrom) ?? Infinity);
  const requestedTo = Math.max(finite(previous.requestedTo) ?? 0, finite(incoming.requestedTo) ?? 0);
  const badQuality = qualityEvents.some((row) => ["GAP", "ERROR", "STALE"].includes(row.state));
  const availableFrom = Math.min(
    finite(initial?.at) ?? Infinity,
    finite(events[0]?.at) ?? Infinity,
    finite(trades[0]?.tradeTime) ?? Infinity,
    finite(rawTrades[0]?.tradeTime) ?? Infinity,
  );
  return {
    ...clone(previous),
    ...clone(incoming),
    requestedFrom,
    requestedTo,
    initialCheckpoint: clone(initial),
    checkpoints,
    events,
    trades,
    rawTrades,
    qualityEvents,
    tickSize: finite(tickSize) ?? finite(incoming.tickSize) ?? finite(previous.tickSize),
    coverage: {
      ...clone(previous.coverage ?? {}),
      ...clone(incoming.coverage ?? {}),
      availableFrom: Number.isFinite(availableFrom) ? availableFrom : null,
      preSeconds: Number.isFinite(availableFrom)
        ? Math.max(0, Math.round((Math.min(requestedTo, finite(previous?.coverage?.eventAt) ?? requestedTo) - Math.max(requestedFrom, availableFrom)) / 1_000))
        : 0,
      depthContinuous: !badQuality,
      preEventComplete: Number.isFinite(availableFrom) && availableFrom <= requestedFrom && !badQuality,
      aggTrades: trades.length,
      rawTrades: rawTrades.length,
      rawMode: rawTrades.length ? "SHADOW_RECORDED" : "NOT_RECORDED",
    },
  };
}

'''
text = read(evidence)
marker = "function normalizePricePoints(metrics, from, to) {"
if marker not in text:
    raise RuntimeError("missing evidence merge marker")
write(evidence, text.replace(marker, merge_helper + marker, 1))
replace_once(
    evidence,
    '      bookMode: orderFlowReplay ? "snapshot+diff@100ms+aggTrade" : "sampled-depth20-top8@1s",',
    '      bookMode: orderFlowReplay ? "shared-main-widget:snapshot+diff@100ms+aggTrade+raw-shadow" : "sampled-depth20-top8@1s",',
)
replace_once(
    evidence,
    '''      pack.orderFlowReplay = this.orderFlowRecorder.capture(
        session.episode.symbol,
        pack.window.eventAt - this.preEventMs,
        now,
      );
      if (pack.orderFlowReplay) pack.bookMode = "snapshot+diff@100ms+aggTrade";''',
    '''      const incomingReplay = this.orderFlowRecorder.capture(
        session.episode.symbol,
        pack.window.eventAt - this.preEventMs,
        now,
      );
      pack.orderFlowReplay = mergeOrderFlowReplay(
        pack.orderFlowReplay,
        incomingReplay,
        metrics?.tickSize,
      );
      if (pack.orderFlowReplay) pack.bookMode = "shared-main-widget:snapshot+diff@100ms+aggTrade+raw-shadow";''',
)
replace_once(
    evidence,
    "      rawTrades: pack.orderFlowReplay?.trades?.length ?? 0,\n      depthDiffs:",
    "      aggTrades: pack.orderFlowReplay?.trades?.length ?? 0,\n      rawTrades: pack.orderFlowReplay?.rawTrades?.length ?? 0,\n      orderFlowPreComplete: Boolean(pack.orderFlowReplay?.coverage?.preEventComplete),\n      orderFlowContinuous: Boolean(pack.orderFlowReplay?.coverage?.depthContinuous),\n      depthDiffs:",
)

# Replay controller mounts the heavy shared widget lazily, only on explicit Replay interaction.
replay_ui = "signal-lab-v3-replay-ui.js"
replace_once(
    replay_ui,
    'import { mountSignalLabV4OrderFlowPanel } from "./signal-lab-v4-orderflow-replay.js?v=signal-lab-v4-stage1";',
    'import { mountSignalLabV4OrderFlowPanel } from "./signal-lab-v4-orderflow-replay.js?v=signal-lab-v5-shared-orderbook";',
)
replace_once(
    replay_ui,
    '''  const book = card.querySelector('[data-field="book"]');
  const slider = card.querySelector('[data-field="replay-slider"]');''',
    '''  const book = card.querySelector('[data-field="book"]');
  const workspace = card.querySelector('[data-field="orderbook-workspace"]');
  const slider = card.querySelector('[data-field="replay-slider"]');''',
)
replace_once(
    replay_ui,
    "  if (!book || !slider || !replayTime || !play) return;",
    "  if ((!book && !workspace) || !slider || !replayTime || !play) return;",
)
replace_once(
    replay_ui,
    '''    book.replaceChildren();
    const empty = document.createElement("div");''',
    '''    const emptyTarget = workspace ?? book;
    emptyTarget.replaceChildren();
    const empty = document.createElement("div");''',
)
replace_once(
    replay_ui,
    "    book.append(empty);",
    "    emptyTarget.append(empty);",
)
replace_once(
    replay_ui,
    '''  let timer = null;
  const orderFlowPanel = pack?.orderFlowReplay
    ? mountSignalLabV4OrderFlowPanel(card, pack.orderFlowReplay)
    : null;''',
    '''  let timer = null;
  let orderFlowPanel = null;
  const ensureOrderFlowPanel = () => {
    if (!orderFlowPanel && pack?.orderFlowReplay) {
      orderFlowPanel = mountSignalLabV4OrderFlowPanel(card, pack.orderFlowReplay);
    }
    return orderFlowPanel;
  };
  if (workspace) {
    workspace.innerHTML = '<div class="signal-lab-orderbook-placeholder">Полный стакан InPuls загрузится после нажатия «Replay стакана». Это сохраняет отзывчивость списка.</div>';
  }''',
)
replace_once(
    replay_ui,
    '''  const render = () => {
    const selectedAt = startAt + Number(slider.value) * 1_000;
    if (orderFlowPanel) orderFlowPanel.render(selectedAt);
    else renderBook(book, pack, selectedAt);''',
    '''  const render = ({ mountOrderFlow = false } = {}) => {
    const selectedAt = startAt + Number(slider.value) * 1_000;
    const panel = mountOrderFlow ? ensureOrderFlowPanel() : orderFlowPanel;
    if (panel) panel.render(selectedAt);
    else if (book) renderBook(book, pack, selectedAt);''',
)
replace_once(
    replay_ui,
    '''    coverage.textContent = orderFlowPanel
      ? `Свечи: контекст до 30 дней · order flow: ${pack.coverage?.orderFlowPreSeconds ?? 0}с до · ${pack.coverage?.orderFlowState ?? "not-recorded"} · ${pack.coverage?.depthDiffs ?? 0} diff · ${pack.coverage?.rawTrades ?? 0} aggTrade`''',
    '''    coverage.textContent = pack?.orderFlowReplay
      ? `Свечи: проверяемое покрытие 30 дней · order flow: ${pack.coverage?.orderFlowPreSeconds ?? 0}с до · ${pack.coverage?.orderFlowPreComplete ? "PRE COMPLETE" : "PRE PARTIAL"} · ${pack.coverage?.orderFlowState ?? "not-recorded"} · ${pack.coverage?.depthDiffs ?? 0} diff · ${pack.coverage?.aggTrades ?? 0} AGG · ${pack.coverage?.rawTrades ?? 0} RAW`''',
)
replace_once(
    replay_ui,
    '  slider.addEventListener("input", render);',
    '  slider.addEventListener("input", () => render({ mountOrderFlow: true }));',
)
replace_once(
    replay_ui,
    '''  play.addEventListener("click", () => {
    if (timer) {''',
    '''  play.addEventListener("click", () => {
    ensureOrderFlowPanel();
    if (timer) {''',
)
replace_once(
    replay_ui,
    "      render();\n    }, 350);",
    "      render({ mountOrderFlow: true });\n    }, 350);",
)

# Owner page: same stylesheet, shared replay mount, visible 30-day fit control and V5 wording.
owner = "owner-signal-lab-v3.html"
replace_once(owner, "<title>InPuls — Owner Signal Lab V4</title>", "<title>InPuls — Owner Signal Lab V5</title>")
replace_once(
    owner,
    '    <link rel="icon" href="./icon.svg" type="image/svg+xml" />\n',
    '    <link rel="icon" href="./icon.svg" type="image/svg+xml" />\n    <link rel="stylesheet" href="./styles.css?v=signal-lab-v5-shared-orderbook" />\n',
)
replace_once(
    owner,
    '    <link rel="stylesheet" href="./owner-signal-lab-v4-calibration.css?v=signal-lab-v4-stage4" />',
    '    <link rel="stylesheet" href="./owner-signal-lab-v4-calibration.css?v=signal-lab-v4-stage4" />\n    <link rel="stylesheet" href="./signal-lab-v5-orderbook.css?v=signal-lab-v5-shared-orderbook" />',
)
replace_once(owner, "InPuls Owner Signal Lab V4", "InPuls Owner Signal Lab V5")
replace_once(owner, "OWNER SIGNAL LAB V4", "OWNER SIGNAL LAB V5")
replace_once(owner, "V4 · АКТИВНЫЕ ЭКСТРЕМУМЫ · 30 ДНЕЙ · ORDER FLOW REPLAY", "V5 · ВЫНОС >1% · ПОЛНЫЕ 30 ДНЕЙ · ОСНОВНОЙ СТАКАН INPULS")
replace_once(
    owner,
    "          Система заранее фиксирует SETUP, затем отдельно TRIGGERED, CONFIRMED, EXTENDED, PARTIAL и FAILED.\n",
    "          Система заранее фиксирует SETUP, затем отдельно TRIGGERED, CONFIRMED, EXTENDED, PARTIAL и FAILED. Нож и заточка существуют только после предшествующего выноса строго больше 1%.\n",
)
replace_once(
    owner,
    '<button type="button" data-chart-action="reset">К эпизоду</button>',
    '<button type="button" data-chart-action="reset">К эпизоду</button>\n                <button type="button" data-chart-action="fit">Весь диапазон 30д</button>',
)
text = read(owner)
flow_start = text.index('            <div class="orderflow-toolbar">')
flow_end = text.index('            <p class="book-warning">', flow_start)
replacement = '            <div data-field="orderbook-workspace" class="signal-lab-orderbook-workspace"></div>\n'
write(owner, text[:flow_start] + replacement + text[flow_end:])
replace_once(
    owner,
    './owner-signal-lab-v3.js?v=signal-lab-v4-performance-1',
    './owner-signal-lab-v3.js?v=signal-lab-v5-rebuild-1',
)

# Cache contracts for the rebuilt modules.
owner_js = "owner-signal-lab-v3.js"
for old, new in [
    ("signal-lab-v3-candidates.js?v=signal-lab-v4-stage3", "signal-lab-v3-candidates.js?v=signal-lab-v5-patterns-1"),
    ("signal-lab-v3-collector.js?v=signal-lab-v4-performance-1", "signal-lab-v3-collector.js?v=signal-lab-v5-rebuild-1"),
    ("signal-lab-v3-replay-ui.js?v=signal-lab-v4-stage1", "signal-lab-v3-replay-ui.js?v=signal-lab-v5-rebuild-1"),
    ("signal-lab-v3-full-chart.js?v=signal-lab-v4-stage3", "signal-lab-v3-full-chart.js?v=signal-lab-v5-candles-1"),
]:
    replace_once(owner_js, old, new)

collector = "signal-lab-v3-collector.js"
replace_once(
    collector,
    'signal-lab-v3-candidates.js?v=signal-lab-v3-four-patterns-v1',
    'signal-lab-v3-candidates.js?v=signal-lab-v5-patterns-1',
)
replace_once(
    collector,
    'signal-lab-v3-evidence.js?v=signal-lab-v4-stage2',
    'signal-lab-v3-evidence.js?v=signal-lab-v5-orderflow-1',
)
replace_once(
    collector,
    'signal-lab-v4-orderflow-recorder.js?v=signal-lab-v4-stage1',
    'signal-lab-v4-orderflow-recorder.js?v=signal-lab-v5-orderflow-v2',
)

# Correct aggregateTradePath call in the shared Replay renderer.
replay = "signal-lab-v4-orderflow-replay.js"
replace_once(
    replay,
    "  const path = aggregateTradePath(visible, 220);\n  const prices = visible.map((trade) => trade.price);",
    "  const prices = visible.map((trade) => trade.price);",
)
replace_once(
    replay,
    "  const range = Math.max(high - low, high * 0.0001, Number.EPSILON);\n",
    "  const range = Math.max(high - low, high * 0.0001, Number.EPSILON);\n  const path = aggregateTradePath(visible, minimumQuote, Math.max(Number.EPSILON, range / 120), 220, 250);\n",
)

# Tests added by this stage.
Path("test/signal-lab-v5-rebuild.test.js").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  detectExpertCandidates,
  SIGNAL_LAB_V3_FORMULA_VERSION,
} from "../signal-lab-v3-candidates.js";
import {
  buildCandleCoverage,
  episodeHistoryBounds,
  EPISODE_CONTEXT_RANGES,
} from "../signal-lab-v3-full-chart.js";
import {
  normalizeRawTrade,
  SIGNAL_LAB_V4_ORDERFLOW_VERSION,
} from "../signal-lab-v4-orderflow-recorder.js";
import { mergeOrderFlowReplay } from "../signal-lab-v3-evidence.js";

function reversalMetrics(extremePrice, currentPrice, side = "down") {
  const now = 100_000;
  const origin = 100;
  const before = side === "down"
    ? [origin, 99.95, 99.9, 99.8, 99.7]
    : [origin, 100.05, 100.1, 100.2, 100.3];
  return {
    now,
    metrics: {
      symbol: "TESTUSDT",
      price: currentPrice,
      updatedAt: now,
      warmupSeconds: 60,
      quoteVolume24h: 200_000_000,
      natr5m: 1,
      priceHistory: [
        ...before.map((price, index) => ({ at: 40_000 + index * 8_000, price })),
        { at: 90_000, price: extremePrice },
      ],
      minuteCandles: [],
      trades: {},
      liquidation: {},
    },
  };
}

test("knife and sharpening reject exactly 1.00 percent impulse", () => {
  const down = reversalMetrics(99, 99.2, "down");
  const up = reversalMetrics(101, 100.8, "up");
  assert.equal(detectExpertCandidates(down.metrics, down.now).some((row) => row.candidateType === "down_reversal_attempt"), false);
  assert.equal(detectExpertCandidates(up.metrics, up.now).some((row) => row.candidateType === "up_reversal_attempt"), false);
});

test("knife and sharpening accept impulse strictly above 1 percent", () => {
  const down = reversalMetrics(98.99, 99.2, "down");
  const up = reversalMetrics(101.01, 100.8, "up");
  const knife = detectExpertCandidates(down.metrics, down.now).find((row) => row.candidateType === "down_reversal_attempt");
  const sharpening = detectExpertCandidates(up.metrics, up.now).find((row) => row.candidateType === "up_reversal_attempt");
  assert.ok(knife);
  assert.ok(sharpening);
  assert.equal(knife.evidence.impulseThresholdMode, "STRICT_GREATER_THAN");
  assert.equal(sharpening.evidence.requiredImpulsePercent, 1);
  assert.match(SIGNAL_LAB_V3_FORMULA_VERSION, /signal-lab-v5/);
});

test("30 day bounds end at the event candle and request the whole prior month", () => {
  const eventAt = Date.UTC(2026, 7, 5, 12, 0, 0);
  const bounds = episodeHistoryBounds(eventAt, 3_600_000, EPISODE_CONTEXT_RANGES["30d"]);
  assert.equal(bounds.startTime, eventAt - 30 * 86_400_000);
  assert.equal(bounds.coverageEndTime, eventAt);
  assert.equal(bounds.mode, "THIRTY_DAYS_BEFORE_EVENT");
});

test("candle coverage reports complete only when both ends are present", () => {
  const intervalMs = 60_000;
  const startTime = 1_000_000;
  const coverageEndTime = startTime + 10 * intervalMs;
  const completeRows = Array.from({ length: 11 }, (_, index) => ({ time: startTime + index * intervalMs }));
  const complete = buildCandleCoverage(completeRows, { startTime, endTime: coverageEndTime, coverageEndTime, intervalMs, pages: 1 });
  const partial = buildCandleCoverage(completeRows.slice(3), { startTime, endTime: coverageEndTime, coverageEndTime, intervalMs, pages: 1 });
  assert.equal(complete.complete, true);
  assert.equal(complete.ratio, 1);
  assert.equal(partial.complete, false);
  assert.ok(partial.ratio < 1);
});

test("RAW shadow trade is stored separately from AGG", () => {
  const trade = normalizeRawTrade({ e: "trade", s: "TESTUSDT", t: 7, p: "100", q: "2", T: 50, E: 49, m: true }, 55);
  assert.equal(trade.source, "RAW_SHADOW");
  assert.equal(trade.side, "sell");
  assert.equal(trade.quote, 200);
  assert.match(SIGNAL_LAB_V4_ORDERFLOW_VERSION, /v2/);
});

test("order flow merge preserves the original prebuffer and appends post-event packets", () => {
  const checkpoint = { at: 1_000, lastUpdateId: 1, bids: [[99, 1]], asks: [[101, 1]], state: "LIVE" };
  const previous = {
    requestedFrom: 1_000,
    requestedTo: 3_000,
    initialCheckpoint: checkpoint,
    checkpoints: [checkpoint],
    events: [{ at: 2_000, U: 2, u: 2, bids: [], asks: [], state: "LIVE" }],
    trades: [{ id: "a", tradeTime: 2_100 }],
    rawTrades: [{ id: "r1", tradeTime: 2_200 }],
    qualityEvents: [],
    coverage: {},
  };
  const incoming = {
    requestedFrom: 2_000,
    requestedTo: 6_000,
    initialCheckpoint: { ...checkpoint, at: 2_000, lastUpdateId: 2 },
    checkpoints: [],
    events: [{ at: 5_000, U: 3, u: 3, bids: [], asks: [], state: "LIVE" }],
    trades: [{ id: "b", tradeTime: 5_100 }],
    rawTrades: [{ id: "r2", tradeTime: 5_200 }],
    qualityEvents: [],
    coverage: {},
  };
  const merged = mergeOrderFlowReplay(previous, incoming, .01);
  assert.equal(merged.initialCheckpoint.at, 1_000);
  assert.equal(merged.events.length, 2);
  assert.equal(merged.trades.length, 2);
  assert.equal(merged.rawTrades.length, 2);
  assert.equal(merged.requestedTo, 6_000);
  assert.equal(merged.tickSize, .01);
});

test("owner page mounts one shared main-site orderbook lazily", () => {
  const page = fs.readFileSync(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
  const replay = fs.readFileSync(new URL("../signal-lab-v4-orderflow-replay.js", import.meta.url), "utf8");
  const replayUi = fs.readFileSync(new URL("../signal-lab-v3-replay-ui.js", import.meta.url), "utf8");
  assert.match(page, /styles\.css\?v=signal-lab-v5-shared-orderbook/);
  assert.match(page, /data-field="orderbook-workspace"/);
  assert.match(page, /Весь диапазон 30д/);
  assert.match(replay, /class="orderbook-card signal-lab-replay-card"/);
  assert.match(replay, /buildDepthLadder/);
  assert.match(replay, /bookScaleIndexForWheel/);
  assert.match(replay, /RAW/);
  assert.match(replayUi, /ensureOrderFlowPanel/);
  assert.match(replayUi, /после нажатия «Replay стакана»/);
});
''', encoding="utf-8")

Path("docs/signal-lab-v5-rebuild.md").write_text(r'''# Signal Lab V5 rebuild

## Locked pattern rule

Knife and sharpening require a preceding impulse strictly greater than 1.00%. Equality is rejected. The evidence pack stores the measured impulse, required threshold and `STRICT_GREATER_THAN` mode. Formula version: `signal-lab-v5-patterns-v1-2026-08`.

## Candles

The `30d` range requests the complete thirty-day interval before the event and includes the event candle. Binance klines are loaded page by page. The UI reports requested days, actual days, ratio, page count and `COMPLETE/PARTIAL`; partial fallback data is never labelled as a complete month. Default view is 1h/30d to keep the browser responsive, with lower timeframes loaded only after explicit selection.

## Order-flow Replay

Signal Lab uses the main InPuls orderbook DOM classes, styles, price-step rules, ladder projection, liquidity scaling, manual-scroll behavior and Ctrl+wheel scale sequence ×1…×1000. The heavy workspace is mounted only after explicit Replay interaction.

Recorder V2 keeps Binance Futures REST snapshot + depth@100ms diff sequence U/u/pu, checkpoints, quality transitions, AGG trades and a clearly labelled RAW `@trade` shadow stream. RAW is research evidence and is not silently treated as the production trade source. Evidence sessions merge rolling recorder captures, preserving two minutes before the event and appending the five-minute follow-up without requiring an eight-minute global in-memory book for every armed symbol.
''', encoding="utf-8")
