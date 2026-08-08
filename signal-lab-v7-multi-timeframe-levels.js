export const STRUCTURAL_TF_ORDER = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);
export const STRUCTURAL_TF_DESCENT_ORDER = Object.freeze(["1d", "4h", "1h", "15m", "5m", "1m"]);

// V5.2 product contract: 1m remains a chart/micro-context timeframe only.
// Persistent structural levels and future pattern formation start at 5m.
// Keep the legacy six-TF constants above for engine/backward compatibility,
// but hierarchy source selection must never admit native 1m extrema.
export const STRUCTURAL_PERSISTENT_TF_ORDER = Object.freeze(["5m", "15m", "1h", "4h", "1d"]);
export const STRUCTURAL_PERSISTENT_TF_DESCENT_ORDER = Object.freeze(["1d", "4h", "1h", "15m", "5m"]);

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
  "1m": Object.freeze({
    maxDistanceBaseNatr: 4,
    // V4.17: a single-touch native 1m pivot at the right edge is still an
    // unresolved micro turn. Keep it in event/history memory, but do not draw
    // it on the working map until two later 1m candles are fully available.
    minimumRightBars: 2,
    // V4.22: a weaker same-side native 1m pivot formed within two bars of a
    // more extreme already-visible pivot, with no visible opposite pivot in
    // between, is a shadow duplicate rather than a new working-map level.
    sameSideShadowBars: 2,
  }),
  "5m": Object.freeze({ maxDistanceBaseNatr: 6 }),
});

// V5.0: trader-reviewed BICO 1m/5m showed that a smooth directional leg can
// generate many technically valid swing pivots that are not independently tradable
// liquidity levels. Keep detector/history recall-first, but require a continuation-
// side higher LOW / lower HIGH to reset a meaningful part of the preceding leg
// before it is promoted to the working map. This is structural geometry, not a
// price-prediction score. Repeated attacks and multi-TF confluence bypass it.
export const LOCAL_TRADABLE_STRUCTURE_POLICY = Object.freeze({
  "1m": Object.freeze({ minimumLegResetRatio: 0.30 }),
  "5m": Object.freeze({ minimumLegResetRatio: 0.30 }),
});

// V4.7 calibration: trader review on BTC 5m showed that two shallow pauses
// inside one rising impulse were incorrectly promoted to fresh LOW levels while
// deeper swing bases were the intended structure. Keep event generation recall-
// first, but require a local LOW to have a meaningful incoming down-leg and an
// outgoing rebound before it enters the hierarchy. HIGH is deliberately not
// gated yet: the current BTC compression/high sequence is already visually
// correct and must not be regressed until we have an explicit HIGH review set.
export const LOCAL_PIVOT_PROMINENCE_POLICY = Object.freeze({
  "1m": Object.freeze({
    lookbackBars: 8,
    structureLookbackBars: 60,
    minimumIncomingBaseNatr: 0.75,
    minimumOutgoingBaseNatr: 0.60,
    minimumPriorImpulseBaseNatr: 1.25,
    minimumRetracementRatio: 0.15,
  }),
  "5m": Object.freeze({
    lookbackBars: 6,
    structureLookbackBars: 24,
    minimumIncomingBaseNatr: 0.75,
    minimumOutgoingBaseNatr: 0.60,
    minimumPriorImpulseBaseNatr: 1.25,
    // V4.11 visual calibration on BTC 5m: two trader-rejected pauses
    // measured 23.7% and 25.5% retracement, while reviewed structural LOWs
    // were either not applicable to this gate or measured 127% / 674%.
    // Keep the rule causal and apply it only when a valid prior impulse exists.
    minimumRetracementRatio: 0.30,
    // V4.13 HIGH calibration from the same fixed BTC review window. The single
    // trader-rejected edge HIGH had only 2.19 base-NATR of incoming rise, while
    // retained local HIGHs measured 3.82N, 5.56N, 6.78N and 7.77N. Apply this
    // only post-cluster in the local working map; senior confluence and x2+
    // attacks bypass it before this decision is evaluated.
    minimumHighIncomingBaseNatr: 3.00,
    // V4.15: a single 5m HIGH also needs a meaningful causal confirmation
    // reversal relative to the stable regime scale. This rejects edge/current
    // highs that are confirmed by the tiny recall-first detector threshold on
    // volatile alts, without using candles after confirmedAt.
    minimumHighConfirmingReversalBaseNatr: 0.60,
  }),
});

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function visibleSourceTimeframes(viewTimeframe) {
  const view = String(viewTimeframe);
  if (view === "1m") return Object.freeze([...STRUCTURAL_PERSISTENT_TF_ORDER]);
  const index = STRUCTURAL_PERSISTENT_TF_ORDER.indexOf(view);
  if (index < 0) return Object.freeze([]);
  return Object.freeze(STRUCTURAL_PERSISTENT_TF_ORDER.slice(index));
}

