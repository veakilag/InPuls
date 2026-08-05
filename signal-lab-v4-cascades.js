export const SIGNAL_LAB_V4_CASCADE_FORMULA_VERSION = "signal-lab-v4-cascade-v1-2026-08";

export const CASCADE_STATES = Object.freeze({
  SETUP: "SETUP",
  TRIGGERED: "TRIGGERED",
  CONFIRMED: "CONFIRMED",
  EXTENDED: "EXTENDED",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
});

export const CASCADE_GEOMETRIC_STATES = Object.freeze({
  SETUP: "SETUP",
  TRIGGERED: "TRIGGERED",
  CONFIRMED: "CONFIRMED",
  EXTENDED: "EXTENDED",
});

export const DEFAULT_CASCADE_CONFIG = Object.freeze({
  minimumLevels: 2,
  fullCascadeLevels: 3,
  maxCascadeGapPct: 5,
  setupDisappearGraceMs: 60_000,
  maxBarsBetweenLevels: 5,
  maxInterLevelPullbackPct: 0.45,
  maxInterLevelPullbackAtr: 0.80,
  fullReturnTolerancePct: 0.08,
  fullReturnToleranceAtr: 0.15,
  maxOutcomeGapMs: 15_000,
  historyLimit: 1_000,
  maxCascadeDurationMsByTimeframe: Object.freeze({
    "1m": 5 * 60_000,
    "5m": 25 * 60_000,
    "15m": 75 * 60_000,
    "1h": 4 * 60 * 60_000,
    "4h": 16 * 60 * 60_000,
    "1d": 5 * 24 * 60 * 60_000,
  }),
});

const OUTCOME_HORIZONS = Object.freeze({
  "15s": 15_000,
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
});

const TIMEFRAME_MS = Object.freeze({
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
});

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeSymbol = (value) => {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,20}USDT$/.test(symbol) ? symbol : null;
};

const normalizeQuality = (value) => {
  const quality = String(value ?? "LIVE").toUpperCase();
  return ["LIVE", "STALE", "GAP", "RECOVERED", "ERROR"].includes(quality) ? quality : "ERROR";
};

const confirmationQuality = (quality) => quality === "LIVE" || quality === "RECOVERED";
const terminalState = (state) => [CASCADE_STATES.PARTIAL, CASCADE_STATES.FAILED].includes(state);

function timeframeDuration(timeframes = []) {
  const values = timeframes.map((timeframe) => TIMEFRAME_MS[timeframe]).filter(Number.isFinite);
  return values.length ? Math.min(...values) : TIMEFRAME_MS["1m"];
}

function primaryTimeframe(timeframes = []) {
  return [...timeframes].sort((left, right) => (
    (TIMEFRAME_MS[left] ?? Infinity) - (TIMEFRAME_MS[right] ?? Infinity)
  ))[0] ?? "1m";
}

function boundaryFor(zone, direction) {
  return direction === "UP" ? finite(zone?.upperPrice) : finite(zone?.lowerPrice);
}

function aheadOfPrice(zone, direction, price) {
  const boundary = boundaryFor(zone, direction);
  if (!(boundary > 0) || !(price > 0)) return false;
  return direction === "UP" ? boundary >= price : boundary <= price;
}

function gapPct(leftPrice, rightPrice) {
  if (!(leftPrice > 0) || !(rightPrice > 0)) return Infinity;
  return Math.max(0, Math.abs(rightPrice - leftPrice) / leftPrice * 100);
}

function totalSpanPct(prices) {
  if (prices.length < 2 || !(prices[0] > 0)) return 0;
  return Math.abs(prices.at(-1) - prices[0]) / prices[0] * 100;
}

function directionMovePct(direction, start, current) {
  if (!(start > 0) || !(current > 0)) return null;
  const market = (current - start) / start * 100;
  return direction === "UP" ? market : -market;
}

function marketMovePct(start, current) {
  if (!(start > 0) || !(current > 0)) return null;
  return (current - start) / start * 100;
}

