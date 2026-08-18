export const DENSITY_MAP_ENGINE_VERSION = "density-map-v1";

const DEFAULT_MIN_QUOTE = 100_000;
const DEFAULT_MIN_LIFETIME_MS = 30_000;

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function bounded(value, minimum, maximum, fallback) {
  return Math.max(minimum, Math.min(maximum, finitePositive(value, fallback)));
}

export function normalizeDensityFilters(value = {}) {
  const lifetime = Number(value.minLifetimeMs);
  return Object.freeze({
    minQuote: bounded(value.minQuote, 1_000, 1_000_000_000_000, DEFAULT_MIN_QUOTE),
    minLifetimeMs: Math.max(0, Math.min(
      24 * 60 * 60_000,
      Number.isFinite(lifetime) && lifetime >= 0 ? lifetime : DEFAULT_MIN_LIFETIME_MS,
    )),
  });
}

function cleanRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => [Number(row?.[0]), Number(row?.[1])])
    .filter(([price, quantity]) => (
      Number.isFinite(price)
      && price > 0
      && Number.isFinite(quantity)
      && quantity > 0
    ));
}

function bestPrice(rows, side) {
  if (!rows.length) return null;
  return rows.reduce(
    (best, [price]) => side === "bid" ? Math.max(best, price) : Math.min(best, price),
    side === "bid" ? -Infinity : Infinity,
  );
}

function stablePriceKey(price) {
  return Number(price).toPrecision(15).replace(/\.?0+$/, "");
}

export function densityMarketKey(value = {}) {
  return `${value.exchange}:${value.market}:${value.symbol}`;
}

export function findSnapshotDensities(snapshot, minQuote = DEFAULT_MIN_QUOTE) {
  const threshold = finitePositive(minQuote, DEFAULT_MIN_QUOTE);
  const bids = cleanRows(snapshot?.bids);
  const asks = cleanRows(snapshot?.asks);
  const bestBid = bestPrice(bids, "bid");
  const bestAsk = bestPrice(asks, "ask");
  const middle = Number.isFinite(bestBid) && Number.isFinite(bestAsk)
    ? (bestBid + bestAsk) / 2
    : Number.isFinite(bestBid) ? bestBid : bestAsk;
  const result = [];
  for (const [side, rows] of [["bid", bids], ["ask", asks]]) {
    for (const [price, quantity] of rows) {
      const quote = price * quantity;
      if (!Number.isFinite(quote) || quote < threshold) continue;
      result.push({
        side,
        price,
        quantity,
        quote,
        middle,
        distancePercent: Number.isFinite(middle) && middle > 0
          ? ((price - middle) / middle) * 100
          : null,
        levelKey: `${side}:${stablePriceKey(price)}`,
      });
    }
  }
  return result;
}

export function interleaveDensityUniverse(groups = []) {
  const queues = (Array.isArray(groups) ? groups : [])
    .map((group) => {
      const exchange = String(group?.exchange ?? "");
      const market = String(group?.market ?? "");
      const unique = new Map();
      for (const row of group?.rows ?? []) {
        const symbol = String(row?.s ?? row?.symbol ?? "").toUpperCase();
        if (!/^[A-Z0-9]{1,20}USDT$/.test(symbol)) continue;
        const quoteVolume = Math.max(0, Number(row?.q ?? row?.quoteVolume) || 0);
        const current = unique.get(symbol);
        if (!current || quoteVolume > current.quoteVolume) {
          unique.set(symbol, { exchange, market, symbol, quoteVolume });
        }
      }
      return [...unique.values()].sort((left, right) => right.quoteVolume - left.quoteVolume);
    })
    .filter((queue) => queue.length);
  const result = [];
  const seen = new Set();
  for (let index = 0; queues.some((queue) => index < queue.length); index += 1) {
    for (const queue of queues) {
      const item = queue[index];
      if (!item) continue;
      const key = densityMarketKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

export class DensityLifetimeTracker {
  constructor({ minQuote = DEFAULT_MIN_QUOTE, absenceGraceMs = 1_500 } = {}) {
    this.minQuote = finitePositive(minQuote, DEFAULT_MIN_QUOTE);
    this.absenceGraceMs = Math.max(0, Number(absenceGraceMs) || 0);
    this.entries = new Map();
    this.marketEntries = new Map();
  }

  setMinQuote(value) {
    this.minQuote = finitePositive(value, this.minQuote);
    for (const [key, entry] of this.entries) {
      if (entry.quote < this.minQuote) this.#remove(key, entry.marketKey);
    }
  }

  updateMarket(source, snapshot, at = Date.now()) {
    const timestamp = Number.isFinite(Number(at)) ? Number(at) : Date.now();
    const marketKey = densityMarketKey(source);
    const previous = this.marketEntries.get(marketKey) ?? new Set();
    const seen = new Set();
    const detected = findSnapshotDensities(snapshot, this.minQuote);
    for (const density of detected) {
      const id = `${marketKey}:${density.levelKey}`;
      seen.add(id);
      const current = this.entries.get(id);
      const entry = current ?? {
        id,
        marketKey,
        exchange: source.exchange,
        market: source.market,
        symbol: source.symbol,
        side: density.side,
        price: density.price,
        firstSeen: timestamp,
        maxQuote: density.quote,
      };
      entry.price = density.price;
      entry.quantity = density.quantity;
      entry.quote = density.quote;
      entry.maxQuote = Math.max(entry.maxQuote, density.quote);
      entry.middle = density.middle;
      entry.distancePercent = density.distancePercent;
      entry.lastSeen = timestamp;
      entry.missingSince = null;
      this.entries.set(id, entry);
    }
    for (const id of previous) {
      if (seen.has(id)) continue;
      const entry = this.entries.get(id);
      if (!entry) continue;
      if (!Number.isFinite(entry.missingSince)) entry.missingSince = timestamp;
      if (timestamp - entry.missingSince >= this.absenceGraceMs) this.#remove(id, marketKey);
      else seen.add(id);
    }
    if (seen.size) this.marketEntries.set(marketKey, seen);
    else this.marketEntries.delete(marketKey);
    return detected;
  }

  clearMarket(source) {
    const marketKey = typeof source === "string" ? source : densityMarketKey(source);
    for (const id of this.marketEntries.get(marketKey) ?? []) this.entries.delete(id);
    this.marketEntries.delete(marketKey);
  }

  active({ minLifetimeMs = 0, at = Date.now() } = {}) {
    const timestamp = Number.isFinite(Number(at)) ? Number(at) : Date.now();
    const lifetime = Math.max(0, Number(minLifetimeMs) || 0);
    return [...this.entries.values()]
      .map((entry) => ({ ...entry, lifetimeMs: Math.max(0, timestamp - entry.firstSeen) }))
      .filter((entry) => entry.quote >= this.minQuote && entry.lifetimeMs >= lifetime)
      .sort((left, right) => right.quote - left.quote || right.lifetimeMs - left.lifetimeMs);
  }

  get size() {
    return this.entries.size;
  }

  #remove(id, marketKey) {
    this.entries.delete(id);
    const ids = this.marketEntries.get(marketKey);
    ids?.delete(id);
    if (ids && !ids.size) this.marketEntries.delete(marketKey);
  }
}
