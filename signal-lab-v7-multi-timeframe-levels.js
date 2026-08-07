export const STRUCTURAL_TF_ORDER = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);
export const STRUCTURAL_TF_DESCENT_ORDER = Object.freeze(["1d", "4h", "1h", "15m", "5m", "1m"]);

export const STRUCTURAL_TF_STRENGTH = Object.freeze({
  "1m": 1,
  "5m": 2,
  "15m": 3,
  "1h": 4,
  "4h": 5,
  "1d": 6,
});

export const STRUCTURAL_TF_INTERVAL_MS = Object.freeze({
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
});

export const STRUCTURAL_TF_LOOKBACK_MS = Object.freeze({
  "1m": 30 * 24 * 60 * 60_000,
  "5m": 30 * 24 * 60 * 60_000,
  "15m": 30 * 24 * 60 * 60_000,
  "1h": 180 * 24 * 60 * 60_000,
  "4h": 180 * 24 * 60 * 60_000,
  "1d": 180 * 24 * 60 * 60_000,
});

export const LOCAL_STRUCTURAL_LEVEL_HORIZON_MS = 30 * 24 * 60 * 60_000;

// V4.3 calibration: geometry creates a structural extreme first. Volatility
// only adapts scale. A stable base NATR normalizes cross-asset significance and
// distance; current NATR describes compression/expansion and may only RELAX a
// scale requirement during compression. It never makes a nearby level harder to
// keep merely because the spring is tightening. Numeric values remain reversible
// calibration defaults, not a trading formula.
export const ADAPTIVE_HIERARCHICAL_ADMISSION = Object.freeze({
  "1m": Object.freeze({
    fallbackMinimumSwingPercent: 0.30,
    reversalMultiplier: 1.00,
    natrSwingMultiplier: 1.00,
    freeDistanceNatr: 3,
    maxDistanceMultiplier: 4.0,
    minimumCompressionRelief: 0.60,
  }),
  "5m": Object.freeze({
    fallbackMinimumSwingPercent: 0.12,
    reversalMultiplier: 1.00,
    natrSwingMultiplier: 0.90,
    freeDistanceNatr: 4,
    maxDistanceMultiplier: 3.5,
    minimumCompressionRelief: 0.60,
  }),
  "15m": Object.freeze({
    fallbackMinimumSwingPercent: 0,
    reversalMultiplier: 1.00,
    natrSwingMultiplier: 0.80,
    freeDistanceNatr: 6,
    maxDistanceMultiplier: 3.0,
    minimumCompressionRelief: 0.65,
  }),
  "1h": Object.freeze({
    fallbackMinimumSwingPercent: 0,
    reversalMultiplier: 1.00,
    natrSwingMultiplier: 0.70,
    freeDistanceNatr: 8,
    maxDistanceMultiplier: 2.5,
    minimumCompressionRelief: 0.70,
  }),
});

// Backward-compatible export name used by existing Stage-1 tests/documentation.
export const LOCAL_HIERARCHICAL_ADMISSION = Object.freeze({
  "1m": Object.freeze({ minimumSwingPercent: 0.30, reversalMultiplier: 1.00 }),
  "5m": Object.freeze({ minimumSwingPercent: 0.12, reversalMultiplier: 1.00 }),
});

// V4.5 controls only the visible LOCAL working map. Detector/history stay complete.
// Macro levels belong to senior TFs, so an old single-touch 1m/5m level far from
// the current working area does not need to remain as another permanent ray.
export const LOCAL_WORKING_SET_POLICY = Object.freeze({
  "1m": Object.freeze({ maxDistanceBaseNatr: 4 }),
  "5m": Object.freeze({ maxDistanceBaseNatr: 6 }),
});

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function visibleSourceTimeframes(viewTimeframe) {
  const index = STRUCTURAL_TF_ORDER.indexOf(String(viewTimeframe));
  if (index < 0) return Object.freeze([]);
  return Object.freeze(STRUCTURAL_TF_ORDER.slice(index));
}

export function hierarchicalDescentTimeframes(viewTimeframe) {
  const index = STRUCTURAL_TF_DESCENT_ORDER.indexOf(String(viewTimeframe));
  if (index < 0) return Object.freeze([]);
  return Object.freeze(STRUCTURAL_TF_DESCENT_ORDER.slice(0, index + 1));
}

export function isLocalStructuralTimeframe(timeframe) {
  return timeframe === "1m" || timeframe === "5m";
}

