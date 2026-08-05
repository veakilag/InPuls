export const SIGNAL_LAB_V4_LEVEL_FORMULA_VERSION = "signal-lab-v4-levels-breakouts-v1-2026-08";

export const LEVEL_ZONE_STATES = Object.freeze({
  ACTIVE: "ACTIVE",
  BREAK_ATTEMPT: "BREAK_ATTEMPT",
  BROKEN_ACCEPTED: "BROKEN_ACCEPTED",
  SWEPT_RECLAIMED: "SWEPT_RECLAIMED",
  INACTIVE: "INACTIVE",
  EXPIRED: "EXPIRED",
});

export const BREAKOUT_EVENT_STATES = Object.freeze({
  SETUP: "SETUP",
  TRIGGERED: "TRIGGERED",
  ACCEPTED: "ACCEPTED",
  SWEPT_RECLAIMED: "SWEPT_RECLAIMED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
});

export const BREAKOUT_ACCEPTANCE_MODES = Object.freeze({
  CLOSE_CONFIRM: "CLOSE_CONFIRM",
  TIME_CONFIRM: "TIME_CONFIRM",
  DISTANCE_CONFIRM: "DISTANCE_CONFIRM",
  FLOW_CONFIRM: "FLOW_CONFIRM",
  HYBRID_CONFIRM: "HYBRID_CONFIRM",
});

