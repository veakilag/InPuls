const MAX_BOOK_LEVELS_PER_SIDE = 20_000;
const MAX_EMITTED_LEVELS_PER_SIDE = 4_000;
const MAX_BUFFERED_DEPTH_EVENTS = 4_000;
const MAX_TRADE_HISTORY = 20_000;
const MAX_TAPE_SNAPSHOT = 1_200;
const MAX_RESUME_TAPE_SNAPSHOT = 80;
const MAX_RESUME_LEVELS_PER_SIDE = 700;
const RESUME_STAGGER_MS = 140;
const RESUME_STALE_MS = 3_500;
const ACTIVE_STALE_MS = 12_000;
const SNAPSHOT_TIMEOUT_MS = 2_800;
const IDLE_CLOSE_MS = 10_000;
const TRADE_FIRST_MESSAGE_TIMEOUT_MS = 8_000;
const TRADE_BOOTSTRAP_LIMIT = 120;

const feeds = new Map();
let tabVisible = true;
let emitTimer = 0;
let emitCursor = 0;
let visibilityEpoch = 0;
let watchdogTimer = 0;

function post(type, symbol, payload = {}) {
  self.postMessage({ type, symbol, ...payload });
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

function normalizeTrade(event) {
  const price = Number(event?.p);
  const quantity = Number(event?.q);
  const time = Number(event?.T ?? event?.E);
  if (![price, quantity, time].every(Number.isFinite)) return null;
  return {
    id: Number(event?.a ?? event?.t) || `${time}-${price}-${quantity}`,
    price,
    quantity,
    quote: price * quantity,
    time,
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
        trades: trades.slice(0, MAX_TRADE_HISTORY),
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

function tradeStreamCandidates(symbol) {
  const name = symbol.toLowerCase();
  return [`${name}@aggTrade`, `${name}@trade`];
}

function tradeTransports(stream) {
  return [
    // В браузере пользователя сделки стабильно приходили через market-path.
    { url: `wss://fstream.binance.com/market/ws/${stream}`, subscribe: false, stream },
    { url: `wss://fstream.binance.com/market/stream?streams=${stream}`, subscribe: false, stream },
    { url: "wss://fstream.binance.com/market/stream", subscribe: true, stream },
    // Стандартные Futures endpoints оставляем как автоматический резерв.
    { url: `wss://fstream.binance.com/ws/${stream}`, subscribe: false, stream },
    { url: `wss://fstream.binance.com/stream?streams=${stream}`, subscribe: false, stream },
    { url: "wss://fstream.binance.com/ws", subscribe: true, stream },
    { url: `wss://stream.binancefuture.com/market/ws/${stream}`, subscribe: false, stream },
    { url: `wss://stream.binancefuture.com/ws/${stream}`, subscribe: false, stream },
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
    this.lastDepthAt = 0;
    this.lastTradeAt = 0;
    this.lastMessageAt = 0;
    this.lastRestartAt = 0;
    this.tradeBootstrapLoading = false;
    this.tradeLive = false;
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

  resume(delayMs = 0, epoch = visibilityEpoch) {
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = 0;
      if (!tabVisible || epoch !== visibilityEpoch || this.subscribers <= 0) return;

      const now = Date.now();
      const socketOpen = this.socket?.readyState === WebSocket.OPEN;
      const tradeOpen = this.tradeSocket?.readyState === WebSocket.OPEN;
      const depthFresh = this.lastDepthAt > 0 && now - this.lastDepthAt <= RESUME_STALE_MS;

      // Браузер может заморозить Worker/WebSocket в фоновой вкладке без close-события.
      // В таком случае старую sequence-цепочку продолжать нельзя — пересобираем книгу.
      if (!socketOpen || !depthFresh) {
        this.restartAfterBackground();
        return;
      }
      if (!tradeOpen && !this.tradeReconnectTimer) {
        this.connectTrades(this.generation);
      }

      this.tapeBatch = [];
      clearTimeout(this.tapeTimer);
      this.tapeTimer = 0;
      post("tape", this.symbol, {
        replace: true,
        trades: this.trades.slice(0, MAX_RESUME_TAPE_SNAPSHOT),
      });

      this.forceEmit = true;
      this.emit(now, MAX_RESUME_LEVELS_PER_SIDE, true);
    }, Math.max(0, delayMs));
  }

  restartAfterBackground() {
    if (this.subscribers <= 0) return;
    const now = Date.now();
    if (now - this.lastRestartAt < 2_500) return;
    this.lastRestartAt = now;
    this.stopSockets();
    this.generation += 1;
    this.mode = "deep";
    this.transportIndex = 0;
    this.tradeTransportIndex = 0;
    this.resetBook();
    this.setStatus("loading", "Восстановление Worker");
    const generation = this.generation;
    this.connectDepth(generation);
    this.connectTrades(generation);
  }

  ensureHealthy(now = Date.now()) {
    if (!tabVisible || this.subscribers <= 0) return;
    const socketOpen = this.socket?.readyState === WebSocket.OPEN;
    const socketConnecting = this.socket?.readyState === WebSocket.CONNECTING;
    const reconnectPending = Boolean(this.reconnectTimer || this.firstDepthTimer || this.snapshotLoading);
    const stale = this.depthReady && this.lastDepthAt > 0 && now - this.lastDepthAt > ACTIVE_STALE_MS;
    if ((!socketOpen && !socketConnecting && !reconnectPending) || stale) {
      this.restartAfterBackground();
      return;
    }

    const tradeOpen = this.tradeSocket?.readyState === WebSocket.OPEN;
    const tradeConnecting = this.tradeSocket?.readyState === WebSocket.CONNECTING;
    if (!tradeOpen && !tradeConnecting && !this.tradeReconnectTimer) {
      this.connectTrades(this.generation);
    }
  }

  emittedLimit() {
    const active = [...feeds.values()].filter((feed) => feed.subscribers > 0).length;
    if (active <= 1) return MAX_EMITTED_LEVELS_PER_SIDE;
    if (active === 2) return 2_500;
    return 1_500;
  }

  sortedDepth() {
    if (this.cachedSorted) return this.cachedSorted;
    const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, MAX_EMITTED_LEVELS_PER_SIDE);
    const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, MAX_EMITTED_LEVELS_PER_SIDE);
    this.cachedSorted = { bids, asks };
    return this.cachedSorted;
  }

  emit(now = Date.now(), requestedLimit = this.emittedLimit(), force = false) {
    if (!tabVisible || this.subscribers <= 0 || (!force && !this.dirty && !this.forceEmit)) return;
    if (!force && !this.forceEmit && now - this.lastEmitAt < 100) return;
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
        worker: true,
      },
    });
    this.lastEmitAt = now;
    this.dirty = false;
    this.forceEmit = false;
  }

  trimBook() {
    trimSide(this.bids, "bid", MAX_BOOK_LEVELS_PER_SIDE);
    trimSide(this.asks, "ask", MAX_BOOK_LEVELS_PER_SIDE);
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
    this.setStatus("online", "LIVE 100ms · WORKER");
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
    this.mode = "partial";
    this.transportIndex = 0;
    this.resetBook();
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    this.setStatus("loading", "Резервный Worker-стакан");
    try { this.socket?.close(); } catch {}
    this.socket = null;
    this.reconnectTimer = setTimeout(() => this.connectDepth(generation), 0);
  }

  resync(text) {
    if (this.mode !== "deep") return;
    this.resyncCount += 1;
    this.resetBook();
    this.setStatus("loading", text);
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => this.loadSnapshot(this.generation), 250);
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
      this.reconnectTimer = setTimeout(() => this.connectDepth(generation), 500);
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
      this.setStatus("loading", this.mode === "deep" ? "Синхронизация Worker" : "Подключаю резерв Worker");
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

      if (this.mode === "partial") {
        this.partialBidKeys = this.replacePartial(this.bids, this.partialBidKeys, bids);
        this.partialAskKeys = this.replacePartial(this.asks, this.partialAskKeys, asks);
        this.lastUpdateId = Number(update.u ?? update.lastUpdateId) || this.lastUpdateId;
        this.depthReady = true;
        this.cachedSorted = null;
        this.setStatus("online", "LIVE 100ms · WORKER · 20");
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
      this.resetBook();
      this.setStatus("offline", "Переподключение Worker");
      this.reconnectTimer = setTimeout(() => this.connectDepth(generation), 500);
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

    const streams = tradeStreamCandidates(this.symbol);
    const transportCount = tradeTransports(streams[0]).length;
    const stream = streams[Math.floor(this.tradeTransportIndex / transportCount) % streams.length];
    const transports = tradeTransports(stream);
    const transport = transports[this.tradeTransportIndex % transports.length];
    let socket;
    try { socket = new WebSocket(transport.url); }
    catch {
      this.tradeTransportIndex += 1;
      this.tradeReconnectTimer = setTimeout(() => this.connectTrades(generation), 500);
      return;
    }
    this.tradeSocket = socket;
    let receivedTrade = false;
    this.tradeFirstMessageTimer = setTimeout(() => {
      if (generation !== this.generation || socket !== this.tradeSocket || receivedTrade) return;
      // Открытый, но молчащий endpoint раньше зависал навсегда.
      try { socket.close(); } catch {}
    }, TRADE_FIRST_MESSAGE_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      if (transport.subscribe) {
        socket.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: [transport.stream],
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
      const isTrade = eventType === "aggtrade"
        || eventType === "trade"
        || payloadStream.endsWith("@aggtrade")
        || payloadStream.endsWith("@trade");
      if (!isTrade) return;

      const trade = normalizeTrade(update);
      if (!trade) return;
      receivedTrade = true;
      clearTimeout(this.tradeFirstMessageTimer);
      this.tradeFirstMessageTimer = 0;
      if (!this.insertTrade(trade, true)) return;
      this.lastTradeAt = Date.now();
      this.tradeTransportIndex = 0;
      if (!this.tradeLive) {
        this.tradeLive = true;
        this.setStatus(
          "online",
          this.mode === "partial"
            ? "LIVE 100ms · WORKER · 20 · TAPE"
            : "LIVE 100ms · WORKER · TAPE",
        );
      }
      this.queueTape(trade);
      this.scheduleTradeSave();
    });

    socket.addEventListener("close", () => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      clearTimeout(this.tradeFirstMessageTimer);
      this.tradeFirstMessageTimer = 0;
      this.tradeSocket = null;
      this.tradeTransportIndex += 1;
      this.tradeReconnectTimer = setTimeout(() => this.connectTrades(generation), 500);
    });

    socket.addEventListener("error", () => {
      if (generation === this.generation && socket === this.tradeSocket) {
        try { socket.close(); } catch {}
      }
    });
  }

  async loadRecentTrades(generation) {
    if (generation !== this.generation || this.tradeBootstrapLoading) return;
    this.tradeBootstrapLoading = true;
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
    let rows = null;
    try {
      rows = await Promise.any(hosts.map((host) => fetchJson(
        `https://${host}/fapi/v1/aggTrades?symbol=${encodeURIComponent(this.symbol)}&limit=${TRADE_BOOTSTRAP_LIMIT}`,
      )));
    } catch {}
    this.tradeBootstrapLoading = false;
    if (generation !== this.generation || !Array.isArray(rows)) return;

    let added = false;
    for (const row of rows) {
      const trade = normalizeTrade(row);
      if (this.insertTrade(trade, true)) added = true;
    }
    if (!added) return;
    this.trades.sort((left, right) => Number(right.time) - Number(left.time));
    if (tabVisible) {
      post("tape", this.symbol, {
        replace: true,
        trades: this.trades.slice(0, MAX_TAPE_SNAPSHOT),
      });
    }
  }

  insertTrade(trade, newestFirst = true) {
    if (!trade) return false;
    const key = `${trade.id}:${trade.time}:${trade.price}:${trade.quantity}`;
    if (this.tradeIds.has(key)) return false;
    this.tradeIds.add(key);
    if (newestFirst) this.trades.unshift(trade);
    else this.trades.push(trade);
    if (this.trades.length > MAX_TRADE_HISTORY) {
      this.trades.length = MAX_TRADE_HISTORY;
      this.tradeIds = new Set(this.trades.map((item) => `${item.id}:${item.time}:${item.price}:${item.quantity}`));
    }
    return true;
  }

  queueTape(trade) {
    if (!trade || !tabVisible) return;
    this.tapeBatch.push(trade);
    if (this.tapeTimer) return;
    this.tapeTimer = setTimeout(() => {
      this.tapeTimer = 0;
      if (!tabVisible) {
        this.tapeBatch = [];
        return;
      }
      const trades = this.tapeBatch.splice(0);
      if (trades.length) post("tape", this.symbol, { replace: false, trades });
    }, 25);
  }

  scheduleTradeSave() {
    clearTimeout(this.tradeSaveTimer);
    this.tradeSaveTimer = setTimeout(() => tradeStore.set(this.symbol, this.trades).catch(() => {}), 4_000);
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
    if (tabVisible) {
      const now = Date.now();
      for (const feed of feeds.values()) feed.ensureHealthy(now);
    }
    scheduleWatchdog();
  }, 2_000);
}

function getFeed(symbol) {
  let feed = feeds.get(symbol);
  if (!feed) {
    feed = new SymbolFeed(symbol);
    feeds.set(symbol, feed);
  }
  return feed;
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;

  if (message.type === "visibility") {
    const nextVisible = Boolean(message.visible);
    if (nextVisible === tabVisible) return;

    tabVisible = nextVisible;
    visibilityEpoch += 1;
    const epoch = visibilityEpoch;

    if (!tabVisible) {
      clearTimeout(emitTimer);
      emitTimer = 0;
      for (const feed of feeds.values()) {
        feed.tapeBatch = [];
        clearTimeout(feed.tapeTimer);
        clearTimeout(feed.resumeTimer);
        feed.tapeTimer = 0;
        feed.resumeTimer = 0;
      }
      return;
    }

    // Возвращаем книги по очереди, чтобы 3–6 окон не забивали главный поток одновременно.
    const active = [...feeds.values()].filter((feed) => feed.subscribers > 0);
    active.forEach((feed, index) => feed.resume(index * RESUME_STAGGER_MS, epoch));
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

scheduleWatchdog();
post("ready", "");
