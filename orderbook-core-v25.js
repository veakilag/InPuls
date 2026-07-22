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

let latestTradeEventTime = 0;

export function normalizeMarketTrade(event) {
  const price = Number(event?.p);
  const quantity = Number(event?.q);
  const time = Number(event?.T ?? event?.E);
  if (![price, quantity, time].every(Number.isFinite)) return null;
  latestTradeEventTime = Math.max(latestTradeEventTime, time);
  return {
    id: Number(event?.a ?? event?.t) || `${time}-${price}-${quantity}`,
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

export const BOOK_SCALE_MULTIPLIERS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

export function inferPriceTick(bids, asks, middlePrice) {
  const prices = [...(bids ?? []), ...(asks ?? [])]
    .slice(0, 160)
    .map((row) => Number(row?.[0]))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  let minimum = Infinity;
  for (let index = 1; index < prices.length; index += 1) {
    const difference = prices[index] - prices[index - 1];
    if (difference > Number.EPSILON && difference < minimum) minimum = difference;
  }
  if (Number.isFinite(minimum)) return minimum;
  const middle = Math.abs(Number(middlePrice));
  if (!Number.isFinite(middle) || middle === 0) return .01;
  return 10 ** Math.floor(Math.log10(middle) - 5);
}

export function priceStepForScale(baseTick, scaleIndex = 3) {
  const tick = Math.max(Number.EPSILON, Number(baseTick) || .01);
  const index = Math.max(0, Math.min(BOOK_SCALE_MULTIPLIERS.length - 1, Math.round(Number(scaleIndex) || 0)));
  return tick * BOOK_SCALE_MULTIPLIERS[index];
}

export function bookScaleLabel(scaleIndex = 3) {
  const index = Math.max(0, Math.min(BOOK_SCALE_MULTIPLIERS.length - 1, Math.round(Number(scaleIndex) || 0)));
  return `×${BOOK_SCALE_MULTIPLIERS[index]}`;
}

export function maximumBookScaleIndex() {
  return BOOK_SCALE_MULTIPLIERS.length - 1;
}

export function adaptiveBookScaleIndex(baseTick, currentIndex, movement, rowCount, coverage = .7) {
  const tick = Math.max(Number.EPSILON, Number(baseTick) || .01);
  const safeIndex = Math.max(0, Math.min(maximumBookScaleIndex(), Math.round(Number(currentIndex) || 0)));
  const halfRows = Math.max(2, Math.floor((Number(rowCount) || 3) / 2));
  const requiredStep = Math.max(0, Number(movement) || 0) / (halfRows * Math.max(.35, Math.min(.9, Number(coverage) || .7)));
  const requiredMultiplier = requiredStep / tick;
  const adaptiveIndex = BOOK_SCALE_MULTIPLIERS.findIndex((multiplier) => multiplier >= requiredMultiplier);
  return Math.max(safeIndex, adaptiveIndex < 0 ? maximumBookScaleIndex() : adaptiveIndex);
}

export function depthCoverageScaleIndex(baseTick, bids, asks, middlePrice, rowCount, coverage = .92) {
  const middle = Number(middlePrice);
  const tick = Math.max(Number.EPSILON, Number(baseTick) || .01);
  if (!Number.isFinite(middle)) return 0;
  const distances = [...(bids ?? []), ...(asks ?? [])]
    .map((row) => Math.abs(Number(row?.[0]) - middle))
    .filter((distance) => Number.isFinite(distance) && distance > 0)
    .sort((left, right) => left - right);
  if (!distances.length) return 0;
  const percentile = Math.max(0, Math.min(distances.length - 1, Math.floor((distances.length - 1) * Math.max(.5, Math.min(1, Number(coverage) || .92)))));
  const halfRows = Math.max(2, Math.floor((Number(rowCount) || 3) / 2));
  const requiredMultiplier = (distances[percentile] / halfRows) / tick;
  const index = BOOK_SCALE_MULTIPLIERS.findIndex((multiplier) => multiplier >= requiredMultiplier);
  return index < 0 ? maximumBookScaleIndex() : index;
}

export function recoverBookScaleIndex(userIndex, adaptiveIndex, calmTicks = 1) {
  const user = Math.max(0, Math.min(maximumBookScaleIndex(), Math.round(Number(userIndex) || 0)));
  const adaptive = Math.max(user, Math.min(maximumBookScaleIndex(), Math.round(Number(adaptiveIndex) || user)));
  return Math.max(user, adaptive - Math.max(1, Math.round(Number(calmTicks) || 1)));
}

function fixedPriceLadder(bids, asks, marketPrice, viewCenter, priceStep, rowCount) {
  const count = Math.max(3, Math.floor(Number(rowCount) || 3));
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const market = Number(marketPrice);
  const center = Number.isFinite(Number(viewCenter)) ? Number(viewCenter) : market;
  if (!Number.isFinite(market) || !Number.isFinite(center)) return [];
  const middleIndex = Math.floor(count / 2);
  const topPrice = Math.round((center + middleIndex * step) / step) * step;
  const rows = Array.from({ length: count }, (_, index) => ({
    price: topPrice - index * step,
    bidQuote: 0,
    askQuote: 0,
    quantity: 0,
    quote: 0,
    isMarket: false,
  }));
  const add = (levels, side) => {
    for (const row of levels ?? []) {
      const price = Number(row?.[0]);
      const quantity = Number(row?.[1]);
      if (![price, quantity].every(Number.isFinite) || quantity <= 0) continue;
      const index = Math.round((topPrice - price) / step);
      if (index < 0 || index >= count) continue;
      const quote = price * quantity;
      rows[index].quantity += quantity;
      rows[index].quote += quote;
      rows[index][side === "bid" ? "bidQuote" : "askQuote"] += quote;
    }
  };
  add(bids, "bid");
  add(asks, "ask");
  const marketIndex = Math.max(0, Math.min(count - 1, Math.round((topPrice - market) / step)));
  rows[marketIndex].isMarket = true;
  return rows;
}

function normalizedDepthLevels(levels, side) {
  return (levels ?? [])
    .map((row) => {
      const price = Number(row?.[0]);
      const quantity = Number(row?.[1]);
      return { price, quantity, quote: price * quantity };
    })
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.quantity) && row.quantity > 0)
    .sort((left, right) => side === "ask" ? left.price - right.price : right.price - left.price);
}