export function isAdaptiveStructuralTimeframe(timeframe) {
  return Object.prototype.hasOwnProperty.call(ADAPTIVE_HIERARCHICAL_ADMISSION, timeframe);
}

export function structuralLevelVisibleAt({ sourceTimeframe, extremeAt, endAt }) {
  const origin = finite(extremeAt);
  const rangeEnd = finite(endAt);
  if (origin === null || rangeEnd === null) return false;
  if (!isLocalStructuralTimeframe(sourceTimeframe)) return true;
  return origin >= rangeEnd - LOCAL_STRUCTURAL_LEVEL_HORIZON_MS;
}

function validCandle(row) {
  const time = finite(row?.time);
  const high = finite(row?.high);
  const low = finite(row?.low);
  const close = finite(row?.close);
  if (time === null || !(high > 0) || !(low > 0) || !(close > 0) || high < low) return null;
  return { time, high, low, close };
}

function median(values) {
  const rows = (Array.isArray(values) ? values : [])
    .filter((value) => Number.isFinite(value) && value >= 0)
    .slice()
    .sort((left, right) => left - right);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2
    ? rows[middle]
    : (rows[middle - 1] + rows[middle]) / 2;
}

// V4.3 volatility context has two meanings:
// - baseNatrPct: stable recent regime used for scale/distance normalization;
// - currentNatrPct: current state used only to describe compression/expansion.
// Historical NATR at the extreme is still retained for diagnostics.
export function buildStructuralVolatilityContext(candles, { period = 14, baseWindow = 96 } = {}) {
  const rows = (Array.isArray(candles) ? candles : [])
    .map(validCandle)
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  if (!rows.length) {
    return Object.freeze({
      period,
      baseWindow,
      currentPrice: null,
      currentNatrPct: null,
      baseNatrPct: null,
      compressionRatio: null,
      volatilityState: "UNKNOWN",
      times: Object.freeze([]),
      natrs: Object.freeze([]),
    });
  }

  const safePeriod = Math.max(1, Math.round(finite(period) ?? 14));
  const safeBaseWindow = Math.max(safePeriod, Math.round(finite(baseWindow) ?? 96));
  const times = [];
  const natrs = [];
  let previousClose = null;
  let atr = null;
  let seedTotal = 0;
  let seedCount = 0;

  for (const row of rows) {
    const range = row.high - row.low;
    const trueRange = previousClose === null
      ? range
      : Math.max(range, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose));

    if (seedCount < safePeriod) {
      seedTotal += trueRange;
      seedCount += 1;
      atr = seedTotal / seedCount;
    } else {
      atr = ((atr * (safePeriod - 1)) + trueRange) / safePeriod;
    }

    times.push(row.time);
    natrs.push(atr > 0 ? (atr / row.close) * 100 : 0);
    previousClose = row.close;
  }

  const currentNatrPct = natrs.at(-1) ?? null;
  const baseNatrPct = median(natrs.slice(-safeBaseWindow));
  const compressionRatio = currentNatrPct !== null && baseNatrPct > 0
    ? currentNatrPct / baseNatrPct
    : null;
  const volatilityState = compressionRatio === null
    ? "UNKNOWN"
    : compressionRatio < 0.75
      ? "COMPRESSION"
      : compressionRatio > 1.35
        ? "EXPANSION"
        : "NORMAL";

  return Object.freeze({
    period: safePeriod,
    baseWindow: safeBaseWindow,
    currentPrice: rows.at(-1)?.close ?? null,
    currentNatrPct,
    baseNatrPct,
    compressionRatio,
    volatilityState,
    times: Object.freeze(times),
    natrs: Object.freeze(natrs),
  });
}

export function structuralNatrAt(volatilityContext, time) {
  const target = finite(time);
  const times = Array.isArray(volatilityContext?.times) ? volatilityContext.times : [];
  const natrs = Array.isArray(volatilityContext?.natrs) ? volatilityContext.natrs : [];
  if (target === null || !times.length || times.length !== natrs.length) return null;

  let left = 0;
  let right = times.length - 1;
  let answer = -1;
  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    if (times[middle] <= target) {
      answer = middle;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }
  return answer >= 0 ? finite(natrs[answer]) : null;
}

export function structuralDistanceNatr(price, volatilityContext) {
  const levelPrice = finite(price);
  const currentPrice = finite(volatilityContext?.currentPrice);
  const currentNatrPct = finite(volatilityContext?.currentNatrPct);
  if (!(levelPrice > 0) || !(currentPrice > 0) || !(currentNatrPct > 0)) return null;
  const distancePct = Math.abs(levelPrice - currentPrice) / currentPrice * 100;
  return distancePct / currentNatrPct;
}

