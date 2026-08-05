from pathlib import Path
import re


def replace_once(path, old, new, label):
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, got {count}")
    file.write_text(source.replace(old, new, 1))


def regex_once(path, pattern, replacement, label, flags=re.S):
    file = Path(path)
    source = file.read_text()
    next_source, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, got {count}")
    file.write_text(next_source)


# Collector: run the deterministic extrema engine in parallel and arm the full order-flow recorder.
replace_once(
    "signal-lab-v3-collector.js",
    'import { SignalLabV3EvidenceRecorder } from "./signal-lab-v3-evidence.js";\n',
    'import { SignalLabV3EvidenceRecorder } from "./signal-lab-v3-evidence.js?v=signal-lab-v4-stage1";\n'
    'import {\n'
    '  SIGNAL_LAB_V4_TIMEFRAMES,\n'
    '  SignalLabV4ExtremeRegistry,\n'
    '} from "./signal-lab-v4-extremes.js?v=signal-lab-v4-stage1";\n'
    'import { SignalLabV4OrderFlowRecorder } from "./signal-lab-v4-orderflow-recorder.js?v=signal-lab-v4-stage1";\n',
    "collector imports",
)
replace_once(
    "signal-lab-v3-collector.js",
    'const BINANCE_KLINES_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";\n',
    'const BINANCE_KLINES_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";\n'
    'const BINANCE_EXCHANGE_INFO_ENDPOINT = "https://fapi.binance.com/fapi/v1/exchangeInfo";\n'
    'const EXTREME_WARMUP = Object.freeze({\n'
    '  "1m": 1_500,\n'
    '  "5m": 1_500,\n'
    '  "15m": 1_500,\n'
    '  "1h": 900,\n'
    '  "4h": 720,\n'
    '  "1d": 365,\n'
    '});\n',
    "collector constants",
)
replace_once(
    "signal-lab-v3-collector.js",
    '    maximumWarmupSymbols = 80,\n',
    '    maximumWarmupSymbols = 32,\n',
    "warmup symbol cap",
)
replace_once(
    "signal-lab-v3-collector.js",
    '    this.bookTracker = new ExpertBookCandidateTracker(this.settings);\n'
    '    this.episodes = new CandidateEpisodeTracker(this.settings);\n'
    '    this.evidence = new SignalLabV3EvidenceRecorder({ maximumDepthSymbols: 10 });\n',
    '    this.bookTracker = new ExpertBookCandidateTracker(this.settings);\n'
    '    this.episodes = new CandidateEpisodeTracker(this.settings);\n'
    '    this.extremes = new SignalLabV4ExtremeRegistry();\n'
    '    this.tickSizes = new Map();\n'
    '    this.exchangeInfoPromise = null;\n'
    '    this.orderFlow = new SignalLabV4OrderFlowRecorder({ maximumSymbols: 6 });\n'
    '    this.evidence = new SignalLabV3EvidenceRecorder({\n'
    '      maximumDepthSymbols: 0,\n'
    '      orderFlowRecorder: this.orderFlow,\n'
    '      disableLegacyDepth: true,\n'
    '    });\n',
    "collector engines",
)
replace_once(
    "signal-lab-v3-collector.js",
    '      depthState: "idle",\n'
    '      lastError: null,\n',
    '      depthState: "idle",\n'
    '      extremeMaps: 0,\n'
    '      tickSizes: 0,\n'
    '      lastError: null,\n',
    "collector status fields",
)
replace_once(
    "signal-lab-v3-collector.js",
    '  connect() {\n'
    '    this.manualClose = false;\n'
    '    this.#connectMarket();\n',
    '  connect() {\n'
    '    this.manualClose = false;\n'
    '    this.exchangeInfoPromise ??= this.#loadExchangeInfo();\n'
    '    this.#connectMarket();\n',
    "collector exchange info boot",
)
replace_once(
    "signal-lab-v3-collector.js",
    '    this.evidence.disconnect();\n'
    '    this.#publish({ connection: "stopped", depthState: "stopped", depthTracked: 0 });\n',
    '    this.evidence.disconnect();\n'
    '    this.orderFlow.disconnect();\n'
    '    this.#publish({ connection: "stopped", depthState: "stopped", depthTracked: 0 });\n',
    "collector disconnect",
)
replace_once(
    "signal-lab-v3-collector.js",
    '    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data)) {\n'
    '      this.#symbol(data.s)?.updateTrade(data);\n'
    '      return;\n'
    '    }\n',
    '    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data)) {\n'
    '      const receivedAt = Date.now();\n'
    '      this.#symbol(data.s)?.updateTrade(data);\n'
    '      this.extremes.ingestTrade(data.s, finite(data.p), finite(data.T) ?? finite(data.E) ?? receivedAt, {\n'
    '        dataQuality: receivedAt - (finite(data.E) ?? receivedAt) <= 5_000 ? "LIVE" : "STALE",\n'
    '      });\n'
    '      this.orderFlow.ingestTrade(data, receivedAt);\n'
    '      return;\n'
    '    }\n',
    "collector raw trade forwarding",
)
replace_once(
    "signal-lab-v3-collector.js",
    '  #metrics(now) {\n'
    '    return [...this.symbols.values()]\n'
    '      .map((state) => {\n'
    '        const metrics = state.metrics(DEFAULT_SETTINGS, now);\n'
    '        return {\n'
    '          ...metrics,\n'
    '          bookCandidate: this.bookTracker.candidateFor(metrics.symbol, now),\n'
    '        };\n'
    '      });\n'
    '  }\n',
    '  #metrics(now) {\n'
    '    return [...this.symbols.values()]\n'
    '      .map((state) => {\n'
    '        const metrics = state.metrics(DEFAULT_SETTINGS, now);\n'
    '        const tickSize = this.tickSizes.get(metrics.symbol) ?? null;\n'
    '        if (tickSize && Array.isArray(metrics.minuteCandles) && metrics.minuteCandles.length > 1) {\n'
    '          this.extremes.hydrate(metrics.symbol, "1m", metrics.minuteCandles.slice(0, -1), {\n'
    '            tickSize,\n'
    '            dataQuality: now - (finite(metrics.updatedAt) ?? 0) <= 5_000 ? "LIVE" : "STALE",\n'
    '          });\n'
    '        }\n'
    '        return {\n'
    '          ...metrics,\n'
    '          tickSize,\n'
    '          extremeMap: this.extremes.snapshot(metrics.symbol),\n'
    '          bookCandidate: this.bookTracker.candidateFor(metrics.symbol, now),\n'
    '        };\n'
    '      });\n'
    '  }\n',
    "collector metrics extrema",
)
replace_once(
    "signal-lab-v3-collector.js",
    '    this.evidence.setWatchSymbols([\n'
    '      ...activeSymbols,\n'
    '      ...ranked.slice(0, 10).map((row) => row.symbol),\n'
    '    ], now);\n',
    '    const setupRanked = [...ranked].sort((left, right) => (\n'
    '      this.extremes.watchScore(right.symbol, right.price)\n'
    '      - this.extremes.watchScore(left.symbol, left.price)\n'
    '      || candidateWatchScore(right, this.settings) - candidateWatchScore(left, this.settings)\n'
    '    ));\n'
    '    const orderFlowSymbols = [...new Set([\n'
    '      ...activeSymbols,\n'
    '      ...setupRanked.slice(0, 6).map((row) => row.symbol),\n'
    '    ])].slice(0, 6);\n'
    '    this.orderFlow.setSymbols(orderFlowSymbols);\n'
    '    this.evidence.setWatchSymbols(orderFlowSymbols, now);\n',
    "collector orderflow watch ranking",
)
replace_once(
    "signal-lab-v3-collector.js",
    '      depthTracked: evidenceStatus.depth.trackedSymbols ?? 0,\n'
    '      depthState: evidenceStatus.depth.connection ?? "idle",\n',
    '      depthTracked: evidenceStatus.depth.trackedSymbols ?? 0,\n'
    '      depthState: evidenceStatus.depth.connection ?? "idle",\n'
    '      extremeMaps: metrics.filter((row) => row.extremeMap && Object.keys(row.extremeMap.timeframes ?? {}).length).length,\n'
    '      tickSizes: this.tickSizes.size,\n',
    "collector extrema diagnostics",
)
regex_once(
    "signal-lab-v3-collector.js",
    r"  async #warmupSymbol\(symbol\) \{.*?\n  \#publish\(patch = \{\}\) \{",
    '''  async #loadExchangeInfo() {
    try {
      const response = await fetch(BINANCE_EXCHANGE_INFO_ENDPOINT, { cache: "no-store" });
      if (!response.ok) throw new Error(`Exchange info HTTP ${response.status}`);
      const payload = await response.json();
      for (const row of Array.isArray(payload?.symbols) ? payload.symbols : []) {
        const symbol = normalizeUsdtPerpetualSymbol(row?.symbol);
        const priceFilter = (Array.isArray(row?.filters) ? row.filters : [])
          .find((filter) => filter?.filterType === "PRICE_FILTER");
        const tickSize = finite(priceFilter?.tickSize);
        if (!symbol || !(tickSize > 0)) continue;
        this.tickSizes.set(symbol, tickSize);
        this.extremes.setTickSize(symbol, tickSize);
      }
      this.#publish({ tickSizes: this.tickSizes.size, lastError: null });
    } catch (error) {
      this.#publish({ lastError: `tickSize: ${String(error?.message ?? error).slice(0, 160)}` });
    }
  }

  async #warmupSymbol(symbol) {
    this.historyLoading.add(symbol);
    this.#publish({ warmupLoading: this.historyLoading.size });
    try {
      await this.exchangeInfoPromise;
      const tickSize = this.tickSizes.get(symbol);
      if (!(tickSize > 0)) throw new Error(`tickSize отсутствует для ${symbol}`);
      for (const timeframe of SIGNAL_LAB_V4_TIMEFRAMES) {
        const url = new URL(BINANCE_KLINES_ENDPOINT);
        url.searchParams.set("symbol", symbol);
        url.searchParams.set("interval", timeframe);
        url.searchParams.set("limit", String(EXTREME_WARMUP[timeframe] ?? 500));
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`${timeframe} klines HTTP ${response.status}`);
        const rows = await response.json();
        const candles = (Array.isArray(rows) ? rows : []).map(normalizeKline).filter(Boolean);
        this.extremes.hydrate(symbol, timeframe, candles, {
          tickSize,
          dataQuality: "RECOVERED",
        });
        if (timeframe === "1m") this.#symbol(symbol)?.hydrateMinuteCandles(candles);
      }
      this.historyLoaded.add(symbol);
      this.#publish({
        warmupLoaded: this.historyLoaded.size,
        lastError: null,
      });
    } catch (error) {
      this.#publish({ lastError: String(error?.message ?? error).slice(0, 180) });
    } finally {
      this.historyLoading.delete(symbol);
      this.#publish({ warmupLoading: this.historyLoading.size });
    }
  }

  #publish(patch = {}) {''',
    "collector warmup and exchange info",
)
replace_once(
    "signal-lab-v3-collector.js",
    '  const candle = {\n'
    '    time: finite(row[0]),\n'
    '    open: finite(row[1]),\n'
    '    high: finite(row[2]),\n'
    '    low: finite(row[3]),\n'
    '    close: finite(row[4]),\n'
    '  };\n',
    '  const candle = {\n'
    '    time: finite(row[0]),\n'
    '    open: finite(row[1]),\n'
    '    high: finite(row[2]),\n'
    '    low: finite(row[3]),\n'
    '    close: finite(row[4]),\n'
    '    volume: Math.max(0, finite(row[5]) ?? 0),\n'
    '    closeTime: finite(row[6]),\n'
    '    closed: finite(row[6]) === null ? true : finite(row[6]) < Date.now(),\n'
    '  };\n',
    "collector kline normalization",
)

