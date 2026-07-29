import {
  PATTERN_CATALOG_VERSION,
  densityGeometry,
  minuteStructureEvidence,
  patternClock,
  patternDefinition,
} from "./pattern-catalog.js";

export const MARKET_MEMORY_SCHEMA_VERSION = 1;
export const SIGNAL_FORMULA_VERSION = "radar-signals-v3-structured-patterns";
export const SIGNAL_CONTEXT_VERSION = 1;
export const SIGNAL_OBSERVATION_VERSION = 2;
const MAX_STORED_PATH_POINTS = 96;
const MAX_CONTEXT_CANDLES = 300;

export const DATA_QUALITY_STATES = Object.freeze({
  LIVE: "live",
  STALE: "stale",
  PARTIAL: "partial",
  ERROR: "error",
});

export const OBSERVATION_STATES = Object.freeze({
  PENDING: "pending",
  OBSERVED: "observed",
  UNAVAILABLE: "unavailable",
});

export const SIGNAL_OBSERVATION_HORIZONS = Object.freeze([
  Object.freeze({ key: "15s", durationMs: 15_000 }),
  Object.freeze({ key: "1m", durationMs: 60_000 }),
  Object.freeze({ key: "3m", durationMs: 180_000 }),
  Object.freeze({ key: "5m", durationMs: 300_000 }),
]);

const SYMBOL_PATTERN = /^[A-Z0-9]{1,20}USDT$/;
const DEFAULT_RELEASE_AFTER_MS = 2_000;
const DEFAULT_EPISODE_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_EVENTS = 1_000;
const DEFAULT_FINAL_SAMPLE_MAX_DELAY_MS = 5_000;
const DEFAULT_MAX_LIVE_SAMPLE_GAP_MS = 5_000;
const LIVE_MARKET_AGE_MS = 5_000;
const LIVE_TRADE_AGE_MS = 3_000;
const LIVE_DEPTH_AGE_MS = 3_500;
const STALE_DEPTH_AGE_MS = 9_000;
const OBSERVATION_DEFINITION = [
  "return=(final-baseline)/baseline*100",
  "directionalReturn=return*signalDirection",
  "MFE=max(directional excursion,0)",
  "MAE=min(directional excursion,0)",
  "effectDuration=time-to-MFE",
].join("; ");

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveTimestamp(value, fallback = Date.now()) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : fallback;
}

function safeText(value, maximumLength = 240) {
  return String(value ?? "").slice(0, maximumLength);
}

function safeSymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function numericSettingsSnapshot(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {};
  return Object.fromEntries(
    Object.entries(settings)
      .filter(([, value]) => Number.isFinite(Number(value)))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, Number(value)]),
  );
}

function rangeSnapshot(range) {
  if (!range || typeof range !== "object") return null;
  const minimum = finiteOrNull(range.min);
  const maximum = finiteOrNull(range.max);
  const percent = finiteOrNull(range.percent);
  if (minimum === null && maximum === null && percent === null) return null;
  return { minimum, maximum, percent };
}

function marketQuality(metrics, now) {
  const price = finiteOrNull(metrics?.price);
  if (price === null || price <= 0) return DATA_QUALITY_STATES.ERROR;
  const updatedAt = finiteOrNull(metrics?.updatedAt);
  if (updatedAt === null) return DATA_QUALITY_STATES.PARTIAL;
  return now - updatedAt <= LIVE_MARKET_AGE_MS
    ? DATA_QUALITY_STATES.LIVE
    : DATA_QUALITY_STATES.STALE;
}

function tradeQuality(metrics, now) {
  const lastTradeAt = finiteOrNull(metrics?.lastTradeAt);
  if (lastTradeAt === null) return DATA_QUALITY_STATES.PARTIAL;
  return now - lastTradeAt <= LIVE_TRADE_AGE_MS
    ? DATA_QUALITY_STATES.LIVE
    : DATA_QUALITY_STATES.STALE;
}

function combineQuality(states) {
  if (states.includes(DATA_QUALITY_STATES.ERROR)) return DATA_QUALITY_STATES.ERROR;
  if (states.includes(DATA_QUALITY_STATES.STALE)) return DATA_QUALITY_STATES.STALE;
  if (states.includes(DATA_QUALITY_STATES.PARTIAL)) return DATA_QUALITY_STATES.PARTIAL;
  return DATA_QUALITY_STATES.LIVE;
}

function percentFromBaseline(price, baselinePrice) {
  if (
    !Number.isFinite(price)
    || !Number.isFinite(baselinePrice)
    || baselinePrice <= 0
  ) return null;
  return ((price - baselinePrice) / baselinePrice) * 100;
}

function directionSign(direction) {
  if (direction === "down") return -1;
  return 1;
}