export function structuralDistanceBaseNatr(price, volatilityContext) {
  const levelPrice = finite(price);
  const currentPrice = finite(volatilityContext?.currentPrice);
  const baseNatrPct = finite(volatilityContext?.baseNatrPct);
  if (!(levelPrice > 0) || !(currentPrice > 0) || !(baseNatrPct > 0)) return null;
  const distancePct = Math.abs(levelPrice - currentPrice) / currentPrice * 100;
  return distancePct / baseNatrPct;
}

function adaptiveDistanceMultiplier(policy, distanceNatr) {
  const distance = Math.max(0, finite(distanceNatr) ?? 0);
  const free = Math.max(0.1, finite(policy?.freeDistanceNatr) ?? 1);
  const maximum = Math.max(1, finite(policy?.maxDistanceMultiplier) ?? 1);
  if (distance <= free) return 1;
  return Math.min(maximum, 1 + ((distance - free) / free));
}

function compressionReliefFactor(policy, volatilityContext) {
  const ratio = finite(volatilityContext?.compressionRatio);
  if (!(ratio > 0) || ratio >= 1) return 1;
  const floor = Math.max(0.25, Math.min(1, finite(policy?.minimumCompressionRelief) ?? 0.60));
  return Math.max(floor, Math.min(1, ratio));
}

export function hierarchicalAdmissionRequiredPercent(extreme, sourceTimeframe, {
  volatilityContext = null,
} = {}) {
  const policy = ADAPTIVE_HIERARCHICAL_ADMISSION[sourceTimeframe];
  if (!policy) return 0;

  const reversalThreshold = Math.max(0, finite(extreme?.reversalThresholdPct) ?? 0);
  const fallbackMinimum = Math.max(0, finite(policy.fallbackMinimumSwingPercent) ?? 0);
  const reversalRequirement = reversalThreshold * Math.max(0, finite(policy.reversalMultiplier) ?? 0);
  const geometryRequirement = Math.max(fallbackMinimum, reversalRequirement);

  const baseNatrPct = finite(volatilityContext?.baseNatrPct);
  const natrAtExtreme = structuralNatrAt(volatilityContext, extreme?.extremeAt);
  const scaleNatrPct = baseNatrPct ?? natrAtExtreme;
  const distanceBaseNatr = structuralDistanceBaseNatr(extreme?.price, volatilityContext);
  const distanceMultiplier = adaptiveDistanceMultiplier(policy, distanceBaseNatr);
  const compressionRelief = compressionReliefFactor(policy, volatilityContext);
  const scaleRequirement = scaleNatrPct !== null && scaleNatrPct > 0
    ? scaleNatrPct
      * Math.max(0, finite(policy.natrSwingMultiplier) ?? 0)
      * distanceMultiplier
      * compressionRelief
    : 0;

  return Math.max(geometryRequirement, scaleRequirement);
}