# Evidence pack: replace sampled depth pool with the full local-book recorder when available.
replace_once(
    "signal-lab-v3-evidence.js",
    'export const SIGNAL_LAB_V3_EVIDENCE_VERSION = "signal-lab-v3-evidence-replay-2026-08";\n',
    'export const SIGNAL_LAB_V3_EVIDENCE_VERSION = "signal-lab-v4-extremes-orderflow-stage1-2026-08";\n',
    "evidence version",
)
replace_once(
    "signal-lab-v3-evidence.js",
    'const DEFAULT_PRE_EVENT_MS = 3 * 60_000;\n',
    'const DEFAULT_PRE_EVENT_MS = 2 * 60_000;\n',
    "pre event buffer",
)
replace_once(
    "signal-lab-v3-evidence.js",
    '    depthPool = null,\n'
    '  } = {}) {\n',
    '    depthPool = null,\n'
    '    orderFlowRecorder = null,\n'
    '    disableLegacyDepth = false,\n'
    '  } = {}) {\n',
    "evidence constructor args",
)
replace_once(
    "signal-lab-v3-evidence.js",
    '    this.depthPool = depthPool ?? new SignalLabV3DepthPool({\n'
    '      maximumSymbols: maximumDepthSymbols,\n'
    '      preEventMs,\n'
    '    });\n',
    '    this.orderFlowRecorder = orderFlowRecorder;\n'
    '    this.depthPool = disableLegacyDepth\n'
    '      ? null\n'
    '      : depthPool ?? new SignalLabV3DepthPool({\n'
    '        maximumSymbols: maximumDepthSymbols,\n'
    '        preEventMs,\n'
    '      });\n',
    "evidence recorder selection",
)
replace_once(
    "signal-lab-v3-evidence.js",
    '      depth: this.depthPool.status(),\n',
    '      depth: this.orderFlowRecorder?.status() ?? this.depthPool?.status() ?? { connection: "idle", trackedSymbols: 0 },\n',
    "evidence status",
)
replace_once(
    "signal-lab-v3-evidence.js",
    '  disconnect() {\n'
    '    this.depthPool.disconnect();\n'
    '  }\n',
    '  disconnect() {\n'
    '    this.depthPool?.disconnect();\n'
    '  }\n',
    "evidence disconnect",
)
replace_once(
    "signal-lab-v3-evidence.js",
    '  setWatchSymbols(symbols, now = Date.now()) {\n'
    '    this.baseWatchSymbols = [...new Set((Array.isArray(symbols) ? symbols : [])\n'
    '      .map(normalizeSymbol)\n'
    '      .filter(Boolean))];\n'
    '    this.#refreshWatchSymbols(now);\n'
    '  }\n',
    '  setWatchSymbols(symbols, now = Date.now()) {\n'
    '    this.baseWatchSymbols = [...new Set((Array.isArray(symbols) ? symbols : [])\n'
    '      .map(normalizeSymbol)\n'
    '      .filter(Boolean))];\n'
    '    if (this.depthPool) this.#refreshWatchSymbols(now);\n'
    '  }\n',
    "evidence watch no-op",
)
replace_once(
    "signal-lab-v3-evidence.js",
    '    const bookSnapshots = this.depthPool.snapshots(episode.symbol, windowStartAt)\n'
    '      .slice(-this.maximumBookSnapshots);\n',
    '    const bookSnapshots = this.depthPool\n'
    '      ? this.depthPool.snapshots(episode.symbol, windowStartAt).slice(-this.maximumBookSnapshots)\n'
    '      : [];\n'
    '    const orderFlowReplay = this.orderFlowRecorder?.capture(episode.symbol, windowStartAt, now) ?? null;\n',
    "evidence initial orderflow",
)
replace_once(
    "signal-lab-v3-evidence.js",
    '      bookSnapshots,\n'
    '      bookMode: "sampled-depth20-top8@1s",\n',
    '      bookSnapshots,\n'
    '      bookMode: orderFlowReplay ? "snapshot+diff@100ms+aggTrade" : "sampled-depth20-top8@1s",\n'
    '      orderFlowReplay,\n'
    '      extremeMap: metrics?.extremeMap ? clone(metrics.extremeMap) : null,\n'
    '      extremeMapLatest: metrics?.extremeMap ? clone(metrics.extremeMap) : null,\n',
    "evidence pack v4 fields",
)
replace_once(
    "signal-lab-v3-evidence.js",
    '    for (const snapshot of this.depthPool.snapshots(session.episode.symbol, session.lastBookAt + 1)) {\n'
    '      appendByTime(pack.bookSnapshots, snapshot, this.maximumBookSnapshots);\n'
    '      session.lastBookAt = Math.max(session.lastBookAt, snapshot.at);\n'
    '    }\n',
    '    if (this.depthPool) {\n'
    '      for (const snapshot of this.depthPool.snapshots(session.episode.symbol, session.lastBookAt + 1)) {\n'
    '        appendByTime(pack.bookSnapshots, snapshot, this.maximumBookSnapshots);\n'
    '        session.lastBookAt = Math.max(session.lastBookAt, snapshot.at);\n'
    '      }\n'
    '    }\n'
    '    if (this.orderFlowRecorder) {\n'
    '      pack.orderFlowReplay = this.orderFlowRecorder.capture(\n'
    '        session.episode.symbol,\n'
    '        pack.window.eventAt - this.preEventMs,\n'
    '        now,\n'
    '      );\n'
    '      if (pack.orderFlowReplay) pack.bookMode = "snapshot+diff@100ms+aggTrade";\n'
    '    }\n'
    '    if (metrics?.extremeMap) pack.extremeMapLatest = clone(metrics.extremeMap);\n',
    "evidence live orderflow",
)
replace_once(
    "signal-lab-v3-evidence.js",
    '      depthStatus: this.depthPool.status().connection,\n',
    '      depthStatus: this.orderFlowRecorder?.status()?.connection ?? this.depthPool?.status()?.connection ?? "idle",\n'
    '      orderFlowPreSeconds: pack.orderFlowReplay?.coverage?.preSeconds ?? 0,\n'
    '      orderFlowState: pack.orderFlowReplay?.coverage?.state ?? "not-recorded",\n'
    '      rawTrades: pack.orderFlowReplay?.trades?.length ?? 0,\n'
    '      depthDiffs: pack.orderFlowReplay?.events?.length ?? 0,\n',
    "evidence coverage",
)
replace_once(
    "signal-lab-v3-evidence.js",
    '  #refreshWatchSymbols(now) {\n',
    '  #refreshWatchSymbols(now) {\n'
    '    if (!this.depthPool) return;\n',
    "evidence legacy watch guard",
)

