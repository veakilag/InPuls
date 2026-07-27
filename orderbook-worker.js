importScripts("./orderbook-tape-guard.js?v=1");
importScripts("./orderbook-tape-latency.js?v=26-28-resume-v2");

const MAX_BOOK_LEVELS_PER_SIDE = 20_000;
const MAX_EMITTED_LEVELS_PER_SIDE = 4_000;
const MAX_BUFFERED_DEPTH_EVENTS = 4_000;
const MAX_TRADE_HISTORY = 12_000;
const MAX_PERSISTED_TRADE_HISTORY = 5_000;
const MAX_TAPE_SNAPSHOT = 1_200;
const MAX_RESUME_TAPE_SNAPSHOT = 80;
const MAX_RESUME_LEVELS_PER_SIDE = 700;
const RESUME_STAGGER_MS = 180;
const BACKGROUND_GRACE_MS = 2_000;
const RECOVERY_TIMEOUT_MS = 8_000;
const RESUME_STALE_MS = 3_500;
const RESUME_TAPE_WINDOW_MS = 75_000;
const DEPTH_STALE_NOTICE_MS = 3_000;
const ACTIVE_STALE_MS = 9_000;
const SNAPSHOT_TIMEOUT_MS = 2_800;
const IDLE_CLOSE_MS = 10_000;
const TRADE_FIRST_MESSAGE_TIMEOUT_MS = 8_000;
const TRADE_BOOTSTRAP_LIMIT = 120;
const MAX_TAPE_BATCH_PER_POST = 500;
const TAPE_FLUSH_MS = 25;
const RECONNECT_BASE_MS = 400;
const RECONNECT_MAX_MS = 8_000;
const WORKER_HEARTBEAT_MS = 2_000;
const CLOCK_SYNC_INTERVAL_MS = 5 * 60_000;

const feeds = new Map();
let tabVisible = true;
let emitTimer = 0;
let emitCursor = 0;
let visibilityEpoch = 0;
let backgroundPauseTimer = 0;
let watchdogTimer = 0;
let prioritySymbols = [];
let serverClockOffsetMs = null;
let serverClockRttMs = null;
let serverClockSyncAt = 0;
let serverClockSyncPromise = null;
let observabilityEnabled = false;
let observabilityPostCount = 0;

function post(type, symbol, payload = {}, processStartedAt = null) {
  if (!observabilityEnabled) {
    self.postMessage({ type, symbol, ...payload });
    return;
  }
  const observerStartedAt = performance.now();
  const message = { type, symbol, ...payload };
  const samplePayload = observabilityPostCount++ % 50 === 0;
  let payloadBytes = null;
  if (samplePayload) {
    try { payloadBytes = new Blob([JSON.stringify(message)]).size; } catch {}
  }
  const exchangeEventTime = Number(payload?.data?.eventTime ?? payload?.trades?.[0]?.eventTime);
  message.__obs = {
    sentAt: performance.now(),
    processMs: Number.isFinite(processStartedAt) ? performance.now() - processStartedAt : null,
    observerOverheadMs: performance.now() - observerStartedAt,
    payloadBytes,
    payloadSampleRate: 50,
    exchangeEventTime: Number.isFinite(exchangeEventTime) ? exchangeEventTime : null,
  };
  self.postMessage(message);
}

function reconnectDelay(attempt = 0) {
  const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.max(0, attempt)));
  const jitter = Math.floor(Math.random() * Math.max(80, exponential * .25));
  return exponential + jitter;
}

function parsePayload(raw) {
  let payload;
  try { payload = JSON.parse(raw); } catch { return null; }
  if (payload?.result === null || payload?.id) return null;
  return { stream: String(payload?.stream ?? ""), data: payload?.data ?? payload };
}

function applyDepthUpdates(levels, updates) {
  for (const row of updates ?? []) {
    const price = Number(row?.[0]);
    const quantity = Number(row?.[1]);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
    if (quantity === 0) levels.delete(price);
    else levels.set(price, quantity);
  }
}

function normalizeTrade(event, sourceHint = null, receivedAt = null) {
  const eventType = String(event?.e ?? "").toLowerCase();
  const inferredRaw = eventType === "trade"
    || (Number.isFinite(Number(event?.t)) && !Number.isFinite(Number(event?.a)));
  const source = sourceHint === "raw" || (sourceHint !== "agg" && inferredRaw) ? "raw" : "agg";
  const price = Number(event?.p);
  const quantity = Number(event?.q);
  const timing = self.InPulsTapeLatency.normalizeTiming(event, receivedAt, serverClockOffsetMs);
  const time = timing.tradeTime;
  const id = source === "raw" ? Number(event?.t) : Number(event?.a);
  const firstTradeId = source === "raw" ? id : Number(event?.f);
  const lastTradeId = source === "raw" ? id : Number(event?.l);
  if (![price, quantity, time, id, firstTradeId, lastTradeId].every(Number.isFinite)) return null;
  if (price <= 0 || quantity <= 0 || time <= 0) return null;
  if (![id, firstTradeId, lastTradeId].every(Number.isInteger) || id < 0 || firstTradeId < 0 || lastTradeId < firstTradeId) return null;
  return {
    id,
    firstTradeId,
    lastTradeId,
    source,
    price,
    quantity,
    quote: price * quantity,
    time,
    tradeTime: timing.tradeTime,
    eventTime: timing.eventTime,
    receivedAt: timing.receivedAt,
    rxLatencyMs: timing.rxLatencyMs,
    side: event?.m ? "sell" : "buy",
  };
}

function sequenceDecision(lastUpdateId, event, firstEvent = false) {
  const first = Number(event?.U);
  const final = Number(event?.u);
  const previous = Number(event?.pu);
  const local = Number(lastUpdateId);
  if (![first, final, local].every(Number.isFinite)) return "resync";
  if (final <= local) return "ignore";
  if (firstEvent) return first <= local + 1 && final >= local + 1 ? "apply" : "resync";
  if (Number.isFinite(previous) && previous !== local) return "resync";
  if (!Number.isFinite(previous) && first > local + 1) return "resync";
  return "apply";
}

