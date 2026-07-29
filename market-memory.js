export const MARKET_MEMORY_SCHEMA_VERSION = 1;
export const SIGNAL_FORMULA_VERSION = "radar-signals-v1";
export const SIGNAL_CONTEXT_VERSION = 1;
export const SIGNAL_OBSERVATION_VERSION = 1;

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
const DEFAULT_MAX_EVENTS = 1_000;
const LIVE_MARKET_AGE_MS = 5_000;
const LIVE_TRADE_AGE_MS = 3_000;
const LIVE_DEPTH_AGE_MS = 3_500;
const STALE_DEPTH_AGE_MS = 9_000;

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
    formula: {
      name: "radar-signal-classifier",
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
      returnPercent: null,
      mfePercent: null,
      maePercent: null,
      effectDurationMs: null,
      definition: "return-from-event-price; MFE/MAE require observed price path",
      quality: {
        state: OBSERVATION_STATES.PENDING,
        reason: "awaiting-horizon",
      },
    };
  }));
}

export class SignalMemoryTracker {
  constructor({
    releaseAfterMs = DEFAULT_RELEASE_AFTER_MS,
    maxEvents = DEFAULT_MAX_EVENTS,
    venue = "binance-usdm",
    formulaVersion = SIGNAL_FORMULA_VERSION,
  } = {}) {
    this.releaseAfterMs = Math.max(250, Number(releaseAfterMs) || DEFAULT_RELEASE_AFTER_MS);
    this.maxEvents = Math.max(1, Math.floor(Number(maxEvents) || DEFAULT_MAX_EVENTS));
    this.venue = safeText(venue, 40);
    this.formulaVersion = safeText(formulaVersion, 80);
    this.sequence = 0;
    this.activeSignals = new Map();
    this.signalEvents = [];
    this.signalContexts = [];
    this.signalObservations = [];
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

    const created = {
      events: [],
      contexts: [],
      observations: [],
    };

    for (const [key, { metricsItem, signal, symbol }] of currentSignals) {
      const active = this.activeSignals.get(key);
      if (active) {
        active.lastSeenAt = capturedAt;
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
      this.signalEvents.push(event);
      this.signalContexts.push(context);
      this.signalObservations.push(...observations);
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
      activeSignals: this.activeSignals.size,
      formulaVersion: this.formulaVersion,
    });
  }
}
