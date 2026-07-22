const MAX_BOOK_LEVELS_PER_SIDE = 20_000;
const MAX_EMITTED_LEVELS_PER_SIDE = 12_000;
const MAX_SPOT_LEVELS_PER_SIDE = 5_000;
const MAX_BUFFERED_DEPTH_EVENTS = 4_000;
const MAX_TRADE_HISTORY = 12_000;
const MAX_TAPE_SNAPSHOT = 4_000;
const SNAPSHOT_TIMEOUT_MS = 3_500;
const IDLE_CLOSE_MS = 10_000;

const feeds = new Map();
let tabVisible = true;
let emitTimer = 0;

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
      const request = indexedDB.open("inpuls-market-trades-v2", 1);
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

function futuresTransports(symbol, mode) {
  const name = symbol.toLowerCase();
  const depth = `${name}@${mode === "partial" ? "depth20" : "depth"}@100ms`;
  const trade = `${name}@aggTrade`;
  const streams = [depth, trade];
  const joined = streams.join("/");
  return [
    { url: `wss://fstream.binance.com/stream?streams=${joined}`, subscribe: false, streams },
    { url: "wss://fstream.binance.com/ws", subscribe: true, streams },
    { url: `wss://stream.binancefuture.com/stream?streams=${joined}`, subscribe: false, streams },
  ];
}