export function hierarchicalDescentTimeframes(viewTimeframe) {
  const view = String(viewTimeframe);
  if (view === "1m") return Object.freeze([...STRUCTURAL_PERSISTENT_TF_DESCENT_ORDER]);
  const index = STRUCTURAL_PERSISTENT_TF_DESCENT_ORDER.indexOf(view);
  if (index < 0) return Object.freeze([]);
  return Object.freeze(STRUCTURAL_PERSISTENT_TF_DESCENT_ORDER.slice(0, index + 1));
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

function structuralPercentMove(from, to) {
  const start = finite(from);
  const end = finite(to);
  if (!(start > 0) || !(end > 0)) return null;
  return Math.abs(end - start) / start * 100;
}

// Causal prominence check for local LOW calibration. Only candles available by
// confirmedAt are used on the right side of the pivot; no later future candles
// participate. A shallow pause inside a rising leg therefore fails on the weak
// incoming down-leg even if price later accelerates upward.
export function structuralLocalPivotProminenceDecision(
  extreme,
  sourceTimeframe,
  candles,
  volatilityContext,
) {
  const policy = LOCAL_PIVOT_PROMINENCE_POLICY[sourceTimeframe];
  if (!policy || !["LOW", "HIGH"].includes(extreme?.side)) {
    return Object.freeze({ admitted: true, reason: "PROMINENCE_NOT_APPLICABLE" });
  }
  const isHigh = extreme?.side === "HIGH";

  const pivotAt = finite(extreme?.extremeAt);
  const confirmedAt = finite(extreme?.confirmedAt);
  const pivotPrice = finite(extreme?.price);
  if (pivotAt === null || !(pivotPrice > 0)) {
    return Object.freeze({ admitted: true, reason: isHigh ? "HIGH_CALIBRATION_BYPASS" : "PROMINENCE_MISSING_EXTREME_DATA" });
  }

  const rows = (Array.isArray(candles) ? candles : [])
    .map(validCandle)
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  const pivotIndex = rows.findIndex((row) => row.time === pivotAt);
  if (pivotIndex < 0) {
    return Object.freeze({ admitted: true, reason: isHigh ? "HIGH_CALIBRATION_BYPASS" : "PROMINENCE_PIVOT_CANDLE_UNAVAILABLE" });
  }

  const lookbackBars = Math.max(2, Math.round(finite(policy.lookbackBars) ?? 6));
  const before = rows.slice(Math.max(0, pivotIndex - lookbackBars), pivotIndex);
  const after = rows
    .slice(pivotIndex + 1)
    .filter((row) => confirmedAt === null || row.time <= confirmedAt);
  if (!before.length || !after.length) {
    return Object.freeze({ admitted: true, reason: isHigh ? "HIGH_CALIBRATION_BYPASS" : "PROMINENCE_CONTEXT_INCOMPLETE" });
  }

  // V4.12: HIGH remains calibration-bypassed, but calculate its causal
  // prominence diagnostics symmetrically so trader review can distinguish a
  // meaningful rejection from a tiny edge/current-price peak without changing
  // visible behavior yet.
  const incomingReference = isHigh
    ? Math.min(...before.map((row) => row.low))
    : Math.max(...before.map((row) => row.high));
  const outgoingReference = isHigh
    ? Math.min(...after.map((row) => row.low))
    : Math.max(...after.map((row) => row.high));
  const incomingPct = structuralPercentMove(incomingReference, pivotPrice);
  const outgoingPct = structuralPercentMove(pivotPrice, outgoingReference);
  const natrAtExtreme = structuralNatrAt(volatilityContext, pivotAt);
  const baseNatrPct = finite(volatilityContext?.baseNatrPct) ?? natrAtExtreme;
  if (!(baseNatrPct > 0) || incomingPct === null || outgoingPct === null) {
    return Object.freeze({ admitted: true, reason: isHigh ? "HIGH_CALIBRATION_BYPASS" : "PROMINENCE_SCALE_UNAVAILABLE" });
  }

  const incomingBaseNatr = incomingPct / baseNatrPct;
  const outgoingBaseNatr = outgoingPct / baseNatrPct;
  const minimumIncomingBaseNatr = Math.max(0, finite(policy.minimumIncomingBaseNatr) ?? 0.75);
  const minimumOutgoingBaseNatr = Math.max(0, finite(policy.minimumOutgoingBaseNatr) ?? 0.60);
  const incomingPassed = incomingBaseNatr >= minimumIncomingBaseNatr;
  const outgoingPassed = outgoingBaseNatr >= minimumOutgoingBaseNatr;

  if (isHigh) {
    return Object.freeze({
      admitted: true,
      reason: "HIGH_CALIBRATION_BYPASS",
      incomingPct,
      outgoingPct,
      baseNatrPct,
      incomingBaseNatr,
      outgoingBaseNatr,
      minimumIncomingBaseNatr,
      minimumOutgoingBaseNatr,
      incomingPassed,
      outgoingPassed,
      lookbackBars,
      pivotAt,
      confirmedAt,
    });
  }

  // V4.8: absolute NATR prominence is not enough. During a strong rising leg a
  // tiny pause can still be > 0.75 NATR and therefore look "large" in isolation.
  // Measure the pullback against the whole causal impulse that preceded the LOW.
  // A shallow retracement inside that same impulse stays event-memory, not a new
  // structural support ray. Compression HIGHs are untouched by this LOW-only gate.
  const structureLookbackBars = Math.max(
    lookbackBars + 2,
    Math.round(finite(policy.structureLookbackBars) ?? lookbackBars * 3),
  );
  const structuralBefore = rows.slice(Math.max(0, pivotIndex - structureLookbackBars), pivotIndex);
  let priorImpulsePeakIndex = -1;
  let priorImpulsePeak = null;
  for (let index = 0; index < structuralBefore.length; index += 1) {
    const high = finite(structuralBefore[index]?.high);
    if (!(high > 0)) continue;
    if (priorImpulsePeak === null || high >= priorImpulsePeak) {
      priorImpulsePeak = high;
      priorImpulsePeakIndex = index;
    }
  }

  let priorImpulseOriginLow = null;
  if (priorImpulsePeakIndex > 0) {
    for (const row of structuralBefore.slice(0, priorImpulsePeakIndex + 1)) {
      const low = finite(row?.low);
      if (!(low > 0)) continue;
      if (priorImpulseOriginLow === null || low < priorImpulseOriginLow) priorImpulseOriginLow = low;
    }
  }

  const priorImpulsePct = priorImpulsePeak !== null && priorImpulseOriginLow !== null
    ? structuralPercentMove(priorImpulseOriginLow, priorImpulsePeak)
    : null;
  const priorImpulseBaseNatr = priorImpulsePct !== null ? priorImpulsePct / baseNatrPct : null;
  const retracementRatio = priorImpulsePeak !== null
    && priorImpulseOriginLow !== null
    && priorImpulsePeak > priorImpulseOriginLow
    ? Math.max(0, priorImpulsePeak - pivotPrice) / (priorImpulsePeak - priorImpulseOriginLow)
    : null;
  const minimumPriorImpulseBaseNatr = Math.max(
    0,
    finite(policy.minimumPriorImpulseBaseNatr) ?? 1.25,
  );
  const minimumRetracementRatio = Math.max(
    0,
    Math.min(1, finite(policy.minimumRetracementRatio) ?? 0.20),
  );
  const retracementApplicable = priorImpulseBaseNatr !== null
    && priorImpulseBaseNatr >= minimumPriorImpulseBaseNatr
    && retracementRatio !== null;
  const retracementPassed = !retracementApplicable || retracementRatio >= minimumRetracementRatio;
  const admitted = incomingPassed && outgoingPassed && retracementPassed;

  return Object.freeze({
    admitted,
    reason: admitted
      ? "LOW_PIVOT_PROMINENCE_PASS"
      : !retracementPassed
        ? "LOW_PIVOT_SHALLOW_RETRACEMENT_FILTERED"
        : "LOW_PIVOT_PROMINENCE_FILTERED",
    incomingPct,
    outgoingPct,
    baseNatrPct,
    incomingBaseNatr,
    outgoingBaseNatr,
    minimumIncomingBaseNatr,
    minimumOutgoingBaseNatr,
    incomingPassed,
    outgoingPassed,
    lookbackBars,
    structureLookbackBars,
    priorImpulsePeak,
    priorImpulseOriginLow,
    priorImpulsePct,
    priorImpulseBaseNatr,
    minimumPriorImpulseBaseNatr,
    retracementRatio,
    minimumRetracementRatio,
    retracementApplicable,
    retracementPassed,
    pivotAt,
    confirmedAt,
  });
}

export function structuralLocalWorkingSetPivotDecision(level, candles, volatilityContext) {
  const sourceTimeframe = level?.sourceTimeframe;
  const policy = LOCAL_PIVOT_PROMINENCE_POLICY[sourceTimeframe];
  if (!policy || !["LOW", "HIGH"].includes(level?.side)) {
    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_NOT_APPLICABLE" });
  }

  const pivotAt = finite(level?.nativeExtremeAt ?? level?.extremeAt);
  const pivotPrice = finite(level?.price);
  if (pivotAt === null || !(pivotPrice > 0)) {
    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_MISSING_LEVEL_DATA" });
  }

  const rows = (Array.isArray(candles) ? candles : [])
    .map(validCandle)
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  const pivotIndex = rows.findIndex((row) => row.time === pivotAt);
  if (pivotIndex < 0) {
    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_CANDLE_UNAVAILABLE" });
  }

  // V4.13: HIGH uses only causal incoming-leg prominence in the post-cluster
  // working map. Do not mirror the LOW retracement formula: the BTC review
  // showed outgoing rejection does not separate the edge HIGH, while incoming
  // rise does. 1m remains unchanged until it has its own reviewed sample.
  if (level?.side === "HIGH") {
    const minimumHighIncomingBaseNatr = Math.max(
      0,
      finite(policy.minimumHighIncomingBaseNatr) ?? 0,
    );
    if (!(minimumHighIncomingBaseNatr > 0)) {
      return Object.freeze({ visible: true, reason: "HIGH_WORKING_PIVOT_NOT_CALIBRATED" });
    }
    const lookbackBars = Math.max(2, Math.round(finite(policy.lookbackBars) ?? 6));
    const before = rows.slice(Math.max(0, pivotIndex - lookbackBars), pivotIndex);
    const baseNatrPct = finite(volatilityContext?.baseNatrPct);
    if (!before.length || !(baseNatrPct > 0)) {
      return Object.freeze({ visible: true, reason: "HIGH_WORKING_PIVOT_CONTEXT_INCOMPLETE" });
    }
    const incomingReference = Math.min(...before.map((row) => row.low));
    const incomingPct = structuralPercentMove(incomingReference, pivotPrice);
    const incomingBaseNatr = incomingPct !== null ? incomingPct / baseNatrPct : null;
    if (incomingBaseNatr === null) {
      return Object.freeze({ visible: true, reason: "HIGH_WORKING_PIVOT_SCALE_UNAVAILABLE" });
    }
    const minimumHighConfirmingReversalBaseNatr = Math.max(
      0,
      finite(policy.minimumHighConfirmingReversalBaseNatr) ?? 0,
    );
    const confirmingReversalPct = finite(level?.confirmingReversalPct);
    const confirmingReversalBaseNatr = confirmingReversalPct !== null
      ? confirmingReversalPct / baseNatrPct
      : null;
    const incomingPassed = incomingBaseNatr >= minimumHighIncomingBaseNatr;
    // Missing confirmation diagnostics keep legacy visibility. Normalized live
    // detector levels carry confirmingReversalPct, so calibrated review/runtime
    // levels are evaluated without inventing future candles.
    const confirmingReversalPassed = !(minimumHighConfirmingReversalBaseNatr > 0)
      || confirmingReversalBaseNatr === null
      || confirmingReversalBaseNatr >= minimumHighConfirmingReversalBaseNatr;
    const visible = incomingPassed && confirmingReversalPassed;
    return Object.freeze({
      visible,
      reason: visible
        ? "HIGH_WORKING_PIVOT_PASS"
        : !incomingPassed
          ? "HIGH_WORKING_PIVOT_WEAK_INCOMING_FILTERED"
          : "HIGH_WORKING_PIVOT_WEAK_CONFIRMING_REVERSAL_FILTERED",
      pivotAt,
      pivotPrice,
      baseNatrPct,
      incomingReference,
      incomingPct,
      incomingBaseNatr,
      minimumHighIncomingBaseNatr,
      incomingPassed,
      confirmingReversalPct,
      confirmingReversalBaseNatr,
      minimumHighConfirmingReversalBaseNatr,
      confirmingReversalPassed,
      lookbackBars,
    });
  }

  const structureLookbackBars = Math.max(
    3,
    Math.round(finite(policy.structureLookbackBars) ?? 24),
  );
  const structuralBefore = rows.slice(Math.max(0, pivotIndex - structureLookbackBars), pivotIndex);
  if (structuralBefore.length < 3) {
    return Object.freeze({ visible: true, reason: "WORKING_PIVOT_CONTEXT_INCOMPLETE" });
  }

  let peakIndex = -1;
  let peakPrice = null;
  for (let index = 0; index < structuralBefore.length; index += 1) {
    const high = finite(structuralBefore[index]?.high);
    if (!(high > 0)) continue;
    if (peakPrice === null || high >= peakPrice) {
      peakPrice = high;
      peakIndex = index;
    }
  }

  let originLow = null;
  if (peakIndex > 0) {
    for (const row of structuralBefore.slice(0, peakIndex + 1)) {
      const low = finite(row?.low);
      if (!(low > 0)) continue;
      if (originLow === null || low < originLow) originLow = low;
    }
  }

  const baseNatrPct = finite(volatilityContext?.baseNatrPct);
  const priorImpulsePct = peakPrice !== null && originLow !== null
    ? structuralPercentMove(originLow, peakPrice)
    : null;
  const priorImpulseBaseNatr = priorImpulsePct !== null && baseNatrPct > 0
    ? priorImpulsePct / baseNatrPct
    : null;
  const retracementRatio = peakPrice !== null && originLow !== null && peakPrice > originLow
    ? Math.max(0, peakPrice - pivotPrice) / (peakPrice - originLow)
    : null;
  const minimumPriorImpulseBaseNatr = Math.max(
    0,
    finite(policy.minimumPriorImpulseBaseNatr) ?? 1.25,
  );
  const minimumRetracementRatio = Math.max(
    0,
    Math.min(1, finite(policy.minimumRetracementRatio) ?? 0.20),
  );
  const applicable = priorImpulseBaseNatr !== null
    && priorImpulseBaseNatr >= minimumPriorImpulseBaseNatr
    && retracementRatio !== null;
  const visible = !applicable || retracementRatio >= minimumRetracementRatio;

  return Object.freeze({
    visible,
    reason: visible ? "WORKING_PIVOT_PASS" : "WORKING_PIVOT_SHALLOW_RETRACEMENT_FILTERED",
    pivotAt,
    pivotPrice,
    peakPrice,
    originLow,
    baseNatrPct,
    priorImpulsePct,
    priorImpulseBaseNatr,
    retracementRatio,
    minimumPriorImpulseBaseNatr,
    minimumRetracementRatio,
    applicable,
  });
}

export function structuralLocalRightEdgeMaturityDecision(level, candles = []) {
  const sourceTimeframe = level?.sourceTimeframe;
  const policy = LOCAL_WORKING_SET_POLICY[sourceTimeframe];
  const minimumRightBars = Math.max(0, Math.round(finite(policy?.minimumRightBars) ?? 0));
  if (!(minimumRightBars > 0) || level?.active === false) {
    return Object.freeze({ mature: true, reason: "RIGHT_EDGE_MATURITY_NOT_APPLICABLE", minimumRightBars });
  }

  const pivotAt = finite(level?.nativeExtremeAt ?? level?.extremeAt);
  if (pivotAt === null) {
    return Object.freeze({ mature: true, reason: "RIGHT_EDGE_MATURITY_MISSING_PIVOT", minimumRightBars });
  }

  const rows = (Array.isArray(candles) ? candles : [])
    .map(validCandle)
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  if (!rows.length) {
    return Object.freeze({ mature: true, reason: "RIGHT_EDGE_MATURITY_CONTEXT_UNAVAILABLE", minimumRightBars });
  }

  const pivotIndex = rows.findIndex((row) => row.time === pivotAt);
  if (pivotIndex < 0) {
    return Object.freeze({ mature: true, reason: "RIGHT_EDGE_MATURITY_PIVOT_CANDLE_UNAVAILABLE", minimumRightBars });
  }

  const rightBars = Math.max(0, rows.length - pivotIndex - 1);
  const mature = rightBars >= minimumRightBars;
  return Object.freeze({
    mature,
    reason: mature ? "RIGHT_EDGE_MATURE" : "RIGHT_EDGE_UNRESOLVED_FILTERED",
    pivotAt,
    rightBars,
    minimumRightBars,
    latestCandleAt: rows.at(-1)?.time ?? null,
  });
}

export function structuralLocalWorkingSetVisible(level, volatilityContext, candles = [], {
  retainAsNativeFrontier = false,
} = {}) {
  const sourceTimeframe = level?.sourceTimeframe;
  const policy = LOCAL_WORKING_SET_POLICY[sourceTimeframe];
  if (!policy || level?.active === false) return true;

  const sources = Array.isArray(level?.sources) ? level.sources : [sourceTimeframe].filter(Boolean);

  // V4.14: child confluence must never resurrect a local primary that already
  // fails its own source-TF working-pivot gate. After clustering the strongest
  // member is primary, so a genuine senior confluence (15m/1h/4h/1d) already
  // has a non-local sourceTimeframe and bypasses this function via the policy
  // check above. A 5m+1m cluster, however, remains a 5m primary and must still
  // pass the calibrated 5m gate. Repeated attacks remain an independent reason
  // to keep the level visible.
  if ((Number(level?.attackCount) || 1) > 1) return true;

  // V4.17: do not promote the unresolved single-touch 1m tail at the data/live
  // edge into a working-map level. Detector/history remain complete. Two later
  // closed 1m bars are enough to distinguish a confirmed structural turn from
  // the last technical bounce/pullback pair without using percentage tuning.
  const maturityDecision = structuralLocalRightEdgeMaturityDecision(level, candles);
  if (!maturityDecision.mature) return false;

  // V4.13: post-cluster local-only pivot guard. LOW keeps the V4.11
  // retracement rule; calibrated 5m HIGH now also requires a standalone incoming
  // rise. Event generation stays recall-first, and senior confluence / x2+
  // attacks have already bypassed this guard above.
  const pivotDecision = structuralLocalWorkingSetPivotDecision(level, candles, volatilityContext);
  if (!pivotDecision.visible) return false;

  // V4.16: the latest ACTIVE native local HIGH/LOW is the current structural
  // frontier for that view timeframe. It must still pass source-TF pivot quality
  // above, but a volatility expansion must not hide it merely because the stable
  // base-NATR distance radius became small relative to the move.
  if (retainAsNativeFrontier) return true;

  // V4.15: child confluence is allowed to retain a VALID local pivot outside
  // the ordinary working-area radius, but it never bypasses the pivot-quality
  // gate above. This restores accepted 5m structure on the 1m view without
  // reintroducing the V4.14 resurrection bug.
  if (sources.length > 1 || Number(level?.confluenceCount) > 1) return true;

  const distanceBaseNatr = structuralDistanceBaseNatr(level?.price, volatilityContext);
  if (distanceBaseNatr === null) return true;

  // V4.6: a distant local-only single-touch swing is memory, not an eternal
  // working-map ray. If it is truly macro-important it must be represented by
  // a senior timeframe, confluence, or repeated attacks. Strong local swing
  // magnitude alone no longer bypasses the working-area radius.
  return distanceBaseNatr <= policy.maxDistanceBaseNatr;
}

function structuralLevelTimeOnView(level, viewTimeframe) {
  const path = Array.isArray(level?.refinementPath) ? level.refinementPath : [];
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const step = path[index];
    if (step?.timeframe !== viewTimeframe) continue;
    const time = finite(step?.time);
    if (time !== null) return time;
  }
  if (level?.refinedThroughTimeframe === viewTimeframe) {
    const displayAt = finite(level?.displayAt);
    if (displayAt !== null) return displayAt;
  }
  return finite(level?.nativeExtremeAt ?? level?.extremeAt);
}

