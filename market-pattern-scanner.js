export const MARKET_PATTERN_SCANNER_VERSION = "marketwide-patterns-v1";

const DEFAULTS = Object.freeze({
  minimumSamples: 12,
  strongSizeMultiple: 4,
  minimumQuoteUsd: 50_000,
  sizeSimilarityPercent: 18,
  moveWindowMs: 2_500,
  supporterWindowMs: 8_000,
  supporterMinimumTouches: 3,
  signalLifetimeMs: 4_000,
  cascadeMaximumWidthPercent: 5,
  cascadeMinimumExtrema: 2,
});

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentDistance(left, right) {
  if (!(left > 0) || !(right > 0)) return null;
  return Math.abs(left - right) / Math.min(left, right) * 100;
}

function sizeSimilarityPercent(left, right) {
  if (!(left > 0) || !(right > 0)) return Infinity;
  return Math.abs(left - right) / Math.max(left, right) * 100;
}

function sideState() {
  return { quoteSamples: [], last: null, strongTouches: [], active: new Map() };
}

function signal(type, direction, reason, evidence) {
  const labels = { rearranger: "ПЕРЕСТАВЛЯШ", size_supporter: "ПОДСТАВЛЯШ", cascade: "КАСКАД" };
  return {
    type,
    direction,
    priority: type === "cascade" ? 82 : type === "rearranger" ? 78 : 76,
    label: labels[type],
    reason,
    formulaVersion: MARKET_PATTERN_SCANNER_VERSION,
    evidence,
  };
}

export class MarketwideSizeScanner {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.symbols = new Map();
  }

  #symbol(symbol) {
    if (!this.symbols.has(symbol)) {
      this.symbols.set(symbol, { bid: sideState(), ask: sideState() });
    }
    return this.symbols.get(symbol);
  }

  #observeSide(symbol, side, price, quantity, at) {
    if (!(price > 0) || !(quantity > 0)) return;
    const state = this.#symbol(symbol)[side];
    const quote = price * quantity;
    const baseline = median(state.quoteSamples);
    state.quoteSamples.push(quote);
    if (state.quoteSamples.length > 60) state.quoteSamples.shift();
    const strong = state.quoteSamples.length >= this.options.minimumSamples
      && quote >= this.options.minimumQuoteUsd
      && baseline > 0
      && quote >= baseline * this.options.strongSizeMultiple;

    if (strong) {
      const previous = state.last;
      if (
        previous
        && at - previous.at <= this.options.moveWindowMs
        && previous.price !== price
        && sizeSimilarityPercent(previous.quote, quote) <= this.options.sizeSimilarityPercent
      ) {
        state.active.set("rearranger", {
          until: at + this.options.signalLifetimeMs,
          value: signal(
            "rearranger",
            side === "bid" ? "up" : "down",
            `${side === "bid" ? "Bid" : "Ask"}-сайз перенесён вслед за лучшей ценой`,
            {
              scope: "marketwide-best-quote",
              side,
              quoteUsd: quote,
              baselineQuoteUsd: baseline,
              sizeMultiple: quote / baseline,
              fromPrice: previous.price,
              toPrice: price,
              movePercent: percentDistance(previous.price, price),
              observedAt: at,
            },
          ),
        });
      }

      state.strongTouches.push({ at, price, quote });
      state.strongTouches = state.strongTouches.filter(
        (touch) => at - touch.at <= this.options.supporterWindowMs,
      );
      const comparableTouches = state.strongTouches.filter(
        (touch) => sizeSimilarityPercent(touch.quote, quote) <= this.options.sizeSimilarityPercent,
      );
      if (comparableTouches.length >= this.options.supporterMinimumTouches) {
        state.active.set("size_supporter", {
          until: at + this.options.signalLifetimeMs,
          value: signal(
            "size_supporter",
            side === "bid" ? "up" : "down",
            `${side === "bid" ? "Bid" : "Ask"}-сайз повторно подпирает спред`,
            {
              scope: "marketwide-best-quote",
              side,
              quoteUsd: quote,
              baselineQuoteUsd: baseline,
              sizeMultiple: quote / baseline,
              touchCount: comparableTouches.length,
              windowMs: this.options.supporterWindowMs,
              observedAt: at,
            },
          ),
        });
      }
    }
    state.last = { at, price, quote };
  }

  ingestBookTicker(ticker, now = Date.now()) {
    const symbol = String(ticker?.s || "").toUpperCase();
    const bidPrice = finite(ticker?.b);
    const bidQuantity = finite(ticker?.B);
    const askPrice = finite(ticker?.a);
    const askQuantity = finite(ticker?.A);
    const at = finite(ticker?.E) ?? now;
    if (!symbol || bidPrice === null || bidQuantity === null || askPrice === null || askQuantity === null) {
      return [];
    }
    this.#observeSide(symbol, "bid", bidPrice, bidQuantity, at);
    this.#observeSide(symbol, "ask", askPrice, askQuantity, at);
    return this.signalsFor(symbol, at);
  }

  signalsFor(symbol, now = Date.now()) {
    const states = this.symbols.get(String(symbol || "").toUpperCase());
    if (!states) return [];
    const active = [];
    for (const state of [states.bid, states.ask]) {
      for (const [type, entry] of state.active) {
        if (entry.until >= now) active.push(entry.value);
        else state.active.delete(type);
      }
    }
    return active;
  }
}

