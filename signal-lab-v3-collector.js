import {
  DEFAULT_SETTINGS,
  SymbolState,
  filterUsdtPerpetualTicker,
  isUsdtPerpetualSymbol,
  normalizeUsdtPerpetualSymbol,
} from "./engine.js?v=26-65-structured-signal-collection-v1";
import {
  CandidateEpisodeTracker,
  candidateWatchScore,
  DEFAULT_CANDIDATE_SETTINGS,
  SIGNAL_LAB_V3_FORMULA_VERSION,
} from "./signal-lab-v3-candidates.js?v=signal-lab-v5-patterns-1";
import { SignalLabV3EvidenceRecorder } from "./signal-lab-v3-evidence.js?v=signal-lab-v5-orderflow-1";
import {
  SIGNAL_LAB_V4_TIMEFRAMES,
  SignalLabV4ExtremeRegistry,
  atrFromClosedCandles,
} from "./signal-lab-v4-extremes.js?v=signal-lab-v6-candle-extremes";
import { SignalLabV4LevelBreakoutRegistry } from "./signal-lab-v4-levels-breakouts.js?v=signal-lab-v6-canonical-levels";
import { SignalLabV4CascadeRegistry } from "./signal-lab-v4-cascades.js?v=signal-lab-v4-stage3";
import { SignalLabV4OrderFlowRecorder } from "./signal-lab-v4-orderflow-recorder.js?v=signal-lab-v5-orderflow-v2";

const BINANCE_MARKET_STREAM_ENDPOINT = "wss://fstream.binance.com/market/ws";
const BINANCE_PUBLIC_STREAM_ENDPOINT = "wss://fstream.binance.com/public/ws";
const BINANCE_KLINES_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";
const BINANCE_EXCHANGE_INFO_ENDPOINT = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const EXTREME_WARMUP = Object.freeze({
  "1m": 1_500,
  "5m": 1_500,
  "15m": 1_500,
  "1h": 900,
  "4h": 720,
  "1d": 365,
});
const CONNECTION_TIMEOUT_MS = 10_000;
const STATUS_NOTIFY_INTERVAL_MS = 350;
const CHECK_INTERVAL_MS = 1_000;
const STRUCTURE_TRADE_INTERVAL_MS = 200;

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sizeSimilarityPercent(left, right) {
  if (!(left > 0) || !(right > 0)) return Infinity;
  return Math.abs(left - right) / Math.max(left, right) * 100;
}

function sideState() {
  return {
    samples: [],
    latestStrong: null,
    strongTouches: [],
  };
}

export class ExpertBookCandidateTracker {
  constructor(options = {}) {
    this.options = {
      minimumSamples: 12,
      sampleLimit: 80,
      minimumQuoteUsd: DEFAULT_CANDIDATE_SETTINGS.minimumLiquidityQuoteUsd,
      minimumMultiple: DEFAULT_CANDIDATE_SETTINGS.minimumLiquidityMultiple,
      similarityPercent: 24,
      repeatWindowMs: 8_000,
      moveWindowMs: 3_000,
      lifetimeMs: 4_500,
      ...options,
    };
    this.symbols = new Map();
  }

