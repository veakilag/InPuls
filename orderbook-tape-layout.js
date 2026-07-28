export const TAPE_READABLE_LAYOUT = Object.freeze({
  clusterGapPx: 3,
  clusterSpanPx: 18,
  maxClusterItems: 1_200,
  maxExtraSpanPx: 32,
  minDiameterPx: 1.4,
  maxDiameterPx: 8.5,
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function timeToX(time, window, width) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const right = Math.max(
    1,
    Math.min(Number(window?.plotRight) || safeWidth, safeWidth),
  );
  const duration = Math.max(1, Number(window?.duration) || 1);
  const ratio = (Number(time) - Number(window?.startTime)) / duration;
  return clamp(ratio * right, 1, right);
}

function splitCollisionGroups(ordered) {
  const groups = [];
  let group = [];
  for (const item of ordered) {
    const previous = group.at(-1);
    const first = group[0];
    const shouldSplit = group.length > 0 && (
      item.baseX - previous.baseX > TAPE_READABLE_LAYOUT.clusterGapPx
      || item.baseX - first.baseX > TAPE_READABLE_LAYOUT.clusterSpanPx
      || group.length >= TAPE_READABLE_LAYOUT.maxClusterItems
    );
    if (shouldSplit) {
      groups.push(group);
      group = [];
    }
    group.push(item);
  }
  if (group.length) groups.push(group);
  return groups;
}

export function buildReadableTapeLayout(items, window, width) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const leftEdge = 1;
  const rightEdge = Math.max(
    leftEdge,
    Math.min(Number(window?.plotRight) || safeWidth, safeWidth) - 1,
  );
  const ordered = (items ?? [])
    .map((item, sequenceIndex) => ({
      ...item,
      sequenceIndex,
      baseX: timeToX(item.lastTime ?? item.time, window, safeWidth),
    }))
    .sort((left, right) => (
      Number(left.lastTime ?? left.time) - Number(right.lastTime ?? right.time)
      || left.sequenceIndex - right.sequenceIndex
    ));
  if (!ordered.length) return [];

  const groups = splitCollisionGroups(ordered);
  const ranges = groups.map((group) => ({
    start: group[0].baseX,
    end: group.at(-1).baseX,
  }));
  const laidOut = [];

  groups.forEach((group, groupIndex) => {
    const density = group.length;
    const naturalStart = ranges[groupIndex].start;
    const naturalEnd = ranges[groupIndex].end;
    const naturalSpan = Math.max(0, naturalEnd - naturalStart);
    const previous = ranges[groupIndex - 1];
    const next = ranges[groupIndex + 1];
    const leftBoundary = previous
      ? (previous.end + naturalStart) / 2
      : leftEdge;
    const rightBoundary = next
      ? (naturalEnd + next.start) / 2
      : rightEdge;
    const availableLeft = Math.max(0, naturalStart - leftBoundary);
    const availableRight = Math.max(0, rightBoundary - naturalEnd);
    const desiredGap = density > 1
      ? Math.min(2.2, TAPE_READABLE_LAYOUT.maxExtraSpanPx / (density - 1))
      : 0;
    const desiredSpan = Math.max(
      naturalSpan,
      desiredGap * Math.max(0, density - 1),
    );
    const requestedExtra = Math.min(
      TAPE_READABLE_LAYOUT.maxExtraSpanPx,
      Math.max(0, desiredSpan - naturalSpan),
    );
    const extraSpan = Math.min(
      requestedExtra,
      availableLeft + availableRight,
    );

    let leftExpansion = Math.min(availableLeft, extraSpan / 2);
    let rightExpansion = Math.min(
      availableRight,
      extraSpan - leftExpansion,
    );
    let remaining = extraSpan - leftExpansion - rightExpansion;
    if (remaining > 0) {
      const addLeft = Math.min(
        availableLeft - leftExpansion,
        remaining,
      );
      leftExpansion += addLeft;
      remaining -= addLeft;
    }
    if (remaining > 0) {
      rightExpansion += Math.min(
        availableRight - rightExpansion,
        remaining,
      );
    }
    const distributedExtra = leftExpansion + rightExpansion;

    group.forEach((item, index) => {
      const progress = density > 1 ? index / (density - 1) : 0;
      const x = clamp(
        item.baseX - leftExpansion + distributedExtra * progress,
        leftEdge,
        rightEdge,
      );
      const { sequenceIndex, ...rest } = item;
      laidOut.push({ ...rest, x, density, yOffset: 0 });
    });
  });

  return laidOut;
}

export function adaptiveRawDiameter(strength, density, width) {
  const safeStrength = clamp(Number(strength) || 0, 0, 1);
  const safeDensity = Math.max(1, Math.floor(Number(density) || 1));
  const widthMax = clamp((Number(width) || 0) * .022, 6.5, TAPE_READABLE_LAYOUT.maxDiameterPx);
  const base = TAPE_READABLE_LAYOUT.minDiameterPx + Math.pow(safeStrength, .68) * 7.1;
  const densityScale = safeDensity <= 6
    ? 1
    : Math.max(.2, Math.sqrt(6 / safeDensity));
  return clamp(
    base * densityScale + safeStrength * .55,
    TAPE_READABLE_LAYOUT.minDiameterPx,
    widthMax,
  );
}

export function quantileThreshold(values, quantile = .95) {
  const sorted = (values ?? [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return Infinity;
  const q = clamp(Number(quantile) || 0, 0, 1);
  return sorted[Math.floor((sorted.length - 1) * q)] ?? Infinity;
}

export function rectanglesOverlap(left, right, padding = 2) {
  const gap = Math.max(0, Number(padding) || 0);
  return !(
    left.x + left.width + gap <= right.x
    || right.x + right.width + gap <= left.x
    || left.y + left.height + gap <= right.y
    || right.y + right.height + gap <= left.y
  );
}

export function selectReadableAggLabels(items, measure, rect, options = {}) {
  const quantile = Number(options.quantile) || .95;
  const maximum = Math.max(1, Math.floor(
    Number(options.maximum) || Math.max(2, Math.floor((Number(rect?.width) || 1) / 150)),
  ));
  const threshold = quantileThreshold(items.map((item) => item.quote), quantile);
  const selected = new Set();
  const rectangles = [];
  const candidates = [...items]
    .filter((item) => Number(item.quote) >= threshold)
    .sort((left, right) => Number(right.quote) - Number(left.quote));

  for (const item of candidates) {
    if (selected.size >= maximum) break;
    const label = String(item.label ?? "");
    const width = Math.max(18, Number(measure(label)) + 9);
    const height = clamp(Number(item.height) || 10, 8, 16);
    const x = clamp(Number(item.x) || 0, width / 2 + .5, Math.max(width / 2 + .5, rect.width - width / 2 - .5));
    const box = { x: x - width / 2, y: Number(item.y) - height / 2, width, height };
    if (rectangles.some((other) => rectanglesOverlap(box, other, 2))) continue;
    rectangles.push(box);
    selected.add(item.key);
  }
  return selected;
}