function mergeTradeCoverage(trades) {
  const ranges = [];
  for (const trade of trades ?? []) {
    const first = Number(trade?.firstTradeId);
    const last = Number(trade?.lastTradeId);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first) continue;
    ranges.push([first, last]);
  }
  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  const merged = [];
  for (const [first, last] of ranges) {
    const previous = merged.at(-1);
    if (!previous || first > previous[1] + 1) merged.push([first, last]);
    else previous[1] = Math.max(previous[1], last);
  }
  return merged;
}

function tradeCoverageOverlaps(ranges, firstTradeId, lastTradeId) {
  const first = Number(firstTradeId);
  const last = Number(lastTradeId);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first) return false;

  let low = 0;
  let high = (ranges?.length ?? 0) - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (last < range[0]) high = middle - 1;
    else if (first > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

function addTradeCoverage(ranges, firstTradeId, lastTradeId) {
  let first = Number(firstTradeId);
  let last = Number(lastTradeId);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first) return ranges;

  let index = 0;
  while (index < ranges.length && ranges[index][1] + 1 < first) index += 1;
  while (index < ranges.length && ranges[index][0] <= last + 1) {
    first = Math.min(first, ranges[index][0]);
    last = Math.max(last, ranges[index][1]);
    ranges.splice(index, 1);
  }
  ranges.splice(index, 0, [first, last]);
  return ranges;
}