  #symbol(symbol) {
    if (!this.symbols.has(symbol)) {
      this.symbols.set(symbol, { bid: sideState(), ask: sideState() });
    }
    return this.symbols.get(symbol);
  }

  #observe(symbol, side, price, quantity, at) {
    if (!(price > 0) || !(quantity > 0)) return;
    const state = this.#symbol(symbol)[side];
    const quoteUsd = price * quantity;
    const baselineQuoteUsd = median(state.samples);
    state.samples.push(quoteUsd);
    if (state.samples.length > this.options.sampleLimit) state.samples.shift();
    if (
      state.samples.length < this.options.minimumSamples
      || !(baselineQuoteUsd > 0)
      || quoteUsd < this.options.minimumQuoteUsd
      || quoteUsd < baselineQuoteUsd * this.options.minimumMultiple
    ) return;

    const previous = state.latestStrong;
    const moved = Boolean(
      previous
      && at - previous.observedAt <= this.options.moveWindowMs
      && previous.price !== price
      && sizeSimilarityPercent(previous.quoteUsd, quoteUsd) <= this.options.similarityPercent
    );
    state.strongTouches.push({ price, quoteUsd, observedAt: at });
    state.strongTouches = state.strongTouches.filter(
      (touch) => at - touch.observedAt <= this.options.repeatWindowMs,
    );
    const comparableTouches = state.strongTouches.filter(
      (touch) => sizeSimilarityPercent(touch.quoteUsd, quoteUsd) <= this.options.similarityPercent,
    );
    state.latestStrong = {
      side,
      price,
      quoteUsd,
      baselineQuoteUsd,
      sizeMultiple: quoteUsd / baselineQuoteUsd,
      touchCount: comparableTouches.length,
      moved,
      fromPrice: moved ? previous.price : null,
      observedAt: at,
    };
  }

  ingest(ticker, now = Date.now()) {
    const symbol = normalizeUsdtPerpetualSymbol(ticker?.s);
    if (!symbol) return;
    const at = finite(ticker?.E) ?? now;
    const bidPrice = finite(ticker?.b);
    const bidQuantity = finite(ticker?.B);
    const askPrice = finite(ticker?.a);
    const askQuantity = finite(ticker?.A);
    if (bidPrice !== null && bidQuantity !== null) {
      this.#observe(symbol, "bid", bidPrice, bidQuantity, at);
    }
    if (askPrice !== null && askQuantity !== null) {
      this.#observe(symbol, "ask", askPrice, askQuantity, at);
    }
  }

  candidateFor(symbol, now = Date.now()) {
    const states = this.symbols.get(normalizeUsdtPerpetualSymbol(symbol));
    if (!states) return null;
    const candidates = [states.bid.latestStrong, states.ask.latestStrong]
      .filter((item) => item && now - item.observedAt <= this.options.lifetimeMs)
      .sort((left, right) => (
        right.sizeMultiple - left.sizeMultiple
        || right.touchCount - left.touchCount
        || right.observedAt - left.observedAt
      ));
    return candidates[0] ? Object.freeze({ ...candidates[0] }) : null;
  }
}

function normalizeKline(row) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const candle = {
    time: finite(row[0]),
    open: finite(row[1]),
    high: finite(row[2]),
    low: finite(row[3]),
    close: finite(row[4]),
    volume: Math.max(0, finite(row[5]) ?? 0),
    closeTime: finite(row[6]),
    closed: finite(row[6]) === null ? true : finite(row[6]) < Date.now(),
  };
  return [candle.time, candle.open, candle.high, candle.low, candle.close]
    .every((value) => value !== null && value > 0)
    ? candle
    : null;
}

export class SignalLabV3Collector {
  constructor({
    onEpisodes = () => {},
    onStatus = () => {},
    candidateSettings = {},
    maximumTrackedTrades = 32,
    maximumWarmupSymbols = 32,
  } = {}) {
    this.onEpisodes = onEpisodes;
    this.onStatus = onStatus;
    this.settings = { ...DEFAULT_CANDIDATE_SETTINGS, ...candidateSettings };
    this.maximumTrackedTrades = maximumTrackedTrades;
    this.maximumWarmupSymbols = maximumWarmupSymbols;
    this.socket = null;
    this.bookSocket = null;
    this.requestId = 1;
    this.bookRequestId = 1;
    this.reconnectAttempt = 0;
    this.bookReconnectAttempt = 0;
    this.reconnectTimer = null;
    this.bookReconnectTimer = null;
    this.connectionTimer = null;
    this.corePacketTimer = null;
    this.bookConnectionTimer = null;
    this.manualClose = false;
    this.symbols = new Map();
    this.bookTracker = new ExpertBookCandidateTracker(this.settings);
    this.episodes = new CandidateEpisodeTracker(this.settings);
    this.extremes = new SignalLabV4ExtremeRegistry();
    this.levels = new SignalLabV4LevelBreakoutRegistry();
    this.cascades = new SignalLabV4CascadeRegistry();
    this.tickSizes = new Map();
    this.exchangeInfoPromise = null;
    this.orderFlow = new SignalLabV4OrderFlowRecorder({ maximumSymbols: 6 });
    this.evidence = new SignalLabV3EvidenceRecorder({
      maximumDepthSymbols: 0,
      orderFlowRecorder: this.orderFlow,
      disableLegacyDepth: true,
    });
    this.trackedAggTrades = new Set();
    this.historyLoaded = new Set();
    this.historyLoading = new Set();
    this.historyRetryAt = new Map();
    this.lastClosedMinuteAt = new Map();
    this.lastSubscriptionRefreshAt = 0;
    this.lastCheckAt = 0;
    this.checkTimer = null;
    this.pendingCheckAt = null;
    this.structureTradeAt = new Map();
    this.statusNotifyTimer = null;
    this.lastStatusNotifiedAt = 0;
    this.statusState = {
      formulaVersion: SIGNAL_LAB_V3_FORMULA_VERSION,
      connection: "idle",
      startedAt: null,
      lastMessageAt: null,
      lastBookMessageAt: null,
      lastCheckAt: null,
      marketPackets: 0,
      miniTickerPackets: 0,
      bookPackets: 0,
      aggTradePackets: 0,
      subscriptionErrors: 0,
      checks: 0,
      createdEpisodes: 0,
      updatedEpisodes: 0,
      expiredEpisodes: 0,
      symbols: 0,
      trackedTrades: 0,
      warmupLoaded: 0,
      warmupLoading: 0,
      evidencePacks: 0,
      depthTracked: 0,
      depthState: "idle",
      extremeMaps: 0,
      activeExtremes: 0,
      levelMaps: 0,
      breakoutEvents: 0,
      cascadeSetups: 0,
      cascadeTriggered: 0,
      cascadeConfirmed: 0,
      tickSizes: 0,
      lastError: null,
    };
  }

