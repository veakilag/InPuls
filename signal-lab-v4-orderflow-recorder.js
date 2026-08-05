export const SIGNAL_LAB_V4_ORDERFLOW_VERSION = "signal-lab-v5-orderflow-replay-v2-2026-08";

const DEPTH_STREAM_BASE = "wss://fstream.binance.com/public/stream";
const DEPTH_SNAPSHOT_ENDPOINT = "https://fapi.binance.com/fapi/v1/depth";
const DEFAULT_PRE_EVENT_MS = 2 * 60_000;
const DEFAULT_RETAIN_MS = 3 * 60_000;
const DEFAULT_CHECKPOINT_MS = 15_000;
const DEFAULT_MAX_SYMBOLS = 6;
const DEFAULT_DEPTH_LIMIT = 1_000;

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeSymbol = (value) => {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,20}USDT$/.test(symbol) ? symbol : null;
};

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeLevels(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => [finite(row?.[0]), finite(row?.[1])])
    .filter(([price, quantity]) => price !== null && price > 0 && quantity !== null && quantity >= 0);
}

export function normalizeDepthDiff(payload, receivedAt = Date.now()) {
  const data = payload?.data ?? payload;
  const symbol = normalizeSymbol(data?.s);
  const firstUpdateId = finite(data?.U);
  const finalUpdateId = finite(data?.u);
  if (!symbol || firstUpdateId === null || finalUpdateId === null) return null;
  return Object.freeze({
    symbol,
    eventTime: finite(data?.E) ?? receivedAt,
    transactionTime: finite(data?.T) ?? finite(data?.E) ?? receivedAt,
    receivedAt,
    firstUpdateId,
    finalUpdateId,
    previousFinalUpdateId: finite(data?.pu),
    bids: Object.freeze(normalizeLevels(data?.b)),
    asks: Object.freeze(normalizeLevels(data?.a)),
  });
}

export function normalizeAggTrade(payload, receivedAt = Date.now()) {
  const data = payload?.data ?? payload;
  const symbol = normalizeSymbol(data?.s);
  const price = finite(data?.p);
  const quantity = finite(data?.q);
  const eventTime = finite(data?.E) ?? receivedAt;
  const tradeTime = finite(data?.T) ?? eventTime;
  if (!symbol || price === null || price <= 0 || quantity === null || quantity <= 0) return null;
  return Object.freeze({
    id: String(data?.a ?? `${tradeTime}:${price}:${quantity}`),
    symbol,
    eventTime,
    tradeTime,
    receivedAt,
    price,
    quantity,
    quote: price * quantity,
    side: data?.m ? "sell" : "buy",
    firstTradeId: finite(data?.f),
    lastTradeId: finite(data?.l),
  });
}


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

function createSymbolState(symbol) {
  return {
    symbol,
    generation: 0,
    snapshotReady: false,
    syncing: false,
    lastUpdateId: null,
    lastFinalUpdateId: null,
    bids: new Map(),
    asks: new Map(),
    buffered: [],
    events: [],
    trades: [],
    rawTrades: [],
    aggTradeIds: new Set(),
    rawTradeIds: new Set(),
    checkpoints: [],
    qualityEvents: [],
    lastCheckpointAt: 0,
    firstObservedAt: null,
    lastObservedAt: null,
    state: "SYNCING",
    gapCount: 0,
    recoveredCount: 0,
    snapshotErrors: 0,
  };
}

function applySide(map, rows) {
  for (const [price, quantity] of rows) {
    const key = String(price);
    if (quantity === 0) map.delete(key);
    else map.set(key, quantity);
  }
}

function sortedBookSide(map, side, limit = DEFAULT_DEPTH_LIMIT) {
  return [...map.entries()]
    .map(([price, quantity]) => [Number(price), Number(quantity)])
    .filter(([price, quantity]) => price > 0 && quantity > 0)
    .sort((left, right) => side === "bid" ? right[0] - left[0] : left[0] - right[0])
    .slice(0, limit);
}