# Full chart: 30 day history, native higher TFs, and deterministic extrema annotations.
replace_once(
    "signal-lab-v3-full-chart.js",
    '  "15m": 900_000,\n'
    '  "1h": 3_600_000,\n',
    '  "15m": 900_000,\n'
    '  "1h": 3_600_000,\n'
    '  "4h": 14_400_000,\n'
    '  "1d": 86_400_000,\n',
    "chart higher timeframes",
)
replace_once(
    "signal-lab-v3-full-chart.js",
    '  "7d": 7 * 24 * 60 * 60_000,\n',
    '  "7d": 7 * 24 * 60 * 60_000,\n'
    '  "30d": 30 * 24 * 60 * 60_000,\n',
    "chart 30d range",
)
insert_marker = 'export function buildPatternAnnotations(episode) {\n'
insert_code = '''function addExtremeMapAnnotations(target, extremeMap, eventAt, eventPrice) {
  const rows = [];
  for (const [timeframe, map] of Object.entries(extremeMap?.timeframes ?? {})) {
    for (const extreme of map?.active ?? []) {
      const price = finite(extreme?.price);
      if (!(price > 0)) continue;
      const distance = eventPrice > 0 ? Math.abs(price - eventPrice) / eventPrice * 100 : 0;
      if (distance > 8) continue;
      rows.push({ ...extreme, timeframe, distance });
    }
  }
  rows.sort((left, right) => left.distance - right.distance || right.confirmedAt - left.confirmedAt);
  for (const extreme of rows.slice(0, 32)) {
    const high = extreme.side === "HIGH";
    const label = `${high ? "H" : "L"} ${extreme.timeframe} ×${extreme.touchCount ?? 1}`;
    target.push({
      type: "point",
      time: extreme.extremeTime,
      price: extreme.price,
      label,
      tone: high ? "danger" : "success",
    });
    target.push({
      type: "line",
      price: extreme.price,
      startAt: extreme.extremeTime,
      endAt: eventAt + 60_000,
      label: `${label} · активен`,
      tone: high ? "danger" : "success",
    });
    if (finite(extreme.confirmedAt) !== null) {
      target.push({
        type: "event",
        time: extreme.confirmedAt,
        label: `${high ? "H" : "L"} подтверждён ${extreme.timeframe}`,
        tone: "blue",
      });
    }
  }
}

'''
replace_once("signal-lab-v3-full-chart.js", insert_marker, insert_code + insert_marker, "extreme annotations helper")
replace_once(
    "signal-lab-v3-full-chart.js",
    '  if (episode?.candidateType === "down_reversal_attempt" || episode?.candidateType === "up_reversal_attempt") {\n',
    '  addExtremeMapAnnotations(annotations, pack?.extremeMap, eventAt, eventPrice);\n\n'
    '  if (episode?.candidateType === "down_reversal_attempt" || episode?.candidateType === "up_reversal_attempt") {\n',
    "apply extreme annotations",
)
regex_once(
    "signal-lab-v3-full-chart.js",
    r"async function fetchRestCandles\(symbol, interval, eventAt, contextMs, signal\) \{.*?\n\}\n\nexport async function loadEpisodeCandles",
    '''function episodeHistoryBounds(eventAt, intervalMs, contextMs) {
  if (contextMs >= EPISODE_CONTEXT_RANGES["30d"]) {
    return {
      startTime: Math.max(0, eventAt - EPISODE_CONTEXT_RANGES["30d"]),
      endTime: Math.min(Date.now(), eventAt + Math.max(6 * 60 * 60_000, intervalMs * 120)),
    };
  }
  return {
    startTime: Math.max(0, eventAt - contextMs),
    endTime: Math.min(Date.now(), eventAt + contextMs),
  };
}

async function fetchRestCandles(symbol, interval, eventAt, contextMs, signal) {
  const intervalMs = EPISODE_CHART_INTERVALS[interval];
  const { startTime, endTime } = episodeHistoryBounds(eventAt, intervalMs, contextMs);
  const key = `${symbol}:${interval}:${startTime}:${endTime}`;
  if (candleCache.has(key)) return clone(candleCache.get(key));
  const candles = [];
  let cursor = startTime;
  let requests = 0;
  while (cursor <= endTime && candles.length < 50_000 && requests < 40) {
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
    if (!page.length) break;
    for (const row of page) {
      if (!candles.length || row.time > candles.at(-1).time) candles.push(row);
    }
    const next = page.at(-1).time + intervalMs;
    if (!(next > cursor)) break;
    cursor = next;
    requests += 1;
    if (page.length < 1500) break;
  }
  if (!candles.length) throw new Error("Binance не вернул свечи вокруг эпизода");
  candleCache.set(key, candles);
  if (candleCache.size > 40) candleCache.delete(candleCache.keys().next().value);
  return clone(candles);
}

export async function loadEpisodeCandles''',
    "paginated 30d candles",
)
replace_once(
    "signal-lab-v3-full-chart.js",
    '    this.interval = "1m";\n'
    '    this.contextRange = String(episode?.candidateType ?? "").includes("reversal") ? "15m" : "1h";\n',
    '    const structural = String(episode?.candidateType ?? "").includes("cascade")\n'
    '      || String(episode?.candidateType ?? "").includes("level_break");\n'
    '    this.interval = structural ? "1h" : "1m";\n'
    '    this.contextRange = structural ? "30d" : "15m";\n'
    '    this.timeframeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.chartTimeframe === this.interval));\n'
    '    this.rangeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.chartRange === this.contextRange));\n',
    "chart default structural context",
)