function depthGroupRow(group, side) {
  const first = group[0];
  const last = group.at(-1);
  const quantity = group.reduce((sum, level) => sum + level.quantity, 0);
  const quote = group.reduce((sum, level) => sum + level.quote, 0);
  const maxLevel = group.reduce((best, level) => level.quote > best.quote ? level : best, group[0]);
  return {
    price: last.price,
    bidQuote: side === "bid" ? quote : 0,
    askQuote: side === "ask" ? quote : 0,
    quantity,
    quote,
    isMarket: false,
    aggregated: group.length > 1,
    levelCount: group.length,
    rangeNear: first.price,
    rangeFar: last.price,
    maxLevelPrice: maxLevel.price,
    maxLevelQuote: maxLevel.quote,
  };
}

function packDepthSide(levels, rowCount, side, priceStep, baseTick) {
  const count = Math.max(1, Math.floor(Number(rowCount) || 1));
  const normalized = normalizedDepthLevels(levels, side);
  if (!normalized.length) return [];
  if (normalized.length <= count) return normalized.map((level) => depthGroupRow([level], side));

  const scaleRatio = Math.max(1, Number(priceStep) / Math.max(Number.EPSILON, Number(baseTick) || Number(priceStep) || 1));
  const exactFraction = Math.max(.38, Math.min(.72, .72 - Math.log10(scaleRatio) * .12));
  const exactCount = Math.max(4, Math.min(count - 1, Math.round(count * exactFraction)));
  const bucketCount = Math.max(1, count - exactCount);
  const rows = normalized.slice(0, exactCount).map((level) => depthGroupRow([level], side));
  const far = normalized.slice(exactCount);
  let cursor = 0;
  const gamma = 1.8;

  for (let bucket = 0; bucket < bucketCount && cursor < far.length; bucket += 1) {
    const remainingBuckets = bucketCount - bucket;
    const remainingItems = far.length - cursor;
    const targetEnd = Math.round(far.length * (((bucket + 1) / bucketCount) ** gamma));
    const maximumTake = remainingItems - Math.max(0, remainingBuckets - 1);
    const take = Math.max(1, Math.min(maximumTake, targetEnd - cursor || 1));
    rows.push(depthGroupRow(far.slice(cursor, cursor + take), side));
    cursor += take;
  }

  if (cursor < far.length) {
    const tail = far.slice(cursor);
    const previous = rows.pop();
    const previousLevels = previous
      ? normalized.filter((level) => {
          const low = Math.min(previous.rangeNear, previous.rangeFar);
          const high = Math.max(previous.rangeNear, previous.rangeFar);
          return level.price >= low && level.price <= high;
        })
      : [];
    rows.push(depthGroupRow([...previousLevels, ...tail], side));
  }

  return rows.slice(0, count);
}