function pathQuality(points, finalSample, dueAt, maxLiveSampleGapMs) {
  let maxGapMs = 0;
  for (let index = 1; index < points.length; index += 1) {
    maxGapMs = Math.max(maxGapMs, points[index].at - points[index - 1].at);
  }
  const finalSampleDelayMs = Math.max(0, finalSample.at - dueAt);
  const continuous = maxGapMs <= maxLiveSampleGapMs;
  return {
    state: continuous ? DATA_QUALITY_STATES.LIVE : DATA_QUALITY_STATES.PARTIAL,
    reason: continuous
      ? "observed-live-price-path"
      : "observed-with-price-path-gaps",
    sampleCount: points.length,
    firstSampleAt: points[0]?.at ?? null,
    lastSampleAt: points.at(-1)?.at ?? null,
    maxGapMs,
    finalSampleDelayMs,
    limitations: continuous ? [] : ["price-path-gap"],
  };
}

function unavailablePathQuality(points, candidate, dueAt, reason) {
  let maxGapMs = 0;
  for (let index = 1; index < points.length; index += 1) {
    maxGapMs = Math.max(maxGapMs, points[index].at - points[index - 1].at);
  }
  return {
    state: OBSERVATION_STATES.UNAVAILABLE,
    reason,
    sampleCount: points.length,
    firstSampleAt: points[0]?.at ?? null,
    lastSampleAt: points.at(-1)?.at ?? null,
    maxGapMs,
    finalSampleDelayMs: candidate ? Math.max(0, candidate.at - dueAt) : null,
    limitations: ["horizon-price-unavailable"],
  };
}

function firstPointAtOrAfter(points, timestamp) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].at < timestamp) low = middle + 1;
    else high = middle;
  }
  return points[low] ?? null;
}