function newAnchor(at, price, quality) {
  return {
    at,
    price,
    dataQuality: quality,
    lastSampleAt: at,
    hasGap: false,
    mfePct: 0,
    maePct: 0,
    timeToMfeMs: 0,
    timeToMaeMs: 0,
    outcomes: Object.fromEntries(Object.keys(OUTCOME_HORIZONS).map((key) => [key, {
      state: "PENDING",
      targetAt: at + OUTCOME_HORIZONS[key],
      observedAt: null,
      marketReturnPct: null,
      scenarioMovePct: null,
      mfePct: null,
      maePct: null,
      timeToMfeMs: null,
      timeToMaeMs: null,
      dataQuality: quality,
    }])),
  };
}

function updateAnchor(anchor, event, price, at, quality, maxGapMs) {
  if (!anchor || !(price > 0) || at < anchor.at) return;
  if (anchor.lastSampleAt !== null && at - anchor.lastSampleAt > maxGapMs) anchor.hasGap = true;
  anchor.lastSampleAt = at;
  const favorable = directionMovePct(event.direction, anchor.price, price);
  if (favorable !== null && favorable > anchor.mfePct) {
    anchor.mfePct = favorable;
    anchor.timeToMfeMs = at - anchor.at;
  }
  if (favorable !== null && favorable < anchor.maePct) {
    anchor.maePct = favorable;
    anchor.timeToMaeMs = at - anchor.at;
  }
  for (const outcome of Object.values(anchor.outcomes)) {
    if (outcome.state !== "PENDING" || at < outcome.targetAt) continue;
    outcome.state = anchor.hasGap || !confirmationQuality(quality) ? "PARTIAL" : "OBSERVED";
    outcome.observedAt = at;
    outcome.marketReturnPct = marketMovePct(anchor.price, price);
    outcome.scenarioMovePct = favorable;
    outcome.mfePct = anchor.mfePct;
    outcome.maePct = anchor.maePct;
    outcome.timeToMfeMs = anchor.timeToMfeMs;
    outcome.timeToMaeMs = anchor.timeToMaeMs;
    outcome.dataQuality = quality;
  }
}

function cloneAnchor(anchor) {
  if (!anchor) return null;
  return Object.freeze({
    ...anchor,
    outcomes: Object.freeze(Object.fromEntries(Object.entries(anchor.outcomes).map(([key, value]) => [key, Object.freeze({ ...value })]))),
  });
}

function publicEvent(event) {
  return Object.freeze({
    ...event,
    levelIds: Object.freeze([...event.levelIds]),
    levelPrices: Object.freeze([...event.levelPrices]),
    levelTimeframes: Object.freeze(event.levelTimeframes.map((rows) => Object.freeze([...rows]))),
    adjacentGapPct: Object.freeze([...event.adjacentGapPct]),
    touchCounts: Object.freeze([...event.touchCounts]),
    brokenLevelIds: Object.freeze([...event.brokenLevelIds]),
    brokenAt: Object.freeze([...event.brokenAt]),
    acceptedLevelIds: Object.freeze([...event.acceptedLevelIds]),
    barsBetweenLevels: Object.freeze([...event.barsBetweenLevels]),
    variants: Object.freeze([...event.variants]),
    failureReasons: Object.freeze([...event.failureReasons]),
    setupFeatures: Object.freeze({ ...event.setupFeatures }),
    anchors: Object.freeze({
      setup: cloneAnchor(event.anchors.setup),
      trigger: cloneAnchor(event.anchors.trigger),
      confirm: cloneAnchor(event.anchors.confirm),
      complete: cloneAnchor(event.anchors.complete),
    }),
  });
}