export function buildDepthLadder(bids, asks, marketPrice, viewCenter, priceStep, rowCount) {
  const count = Math.max(3, Math.floor(Number(rowCount) || 3));
  const market = Number(marketPrice);
  const center = Number.isFinite(Number(viewCenter)) ? Number(viewCenter) : market;
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  if (!Number.isFinite(market) || !Number.isFinite(center)) return [];

  // FULL BOOK всегда упаковывает все полученные уровни в доступную высоту.
  // Ручной сдвиг ценового центра не должен превращать стакан в пустую сетку.

  const askCount = Math.floor(count / 2);
  const bidCount = count - askCount - 1;
  const baseTick = inferPriceTick(bids, asks, market);
  const packedAsks = packDepthSide(asks, askCount, "ask", step, baseTick).reverse();
  const packedBids = packDepthSide(bids, bidCount, "bid", step, baseTick);
  const marketRow = {
    price: market,
    bidQuote: 0,
    askQuote: 0,
    quantity: 0,
    quote: 0,
    isMarket: true,
    aggregated: false,
    levelCount: 0,
  };
  return [...packedAsks, marketRow, ...packedBids];
}

export function aggregateTradeClusters(trades, minimumQuote = 0, priceStep = .01, limit = 40) {
  const threshold = Math.max(0, Number(minimumQuote) || 0);
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const clusters = new Map();
  for (const trade of trades ?? []) {
    if (!trade || !Number.isFinite(trade.quote) || trade.quote < threshold) continue;
    const price = Math.round(trade.price / step) * step;
    const key = String(price);
    const cluster = clusters.get(key) ?? { price, buyQuote: 0, sellQuote: 0, quote: 0, count: 0, time: 0 };
    cluster[trade.side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    cluster.quote += trade.quote;
    cluster.count += 1;
    cluster.time = Math.max(cluster.time, trade.time);
    clusters.set(key, cluster);
  }
  return [...clusters.values()].sort((left, right) => right.time - left.time).slice(0, Math.max(1, Math.floor(limit)));
}

export function aggregateTradePath(trades, minimumQuote = 0, priceStep = .01, limit = 36, bucketMs = 750) {
  const threshold = Math.max(0, Number(minimumQuote) || 0);
  const safeLimit = Math.max(3, Math.floor(Number(limit) || 36));
  const ordered = [...(trades ?? [])]
    .filter((trade) => trade
      && [trade.price, trade.quote, trade.quantity, trade.time].every(Number.isFinite)
      && trade.quote > 0
      && trade.quote >= threshold)
    .sort((left, right) => left.time - right.time || Number(left.id) - Number(right.id))
    .slice(-safeLimit);

  // Каждое событие потока отображается отдельно без временной агрегации.
  return ordered.map((trade) => ({
    key: `raw:${String(trade.id)}:${trade.time}:${trade.price}`,
    time: trade.time,
    lastTime: trade.time,
    price: trade.price,
    quote: trade.quote,
    quantity: trade.quantity,
    buyQuote: trade.side === "buy" ? trade.quote : 0,
    sellQuote: trade.side === "sell" ? trade.quote : 0,
    count: 1,
    executions: [trade],
  }));
}

export function tradeTimeWindow(now, durationMs, offsetMs = 0) {
  const requestedNow = Number(now);
  const liveAnchor = latestTradeEventTime > 0 ? latestTradeEventTime : requestedNow;
  const end = liveAnchor - Math.max(0, Number(offsetMs) || 0);
  const duration = Math.max(5_000, Number(durationMs) || 60_000);
  return { start: end - duration, end, duration };
}

export function aggregateFootprintClusters(trades, minimumQuote = 0, priceStep = .01, bucketMs = 5_000) {
  const threshold = Math.max(0, Number(minimumQuote) || 0);
  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const duration = Math.max(250, Math.floor(Number(bucketMs) || 5_000));
  const cells = new Map();
  for (const trade of trades ?? []) {
    if (![trade?.price, trade?.quote, trade?.time].every(Number.isFinite) || trade.quote <= 0) continue;
    const time = Math.floor(trade.time / duration) * duration;
    const price = Math.round(trade.price / step) * step;
    const key = `${time}:${price}`;
    const cell = cells.get(key) ?? { key, time, lastTime: trade.time, price, buyQuote: 0, sellQuote: 0, quote: 0, count: 0, executions: [] };
    cell[trade.side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    cell.quote += trade.quote;
    cell.count += 1;
    cell.lastTime = Math.max(cell.lastTime, trade.time);
    cell.executions.push(trade);
    cells.set(key, cell);
  }
  return [...cells.values()]
    .filter((cell) => cell.quote >= threshold)
    .sort((left, right) => left.time - right.time || right.price - left.price);
}
