export const STRUCTURAL_TF_ORDER = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);

export const STRUCTURAL_TF_STRENGTH = Object.freeze({
  "1m": 1,
  "5m": 2,
  "15m": 3,
  "1h": 4,
  "4h": 5,
  "1d": 6,
});

export const STRUCTURAL_TF_LOOKBACK_MS = Object.freeze({
  "1m": 24 * 60 * 60_000,
  "5m": 24 * 60 * 60_000,
  "15m": 30 * 24 * 60 * 60_000,
  "1h": 60 * 24 * 60 * 60_000,
  "4h": 180 * 24 * 60 * 60_000,
  "1d": 365 * 24 * 60 * 60_000,
});

export const LOCAL_STRUCTURAL_LEVEL_HORIZON_MS = 24 * 60 * 60_000;

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function visibleSourceTimeframes(viewTimeframe) {
  const index = STRUCTURAL_TF_ORDER.indexOf(String(viewTimeframe));
  if (index < 0) return Object.freeze([]);
  return Object.freeze(STRUCTURAL_TF_ORDER.slice(index));
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
    sourceTimeframe,
    strength: STRUCTURAL_TF_STRENGTH[sourceTimeframe] ?? 0,
    attackCount,
    active,
    crossedAt,
    endAt: active ? rangeEnd : crossedAt ?? rangeEnd,
    status: extreme.status ?? (active ? "ACTIVE" : "CROSSED"),
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

export function structuralLevelLabel(level) {
  const side = level?.side === "HIGH" ? "H" : "L";
  const sources = Array.isArray(level?.sources) && level.sources.length
    ? level.sources
    : [level?.sourceTimeframe].filter(Boolean);
  const primary = sources[0] ?? "?";
  const confluence = sources.length > 1 ? ` + ${sources.slice(1).join("+")}` : "";
  const attacks = Math.max(1, Math.round(Number(level?.attackCount) || 1));
  return `${side} ${primary}${confluence} · ×${attacks}${level?.active === false ? " · ПРОБИТ" : ""}`;
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
    if (!snapshot) continue;
    const source = includeHistory ? snapshot.history : snapshot.active;
    for (const extreme of Array.isArray(source) ? source : []) {
      const level = normalizeStructuralLevel(extreme, sourceTimeframe, endAt);
      if (level) levels.push(level);
    }
  }
  return clusterStructuralLevels(levels, { tickSize });
}