export function structuralChildAdmissionDecision(extreme, sourceTimeframe, {
  volatilityContext = null,
} = {}) {
  if (!isAdaptiveStructuralTimeframe(sourceTimeframe)) {
    return Object.freeze({ admitted: true, reason: "SENIOR_TIMEFRAME" });
  }

  const swingPct = finite(extreme?.swingAmplitudePct);
  if (swingPct === null) {
    return Object.freeze({ admitted: true, reason: "MISSING_SWING_DIAGNOSTIC" });
  }

  const natrAtExtreme = structuralNatrAt(volatilityContext, extreme?.extremeAt);
  if (natrAtExtreme === null && !isLocalStructuralTimeframe(sourceTimeframe)) {
    return Object.freeze({
      admitted: true,
      reason: "NATR_UNAVAILABLE_KEEP_LEGACY",
      swingPct,
    });
  }

  const policy = ADAPTIVE_HIERARCHICAL_ADMISSION[sourceTimeframe];
  const currentNatrPct = finite(volatilityContext?.currentNatrPct);
  const baseNatrPct = finite(volatilityContext?.baseNatrPct);
  const compressionRatio = finite(volatilityContext?.compressionRatio);
  const volatilityState = volatilityContext?.volatilityState ?? "UNKNOWN";
  const currentDistanceNatr = structuralDistanceNatr(extreme?.price, volatilityContext);
  const distanceBaseNatr = structuralDistanceBaseNatr(extreme?.price, volatilityContext);
  const distanceMultiplier = adaptiveDistanceMultiplier(policy, distanceBaseNatr);
  const compressionRelief = compressionReliefFactor(policy, volatilityContext);
  const reversalThreshold = Math.max(0, finite(extreme?.reversalThresholdPct) ?? 0);
  const fallbackMinimum = Math.max(0, finite(policy.fallbackMinimumSwingPercent) ?? 0);
  const reversalRequirement = reversalThreshold * Math.max(0, finite(policy.reversalMultiplier) ?? 0);
  const geometryRequirement = Math.max(fallbackMinimum, reversalRequirement);
  const scaleNatrPct = baseNatrPct ?? natrAtExtreme;
  const scaleRequirement = scaleNatrPct !== null && scaleNatrPct > 0
    ? scaleNatrPct
      * Math.max(0, finite(policy.natrSwingMultiplier) ?? 0)
      * distanceMultiplier
      * compressionRelief
    : 0;
  const requiredSwingPct = Math.max(geometryRequirement, scaleRequirement);
  const normalizedSwing = natrAtExtreme !== null && natrAtExtreme > 0
    ? swingPct / natrAtExtreme
    : null;
  const baseNormalizedSwing = baseNatrPct !== null && baseNatrPct > 0
    ? swingPct / baseNatrPct
    : null;
  const admitted = swingPct >= requiredSwingPct;

  return Object.freeze({
    admitted,
    reason: admitted ? "GEOMETRY_SCALE_PASS" : "GEOMETRY_SCALE_FILTERED",
    swingPct,
    requiredSwingPct,
    geometryRequirement,
    scaleRequirement,
    geometryPassed: swingPct >= geometryRequirement,
    scalePassed: swingPct >= scaleRequirement,
    natrAtExtreme,
    normalizedSwing,
    baseNatrPct,
    baseNormalizedSwing,
    currentNatrPct,
    compressionRatio,
    volatilityState,
    compressionRelief,
    currentDistanceNatr,
    distanceBaseNatr,
    // Backward-compatible diagnostic name; V4.3 intentionally means BASE-NATR distance here.
    distanceNatr: distanceBaseNatr,
    distanceMultiplier,
  });
}

export function structuralChildLevelSignificant(extreme, sourceTimeframe, options = {}) {
  return structuralChildAdmissionDecision(extreme, sourceTimeframe, options).admitted;
}

// An old HIGH/LOW is structurally obsolete once the same timeframe has later
// confirmed a new same-side extreme beyond it. This deliberately does NOT use a
// one-tick pierce as a break: ambiguous PIERCED cases remain available for
// visual calibration, while obviously passed levels stop polluting the active map.
export function structuralExtremeSupersession(extreme, snapshot) {
  if (!extreme || !["HIGH", "LOW"].includes(extreme.side)) return null;
  const targetPrice = finite(extreme.price);
  const targetAt = finite(extreme.extremeAt);
  if (!(targetPrice > 0) || targetAt === null) return null;

  const history = Array.isArray(snapshot?.history) ? snapshot.history : [];
  let winner = null;
  for (const candidate of history) {
    if (!candidate || candidate.id === extreme.id || candidate.side !== extreme.side) continue;
    const candidateAt = finite(candidate.extremeAt);
    const candidatePrice = finite(candidate.price);
    if (candidateAt === null || candidateAt <= targetAt || !(candidatePrice > 0)) continue;
    const beyond = extreme.side === "HIGH"
      ? candidatePrice > targetPrice
      : candidatePrice < targetPrice;
    if (!beyond) continue;

    const confirmedAt = finite(candidate.confirmedAt) ?? candidateAt;
    if (!winner || confirmedAt < winner.at) {
      winner = Object.freeze({
        at: confirmedAt,
        extremeAt: candidateAt,
        price: candidatePrice,
        extremeId: candidate.id ?? null,
        side: candidate.side,
        reason: "STRUCTURAL_SUPERSESSION",
      });
    }
  }
  return winner;
}