  connect() {
    this.manualClose = false;
    this.exchangeInfoPromise ??= this.#loadExchangeInfo();
    this.#connectMarket();
    this.#connectBook();
  }

  #connectMarket() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimer);
    clearTimeout(this.corePacketTimer);
    if (this.manualClose) return;
    this.#publish({
      connection: "connecting",
      startedAt: this.statusState.startedAt ?? Date.now(),
      lastError: null,
    });
    const checksAtOpen = this.statusState.checks;
    const socket = new WebSocket(BINANCE_MARKET_STREAM_ENDPOINT);
    this.socket = socket;
    this.connectionTimer = setTimeout(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.CONNECTING) return;
      this.#publish({ connection: "error", lastError: "Binance market не отвечает более 10 секунд" });
      socket.close();
    }, CONNECTION_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectionTimer);
      this.reconnectAttempt = 0;
      this.#publish({ connection: "syncing", lastError: null });
      this.#send("SUBSCRIBE", [
        "!miniTicker@arr",
        "!markPrice@arr@1s",
        "!forceOrder@arr",
      ]);
      if (this.trackedAggTrades.size) {
        this.#send("SUBSCRIBE", [...this.trackedAggTrades].map(
          (symbol) => `${symbol.toLowerCase()}@aggTrade`,
        ));
      }
      this.corePacketTimer = setTimeout(() => {
        if (this.socket !== socket || this.statusState.checks !== checksAtOpen) return;
        this.#publish({
          connection: "error",
          lastError: "Сокет открыт, но обязательный miniTicker не поступает",
        });
        socket.close();
      }, 7_000);
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (Number.isFinite(Number(payload?.code))) {
        this.#publish({
          connection: "error",
          subscriptionErrors: this.statusState.subscriptionErrors + 1,
          lastError: `Binance subscription: ${String(payload?.msg ?? payload.code).slice(0, 140)}`,
        });
        socket.close();
        return;
      }
      if (payload?.result === null || (payload?.id && payload?.result !== undefined)) return;
      const data = payload?.data ?? payload;
      const receivedAt = Date.now();
      const hasMiniTicker = Array.isArray(data) && data.some((row) => (
        row?.e === "24hrMiniTicker"
        && isUsdtPerpetualSymbol(row.s)
        && finite(row.c) > 0
      ));
      const aggTradePackets = Array.isArray(data)
        ? data.filter((row) => row?.e === "aggTrade").length
        : data?.e === "aggTrade" ? 1 : 0;
      const patch = {
        lastMessageAt: receivedAt,
        marketPackets: this.statusState.marketPackets + 1,
        aggTradePackets: this.statusState.aggTradePackets + aggTradePackets,
      };
      if (hasMiniTicker) {
        clearTimeout(this.corePacketTimer);
        patch.connection = "live";
        patch.miniTickerPackets = this.statusState.miniTickerPackets + 1;
        patch.lastError = null;
      }
      this.#publish(patch);
      this.#handle(data);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.manualClose) return;
      clearTimeout(this.connectionTimer);
      clearTimeout(this.corePacketTimer);
      this.reconnectAttempt += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
      this.#publish({ connection: "reconnecting" });
      this.reconnectTimer = setTimeout(() => this.#connectMarket(), delay);
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectionTimer);
      clearTimeout(this.corePacketTimer);
      this.#publish({ connection: "error", lastError: "Ошибка market-потока Binance" });
    });
  }

  #connectBook() {
    clearTimeout(this.bookReconnectTimer);
    clearTimeout(this.bookConnectionTimer);
    if (this.manualClose) return;
    const socket = new WebSocket(BINANCE_PUBLIC_STREAM_ENDPOINT);
    this.bookSocket = socket;
    this.bookConnectionTimer = setTimeout(() => {
      if (this.bookSocket !== socket || socket.readyState !== WebSocket.CONNECTING) return;
      socket.close();
    }, CONNECTION_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (this.bookSocket !== socket) return;
      clearTimeout(this.bookConnectionTimer);
      this.bookReconnectAttempt = 0;
      socket.send(JSON.stringify({
        method: "SUBSCRIBE",
        params: ["!bookTicker"],
        id: this.bookRequestId++,
      }));
    });

    socket.addEventListener("message", (event) => {
      if (this.bookSocket !== socket) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (Number.isFinite(Number(payload?.code))) {
        this.#publish({
          subscriptionErrors: this.statusState.subscriptionErrors + 1,
          lastError: `Binance book subscription: ${String(payload?.msg ?? payload.code).slice(0, 140)}`,
        });
        socket.close();
        return;
      }
      if (payload?.result === null || (payload?.id && payload?.result !== undefined)) return;
      const raw = payload?.data ?? payload;
      const normalizeBook = (row) => {
        if (!row || typeof row !== "object") return row;
        if (row.e === "bookTicker") return row;
        if (
          isUsdtPerpetualSymbol(row.s)
          && finite(row.b) !== null
          && finite(row.B) !== null
          && finite(row.a) !== null
          && finite(row.A) !== null
        ) return { ...row, e: "bookTicker", E: finite(row.E) ?? Date.now() };
        return row;
      };
      const data = Array.isArray(raw) ? raw.map(normalizeBook) : normalizeBook(raw);
      this.#publish({
        lastBookMessageAt: Date.now(),
        bookPackets: this.statusState.bookPackets + 1,
      });
      this.#handle(data);
    });

    socket.addEventListener("close", () => {
      if (this.bookSocket !== socket || this.manualClose) return;
      clearTimeout(this.bookConnectionTimer);
      this.bookReconnectAttempt += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.bookReconnectAttempt, 5));
      this.bookReconnectTimer = setTimeout(() => this.#connectBook(), delay);
    });

    socket.addEventListener("error", () => {
      if (this.bookSocket !== socket) return;
      clearTimeout(this.bookConnectionTimer);
    });
  }

  disconnect() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.bookReconnectTimer);
    clearTimeout(this.connectionTimer);
    clearTimeout(this.corePacketTimer);
    clearTimeout(this.bookConnectionTimer);
    clearTimeout(this.checkTimer);
    clearTimeout(this.statusNotifyTimer);
    this.checkTimer = null;
    this.statusNotifyTimer = null;
    this.pendingCheckAt = null;
    this.socket?.close();
    this.bookSocket?.close();
    this.socket = null;
    this.bookSocket = null;
    this.evidence.disconnect();
    this.orderFlow.disconnect();
    this.#publish({ connection: "stopped", depthState: "stopped", depthTracked: 0 });
  }

  status() {
    return Object.freeze({ ...this.statusState });
  }

  #send(method, params) {
    if (this.socket?.readyState !== WebSocket.OPEN || !params.length) return;
    this.socket.send(JSON.stringify({ method, params, id: this.requestId++ }));
  }

  #symbol(symbol, now = Date.now()) {
    const normalized = normalizeUsdtPerpetualSymbol(symbol);
    if (!normalized) return null;
    if (!this.symbols.has(normalized)) this.symbols.set(normalized, new SymbolState(normalized, now));
    return this.symbols.get(normalized);
  }

  #handle(data) {
    if (Array.isArray(data)) {
      let hasMiniTicker = false;
      for (const row of data) {
        if (row?.e === "bookTicker" && isUsdtPerpetualSymbol(row.s)) {
          this.bookTracker.ingest(row);
          continue;
        }
        if (row?.e === "markPriceUpdate" && isUsdtPerpetualSymbol(row.s)) {
          this.#symbol(row.s, finite(row.E) ?? Date.now())?.updateFunding(row);
          continue;
        }
        if (!filterUsdtPerpetualTicker(row)) continue;
        this.#symbol(row.s, finite(row.E) ?? Date.now())?.updateTicker(row);
        hasMiniTicker = true;
      }
      if (hasMiniTicker) this.#scheduleCheck(Date.now());
      return;
    }
    if (!data || typeof data !== "object") return;
    if (data.e === "bookTicker" && isUsdtPerpetualSymbol(data.s)) {
      this.bookTracker.ingest(data);
      if (this.trackedAggTrades.has(data.s)) {
        this.#symbol(data.s, finite(data.E) ?? Date.now())?.updateBookTicker(data);
      }
      return;
    }
    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data)) {
      const receivedAt = Date.now();
      const eventAt = finite(data.T) ?? finite(data.E) ?? receivedAt;
      const dataQuality = receivedAt - (finite(data.E) ?? receivedAt) <= 5_000 ? "LIVE" : "STALE";
      const tickSize = this.tickSizes.get(data.s) ?? null;
      this.#symbol(data.s)?.updateTrade(data);
      this.orderFlow.ingestTrade(data, receivedAt);
      const previousStructureAt = this.structureTradeAt.get(data.s) ?? 0;
      if (receivedAt - previousStructureAt < STRUCTURE_TRADE_INTERVAL_MS) return;
      this.structureTradeAt.set(data.s, receivedAt);
      if (tickSize) {
        const levelMap = this.levels.ingestPrice(data.s, finite(data.p), eventAt, {
          tickSize,
          dataQuality,
          source: "AGG_TRADE",
        });
        this.cascades.sync(data.s, levelMap, {
          currentPrice: finite(data.p),
          at: eventAt,
          dataQuality,
        });
      }
      // Trades may invalidate or retest an already confirmed level, but they must
      // never manufacture 1m/5m/15m/1h/4h/1d extrema. New extrema are confirmed only
      // by closed candles in the corresponding timeframe.
      this.extremes.observePrice(data.s, finite(data.p), eventAt, {
        dataQuality,
        emitSnapshot: false,
      });
      return;
    }
    if (data.e === "forceOrder") {
      const symbol = data?.o?.s;
      if (isUsdtPerpetualSymbol(symbol)) this.#symbol(symbol)?.updateLiquidation(data);
    }
  }

  #metrics(now) {
    return [...this.symbols.values()]
      .map((state) => {
        const metrics = state.metrics(DEFAULT_SETTINGS, now);
        const tickSize = this.tickSizes.get(metrics.symbol) ?? null;
        const dataQuality = now - (finite(metrics.updatedAt) ?? 0) <= 5_000 ? "LIVE" : "STALE";
        const closedMinuteCandles = Array.isArray(metrics.minuteCandles)
          ? metrics.minuteCandles.slice(0, -1)
          : [];
        const structureReady = Boolean(
          tickSize
          && (this.historyLoaded.has(metrics.symbol) || this.trackedAggTrades.has(metrics.symbol))
        );
        const latestClosedMinute = closedMinuteCandles.at(-1) ?? null;
        const previousClosedMinuteAt = this.lastClosedMinuteAt.get(metrics.symbol) ?? null;
        const hasNewClosedMinute = Boolean(
          structureReady
          && latestClosedMinute
          && (previousClosedMinuteAt === null || latestClosedMinute.time > previousClosedMinuteAt)
        );
        if (hasNewClosedMinute) {
          this.extremes.hydrate(metrics.symbol, "1m", [latestClosedMinute], {
            tickSize,
            dataQuality,
          });
          this.lastClosedMinuteAt.set(metrics.symbol, latestClosedMinute.time);
        }
        const extremeMap = structureReady
          ? this.extremes.snapshot(metrics.symbol, { includeHistory: false, includeEvents: false })
          : null;
        const atr1m = structureReady ? atrFromClosedCandles(closedMinuteCandles) : null;
        if (hasNewClosedMinute) {
          this.levels.ingestCandle(metrics.symbol, latestClosedMinute, {
            tickSize,
            atr: atr1m,
            dataQuality,
          });
        }
        const levelMap = structureReady
          ? this.levels.sync(metrics.symbol, extremeMap, {
            tickSize,
            atr: atr1m,
            currentPrice: metrics.price,
            at: now,
            dataQuality,
          })
          : null;
        if (levelMap && closedMinuteCandles.length) {
          this.cascades.ingestCandle(metrics.symbol, closedMinuteCandles.at(-1), {
            atr: atr1m,
            dataQuality,
          });
        }
        const cascadeMap = levelMap
          ? this.cascades.sync(metrics.symbol, levelMap, {
            currentPrice: metrics.price,
            at: now,
            atr: atr1m,
            dataQuality,
          })
          : null;
        return {
          ...metrics,
          tickSize,
          extremeMap,
          levelMap,
          cascadeMap,
          bookCandidate: this.bookTracker.candidateFor(metrics.symbol, now),
        };
      });
  }

  #scheduleCheck(now) {
    const elapsed = now - this.lastCheckAt;
    if (elapsed >= CHECK_INTERVAL_MS && !this.checkTimer) {
      this.lastCheckAt = now;
      this.#check(now);
      return;
    }
    this.pendingCheckAt = now;
    if (this.checkTimer) return;
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      const scheduledAt = this.pendingCheckAt ?? Date.now();
      this.pendingCheckAt = null;
      this.lastCheckAt = scheduledAt;
      this.#check(scheduledAt);
    }, Math.max(0, CHECK_INTERVAL_MS - elapsed));
  }

  #check(now) {
    const metrics = this.#metrics(now);
    const result = this.episodes.ingest(metrics, now);
    const evidenceResult = this.evidence.ingest({ metricsRows: metrics, result, now });
    this.onEpisodes(evidenceResult, metrics);
    this.#refreshTrackedTrades(metrics, now);
    const evidenceStatus = this.evidence.status();
    const activeExtremes = metrics.reduce((sum, row) => (
      sum + Object.values(row.extremeMap?.timeframes ?? {}).reduce(
        (timeframeSum, map) => timeframeSum + (map?.active?.length ?? 0),
        0,
      )
    ), 0);
    this.#publish({
      lastCheckAt: now,
      checks: this.statusState.checks + 1,
      createdEpisodes: this.statusState.createdEpisodes + result.created.length,
      updatedEpisodes: this.statusState.updatedEpisodes + result.updated.length,
      expiredEpisodes: this.statusState.expiredEpisodes + result.expired.length,
      symbols: metrics.length,
      evidencePacks: evidenceStatus.evidencePacks,
      depthTracked: evidenceStatus.depth.trackedSymbols ?? 0,
      depthState: evidenceStatus.depth.connection ?? "idle",
      extremeMaps: metrics.filter((row) => Object.values(row.extremeMap?.timeframes ?? {})
        .some((map) => (map?.active?.length ?? 0) > 0)).length,
      activeExtremes,
      levelMaps: metrics.filter((row) => (row.levelMap?.activeZones?.length ?? 0) > 0).length,
      breakoutEvents: metrics.reduce((sum, row) => sum + (row.levelMap?.activeEvents?.length ?? 0), 0),
      cascadeSetups: metrics.reduce((sum, row) => sum + (row.cascadeMap?.active?.filter((event) => event.state === "SETUP").length ?? 0), 0),
      cascadeTriggered: metrics.reduce((sum, row) => sum + (row.cascadeMap?.active?.filter((event) => event.state === "TRIGGERED").length ?? 0), 0),
      cascadeConfirmed: metrics.reduce((sum, row) => sum + (row.cascadeMap?.active?.filter((event) => ["CONFIRMED", "EXTENDED"].includes(event.state)).length ?? 0), 0),
      tickSizes: this.tickSizes.size,
    });
    this.#queueWarmup(metrics);
  }

  #refreshTrackedTrades(metrics, now) {
    if (now - this.lastSubscriptionRefreshAt < 5_000) return;
    this.lastSubscriptionRefreshAt = now;
    const activeSymbols = new Set([...this.episodes.active.values()].map((episode) => episode.symbol));
    const ranked = metrics
      .filter((row) => (
        (finite(row.quoteVolume24h) ?? 0) > this.settings.minimumQuoteVolume24h
        && (finite(row.natr5m) ?? 0) > this.settings.minimumNatr5Percent
      ))
      .sort((left, right) => candidateWatchScore(right, this.settings) - candidateWatchScore(left, this.settings));
    const next = new Set([
      ...activeSymbols,
      ...ranked.slice(0, this.maximumTrackedTrades).map((row) => row.symbol),
    ]);
    const subscribe = [...next].filter((symbol) => !this.trackedAggTrades.has(symbol));
    const unsubscribe = [...this.trackedAggTrades].filter((symbol) => !next.has(symbol));
    this.trackedAggTrades = next;
    const setupRanked = [...ranked].sort((left, right) => (
      this.cascades.watchScore(right.symbol, right.price)
      - this.cascades.watchScore(left.symbol, left.price)
      || this.levels.watchScore(right.symbol, right.price)
      - this.levels.watchScore(left.symbol, left.price)
      || this.extremes.watchScore(right.symbol, right.price)
      - this.extremes.watchScore(left.symbol, left.price)
      || candidateWatchScore(right, this.settings) - candidateWatchScore(left, this.settings)
    ));
    const orderFlowSymbols = [...new Set([
      ...activeSymbols,
      ...setupRanked.slice(0, 6).map((row) => row.symbol),
    ])].slice(0, 6);
    this.orderFlow.setSymbols(orderFlowSymbols);
    this.evidence.setWatchSymbols(orderFlowSymbols, now);
    if (unsubscribe.length) {
      this.#send("UNSUBSCRIBE", unsubscribe.map((symbol) => `${symbol.toLowerCase()}@aggTrade`));
    }
    if (subscribe.length) {
      this.#send("SUBSCRIBE", subscribe.map((symbol) => `${symbol.toLowerCase()}@aggTrade`));
    }
    this.#publish({ trackedTrades: next.size });
  }

  #queueWarmup(metrics) {
    const now = Date.now();
    const activeSymbols = [...new Set([...this.episodes.active.values()].map((episode) => episode.symbol))];
    const ranked = metrics
      .filter((row) => (finite(row.quoteVolume24h) ?? 0) > this.settings.minimumQuoteVolume24h)
      .sort((left, right) => (
        candidateWatchScore(right, this.settings) - candidateWatchScore(left, this.settings)
        || (finite(right.quoteVolume24h) ?? 0) - (finite(left.quoteVolume24h) ?? 0)
      ));
    const prioritized = [...new Set([
      ...activeSymbols,
      ...this.trackedAggTrades,
      ...ranked.map((row) => row.symbol),
    ])].slice(0, this.maximumWarmupSymbols);
    const availableSlots = Math.max(0, 3 - this.historyLoading.size);
    const pending = prioritized
      .filter((symbol) => !this.historyLoaded.has(symbol) && !this.historyLoading.has(symbol))
      .filter((symbol) => (this.historyRetryAt.get(symbol) ?? 0) <= now)
      .slice(0, availableSlots);
    for (const symbol of pending) this.#warmupSymbol(symbol);
  }

  async #loadExchangeInfo() {
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
        this.levels.setTickSize(symbol, tickSize);
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
      this.historyRetryAt.delete(symbol);
      this.#publish({
        warmupLoaded: this.historyLoaded.size,
        lastError: null,
      });
    } catch (error) {
      // Do not hammer Binance every second after 429/CORS/network failure.
      this.historyRetryAt.set(symbol, Date.now() + 60_000);
      this.#publish({ lastError: String(error?.message ?? error).slice(0, 180) });
    } finally {
      this.historyLoading.delete(symbol);
      this.#publish({ warmupLoading: this.historyLoading.size });
    }
  }

  #publish(patch = {}) {
    Object.assign(this.statusState, patch);
    const now = Date.now();
    const urgent = Object.prototype.hasOwnProperty.call(patch, "connection")
      || (Object.prototype.hasOwnProperty.call(patch, "lastError") && patch.lastError);
    const notify = () => {
      clearTimeout(this.statusNotifyTimer);
      this.statusNotifyTimer = null;
      this.lastStatusNotifiedAt = Date.now();
      try {
        this.onStatus(Object.freeze({ ...this.statusState }));
      } catch {
        // UI callbacks must not interrupt the collector.
      }
    };
    if (urgent || now - this.lastStatusNotifiedAt >= STATUS_NOTIFY_INTERVAL_MS) {
      notify();
      return;
    }
    if (this.statusNotifyTimer) return;
    this.statusNotifyTimer = setTimeout(
      notify,
      STATUS_NOTIFY_INTERVAL_MS - (now - this.lastStatusNotifiedAt),
    );
  }
}