function compactPricePath(points, importantTimes = [], maximum = MAX_STORED_PATH_POINTS) {
  const rows = (Array.isArray(points) ? points : [])
    .filter((point) => (
      finiteOrNull(point?.at) !== null
      && finiteOrNull(point?.price) !== null
      && Number(point.price) > 0
    ));
  if (rows.length <= maximum) {
    return rows.map(({ at, price }) => ({ at, price }));
  }
  const keep = new Set([0, rows.length - 1]);
  for (const timestamp of importantTimes) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    rows.forEach((point, index) => {
      const distance = Math.abs(point.at - timestamp);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    keep.add(bestIndex);
  }
  const slots = Math.max(1, maximum - keep.size);
  const step = Math.max(1, Math.ceil(rows.length / slots));
  for (let start = 0; start < rows.length && keep.size < maximum; start += step) {
    const slice = rows.slice(start, Math.min(rows.length, start + step));
    if (!slice.length) continue;
    let minimumIndex = start;
    let maximumIndex = start;
    slice.forEach((point, offset) => {
      if (point.price < rows[minimumIndex].price) minimumIndex = start + offset;
      if (point.price > rows[maximumIndex].price) maximumIndex = start + offset;
    });
    keep.add(minimumIndex);
    if (keep.size < maximum) keep.add(maximumIndex);
  }
  return [...keep]
    .sort((left, right) => left - right)
    .slice(0, maximum)
    .map((index) => ({ at: rows[index].at, price: rows[index].price }));
}

function minuteCandleSnapshot(candles) {
  return (Array.isArray(candles) ? candles : [])
    .slice(-MAX_CONTEXT_CANDLES)
    .map((candle) => ({
      time: finiteOrNull(candle?.time),
      open: finiteOrNull(candle?.open),
      high: finiteOrNull(candle?.high),
      low: finiteOrNull(candle?.low),
      close: finiteOrNull(candle?.close),
    }))
    .filter((candle) => (
      candle.time !== null
      && [candle.open, candle.high, candle.low, candle.close]
        .every((value) => value !== null && value > 0)
    ));
}

function observePricePath({
  observation,
  event,
  points,
  finalSample,
  observedAt,
  maxLiveSampleGapMs,
}) {
  const included = points.filter((point) => (
    point.at >= event.triggeredAt && point.at <= finalSample.at
  ));
  if (!included.length || included[0].at !== event.triggeredAt) {
    included.unshift({
      at: event.triggeredAt,
      sourceAt: event.sourceEventAt,
      price: event.price,
    });
  }

  const sign = directionSign(event.direction);
  let maximumRaw = 0;
  let minimumRaw = 0;
  let maximumDirectional = 0;
  let minimumDirectional = 0;
  let mfeAt = event.triggeredAt;
  let maeAt = event.triggeredAt;

  for (const point of included) {
    const raw = percentFromBaseline(point.price, event.price);
    if (raw === null) continue;
    maximumRaw = Math.max(maximumRaw, raw);
    minimumRaw = Math.min(minimumRaw, raw);
    const directional = raw * sign;
    if (directional > maximumDirectional) {
      maximumDirectional = directional;
      mfeAt = point.at;
    }
    if (directional < minimumDirectional) {
      minimumDirectional = directional;
      maeAt = point.at;
    }
  }

  const returnPercent = percentFromBaseline(finalSample.price, event.price);
  return deepFreeze({
    ...observation,
    state: OBSERVATION_STATES.OBSERVED,
    observedAt,
    finalPrice: finalSample.price,
    finalPriceAt: finalSample.at,
    returnPercent,
    directionalReturnPercent: returnPercent === null ? null : returnPercent * sign,
    maxAbovePercent: maximumRaw,
    maxBelowPercent: minimumRaw,
    mfePercent: maximumDirectional,
    maePercent: minimumDirectional,
    mfeAt,
    maeAt,
    effectDurationMs: Math.max(0, mfeAt - event.triggeredAt),
    pricePath: compactPricePath(included, [
      event.triggeredAt,
      finalSample.at,
      mfeAt,
      maeAt,
    ]),
    quality: pathQuality(
      included,
      finalSample,
      observation.dueAt,
      maxLiveSampleGapMs,
    ),
  });
}

function markObservationUnavailable({
  observation,
  points,
  candidate,
  observedAt,
  reason,
}) {
  return deepFreeze({
    ...observation,
    state: OBSERVATION_STATES.UNAVAILABLE,
    observedAt,
    quality: unavailablePathQuality(points, candidate, observation.dueAt, reason),
  });
}

function densityEpisodeSnapshot(record) {
  const priceReaction = record?.priceReaction && typeof record.priceReaction === "object"
    ? {
      windowMs: finiteOrNull(record.priceReaction.windowMs),
      latestBps: finiteOrNull(record.priceReaction.latestBps),
      maxAboveBps: finiteOrNull(record.priceReaction.maxAboveBps),
      maxBelowBps: finiteOrNull(record.priceReaction.maxBelowBps),
      lastAt: finiteOrNull(record.priceReaction.lastAt),
    }
    : null;
  const move = record?.move && typeof record.move === "object"
    ? {
      fromId: record.move.fromId ? safeText(record.move.fromId, 120) : null,
      fromPrice: finiteOrNull(record.move.fromPrice),
      toId: record.move.toId ? safeText(record.move.toId, 120) : null,
      toPrice: finiteOrNull(record.move.toPrice),
      distanceBps: finiteOrNull(record.move.distanceBps),
      matchedAt: finiteOrNull(record.move.matchedAt),
      confidence: record.move.confidence === "low" ? "low" : null,
    }
    : null;
  return {
    id: safeText(record?.id, 120),
    side: record?.side === "bid" ? "bid" : record?.side === "ask" ? "ask" : null,
    price: finiteOrNull(record?.price),
    state: safeText(record?.state, 40) || null,
    interaction: safeText(record?.interaction, 40) || "unobserved",
    resolution: safeText(record?.resolution, 40) || "unknown",
    importance: "unrated",
    evidenceTier: safeText(record?.evidenceTier, 40) || "candidate",
    evidenceQuality: safeText(record?.evidenceQuality, 40) || "none",
    continuity: safeText(record?.continuity, 40) || null,
    currentQuote: finiteOrNull(record?.currentQuote),
    maxQuote: finiteOrNull(record?.maxQuote),
    distanceBps: finiteOrNull(record?.distanceBps),
    ageMs: finiteOrNull(record?.ageMs),
    touchCount: finiteOrNull(record?.touchCount),
    executionCoverageRatio: finiteOrNull(record?.executionCoverageRatio),
    correlatedFillQuote: finiteOrNull(record?.correlatedFillQuote),
    unmatchedReductionQuantity: finiteOrNull(record?.unmatchedReductionQuantity),
    firstTouchedAt: finiteOrNull(record?.firstTouchedAt),
    lastTouchedAt: finiteOrNull(record?.lastTouchedAt),
    closedAt: finiteOrNull(record?.closedAt),
    priceReaction,
    move,
  };
}

function observedDensityEpisodes(lifecycle) {
  const records = [
    ...(Array.isArray(lifecycle?.densities) ? lifecycle.densities : []),
    ...(Array.isArray(lifecycle?.recentlyClosed) ? lifecycle.recentlyClosed : []),
  ];
  const seen = new Set();
  return records
    .filter((record) => {
      const id = String(record?.id ?? "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      const evidenceTier = record?.evidenceTier || "candidate";
      const interaction = record?.interaction || "unobserved";
      const resolution = record?.resolution || "active";
      return evidenceTier !== "candidate"
        || interaction !== "unobserved"
        || ["pulled", "moved", "consumed"].includes(resolution);
    })
    .slice(0, 12)
    .map(densityEpisodeSnapshot);
}

function liquiditySnapshot(orderBook, eventPrice, now) {
  const lifecycle = orderBook?.densityLifecycle;
  if (!orderBook || !lifecycle) {
    return {
      observed: false,
      state: DATA_QUALITY_STATES.PARTIAL,
      venue: "binance-usdm",
      bookEpoch: null,
      computedAt: null,
      bestBid: null,
      bestAsk: null,
      spreadBps: null,
      depthCoverage: null,
      bookLevels: null,
      episodes: [],
      quality: {
        complete: false,
        causality: null,
        attribution: null,
        importance: "not-scored-from-size",
      },
    };
  }

  const bestBid = finiteOrNull(orderBook.bestBid);
  const bestAsk = finiteOrNull(orderBook.bestAsk);
  const referencePrice = finiteOrNull(eventPrice);
  const spreadBps = bestBid !== null
    && bestAsk !== null
    && referencePrice !== null
    && referencePrice > 0
    ? ((bestAsk - bestBid) / referencePrice) * 10_000
    : null;
  const explicitAge = finiteOrNull(orderBook?.health?.depthAgeMs);
  const computedAt = finiteOrNull(lifecycle.computedAt) ?? finiteOrNull(orderBook.eventTime);
  const ageMs = explicitAge ?? (computedAt === null ? null : Math.max(0, now - computedAt));
  let state = DATA_QUALITY_STATES.PARTIAL;
  if (ageMs !== null && ageMs > STALE_DEPTH_AGE_MS) state = DATA_QUALITY_STATES.STALE;
  else if (
    lifecycle.state === "live"
    && lifecycle.quality?.complete === true
    && ageMs !== null
    && ageMs <= LIVE_DEPTH_AGE_MS
  ) state = DATA_QUALITY_STATES.LIVE;

  return {
    observed: true,
    state,
    venue: safeText(lifecycle.venue || "binance-usdm", 40),
    bookEpoch: finiteOrNull(lifecycle.bookEpoch),
    computedAt,
    bestBid,
    bestAsk,
    spreadBps,
    depthCoverage: {
      bidPercent: finiteOrNull(orderBook?.coverage?.bidPercent),
      askPercent: finiteOrNull(orderBook?.coverage?.askPercent),
    },
    bookLevels: {
      bids: finiteOrNull(orderBook?.bookLevels?.bids),
      asks: finiteOrNull(orderBook?.bookLevels?.asks),
    },
    episodes: observedDensityEpisodes(lifecycle),
    quality: {
      complete: lifecycle.quality?.complete === true,
      depth: safeText(lifecycle.quality?.depth, 40) || null,
      trades: safeText(lifecycle.quality?.trades, 40) || null,
      tradeSources: Array.isArray(lifecycle.quality?.tradeSources)
        ? lifecycle.quality.tradeSources.map((source) => safeText(source, 40))
        : [],
      causality: safeText(lifecycle.quality?.causality, 80) || null,
      attribution: safeText(lifecycle.quality?.attribution, 80) || null,
      importance: "not-scored-from-size",
    },
  };
}

function btcSnapshot(metrics, now) {
  if (!metrics) {
    return {
      symbol: "BTCUSDT",
      state: DATA_QUALITY_STATES.PARTIAL,
      price: null,
      change15s: null,
      change1m: null,
      change5m: null,
    };
  }
  return {
    symbol: "BTCUSDT",
    state: marketQuality(metrics, now),
    price: finiteOrNull(metrics.price),
    change15s: finiteOrNull(metrics.change15s),
    change1m: finiteOrNull(metrics.change1m),
    change5m: finiteOrNull(metrics.change5m),
  };
}

export function createSignalEvent({
  id,
  metrics,
  signal,
  settings,
  now = Date.now(),
  venue = "binance-usdm",
  formulaVersion = SIGNAL_FORMULA_VERSION,
}) {
  const symbol = safeSymbol(metrics?.symbol);
  const price = finiteOrNull(metrics?.price);
  if (!id || !symbol || price === null || price <= 0 || !signal?.type) {
    throw new TypeError("A signal event requires id, symbol, positive price and signal type");
  }
  const detectedAt = positiveTimestamp(now);
  const pattern = patternDefinition(signal.type);
  const detectorEvidence = signal.evidence && typeof signal.evidence === "object"
    ? JSON.parse(JSON.stringify(signal.evidence))
    : null;
  const marketwideFormula = String(signal.formulaVersion || "").startsWith("marketwide-patterns-");
  return deepFreeze({
    schemaVersion: MARKET_MEMORY_SCHEMA_VERSION,
    entity: "SignalEvent",
    id: safeText(id, 180),
    venue: safeText(venue, 40),
    symbol,
    signalType: safeText(signal.type, 40),
    direction: signal.direction === "up" ? "up" : signal.direction === "down" ? "down" : "neutral",
    triggeredAt: detectedAt,
    detectedAt,
    sourceEventAt: finiteOrNull(metrics.updatedAt),
    price,
    score: finiteOrNull(metrics.score),
    priority: finiteOrNull(signal.priority),
    label: safeText(signal.label, 80),
    reason: safeText(signal.reason),
    taxonomy: pattern ? {
      version: PATTERN_CATALOG_VERSION,
      group: pattern.group,
      detectorState: pattern.detectorState,
    } : null,
    detectorEvidence,
    formula: {
      name: marketwideFormula ? "marketwide-pattern-scanner" : "radar-signal-classifier",
      version: safeText(signal.formulaVersion || formulaVersion, 80),
      settings: numericSettingsSnapshot(settings),
    },
  });
}

export function createSignalContext({
  event,
  metrics,
  btcMetrics = null,
  orderBook = null,
  now = Date.now(),
}) {
  if (!event?.id || event.entity !== "SignalEvent") {
    throw new TypeError("SignalContext requires a SignalEvent");
  }
  const capturedAt = positiveTimestamp(now);
  const marketState = marketQuality(metrics, capturedAt);
  const tradesState = tradeQuality(metrics, capturedAt);
  const liquidity = liquiditySnapshot(orderBook, event.price, capturedAt);
  const openInterestState = DATA_QUALITY_STATES.PARTIAL;
  const regimeState = DATA_QUALITY_STATES.PARTIAL;
  const bitcoin = btcSnapshot(btcMetrics, capturedAt);
  const overall = combineQuality([
    marketState,
    tradesState,
    liquidity.state,
    openInterestState,
    regimeState,
    bitcoin.state,
  ]);
  const buyShare = finiteOrNull(metrics?.trades?.buyShare);
  const clock = patternClock(capturedAt);
  const bookGeometry = densityGeometry(orderBook);
  const minuteStructure = minuteStructureEvidence(metrics?.minuteCandles, metrics?.price);

  return deepFreeze({
    schemaVersion: MARKET_MEMORY_SCHEMA_VERSION,
    version: SIGNAL_CONTEXT_VERSION,
    entity: "SignalContext",
    id: `${event.id}:context`,
    eventId: event.id,
    venue: event.venue,
    symbol: event.symbol,
    capturedAt,
    market: {
      price: finiteOrNull(metrics?.price),
      updatedAt: finiteOrNull(metrics?.updatedAt),
      change15s: finiteOrNull(metrics?.change15s),
      change1m: finiteOrNull(metrics?.change1m),
      change5m: finiteOrNull(metrics?.change5m),
      change24h: finiteOrNull(metrics?.change24h),
      quoteVolume24h: finiteOrNull(metrics?.quoteVolume24h),
      turnoverPerMinute: finiteOrNull(metrics?.turnoverPerMinute),
      volumeAcceleration: finiteOrNull(metrics?.volumeBoost),
      range60s: rangeSnapshot(metrics?.range60s),
      range5m: rangeSnapshot(metrics?.range5m),
      natr1m: finiteOrNull(metrics?.natr1m),
      natr5m: finiteOrNull(metrics?.natr5m),
      btcCorrelation: finiteOrNull(metrics?.correlation),
    },
    trades: {
      lastTradeAt: finiteOrNull(metrics?.lastTradeAt),
      tradesPerSecond: finiteOrNull(metrics?.trades?.tps),
      aggressiveBuyQuote: finiteOrNull(metrics?.trades?.buy),
      aggressiveSellQuote: finiteOrNull(metrics?.trades?.sell),
      aggressiveBuySharePercent: buyShare,
      aggressiveSellSharePercent: buyShare === null ? null : 100 - buyShare,
    },
    liquidations: {
      windowMs: 60_000,
      longsQuote: finiteOrNull(metrics?.liquidation?.longs),
      shortsQuote: finiteOrNull(metrics?.liquidation?.shorts),
      totalQuote: finiteOrNull(metrics?.liquidation?.total),
    },
    funding: {
      rate: finiteOrNull(metrics?.fundingRate),
      nextAt: finiteOrNull(metrics?.nextFundingTime),
    },
    patternEvidence: {
      version: PATTERN_CATALOG_VERSION,
      observationScope: "signal-triggered-only",
      clock,
      minuteStructure,
      orderBookGeometry: bookGeometry,
      tradeSource: "aggregated-trades",
      rawTradeIdentityAvailable: false,
      limitations: [
        "cascade-and-algorithm-thresholds-are-not-calibrated-v2",
        "raw-trade-repeat-detection-unavailable-v1",
        ...(!orderBook ? ["order-book-evidence-requires-open-panel"] : []),
      ],
    },
    chartContext: {
      timeframe: "1m",
      candles: minuteCandleSnapshot(metrics?.minuteCandles),
      seconds: (Array.isArray(metrics?.priceHistory) ? metrics.priceHistory : [])
        .slice(-1_200)
        .map((point) => ({ at: finiteOrNull(point?.at), price: finiteOrNull(point?.price) }))
        .filter((point) => point.at !== null && point.price !== null && point.price > 0),
    },
    openInterest: {
      value: null,
      change15s: null,
      change1m: null,
      change5m: null,
      state: openInterestState,
    },
    bitcoin,
    marketRegime: {
      label: null,
      version: null,
      state: regimeState,
    },
    liquidity,
    quality: {
      overall,
      market: marketState,
      trades: tradesState,
      orderBook: liquidity.state,
      openInterest: openInterestState,
      bitcoin: bitcoin.state,
      marketRegime: regimeState,
      complete: overall === DATA_QUALITY_STATES.LIVE,
      limitations: [
        "open-interest-unavailable-v1",
        "market-regime-unclassified-v1",
        ...(!liquidity.observed ? ["order-book-not-observed-for-symbol"] : []),
      ],
    },
  });
}

export function createPendingSignalObservations({
  event,
  now = Date.now(),
  horizons = SIGNAL_OBSERVATION_HORIZONS,
}) {
  if (!event?.id || event.entity !== "SignalEvent") {
    throw new TypeError("SignalObservation requires a SignalEvent");
  }
  const createdAt = positiveTimestamp(now);
  return deepFreeze(horizons.map(({ key, durationMs }) => {
    const duration = finiteOrNull(durationMs);
    if (!key || duration === null || duration <= 0) {
      throw new TypeError("SignalObservation horizons require a key and positive duration");
    }
    return {
      schemaVersion: MARKET_MEMORY_SCHEMA_VERSION,
      version: SIGNAL_OBSERVATION_VERSION,
      entity: "SignalObservation",
      id: `${event.id}:observation:${safeText(key, 20)}`,
      eventId: event.id,
      horizon: safeText(key, 20),
      horizonMs: duration,
      state: OBSERVATION_STATES.PENDING,
      createdAt,
      dueAt: event.triggeredAt + duration,
      observedAt: null,
      baselinePrice: event.price,
      finalPrice: null,
      finalPriceAt: null,
      returnPercent: null,
      directionalReturnPercent: null,
      maxAbovePercent: null,
      maxBelowPercent: null,
      mfePercent: null,
      maePercent: null,
      mfeAt: null,
      maeAt: null,
      effectDurationMs: null,
      definition: OBSERVATION_DEFINITION,
      quality: {
        state: OBSERVATION_STATES.PENDING,
        reason: "awaiting-horizon",
        sampleCount: 1,
        firstSampleAt: event.triggeredAt,
        lastSampleAt: event.triggeredAt,
        maxGapMs: 0,
        finalSampleDelayMs: null,
        limitations: [],
      },
    };
  }));
}

export class SignalMemoryTracker {
  constructor({
    releaseAfterMs = DEFAULT_RELEASE_AFTER_MS,
    episodeCooldownMs = DEFAULT_EPISODE_COOLDOWN_MS,
    maxEvents = DEFAULT_MAX_EVENTS,
    venue = "binance-usdm",
    formulaVersion = SIGNAL_FORMULA_VERSION,
    finalSampleMaxDelayMs = DEFAULT_FINAL_SAMPLE_MAX_DELAY_MS,
    maxLiveSampleGapMs = DEFAULT_MAX_LIVE_SAMPLE_GAP_MS,
  } = {}) {
    this.releaseAfterMs = Math.max(250, Number(releaseAfterMs) || DEFAULT_RELEASE_AFTER_MS);
    this.episodeCooldownMs = Math.max(
      1_000,
      Number(episodeCooldownMs) || DEFAULT_EPISODE_COOLDOWN_MS,
    );
    this.maxEvents = Math.max(1, Math.floor(Number(maxEvents) || DEFAULT_MAX_EVENTS));
    this.venue = safeText(venue, 40);
    this.formulaVersion = safeText(formulaVersion, 80);
    this.finalSampleMaxDelayMs = Math.max(
      250,
      Number(finalSampleMaxDelayMs) || DEFAULT_FINAL_SAMPLE_MAX_DELAY_MS,
    );
    this.maxLiveSampleGapMs = Math.max(
      250,
      Number(maxLiveSampleGapMs) || DEFAULT_MAX_LIVE_SAMPLE_GAP_MS,
    );
    this.sequence = 0;
    this.activeSignals = new Map();
    this.recentEpisodes = new Map();
    this.signalEvents = [];
    this.signalContexts = [];
    this.signalObservations = [];
    this.eventsById = new Map();
    this.pricePaths = new Map();
    this.pendingEventIdsBySymbol = new Map();
  }

  #signalKey(symbol, signal, settingsFingerprint) {
    return [
      this.formulaVersion,
      settingsFingerprint,
      symbol,
      safeText(signal?.type, 40),
      signal?.direction === "up" ? "up" : signal?.direction === "down" ? "down" : "neutral",
    ].join(":");
  }

  #episodeKey(symbol, signal) {
    return [
      symbol,
      signal?.direction === "up" ? "up" : signal?.direction === "down" ? "down" : "neutral",
    ].join(":");
  }

  #prune() {
    if (this.signalEvents.length <= this.maxEvents) return;
    const removed = this.signalEvents.splice(0, this.signalEvents.length - this.maxEvents);
    const removedIds = new Set(removed.map((event) => event.id));
    for (const [key, active] of this.activeSignals) {
      if (removedIds.has(active.eventId)) this.activeSignals.delete(key);
    }
    this.signalContexts = this.signalContexts.filter((context) => !removedIds.has(context.eventId));
    this.signalObservations = this.signalObservations
      .filter((observation) => !removedIds.has(observation.eventId));
    for (const event of removed) {
      this.eventsById.delete(event.id);
      this.pricePaths.delete(event.id);
      const eventIds = this.pendingEventIdsBySymbol.get(event.symbol);
      eventIds?.delete(event.id);
      if (eventIds && !eventIds.size) this.pendingEventIdsBySymbol.delete(event.symbol);
    }
  }

  #registerPricePath(event) {
    this.eventsById.set(event.id, event);
    this.pricePaths.set(event.id, {
      symbol: event.symbol,
      points: [{
        at: event.triggeredAt,
        sourceAt: event.sourceEventAt,
        price: event.price,
      }],
    });
    const eventIds = this.pendingEventIdsBySymbol.get(event.symbol) ?? new Set();
    eventIds.add(event.id);
    this.pendingEventIdsBySymbol.set(event.symbol, eventIds);
  }

  #recordLivePriceSamples(liveRows, capturedAt) {
    for (const { metricsItem, symbol } of liveRows) {
      const eventIds = this.pendingEventIdsBySymbol.get(symbol);
      if (!eventIds?.size) continue;
      const price = finiteOrNull(metricsItem?.price);
      const sourceAt = finiteOrNull(metricsItem?.updatedAt);
      if (price === null || price <= 0 || sourceAt === null) continue;

      for (const eventId of eventIds) {
        const path = this.pricePaths.get(eventId);
        const event = this.eventsById.get(eventId);
        if (!path || !event || capturedAt < event.triggeredAt) continue;
        const latest = path.points.at(-1);
        if (
          latest
          && sourceAt !== null
          && latest.sourceAt !== null
          && sourceAt <= latest.sourceAt
        ) continue;
        path.points.push({ at: capturedAt, sourceAt, price });
      }
    }
  }

  #resolvePendingObservations(capturedAt) {
    const resolved = [];
    for (let index = 0; index < this.signalObservations.length; index += 1) {
      const observation = this.signalObservations[index];
      if (observation.state !== OBSERVATION_STATES.PENDING) continue;
      if (capturedAt < observation.dueAt) continue;
      const event = this.eventsById.get(observation.eventId);
      const path = this.pricePaths.get(observation.eventId);
      if (!event || !path) continue;

      const candidate = firstPointAtOrAfter(path.points, observation.dueAt);
      let next = null;
      if (candidate) {
        const delayMs = candidate.at - observation.dueAt;
        next = delayMs <= this.finalSampleMaxDelayMs
          ? observePricePath({
            observation,
            event,
            points: path.points,
            finalSample: candidate,
            observedAt: capturedAt,
            maxLiveSampleGapMs: this.maxLiveSampleGapMs,
          })
          : markObservationUnavailable({
            observation,
            points: path.points,
            candidate,
            observedAt: capturedAt,
            reason: "first-future-price-missed-horizon-window",
          });
      } else if (capturedAt > observation.dueAt + this.finalSampleMaxDelayMs) {
        next = markObservationUnavailable({
          observation,
          points: path.points,
          candidate: null,
          observedAt: capturedAt,
          reason: "no-live-price-within-horizon-window",
        });
      }

      if (!next) continue;
      this.signalObservations[index] = next;
      resolved.push(next);
    }
    if (resolved.length) this.#releaseCompletedPricePaths();
    return resolved;
  }

  #releaseCompletedPricePaths() {
    const pendingIds = new Set(
      this.signalObservations
        .filter((observation) => observation.state === OBSERVATION_STATES.PENDING)
        .map((observation) => observation.eventId),
    );
    for (const [eventId, path] of this.pricePaths) {
      if (pendingIds.has(eventId)) continue;
      this.pricePaths.delete(eventId);
      const eventIds = this.pendingEventIdsBySymbol.get(path.symbol);
      eventIds?.delete(eventId);
      if (eventIds && !eventIds.size) this.pendingEventIdsBySymbol.delete(path.symbol);
    }
  }

  ingest({
    metrics,
    settings = {},
    now = Date.now(),
    contextForSymbol = null,
  }) {
    const capturedAt = positiveTimestamp(now);
    const rows = Array.isArray(metrics) ? metrics : [];
    const settingsFingerprint = JSON.stringify(numericSettingsSnapshot(settings));
    const btcMetrics = rows.find((item) => item?.symbol === "BTCUSDT") ?? null;
    const liveRows = rows
      .map((metricsItem) => ({
        metricsItem,
        symbol: safeSymbol(metricsItem?.symbol),
      }))
      .filter(({ metricsItem, symbol }) => (
        symbol && marketQuality(metricsItem, capturedAt) === DATA_QUALITY_STATES.LIVE
      ));
    const liveSymbols = new Set(liveRows.map(({ symbol }) => symbol));
    const currentSignals = new Map();
    for (const { metricsItem, symbol } of liveRows) {
      for (const signal of Array.isArray(metricsItem?.signals) ? metricsItem.signals : []) {
        if (!signal?.type) continue;
        currentSignals.set(
          this.#signalKey(symbol, signal, settingsFingerprint),
          { metricsItem, signal, symbol },
        );
      }
    }
    for (const [key, active] of this.activeSignals) {
      if (!liveSymbols.has(active.symbol)) continue;
      if (currentSignals.has(key)) {
        if (
          active.missingSince !== null
          && capturedAt - active.missingSince >= this.releaseAfterMs
        ) {
          this.activeSignals.delete(key);
        } else {
          active.lastSeenAt = capturedAt;
          active.missingSince = null;
        }
      } else if (active.missingSince === null) {
        active.missingSince = capturedAt;
      } else if (capturedAt - active.missingSince >= this.releaseAfterMs) {
        this.activeSignals.delete(key);
      }
    }

    this.#recordLivePriceSamples(liveRows, capturedAt);
    const resolvedObservations = this.#resolvePendingObservations(capturedAt);

    const created = {
      events: [],
      contexts: [],
      observations: [],
      resolvedObservations,
    };
    for (const [episodeKey, episode] of this.recentEpisodes) {
      if (capturedAt - episode.triggeredAt >= this.episodeCooldownMs) {
        this.recentEpisodes.delete(episodeKey);
      }
    }

    const rankedSignals = [...currentSignals.entries()]
      .sort(([, left], [, right]) => (
        Number(right.signal?.priority || 0) - Number(left.signal?.priority || 0)
      ));
    for (const [key, { metricsItem, signal, symbol }] of rankedSignals) {
      const active = this.activeSignals.get(key);
      if (active) {
        active.lastSeenAt = capturedAt;
        continue;
      }

      const episodeKey = this.#episodeKey(symbol, signal);
      const recentEpisode = this.recentEpisodes.get(episodeKey);
      const sameSettings = recentEpisode?.settingsFingerprint === settingsFingerprint;
      if (
        sameSettings
        && capturedAt - recentEpisode.triggeredAt < this.episodeCooldownMs
      ) {
        this.activeSignals.set(key, {
          eventId: recentEpisode.eventId,
          symbol,
          lastSeenAt: capturedAt,
          missingSince: null,
        });
        continue;
      }

      this.sequence += 1;
      const id = [
        this.venue,
        symbol,
        safeText(signal.type, 40),
        capturedAt,
        this.sequence,
      ].join(":");
      const event = createSignalEvent({
        id,
        metrics: metricsItem,
        signal,
        settings,
        now: capturedAt,
        venue: this.venue,
        formulaVersion: this.formulaVersion,
      });
      let orderBook = null;
      if (typeof contextForSymbol === "function") {
        try {
          orderBook = contextForSymbol(symbol) ?? null;
        } catch {
          orderBook = null;
        }
      }
      const context = createSignalContext({
        event,
        metrics: metricsItem,
        btcMetrics,
        orderBook,
        now: capturedAt,
      });
      const observations = createPendingSignalObservations({ event, now: capturedAt });

      this.activeSignals.set(key, {
        eventId: event.id,
        symbol,
        lastSeenAt: capturedAt,
        missingSince: null,
      });
      this.recentEpisodes.set(episodeKey, {
        eventId: event.id,
        triggeredAt: capturedAt,
        settingsFingerprint,
      });
      this.signalEvents.push(event);
      this.signalContexts.push(context);
      this.signalObservations.push(...observations);
      this.#registerPricePath(event);
      created.events.push(event);
      created.contexts.push(context);
      created.observations.push(...observations);
    }

    this.#prune();
    return deepFreeze(created);
  }

  snapshot() {
    return deepFreeze({
      schemaVersion: MARKET_MEMORY_SCHEMA_VERSION,
      events: [...this.signalEvents],
      contexts: [...this.signalContexts],
      observations: [...this.signalObservations],
    });
  }

  summary() {
    return deepFreeze({
      schemaVersion: MARKET_MEMORY_SCHEMA_VERSION,
      events: this.signalEvents.length,
      contexts: this.signalContexts.length,
      observations: this.signalObservations.length,
      pendingObservations: this.signalObservations
        .filter((observation) => observation.state === OBSERVATION_STATES.PENDING)
        .length,
      observedObservations: this.signalObservations
        .filter((observation) => observation.state === OBSERVATION_STATES.OBSERVED)
        .length,
      unavailableObservations: this.signalObservations
        .filter((observation) => observation.state === OBSERVATION_STATES.UNAVAILABLE)
        .length,
      activeSignals: this.activeSignals.size,
      formulaVersion: this.formulaVersion,
    });
  }
}