function buildDirectionalChains(levelMap, direction, price, maxGap, minimumLevels) {
  const side = direction === "UP" ? "HIGH" : "LOW";
  const zones = (Array.isArray(levelMap?.activeZones) ? levelMap.activeZones : [])
    .filter((zone) => zone?.side === side && zone?.active !== false && aheadOfPrice(zone, direction, price))
    .map((zone) => ({ ...zone, boundary: boundaryFor(zone, direction) }))
    .filter((zone) => zone.boundary > 0)
    .sort((left, right) => direction === "UP" ? left.boundary - right.boundary : right.boundary - left.boundary);
  const segments = [];
  let segment = [];
  for (const zone of zones) {
    if (!segment.length) {
      segment = [zone];
      continue;
    }
    const gap = gapPct(segment.at(-1).boundary, zone.boundary);
    if (gap <= maxGap) segment.push(zone);
    else {
      if (segment.length >= minimumLevels) segments.push(segment);
      segment = [zone];
    }
  }
  if (segment.length >= minimumLevels) segments.push(segment);
  return segments;
}

function setupVariants(zones, gaps) {
  const variants = [];
  const touchCounts = zones.map((zone) => Math.max(1, Math.round(finite(zone?.touchCount) ?? 1)));
  const timeframes = new Set(zones.flatMap((zone) => Array.isArray(zone?.timeframes) ? zone.timeframes : []));
  const compressionTypes = zones.map((zone) => zone?.setupFeatures?.compressionType).filter(Boolean);
  if (touchCounts.some((count) => count >= 2)) variants.push("MULTI_TOUCH_LEVEL");
  if (gaps.length && Math.max(...gaps) <= 0.25) variants.push("COMPRESSED");
  else if (gaps.length && Math.max(...gaps) >= 1) variants.push("STRETCHED");
  else variants.push("STAIRCASE");
  if (compressionTypes.some((value) => value && value !== "NO_COMPRESSION")) variants.push("AFTER_COMPRESSION");
  else variants.push("IMPULSE_OR_UNPROVEN_PREPARATION");
  if (timeframes.size > 1 || zones.some((zone) => (zone?.timeframes?.length ?? 0) > 1)) variants.push("MULTI_TIMEFRAME");
  return [...new Set(variants)];
}

export class CascadeEngine {
  constructor({ symbol, config = {} }) {
    this.symbol = normalizeSymbol(symbol);
    if (!this.symbol) throw new TypeError("Unsupported symbol");
    this.config = {
      ...DEFAULT_CASCADE_CONFIG,
      ...config,
      maxCascadeDurationMsByTimeframe: {
        ...DEFAULT_CASCADE_CONFIG.maxCascadeDurationMsByTimeframe,
        ...(config.maxCascadeDurationMsByTimeframe ?? {}),
      },
    };
    this.events = new Map();
    this.history = [];
    this.lastPrice = null;
    this.lastAt = null;
    this.lastCandleAt = null;
    this.barIndex = -1;
    this.dataQuality = "LIVE";
    this.atr = null;
  }

  sync(levelMap, {
    currentPrice = this.lastPrice,
    at = Date.now(),
    dataQuality = levelMap?.dataQuality ?? this.dataQuality,
    atr = this.atr,
  } = {}) {
    const price = finite(currentPrice);
    const timestamp = finite(at);
    if (!(price > 0) || timestamp === null) return this.snapshot();
    this.lastPrice = price;
    this.lastAt = timestamp;
    this.dataQuality = normalizeQuality(dataQuality);
    this.atr = finite(atr) ?? this.atr;

    const seen = new Set();
    for (const direction of ["UP", "DOWN"]) {
      const chains = buildDirectionalChains(
        levelMap,
        direction,
        price,
        this.config.maxCascadeGapPct,
        this.config.minimumLevels,
      );
      for (const zones of chains) {
        const event = this.#upsertSetup(direction, zones, price, timestamp);
        seen.add(event.id);
      }
    }

    for (const event of this.events.values()) {
      if (terminalState(event.state) || event.state !== CASCADE_STATES.SETUP || seen.has(event.id)) continue;
      if (timestamp - event.lastSetupSeenAt > this.config.setupDisappearGraceMs) {
        this.#fail(event, timestamp, "SETUP_CANCELLED");
      }
    }

    this.#applyLevelEvents(levelMap, timestamp);
    this.ingestPrice(price, timestamp, { dataQuality: this.dataQuality, atr: this.atr, source: "SYNC" });
    return this.snapshot();
  }