export function normalizeStructuralLevel(extreme, sourceTimeframe, endAt, {
  supersededAt = null,
} = {}) {
  if (!extreme || !["HIGH", "LOW"].includes(extreme.side)) return null;
  const price = finite(extreme.price);
  const extremeAt = finite(extreme.extremeAt);
  const rangeEnd = finite(endAt);
  if (!(price > 0) || extremeAt === null || rangeEnd === null) return null;
  if (!structuralLevelVisibleAt({ sourceTimeframe, extremeAt, endAt: rangeEnd })) return null;

  const attackCount = Math.max(
    1,
    Math.round(finite(extreme.attackCount) ?? finite(extreme.touchCount) ?? 1),
  );
  const nativeCrossedAt = finite(extreme.crossedAt);
  const structuralSupersededAt = finite(supersededAt);
  const crossedAt = nativeCrossedAt ?? structuralSupersededAt;
  const active = extreme.active !== false && crossedAt === null;
  const structurallySuperseded = nativeCrossedAt === null && structuralSupersededAt !== null;
  return Object.freeze({
    id: extreme.id ?? `${sourceTimeframe}:${extreme.side}:${extremeAt}:${price}`,
    side: extreme.side,
    price,
    extremeAt,
    nativeExtremeAt: extremeAt,
    displayAt: extremeAt,
    sourceTimeframe,
    anchorTimeframe: sourceTimeframe,
    refinedThroughTimeframe: sourceTimeframe,
    refinementPath: Object.freeze([{ timeframe: sourceTimeframe, time: extremeAt }]),
    strength: STRUCTURAL_TF_STRENGTH[sourceTimeframe] ?? 0,
    attackCount,
    active,
    crossedAt,
    structurallySuperseded,
    inactiveReason: structurallySuperseded ? "STRUCTURAL_SUPERSESSION" : null,
    endAt: active ? rangeEnd : crossedAt ?? rangeEnd,
    status: structurallySuperseded
      ? "SUPERSEDED"
      : extreme.status ?? (active ? "ACTIVE" : "CROSSED"),
    swingAmplitudePct: finite(extreme.swingAmplitudePct),
    confirmingReversalPct: finite(extreme.confirmingReversalPct),
    reversalThresholdPct: finite(extreme.reversalThresholdPct),
  });
}

function levelTolerancePrice(price, tickSize, tolerancePct = 0.03, toleranceTicks = 3) {
  const tick = Math.max(0, finite(tickSize) ?? 0);
  const pct = Math.max(0, finite(tolerancePct) ?? 0.03);
  return Math.max(tick * Math.max(1, toleranceTicks), price * pct / 100);
}

function samePriceZone(left, right, options) {
  if (!left || !right || left.side !== right.side) return false;
  const anchor = Math.max(left.price, right.price);
  const tolerance = levelTolerancePrice(anchor, options.tickSize, options.tolerancePct, options.toleranceTicks);
  return Math.abs(left.price - right.price) <= tolerance;
}

function sameHierarchyZone(left, right, options) {
  if (!samePriceZone(left, right, options)) return false;
  if (left?.sourceTimeframe === right?.sourceTimeframe) return left?.id === right?.id;
  return true;
}

export function structuralHierarchyAcceptance(level, candles, {
  tickSize = 0,
  crossingToleranceTicks = 1,
  acceptanceBars = 2,
} = {}) {
  if (!level || !["HIGH", "LOW"].includes(level.side)) return null;
  const levelPrice = finite(level.price);
  const originAt = finite(level.nativeExtremeAt ?? level.extremeAt);
  if (!(levelPrice > 0) || originAt === null) return null;

  const tolerance = Math.max(0, finite(tickSize) ?? 0)
    * Math.max(0, Math.round(finite(crossingToleranceTicks) ?? 1));
  const requiredBars = Math.max(1, Math.round(finite(acceptanceBars) ?? 2));
  const rows = (Array.isArray(candles) ? candles : [])
    .filter((row) => finite(row?.time) !== null)
    .slice()
    .sort((left, right) => Number(left.time) - Number(right.time));
  let consecutive = 0;
  let firstBeyondAt = null;

  for (const candle of rows) {
    const time = finite(candle?.time);
    const closeTime = finite(candle?.closeTime) ?? time;
    const close = finite(candle?.close);
    if (time === null || time <= originAt || !(close > 0)) continue;
    const beyond = level.side === "HIGH"
      ? close > levelPrice + tolerance
      : close < levelPrice - tolerance;
    if (!beyond) {
      consecutive = 0;
      firstBeyondAt = null;
      continue;
    }
    if (consecutive === 0) firstBeyondAt = closeTime;
    consecutive += 1;
    if (consecutive >= requiredBars) {
      return Object.freeze({
        at: closeTime,
        firstBeyondAt,
        side: level.side,
        price: levelPrice,
        acceptanceBars: requiredBars,
        reason: "CHILD_TIMEFRAME_ACCEPTANCE",
      });
    }
  }
  return null;
}