export const DEFAULT_LEVEL_BREAKOUT_CONFIG = Object.freeze({
  mergeTicks: 4,
  mergePct: 0.08,
  mergeAtrFactor: 0.12,
  rearmTicks: 8,
  rearmPct: 0.12,
  rearmAtrFactor: 0.30,
  rearmBars: 2,
  rearmTimeMs: 15_000,
  nearLevelPct: 0.35,
  nearLevelAtrFactor: 0.75,
  minTimeNearLevelMs: 20_000,
  observationWindowMs: 15 * 60_000,
  acceptanceMode: BREAKOUT_ACCEPTANCE_MODES.HYBRID_CONFIRM,
  acceptanceTicks: 3,
  acceptancePct: 0.05,
  acceptanceAtrFactor: 0.10,
  acceptanceMs: 1_500,
  reclaimWindowMs: 12_000,
  retestWindowMs: 2 * 60_000,
  eventExpiryMs: 5 * 60_000,
  historyLimit: 1_000,
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

const normalizeTickSize = (value) => {
  const tickSize = finite(value);
  if (!(tickSize > 0)) throw new TypeError("tickSize must be a positive number");
  return tickSize;
};

const toTicks = (price, tickSize) => {
  const value = finite(price);
  if (!(value > 0)) throw new TypeError("price must be a positive number");
  return BigInt(Math.round(value / tickSize));
};

const toPrice = (ticks, tickSize) => Number(ticks) * tickSize;
const maxBigInt = (...values) => values.reduce((best, value) => value > best ? value : best);

function thresholdTicks({ priceTicks, tickSize, atr, ticks, pct, atrFactor }) {
  const price = toPrice(priceTicks, tickSize);
  const tickDistance = tickSize * Math.max(1, Math.round(finite(ticks) ?? 1));
  const pctDistance = price * Math.max(0, finite(pct) ?? 0) / 100;
  const atrDistance = Math.max(0, finite(atr) ?? 0) * Math.max(0, finite(atrFactor) ?? 0);
  return maxBigInt(1n, toTicks(Math.max(tickSize, tickDistance, pctDistance, atrDistance), tickSize));
}

function publicZone(zone, tickSize) {
  return Object.freeze({
    ...zone,
    lowerTicks: zone.lowerTicks.toString(),
    upperTicks: zone.upperTicks.toString(),
    lowerPrice: toPrice(zone.lowerTicks, tickSize),
    upperPrice: toPrice(zone.upperTicks, tickSize),
    referencePrice: toPrice(zone.referenceTicks, tickSize),
    attackTimes: Object.freeze([...zone.attackTimes]),
    extremeIds: Object.freeze([...zone.extremeIds]),
    timeframes: Object.freeze([...zone.timeframes]),
    sourcePoints: Object.freeze(zone.sourcePoints.map((row) => ({ ...row, priceTicks: row.priceTicks.toString() }))),
    setupFeatures: Object.freeze({ ...zone.setupFeatures }),
  });
}

function publicEvent(event, tickSize) {
  return Object.freeze({
    ...event,
    levelLowerTicks: event.levelLowerTicks.toString(),
    levelUpperTicks: event.levelUpperTicks.toString(),
    levelLowerPrice: toPrice(event.levelLowerTicks, tickSize),
    levelUpperPrice: toPrice(event.levelUpperTicks, tickSize),
    triggerPriceTicks: event.triggerPriceTicks?.toString?.() ?? null,
    triggerPrice: event.triggerPriceTicks ? toPrice(event.triggerPriceTicks, tickSize) : null,
    acceptancePriceTicks: event.acceptancePriceTicks?.toString?.() ?? null,
    acceptancePrice: event.acceptancePriceTicks ? toPrice(event.acceptancePriceTicks, tickSize) : null,
    acceptanceChecks: Object.freeze({ ...event.acceptanceChecks }),
  });
}

function activeExtremes(extremeMap) {
  const rows = [];
  for (const [timeframe, map] of Object.entries(extremeMap?.timeframes ?? {})) {
    for (const extreme of map?.active ?? []) {
      const price = finite(extreme?.price);
      if (!(price > 0) || !["HIGH", "LOW"].includes(extreme?.side) || !extreme?.id) continue;
      rows.push({
        id: String(extreme.id),
        side: extreme.side,
        timeframe,
        price,
        priceTicks: extreme.priceTicks,
        extremeTime: finite(extreme.extremeTime),
        confirmedAt: finite(extreme.confirmedAt),
        touchCount: Math.max(1, Math.round(finite(extreme.touchCount) ?? 1)),
      });
    }
  }
  return rows;
}

function isAcceptanceQuality(quality) {
  return quality === "LIVE" || quality === "RECOVERED";
}

export class LevelZoneEngine {
  constructor({ symbol, tickSize, config = {} }) {
    this.symbol = normalizeSymbol(symbol);
    if (!this.symbol) throw new TypeError("Unsupported symbol");
    this.tickSize = normalizeTickSize(tickSize);
    this.config = { ...DEFAULT_LEVEL_BREAKOUT_CONFIG, ...config };
    this.zones = new Map();
    this.extremeToZone = new Map();
    this.events = new Map();
    this.eventHistory = [];
    this.sequence = 0;
    this.lastPriceTicks = null;
    this.lastAt = null;
    this.barIndex = -1;
    this.dataQuality = "LIVE";
    this.atr = null;
  }

  syncExtremeMap(extremeMap, {
    atr = this.atr,
    currentPrice = null,
    at = Date.now(),
    dataQuality = this.dataQuality,
  } = {}) {
    this.atr = finite(atr) ?? this.atr;
    this.dataQuality = normalizeQuality(dataQuality);
    const rows = activeExtremes(extremeMap).map((row) => ({
      ...row,
      priceTicks: row.priceTicks !== undefined && row.priceTicks !== null
        ? BigInt(String(row.priceTicks))
        : toTicks(row.price, this.tickSize),
    }));
    const seenZoneIds = new Set();
    for (const side of ["HIGH", "LOW"]) {
      const sideRows = rows.filter((row) => row.side === side).sort((left, right) => (
        left.priceTicks < right.priceTicks ? -1 : left.priceTicks > right.priceTicks ? 1 : 0
      ));
      const clusters = [];
      for (const row of sideRows) {
        const previous = clusters.at(-1);
        if (!previous) {
          clusters.push([row]);
          continue;
        }
        const anchorTicks = previous.at(-1).priceTicks;
        const tolerance = thresholdTicks({
          priceTicks: anchorTicks,
          tickSize: this.tickSize,
          atr: this.atr,
          ticks: this.config.mergeTicks,
          pct: this.config.mergePct,
          atrFactor: this.config.mergeAtrFactor,
        });
        if (row.priceTicks - anchorTicks <= tolerance) previous.push(row);
        else clusters.push([row]);
      }
      for (const cluster of clusters) {
        const zone = this.#upsertCluster(side, cluster, at);
        seenZoneIds.add(zone.id);
      }
    }
    for (const zone of this.zones.values()) {
      if (seenZoneIds.has(zone.id)) continue;
      if (zone.active) {
        zone.active = false;
        if (zone.state === LEVEL_ZONE_STATES.ACTIVE) zone.state = LEVEL_ZONE_STATES.INACTIVE;
        zone.inactivatedAt = at;
      }
    }
    if (finite(currentPrice) > 0) this.ingestPrice(currentPrice, at, { atr: this.atr, dataQuality: this.dataQuality });
    return this.snapshot();
  }

  #upsertCluster(side, cluster, at) {
    const existingIds = [...new Set(cluster.map((row) => this.extremeToZone.get(row.id)).filter(Boolean))];
    let zone = existingIds.map((id) => this.zones.get(id)).filter(Boolean)
      .sort((left, right) => left.firstFormedAt - right.firstFormedAt)[0] ?? null;
    if (!zone) {
      const anchor = [...cluster].sort((left, right) => (
        (left.extremeTime ?? Infinity) - (right.extremeTime ?? Infinity)
        || left.id.localeCompare(right.id)
      ))[0];
      const id = `${this.symbol}:${side}:${anchor.id}:${SIGNAL_LAB_V4_LEVEL_FORMULA_VERSION}`;
      zone = {
        id,
        symbol: this.symbol,
        side,
        lowerTicks: cluster[0].priceTicks,
        upperTicks: cluster[0].priceTicks,
        referenceTicks: cluster[0].priceTicks,
        extremeIds: [],
        timeframes: [],
        sourcePoints: [],
        touchCount: 1,
        attackTimes: [],
        firstFormedAt: anchor.confirmedAt ?? anchor.extremeTime ?? at,
        lastTestedAt: anchor.extremeTime ?? at,
        active: true,
        state: LEVEL_ZONE_STATES.ACTIVE,
        armed: false,
        outsideBars: 0,
        outsideSince: null,
        lastContactAt: null,
        lastContactBarIndex: null,
        inactivatedAt: null,
        currentEventId: null,
        observations: [],
        setupFeatures: {},
        formulaVersion: SIGNAL_LAB_V4_LEVEL_FORMULA_VERSION,
        dataQuality: this.dataQuality,
      };
      this.zones.set(id, zone);
    }
    for (const redundantId of existingIds) {
      if (redundantId === zone.id) continue;
      const redundant = this.zones.get(redundantId);
      if (!redundant) continue;
      zone.touchCount = Math.max(zone.touchCount, redundant.touchCount);
      zone.attackTimes.push(...redundant.attackTimes);
      zone.observations.push(...redundant.observations);
      redundant.active = false;
      redundant.state = LEVEL_ZONE_STATES.INACTIVE;
      redundant.inactivatedAt = at;
      for (const extremeId of redundant.extremeIds) this.extremeToZone.set(extremeId, zone.id);
    }
    const allIds = new Set([...zone.extremeIds, ...cluster.map((row) => row.id)]);
    const points = new Map(zone.sourcePoints.map((row) => [row.id, row]));
    for (const row of cluster) {
      points.set(row.id, { ...row });
      this.extremeToZone.set(row.id, zone.id);
    }
    zone.extremeIds = [...allIds];
    zone.sourcePoints = [...points.values()].sort((left, right) => (
      (left.extremeTime ?? Infinity) - (right.extremeTime ?? Infinity)
    ));
    zone.timeframes = [...new Set(zone.sourcePoints.map((row) => row.timeframe))];
    zone.lowerTicks = zone.sourcePoints.reduce((best, row) => row.priceTicks < best ? row.priceTicks : best, zone.sourcePoints[0].priceTicks);
    zone.upperTicks = zone.sourcePoints.reduce((best, row) => row.priceTicks > best ? row.priceTicks : best, zone.sourcePoints[0].priceTicks);
    zone.referenceTicks = side === "HIGH" ? zone.upperTicks : zone.lowerTicks;
    const sourceTouches = Math.max(zone.sourcePoints.length, ...zone.sourcePoints.map((row) => row.touchCount ?? 1));
    zone.touchCount = Math.max(zone.touchCount, sourceTouches);
    const sourceAttackTimes = zone.sourcePoints.map((row) => row.extremeTime).filter(Number.isFinite);
    zone.attackTimes = [...new Set([...zone.attackTimes, ...sourceAttackTimes])].sort((a, b) => a - b);
    zone.lastTestedAt = Math.max(zone.lastTestedAt ?? 0, ...sourceAttackTimes, 0);
    zone.active = true;
    if (![LEVEL_ZONE_STATES.BREAK_ATTEMPT, LEVEL_ZONE_STATES.BROKEN_ACCEPTED, LEVEL_ZONE_STATES.SWEPT_RECLAIMED]
      .includes(zone.state)) zone.state = LEVEL_ZONE_STATES.ACTIVE;
    zone.dataQuality = this.dataQuality;
    this.#updateSetupFeatures(zone, at);
    return zone;
  }

  ingestPrice(price, at = Date.now(), {
    atr = this.atr,
    dataQuality = this.dataQuality,
    flowConfirmed = false,
    source = "TRADE",
  } = {}) {
    const value = finite(price);
    const timestamp = finite(at);
    if (!(value > 0) || timestamp === null) return this.snapshot();
    this.atr = finite(atr) ?? this.atr;
    this.dataQuality = normalizeQuality(dataQuality);
    this.lastPriceTicks = toTicks(value, this.tickSize);
    this.lastAt = timestamp;
    for (const zone of this.zones.values()) {
      if (!zone.active && !zone.currentEventId) continue;
      this.#observeZone(zone, this.lastPriceTicks, timestamp, { flowConfirmed, source });
    }
    this.#expireEvents(timestamp);
    return this.snapshot();
  }

  ingestCandle(candle, {
    availableAt = null,
    atr = this.atr,
    dataQuality = this.dataQuality,
    flowConfirmed = false,
  } = {}) {
    const high = finite(candle?.high);
    const low = finite(candle?.low);
    const close = finite(candle?.close);
    const time = finite(availableAt) ?? finite(candle?.closeTime) ?? finite(candle?.time);
    if (![high, low, close, time].every((value) => value !== null) || !(high > 0) || !(low > 0) || !(close > 0)) {
      return this.snapshot();
    }
    this.barIndex += 1;
    this.atr = finite(atr) ?? this.atr;
    this.dataQuality = normalizeQuality(dataQuality);
    const highTicks = toTicks(high, this.tickSize);
    const lowTicks = toTicks(low, this.tickSize);
    for (const zone of this.zones.values()) {
      if (!zone.active && !zone.currentEventId) continue;
      const attemptTicks = zone.side === "HIGH" ? highTicks : lowTicks;
      const crossed = zone.side === "HIGH" ? attemptTicks > zone.upperTicks : attemptTicks < zone.lowerTicks;
      if (crossed) this.#trigger(zone, attemptTicks, time, "CANDLE_RANGE");
      this.#observeContactAndRearm(zone, lowTicks, highTicks, time, this.barIndex);
      const closeTicks = toTicks(close, this.tickSize);
      this.#processEvent(zone, closeTicks, time, {
        flowConfirmed,
        source: "CANDLE_CLOSE",
        closeConfirmed: zone.side === "HIGH" ? closeTicks > zone.upperTicks : closeTicks < zone.lowerTicks,
      });
    }
    this.lastPriceTicks = toTicks(close, this.tickSize);
    this.lastAt = time;
    this.#expireEvents(time);
    return this.snapshot();
  }

  #observeZone(zone, priceTicks, at, context) {
    this.#observeContactAndRearm(zone, priceTicks, priceTicks, at, this.barIndex);
    const crossed = zone.side === "HIGH" ? priceTicks > zone.upperTicks : priceTicks < zone.lowerTicks;
    if (crossed) this.#trigger(zone, priceTicks, at, context.source);
    this.#processEvent(zone, priceTicks, at, context);
  }

  #observeContactAndRearm(zone, lowTicks, highTicks, at, barIndex) {
    const inZone = highTicks >= zone.lowerTicks && lowTicks <= zone.upperTicks;
    const boundary = zone.side === "HIGH" ? zone.lowerTicks : zone.upperTicks;
    const representative = zone.side === "HIGH" ? highTicks : lowTicks;
    const distanceTicks = representative >= boundary ? representative - boundary : boundary - representative;
    const nearTicks = thresholdTicks({
      priceTicks: zone.referenceTicks,
      tickSize: this.tickSize,
      atr: this.atr,
      ticks: this.config.mergeTicks,
      pct: this.config.nearLevelPct,
      atrFactor: this.config.nearLevelAtrFactor,
    });
    zone.observations.push({ at, near: distanceTicks <= nearTicks, inZone });
    const cutoff = at - Math.max(30_000, this.config.observationWindowMs);
    while (zone.observations.length && zone.observations[0].at < cutoff) zone.observations.shift();

    if (inZone) {
      if (zone.armed && (zone.lastContactBarIndex === null || barIndex > zone.lastContactBarIndex || at > zone.lastContactAt)) {
        zone.touchCount += 1;
        zone.attackTimes.push(at);
      }
      zone.lastContactAt = at;
      zone.lastContactBarIndex = barIndex;
      zone.lastTestedAt = at;
      zone.armed = false;
      zone.outsideBars = 0;
      zone.outsideSince = null;
      this.#updateSetupFeatures(zone, at);
      return;
    }

    const rearmDistance = thresholdTicks({
      priceTicks: zone.referenceTicks,
      tickSize: this.tickSize,
      atr: this.atr,
      ticks: this.config.rearmTicks,
      pct: this.config.rearmPct,
      atrFactor: this.config.rearmAtrFactor,
    });
    const movedAway = zone.side === "HIGH"
      ? highTicks < zone.lowerTicks - rearmDistance
      : lowTicks > zone.upperTicks + rearmDistance;
    zone.outsideBars += 1;
    zone.outsideSince ??= at;
    const enoughTime = at - zone.outsideSince >= this.config.rearmTimeMs;
    const enoughBars = zone.outsideBars >= Math.max(1, Math.round(this.config.rearmBars));
    if (movedAway || enoughTime || enoughBars) zone.armed = true;
    this.#updateSetupFeatures(zone, at);
  }

  #trigger(zone, priceTicks, at, source) {
    const current = zone.currentEventId ? this.events.get(zone.currentEventId) : null;
    if (current && [BREAKOUT_EVENT_STATES.TRIGGERED, BREAKOUT_EVENT_STATES.ACCEPTED].includes(current.state)) return current;
    const direction = zone.side === "HIGH" ? "UP" : "DOWN";
    const id = `${zone.id}:${at}:${++this.sequence}:${SIGNAL_LAB_V4_LEVEL_FORMULA_VERSION}`;
    const event = {
      id,
      symbol: this.symbol,
      direction,
      levelId: zone.id,
      setupDetectedAt: zone.firstFormedAt,
      triggeredAt: at,
      acceptedAt: null,
      reclaimedAt: null,
      retestedAt: null,
      continuedAt: null,
      expiredAt: null,
      state: BREAKOUT_EVENT_STATES.TRIGGERED,
      classification: this.#classifyTrigger(zone, source),
      levelLowerTicks: zone.lowerTicks,
      levelUpperTicks: zone.upperTicks,
      triggerPriceTicks: priceTicks,
      acceptancePriceTicks: null,
      beyondSince: at,
      acceptanceChecks: { close: false, time: false, distance: false, flow: false, hybrid: false },
      blockedByDataQuality: false,
      touchCount: zone.touchCount,
      timeframes: [...zone.timeframes],
      setupFeatures: { ...zone.setupFeatures },
      dataQuality: this.dataQuality,
      formulaVersion: SIGNAL_LAB_V4_LEVEL_FORMULA_VERSION,
    };
    this.events.set(id, event);
    this.eventHistory.push(event);
    zone.currentEventId = id;
    zone.state = LEVEL_ZONE_STATES.BREAK_ATTEMPT;
    return event;
  }

  #classifyTrigger(zone, source) {
    if (source === "GAP") return "GAP_BREAK";
    if (zone.touchCount >= 2) return "MULTI_TOUCH";
    if ((zone.setupFeatures?.nearLevelShare ?? 0) >= 0.6) return "COMPRESSION";
    return "IMPULSE";
  }

  #processEvent(zone, priceTicks, at, { flowConfirmed = false, closeConfirmed = false } = {}) {
    const event = zone.currentEventId ? this.events.get(zone.currentEventId) : null;
    if (!event || ![BREAKOUT_EVENT_STATES.TRIGGERED, BREAKOUT_EVENT_STATES.ACCEPTED].includes(event.state)) return;
    const beyond = event.direction === "UP" ? priceTicks > zone.upperTicks : priceTicks < zone.lowerTicks;
    const reclaimed = event.direction === "UP" ? priceTicks <= zone.upperTicks : priceTicks >= zone.lowerTicks;
    if (beyond) event.beyondSince ??= at;
    else event.beyondSince = null;

    const acceptanceDistance = thresholdTicks({
      priceTicks: zone.referenceTicks,
      tickSize: this.tickSize,
      atr: this.atr,
      ticks: this.config.acceptanceTicks,
      pct: this.config.acceptancePct,
      atrFactor: this.config.acceptanceAtrFactor,
    });
    const distance = event.direction === "UP" ? priceTicks - zone.upperTicks : zone.lowerTicks - priceTicks;
    event.acceptanceChecks.close ||= Boolean(closeConfirmed);
    event.acceptanceChecks.distance ||= beyond && distance >= acceptanceDistance;
    event.acceptanceChecks.time ||= beyond && event.beyondSince !== null && at - event.beyondSince >= this.config.acceptanceMs;
    event.acceptanceChecks.flow ||= beyond && Boolean(flowConfirmed);
    event.acceptanceChecks.hybrid = (
      event.acceptanceChecks.distance
      && (event.acceptanceChecks.time || event.acceptanceChecks.close || event.acceptanceChecks.flow)
    ) || (event.acceptanceChecks.close && event.acceptanceChecks.time);

    if (event.state === BREAKOUT_EVENT_STATES.TRIGGERED) {
      const modeToCheck = {
        [BREAKOUT_ACCEPTANCE_MODES.CLOSE_CONFIRM]: "close",
        [BREAKOUT_ACCEPTANCE_MODES.TIME_CONFIRM]: "time",
        [BREAKOUT_ACCEPTANCE_MODES.DISTANCE_CONFIRM]: "distance",
        [BREAKOUT_ACCEPTANCE_MODES.FLOW_CONFIRM]: "flow",
        [BREAKOUT_ACCEPTANCE_MODES.HYBRID_CONFIRM]: "hybrid",
      }[this.config.acceptanceMode] ?? "hybrid";
      if (event.acceptanceChecks[modeToCheck]) {
        if (isAcceptanceQuality(this.dataQuality)) {
          event.state = BREAKOUT_EVENT_STATES.ACCEPTED;
          event.acceptedAt = at;
          event.acceptancePriceTicks = priceTicks;
          event.dataQuality = this.dataQuality;
          zone.state = LEVEL_ZONE_STATES.BROKEN_ACCEPTED;
        } else {
          event.blockedByDataQuality = true;
          event.dataQuality = this.dataQuality;
        }
      } else if (reclaimed && at - event.triggeredAt <= this.config.reclaimWindowMs) {
        event.state = BREAKOUT_EVENT_STATES.SWEPT_RECLAIMED;
        event.reclaimedAt = at;
        event.classification = "SWEPT_RECLAIMED";
        zone.state = LEVEL_ZONE_STATES.SWEPT_RECLAIMED;
        zone.currentEventId = null;
        zone.active = true;
        zone.armed = false;
      }
      return;
    }

    if (event.state === BREAKOUT_EVENT_STATES.ACCEPTED) {
      const inZone = priceTicks >= zone.lowerTicks && priceTicks <= zone.upperTicks;
      if (!event.retestedAt && inZone && at - event.acceptedAt <= this.config.retestWindowMs) {
        event.retestedAt = at;
        event.classification = "RETEST";
      }
      if (event.retestedAt && beyond) event.continuedAt ??= at;
    }
  }

  #expireEvents(now) {
    for (const event of this.events.values()) {
      if (event.state !== BREAKOUT_EVENT_STATES.TRIGGERED) continue;
      if (now - event.triggeredAt <= this.config.eventExpiryMs) continue;
      event.state = BREAKOUT_EVENT_STATES.EXPIRED;
      event.expiredAt = now;
      const zone = this.zones.get(event.levelId);
      if (zone?.currentEventId === event.id) {
        zone.currentEventId = null;
        if (zone.active) zone.state = LEVEL_ZONE_STATES.ACTIVE;
      }
    }
  }

  #updateSetupFeatures(zone, now) {
    const observations = zone.observations;
    const nearCount = observations.filter((row) => row.near).length;
    const nearLevelShare = observations.length ? nearCount / observations.length : 0;
    let timeNearLevelMs = 0;
    for (let index = 1; index < observations.length; index += 1) {
      if (observations[index - 1].near) timeNearLevelMs += Math.max(0, observations[index].at - observations[index - 1].at);
    }
    let compressionType = "NO_COMPRESSION";
    if (nearLevelShare >= 0.65 && timeNearLevelMs >= this.config.minTimeNearLevelMs) compressionType = "FLAT_PRESSURE";
    else if (zone.touchCount >= 3) compressionType = "REPEATED_ATTACKS";
    else if (zone.touchCount >= 2) compressionType = "RANGE_EDGE_BUILDUP";
    zone.setupFeatures = {
      touchCount: zone.touchCount,
      sourceExtremeCount: zone.extremeIds.length,
      multiTimeframeCount: zone.timeframes.length,
      nearLevelShare,
      timeNearLevelMs,
      observations: observations.length,
      compressionType,
      ageMs: Math.max(0, now - zone.firstFormedAt),
    };
  }

  snapshot() {
    const zones = [...this.zones.values()];
    const events = this.eventHistory.slice(-this.config.historyLimit);
    return Object.freeze({
      schemaVersion: 1,
      entity: "SignalLabLevelBreakoutMap",
      symbol: this.symbol,
      tickSize: this.tickSize,
      formulaVersion: SIGNAL_LAB_V4_LEVEL_FORMULA_VERSION,
      dataQuality: this.dataQuality,
      activeZones: Object.freeze(zones.filter((row) => row.active).map((row) => publicZone(row, this.tickSize))),
      zoneHistory: Object.freeze(zones.slice(-this.config.historyLimit).map((row) => publicZone(row, this.tickSize))),
      activeEvents: Object.freeze(events.filter((row) => [BREAKOUT_EVENT_STATES.TRIGGERED, BREAKOUT_EVENT_STATES.ACCEPTED].includes(row.state)).map((row) => publicEvent(row, this.tickSize))),
      eventHistory: Object.freeze(events.map((row) => publicEvent(row, this.tickSize))),
    });
  }
}