function localExtrema(candles, side) {
  const key = side === "high" ? "high" : "low";
  const compare = side === "high"
    ? (value, left, right) => value >= left && value >= right
    : (value, left, right) => value <= left && value <= right;
  const result = [];
  for (let index = 1; index < candles.length - 1; index += 1) {
    const value = finite(candles[index]?.[key]);
    const left = finite(candles[index - 1]?.[key]);
    const right = finite(candles[index + 1]?.[key]);
    if (value === null || left === null || right === null || !compare(value, left, right)) continue;
    result.push({ at: finite(candles[index]?.time), price: value });
  }
  return result;
}

function cascadeCandidate(candles, side, price, options) {
  const extrema = localExtrema(candles, side).slice(-8);
  if (extrema.length < options.cascadeMinimumExtrema) return null;
  let best = null;
  for (let start = 0; start <= extrema.length - options.cascadeMinimumExtrema; start += 1) {
    const group = extrema.slice(start);
    const prices = group.map((item) => item.price);
    const lower = Math.min(...prices);
    const upper = Math.max(...prices);
    const widthPercent = percentDistance(lower, upper);
    if (widthPercent === null || widthPercent > options.cascadeMaximumWidthPercent) continue;
    const broken = side === "high" ? price > upper : price < lower;
    if (!broken) continue;
    if (!best || group.length > best.extrema.length) {
      best = { side, extrema: group, lower, upper, widthPercent };
    }
  }
  return best;
}

export function detectMarketwideCascade(metrics, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const candles = Array.isArray(metrics?.minuteCandles) ? metrics.minuteCandles : [];
  const price = finite(metrics?.price);
  if (price === null || candles.length < 5) return null;
  const closed = candles.slice(0, -1);
  const high = cascadeCandidate(closed, "high", price, settings);
  const low = cascadeCandidate(closed, "low", price, settings);
  const candidate = high && low
    ? (high.extrema.at(-1)?.at ?? 0) >= (low.extrema.at(-1)?.at ?? 0) ? high : low
    : high || low;
  if (!candidate) return null;
  const level = candidate.side === "high" ? candidate.upper : candidate.lower;
  return signal(
    "cascade",
    candidate.side === "high" ? "up" : "down",
    `${candidate.extrema.length} экстремума в зоне ${candidate.widthPercent.toFixed(2)}% сняты импульсом`,
    {
      scope: "marketwide-minute-candles",
      timeframe: "1m",
      side: candidate.side,
      extrema: candidate.extrema,
      extremaCount: candidate.extrema.length,
      zoneLower: candidate.lower,
      zoneUpper: candidate.upper,
      zoneWidthPercent: candidate.widthPercent,
      breakoutPrice: price,
      breakoutDistancePercent: percentDistance(level, price),
      lastTouchAt: candidate.extrema.at(-1)?.at ?? null,
    },
  );
}