# Replay: mount full cluster/tape/local-book panel when the V4 bundle exists.
replace_once(
    "signal-lab-v3-replay-ui.js",
    'const TIMEFRAMES = Object.freeze({\n',
    'import { mountSignalLabV4OrderFlowPanel } from "./signal-lab-v4-orderflow-replay.js?v=signal-lab-v4-stage1";\n\n'
    'const TIMEFRAMES = Object.freeze({\n',
    "replay V4 import",
)
replace_once(
    "signal-lab-v3-replay-ui.js",
    '  let timer = null;\n'
    '  const startAt = finite(pack?.window?.startAt) ?? Date.now() - 180_000;\n',
    '  let timer = null;\n'
    '  const orderFlowPanel = pack?.orderFlowReplay\n'
    '    ? mountSignalLabV4OrderFlowPanel(card, pack.orderFlowReplay)\n'
    '    : null;\n'
    '  const startAt = finite(pack?.orderFlowReplay?.requestedFrom)\n'
    '    ?? finite(pack?.window?.startAt)\n'
    '    ?? Date.now() - 120_000;\n',
    "replay mount orderflow",
)
replace_once(
    "signal-lab-v3-replay-ui.js",
    '    finite(pack?.window?.updatedAt) ?? startAt,\n'
    '  );\n',
    '    finite(pack?.orderFlowReplay?.requestedTo) ?? startAt,\n'
    '    finite(pack?.window?.updatedAt) ?? startAt,\n'
    '  );\n',
    "replay latest orderflow time",
)
replace_once(
    "signal-lab-v3-replay-ui.js",
    '    renderBook(book, pack, selectedAt);\n'
    '    renderExplanation(card, pack);\n',
    '    if (orderFlowPanel) orderFlowPanel.render(selectedAt);\n'
    '    else renderBook(book, pack, selectedAt);\n'
    '    renderExplanation(card, pack);\n',
    "replay render orderflow",
)
replace_once(
    "signal-lab-v3-replay-ui.js",
    '    coverage.textContent = `Цена: ${pack.coverage?.prePriceSeconds ?? 0}с до · стакан: ${pack.coverage?.preBookSeconds ?? 0}с до / ${pack.coverage?.bookState ?? "not-recorded"} · режим ${pack.bookMode}`;\n',
    '    coverage.textContent = orderFlowPanel\n'
    '      ? `Свечи: контекст до 30 дней · order flow: ${pack.coverage?.orderFlowPreSeconds ?? 0}с до · ${pack.coverage?.orderFlowState ?? "not-recorded"} · ${pack.coverage?.depthDiffs ?? 0} diff · ${pack.coverage?.rawTrades ?? 0} aggTrade`\n'
    '      : `Цена: ${pack.coverage?.prePriceSeconds ?? 0}с до · стакан: ${pack.coverage?.preBookSeconds ?? 0}с до / ${pack.coverage?.bookState ?? "not-recorded"} · режим ${pack.bookMode}`;\n',
    "replay coverage text",
)