async function fetchJson(url, timeoutMs = SNAPSHOT_TIMEOUT_MS) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    const request = fetch(url, {
      cache: "no-store",
      ...(controller ? { signal: controller.signal } : {}),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function syncServerClock(force = false) {
  const now = Date.now();
  if (
    !force
    && Number.isFinite(serverClockOffsetMs)
    && now - serverClockSyncAt < CLOCK_SYNC_INTERVAL_MS
  ) return serverClockOffsetMs;
  if (serverClockSyncPromise) return serverClockSyncPromise;

  serverClockSyncPromise = (async () => {
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
    const samples = [];
    for (const host of hosts) {
      const startedAt = Date.now();
      try {
        const data = await fetchJson(`https://${host}/fapi/v1/time`, 1_800);
        const finishedAt = Date.now();
        const serverTime = Number(data?.serverTime);
        if (!Number.isFinite(serverTime)) continue;
        const rtt = Math.max(0, finishedAt - startedAt);
        samples.push({
          rtt,
          offset: serverTime - (startedAt + finishedAt) / 2,
        });
      } catch {}
    }
    samples.sort((left, right) => left.rtt - right.rtt);
    const best = samples[0];
    if (best) {
      serverClockOffsetMs = best.offset;
      serverClockRttMs = best.rtt;
      serverClockSyncAt = Date.now();
    }
    return serverClockOffsetMs;
  })().finally(() => {
    serverClockSyncPromise = null;
  });
  return serverClockSyncPromise;
}

class TradeStore {
  constructor() { this.dbPromise = null; }
  open() {
    if (!self.indexedDB) return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      const request = indexedDB.open("inpuls-market-trades-v3", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("symbols")) {
          request.result.createObjectStore("symbols", { keyPath: "symbol" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return this.dbPromise;
  }
  async get(symbol) {
    const db = await this.open();
    if (!db) return [];
    return new Promise((resolve) => {
      const request = db.transaction("symbols", "readonly").objectStore("symbols").get(symbol);
      request.onsuccess = () => resolve(Array.isArray(request.result?.trades) ? request.result.trades : []);
      request.onerror = () => resolve([]);
    });
  }
  async set(symbol, trades) {
    const db = await this.open();
    if (!db) return;
    await new Promise((resolve) => {
      const transaction = db.transaction("symbols", "readwrite");
      transaction.objectStore("symbols").put({
        symbol,
        trades: trades.slice(0, MAX_PERSISTED_TRADE_HISTORY),
        updatedAt: Date.now(),
      });
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
    });
  }
}

const tradeStore = new TradeStore();

function depthTransports(symbol, mode) {
  const stream = `${symbol.toLowerCase()}@${mode === "partial" ? "depth20" : "depth"}@100ms`;
  return [
    { url: `wss://fstream.binance.com/ws/${stream}`, subscribe: false, stream },
    { url: `wss://fstream.binance.com/stream?streams=${stream}`, subscribe: false, stream },
    { url: "wss://fstream.binance.com/ws", subscribe: true, stream },
    { url: `wss://stream.binancefuture.com/ws/${stream}`, subscribe: false, stream },
  ];
}

function tradeStreams(symbol) {
  const name = symbol.toLowerCase();
  return [`${name}@trade`, `${name}@aggTrade`];
}

function tradeTransports(streams) {
  const joined = streams.join("/");
  return [
    { name: "standard · combined", url: `wss://fstream.binance.com/stream?streams=${joined}`, subscribe: false, streams },
    { name: "market · combined", url: `wss://fstream.binance.com/market/stream?streams=${joined}`, subscribe: false, streams },
    { name: "standard · subscribe", url: "wss://fstream.binance.com/ws", subscribe: true, streams },
    { name: "market · subscribe", url: "wss://fstream.binance.com/market/stream", subscribe: true, streams },
    { name: "alt · combined", url: `wss://stream.binancefuture.com/stream?streams=${joined}`, subscribe: false, streams },
  ];
}

function trimSide(levels, side, limit) {
  if (levels.size <= limit) return;
  const keys = [...levels.keys()].sort(side === "bid" ? (a, b) => b - a : (a, b) => a - b);
  for (const price of keys.slice(limit)) levels.delete(price);
}

class SymbolFeed {
  constructor(symbol) {
    this.symbol = symbol;
    this.subscribers = 0;
    this.closeTimer = 0;
    this.socket = null;
    this.tradeSocket = null;
    this.reconnectTimer = 0;
    this.tradeReconnectTimer = 0;
    this.tradeFirstMessageTimer = 0;
    this.firstDepthTimer = 0;
    this.snapshotTimer = 0;
    this.tradeSaveTimer = 0;
    this.mode = "deep";
    this.transportIndex = 0;
    this.tradeTransportIndex = 0;
    this.generation = 0;
    this.bids = new Map();
    this.asks = new Map();
    this.partialBidKeys = new Set();
    this.partialAskKeys = new Set();
    this.depthBuffer = [];
    this.pendingSnapshot = null;
    this.lastUpdateId = null;
    this.depthReady = false;
    this.snapshotLoading = false;
    this.resyncCount = 0;
    this.dirty = false;
    this.forceEmit = false;
    this.lastEmitAt = 0;
    this.cachedSorted = null;
    this.statusKey = "";
    this.trades = [];
    this.tradeIds = new Set();
    this.tapeBatch = [];
    this.tapeTimer = 0;
    this.resumeTimer = 0;
    this.backgroundPaused = false;
    this.lastDepthAt = 0;
    this.lastTradeAt = 0;
    this.lastMessageAt = 0;
    this.lastRestartAt = 0;
    this.syncing = false;
    this.tradeBootstrapRequest = 0;
    this.tradeLive = false;
    this.tradeConnected = false;
    this.depthReconnectAttempt = 0;
    this.tradeReconnectAttempt = 0;
    this.lastResyncAt = 0;
    this.tradeTransportName = "—";
    this.tapeGuard = new self.InPulsTapeGuard({ rawWarmupTrades: 6, rawStaleMs: 1_500 });
    this.tradeLatency = new self.InPulsTapeLatency.RollingLatency({ windowMs: 2_000, maxSamples: 400, updateMs: 250 });
  }

  tradeBoundary() {
    let boundary = null;
    for (const trade of this.trades) {
      const value = Number(trade?.lastTradeId);
      if (Number.isInteger(value) && value >= 0) boundary = boundary === null ? value : Math.max(boundary, value);
    }
    return boundary;
  }

  resetTapeGuard() {
    this.tapeGuard.reset({ lastOutputTradeId: this.tradeBoundary() });
  }

  addSubscriber() {
    const wasZero = this.subscribers === 0;
    const wasCoolingDown = Boolean(this.closeTimer);
    this.subscribers += 1;
    clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    if (wasZero && !wasCoolingDown) this.start();
    else this.refresh();
  }

  removeSubscriber() {
    this.subscribers = Math.max(0, this.subscribers - 1);
    if (this.subscribers > 0 || this.closeTimer) return;
    this.closeTimer = setTimeout(() => {
      this.closeTimer = 0;
      if (this.subscribers === 0) {
        this.stop();
        feeds.delete(this.symbol);
      }
    }, IDLE_CLOSE_MS);
  }

  start() {
    this.stopSockets();
    this.generation += 1;
    this.mode = "deep";
    this.transportIndex = 0;
    this.tradeTransportIndex = 0;
    this.depthReconnectAttempt = 0;
    this.tradeReconnectAttempt = 0;
    this.tradeLive = false;
    this.tradeConnected = false;
    this.tradeTransportName = "—";
    this.tradeLatency.reset();
    this.syncing = false;
    this.backgroundPaused = false;
    this.resetTapeGuard();
    this.resetBook();
    this.setStatus("loading", "Подключение Worker");
    const generation = this.generation;
    this.connectDepth(generation);
    this.connectTrades(generation);
    this.loadTradeHistory(generation);
    this.loadRecentTrades(generation);
  }

  stopSockets() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.tradeFirstMessageTimer);
    this.tradeFirstMessageTimer = 0;
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    try { this.socket?.close(); } catch {}
    try { this.tradeSocket?.close(); } catch {}
    this.socket = null;
    this.tradeSocket = null;
    this.tapeGuard.disconnect("socket-stop");
  }

  stop() {
    this.generation += 1;
    this.stopSockets();
    clearTimeout(this.tradeSaveTimer);
    clearTimeout(this.tapeTimer);
    clearTimeout(this.resumeTimer);
    if (this.trades.length) tradeStore.set(this.symbol, this.trades).catch(() => {});
  }

  resetBook() {
    this.bids.clear();
    this.asks.clear();
    this.partialBidKeys.clear();
    this.partialAskKeys.clear();
    this.depthBuffer = [];
    this.pendingSnapshot = null;
    this.lastUpdateId = null;
    this.depthReady = false;
    this.snapshotLoading = false;
    this.cachedSorted = null;
    this.dirty = false;
    this.lastDepthAt = 0;
  }

  setStatus(state, text) {
    const key = `${state}:${text}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    post("status", this.symbol, { state, text });
  }

  latencyText() {
    const latency = this.tradeLatency.current();
    return Number.isFinite(latency) ? ` · RX ${Math.round(latency)}ms` : "";
  }

  liveStatusText(tapeState = null) {
    const partial = this.mode === "partial" ? " · 20" : "";
    const reconnectingTape = tapeState === "reconnect" || (this.tradeLive && !this.tradeConnected);
    const tape = reconnectingTape
      ? " · TAPE RECONNECT"
      : (this.tradeLive && this.tradeConnected ? ` · ${this.tapeGuard.label()}` : "");
    return `LIVE 100ms · WORKER${partial}${tape}${this.latencyText()}`;
  }

  publishLiveStatus(tapeState = null) {
    if (this.syncing) {
      this.setStatus("stale", "СИНХРОНИЗАЦИЯ · последний кадр");
      return;
    }
    const depthAge = this.lastDepthAt ? Date.now() - this.lastDepthAt : Infinity;
    if (this.depthReady && depthAge > DEPTH_STALE_NOTICE_MS) {
      this.setStatus("stale", `STALE ${Math.max(1, Math.floor(depthAge / 1_000))}с · WORKER${this.tradeLive && this.tradeConnected ? ` · ${this.tapeGuard.label()}` : ""}`);
      return;
    }
    this.setStatus("online", this.liveStatusText(tapeState));
  }

  markDirty(force = false) {
    this.dirty = true;
    if (force) this.forceEmit = true;
    if (tabVisible) scheduleEmit();
  }

  refresh() {
    this.forceEmit = true;
    if (tabVisible) {
      scheduleEmit();
      post("tape", this.symbol, { replace: true, trades: this.trades.slice(0, MAX_TAPE_SNAPSHOT) });
    }
  }

  pauseForBackground() {
    if (this.subscribers <= 0 || this.backgroundPaused) return;
    this.backgroundPaused = true;
    const preserveLastFrame = this.depthReady || (this.bids.size > 0 && this.asks.size > 0);
    this.syncing = preserveLastFrame;
    this.generation += 1;
    this.tradeBootstrapRequest += 1;
    this.stopSockets();
    this.tradeConnected = false;
    this.tradeLive = false;
    this.tradeLatency.reset();
    this.tapeBatch = [];
    clearTimeout(this.tapeTimer);
    clearTimeout(this.resumeTimer);
    this.tapeTimer = 0;
    this.resumeTimer = 0;
    this.setStatus(
      preserveLastFrame ? "stale" : "loading",
      preserveLastFrame ? "СИНХРОНИЗАЦИЯ · последний кадр" : "Пауза Worker",
    );
  }

  resume(delayMs = 0, epoch = visibilityEpoch) {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = 0;
      if (!tabVisible || epoch !== visibilityEpoch || this.subscribers <= 0) return;

      const now = Date.now();
      const socketOpen = this.socket?.readyState === WebSocket.OPEN;
      const tradeOpen = this.tradeSocket?.readyState === WebSocket.OPEN;
      const depthFresh = this.lastDepthAt > 0 && now - this.lastDepthAt <= RESUME_STALE_MS;

      if (!this.backgroundPaused && socketOpen && depthFresh) {
        const resumeTrades = this.trades
          .filter((trade) => Number(trade?.time) >= now - RESUME_TAPE_WINDOW_MS)
          .slice(0, MAX_RESUME_TAPE_SNAPSHOT);
        post("tape", this.symbol, {
          replace: false,
          resume: true,
          trades: resumeTrades,
        });
        if (!tradeOpen && !this.tradeReconnectTimer) {
          this.connectTrades(this.generation);
        }
        this.forceEmit = true;
        this.emit(now, MAX_RESUME_LEVELS_PER_SIDE, true);
        this.publishLiveStatus(tradeOpen ? null : "reconnect");
        return;
      }

      this.backgroundPaused = false;
      this.restartAfterBackground(true);
    }, Math.max(0, delayMs));
  }

  restartAfterBackground(force = false) {
    if (this.subscribers <= 0) return;
    const now = Date.now();
    if (!force && now - this.lastRestartAt < 2_500) return;
    this.lastRestartAt = now;
    const preserveLastFrame = this.depthReady || (this.bids.size > 0 && this.asks.size > 0);
    this.syncing = preserveLastFrame;
    this.stopSockets();
    this.generation += 1;
    this.mode = "deep";
    this.transportIndex = 0;
    this.tradeTransportIndex = 0;
    this.depthReconnectAttempt = 0;
    this.tradeReconnectAttempt = 0;
    this.tradeLive = false;
    this.tradeConnected = false;
    this.tradeTransportName = "—";
    this.tapeGuard.disconnect("background-restart");
    this.resetBook();
    this.setStatus(
      preserveLastFrame ? "stale" : "loading",
      preserveLastFrame ? "СИНХРОНИЗАЦИЯ · последний кадр" : "Восстановление Worker",
    );
    const generation = this.generation;
    this.connectDepth(generation);
    this.connectTrades(generation);
    this.loadRecentTrades(generation, { resume: true });
  }

  ensureHealthy(now = Date.now()) {
    if (!tabVisible || this.subscribers <= 0) return;
    const recoveryDelayed = this.syncing
      && this.lastRestartAt > 0
      && now - this.lastRestartAt > RECOVERY_TIMEOUT_MS;
    if (recoveryDelayed) {
      this.setStatus("stale", "RECOVERY DELAY · повторное подключение");
      this.restartAfterBackground(true);
      return;
    }
    const socketOpen = this.socket?.readyState === WebSocket.OPEN;
    const socketConnecting = this.socket?.readyState === WebSocket.CONNECTING;
    const reconnectPending = Boolean(this.reconnectTimer || this.firstDepthTimer || this.snapshotLoading);
    const depthAge = this.lastDepthAt > 0 ? now - this.lastDepthAt : Infinity;
    const stale = this.depthReady && depthAge > ACTIVE_STALE_MS;

    if ((!socketOpen && !socketConnecting && !reconnectPending) || stale) {
      this.setStatus("offline", "RECONNECT · WORKER");
      this.restartAfterBackground();
      return;
    }

    if (this.depthReady && depthAge > DEPTH_STALE_NOTICE_MS) {
      this.setStatus("stale", `STALE ${Math.max(1, Math.floor(depthAge / 1_000))}с · WORKER${this.tradeLive && this.tradeConnected ? ` · ${this.tapeGuard.label()}` : ""}`);
    } else if (this.depthReady && this.statusKey.startsWith("stale:")) {
      this.publishLiveStatus();
    }

    const tradeOpen = this.tradeSocket?.readyState === WebSocket.OPEN;
    const tradeConnecting = this.tradeSocket?.readyState === WebSocket.CONNECTING;
    if (!tradeOpen && !tradeConnecting && !this.tradeReconnectTimer) {
      if (this.tradeLive) this.publishLiveStatus("reconnect");
      this.connectTrades(this.generation);
    }
  }

  priorityRank() {
    const index = prioritySymbols.indexOf(this.symbol);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  }

  emittedLimit() {
    const active = [...feeds.values()].filter((feed) => feed.subscribers > 0).length;
    if (active <= 1) return MAX_EMITTED_LEVELS_PER_SIDE;
    if (this.priorityRank() === 0) return active <= 2 ? 1_800 : 900;
    if (active === 2) return 900;
    if (active <= 4) return 450;
    return 280;
  }

  emitIntervalMs() {
    const active = [...feeds.values()].filter((feed) => feed.subscribers > 0).length;
    if (active <= 1 || this.priorityRank() === 0) return 100;
    if (active <= 4) return 220;
    return 320;
  }

  bookStorageLimit() {
    // UI emission is throttled separately. Never destroy the deep local
    // book merely because several panels are open.
    return MAX_BOOK_LEVELS_PER_SIDE;
  }

  sortedDepth() {
    if (this.cachedSorted) return this.cachedSorted;
    const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, MAX_EMITTED_LEVELS_PER_SIDE);
    const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, MAX_EMITTED_LEVELS_PER_SIDE);
    this.cachedSorted = { bids, asks };
    return this.cachedSorted;
  }

  emit(now = Date.now(), requestedLimit = this.emittedLimit(), force = false) {
    const processStartedAt = observabilityEnabled ? performance.now() : null;
    if (!tabVisible || this.subscribers <= 0 || (!force && !this.dirty && !this.forceEmit)) return;
    if (!force && !this.forceEmit && now - this.lastEmitAt < this.emitIntervalMs()) return;
    const fullView = this.sortedDepth();
    const limit = Math.max(100, Math.min(MAX_EMITTED_LEVELS_PER_SIDE, Math.floor(requestedLimit)));
    const view = {
      bids: fullView.bids.slice(0, limit),
      asks: fullView.asks.slice(0, limit),
    };
    if (!view.bids.length || !view.asks.length) return;
    const bestBid = Number(view.bids[0][0]);
    const bestAsk = Number(view.asks[0][0]);
    const middle = (bestBid + bestAsk) / 2;
    const lowestBid = Number(view.bids.at(-1)?.[0]);
    const highestAsk = Number(view.asks.at(-1)?.[0]);
    post("data", this.symbol, {
      data: {
        symbol: this.symbol,
        bids: view.bids,
        asks: view.asks,
        trades: [],
        bestBid,
        bestAsk,
        lastUpdateId: this.lastUpdateId,
        eventTime: now,
        depthReady: this.depthReady,
        coverage: {
          bidPercent: Number.isFinite(lowestBid) ? Math.max(0, ((middle - lowestBid) / middle) * 100) : 0,
          askPercent: Number.isFinite(highestAsk) ? Math.max(0, ((highestAsk - middle) / middle) * 100) : 0,
        },
        bookLevels: { bids: this.bids.size, asks: this.asks.size },
        resyncCount: this.resyncCount,
        health: {
          mode: this.mode,
          depthAgeMs: this.lastDepthAt ? Math.max(0, now - this.lastDepthAt) : null,
          tradeAgeMs: this.lastTradeAt ? Math.max(0, now - this.lastTradeAt) : null,
          depthBuffer: this.depthBuffer.length,
          subscribers: this.subscribers,
          depthTransport: this.transportIndex,
          tradeTransport: this.tradeTransportIndex,
          tradeTransportName: this.tradeTransportName,
          syncing: this.syncing,
          tape: this.tapeGuard.snapshot(now),
        },
        worker: true,
      },
    }, processStartedAt);
    this.lastEmitAt = now;
    this.dirty = false;
    this.forceEmit = false;
  }

  trimBook() {
    const limit = this.bookStorageLimit();
    trimSide(this.bids, "bid", limit);
    trimSide(this.asks, "ask", limit);
  }

  applyDepth(event, first = false) {
    const decision = sequenceDecision(this.lastUpdateId, event, first);
    if (decision === "ignore") return true;
    if (decision === "resync") {
      this.resync("Разрыв последовательности");
      return false;
    }
    applyDepthUpdates(this.bids, event.b ?? event.bids);
    applyDepthUpdates(this.asks, event.a ?? event.asks);
    this.lastUpdateId = Number(event.u);
    this.cachedSorted = null;
    this.trimBook();
    this.markDirty();
    return true;
  }

  bufferDepth(event) {
    this.depthBuffer.push(event);
    if (this.depthBuffer.length > MAX_BUFFERED_DEPTH_EVENTS) {
      this.depthBuffer.splice(0, this.depthBuffer.length - MAX_BUFFERED_DEPTH_EVENTS);
      this.resync("Переполнение буфера");
    }
  }

  installSnapshot() {
    const snapshot = this.pendingSnapshot;
    if (!snapshot) return false;
    const snapshotId = Number(snapshot.lastUpdateId);
    const applicable = this.depthBuffer.filter((event) => Number(event?.u) > snapshotId);
    const bridgeIndex = applicable.findIndex(
      (event) => Number(event?.U) <= snapshotId + 1 && Number(event?.u) >= snapshotId + 1,
    );
    if (bridgeIndex < 0) {
      const firstU = Number(applicable[0]?.U);
      if (Number.isFinite(firstU) && firstU > snapshotId + 1) {
        this.pendingSnapshot = null;
        clearTimeout(this.snapshotTimer);
        this.snapshotTimer = setTimeout(() => this.loadSnapshot(this.generation), 250);
      }
      return false;
    }
    this.bids = new Map();
    this.asks = new Map();
    applyDepthUpdates(this.bids, snapshot.bids);
    applyDepthUpdates(this.asks, snapshot.asks);
    this.lastUpdateId = snapshotId;
    this.cachedSorted = null;
    for (let index = bridgeIndex; index < applicable.length; index += 1) {
      if (!this.applyDepth(applicable[index], index === bridgeIndex)) return false;
    }
    this.depthBuffer = [];
    this.pendingSnapshot = null;
    this.depthReady = true;
    this.syncing = false;
    this.publishLiveStatus();
    this.markDirty(true);
    return true;
  }

  async loadSnapshot(generation) {
    if (generation !== this.generation || this.mode !== "deep" || this.snapshotLoading) return;
    this.snapshotLoading = true;
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
    let snapshot = null;
    try {
      snapshot = await Promise.any(hosts.map(async (host) => {
        const data = await fetchJson(`https://${host}/fapi/v1/depth?symbol=${encodeURIComponent(this.symbol)}&limit=1000`);
        if (!Array.isArray(data?.bids) || !Array.isArray(data?.asks) || !Number.isFinite(Number(data?.lastUpdateId))) {
          throw new Error("invalid snapshot");
        }
        return data;
      }));
    } catch {}
    this.snapshotLoading = false;
    if (generation !== this.generation || this.mode !== "deep") return;
    if (!snapshot) {
      this.activatePartial(generation);
      return;
    }
    this.pendingSnapshot = snapshot;
    this.installSnapshot();
  }

  activatePartial(generation) {
    if (generation !== this.generation || this.mode === "partial") return;
    const preserveLastFrame = this.syncing || this.depthReady || (this.bids.size > 0 && this.asks.size > 0);
    this.mode = "partial";
    this.transportIndex = 0;
    this.syncing = preserveLastFrame;
    this.resetBook();
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    this.setStatus(
      preserveLastFrame ? "stale" : "loading",
      preserveLastFrame ? "СИНХРОНИЗАЦИЯ · последний кадр" : "Резервный Worker-стакан",
    );
    try { this.socket?.close(); } catch {}
    this.socket = null;
    this.reconnectTimer = setTimeout(() => this.connectDepth(generation), 0);
  }

  resync(text) {
    if (this.mode !== "deep") return;
    const now = Date.now();
    if (now - this.lastResyncAt < 350) return;
    this.lastResyncAt = now;
    this.resyncCount += 1;
    const preserveLastFrame = this.syncing || this.depthReady || (this.bids.size > 0 && this.asks.size > 0);
    this.syncing = preserveLastFrame;
    this.resetBook();
    this.setStatus(
      preserveLastFrame ? "stale" : "loading",
      preserveLastFrame ? `СИНХРОНИЗАЦИЯ · ${text}` : text,
    );
    clearTimeout(this.snapshotTimer);
    const delay = Math.min(2_000, 250 + this.resyncCount * 75);
    this.snapshotTimer = setTimeout(() => this.loadSnapshot(this.generation), delay);
  }

  replacePartial(target, previousKeys, rows) {
    const nextKeys = new Set();
    for (const row of rows ?? []) {
      const price = Number(row?.[0]);
      const quantity = Number(row?.[1]);
      if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
      nextKeys.add(price);
      if (quantity > 0) target.set(price, quantity);
      else target.delete(price);
    }
    for (const price of previousKeys) if (!nextKeys.has(price)) target.delete(price);
    return nextKeys;
  }

  connectDepth(generation) {
    if (generation !== this.generation || this.subscribers <= 0) return;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.firstDepthTimer);
    const transports = depthTransports(this.symbol, this.mode);
    const transport = transports[this.transportIndex % transports.length];
    let socket;
    try { socket = new WebSocket(transport.url); }
    catch {
      this.transportIndex += 1;
      const delay = reconnectDelay(this.depthReconnectAttempt++);
      this.reconnectTimer = setTimeout(() => this.connectDepth(generation), delay);
      return;
    }
    this.socket = socket;
    this.firstDepthTimer = setTimeout(() => {
      if (generation === this.generation && socket === this.socket) {
        try { socket.close(); } catch {}
      }
    }, 8_000);

    socket.addEventListener("open", () => {
      if (generation !== this.generation || socket !== this.socket) return;
      if (transport.subscribe) {
        socket.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: [transport.stream],
          id: Date.now() % 2_147_483_647,
        }));
      }
      if (this.syncing) this.setStatus("stale", "СИНХРОНИЗАЦИЯ · последний кадр");
      else this.setStatus("loading", this.mode === "deep" ? "Синхронизация Worker" : "Подключаю резерв Worker");
      if (this.mode === "deep") this.loadSnapshot(generation);
    });

    socket.addEventListener("message", (message) => {
      if (generation !== this.generation || socket !== this.socket) return;
      const payload = parsePayload(message.data);
      if (!payload) return;
      const update = payload.data;
      const eventType = String(update?.e ?? "").toLowerCase();
      const stream = payload.stream.toLowerCase();
      this.lastMessageAt = Date.now();

      const bids = update?.b ?? update?.bids;
      const asks = update?.a ?? update?.asks;
      if (!Array.isArray(bids) || !Array.isArray(asks)) return;
      this.lastDepthAt = Date.now();
      clearTimeout(this.firstDepthTimer);
      this.transportIndex = 0;
      this.depthReconnectAttempt = 0;

      if (this.mode === "partial") {
        this.partialBidKeys = this.replacePartial(this.bids, this.partialBidKeys, bids);
        this.partialAskKeys = this.replacePartial(this.asks, this.partialAskKeys, asks);
        this.lastUpdateId = Number(update.u ?? update.lastUpdateId) || this.lastUpdateId;
        this.depthReady = true;
        this.syncing = false;
        this.cachedSorted = null;
        this.publishLiveStatus();
        this.markDirty(true);
        return;
      }

      if (!Number.isFinite(Number(update?.U)) || !Number.isFinite(Number(update?.u))) return;
      if (!this.depthReady) {
        this.bufferDepth(update);
        if (!this.pendingSnapshot && !this.snapshotLoading) this.loadSnapshot(generation);
        this.installSnapshot();
        return;
      }
      this.applyDepth(update);
    });

    socket.addEventListener("close", () => {
      if (generation !== this.generation || socket !== this.socket) return;
      clearTimeout(this.firstDepthTimer);
      this.socket = null;
      this.transportIndex += 1;
      const preserveLastFrame = this.depthReady || this.syncing;
      this.syncing = preserveLastFrame;
      this.resetBook();
      this.setStatus(
        preserveLastFrame ? "stale" : "offline",
        preserveLastFrame ? "СИНХРОНИЗАЦИЯ · последний кадр" : "RECONNECT · WORKER",
      );
      const delay = reconnectDelay(this.depthReconnectAttempt++);
      this.reconnectTimer = setTimeout(() => this.connectDepth(generation), delay);
    });

    socket.addEventListener("error", () => {
      if (generation === this.generation && socket === this.socket) {
        try { socket.close(); } catch {}
      }
    });
  }

  connectTrades(generation) {
    if (generation !== this.generation || this.subscribers <= 0) return;
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.tradeFirstMessageTimer);
    this.tradeFirstMessageTimer = 0;

    const streams = tradeStreams(this.symbol);
    const transports = tradeTransports(streams);
    const transport = transports[this.tradeTransportIndex % transports.length];
    let socket;
    try { socket = new WebSocket(transport.url); }
    catch {
      this.tradeTransportIndex += 1;
      const delay = reconnectDelay(this.tradeReconnectAttempt++);
      this.tradeReconnectTimer = setTimeout(() => this.connectTrades(generation), delay);
      return;
    }
    this.tradeSocket = socket;
    this.tradeTransportName = transport.name;
    let receivedTrade = false;
    this.tradeFirstMessageTimer = setTimeout(() => {
      if (generation !== this.generation || socket !== this.tradeSocket || receivedTrade) return;
      try { socket.close(); } catch {}
    }, TRADE_FIRST_MESSAGE_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      this.tapeGuard.connect();
      if (transport.subscribe) {
        socket.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: transport.streams,
          id: Date.now() % 2_147_483_647,
        }));
      }
    });

    socket.addEventListener("message", (message) => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      const payload = parsePayload(message.data);
      if (!payload) return;
      const update = payload.data;
      const eventType = String(update?.e ?? "").toLowerCase();
      const payloadStream = payload.stream.toLowerCase();
      const rawEvent = eventType === "trade"
        || (payloadStream.endsWith("@trade") && !payloadStream.endsWith("@aggtrade"));
      const aggregateEvent = eventType === "aggtrade" || payloadStream.endsWith("@aggtrade");
      if (!rawEvent && !aggregateEvent) return;

      const source = rawEvent && !aggregateEvent ? "raw" : "agg";
      const receivedAt = Date.now();
      const trade = normalizeTrade(update, source, receivedAt);
      if (!trade) return;
      receivedTrade = true;
      clearTimeout(this.tradeFirstMessageTimer);
      this.tradeFirstMessageTimer = 0;
      this.lastTradeAt = receivedAt;
      this.tradeLatency.record(trade.rxLatencyMs, receivedAt);
      this.tradeTransportIndex = 0;
      this.tradeReconnectAttempt = 0;
      this.tradeLive = true;
      this.tradeConnected = true;

      const decision = this.tapeGuard.ingest(trade, this.lastTradeAt);
      this.publishLiveStatus();
      if (!decision.emit || !this.insertTrade(trade, true)) return;
      this.queueTape(trade);
      this.scheduleTradeSave();
    });

    socket.addEventListener("close", () => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      clearTimeout(this.tradeFirstMessageTimer);
      this.tradeFirstMessageTimer = 0;
      this.tradeSocket = null;
      this.tradeConnected = false;
      this.tapeGuard.disconnect("socket-close");
      this.tradeTransportIndex += 1;
      if (this.tradeLive && this.depthReady) this.publishLiveStatus("reconnect");
      const delay = reconnectDelay(this.tradeReconnectAttempt++);
      this.tradeReconnectTimer = setTimeout(() => this.connectTrades(generation), delay);
    });

    socket.addEventListener("error", () => {
      if (generation === this.generation && socket === this.tradeSocket) {
        try { socket.close(); } catch {}
      }
    });
  }

  async loadRecentTrades(generation, { resume = false } = {}) {
    if (generation !== this.generation) return;
    const requestId = ++this.tradeBootstrapRequest;
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
    let rows = null;
    try {
      rows = await Promise.any(hosts.map((host) => fetchJson(
        `https://${host}/fapi/v1/aggTrades?symbol=${encodeURIComponent(this.symbol)}&limit=${TRADE_BOOTSTRAP_LIMIT}`,
      )));
    } catch {}
    if (
      generation !== this.generation
      || requestId !== this.tradeBootstrapRequest
      || !Array.isArray(rows)
    ) return;

    const coveredRanges = resume ? mergeTradeCoverage(this.trades) : null;
    const addedTrades = [];
    for (const row of rows) {
      const trade = normalizeTrade(row, "agg");
      if (
        resume
        && trade
        && tradeCoverageOverlaps(coveredRanges, trade.firstTradeId, trade.lastTradeId)
      ) continue;
      if (this.insertTrade(trade, true)) {
        addedTrades.push(trade);
        if (resume) addTradeCoverage(coveredRanges, trade.firstTradeId, trade.lastTradeId);
      }
    }
    if (!addedTrades.length) return;
    this.trades.sort((left, right) => Number(right.time) - Number(left.time));
    if (tabVisible) {
      const trades = resume
        ? addedTrades.sort((left, right) => Number(left.time) - Number(right.time)).slice(-MAX_RESUME_TAPE_SNAPSHOT)
        : this.trades.slice(0, MAX_TAPE_SNAPSHOT);
      post("tape", this.symbol, {
        replace: !resume,
        resume,
        trades,
      });
    }
  }

  insertTrade(trade, newestFirst = true) {
    if (!trade) return false;
    const hasRawRange = Number.isInteger(Number(trade.firstTradeId))
      && Number.isInteger(Number(trade.lastTradeId));
    const firstTradeId = hasRawRange ? Number(trade.firstTradeId) : trade.id;
    const lastTradeId = hasRawRange ? Number(trade.lastTradeId) : trade.id;
    const key = `${firstTradeId}:${lastTradeId}:${trade.time}:${trade.price}:${trade.quantity}`;
    if (this.tradeIds.has(key)) return false;
    if (hasRawRange) this.tapeGuard.advanceBoundary(lastTradeId);
    this.tradeIds.add(key);
    if (newestFirst) this.trades.unshift(trade);
    else this.trades.push(trade);
    if (this.trades.length > MAX_TRADE_HISTORY) {
      this.trades.length = MAX_TRADE_HISTORY;
      this.tradeIds = new Set(this.trades.map((item) => {
        const firstTradeId = Number.isInteger(Number(item.firstTradeId)) ? Number(item.firstTradeId) : item.id;
        const lastTradeId = Number.isInteger(Number(item.lastTradeId)) ? Number(item.lastTradeId) : item.id;
        return `${firstTradeId}:${lastTradeId}:${item.time}:${item.price}:${item.quantity}`;
      }));
    }
    return true;
  }

  queueTape(trade) {
    if (!trade || !tabVisible) return;
    this.tapeBatch.push(trade);
    if (!this.tapeTimer) {
      this.tapeTimer = setTimeout(() => this.flushTapeBatch(), TAPE_FLUSH_MS);
    }
  }

  flushTapeBatch() {
    this.tapeTimer = 0;
    if (!tabVisible) {
      this.tapeBatch = [];
      return;
    }
    const trades = this.tapeBatch.splice(0, MAX_TAPE_BATCH_PER_POST);
    if (trades.length) post("tape", this.symbol, { replace: false, trades });
    if (this.tapeBatch.length) {
      this.tapeTimer = setTimeout(() => this.flushTapeBatch(), TAPE_FLUSH_MS);
    }
  }

  scheduleTradeSave() {
    clearTimeout(this.tradeSaveTimer);
    this.tradeSaveTimer = setTimeout(
      () => tradeStore.set(this.symbol, this.trades).catch(() => {}),
      12_000,
    );
  }

  async loadTradeHistory(generation) {
    const saved = await tradeStore.get(this.symbol);
    if (generation !== this.generation || !saved.length) return;
    for (const trade of saved) this.insertTrade(trade, false);
    if (tabVisible) post("tape", this.symbol, { replace: true, trades: this.trades.slice(0, MAX_TAPE_SNAPSHOT) });
  }
}