function spotTransports(symbol, mode) {
  const name = symbol.toLowerCase();
  const stream = `${name}@${mode === "partial" ? "depth20" : "depth"}@100ms`;
  return [
    { url: `wss://stream.binance.com:9443/stream?streams=${stream}`, subscribe: false, streams: [stream] },
    { url: `wss://stream.binance.com:443/stream?streams=${stream}`, subscribe: false, streams: [stream] },
    { url: "wss://stream.binance.com:9443/ws", subscribe: true, streams: [stream] },
    { url: `wss://data-stream.binance.vision/stream?streams=${stream}`, subscribe: false, streams: [stream] },
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
    this.reconnectTimer = 0;
    this.firstDepthTimer = 0;
    this.snapshotTimer = 0;
    this.tradeSaveTimer = 0;
    this.mode = "deep";
    this.transportIndex = 0;
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

    this.spotEnabled = false;
    this.spotAvailable = null;
    this.spotMode = "deep";
    this.spotSocket = null;
    this.spotReconnectTimer = 0;
    this.spotFirstDepthTimer = 0;
    this.spotSnapshotTimer = 0;
    this.spotTransportIndex = 0;
    this.spotAttempts = 0;
    this.spotBids = new Map();
    this.spotAsks = new Map();
    this.spotPartialBidKeys = new Set();
    this.spotPartialAskKeys = new Set();
    this.spotDepthBuffer = [];
    this.spotPendingSnapshot = null;
    this.spotLastUpdateId = null;
    this.spotReady = false;
    this.spotSnapshotLoading = false;
    this.cachedSpotSorted = null;
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
    this.resetBook();
    this.setStatus("loading", "Подключение Worker");
    const generation = this.generation;
    this.connect(generation);
    this.loadTradeHistory(generation);
    if (this.spotEnabled) this.startSpot(generation);
  }

  stopSockets() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.spotReconnectTimer);
    clearTimeout(this.spotFirstDepthTimer);
    clearTimeout(this.spotSnapshotTimer);
    try { this.socket?.close(); } catch {}
    try { this.spotSocket?.close(); } catch {}
    this.socket = null;
    this.spotSocket = null;
  }

  stop() {
    this.generation += 1;
    this.stopSockets();
    clearTimeout(this.tradeSaveTimer);
    clearTimeout(this.tapeTimer);
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
  }

  resetSpotBook() {
    this.spotBids.clear();
    this.spotAsks.clear();
    this.spotPartialBidKeys.clear();
    this.spotPartialAskKeys.clear();
    this.spotDepthBuffer = [];
    this.spotPendingSnapshot = null;
    this.spotLastUpdateId = null;
    this.spotReady = false;
    this.spotSnapshotLoading = false;
    this.cachedSpotSorted = null;
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
    scheduleEmit();
  }

  refresh() {
    this.forceEmit = true;
    this.tapeBatch = [];
    clearTimeout(this.tapeTimer);
    this.tapeTimer = 0;
    scheduleEmit();
    post("tape", this.symbol, { replace: true, trades: this.trades.slice(0, MAX_TAPE_SNAPSHOT) });
  }

  sortedDepth() {
    if (this.cachedSorted) return this.cachedSorted;
    const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, MAX_EMITTED_LEVELS_PER_SIDE);
    const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, MAX_EMITTED_LEVELS_PER_SIDE);
    this.cachedSorted = { bids, asks };
    return this.cachedSorted;
  }

  sortedSpotDepth() {
    if (!this.spotEnabled || !this.spotReady) return { bids: [], asks: [] };
    if (this.cachedSpotSorted) return this.cachedSpotSorted;
    const bids = [...this.spotBids.entries()].sort((a, b) => b[0] - a[0]).slice(0, MAX_SPOT_LEVELS_PER_SIDE);
    const asks = [...this.spotAsks.entries()].sort((a, b) => a[0] - b[0]).slice(0, MAX_SPOT_LEVELS_PER_SIDE);
    this.cachedSpotSorted = { bids, asks };
    return this.cachedSpotSorted;
  }

  emit(now = Date.now()) {
    if (!tabVisible || this.subscribers <= 0 || (!this.dirty && !this.forceEmit)) return;
    const interval = feeds.size <= 1 ? 100 : feeds.size === 2 ? 140 : 180;
    if (!this.forceEmit && now - this.lastEmitAt < interval) return;
    const view = this.sortedDepth();
    if (!view.bids.length || !view.asks.length) return;
    const spot = this.sortedSpotDepth();
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
        spotBids: spot.bids,
        spotAsks: spot.asks,
        spotEnabled: this.spotEnabled,
        spotReady: this.spotReady,
        spotAvailable: this.spotAvailable,
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
        spotLevels: { bids: this.spotBids.size, asks: this.spotAsks.size },
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

  trimSpotBook() {
    trimSide(this.spotBids, "bid", MAX_SPOT_LEVELS_PER_SIDE);
    trimSide(this.spotAsks, "ask", MAX_SPOT_LEVELS_PER_SIDE);
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
    const bridgeIndex = applicable.findIndex((event) => Number(event?.U) <= snapshotId + 1 && Number(event?.u) >= snapshotId + 1);
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
        if (!Array.isArray(data?.bids) || !Array.isArray(data?.asks) || !Number.isFinite(Number(data?.lastUpdateId))) throw new Error("invalid snapshot");
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
    this.reconnectTimer = setTimeout(() => this.connect(generation), 0);
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

  connect(generation) {
    if (generation !== this.generation || this.subscribers <= 0) return;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.firstDepthTimer);
    const transports = futuresTransports(this.symbol, this.mode);
    const transport = transports[this.transportIndex % transports.length];
    let socket;
    try { socket = new WebSocket(transport.url); }
    catch {
      this.transportIndex += 1;
      this.reconnectTimer = setTimeout(() => this.connect(generation), 500);
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
      if (transport.subscribe) socket.send(JSON.stringify({ method: "SUBSCRIBE", params: transport.streams, id: Date.now() % 2_147_483_647 }));
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
      if (eventType === "aggtrade" || eventType === "trade" || stream.endsWith("@aggtrade") || stream.endsWith("@trade")) {
        const trade = normalizeTrade(update);
        if (!this.insertTrade(trade, true)) return;
        this.queueTape(trade);
        this.scheduleTradeSave();
        return;
      }
      const bids = update?.b ?? update?.bids;
      const asks = update?.a ?? update?.asks;
      if (!Array.isArray(bids) || !Array.isArray(asks)) return;
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
      this.setStatus("online", "LIVE 100ms · WORKER");
    });
    socket.addEventListener("close", () => {
      if (generation !== this.generation || socket !== this.socket) return;
      clearTimeout(this.firstDepthTimer);
      this.socket = null;
      this.transportIndex += 1;
      this.resetBook();
      this.setStatus("offline", "Переподключение Worker");
      this.reconnectTimer = setTimeout(() => this.connect(generation), 600);
    });
    socket.addEventListener("error", () => {
      if (socket === this.socket) try { socket.close(); } catch {}
    });
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
    if (!tabVisible) return;
    this.tapeBatch.push(trade);
    if (this.tapeTimer) return;
    this.tapeTimer = setTimeout(() => {
      this.tapeTimer = 0;
      const trades = this.tapeBatch.splice(0);
      if (trades.length) post("tape", this.symbol, { replace: false, trades });
    }, 32);
  }

  scheduleTradeSave() {
    clearTimeout(this.tradeSaveTimer);
    this.tradeSaveTimer = setTimeout(() => tradeStore.set(this.symbol, this.trades).catch(() => {}), 4_000);
  }

  async loadTradeHistory(generation) {
    const saved = await tradeStore.get(this.symbol);
    if (generation !== this.generation || !saved.length) return;
    for (const trade of saved) this.insertTrade(trade, false);
    post("tape", this.symbol, { replace: true, trades: this.trades.slice(0, MAX_TAPE_SNAPSHOT) });
  }

  setSpotEnabled(enabled) {
    const next = Boolean(enabled);
    if (next === this.spotEnabled) {
      this.markDirty(true);
      return;
    }
    this.spotEnabled = next;
    this.spotAvailable = next ? null : this.spotAvailable;
    if (!next) {
      clearTimeout(this.spotReconnectTimer);
      clearTimeout(this.spotFirstDepthTimer);
      clearTimeout(this.spotSnapshotTimer);
      try { this.spotSocket?.close(); } catch {}
      this.spotSocket = null;
      this.resetSpotBook();
      this.markDirty(true);
      return;
    }
    this.startSpot(this.generation);
  }

  startSpot(generation) {
    if (!this.spotEnabled || generation !== this.generation || this.subscribers <= 0) return;
    clearTimeout(this.spotReconnectTimer);
    clearTimeout(this.spotFirstDepthTimer);
    clearTimeout(this.spotSnapshotTimer);
    try { this.spotSocket?.close(); } catch {}
    this.spotSocket = null;
    this.spotMode = "deep";
    this.spotTransportIndex = 0;
    this.spotAttempts = 0;
    this.resetSpotBook();
    this.connectSpot(generation);
  }

  connectSpot(generation) {
    if (!this.spotEnabled || generation !== this.generation || this.subscribers <= 0) return;
    clearTimeout(this.spotReconnectTimer);
    clearTimeout(this.spotFirstDepthTimer);
    const transports = spotTransports(this.symbol, this.spotMode);
    const transport = transports[this.spotTransportIndex % transports.length];
    let socket;
    try { socket = new WebSocket(transport.url); }
    catch {
      this.spotTransportIndex += 1;
      this.spotAttempts += 1;
      this.spotReconnectTimer = setTimeout(() => this.connectSpot(generation), 700);
      return;
    }
    this.spotSocket = socket;
    this.spotFirstDepthTimer = setTimeout(() => {
      if (generation !== this.generation || socket !== this.spotSocket) return;
      this.spotAttempts += 1;
      if (this.spotAttempts >= transports.length * 2) {
        this.spotAvailable = false;
        this.spotReady = false;
        try { socket.close(); } catch {}
        this.spotSocket = null;
        this.markDirty(true);
        return;
      }
      try { socket.close(); } catch {}
    }, 8_000);
    socket.addEventListener("open", () => {
      if (generation !== this.generation || socket !== this.spotSocket) return;
      if (transport.subscribe) socket.send(JSON.stringify({ method: "SUBSCRIBE", params: transport.streams, id: Date.now() % 2_147_483_647 }));
      if (this.spotMode === "deep") this.loadSpotSnapshot(generation);
    });
    socket.addEventListener("message", (message) => {
      if (generation !== this.generation || socket !== this.spotSocket) return;
      const payload = parsePayload(message.data);
      if (!payload) return;
      const update = payload.data;
      const bids = update?.b ?? update?.bids;
      const asks = update?.a ?? update?.asks;
      if (!Array.isArray(bids) || !Array.isArray(asks)) return;
      clearTimeout(this.spotFirstDepthTimer);
      this.spotTransportIndex = 0;
      this.spotAttempts = 0;
      this.spotAvailable = true;
      if (this.spotMode === "partial") {
        this.spotPartialBidKeys = this.replacePartial(this.spotBids, this.spotPartialBidKeys, bids);
        this.spotPartialAskKeys = this.replacePartial(this.spotAsks, this.spotPartialAskKeys, asks);
        this.spotLastUpdateId = Number(update.u ?? update.lastUpdateId) || this.spotLastUpdateId;
        this.spotReady = true;
        this.cachedSpotSorted = null;
        this.markDirty(true);
        return;
      }
      if (!Number.isFinite(Number(update?.U)) || !Number.isFinite(Number(update?.u))) return;
      if (!this.spotReady) {
        this.spotDepthBuffer.push(update);
        if (this.spotDepthBuffer.length > MAX_BUFFERED_DEPTH_EVENTS) this.spotDepthBuffer.splice(0, this.spotDepthBuffer.length - MAX_BUFFERED_DEPTH_EVENTS);
        if (!this.spotPendingSnapshot && !this.spotSnapshotLoading) this.loadSpotSnapshot(generation);
        this.installSpotSnapshot();
        return;
      }
      const decision = sequenceDecision(this.spotLastUpdateId, update, false);
      if (decision === "ignore") return;
      if (decision === "resync") {
        this.spotReady = false;
        this.spotPendingSnapshot = null;
        this.spotDepthBuffer = [];
        clearTimeout(this.spotSnapshotTimer);
        this.spotSnapshotTimer = setTimeout(() => this.loadSpotSnapshot(generation), 250);
        return;
      }
      applyDepthUpdates(this.spotBids, bids);
      applyDepthUpdates(this.spotAsks, asks);
      this.spotLastUpdateId = Number(update.u);
      this.cachedSpotSorted = null;
      this.trimSpotBook();
      this.markDirty();
    });
    socket.addEventListener("close", () => {
      if (generation !== this.generation || socket !== this.spotSocket) return;
      clearTimeout(this.spotFirstDepthTimer);
      this.spotSocket = null;
      if (!this.spotEnabled || this.spotAvailable === false) return;
      this.spotTransportIndex += 1;
      this.spotReconnectTimer = setTimeout(() => this.connectSpot(generation), 700);
    });
    socket.addEventListener("error", () => {
      if (socket === this.spotSocket) try { socket.close(); } catch {}
    });
  }

  async loadSpotSnapshot(generation) {
    if (!this.spotEnabled || generation !== this.generation || this.spotMode !== "deep" || this.spotSnapshotLoading) return;
    this.spotSnapshotLoading = true;
    const hosts = ["api.binance.com", "data-api.binance.vision", "api1.binance.com"];
    let snapshot = null;
    try {
      snapshot = await Promise.any(hosts.map(async (host) => {
        const data = await fetchJson(`https://${host}/api/v3/depth?symbol=${encodeURIComponent(this.symbol)}&limit=5000`);
        if (!Array.isArray(data?.bids) || !Array.isArray(data?.asks) || !Number.isFinite(Number(data?.lastUpdateId))) throw new Error("invalid spot snapshot");
        return data;
      }));
    } catch {}
    this.spotSnapshotLoading = false;
    if (!this.spotEnabled || generation !== this.generation || this.spotMode !== "deep") return;
    if (!snapshot) {
      this.spotMode = "partial";
      this.spotTransportIndex = 0;
      this.resetSpotBook();
      try { this.spotSocket?.close(); } catch {}
      this.spotSocket = null;
      this.spotReconnectTimer = setTimeout(() => this.connectSpot(generation), 0);
      return;
    }
    this.spotPendingSnapshot = snapshot;
    this.installSpotSnapshot();
  }

  installSpotSnapshot() {
    const snapshot = this.spotPendingSnapshot;
    if (!snapshot) return false;
    const snapshotId = Number(snapshot.lastUpdateId);
    const applicable = this.spotDepthBuffer.filter((event) => Number(event?.u) > snapshotId);
    const bridgeIndex = applicable.findIndex((event) => Number(event?.U) <= snapshotId + 1 && Number(event?.u) >= snapshotId + 1);
    if (bridgeIndex < 0) {
      const firstU = Number(applicable[0]?.U);
      if (Number.isFinite(firstU) && firstU > snapshotId + 1) {
        this.spotPendingSnapshot = null;
        clearTimeout(this.spotSnapshotTimer);
        this.spotSnapshotTimer = setTimeout(() => this.loadSpotSnapshot(this.generation), 250);
      }
      return false;
    }
    this.spotBids = new Map();
    this.spotAsks = new Map();
    applyDepthUpdates(this.spotBids, snapshot.bids);
    applyDepthUpdates(this.spotAsks, snapshot.asks);
    this.spotLastUpdateId = snapshotId;
    for (let index = bridgeIndex; index < applicable.length; index += 1) {
      const event = applicable[index];
      const decision = sequenceDecision(this.spotLastUpdateId, event, index === bridgeIndex);
      if (decision !== "apply") return false;
      applyDepthUpdates(this.spotBids, event.b ?? event.bids);
      applyDepthUpdates(this.spotAsks, event.a ?? event.asks);
      this.spotLastUpdateId = Number(event.u);
    }
    this.spotDepthBuffer = [];
    this.spotPendingSnapshot = null;
    this.spotReady = true;
    this.spotAvailable = true;
    this.cachedSpotSorted = null;
    this.trimSpotBook();
    this.markDirty(true);
    return true;
  }
}

function scheduleEmit() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = 0;
    const now = Date.now();
    for (const feed of feeds.values()) feed.emit(now);
    if ([...feeds.values()].some((feed) => feed.dirty || feed.forceEmit)) scheduleEmit();
  }, 25);
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
    tabVisible = Boolean(message.visible);
    if (tabVisible) {
      for (const feed of feeds.values()) feed.refresh();
      scheduleEmit();
    }
    return;
  }
  if (message.type === "refresh") {
    if (message.symbol) feeds.get(message.symbol)?.refresh();
    else for (const feed of feeds.values()) feed.refresh();
    scheduleEmit();
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
  if (message.type === "spot") {
    getFeed(symbol).setSpotEnabled(Boolean(message.enabled));
  }
});

post("ready", "");