function checkpointFromState(state, at, limit = DEFAULT_DEPTH_LIMIT) {
  return Object.freeze({
    at,
    lastUpdateId: state.lastFinalUpdateId ?? state.lastUpdateId,
    bids: Object.freeze(sortedBookSide(state.bids, "bid", limit)),
    asks: Object.freeze(sortedBookSide(state.asks, "ask", limit)),
    state: state.state,
  });
}

function eventForStorage(diff, state) {
  return Object.freeze({
    at: diff.transactionTime,
    eventTime: diff.eventTime,
    receivedAt: diff.receivedAt,
    U: diff.firstUpdateId,
    u: diff.finalUpdateId,
    pu: diff.previousFinalUpdateId,
    bids: diff.bids,
    asks: diff.asks,
    state,
  });
}

function trimRows(rows, cutoff, key = "at") {
  let index = 0;
  while (index < rows.length - 1 && Number(rows[index]?.[key]) < cutoff) index += 1;
  if (index > 0) rows.splice(0, index);
}

function markQuality(state, quality, at, reason = null) {
  if (state.state === quality && state.qualityEvents.at(-1)?.reason === reason) return;
  state.state = quality;
  state.qualityEvents.push(Object.freeze({ at, state: quality, reason }));
}

export class SignalLabV4OrderFlowRecorder {
  constructor({
    maximumSymbols = DEFAULT_MAX_SYMBOLS,
    preEventMs = DEFAULT_PRE_EVENT_MS,
    retainMs = DEFAULT_RETAIN_MS,
    checkpointIntervalMs = DEFAULT_CHECKPOINT_MS,
    depthLimit = DEFAULT_DEPTH_LIMIT,
    fetchImpl = globalThis.fetch,
    WebSocketImpl = globalThis.WebSocket,
    onStatus = () => {},
  } = {}) {
    this.maximumSymbols = Math.max(1, Math.min(12, Math.round(maximumSymbols)));
    this.preEventMs = Math.max(120_000, Math.round(preEventMs));
    this.retainMs = Math.max(this.preEventMs + 30_000, Math.round(retainMs));
    this.checkpointIntervalMs = Math.max(1_000, Math.round(checkpointIntervalMs));
    this.depthLimit = Math.max(100, Math.min(1_000, Math.round(depthLimit)));
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.onStatus = onStatus;
    this.symbols = [];
    this.signature = "";
    this.states = new Map();
    this.socket = null;
    this.generation = 0;
    this.manualClose = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.statusState = {
      connection: "idle",
      trackedSymbols: 0,
      packets: 0,
      diffs: 0,
      trades: 0,
      rawTrades: 0,
      checkpoints: 0,
      gaps: 0,
      recoveries: 0,
      lastMessageAt: null,
      lastError: null,
    };
  }

  status() {
    return Object.freeze({ ...this.statusState });
  }

  setSymbols(symbols) {
    const next = [...new Set((Array.isArray(symbols) ? symbols : [])
      .map(normalizeSymbol)
      .filter(Boolean))]
      .slice(0, this.maximumSymbols);
    const signature = next.join(",");
    if (signature === this.signature) return;
    this.symbols = next;
    this.signature = signature;
    for (const symbol of next) {
      if (!this.states.has(symbol)) this.states.set(symbol, createSymbolState(symbol));
    }
    this.#connect();
  }