function scheduleEmit() {
  if (!tabVisible || emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = 0;
    if (!tabVisible) return;

    const active = [...feeds.values()].filter((feed) => feed.subscribers > 0);
    if (!active.length) return;

    // Не отправляем несколько тяжёлых книг в UI одним залпом.
    // При 3+ стаканах один тик обслуживает один символ по кругу.
    const budget = active.length <= 2 ? active.length : 1;
    const now = Date.now();
    for (let index = 0; index < budget; index += 1) {
      const feed = active[emitCursor % active.length];
      emitCursor = (emitCursor + 1) % active.length;
      feed.emit(now);
    }

    if (active.some((feed) => feed.dirty || feed.forceEmit)) scheduleEmit();
  }, 25);
}

function scheduleWatchdog() {
  clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    watchdogTimer = 0;
    const now = Date.now();
    if (tabVisible) {
      for (const feed of feeds.values()) feed.ensureHealthy(now);
    }
    self.postMessage({
      type: "heartbeat",
      time: now,
      visible: tabVisible,
      activeFeeds: [...feeds.values()].filter((feed) => feed.subscribers > 0).length,
      totalFeeds: feeds.size,
    });
    scheduleWatchdog();
  }, WORKER_HEARTBEAT_MS);
}

function getFeed(symbol) {
  let feed = feeds.get(symbol);
  if (!feed) {
    feed = new SymbolFeed(symbol);
    feeds.set(symbol, feed);
  }
  return feed;
}