# Owner HTML: V4 calibration mode, 30 days, full order-flow workspace, and error labels.
replace_once("owner-signal-lab-v3.html", "InPuls — Owner Signal Lab V3.3", "InPuls — Owner Signal Lab V4", "owner title")
replace_once("owner-signal-lab-v3.html", "InPuls Owner Signal Lab V3.3", "InPuls Owner Signal Lab V4", "owner aria")
replace_once("owner-signal-lab-v3.html", "OWNER SIGNAL LAB V3.3", "OWNER SIGNAL LAB V4", "owner brand")
replace_once(
    "owner-signal-lab-v3.html",
    '<link rel="stylesheet" href="./owner-signal-lab-v3.css?v=signal-lab-v3-full-chart-review-v1" />',
    '<link rel="stylesheet" href="./owner-signal-lab-v3.css?v=signal-lab-v4-stage1" />',
    "owner css cache",
)
replace_once(
    "owner-signal-lab-v3.html",
    '<link rel="stylesheet" href="./owner-signal-lab-v3-evidence.css?v=signal-lab-v3-full-chart-review-v1" />',
    '<link rel="stylesheet" href="./owner-signal-lab-v3-evidence.css?v=signal-lab-v4-stage1" />',
    "owner evidence css cache",
)
replace_once(
    "owner-signal-lab-v3.html",
    '<p class="eyebrow">КАНДИДАТЫ · ГРАФИК · СТАКАН · ОБЪЯСНЕНИЕ</p>',
    '<p class="eyebrow">V4 · АКТИВНЫЕ ЭКСТРЕМУМЫ · 30 ДНЕЙ · ORDER FLOW REPLAY</p>',
    "owner hero eyebrow",
)
replace_once(
    "owner-signal-lab-v3.html",
    '          Нож и заточка могут стать обратной реакцией после пробоя, каскада или сильного импульса.\n',
    '          Нож и заточка могут стать обратной реакцией после пробоя, каскада или сильного импульса.\n'
    '          V4 параллельно строит неперерисовывающуюся карту high/low по каждому таймфрейму.\n'
    '          Пока карта не откалибрована, её разметка является исследовательской, а не подтверждённым каскадом.\n',
    "owner hero calibration",
)
replace_once(
    "owner-signal-lab-v3.html",
    '                  <button type="button" data-chart-timeframe="1h">1ч</button>\n',
    '                  <button type="button" data-chart-timeframe="1h">1ч</button>\n'
    '                  <button type="button" data-chart-timeframe="4h">4ч</button>\n'
    '                  <button type="button" data-chart-timeframe="1d">1д</button>\n',
    "owner chart TF",
)
replace_once(
    "owner-signal-lab-v3.html",
    '                  <button type="button" data-chart-range="7d">±7д</button>\n',
    '                  <button type="button" data-chart-range="7d">±7д</button>\n'
    '                  <button type="button" data-chart-range="30d">30д до эпизода</button>\n',
    "owner chart range",
)
regex_once(
    "owner-signal-lab-v3.html",
    r'          <div class="book-panel">.*?          </div>\n\n          <div class="explanation-panel">',
    '''          <div class="book-panel orderflow-panel">
            <header class="evidence-panel-head">
              <div>
                <h3>Order Flow Replay</h3>
                <p>Локальная книга snapshot + diff, кластер и aggTrade на одной временной шкале</p>
              </div>
              <strong data-field="flow-quality" class="flow-quality">SYNCING</strong>
            </header>
            <div class="orderflow-toolbar">
              <div class="timeframe-switch" role="group" aria-label="Таймфрейм кластера">
                <button type="button" data-flow-timeframe="1s">1с</button>
                <button type="button" data-flow-timeframe="5s" class="is-active">5с</button>
                <button type="button" data-flow-timeframe="15s">15с</button>
                <button type="button" data-flow-timeframe="1m">1м</button>
              </div>
              <div class="timeframe-switch" role="group" aria-label="Шаг цены кластера">
                <button type="button" data-flow-step="1" class="is-active">×1</button>
                <button type="button" data-flow-step="10">×10</button>
                <button type="button" data-flow-step="100">×100</button>
                <button type="button" data-flow-step="1000">×1000</button>
              </div>
            </div>
            <div class="orderflow-replay-grid">
              <section class="orderflow-pane cluster-pane">
                <h4>КЛАСТЕР</h4>
                <canvas data-field="flow-cluster" class="flow-cluster"></canvas>
              </section>
              <section class="orderflow-pane tape-pane">
                <h4>СДЕЛКИ · AGG</h4>
                <div data-field="flow-tape" class="replay-tape"></div>
              </section>
              <section class="orderflow-pane book-pane">
                <h4>СТАКАН · РУЧНОЙ СКРОЛЛ</h4>
                <div data-field="book" class="replay-book virtual-book"></div>
              </section>
            </div>
            <p class="book-warning">
              Полная локальная книга доступна только при непрерывной записи до события. GAP/RECOVERED показываются явно; состав стопов и намерение участника не утверждаются.
            </p>
          </div>

          <div class="explanation-panel">''',
    "owner full orderflow panel",
)
replace_once(
    "owner-signal-lab-v3.html",
    '            <div class="verdicts" data-field="verdicts">\n',
    '            <details class="error-labels">\n'
    '              <summary>Ошибки детектора</summary>\n'
    '              <div data-field="error-labels" class="error-label-grid">\n'
    '                <label><input type="checkbox" value="MISSED_EXTREME" />Пропущен экстремум</label>\n'
    '                <label><input type="checkbox" value="EXTRA_EXTREME" />Лишний экстремум</label>\n'
    '                <label><input type="checkbox" value="CONFIRMED_TOO_EARLY" />Подтверждён рано</label>\n'
    '                <label><input type="checkbox" value="CONFIRMED_TOO_LATE" />Подтверждён поздно</label>\n'
    '                <label><input type="checkbox" value="WRONG_PRICE" />Неверная цена</label>\n'
    '                <label><input type="checkbox" value="SHOULD_BE_ACTIVE" />Должен быть активен</label>\n'
    '                <label><input type="checkbox" value="SHOULD_BE_BROKEN" />Должен быть снят</label>\n'
    '                <label><input type="checkbox" value="WRONG_TOUCH_COUNT" />Неверный ×N</label>\n'
    '                <label><input type="checkbox" value="WRONG_LEVEL_MERGE" />Неверное объединение</label>\n'
    '                <label><input type="checkbox" value="MISSED_COMPRESSION" />Пропущено поджатие</label>\n'
    '                <label><input type="checkbox" value="FALSE_COMPRESSION" />Ложное поджатие</label>\n'
    '                <label><input type="checkbox" value="MISSED_BREAKOUT" />Пропущен пробой</label>\n'
    '                <label><input type="checkbox" value="FALSE_BREAKOUT" />Ложный пробой</label>\n'
    '                <label><input type="checkbox" value="MISSED_CASCADE" />Пропущен каскад</label>\n'
    '                <label><input type="checkbox" value="FALSE_CASCADE" />Ложный каскад</label>\n'
    '                <label><input type="checkbox" value="DUPLICATE_EVENT" />Дубль события</label>\n'
    '                <label><input type="checkbox" value="LOOKAHEAD_ERROR" />Look-ahead</label>\n'
    '              </div>\n'
    '            </details>\n'
    '            <div class="verdicts" data-field="verdicts">\n',
    "owner error labels",
)
replace_once(
    "owner-signal-lab-v3.html",
    '    <script type="module" src="./owner-signal-lab-v3.js?v=signal-lab-v3-full-chart-review-v1"></script>',
    '    <script type="module" src="./owner-signal-lab-v3.js?v=signal-lab-v4-stage1"></script>',
    "owner runtime cache",
)

