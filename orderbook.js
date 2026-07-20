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

export function partialDepthView(event, limit = 20) {
  const bids = new Map();
  const asks = new Map();
  applyDepthUpdates(bids, event?.b ?? event?.bids);
  applyDepthUpdates(asks, event?.a ?? event?.asks);
  return depthView(bids, asks, limit);
}

export class OrderBookFeed {
  constructor({ onData, onStatus, WebSocketImpl = globalThis.WebSocket } = {}) {
    this.onData = onData ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.symbol = null;
    this.generation = 0;
    this.attemptIndex = 0;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
  }

  select(symbol) {
    if (!symbol?.endsWith("USDT")) return;
    this.symbol = symbol;
    this.#start(++this.generation);
  }

  async #start(generation) {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdogTimer);
    this.socket?.close();
    this.onStatus({ state: "loading", text: "Подключение" });
    const streams = [`${this.symbol.toLowerCase()}@depth20@100ms`, `${this.symbol.toLowerCase()}@depth20@250ms`];
    const transports = [
      { url: "wss://fstream.binance.com/public/stream", subscribe: true },
      { url: "wss://fstream.binance.com/public/ws", subscribe: false },
      { url: "wss://stream.binancefuture.com/public/stream", subscribe: true },
      { url: "wss://stream.binancefuture.com/public/ws", subscribe: false },
    ];
    const attempt = this.attemptIndex % (transports.length * streams.length);
    const transport = transports[attempt % transports.length];
    const stream = streams[Math.floor(attempt / transports.length)];
    const socket = new this.WebSocketImpl(transport.subscribe ? transport.url : `${transport.url}/${stream}`);
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (generation !== this.generation) return;
      if (transport.subscribe) socket.send(JSON.stringify({ method: "SUBSCRIBE", params: [stream], id: Date.now() % 2_147_483_647 }));
      this.onStatus({ state: "loading", text: "Синхронизация" });
      this.watchdogTimer = setTimeout(() => socket.close(), 4200);
    });
    socket.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      let update;
      try { update = JSON.parse(event.data); } catch { return; }
      if (update.result === null || update.id) return;
      update = update.data ?? update;
      const view = partialDepthView(update, 20);
      if (!view.bids.length || !view.asks.length) return;
      clearTimeout(this.watchdogTimer);
      this.onData({ symbol: this.symbol, ...view, lastUpdateId: Number(update.u) || null, eventTime: Number(update.E) || Date.now() });
      this.attemptIndex = 0;
      this.onStatus({ state: "online", text: stream.endsWith("250ms") ? "LIVE 250ms" : "LIVE 100ms" });
    });
    socket.addEventListener("close", () => {
      if (generation !== this.generation) return;
      clearTimeout(this.watchdogTimer);
      this.attemptIndex += 1;
      this.onStatus({ state: "offline", text: "Переподключение" });
      this.reconnectTimer = setTimeout(() => this.#start(generation), 450);
    });
    socket.addEventListener("error", () => this.onStatus({ state: "offline", text: "Ошибка потока" }));
  }

  destroy() {
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdogTimer);
    this.socket?.close();
    this.socket = null;
  }
}
