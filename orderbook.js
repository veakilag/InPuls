export function applyDepthUpdates(levels, updates) {
  for (const [priceValue, quantityValue] of updates ?? []) {
    const price = Number(priceValue);
    const quantity = Number(quantityValue);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
    if (quantity === 0) levels.delete(price);
    else levels.set(price, quantity);
  }
  return levels;
}

export function depthView(bids, asks, limit = 24) {
  const safeLimit = Math.max(1, Math.floor(limit));
  return {
    bids: [...bids.entries()].sort((left, right) => right[0] - left[0]).slice(0, safeLimit),
    asks: [...asks.entries()].sort((left, right) => left[0] - right[0]).slice(0, safeLimit),
  };
}

export class OrderBookFeed {
  constructor({ onData, onStatus, fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket } = {}) {
    this.onData = onData ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.symbol = null;
    this.bids = new Map();
    this.asks = new Map();
    this.buffer = [];
    this.lastUpdateId = null;
    this.ready = false;
    this.streamStarted = false;
    this.generation = 0;
    this.reconnectTimer = null;
  }

  select(symbol) {
    if (!symbol?.endsWith("USDT")) return;
    this.symbol = symbol;
    this.#start(++this.generation);
  }

  async #start(generation) {
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.bids = new Map();
    this.asks = new Map();
    this.buffer = [];
    this.lastUpdateId = null;
    this.ready = false;
    this.streamStarted = false;
    this.onStatus({ state: "loading", text: "Синхронизация" });
    const stream = `${this.symbol.toLowerCase()}@depth@100ms`;
    const socket = new this.WebSocketImpl(`wss://fstream.binance.com/ws/${stream}`);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      let update;
      try { update = JSON.parse(event.data); } catch { return; }
      if (!this.ready) this.buffer.push(update);
      else this.#applyEvent(update, generation);
    });
    socket.addEventListener("close", () => {
      if (generation !== this.generation) return;
      this.ready = false;
      this.onStatus({ state: "offline", text: "Переподключение" });
      this.reconnectTimer = setTimeout(() => this.#start(generation), 1200);
    });
    socket.addEventListener("error", () => this.onStatus({ state: "offline", text: "Ошибка потока" }));
    try {
      const response = await this.fetchImpl(`https://fapi.binance.com/fapi/v1/depth?symbol=${this.symbol}&limit=1000`, { cache: "no-store" });
      if (!response.ok) throw new Error("Depth snapshot unavailable");
      const snapshot = await response.json();
      if (generation !== this.generation) return;
      applyDepthUpdates(this.bids, snapshot.bids);
      applyDepthUpdates(this.asks, snapshot.asks);
      this.lastUpdateId = Number(snapshot.lastUpdateId);
      const buffered = this.buffer.splice(0).filter((event) => Number(event.u) >= this.lastUpdateId);
      this.ready = true;
      for (const event of buffered) {
        if (!this.#applyEvent(event, generation)) return;
      }
      this.#emit();
      this.onStatus({ state: "online", text: "LIVE" });
    } catch {
      if (generation !== this.generation) return;
      this.onStatus({ state: "offline", text: "Нет снимка" });
      this.reconnectTimer = setTimeout(() => this.#start(generation), 1800);
    }
  }

  #applyEvent(event, generation) {
    const firstUpdate = Number(event.U);
    const finalUpdate = Number(event.u);
    const previousFinal = Number(event.pu);
    if (!Number.isFinite(firstUpdate) || !Number.isFinite(finalUpdate)) return true;
    if (finalUpdate < this.lastUpdateId) return true;
    const bridgesSnapshot = firstUpdate <= this.lastUpdateId + 1 && finalUpdate >= this.lastUpdateId;
    const continuesStream = previousFinal === this.lastUpdateId || firstUpdate === this.lastUpdateId + 1;
    const sequenceValid = this.streamStarted ? continuesStream : bridgesSnapshot;
    if (!sequenceValid) {
      this.ready = false;
      this.#start(++this.generation);
      return false;
    }
    applyDepthUpdates(this.bids, event.b);
    applyDepthUpdates(this.asks, event.a);
    this.lastUpdateId = finalUpdate;
    this.streamStarted = true;
    this.#trim();
    if (generation === this.generation) this.#emit();
    return true;
  }

  #trim() {
    if (this.bids.size <= 1400 && this.asks.size <= 1400) return;
    const view = depthView(this.bids, this.asks, 1000);
    this.bids = new Map(view.bids);
    this.asks = new Map(view.asks);
  }

  #emit() {
    const view = depthView(this.bids, this.asks, 80);
    this.onData({ symbol: this.symbol, ...view, lastUpdateId: this.lastUpdateId });
  }

  destroy() {
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }
}