# Owner runtime and review persistence.
for old, new in [
    ("signal-lab-v3-full-chart-review-v1", "signal-lab-v4-stage1"),
]:
    file = Path("owner-signal-lab-v3.js")
    source = file.read_text()
    if old not in source:
        raise RuntimeError("owner runtime cache key missing")
    file.write_text(source.replace(old, new))
replace_once(
    "owner-signal-lab-v3.js",
    '    comment: comment.value,\n',
    '    comment: comment.value,\n'
    '    errorLabels: [...card.querySelectorAll(\'[data-field="error-labels"] input:checked\')].map((input) => input.value),\n',
    "save error labels",
)
replace_once(
    "owner-signal-lab-v3.js",
    '  comment.value = episode.review?.comment ?? "";\n',
    '  comment.value = episode.review?.comment ?? "";\n'
    '  const errorLabels = new Set(Array.isArray(episode.review?.errorLabels) ? episode.review.errorLabels : []);\n'
    '  card.querySelectorAll(\'[data-field="error-labels"] input\').forEach((input) => {\n'
    '    input.checked = errorLabels.has(input.value);\n'
    '  });\n',
    "render error labels",
)
replace_once(
    "owner-signal-lab-v3.js",
    '  const depth = status.depthState\n'
    '    ? `depth ${status.depthState}/${status.depthTracked ?? 0}`\n'
    '    : `depth ${status.depthTracked ?? 0}`;\n',
    '  const depth = status.depthState\n'
    '    ? `order flow ${status.depthState}/${status.depthTracked ?? 0}`\n'
    '    : `order flow ${status.depthTracked ?? 0}`;\n',
    "owner status orderflow",
)
replace_once(
    "owner-signal-lab-v3.js",
    '  return `${connection} · проверки ${status.checks} · эпизоды ${status.createdEpisodes} · miniTicker ${status.miniTickerPackets ?? 0} · aggTrade ${status.aggTradePackets ?? 0}/${status.trackedTrades} · book ${status.bookPackets ?? 0} · ${depth} · пакеты ${status.evidencePacks ?? 0} · история ${status.warmupLoaded} · пакет ${age}`;\n',
    '  return `${connection} · проверки ${status.checks} · эпизоды ${status.createdEpisodes} · экстремумы ${status.extremeMaps ?? 0} · miniTicker ${status.miniTickerPackets ?? 0} · aggTrade ${status.aggTradePackets ?? 0}/${status.trackedTrades} · book ${status.bookPackets ?? 0} · ${depth} · пакеты ${status.evidencePacks ?? 0} · история ${status.warmupLoaded} · пакет ${age}`;\n',
    "owner status extrema",
)