  disconnect() {
    this.manualClose = true;
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdogTimer);
    this.socket?.close();
    this.socket = null;
    this.symbols = [];
    this.signature = "";
    this.#publish({ connection: "stopped", trackedSymbols: 0 });
  }

  clear() {
    this.states.clear();
    this.#publish({
      diffs: 0,
      trades: 0,
      rawTrades: 0,
      checkpoints: 0,
      gaps: 0,
      recoveries: 0,
    });
  }

  ingestTrade(payload, receivedAt = Date.now()) {
    const trade = normalizeAggTrade(payload, receivedAt);
    if (!trade) return null;
    const state = this.states.get(trade.symbol);
    if (!state || !this.symbols.includes(trade.symbol)) return trade;
    if (state.aggTradeIds.has(trade.id)) return trade;
    state.aggTradeIds.add(trade.id);
    state.trades.push(trade);
    state.firstObservedAt = state.firstObservedAt === null
      ? trade.tradeTime
      : Math.min(state.firstObservedAt, trade.tradeTime);
    state.lastObservedAt = Math.max(state.lastObservedAt ?? 0, trade.tradeTime);
    this.#trim(state, receivedAt);
    this.#publish({ trades: this.statusState.trades + 1 });
    return trade;
  }


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

  capture(symbol, from, to = Date.now()) {
    const normalized = normalizeSymbol(symbol);
    const state = this.states.get(normalized);
    if (!state) return null;
    const requestedFrom = finite(from) ?? to - this.preEventMs;
    const requestedTo = finite(to) ?? Date.now();
    const checkpoints = state.checkpoints.filter((row) => row.at <= requestedTo);
    const initial = [...checkpoints].reverse().find((row) => row.at <= requestedFrom)
      ?? checkpoints[0]
      ?? null;
    if (!initial) return null;
    const events = state.events.filter((row) => row.at > initial.at && row.at <= requestedTo);
    const trades = state.trades.filter((row) => row.tradeTime >= requestedFrom && row.tradeTime <= requestedTo);
    const rawTrades = state.rawTrades.filter((row) => row.tradeTime >= requestedFrom && row.tradeTime <= requestedTo);
    const qualityEvents = state.qualityEvents.filter((row) => row.at >= initial.at && row.at <= requestedTo);
    const earliest = Math.min(
      initial.at,
      events[0]?.at ?? Infinity,
      trades[0]?.tradeTime ?? Infinity,
    );
    return Object.freeze({
      schemaVersion: 1,
      entity: "SignalLabOrderFlowReplay",
      version: SIGNAL_LAB_V4_ORDERFLOW_VERSION,
      symbol: normalized,
      requestedFrom,
      requestedTo,
      initialCheckpoint: clone(initial),
      checkpoints: clone(checkpoints.filter((row) => row.at >= initial.at)),
      events: clone(events),
      trades: clone(trades),
      rawTrades: clone(rawTrades),
      qualityEvents: clone(qualityEvents),
      coverage: Object.freeze({
        requestedPreSeconds: Math.max(0, Math.round((requestedTo - requestedFrom) / 1_000)),
        availableFrom: Number.isFinite(earliest) ? earliest : null,
        preSeconds: Number.isFinite(earliest)
          ? Math.max(0, Math.round((requestedTo - Math.max(requestedFrom, earliest)) / 1_000))
          : 0,
        state: state.state,
        gaps: state.gapCount,
        recoveries: state.recoveredCount,
        depthContinuous: !qualityEvents.some((row) => ["GAP", "ERROR", "STALE"].includes(row.state)),
        preEventComplete: Number.isFinite(earliest) && earliest <= requestedFrom
          && !qualityEvents.some((row) => ["GAP", "ERROR", "STALE"].includes(row.state)),
        aggTrades: trades.length,
        rawTrades: rawTrades.length,
        rawMode: rawTrades.length ? "SHADOW_RECORDED" : "NOT_RECORDED",
      }),
    });
  }

  #connect() {
    this.manualClose = false;
    this.generation += 1;
    const generation = this.generation;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdogTimer);
    this.socket?.close();
    this.socket = null;
    if (!this.symbols.length || typeof this.WebSocketImpl !== "function") {
      this.#publish({ connection: this.symbols.length ? "error" : "idle", trackedSymbols: this.symbols.length });
      return;
    }

    const streams = this.symbols.flatMap((symbol) => [
      `${symbol.toLowerCase()}@depth@100ms`,
      `${symbol.toLowerCase()}@trade`,
    ]);
    const socket = new this.WebSocketImpl(`${DEPTH_STREAM_BASE}?streams=${streams.join("/")}`);
    this.socket = socket;
    const packetsAtConnect = this.statusState.packets;
    this.#publish({ connection: "connecting", trackedSymbols: this.symbols.length, lastError: null });

    for (const symbol of this.symbols) this.#bootstrap(symbol, generation);
    this.watchdogTimer = setTimeout(() => {
      if (generation !== this.generation || this.statusState.packets > packetsAtConnect) return;
      this.#publish({ connection: "error", lastError: "depth diff не прислал первый пакет" });
      socket.close();
    }, 10_000);

    socket.addEventListener("open", () => {
      if (generation !== this.generation) return;
      this.reconnectAttempt = 0;
      this.#publish({ connection: "syncing" });
    });
    socket.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const receivedAt = Date.now();
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
      });
    });
    socket.addEventListener("close", () => {
      if (generation !== this.generation || this.manualClose || !this.symbols.length) return;
      this.reconnectAttempt += 1;
      const baseDelay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
      const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
      this.#publish({ connection: "reconnecting" });
      this.reconnectTimer = setTimeout(() => {
        if (generation === this.generation) this.#connect();
      }, delay);
    });
    socket.addEventListener("error", () => {
      if (generation !== this.generation) return;
      this.#publish({ connection: "error", lastError: "ошибка depth diff Binance" });
    });
  }

  async #bootstrap(symbol, generation) {
    const state = this.states.get(symbol) ?? createSymbolState(symbol);
    this.states.set(symbol, state);
    state.generation += 1;
    const stateGeneration = state.generation;
    state.snapshotReady = false;
    state.syncing = true;
    state.buffered = [];
    markQuality(state, "SYNCING", Date.now(), "snapshot");
    try {
      const query = new URLSearchParams({ symbol, limit: String(this.depthLimit) });
      const response = await this.fetchImpl(`${DEPTH_SNAPSHOT_ENDPOINT}?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Depth snapshot HTTP ${response.status}`);
      const payload = await response.json();
      if (generation !== this.generation || stateGeneration !== state.generation) return;
      const lastUpdateId = finite(payload?.lastUpdateId);
      if (lastUpdateId === null) throw new Error("Depth snapshot без lastUpdateId");
      state.bids.clear();
      state.asks.clear();
      applySide(state.bids, normalizeLevels(payload?.bids));
      applySide(state.asks, normalizeLevels(payload?.asks));
      state.lastUpdateId = lastUpdateId;
      state.lastFinalUpdateId = lastUpdateId;
      state.snapshotReady = true;
      state.syncing = false;
      const buffered = [...state.buffered].sort((left, right) => left.finalUpdateId - right.finalUpdateId);
      state.buffered = [];
      let started = false;
      for (const diff of buffered) {
        if (diff.finalUpdateId <= lastUpdateId) continue;
        if (!started) {
          const expected = lastUpdateId + 1;
          if (!(diff.firstUpdateId <= expected && diff.finalUpdateId >= expected)) continue;
          started = true;
        }
        if (!this.#applyDiff(state, diff)) return;
      }
      markQuality(state, state.gapCount ? "RECOVERED" : "LIVE", Date.now(), "snapshot-ready");
      if (state.gapCount) {
        state.recoveredCount += 1;
        this.#publish({ recoveries: this.statusState.recoveries + 1 });
      }
      this.#checkpoint(state, Date.now(), true);
    } catch (error) {
      if (generation !== this.generation || stateGeneration !== state.generation) return;
      state.syncing = false;
      state.snapshotErrors += 1;
      markQuality(state, "ERROR", Date.now(), String(error?.message ?? error).slice(0, 160));
      this.#publish({ lastError: String(error?.message ?? error).slice(0, 180) });
    }
  }

  #ingestDiff(diff, generation) {
    const state = this.states.get(diff.symbol);
    if (!state || generation !== this.generation) return;
    state.firstObservedAt = state.firstObservedAt === null
      ? diff.transactionTime
      : Math.min(state.firstObservedAt, diff.transactionTime);
    state.lastObservedAt = Math.max(state.lastObservedAt ?? 0, diff.transactionTime);
    if (!state.snapshotReady) {
      state.buffered.push(diff);
      if (state.buffered.length > 5_000) state.buffered.splice(0, state.buffered.length - 5_000);
      return;
    }
    this.#applyDiff(state, diff);
  }

  #applyDiff(state, diff) {
    if (diff.finalUpdateId <= Number(state.lastFinalUpdateId)) return true;
    const expected = Number(state.lastFinalUpdateId) + 1;
    const continuousByPu = diff.previousFinalUpdateId !== null
      ? diff.previousFinalUpdateId === Number(state.lastFinalUpdateId)
      : diff.firstUpdateId <= expected && diff.finalUpdateId >= expected;
    if (!continuousByPu) {
      state.gapCount += 1;
      markQuality(state, "GAP", diff.receivedAt, `expected ${expected}, got ${diff.firstUpdateId}/${diff.previousFinalUpdateId}`);
      this.#publish({ gaps: this.statusState.gaps + 1 });
      this.#bootstrap(state.symbol, this.generation);
      return false;
    }
    applySide(state.bids, diff.bids);
    applySide(state.asks, diff.asks);
    state.lastFinalUpdateId = diff.finalUpdateId;
    state.events.push(eventForStorage(diff, state.state));
    markQuality(state, state.state === "RECOVERED" ? "RECOVERED" : "LIVE", diff.receivedAt);
    this.#checkpoint(state, diff.receivedAt);
    this.#trim(state, diff.receivedAt);
    this.#publish({ diffs: this.statusState.diffs + 1 });
    return true;
  }

  #checkpoint(state, at, force = false) {
    if (!force && at - state.lastCheckpointAt < this.checkpointIntervalMs) return;
    state.lastCheckpointAt = at;
    state.checkpoints.push(checkpointFromState(state, at, this.depthLimit));
    this.#publish({ checkpoints: this.statusState.checkpoints + 1 });
  }

  #trim(state, now) {
    const cutoff = now - this.retainMs;
    trimRows(state.events, cutoff, "at");
    trimRows(state.trades, cutoff, "tradeTime");
    trimRows(state.rawTrades, cutoff, "tradeTime");
    state.aggTradeIds = new Set(state.trades.map((row) => row.id));
    state.rawTradeIds = new Set(state.rawTrades.map((row) => row.id));
    trimRows(state.qualityEvents, cutoff, "at");
    trimRows(state.checkpoints, cutoff, "at");
  }

  #publish(patch = {}) {
    Object.assign(this.statusState, patch);
    try {
      this.onStatus(Object.freeze({ ...this.statusState }));
    } catch {
      // Diagnostics must not interrupt market collection.
    }
  }
}