  #upsertSetup(direction, zones, price, at) {
    const primary = zones[0];
    const id = `${this.symbol}:${direction}:${primary.id}:${SIGNAL_LAB_V4_CASCADE_FORMULA_VERSION}`;
    const prices = zones.map((zone) => zone.boundary);
    const gaps = prices.slice(1).map((value, index) => gapPct(prices[index], value));
    const levelTimeframes = zones.map((zone) => [...new Set(Array.isArray(zone.timeframes) ? zone.timeframes : [])]);
    const allTimeframes = [...new Set(levelTimeframes.flat())];
    const primaryTf = primaryTimeframe(levelTimeframes[0]);
    const features = {
      primaryDistancePct: Math.abs(prices[0] - price) / price * 100,
      levelCount: zones.length,
      multiTouchLevels: zones.filter((zone) => (finite(zone.touchCount) ?? 1) >= 2).length,
      multiTimeframeLevels: zones.filter((zone) => (zone.timeframes?.length ?? 0) > 1).length,
      primaryCompressionType: primary?.setupFeatures?.compressionType ?? "NO_COMPRESSION",
      primaryNearLevelShare: finite(primary?.setupFeatures?.nearLevelShare),
      primaryTimeNearLevelMs: finite(primary?.setupFeatures?.timeNearLevelMs),
    };
    let event = this.events.get(id);
    if (!event) {
      event = {
        id,
        symbol: this.symbol,
        direction,
        setupDetectedAt: at,
        lastSetupSeenAt: at,
        triggeredAt: null,
        confirmedAt: null,
        completedAt: null,
        failedAt: null,
        state: CASCADE_STATES.SETUP,
        geometricState: CASCADE_GEOMETRIC_STATES.SETUP,
        primaryLevelId: primary.id,
        levelIds: zones.map((zone) => zone.id),
        levelPrices: prices,
        levelTimeframes,
        adjacentGapPct: gaps,
        totalSpanPct: totalSpanPct(prices),
        levelsBroken: 0,
        acceptedLevels: 0,
        touchCounts: zones.map((zone) => Math.max(1, Math.round(finite(zone.touchCount) ?? 1))),
        brokenLevelIds: [],
        brokenAt: [],
        acceptedLevelIds: [],
        barsBetweenLevels: [],
        levelBreakBars: [],
        variants: setupVariants(zones, gaps),
        setupFeatures: features,
        compressionType: features.primaryCompressionType,
        primaryTimeframe: primaryTf,
        timeframeDurationMs: timeframeDuration(allTimeframes),
        maxCascadeDurationMs: this.config.maxCascadeDurationMsByTimeframe[primaryTf]
          ?? this.config.maxCascadeDurationMsByTimeframe["1m"],
        firstBoundaryLower: finite(primary.lowerPrice),
        firstBoundaryUpper: finite(primary.upperPrice),
        highestProgressPrice: price,
        lowestProgressPrice: price,
        maximumInterLevelPullbackPct: 0,
        completionReason: null,
        confirmationBlockedByDataQuality: false,
        failureReasons: [],
        dataQuality: this.dataQuality,
        formulaVersion: SIGNAL_LAB_V4_CASCADE_FORMULA_VERSION,
        anchors: {
          setup: newAnchor(at, price, this.dataQuality),
          trigger: null,
          confirm: null,
          complete: null,
        },
      };
      this.events.set(id, event);
      this.history.push(event);
    } else if (event.state === CASCADE_STATES.SETUP) {
      event.lastSetupSeenAt = at;
      event.levelIds = zones.map((zone) => zone.id);
      event.levelPrices = prices;
      event.levelTimeframes = levelTimeframes;
      event.adjacentGapPct = gaps;
      event.totalSpanPct = totalSpanPct(prices);
      event.touchCounts = zones.map((zone) => Math.max(1, Math.round(finite(zone.touchCount) ?? 1)));
      event.variants = setupVariants(zones, gaps);
      event.setupFeatures = features;
      event.compressionType = features.primaryCompressionType;
      event.dataQuality = this.dataQuality;
    }
    return event;
  }

  #applyLevelEvents(levelMap, now) {
    const levelEvents = (Array.isArray(levelMap?.eventHistory) ? levelMap.eventHistory : [])
      .filter((event) => finite(event?.triggeredAt) !== null)
      .sort((left, right) => left.triggeredAt - right.triggeredAt || String(left.id).localeCompare(String(right.id)));
    for (const event of this.events.values()) {
      if (terminalState(event.state)) continue;
      const matched = [];
      let previousAt = event.setupDetectedAt;
      for (const levelId of event.levelIds) {
        const match = levelEvents.find((candidate) => (
          candidate.levelId === levelId
          && candidate.direction === event.direction
          && candidate.triggeredAt >= previousAt
          && candidate.triggeredAt - (event.triggeredAt ?? candidate.triggeredAt) <= event.maxCascadeDurationMs
        ));
        if (!match) break;
        matched.push(match);
        previousAt = match.triggeredAt;
      }
      if (!matched.length) continue;
      this.#applyMatchedBreaks(event, matched, now);
    }
  }

  #applyMatchedBreaks(event, matches, now) {
    for (let index = event.levelsBroken; index < matches.length; index += 1) {
      const levelEvent = matches[index];
      const triggeredAt = finite(levelEvent.triggeredAt);
      if (triggeredAt === null) continue;
      if (index > 0) {
        const previousAt = event.brokenAt[index - 1];
        const bars = Math.max(0, this.barIndex - (event.levelBreakBars[index - 1] ?? this.barIndex));
        const durationBars = Math.ceil((triggeredAt - previousAt) / Math.max(1, event.timeframeDurationMs));
        const effectiveBars = Math.max(bars, durationBars);
        event.barsBetweenLevels.push(effectiveBars);
        if (effectiveBars > this.config.maxBarsBetweenLevels) {
          if (event.levelsBroken === 1) this.#partial(event, triggeredAt, "MAX_BARS_BETWEEN_LEVELS");
          else this.#fail(event, triggeredAt, "MAX_BARS_BETWEEN_LEVELS");
          return;
        }
      }
      event.brokenLevelIds.push(levelEvent.levelId);
      event.brokenAt.push(triggeredAt);
      event.levelBreakBars.push(this.barIndex);
      event.levelsBroken += 1;
      if (finite(levelEvent.acceptedAt) !== null || levelEvent.state === "ACCEPTED") {
        event.acceptedLevelIds.push(levelEvent.levelId);
        event.acceptedLevels += 1;
      }
      event.dataQuality = normalizeQuality(levelEvent.dataQuality ?? event.dataQuality);

      if (event.levelsBroken === 1) {
        event.state = CASCADE_STATES.TRIGGERED;
        event.geometricState = CASCADE_GEOMETRIC_STATES.TRIGGERED;
        event.triggeredAt = triggeredAt;
        const price = finite(levelEvent.triggerPrice) ?? event.levelPrices[0];
        event.anchors.trigger = newAnchor(triggeredAt, price, event.dataQuality);
      } else if (event.levelsBroken === 2) {
        event.geometricState = CASCADE_GEOMETRIC_STATES.CONFIRMED;
        if (confirmationQuality(event.dataQuality)) {
          event.state = CASCADE_STATES.CONFIRMED;
          event.confirmedAt = triggeredAt;
          const price = finite(levelEvent.triggerPrice) ?? event.levelPrices[1];
          event.anchors.confirm = newAnchor(triggeredAt, price, event.dataQuality);
        } else {
          event.confirmationBlockedByDataQuality = true;
        }
      } else {
        event.geometricState = CASCADE_GEOMETRIC_STATES.EXTENDED;
        if (confirmationQuality(event.dataQuality)) {
          event.state = CASCADE_STATES.EXTENDED;
          event.confirmedAt ??= event.brokenAt[1];
          event.anchors.confirm ??= newAnchor(event.brokenAt[1], event.levelPrices[1], event.dataQuality);
        } else {
          event.confirmationBlockedByDataQuality = true;
        }
      }
      if (index === 1 && finite(matches[0]?.retestedAt) !== null && matches[0].retestedAt <= triggeredAt) {
        event.variants = [...new Set([...event.variants, "RETEST_FIRST_LEVEL"] )];
      }
    }

    if (event.levelsBroken >= event.levelIds.length) {
      event.completedAt = event.brokenAt.at(-1) ?? now;
      event.completionReason = "ALL_SETUP_LEVELS_BROKEN";
      const price = event.levelPrices[Math.max(0, event.levelsBroken - 1)];
      event.anchors.complete ??= newAnchor(event.completedAt, price, event.dataQuality);
    }
  }

  ingestPrice(price, at = Date.now(), {
    dataQuality = this.dataQuality,
    atr = this.atr,
    source = "TRADE",
  } = {}) {
    const value = finite(price);
    const timestamp = finite(at);
    if (!(value > 0) || timestamp === null) return this.snapshot();
    this.lastPrice = value;
    this.lastAt = timestamp;
    this.dataQuality = normalizeQuality(dataQuality);
    this.atr = finite(atr) ?? this.atr;
    for (const event of this.events.values()) {
      this.#updateOutcomes(event, value, timestamp, this.dataQuality);
      if (terminalState(event.state) || event.state === CASCADE_STATES.SETUP) continue;
      this.#updateProgress(event, value, timestamp, source);
    }
    this.#expire(timestamp);
    return this.snapshot();
  }

  ingestCandle(candle, options = {}) {
    const time = finite(options.availableAt) ?? finite(candle?.closeTime) ?? finite(candle?.time);
    const close = finite(candle?.close);
    if (time === null || !(close > 0)) return this.snapshot();
    if (this.lastCandleAt !== null && time <= this.lastCandleAt) return this.snapshot();
    this.lastCandleAt = time;
    this.barIndex += 1;
    return this.ingestPrice(close, time, { ...options, source: "CANDLE_CLOSE" });
  }

  #updateOutcomes(event, price, at, quality) {
    for (const anchor of Object.values(event.anchors)) {
      updateAnchor(anchor, event, price, at, quality, this.config.maxOutcomeGapMs);
    }
  }

  #updateProgress(event, price, at) {
    if (event.direction === "UP") {
      event.highestProgressPrice = Math.max(event.highestProgressPrice, price);
      const pullback = directionMovePct("DOWN", event.highestProgressPrice, price) ?? 0;
      event.maximumInterLevelPullbackPct = Math.max(event.maximumInterLevelPullbackPct, pullback);
    } else {
      event.lowestProgressPrice = Math.min(event.lowestProgressPrice, price);
      const pullback = directionMovePct("UP", event.lowestProgressPrice, price) ?? 0;
      event.maximumInterLevelPullbackPct = Math.max(event.maximumInterLevelPullbackPct, pullback);
    }

    const reference = event.direction === "UP" ? event.highestProgressPrice : event.lowestProgressPrice;
    const pctThreshold = this.config.maxInterLevelPullbackPct;
    const atrThreshold = this.atr > 0 && reference > 0
      ? this.atr * this.config.maxInterLevelPullbackAtr / reference * 100
      : 0;
    const pullbackThreshold = Math.max(pctThreshold, atrThreshold);
    if (event.levelsBroken < event.levelIds.length && event.maximumInterLevelPullbackPct > pullbackThreshold) {
      this.#fail(event, at, "INTER_LEVEL_PULLBACK");
      return;
    }

    const firstPrice = event.levelPrices[0];
    const pctTolerance = firstPrice * this.config.fullReturnTolerancePct / 100;
    const atrTolerance = Math.max(0, this.atr ?? 0) * this.config.fullReturnToleranceAtr;
    const tolerance = Math.max(pctTolerance, atrTolerance);
    const fullyReturned = event.direction === "UP"
      ? price < (event.firstBoundaryLower ?? firstPrice) - tolerance
      : price > (event.firstBoundaryUpper ?? firstPrice) + tolerance;
    if (fullyReturned) this.#fail(event, at, "RETURNED_BEHIND_FIRST_LEVEL");
  }

  #expire(now) {
    for (const event of this.events.values()) {
      if (terminalState(event.state)) continue;
      if (event.state === CASCADE_STATES.SETUP) continue;
      if (now - event.triggeredAt <= event.maxCascadeDurationMs) continue;
      if (event.levelsBroken === 1) {
        this.#partial(event, now, "SECOND_LEVEL_NOT_REACHED_IN_TIME");
      } else if (event.levelsBroken >= 2 && event.completedAt === null) {
        event.completedAt = event.brokenAt.at(-1) ?? now;
        event.completionReason = "CASCADE_WINDOW_CLOSED";
        const price = event.levelPrices[Math.max(0, event.levelsBroken - 1)];
        event.anchors.complete ??= newAnchor(event.completedAt, price, event.dataQuality);
      }
    }
  }

  #partial(event, at, reason) {
    if (terminalState(event.state)) return;
    event.state = CASCADE_STATES.PARTIAL;
    event.failedAt = at;
    event.failureReasons = [...new Set([...event.failureReasons, reason])];
    event.completionReason = reason;
  }

  #fail(event, at, reason) {
    if (terminalState(event.state)) return;
    event.state = CASCADE_STATES.FAILED;
    event.failedAt = at;
    event.failureReasons = [...new Set([...event.failureReasons, reason])];
    event.completionReason = reason;
  }

  snapshot() {
    const history = this.history.slice(-this.config.historyLimit);
    return Object.freeze({
      schemaVersion: 1,
      entity: "SignalLabCascadeMap",
      symbol: this.symbol,
      formulaVersion: SIGNAL_LAB_V4_CASCADE_FORMULA_VERSION,
      dataQuality: this.dataQuality,
      active: Object.freeze(history.filter((event) => !terminalState(event.state)).map(publicEvent)),
      history: Object.freeze(history.map(publicEvent)),
    });
  }
}

