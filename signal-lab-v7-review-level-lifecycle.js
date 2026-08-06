const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function manualLevelLifecycle({
  candles,
  side,
  price,
  extremeAt,
  tickSize,
  reversalThresholdPct = 0.5,
  crossingToleranceTicks = 1,
  touchZoneTicks = 2,
  touchZoneFactor = 0.15,
  maximumTouchZonePct = 0.25,
  rearmDistanceFactor = 0.7,
  explicitCrossAt = null,
}) {
  const rows = Array.isArray(candles) ? candles : [];
  const levelPrice = finite(price);
  const originAt = finite(extremeAt);
  const tick = Math.max(0, finite(tickSize) ?? 0);
  if (!(levelPrice > 0) || originAt === null || !["HIGH", "LOW"].includes(side)) {
    return Object.freeze({
      status: "INVALID",
      active: false,
      crossedAt: null,
      endAt: originAt,
      touchCount: 0,
      attacks: Object.freeze([]),
    });
  }

  const tolerance = tick * Math.max(0, Math.round(crossingToleranceTicks));
  const tickZonePct = tick > 0
    ? tick * Math.max(1, Math.round(touchZoneTicks)) / levelPrice * 100
    : 0;
  const adaptiveZonePct = Math.min(
    Math.max(0.01, finite(maximumTouchZonePct) ?? 0.25),
    Math.max(0, finite(reversalThresholdPct) ?? 0.5)
      * Math.max(0.01, finite(touchZoneFactor) ?? 0.15),
  );
  const zonePct = Math.max(tickZonePct, adaptiveZonePct);
  const zoneDistance = levelPrice * zonePct / 100;
  const rearmPct = Math.max(
    zonePct * 2,
    Math.max(0.01, finite(reversalThresholdPct) ?? 0.5)
      * Math.max(0.1, finite(rearmDistanceFactor) ?? 0.7),
  );

  let active = true;
  let crossedAt = null;
  let inZone = false;
  let rearmed = false;
  const attacks = [];

  for (const candle of rows) {
    const candleTime = finite(candle?.time);
    const closeTime = finite(candle?.closeTime) ?? candleTime;
    if (candleTime === null || candleTime <= originAt) continue;
    const high = finite(candle?.high);
    const low = finite(candle?.low);
    const close = finite(candle?.close);
    if (![high, low, close].every(Number.isFinite)) continue;

    const explicitCross = explicitCrossAt !== null && candleTime >= explicitCrossAt;
    const crossed = side === "HIGH"
      ? high > levelPrice + tolerance
      : low < levelPrice - tolerance;
    if (explicitCross || crossed) {
      active = false;
      crossedAt = closeTime;
      break;
    }

    const touches = side === "HIGH"
      ? high >= levelPrice - zoneDistance
      : low <= levelPrice + zoneDistance;

    if (touches) {
      if (!inZone && rearmed) {
        attacks.push(Object.freeze({
          number: attacks.length + 1,
          time: candleTime,
          closeTime,
          price: side === "HIGH" ? high : low,
        }));
      }
      inZone = true;
      rearmed = false;
      continue;
    }

    inZone = false;
    const awayPct = side === "HIGH"
      ? Math.max(0, (levelPrice - close) / levelPrice * 100)
      : Math.max(0, (close - levelPrice) / levelPrice * 100);
    if (awayPct >= rearmPct) rearmed = true;
  }

  const lastAt = rows.length
    ? finite(rows.at(-1)?.closeTime) ?? finite(rows.at(-1)?.time) ?? originAt
    : originAt;

  return Object.freeze({
    status: active ? (attacks.length ? "TOUCHED" : "ACTIVE") : "CROSSED",
    active,
    crossedAt,
    endAt: crossedAt ?? lastAt,
    touchCount: attacks.length,
    attacks: Object.freeze(attacks),
    zonePct,
    rearmPct,
  });
}

export function fixedReviewUrl({
  locationHref,
  symbol,
  timeframe,
  endAt,
}) {
  const url = new URL(locationHref);
  if (symbol) url.searchParams.set("symbol", String(symbol).toUpperCase());
  if (timeframe) url.searchParams.set("tf", String(timeframe));
  if (Number.isFinite(Number(endAt))) {
    url.searchParams.set("endAt", String(Math.round(Number(endAt))));
  }
  url.searchParams.set("fixed", "1");
  return url.toString();
}
