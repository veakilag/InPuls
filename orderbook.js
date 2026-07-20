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

export function normalizeMarketTrade(event) {
  const price = Number(event?.p);
  const quantity = Number(event?.q);
  const time = Number(event?.T ?? event?.E);
  if (![price, quantity, time].every(Number.isFinite)) return null;
  return {
    id: Number(event?.a) || `${time}-${price}-${quantity}`,
    price,
    quantity,
    quote: price * quantity,
    time,
    side: event?.m ? "sell" : "buy",
  };
}

export function aggregateDepthBands(levels, middlePrice, rangePercent, rowCount, side) {
  const count = Math.max(1, Math.floor(Number(rowCount) || 1));
  const middle = Number(middlePrice);
  const percent = Math.max(.5, Math.min(100, Number(rangePercent) || .5));
  if (!Number.isFinite(middle) || middle <= 0) return [];
  const span = middle * percent / 100;
  const step = span / count;
  const bands = Array.from({ length: count }, (_, index) => ({
    price: side === "ask" ? middle + step * (index + .5) : middle - step * (index + .5),
    quantity: 0,
    quote: 0,
  }));
  for (const [priceValue, quantityValue] of levels ?? []) {
    const price = Number(priceValue);
    const quantity = Number(quantityValue);
    if (![price, quantity].every(Number.isFinite) || quantity <= 0) continue;
    const distance = side === "ask" ? price - middle : middle - price;
    if (distance < 0 || distance > span) continue;
    const index = Math.min(count - 1, Math.floor(distance / Math.max(Number.MIN_VALUE, step)));
    bands[index].quantity += quantity;
    bands[index].quote += price * quantity;
  }
  return bands;
}

export class OrderBookFeed {
  constructor({ onData, onStatus, WebSocketImpl = globalThis.WebSocket, fetchImpl = globalThis.fetch } = {}) {
    this.onData = onData ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.WebSocketImpl = WebSocketImpl;
    this.fetchImpl = fetchImpl;
    this.socket = null;
    this.symbol = null;
    this.generation = 0;
    this.attemptIndex = 0;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.snapshotTimer = null;
    this.bids = new Map();
    this.asks = new Map();
    this.partialBidKeys = new Set();
    this.partialAskKeys = new Set();
    this.trades = [];
    this.lastUpdateId = null;
    this.cachedDepth = null;
  }

  select(symbol) {
    if (!symbol?.endsWith("USDT")) return;
    this.symbol = symbol;
    this.bids.clear();
    this.asks.clear();
    this.partialBidKeys.clear();
    this.partialAskKeys.clear();
    this.trades = [];
    this.lastUpdateId = null;
    this.cachedDepth = null;
    clearTimeout(this.snapshotTimer);
    const generation = ++this.generation;
    this.#start(generation);
    this.#loadDeepSnapshot(generation);
  }

  #replacePartialSide(target, previousKeys, rows) {
    const nextKeys = new Set();
    for (const [priceValue, quantityValue] of rows ?? []) {
      const price = Number(priceValue);
      const quantity = Number(quantityValue);
      if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
      nextKeys.add(price);
      if (quantity > 0) target.set(price, quantity);
      else target.delete(price);
    }
    for (const price of previousKeys) if (!nextKeys.has(price)) target.delete(price);
    return nextKeys;
  }

  #emit(eventTime = Date.now(), refreshDepth = false) {
    if (refreshDepth || !this.cachedDepth) this.cachedDepth = depthView(this.bids, this.asks, 1000);
    const view = this.cachedDepth;
    if (!view.bids.length || !view.asks.length) return;
    this.onData({
      symbol: this.symbol,
      ...view,
      trades: this.trades.slice(),
      lastUpdateId: this.lastUpdateId,
      eventTime,
    });
  }

  async #loadDeepSnapshot(generation) {
    if (typeof this.fetchImpl !== "function") return;
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
    for (const host of hosts) {
      try {
        const response = await this.fetchImpl(`https://${host}/fapi/v1/depth?symbol=${this.symbol}&limit=1000`, { cache: "no-store" });
        if (!response?.ok || generation !== this.generation) continue;
        const snapshot = await response.json();
        if (generation !== this.generation || !Array.isArray(snapshot?.bids) || !Array.isArray(snapshot?.asks)) return;
        this.bids = applyDepthUpdates(new Map(), snapshot.bids);
        this.asks = applyDepthUpdates(new Map(), snapshot.asks);
        this.lastUpdateId = Number(snapshot.lastUpdateId) || this.lastUpdateId;
        this.#emit(Date.now(), true);
        break;
      } catch {}
    }
    if (generation === this.generation) this.snapshotTimer = setTimeout(() => this.#loadDeepSnapshot(generation), 15_000);
  }

  async #start(generation) {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdogTimer);
    this.socket?.close();
    this.onStatus({ state: "loading", text: "Подключение" });
    const rate = this.attemptIndex % 4 === 3 ? "500ms" : "100ms";
    const depthStream = `${this.symbol.toLowerCase()}@depth20@${rate}`;
    const tradeStream = `${this.symbol.toLowerCase()}@aggTrade`;
    const streams = `${depthStream}/${tradeStream}`;
    const transports = [
      { url: `wss://fstream.binance.com/public/stream?streams=${streams}`, subscribe: false },
      { url: `wss://fstream.binance.com/stream?streams=${streams}`, subscribe: false },
      { url: "wss://fstream.binance.com/public/stream", subscribe: true },
      { url: `wss://stream.binancefuture.com/stream?streams=${streams}`, subscribe: false },
    ];
    const transport = transports[this.attemptIndex % transports.length];
    const socket = new this.WebSocketImpl(transport.url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (generation !== this.generation) return;
      if (transport.subscribe) socket.send(JSON.stringify({ method: "SUBSCRIBE", params: [depthStream, tradeStream], id: Date.now() % 2_147_483_647 }));
      this.onStatus({ state: "loading", text: "Синхронизация" });
      this.watchdogTimer = setTimeout(() => socket.close(), 7000);
    });
    socket.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      let update;
      try { update = JSON.parse(event.data); } catch { return; }
      if (update.result === null || update.id) return;
      const streamName = update.stream ?? "";
      update = update.data ?? update;
      if (update.e === "aggTrade" || streamName.endsWith("@aggTrade")) {
        const trade = normalizeMarketTrade(update);
        if (!trade) return;
        this.trades.unshift(trade);
        if (this.trades.length > 160) this.trades.length = 160;
        this.#emit(trade.time);
        return;
      }
      const bidRows = update?.b ?? update?.bids;
      const askRows = update?.a ?? update?.asks;
      if (!Array.isArray(bidRows) || !Array.isArray(askRows)) return;
      this.partialBidKeys = this.#replacePartialSide(this.bids, this.partialBidKeys, bidRows);
      this.partialAskKeys = this.#replacePartialSide(this.asks, this.partialAskKeys, askRows);
      this.lastUpdateId = Number(update.u) || this.lastUpdateId;
      clearTimeout(this.watchdogTimer);
      this.#emit(Number(update.E) || Date.now(), true);
      this.attemptIndex = 0;
      this.onStatus({ state: "online", text: rate === "500ms" ? "LIVE 500ms" : "LIVE 100ms" });
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
    clearTimeout(this.snapshotTimer);
    this.socket?.close();
    this.socket = null;
  }
}
