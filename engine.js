export const DEFAULT_SETTINGS = Object.freeze({
  minTurnover24h: 10_000_000,
  impulse15s: 0.35,
  knife15s: 0.8,
  breakout15s: 0.25,
  volumeBoost: 2.5,
  cascadeMove15s: 0.45,
  cascadeLiquidationUsd: 50_000,
  compressionRange60s: 0.22,
  compressionVolumeBoost: 1.6,
  alertScore: 68,
  trackedTrades: 45,
  maxRows: 100,
});

const HISTORY_MS = 6 * 60_000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function formatCompactUsd(value) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `$${Math.round(value)}`;
}

export class SymbolState {
  constructor(symbol, now = Date.now()) {
    this.symbol = symbol;
    this.createdAt = now;
    this.lastUpdate = now;
    this.price = null;
    this.open24h = null;
    this.high24h = null;
    this.low24h = null;
    this.quoteVolume24h = 0;
    this.lastQuoteVolume24h = null;
    this.lastVolumeTimestamp = null;
    this.volumeFast = 0;
    this.volumeSlow = 0;
    this.history = [];
    this.minuteCandles = [];
    this.fundingRate = null;
    this.nextFundingTime = null;
    this.tradeBuckets = new Map();
    this.liquidations = [];
    this.lastLiquidationKey = null;
    this.lastAlertAt = 0;
  }

  updateTicker(ticker, now = Number(ticker.E) || Date.now()) {
    const price = Number(ticker.c);
    const quoteVolume = Number(ticker.q);
    if (!Number.isFinite(price) || price <= 0) return;

    this.price = price;
    this.open24h = Number(ticker.o) || this.open24h;
    this.high24h = Number(ticker.h) || this.high24h;
    this.low24h = Number(ticker.l) || this.low24h;
    this.lastUpdate = now;
    const minute = Math.floor(now / 60_000) * 60_000;
    const minuteCandle = this.minuteCandles.at(-1);
    if (minuteCandle?.time === minute) {
      minuteCandle.high = Math.max(minuteCandle.high, price);
      minuteCandle.low = Math.min(minuteCandle.low, price);
      minuteCandle.close = price;
    } else {
      this.minuteCandles.push({ time: minute, open: price, high: price, low: price, close: price });
      this.minuteCandles = this.minuteCandles.slice(-100);
    }

    const previousSnapshot = this.history.at(-1);
    if (!previousSnapshot || now - previousSnapshot.t >= 700) {
      this.history.push({ t: now, p: price });
    } else {
      previousSnapshot.p = price;
      previousSnapshot.t = now;
    }
    this.#trim(now);

    if (Number.isFinite(quoteVolume) && quoteVolume >= 0) {
      if (this.lastQuoteVolume24h !== null && this.lastVolumeTimestamp !== null) {
        const elapsedSeconds = Math.max(0.2, (now - this.lastVolumeTimestamp) / 1000);
        const delta = quoteVolume - this.lastQuoteVolume24h;
        const rate = delta > 0 ? delta / elapsedSeconds : 0;
        const fastAlpha = 1 - Math.exp(-elapsedSeconds / 5);
        const slowAlpha = 1 - Math.exp(-elapsedSeconds / 45);
        this.volumeFast += fastAlpha * (rate - this.volumeFast);
        this.volumeSlow += slowAlpha * (rate - this.volumeSlow);
      }
      this.quoteVolume24h = quoteVolume;
      this.lastQuoteVolume24h = quoteVolume;
      this.lastVolumeTimestamp = now;
    }
  }

