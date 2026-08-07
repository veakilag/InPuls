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
  "1m": 24 * 60 * 60_000,
  "5m": 24 * 60 * 60_000,
  "15m": 365 * 24 * 60 * 60_000,
  "1h": 10 * 365 * 24 * 60 * 60_000,
  "4h": 10 * 365 * 24 * 60 * 60_000,
  "1d": 10 * 365 * 24 * 60 * 60_000,
});

export const LOCAL_STRUCTURAL_LEVEL_HORIZON_MS = 24 * 60 * 60_000;

// Stage-1 calibration. This is deliberately a map-admission filter, not a
// modification of the underlying detector. A 1m/5m swing may still exist in
// replay diagnostics without becoming a visible structural level.
export const LOCAL_HIERARCHICAL_ADMISSION = Object.freeze({
  "1m": Object.freeze({ minimumSwingPercent: 0.30, reversalMultiplier: 1.70 }),
  "5m": Object.freeze({ minimumSwingPercent: 0.45, reversalMultiplier: 1.55 }),
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

export function structuralLevelVisibleAt({ sourceTimeframe, extremeAt, endAt }) {
  const origin = finite(extremeAt);
  const rangeEnd = finite(endAt);
  if (origin === null || rangeEnd === null) return false;
  if (!isLocalStructuralTimeframe(sourceTimeframe)) return true;
  return origin >= rangeEnd - LOCAL_STRUCTURAL_LEVEL_HORIZON_MS;
}

export function hierarchicalAdmissionRequiredPercent(extreme, sourceTimeframe) {
  const policy = LOCAL_HIERARCHICAL_ADMISSION[sourceTimeframe];
  if (!policy) return 0;
  const reversalThreshold = Math.max(0, finite(extreme?.reversalThresholdPct) ?? 0);
  return Math.max(
    policy.minimumSwingPercent,
    reversalThreshold * policy.reversalMultiplier,
  );
}

export function structuralChildLevelSignificant(extreme, sourceTimeframe) {
  if (!isLocalStructuralTimeframe(sourceTimeframe)) return true;
  const swing = finite(extreme?.swingAmplitudePct);
  if (swing === null) return true;
  return swing >= hierarchicalAdmissionRequiredPercent(extreme, sourceTimeframe);
}

export function normalizeStructuralLevel(extreme, sourceTimeframe, endAt) {
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
  const crossedAt = finite(extreme.crossedAt);
  const active = extreme.active !== false && crossedAt === null;
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
    endAt: active ? rangeEnd : crossedAt ?? rangeEnd,
    status: extreme.status ?? (active ? "ACTIVE" : "CROSSED"),
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
    let cluster = clusters.find((row) => samePriceZone(row.primary, level, {
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
  return `${side} ${primary}${confluence} · ×${attacks} · ${price}${level?.active === false ? " · ПРОБИТ" : ""}`;
}

function sourceRows(snapshot, includeHistory) {
  if (!snapshot) return [];
  return Array.isArray(includeHistory ? snapshot.history : snapshot.active)
    ? (includeHistory ? snapshot.history : snapshot.active)
    : [];
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
    for (const extreme of sourceRows(snapshot, includeHistory)) {
      const level = normalizeStructuralLevel(extreme, sourceTimeframe, endAt);
      if (level) levels.push(level);
    }
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

  let hierarchy = [];
  for (const sourceTimeframe of descent) {
    const childCandles = candlesByTimeframe?.[sourceTimeframe] ?? [];
    if (hierarchy.length) {
      hierarchy = hierarchy.map((level) => refineStructuralLevelToTimeframe(
        level,
        sourceTimeframe,
        childCandles,
        { tickSize },
      ));
    }

    const snapshot = snapshotsByTimeframe?.[sourceTimeframe];
    const nativeCandidates = sourceRows(snapshot, includeHistory)
      .filter((extreme) => structuralChildLevelSignificant(extreme, sourceTimeframe))
      .map((extreme) => normalizeStructuralLevel(extreme, sourceTimeframe, endAt))
      .filter(Boolean);

    // A lower-TF level near an inherited stronger level is confluence/refinement,
    // not a new independent line. Clustering keeps the native label of the older
    // stronger timeframe.
    hierarchy = [...clusterStructuralLevels([...hierarchy, ...nativeCandidates], { tickSize })];
  }

  return Object.freeze(hierarchy);
}