export class SignalLabV4CascadeRegistry {
  constructor({ config = {} } = {}) {
    this.config = config;
    this.engines = new Map();
  }

  engine(symbol) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return null;
    if (!this.engines.has(normalized)) {
      this.engines.set(normalized, new CascadeEngine({ symbol: normalized, config: this.config }));
    }
    return this.engines.get(normalized);
  }

  sync(symbol, levelMap, options = {}) {
    return this.engine(symbol)?.sync(levelMap, options) ?? null;
  }

  ingestPrice(symbol, price, at, options = {}) {
    return this.engine(symbol)?.ingestPrice(price, at, options) ?? null;
  }

  ingestCandle(symbol, candle, options = {}) {
    return this.engine(symbol)?.ingestCandle(candle, options) ?? null;
  }

  snapshot(symbol) {
    return this.engine(symbol)?.snapshot() ?? null;
  }

  watchScore(symbol, currentPrice) {
    const price = finite(currentPrice);
    if (!(price > 0)) return 0;
    let score = 0;
    for (const event of this.snapshot(symbol)?.active ?? []) {
      if (event.state !== CASCADE_STATES.SETUP) continue;
      const distance = finite(event.setupFeatures?.primaryDistancePct) ?? 10;
      score += (event.levelIds.length + event.touchCounts.reduce((sum, count) => sum + Math.max(0, count - 1), 0) * 0.5)
        / Math.max(0.05, distance);
    }
    return score;
  }
}