function structuralLevelContainsTimeframe(level, timeframe) {
  if (level?.sourceTimeframe === timeframe) return true;
  const sources = Array.isArray(level?.sources) ? level.sources : [];
  return sources.includes(timeframe);
}

export function filterLocalSameSideShadow(levels, viewTimeframe) {
  const source = Array.isArray(levels) ? levels.filter(Boolean) : [];
  const policy = LOCAL_WORKING_SET_POLICY[viewTimeframe];
  const shadowBars = Math.max(0, Math.round(finite(policy?.sameSideShadowBars) ?? 0));
  const intervalMs = STRUCTURAL_TF_INTERVAL_MS[viewTimeframe];
  if (!(shadowBars > 0) || !(intervalMs > 0) || !isLocalStructuralTimeframe(viewTimeframe)) {
    return Object.freeze([...source]);
  }

  const ordered = source.slice().sort((left, right) => {
    const leftAt = structuralLevelTimeOnView(left, viewTimeframe) ?? Infinity;
    const rightAt = structuralLevelTimeOnView(right, viewTimeframe) ?? Infinity;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
  });
  const maximumGapMs = shadowBars * intervalMs;
  const shadowedIds = new Set();

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    if (!current || current.active === false || current.sourceTimeframe !== viewTimeframe) continue;
    if ((Number(current.attackCount) || 1) > 1) continue;
    const currentSources = Array.isArray(current.sources) ? current.sources : [current.sourceTimeframe].filter(Boolean);
    if (currentSources.length > 1) continue;

    const currentAt = structuralLevelTimeOnView(current, viewTimeframe);
    const currentPrice = finite(current.price);
    if (currentAt === null || !(currentPrice > 0)) continue;

    for (let priorIndex = index - 1; priorIndex >= 0; priorIndex -= 1) {
      const prior = ordered[priorIndex];
      const priorAt = structuralLevelTimeOnView(prior, viewTimeframe);
      if (priorAt === null) continue;
      if (currentAt - priorAt > maximumGapMs) break;
      if (prior?.active === false) continue;
      if (prior?.side !== current.side) break;
      // V4.23: after clustering a valid native 1m pivot may be owned by a
      // senior primary (for example 15m+1m). It still participates in local
      // same-side shadow cleanup when the cluster contains this view timeframe.
      if (!structuralLevelContainsTimeframe(prior, viewTimeframe)) continue;

      const priorPrice = finite(prior?.price);
      if (!(priorPrice > 0)) break;
      const priorMoreExtreme = current.side === 'HIGH'
        ? priorPrice > currentPrice
        : priorPrice < currentPrice;
      if (priorMoreExtreme && current?.id) shadowedIds.add(current.id);
      break;
    }
  }

  return Object.freeze(source.filter((level) => !shadowedIds.has(level?.id)));
}