# Store calibration labels and limit heavy browser-only replay history.
replace_once("signal-lab-v3-store.js", "const MAX_EVIDENCE_PACKS = 500;", "const MAX_EVIDENCE_PACKS = 120;", "evidence retention")
replace_once(
    "signal-lab-v3-store.js",
    '    comment: safeText(review.comment, 1_000),\n',
    '    comment: safeText(review.comment, 1_000),\n'
    '    errorLabels: Object.freeze([...new Set((Array.isArray(review.errorLabels) ? review.errorLabels : [])\n'
    '      .map((value) => safeText(value, 48))\n'
    '      .filter(Boolean))].slice(0, 24)),\n',
    "store error labels",
)
replace_once(
    "signal-lab-v3-store.js",
    '      comment: row.review?.comment ?? "",\n',
    '      comment: row.review?.comment ?? "",\n'
    '      errorLabels: Array.isArray(row.review?.errorLabels) ? row.review.errorLabels.join(" | ") : "",\n',
    "export error labels",
)

# CSS for the same three-part order-flow workspace and manual virtual book scroll.
with Path("owner-signal-lab-v3-evidence.css").open("a") as file:
    file.write(r'''

/* Signal Lab V4: replayable cluster, tape and local book. */
.orderflow-panel { min-width: 720px; }
.orderflow-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  overflow-x: auto;
}
.flow-quality {
  padding: 4px 7px;
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  color: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.flow-quality[data-state="LIVE"] { color: var(--success); border-color: rgba(95,224,167,.35); }
.flow-quality[data-state="GAP"],
.flow-quality[data-state="ERROR"] { color: var(--danger); border-color: rgba(242,125,134,.4); }
.flow-quality[data-state="RECOVERED"] { color: var(--warning); border-color: rgba(241,191,98,.4); }
.orderflow-replay-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1.3fr) minmax(210px, .72fr) minmax(280px, .95fr);
  gap: 8px;
  min-height: 430px;
}
.orderflow-pane {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 9px;
  background: #081018;
}
.orderflow-pane h4 {
  height: 30px;
  margin: 0;
  padding: 8px 10px;
  color: #7892a5;
  border-bottom: 1px solid var(--line-soft);
  font-size: 10px;
  letter-spacing: .06em;
}
.flow-cluster { width: 100%; height: 396px; display: block; }
.replay-tape {
  height: 396px;
  overflow: auto;
  scrollbar-gutter: stable;
  font-variant-numeric: tabular-nums;
}
.replay-tape-row {
  display: grid;
  grid-template-columns: minmax(74px, .9fr) minmax(72px, 1fr) minmax(60px, .8fr);
  gap: 7px;
  min-height: 22px;
  align-items: center;
  padding: 0 7px;
  border-bottom: 1px solid rgba(113,141,159,.08);
  color: #91a8b8;
  font-size: 9px;
}
.replay-tape-row.is-buy strong { color: var(--success); }
.replay-tape-row.is-sell strong { color: var(--danger); }
.virtual-book {
  position: relative;
  height: 396px;
  min-height: 396px;
  overflow: auto;
  padding: 0;
  scrollbar-gutter: stable;
}
.virtual-book-spacer { width: 1px; opacity: 0; }
.virtual-book-layer { position: absolute; inset: 0 0 auto; }
.virtual-book-row {
  position: absolute;
  left: 0;
  right: 0;
  height: 22px;
  display: grid;
  grid-template-columns: minmax(86px, 1fr) minmax(62px, .7fr) minmax(66px, .8fr);
  align-items: center;
  gap: 6px;
  padding: 0 7px;
  border-bottom: 1px solid rgba(113,141,159,.07);
  color: #9bb0be;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}
.virtual-book-row span:nth-child(n+2) { text-align: right; }
.virtual-book-row.is-ask span:first-child { color: var(--danger); }
.virtual-book-row.is-bid span:first-child { color: var(--success); }
.virtual-book-row.is-mid {
  display: flex;
  justify-content: center;
  color: var(--blue);
  border-top: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
  background: rgba(100,184,255,.08);
  font-weight: 800;
}
.virtual-book-row.is-empty { display: flex; justify-content: center; padding: 24px; color: var(--muted); }
.error-labels { margin: 10px 0; }
.error-label-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  margin-top: 7px;
}
.error-label-grid label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-size: 10px;
}
.error-label-grid input { width: auto; min-height: auto; accent-color: var(--danger); }

@media (min-width: 1451px) {
  .evidence-workspace {
    grid-template-columns: minmax(520px, 1.1fr) minmax(720px, 1.55fr) minmax(340px, .8fr);
  }
}
@media (max-width: 1450px) {
  .orderflow-panel { min-width: 0; grid-column: 1 / -1; border-top: 1px solid var(--line-soft); }
}
@media (max-width: 920px) {
  .orderflow-replay-grid { grid-template-columns: 1fr; }
  .flow-cluster, .replay-tape, .virtual-book { height: 330px; min-height: 330px; }
  .orderflow-toolbar { align-items: flex-start; flex-direction: column; }
}
''')