  updateTrade(trade) {
    const time = Number(trade.T) || Number(trade.E) || Date.now();
    const price = Number(trade.p);
    const quantity = Number(trade.q);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) return;
    const second = Math.floor(time / 1000) * 1000;
    const bucket = this.tradeBuckets.get(second) || { count: 0, buy: 0, sell: 0 };
    const firstId = Number(trade.f);
    const lastId = Number(trade.l);
    const fills = Number.isFinite(firstId) && Number.isFinite(lastId)
      ? clamp(lastId - firstId + 1, 1, 10_000)
      : 1;
    const quote = price * quantity;
    bucket.count += fills;
    if (trade.m) bucket.sell += quote;
    else bucket.buy += quote;
    this.tradeBuckets.set(second, bucket);
    this.#trim(time);
  }

  updateFunding(event) {
    const rate = Number(event.r);
    const nextTime = Number(event.T);
    if (Number.isFinite(rate)) this.fundingRate = rate;
    if (Number.isFinite(nextTime)) this.nextFundingTime = nextTime;
  }

  hydrateMinuteCandles(candles) {
    if (!Array.isArray(candles)) return;
    const byTime = new Map(this.minuteCandles.map((candle) => [candle.time, candle]));
    for (const candle of candles) {
      if (![candle?.time, candle?.open, candle?.high, candle?.low, candle?.close].every(Number.isFinite)) continue;
      byTime.set(candle.time, {
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
    }
    this.minuteCandles = [...byTime.values()].sort((left, right) => left.time - right.time).slice(-100);
  }

  updateLiquidation(event) {
    const order = event.o || event;
    const time = Number(order.T) || Number(event.E) || Date.now();
    const price = Number(order.ap) || Number(order.p);
    const quantity = Number(order.z) || Number(order.q);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) return;
    const key = `${time}:${order.S}:${price}:${quantity}`;
    if (key === this.lastLiquidationKey) return;
    this.lastLiquidationKey = key;
    this.liquidations.push({
      t: time,
      side: order.S,
      notional: price * quantity,
    });
    this.#trim(time);
  }

  priceChange(windowMs, now = Date.now()) {
    if (!this.price || this.history.length < 2) return null;
    const target = now - windowMs;
    let candidate = null;
    for (let i = this.history.length - 1; i >= 0; i -= 1) {
      if (this.history[i].t <= target) {
        candidate = this.history[i];
        break;
      }
    }
    if (!candidate) return null;
    return percentChange(this.price, candidate.p);
  }

  range(windowMs, now = Date.now()) {
    const start = now - windowMs;
    const points = this.history.filter((item) => item.t >= start);
    if (points.length < Math.max(5, Math.floor(windowMs / 3000))) return null;
    const prices = points.map((item) => item.p);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return {
      min,
      max,
      percent: min > 0 ? ((max - min) / min) * 100 : null,
    };
  }

  tradeFlow(now = Date.now()) {
    let count = 0;
    let buy = 0;
    let sell = 0;
    const start = now - 10_000;
    for (const [time, bucket] of this.tradeBuckets) {
      if (time >= start) {
        count += bucket.count;
        buy += bucket.buy;
        sell += bucket.sell;
      }
    }
    const total = buy + sell;
    return {
      tps: count / 10,
      buy,
      sell,
      buyShare: total > 0 ? (buy / total) * 100 : null,
    };
  }

  liquidationFlow(now = Date.now()) {
    const start = now - 60_000;
    let longs = 0;
    let shorts = 0;
    for (const item of this.liquidations) {
      if (item.t < start) continue;
      if (item.side === "SELL") longs += item.notional;
      else shorts += item.notional;
    }
    return { longs, shorts, total: longs + shorts };
  }

  metrics(settings = DEFAULT_SETTINGS, now = Date.now()) {
    const warmupSeconds = Math.max(0, (now - this.createdAt) / 1000);
    const change15s = this.priceChange(15_000, now);
    const change1m = this.priceChange(60_000, now);
    const change5m = this.priceChange(300_000, now);
    const range60s = this.range(60_000, now);
    const range5m = this.range(300_000, now);
    const trades = this.tradeFlow(now);
    const liquidation = this.liquidationFlow(now);
    const volumeBoost = warmupSeconds >= 45 && this.volumeSlow > 1
      ? clamp(this.volumeFast / this.volumeSlow, 0, 99)
      : null;
    const turnoverPerMinute = this.volumeFast * 60;
    const natr1m = natrFromCandles(this.minuteCandles);
    const natr5m = natrFromCandles(aggregateMinuteCandles(this.minuteCandles, 5));
    const minuteReturns = this.minuteCandles.slice(1).map((candle, index) => {
      const previous = this.minuteCandles[index].close;
      return previous ? (candle.close - previous) / previous : 0;
    });

    const base = {
      symbol: this.symbol,
      price: this.price,
      change15s,
      change1m,
      change5m,
      change24h: percentChange(this.price, this.open24h),
      quoteVolume24h: this.quoteVolume24h,
      turnoverPerMinute,
      volumeBoost,
      range60s,
      range5m,
      trades,
      liquidation,
      warmupSeconds,
      sparkline: this.history.slice(-90).map((item) => item.p),
      fundingRate: this.fundingRate,
      nextFundingTime: this.nextFundingTime,
      natr1m,
      natr5m,
      minuteReturns,
    };

    const signals = classifySignals(base, settings);
    const score = scoreMetrics(base, signals, settings);
    return { ...base, signals, primarySignal: signals[0] || null, score };
  }

  #trim(now) {
    const historyStart = now - HISTORY_MS;
    while (this.history.length && this.history[0].t < historyStart) this.history.shift();
    const tradeStart = Math.floor((now - 15_000) / 1000) * 1000;
    for (const time of this.tradeBuckets.keys()) {
      if (time < tradeStart) this.tradeBuckets.delete(time);
    }
    const liquidationStart = now - 65_000;
    while (this.liquidations.length && this.liquidations[0].t < liquidationStart) {
      this.liquidations.shift();
    }
  }
}

function aggregateMinuteCandles(candles, size) {
  const result = [];
  for (const candle of candles) {
    const time = Math.floor(candle.time / (size * 60_000)) * size * 60_000;
    const last = result.at(-1);
    if (last?.time === time) {
      last.high = Math.max(last.high, candle.high);
      last.low = Math.min(last.low, candle.low);
      last.close = candle.close;
    } else result.push({ ...candle, time });
  }
  return result;
}