function applyHierarchyAcceptance(levels, candles, sourceTimeframe, includeHistory, options) {
  const next = [];
  for (const level of Array.isArray(levels) ? levels : []) {
    if (level?.active === false) {
      next.push(level);
      continue;
    }
    const acceptance = structuralHierarchyAcceptance(level, candles, options);
    if (!acceptance) {
      next.push(level);
      continue;
    }
    if (!includeHistory) continue;
    next.push(Object.freeze({
      ...level,
      active: false,
      crossedAt: level.crossedAt ?? acceptance.at,
      endAt: acceptance.at,
      status: "ACCEPTED",
      inactiveReason: "CHILD_TIMEFRAME_ACCEPTANCE",
      acceptedOnTimeframe: sourceTimeframe,
    }));
  }
  return next;
}

// A senior level is no longer the active frontier when a later CONFIRMED child
// structural extreme exists beyond it. This is stronger evidence than a wick,
// but does not require two closes beyond the old price. It solves fast takeouts
// such as HFT where a new child swing high/low is confirmed after the old macro
// level has already been traversed.
export function structuralChildConfirmedTakeout(level, childSnapshot, childTimeframe, {
  tickSize = 0,
  toleranceTicks = 1,
} = {}) {
  if (!level || level.active === false || !["HIGH", "LOW"].includes(level.side)) return null;
  const levelPrice = finite(level.price);
  const originAt = finite(level.nativeExtremeAt ?? level.extremeAt);
  if (!(levelPrice > 0) || originAt === null) return null;

  const tolerance = Math.max(0, finite(tickSize) ?? 0)
    * Math.max(0, Math.round(finite(toleranceTicks) ?? 1));
  const history = Array.isArray(childSnapshot?.history) ? childSnapshot.history : [];
  let winner = null;

  for (const candidate of history) {
    if (!candidate || candidate.side !== level.side) continue;
    const extremeAt = finite(candidate.extremeAt);
    const confirmedAt = finite(candidate.confirmedAt) ?? extremeAt;
    const price = finite(candidate.price);
    if (extremeAt === null || confirmedAt === null || extremeAt <= originAt || !(price > 0)) continue;
    const beyond = level.side === "HIGH"
      ? price > levelPrice + tolerance
      : price < levelPrice - tolerance;
    if (!beyond) continue;
    if (!winner || confirmedAt < winner.at) {
      winner = Object.freeze({
        at: confirmedAt,
        extremeAt,
        price,
        side: level.side,
        childTimeframe,
        extremeId: candidate.id ?? null,
        reason: "CHILD_STRUCTURAL_TAKEOUT",
      });
    }
  }
  return winner;
}

function applyChildStructuralTakeout(levels, childSnapshot, childTimeframe, includeHistory, options) {
  const next = [];
  for (const level of Array.isArray(levels) ? levels : []) {
    if (level?.active === false) {
      next.push(level);
      continue;
    }
    const takeout = structuralChildConfirmedTakeout(level, childSnapshot, childTimeframe, options);
    if (!takeout) {
      next.push(level);
      continue;
    }
    if (!includeHistory) continue;
    next.push(Object.freeze({
      ...level,
      active: false,
      crossedAt: level.crossedAt ?? takeout.at,
      endAt: takeout.at,
      status: "TAKEN_OUT",
      inactiveReason: "CHILD_STRUCTURAL_TAKEOUT",
      takenOutOnTimeframe: childTimeframe,
      takenOutByExtremeId: takeout.extremeId,
    }));
  }
  return next;
}

export function structuralLocalWorkingSetVisible(level, volatilityContext) {
  const sourceTimeframe = level?.sourceTimeframe;
  const policy = LOCAL_WORKING_SET_POLICY[sourceTimeframe];
  if (!policy || level?.active === false) return true;

  const sources = Array.isArray(level?.sources) ? level.sources : [sourceTimeframe].filter(Boolean);
  if (sources.length > 1 || Number(level?.confluenceCount) > 1) return true;
  if ((Number(level?.attackCount) || 1) > 1) return true;

  const distanceBaseNatr = structuralDistanceBaseNatr(level?.price, volatilityContext);
  if (distanceBaseNatr === null) return true;

  // V4.6: a distant local-only single-touch swing is memory, not an eternal
  // working-map ray. If it is truly macro-important it must be represented by
  // a senior timeframe, confluence, or repeated attacks. Strong local swing
  // magnitude alone no longer bypasses the working-area radius.
  return distanceBaseNatr <= policy.maxDistanceBaseNatr;
}

function candleExtreme(candle, side) {
  return finite(side === "HIGH" ? candle?.high : candle?.low);
}