export function structuralTrendLegQualificationDecision(
  level,
  previousQualifiedSameSide,
  viewTimeframe,
  candles = [],
) {
  const policy = LOCAL_TRADABLE_STRUCTURE_POLICY[viewTimeframe];
  if (!policy || !isLocalStructuralTimeframe(viewTimeframe)) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_QUALIFICATION_NOT_APPLICABLE" });
  }
  if (!level || level.active === false || !["HIGH", "LOW"].includes(level.side)) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_INACTIVE_OR_INVALID" });
  }

  const sources = Array.isArray(level?.sources)
    ? level.sources
    : [level?.sourceTimeframe].filter(Boolean);
  const attackCount = Math.max(1, Math.round(Number(level?.attackCount) || 1));

  // Senior ownership, multi-TF confluence and repeated defence are independent
  // structural evidence. V5 must not erase them merely because a local leg is smooth.
  if (level.sourceTimeframe !== viewTimeframe || sources.length > 1 || attackCount > 1) {
    return Object.freeze({
      qualified: true,
      reason: attackCount > 1
        ? "TREND_LEG_REPEATED_ATTACK_BYPASS"
        : sources.length > 1
          ? "TREND_LEG_CONFLUENCE_BYPASS"
          : "TREND_LEG_SENIOR_BYPASS",
    });
  }

  if (!previousQualifiedSameSide || previousQualifiedSameSide.side !== level.side) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_NO_PRIOR_ANCHOR" });
  }
  if (!structuralLevelContainsTimeframe(previousQualifiedSameSide, viewTimeframe)) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_PRIOR_NOT_ON_VIEW" });
  }

  const intervalMs = STRUCTURAL_TF_INTERVAL_MS[viewTimeframe];
  const currentAt = structuralLevelTimeOnView(level, viewTimeframe);
  const priorAt = structuralLevelTimeOnView(previousQualifiedSameSide, viewTimeframe);
  const currentPrice = finite(level?.price);
  const priorPrice = finite(previousQualifiedSameSide?.price);
  if (!(intervalMs > 0) || currentAt === null || priorAt === null || currentAt <= priorAt
    || !(currentPrice > 0) || !(priorPrice > 0)) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_CONTEXT_INCOMPLETE" });
  }

  // V5.1: a directional leg does not expire because a fixed number of candles
  // elapsed. The same-side structural anchor remains valid until price itself
  // produces a meaningful reset/new structure. This prevents a long smooth trend
  // from restarting the noise ladder every N bars.
  const anchorBars = (currentAt - priorAt) / intervalMs;

  // V5.0 intentionally targets continuation-side staircases only. A new lower LOW
  // or higher HIGH is left for the next qualification stage (V-reversal/defence),
  // rather than being guessed here.
  const continuationSide = level.side === "LOW"
    ? currentPrice > priorPrice
    : currentPrice < priorPrice;
  if (!continuationSide) {
    return Object.freeze({
      qualified: true,
      reason: "TREND_LEG_NEW_PRICE_EXTREME_DEFERRED",
      anchorBars,
    });
  }

  const rows = (Array.isArray(candles) ? candles : [])
    .map(validCandle)
    .filter(Boolean)
    .filter((row) => row.time > priorAt && row.time <= currentAt)
    .sort((left, right) => left.time - right.time);
  if (!rows.length) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_CANDLES_UNAVAILABLE" });
  }

  let legExtreme = null;
  let legMove = null;
  let resetMove = null;
  if (level.side === "LOW") {
    legExtreme = Math.max(...rows.map((row) => row.high));
    if (!(legExtreme > priorPrice)) {
      return Object.freeze({ qualified: true, reason: "TREND_LEG_NO_ADVANCE" });
    }
    legMove = legExtreme - priorPrice;
    resetMove = Math.max(0, legExtreme - currentPrice);
  } else {
    legExtreme = Math.min(...rows.map((row) => row.low));
    if (!(legExtreme < priorPrice)) {
      return Object.freeze({ qualified: true, reason: "TREND_LEG_NO_DECLINE" });
    }
    legMove = priorPrice - legExtreme;
    resetMove = Math.max(0, currentPrice - legExtreme);
  }

  if (!(legMove > 0)) {
    return Object.freeze({ qualified: true, reason: "TREND_LEG_ZERO_MOVE" });
  }

  const resetRatio = resetMove / legMove;
  const minimumLegResetRatio = Math.max(
    0,
    Math.min(1, finite(policy.minimumLegResetRatio) ?? 0.30),
  );
  const qualified = resetRatio >= minimumLegResetRatio;
  return Object.freeze({
    qualified,
    reason: qualified
      ? "TREND_LEG_RESET_PASS"
      : "TREND_LEG_SHALLOW_CONTINUATION_FILTERED",
    side: level.side,
    priorPrice,
    currentPrice,
    priorAt,
    currentAt,
    anchorBars,
    legExtreme,
    legMove,
    resetMove,
    resetRatio,
    minimumLegResetRatio,
  });
}