function cancelBackgroundPause() {
  clearTimeout(backgroundPauseTimer);
  backgroundPauseTimer = 0;
}

function scheduleBackgroundPause(epoch) {
  cancelBackgroundPause();
  backgroundPauseTimer = setTimeout(() => {
    backgroundPauseTimer = 0;
    if (tabVisible || epoch !== visibilityEpoch) return;
    for (const feed of feeds.values()) feed.pauseForBackground();
  }, BACKGROUND_GRACE_MS);
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;

  if (message.type === "observability") {
    observabilityEnabled = Boolean(message.enabled);
    return;
  }

  if (message.type === "visibility") {
    const nextVisible = Boolean(message.visible);
    if (nextVisible === tabVisible) return;

    tabVisible = nextVisible;
    visibilityEpoch += 1;
    const epoch = visibilityEpoch;

    if (!tabVisible) {
      clearTimeout(emitTimer);
      emitTimer = 0;
      scheduleBackgroundPause(epoch);
      return;
    }

    cancelBackgroundPause();
    syncServerClock(true).catch(() => {});

    const resumePrioritySymbols = Array.isArray(message.prioritySymbols)
      ? message.prioritySymbols.map((symbol) => String(symbol).toUpperCase())
      : [];
    prioritySymbols = resumePrioritySymbols;
    const priorityRank = new Map(
      resumePrioritySymbols.map((symbol, index) => [symbol, index]),
    );
    const active = [...feeds.values()]
      .filter((feed) => feed.subscribers > 0)
      .sort((left, right) => (
        (priorityRank.get(left.symbol) ?? Number.MAX_SAFE_INTEGER)
        - (priorityRank.get(right.symbol) ?? Number.MAX_SAFE_INTEGER)
      ));
    active.forEach((feed, index) => feed.resume(index * RESUME_STAGGER_MS, epoch));
    return;
  }

  if (message.type === "priority") {
    prioritySymbols = Array.isArray(message.prioritySymbols)
      ? message.prioritySymbols.map((symbol) => String(symbol).toUpperCase())
      : [];
    return;
  }

  const symbol = String(message.symbol ?? "").toUpperCase();
  if (!symbol.endsWith("USDT")) return;
  if (message.type === "subscribe") {
    getFeed(symbol).addSubscriber();
    return;
  }
  if (message.type === "unsubscribe") {
    feeds.get(symbol)?.removeSubscriber();
    return;
  }
  if (message.type === "refresh") {
    feeds.get(symbol)?.refresh();
  }
});

syncServerClock(true).catch(() => {});
scheduleWatchdog();
post("ready", "");