export function refineStructuralLevelToTimeframe(level, targetTimeframe, candles, {
  tickSize = 0,
  tolerancePct = 0.03,
  toleranceTicks = 3,
} = {}) {
  if (!level || !STRUCTURAL_TF_INTERVAL_MS[targetTimeframe]) return level ?? null;
  if ((STRUCTURAL_TF_STRENGTH[targetTimeframe] ?? 0) >= (level.strength ?? 0)) return level;
  const rows = Array.isArray(candles) ? candles : [];
  if (!rows.length) return level;

  const anchorTimeframe = level.anchorTimeframe ?? level.sourceTimeframe;
  const anchorInterval = STRUCTURAL_TF_INTERVAL_MS[anchorTimeframe];
  const anchorAt = finite(level.displayAt ?? level.extremeAt);
  if (!anchorInterval || anchorAt === null) return level;
  const bucketStart = Math.floor(anchorAt / anchorInterval) * anchorInterval;
  const bucketEnd = bucketStart + anchorInterval;
  const candidates = rows.filter((candle) => {
    const time = finite(candle?.time);
    return time !== null && time >= bucketStart && time < bucketEnd;
  });
  if (!candidates.length) return level;

  let best = null;
  for (const candle of candidates) {
    const price = candleExtreme(candle, level.side);
    const time = finite(candle?.time);
    if (!(price > 0) || time === null) continue;
    if (!best
      || (level.side === "HIGH" && price > best.price)
      || (level.side === "LOW" && price < best.price)) {
      best = { time, price };
    }
  }
  if (!best) return level;

  const tolerance = levelTolerancePrice(level.price, tickSize, tolerancePct, toleranceTicks);
  if (Math.abs(best.price - level.price) > tolerance) return level;

  const path = Array.isArray(level.refinementPath) ? [...level.refinementPath] : [];
  path.push({ timeframe: targetTimeframe, time: best.time });
  return Object.freeze({
    ...level,
    displayAt: best.time,
    anchorTimeframe: targetTimeframe,
    refinedThroughTimeframe: targetTimeframe,
    refinementPath: Object.freeze(path),
  });
}

export function clusterStructuralLevels(levels, {
  tickSize = 0,
  tolerancePct = 0.03,
  toleranceTicks = 3,
} = {}) {
  const ordered = (Array.isArray(levels) ? levels : [])
    .filter(Boolean)
    .slice()
    .sort((left, right) => {
      if (left.side !== right.side) return left.side.localeCompare(right.side);
      if (right.strength !== left.strength) return right.strength - left.strength;
      return left.price - right.price;
    });

  const clusters = [];
  for (const level of ordered) {
    let cluster = clusters.find((row) => sameHierarchyZone(row.primary, level, {
      tickSize,
      tolerancePct,
      toleranceTicks,
    }));
    if (!cluster) {
      cluster = { primary: level, members: [level] };
      clusters.push(cluster);
      continue;
    }
    cluster.members.push(level);
    if (level.strength > cluster.primary.strength) cluster.primary = level;
  }

  return Object.freeze(clusters.map((cluster) => {
    const members = cluster.members.slice().sort((left, right) => right.strength - left.strength);
    const sources = [...new Set(members.map((row) => row.sourceTimeframe))];
    const primary = members[0];
    return Object.freeze({
      ...primary,
      sources: Object.freeze(sources),
      confluenceCount: sources.length,
      memberIds: Object.freeze(members.map((row) => row.id)),
    });
  }));
}

export function formatStructuralLevelPrice(value) {
  const price = finite(value);
  if (!(price > 0)) return "—";
  const digits = price >= 1000 ? 2 : price >= 1 ? 4 : price >= 0.1 ? 5 : price >= 0.01 ? 6 : 8;
  return price.toFixed(digits).replace(/\.?0+$/, "");
}

export function structuralLevelLabel(level) {
  const side = level?.side === "HIGH" ? "H" : "L";
  const sources = Array.isArray(level?.sources) && level.sources.length
    ? level.sources
    : [level?.sourceTimeframe].filter(Boolean);
  const primary = sources[0] ?? "?";
  const confluence = sources.length > 1 ? ` + ${sources.slice(1).join("+")}` : "";
  const attacks = Math.max(1, Math.round(Number(level?.attackCount) || 1));
  const price = formatStructuralLevelPrice(level?.price);
  const inactiveLabel = level?.structurallySuperseded
    ? " · СНЯТ"
    : level?.active === false ? " · ПРОБИТ" : "";
  return `${side} ${primary}${confluence} · ×${attacks} · ${price}${inactiveLabel}`;
}