function mapFromLevels(rows) {
  return new Map(normalizeLevels(rows).map(([price, quantity]) => [String(price), quantity]));
}

export function reconstructOrderBook(replay, selectedAt) {
  const at = finite(selectedAt) ?? finite(replay?.requestedTo) ?? Date.now();
  const checkpoints = [replay?.initialCheckpoint, ...(replay?.checkpoints ?? [])]
    .filter((row) => row && finite(row.at) !== null && row.at <= at)
    .sort((left, right) => left.at - right.at);
  const checkpoint = checkpoints.at(-1);
  if (!checkpoint) return null;
  const bids = mapFromLevels(checkpoint.bids);
  const asks = mapFromLevels(checkpoint.asks);
  let lastUpdateId = finite(checkpoint.lastUpdateId);
  let state = checkpoint.state ?? replay?.coverage?.state ?? "UNKNOWN";
  const events = (Array.isArray(replay?.events) ? replay.events : [])
    .filter((row) => row.at > checkpoint.at && row.at <= at)
    .sort((left, right) => left.at - right.at);
  for (const event of events) {
    applySide(bids, normalizeLevels(event.bids));
    applySide(asks, normalizeLevels(event.asks));
    lastUpdateId = finite(event.u) ?? lastUpdateId;
    state = event.state ?? state;
  }
  return Object.freeze({
    at,
    checkpointAt: checkpoint.at,
    lastUpdateId,
    state,
    bids: Object.freeze(sortedBookSide(bids, "bid", DEFAULT_DEPTH_LIMIT)),
    asks: Object.freeze(sortedBookSide(asks, "ask", DEFAULT_DEPTH_LIMIT)),
  });
}
