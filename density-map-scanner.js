import {
  DensityLifetimeTracker,
  densityMarketKey,
  findSnapshotDensities,
  interleaveDensityUniverse,
  normalizeDensityFilters,
} from "./density-map-engine.js?v=density-map-v1";
import { ExchangeOrderBookFeed } from "./exchange-orderbook-feed.js?v=26-126-final-exchanges-v1";
import { fetchExchangeOrderBook } from "./exchange-market-data.js?v=26-126-final-exchanges-v1";
import { fetchExchangeTickers } from "./exchange-radar-feed.js?v=26-126-final-exchanges-v1";
import { EXCHANGES, EXCHANGE_IDS } from "./exchange-registry.js?v=26-126-final-exchanges-v1";

export const DENSITY_MAP_SCANNER_VERSION = "density-map-scanner-v1";

function sourceDescriptors() {
  return EXCHANGE_IDS.flatMap((exchange) => (
    (EXCHANGES[exchange]?.markets ?? []).map((market) => ({ exchange, market }))
  ));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DensityMapScanner {
  constructor({
    minQuote = 100_000,
    minLifetimeMs = 30_000,
    depthLevels = 100,
    scanDelayMs = 220,
    maxLiveMarkets = 64,
    fetchImpl = globalThis.fetch,
    WebSocketImpl = globalThis.WebSocket,
    fetchTickers = fetchExchangeTickers,
    fetchOrderBook = fetchExchangeOrderBook,
    OrderBookFeedClass = ExchangeOrderBookFeed,
    sources = sourceDescriptors(),
    onUpdate = () => {},
  } = {}) {
    this.filters = normalizeDensityFilters({ minQuote, minLifetimeMs });
    this.depthLevels = Math.max(20, Math.min(1_000, Number(depthLevels) || 100));
    this.scanDelayMs = Math.max(80, Number(scanDelayMs) || 220);
    this.maxLiveMarkets = Math.max(4, Number(maxLiveMarkets) || 64);
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.fetchTickers = fetchTickers;
    this.fetchOrderBook = fetchOrderBook;
    this.OrderBookFeedClass = OrderBookFeedClass;
    this.sources = [...sources];
    this.onUpdate = onUpdate;
    this.tracker = new DensityLifetimeTracker({ minQuote: this.filters.minQuote });
    this.universe = [];
    this.cursor = 0;
    this.cycle = 0;
    this.scanned = 0;
    this.sourceTotal = this.sources.length;
    this.sourceComplete = 0;
    this.sourceFailed = 0;
    this.requestFailures = 0;
    this.lastUniverseLoadAt = 0;
    this.running = false;
    this.paused = false;
    this.phase = "idle";
    this.generation = 0;
    this.abortControllers = new Set();
    this.liveMarkets = new Map();
    this.lastEmitAt = 0;
    this.emitTimer = null;
    this.loadingUniverse = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.generation += 1;
    const generation = this.generation;
    this.#run(generation);
  }

  setPaused(value) {
    this.paused = Boolean(value);
    if (this.paused && this.phase !== "loading") {
      for (const controller of this.abortControllers) controller.abort();
    }
    this.phase = this.paused ? "paused" : this.universe.length ? "scanning" : "loading";
    this.#emit(true);
  }

  setFilters(value = {}) {
    const next = normalizeDensityFilters({ ...this.filters, ...value });
    const quoteChanged = next.minQuote !== this.filters.minQuote;
    this.filters = next;
    if (quoteChanged) this.tracker.setMinQuote(next.minQuote);
    this.#emit(true);
  }

  snapshot(now = Date.now()) {
    const entries = this.tracker.active({
      minLifetimeMs: this.filters.minLifetimeMs,
      at: now,
    });
    return {
      entries,
      filters: this.filters,
      stats: {
        phase: this.phase,
        sourceTotal: this.sourceTotal,
        sourceComplete: this.sourceComplete,
        sourceFailed: this.sourceFailed,
        universeTotal: this.universe.length,
        scanned: this.scanned,
        cycle: this.cycle,
        liveMarkets: this.liveMarkets.size,
        candidates: this.tracker.size,
        matches: entries.length,
        requestFailures: this.requestFailures,
        cursor: this.cursor,
      },
    };
  }

  destroy() {
    if (!this.running && !this.liveMarkets.size) return;
    this.running = false;
    this.paused = false;
    this.phase = "stopped";
    this.generation += 1;
    for (const controller of this.abortControllers) controller.abort();
    this.abortControllers.clear();
    clearTimeout(this.emitTimer);
    this.emitTimer = null;
    for (const live of this.liveMarkets.values()) live.feed.destroy();
    this.liveMarkets.clear();
  }

  async #run(generation) {
    await this.#loadUniverse(generation);
    if (!this.running || generation !== this.generation) return;
    this.phase = this.paused ? "paused" : "scanning";
    this.#emit(true);
    while (this.running && generation === this.generation) {
      if (this.paused || !this.universe.length) {
        await delay(300);
        continue;
      }
      const item = this.universe[this.cursor];
      await this.#scanMarket(item, generation);
      if (!this.running || generation !== this.generation) return;
      this.cursor += 1;
      this.scanned += 1;
      if (this.cursor >= this.universe.length) {
        this.cursor = 0;
        this.cycle += 1;
        if (Date.now() - this.lastUniverseLoadAt >= 15 * 60_000) {
          await this.#loadUniverse(generation, true);
        }
      }
      this.#sweepLiveMarkets();
      this.#emit();
      await delay(this.scanDelayMs);
    }
  }

  async #loadUniverse(generation, refresh = false) {
    if (this.loadingUniverse) return;
    this.loadingUniverse = true;
    this.phase = "loading";
    this.sourceComplete = 0;
    this.sourceFailed = 0;
    this.#emit(true);
    const sources = this.sources;
    const groups = new Array(sources.length);
    let next = 0;
    const worker = async () => {
      while (next < sources.length && this.running && generation === this.generation) {
        const index = next;
        next += 1;
        const source = sources[index];
        const controller = new AbortController();
        this.abortControllers.add(controller);
        try {
          const rows = await this.fetchTickers(source, {
            fetchImpl: this.fetchImpl,
            signal: controller.signal,
            refresh,
          });
          groups[index] = { ...source, rows };
        } catch (error) {
          if (error?.name !== "AbortError") this.sourceFailed += 1;
          groups[index] = { ...source, rows: [] };
        } finally {
          this.abortControllers.delete(controller);
          this.sourceComplete += 1;
          this.#emit();
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (this.running && generation === this.generation) {
      const nextUniverse = interleaveDensityUniverse(groups);
      if (nextUniverse.length) {
        this.universe = nextUniverse;
        this.cursor = Math.min(this.cursor, Math.max(0, nextUniverse.length - 1));
        this.lastUniverseLoadAt = Date.now();
      }
    }
    this.loadingUniverse = false;
  }

  async #scanMarket(item, generation) {
    if (!item) return;
    const key = densityMarketKey(item);
    if (this.liveMarkets.has(key)) return;
    const controller = new AbortController();
    this.abortControllers.add(controller);
    try {
      const snapshot = await this.fetchOrderBook(item, this.depthLevels, {
        fetchImpl: this.fetchImpl,
        signal: controller.signal,
      });
      if (!this.running || generation !== this.generation || this.paused) return;
      const detected = findSnapshotDensities(snapshot, this.filters.minQuote);
      if (!detected.length) return;
      if (!this.#ensureLiveMarket(item, detected)) return;
      this.tracker.updateMarket(item, snapshot, Date.now());
    } catch (error) {
      if (error?.name !== "AbortError") this.requestFailures += 1;
    } finally {
      this.abortControllers.delete(controller);
    }
  }

  #ensureLiveMarket(item, detected) {
    const key = densityMarketKey(item);
    const existing = this.liveMarkets.get(key);
    const score = Math.max(...detected.map((entry) => entry.quote));
    if (existing) {
      existing.score = score;
      existing.lastDensityAt = Date.now();
      return true;
    }
    if (this.liveMarkets.size >= this.maxLiveMarkets) {
      const weakest = [...this.liveMarkets.values()]
        .sort((left, right) => left.score - right.score)[0];
      if (!weakest || score <= weakest.score * 1.05) return false;
      this.#removeLiveMarket(weakest.key);
    }
    const live = {
      key,
      source: item,
      score,
      lastDataAt: Date.now(),
      lastDensityAt: Date.now(),
      feed: null,
    };
    live.feed = new this.OrderBookFeedClass({
      exchange: item.exchange,
      market: item.market,
      fetchImpl: this.fetchImpl,
      WebSocketImpl: this.WebSocketImpl,
      depthOnly: true,
      onData: (snapshot) => {
        if (!this.running || this.liveMarkets.get(key) !== live) return;
        const now = Date.now();
        live.lastDataAt = now;
        const found = this.tracker.updateMarket(item, snapshot, now);
        if (found.length) {
          live.score = Math.max(...found.map((entry) => entry.quote));
          live.lastDensityAt = now;
        }
        this.#emit();
      },
      onStatus: () => {},
    });
    this.liveMarkets.set(key, live);
    live.feed.select(item.symbol);
    return true;
  }

  #sweepLiveMarkets(now = Date.now()) {
    for (const live of this.liveMarkets.values()) {
      if (now - live.lastDataAt > 45_000 || now - live.lastDensityAt > 12_000) {
        this.#removeLiveMarket(live.key);
      }
    }
  }

  #removeLiveMarket(key) {
    const live = this.liveMarkets.get(key);
    if (!live) return;
    live.feed.destroy();
    this.liveMarkets.delete(key);
    this.tracker.clearMarket(key);
  }

  #emit(immediate = false) {
    const now = Date.now();
    if (!immediate && now - this.lastEmitAt < 180) {
      if (!this.emitTimer) {
        this.emitTimer = setTimeout(() => {
          this.emitTimer = null;
          this.#emit(true);
        }, 180 - (now - this.lastEmitAt));
      }
      return;
    }
    this.lastEmitAt = now;
    this.onUpdate(this.snapshot(now));
  }
}