function sourceRows(snapshot, includeHistory) {
  if (!snapshot) return [];
  return Array.isArray(includeHistory ? snapshot.history : snapshot.active)
    ? (includeHistory ? snapshot.history : snapshot.active)
    : [];
}

function normalizedSourceLevels(snapshot, sourceTimeframe, endAt, includeHistory, predicate = null) {
  const levels = [];
  for (const extreme of sourceRows(snapshot, includeHistory)) {
    if (predicate && !predicate(extreme)) continue;
    const supersession = structuralExtremeSupersession(extreme, snapshot);
    if (supersession && !includeHistory) continue;
    const level = normalizeStructuralLevel(extreme, sourceTimeframe, endAt, {
      supersededAt: supersession?.at ?? null,
    });
    if (level) levels.push(level);
  }
  return levels;
}

export function buildStructuralLevelMap({
  snapshotsByTimeframe,
  viewTimeframe,
  endAt,
  includeHistory = false,
  tickSize = 0,
}) {
  const levels = [];
  for (const sourceTimeframe of visibleSourceTimeframes(viewTimeframe)) {
    const snapshot = snapshotsByTimeframe?.[sourceTimeframe];
    levels.push(...normalizedSourceLevels(snapshot, sourceTimeframe, endAt, includeHistory));
  }
  return clusterStructuralLevels(levels, { tickSize });
}

// Top-down map: 1d is established first. Each lower timeframe refines the exact
// candle of inherited levels while preserving native timeframe and price, then
// contributes only genuinely new structural children for its own scale.
export function buildHierarchicalStructuralLevelMap({
  snapshotsByTimeframe,
  candlesByTimeframe,
  viewTimeframe,
  endAt,
  includeHistory = false,
  tickSize = 0,
}) {
  const descent = hierarchicalDescentTimeframes(viewTimeframe);
  if (!descent.length) return Object.freeze([]);

  const volatilityByTimeframe = Object.fromEntries(descent.map((timeframe) => [
    timeframe,
    buildStructuralVolatilityContext(candlesByTimeframe?.[timeframe] ?? []),
  ]));

  let hierarchy = [];
  for (const sourceTimeframe of descent) {
    const childCandles = candlesByTimeframe?.[sourceTimeframe] ?? [];
    const snapshot = snapshotsByTimeframe?.[sourceTimeframe];
    const volatilityContext = volatilityByTimeframe[sourceTimeframe];

    if (hierarchy.length && snapshot) {
      hierarchy = applyChildStructuralTakeout(
        hierarchy,
        snapshot,
        sourceTimeframe,
        includeHistory,
        { tickSize, toleranceTicks: 1 },
      );
    }

    if (hierarchy.length && childCandles.length) {
      hierarchy = applyHierarchyAcceptance(
        hierarchy,
        childCandles,
        sourceTimeframe,
        includeHistory,
        { tickSize, crossingToleranceTicks: 1, acceptanceBars: 2 },
      );
    }

    if (hierarchy.length) {
      hierarchy = hierarchy.map((level) => refineStructuralLevelToTimeframe(
        level,
        sourceTimeframe,
        childCandles,
        { tickSize },
      ));
    }
    const nativeCandidates = normalizedSourceLevels(
      snapshot,
      sourceTimeframe,
      endAt,
      includeHistory,
      (extreme) => {
        const candidateLevel = normalizeStructuralLevel(extreme, sourceTimeframe, endAt);
        const confirmsInheritedLevel = candidateLevel && hierarchy.some((level) => sameHierarchyZone(
          level,
          candidateLevel,
          { tickSize, tolerancePct: 0.03, toleranceTicks: 3 },
        ));
        if (confirmsInheritedLevel) return true;
        return structuralChildLevelSignificant(extreme, sourceTimeframe, { volatilityContext });
      },
    );

    // A lower-TF level near an inherited stronger level is confluence/refinement,
    // not a new independent line. Clustering keeps the native label of the older
    // stronger timeframe.
    hierarchy = [...clusterStructuralLevels([...hierarchy, ...nativeCandidates], { tickSize })];
  }

  if (includeHistory) return Object.freeze(hierarchy);

  const workingHierarchy = hierarchy.filter((level) => structuralLocalWorkingSetVisible(
    level,
    volatilityByTimeframe[level?.sourceTimeframe],
  ));
  return Object.freeze(workingHierarchy);
}