function natrFromCandles(candles, period = 14) {
  if (candles.length <= period) return null;
  const ranges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    ranges.push(Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close)));
  }
  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < ranges.length; index += 1) atr = ((atr * (period - 1)) + ranges[index]) / period;
  return candles.at(-1).close ? (atr / candles.at(-1).close) * 100 : null;
}

export function classifySignals(metrics, settings = DEFAULT_SETTINGS) {
  const result = [];
  const move15 = metrics.change15s;
  const absMove15 = Math.abs(move15 || 0);
  const boost = metrics.volumeBoost || 0;
  const liquidations = metrics.liquidation;
  const enough15s = move15 !== null;

  if (
    enough15s
    && absMove15 >= settings.cascadeMove15s
    && liquidations.total >= settings.cascadeLiquidationUsd
  ) {
    const falling = move15 < 0;
    const aligned = falling ? liquidations.longs >= liquidations.shorts : liquidations.shorts >= liquidations.longs;
    if (aligned) {
      result.push({
        type: "cascade",
        label: "КАСКАД",
        direction: falling ? "down" : "up",
        reason: `${falling ? "Лонги" : "Шорты"} ликвидированы на ${formatCompactUsd(falling ? liquidations.longs : liquidations.shorts)} за 60с`,
        priority: 100,
      });
    }
  }

  if (enough15s && move15 <= -settings.knife15s && boost >= Math.max(1.5, settings.volumeBoost * 0.7)) {
    result.push({
      type: "knife",
      label: "НОЖ",
      direction: "down",
      reason: `${move15.toFixed(2)}% за 15с · объём ×${boost.toFixed(1)}`,
      priority: 90,
    });
  }

  if (enough15s && metrics.range5m && absMove15 >= settings.breakout15s && boost >= 1.4) {
    const tolerance = 0.0007;
    const up = move15 > 0 && metrics.price >= metrics.range5m.max * (1 - tolerance);
    const down = move15 < 0 && metrics.price <= metrics.range5m.min * (1 + tolerance);
    if (up || down) {
      result.push({
        type: "breakout",
        label: "ПРОБОЙ",
        direction: up ? "up" : "down",
        reason: `${up ? "Хай" : "Лой"} 5м · ${move15 > 0 ? "+" : ""}${move15.toFixed(2)}% за 15с`,
        priority: 80,
      });
    }
  }

  if (enough15s && absMove15 >= settings.impulse15s && boost >= settings.volumeBoost) {
    result.push({
      type: "impulse",
      label: "ИМПУЛЬС",
      direction: move15 >= 0 ? "up" : "down",
      reason: `${move15 > 0 ? "+" : ""}${move15.toFixed(2)}% за 15с · объём ×${boost.toFixed(1)}`,
      priority: 70,
    });
  }

  if (
    metrics.range60s
    && metrics.range60s.percent <= settings.compressionRange60s
    && boost >= settings.compressionVolumeBoost
    && absMove15 < settings.impulse15s
  ) {
    result.push({
      type: "compression",
      label: "СЖАТИЕ",
      direction: (move15 || 0) >= 0 ? "up" : "down",
      reason: `Диапазон 60с ${metrics.range60s.percent.toFixed(2)}% · объём ×${boost.toFixed(1)}`,
      priority: 50,
    });
  }

  return result.sort((a, b) => b.priority - a.priority);
}

export function scoreMetrics(metrics, signals, settings = DEFAULT_SETTINGS) {
  const move = Math.abs(metrics.change15s || 0);
  const boost = metrics.volumeBoost || 0;
  const turnover = metrics.turnoverPerMinute || 0;
  const tradeFlow = metrics.trades || {};
  const imbalance = tradeFlow.buyShare === null || tradeFlow.buyShare === undefined
    ? 0
    : Math.abs(tradeFlow.buyShare - 50) * 2;

  let score = 0;
  score += clamp(move / Math.max(settings.impulse15s, 0.05), 0, 2) * 18;
  score += clamp(boost / Math.max(settings.volumeBoost, 1), 0, 2) * 13;
  score += clamp(Math.log10(Math.max(turnover, 1)) - 3, 0, 3) * 5;
  score += clamp(imbalance / 100, 0, 1) * 8;
  score += clamp((metrics.liquidation?.total || 0) / Math.max(settings.cascadeLiquidationUsd, 1), 0, 2) * 6;
  if (signals.length) score += 10;
  if (signals.some((signal) => signal.type === "cascade")) score += 8;
  return Math.round(clamp(score, 0, 100));
}

export function filterUsdtPerpetualTicker(ticker) {
  if (!ticker || typeof ticker.s !== "string") return false;
  if (!ticker.s.endsWith("USDT")) return false;
  if (ticker.st !== undefined && Number(ticker.st) !== 1) return false;
  return !ticker.s.includes("_");
}
