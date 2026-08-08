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
  acceptanceBars = 2,
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
      retestCount: 0,
      attacks: Object.freeze([]),
      pierces: Object.freeze([]),
    });
  }

  // Old zone arguments remain in the signature for review/export compatibility,
  // but they no longer define an attack.
  void crossingToleranceTicks;
  void touchZoneTicks;
  void touchZoneFactor;
  void maximumTouchZonePct;

  const levelTicks = tick > 0 ? Math.round(levelPrice / tick) : null;
  const rearmPct = Math.max(
    0.01,
    Math.max(0.01, finite(reversalThresholdPct) ?? 0.5)
      * Math.max(0.1, finite(rearmDistanceFactor) ?? 0.7),
  );
  const requiredAcceptanceBars = Math.max(1, Math.round(finite(acceptanceBars) ?? 2));

  let active = true;
  let crossedAt = null;
  let inAttack = false;
  let rearmed = false;
  let pendingPierce = false;
  let acceptanceCount = 0;
  let rejectedPierceCount = 0;
  const attacks = [];
  const pierces = [];

  const isCloseBeyond = (close) => side === "HIGH" ? close > levelPrice : close < levelPrice;

  for (const candle of rows) {
    const candleTime = finite(candle?.time);
    const closeTime = finite(candle?.closeTime) ?? candleTime;
    if (candleTime === null || candleTime <= originAt) continue;
    const high = finite(candle?.high);
    const low = finite(candle?.low);
    const close = finite(candle?.close);
    if (![high, low, close].every(Number.isFinite)) continue;

    if (explicitCrossAt !== null && candleTime >= explicitCrossAt) {
      active = false;
      crossedAt = closeTime;
      pendingPierce = false;
      break;
    }

    if (pendingPierce) {
      if (!isCloseBeyond(close)) {
        rejectedPierceCount += 1;
        pendingPierce = false;
        acceptanceCount = 0;
        inAttack = false;
        rearmed = false;
        continue;
      }
      acceptanceCount += 1;
      if (acceptanceCount >= requiredAcceptanceBars) {
        active = false;
        crossedAt = closeTime;
        pendingPierce = false;
        break;
      }
      continue;
    }

    const highTicks = levelTicks === null ? null : Math.round(high / tick);
    const lowTicks = levelTicks === null ? null : Math.round(low / tick);
    const pierced = side === "HIGH"
      ? (levelTicks === null ? high > levelPrice : highTicks > levelTicks)
      : (levelTicks === null ? low < levelPrice : lowTicks < levelTicks);

    if (pierced) {
      pierces.push(Object.freeze({
        number: pierces.length + 1,
        time: candleTime,
        closeTime,
        price: side === "HIGH" ? high : low,
      }));
      inAttack = false;
      rearmed = false;
      if (!isCloseBeyond(close)) {
        rejectedPierceCount += 1;
        acceptanceCount = 0;
        continue;
      }
      pendingPierce = true;
      acceptanceCount = 1;
      if (acceptanceCount >= requiredAcceptanceBars) {
        active = false;
        crossedAt = closeTime;
        pendingPierce = false;
        break;
      }
      continue;
    }

    const exactAttack = side === "HIGH"
      ? (levelTicks === null ? high === levelPrice : highTicks === levelTicks)
      : (levelTicks === null ? low === levelPrice : lowTicks === levelTicks);

    if (exactAttack) {
      if (!inAttack && rearmed) {
        attacks.push(Object.freeze({
          number: attacks.length + 2,
          time: candleTime,
          closeTime,
          price: levelPrice,
          semantics: "EXACT_PRICE_TICK",
        }));
      }
      inAttack = true;
      rearmed = false;
      continue;
    }

    inAttack = false;
    const awayPct = side === "HIGH"
      ? Math.max(0, (levelPrice - close) / levelPrice * 100)
      : Math.max(0, (close - levelPrice) / levelPrice * 100);
    if (awayPct >= rearmPct) rearmed = true;
  }

  const lastAt = rows.length
    ? finite(rows.at(-1)?.closeTime) ?? finite(rows.at(-1)?.time) ?? originAt
    : originAt;
  const retestCount = attacks.length;
  const touchCount = retestCount + 1;
  const status = active
    ? pendingPierce
      ? "PIERCED"
      : retestCount
        ? "TOUCHED"
        : "ACTIVE"
    : "ACCEPTED";

  return Object.freeze({
    status,
    active,
    crossedAt,
    endAt: crossedAt ?? lastAt,
    touchCount,
    retestCount,
    attacks: Object.freeze(attacks),
    pierces: Object.freeze(pierces),
    pendingPierce,
    rejectedPierceCount,
    rearmPct,
    zonePct: 0,
    attackToleranceTicks: 0,
    attackCountSemantics: "FORMATION_IS_ATTACK_1_EXACT_PRICE_TICK",
    breakSemantics: "PIERCE_THEN_ACCEPTANCE",
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