export class SignalLabV4LevelBreakoutRegistry {
  constructor({ config = {} } = {}) {
    this.config = config;
    this.engines = new Map();
    this.tickSizes = new Map();
  }

  setTickSize(symbol, tickSize) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return;
    this.tickSizes.set(normalized, normalizeTickSize(tickSize));
  }

  engine(symbol, tickSize = this.tickSizes.get(normalizeSymbol(symbol))) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized || !(tickSize > 0)) return null;
    if (!this.engines.has(normalized)) {
      this.engines.set(normalized, new LevelZoneEngine({ symbol: normalized, tickSize, config: this.config }));
    }
    return this.engines.get(normalized);
  }

  sync(symbol, extremeMap, options = {}) {
    return this.engine(symbol, options.tickSize)?.syncExtremeMap(extremeMap, options) ?? null;
  }

  ingestPrice(symbol, price, at, options = {}) {
    return this.engine(symbol, options.tickSize)?.ingestPrice(price, at, options) ?? null;
  }

  ingestCandle(symbol, candle, options = {}) {
    return this.engine(symbol, options.tickSize)?.ingestCandle(candle, options) ?? null;
  }

  snapshot(symbol) {
    return this.engines.get(normalizeSymbol(symbol))?.snapshot() ?? null;
  }

  watchScore(symbol, currentPrice) {
    const price = finite(currentPrice);
    if (!(price > 0)) return 0;
    const snapshot = this.snapshot(symbol);
    let score = 0;
    for (const zone of snapshot?.activeZones ?? []) {
      const boundary = zone.side === "HIGH" ? zone.upperPrice : zone.lowerPrice;
      const distance = Math.abs(boundary - price) / price * 100;
      if (distance > 5) continue;
      score += (1 + Math.max(0, zone.touchCount - 1) * 0.6 + Math.max(0, zone.timeframes.length - 1) * 0.35)
        / Math.max(0.05, distance);
    }
    return score;
  }
}