# Integration contract tests.
Path("test/signal-lab-v4-integration.test.js").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const collector = await readFile(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
const evidence = await readFile(new URL("../signal-lab-v3-evidence.js", import.meta.url), "utf8");
const chart = await readFile(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");
const replay = await readFile(new URL("../signal-lab-v3-replay-ui.js", import.meta.url), "utf8");
const html = await readFile(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
const runtime = await readFile(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
const store = await readFile(new URL("../signal-lab-v3-store.js", import.meta.url), "utf8");

test("V4 collector uses exchange tick sizes, multi-TF extrema and full order-flow recorder", () => {
  assert.match(collector, /SignalLabV4ExtremeRegistry/);
  assert.match(collector, /SignalLabV4OrderFlowRecorder/);
  assert.match(collector, /fapi\/v1\/exchangeInfo/);
  assert.match(collector, /SIGNAL_LAB_V4_TIMEFRAMES/);
  assert.match(collector, /orderFlow\.ingestTrade/);
  assert.match(collector, /extremes\.watchScore/);
});

test("evidence pack preserves two minutes of snapshot diff trades and the extrema map", () => {
  assert.match(evidence, /DEFAULT_PRE_EVENT_MS = 2 \* 60_000/);
  assert.match(evidence, /orderFlowReplay/);
  assert.match(evidence, /snapshot\+diff@100ms\+aggTrade/);
  assert.match(evidence, /extremeMapLatest/);
  assert.match(evidence, /orderFlowPreSeconds/);
});

test("episode chart supports native 4h 1d and paginated 30 day history", () => {
  assert.match(chart, /"4h": 14_400_000/);
  assert.match(chart, /"1d": 86_400_000/);
  assert.match(chart, /"30d": 30 \* 24/);
  assert.match(chart, /candles\.length < 50_000/);
  assert.match(chart, /addExtremeMapAnnotations/);
  assert.match(html, /data-chart-range="30d"/);
  assert.match(html, /data-chart-timeframe="1d"/);
});

test("owner replay exposes cluster tape scrollable local book and explicit data states", () => {
  assert.match(replay, /mountSignalLabV4OrderFlowPanel/);
  assert.match(html, /data-field="flow-cluster"/);
  assert.match(html, /data-field="flow-tape"/);
  assert.match(html, /СТАКАН · РУЧНОЙ СКРОЛЛ/);
  assert.match(html, /snapshot \+ diff/);
  assert.match(runtime, /order flow/);
});

test("manual calibration stores the requested detector error labels", () => {
  for (const label of [
    "MISSED_EXTREME", "EXTRA_EXTREME", "CONFIRMED_TOO_EARLY", "CONFIRMED_TOO_LATE",
    "WRONG_PRICE", "SHOULD_BE_ACTIVE", "SHOULD_BE_BROKEN", "WRONG_TOUCH_COUNT",
    "WRONG_LEVEL_MERGE", "MISSED_COMPRESSION", "FALSE_COMPRESSION", "MISSED_BREAKOUT",
    "FALSE_BREAKOUT", "MISSED_CASCADE", "FALSE_CASCADE", "DUPLICATE_EVENT", "LOOKAHEAD_ERROR",
  ]) assert.match(html, new RegExp(label));
  assert.match(runtime, /errorLabels/);
  assert.match(store, /errorLabels/);
});
''')

# Architecture note: legacy breakout/cascade remains isolated until extrema validation.
Path("docs/signal-lab-v4-extremes-orderflow-stage1.md").write_text('''# Signal Lab V4 — Stage 1: active extrema and order-flow evidence\n\n## Decision\n\nThe legacy V3 cascade/breakout detector is not silently replaced. V4 runs a deterministic, non-repainting multi-timeframe extrema map in parallel. The map must be manually calibrated before levels, compression, breakout acceptance and cascade state transitions become the production candidate source.\n\n## Implemented\n\n- Per-timeframe extrema engines for 1m, 5m, 15m, 1h, 4h and 1d.\n- Exact price normalization through Binance tickSize and integer ticks.\n- Candidate movement before confirmation; immutable confirmed extrema.\n- Confirmation by observable reversal using min percent, ATR factor and minimum ticks.\n- Separate extremeTime, detectedAt and confirmedAt.\n- Equality is a retest; one valid tick through the level is BREAK_ATTEMPT and removes it from the active map while preserving history.\n- Manual detector-error labels for calibration.\n- 30-day paginated candle context on demand.\n- Limited setup-aware order-flow recorder using REST snapshot + depth diff U/u/pu + exact aggTrade event times.\n- At least two requested pre-event minutes, with actual coverage shown honestly.\n- Shared replay time for footprint cluster, tape and a manually scrollable reconstructed local book.\n- LIVE/GAP/RECOVERED/ERROR quality states.\n\n## Deliberately deferred\n\n- Level-zone merge and independent attack ×N calibration.\n- Compression classification.\n- Breakout acceptance modes.\n- Cascade SETUP/TRIGGERED/CONFIRMED/EXTENDED/PARTIAL/FAILED.\n- Production replacement of the legacy candidate detector.\n\nThese stages depend on a validated active-extrema map.\n\n## Browser limitation\n\nThe browser records full order flow only for a limited armed symbol set. Two-minute pre-event coverage is guaranteed only when the symbol was armed before the trigger. Coverage is stored and displayed; missing history is never reconstructed or presented as complete. Long-term Market Memory and complete DNA require a 24/7 backend recorder.\n''')

print("Signal Lab V4 stage one patch applied")