export function filterLocalTradableStructure(levels, viewTimeframe, candles = []) {
  const source = Array.isArray(levels) ? levels.filter(Boolean) : [];
  if (!LOCAL_TRADABLE_STRUCTURE_POLICY[viewTimeframe]) return Object.freeze([...source]);

  const ordered = source.slice().sort((left, right) => {
    const leftAt = structuralLevelTimeOnView(left, viewTimeframe) ?? Infinity;
    const rightAt = structuralLevelTimeOnView(right, viewTimeframe) ?? Infinity;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
  });

  const keptIds = new Set();
  const lastQualifiedBySide = new Map();
  for (const level of ordered) {
    const previous = lastQualifiedBySide.get(level?.side) ?? null;
    const decision = structuralTrendLegQualificationDecision(
      level,
      previous,
      viewTimeframe,
      candles,
    );
    if (!decision.qualified) continue;
    if (level?.id) keptIds.add(level.id);
    if (structuralLevelContainsTimeframe(level, viewTimeframe) && ["HIGH", "LOW"].includes(level?.side)) {
      lastQualifiedBySide.set(level.side, level);
    }
  }

  return Object.freeze(source.filter((level) => !level?.id || keptIds.has(level.id)));
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
    const rawNativeCandidates = normalizedSourceLevels(
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
        if (!structuralChildLevelSignificant(extreme, sourceTimeframe, { volatilityContext })) return false;
        return structuralLocalPivotProminenceDecision(
          extreme,
          sourceTimeframe,
          childCandles,
          volatilityContext,
        ).admitted;
      },
    );

    // V5.1: qualify each native source timeframe BEFORE hierarchy/clustering.
    // A weak 5m continuation pivot must not become immune merely because it later
    // clusters into a senior-owned/confluent level. Detector/history remain recall-first.
    const nativeCandidates = filterLocalTradableStructure(
      rawNativeCandidates,
      sourceTimeframe,
      childCandles,
    );

    // A lower-TF level near an inherited stronger level is confluence/refinement,
    // not a new independent line. Clustering keeps the native label of the older
    // stronger timeframe.
    hierarchy = [...clusterStructuralLevels([...hierarchy, ...nativeCandidates], { tickSize })];
  }

  if (includeHistory) return Object.freeze(hierarchy);

  // V4.17: preserve exactly one latest MATURE ACTIVE native frontier per side on
  // local views. An unresolved right-edge micro pivot must not steal frontier
  // ownership from the preceding structural swing. This remains only a distance
  // bypass; pivot-quality and right-edge maturity are still mandatory.
  const nativeFrontierIds = new Set();
  if (isLocalStructuralTimeframe(viewTimeframe)) {
    for (const side of ["HIGH", "LOW"]) {
      let latest = null;
      let latestAt = -Infinity;
      for (const level of hierarchy) {
        if (level?.active === false || level?.side !== side) continue;
        if (level?.sourceTimeframe !== viewTimeframe) continue;
        const maturityDecision = structuralLocalRightEdgeMaturityDecision(
          level,
          candlesByTimeframe?.[viewTimeframe] ?? [],
        );
        if (!maturityDecision.mature && (Number(level?.attackCount) || 1) <= 1) continue;
        const at = finite(level?.nativeExtremeAt ?? level?.extremeAt);
        if (at === null || at < latestAt) continue;
        latest = level;
        latestAt = at;
      }
      if (latest?.id) nativeFrontierIds.add(latest.id);
    }
  }

  const workingHierarchy = hierarchy.filter((level) => structuralLocalWorkingSetVisible(
    level,
    volatilityByTimeframe[level?.sourceTimeframe],
    candlesByTimeframe?.[level?.sourceTimeframe] ?? [],
    { retainAsNativeFrontier: nativeFrontierIds.has(level?.id) },
  ));
  const shadowFilteredHierarchy = filterLocalSameSideShadow(workingHierarchy, viewTimeframe);
  // V5.1 qualification already happened on the native source timeframe before
  // clustering. Do not re-run it here on senior-owned/confluent display objects.
  return Object.freeze(shadowFilteredHierarchy);
}
