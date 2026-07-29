export const PATTERN_CATALOG_VERSION = "scalper-pattern-contract-v2";

export const PATTERN_GROUPS = Object.freeze({
  CLASSIC: "classic",
  ALGORITHM: "algorithm",
  MARKET_EVENT: "market_event",
});

const definition = (id, group, label, detectorState, evidence) => Object.freeze({
  id,
  group,
  label,
  detectorState,
  evidence: Object.freeze([...evidence]),
});

export const PATTERN_CATALOG = Object.freeze({
  knife: definition("knife", PATTERN_GROUPS.CLASSIC, "Нож", "active", [
    "fast-downward-impulse",
    "elevated-volume",
    "long-entry-near-extreme",
    "reversal-path-up",
  ]),
  sharpening: definition("sharpening", PATTERN_GROUPS.CLASSIC, "Заточка", "active", [
    "fast-upward-impulse",
    "elevated-volume",
    "short-entry-near-extreme",
    "reversal-path-down",
  ]),
  breakout_resistance: definition(
    "breakout_resistance",
    PATTERN_GROUPS.CLASSIC,
    "Пробой УС",
    "active",
    ["resistance-level", "approach-path", "trade-through", "acceptance-or-return"],
  ),
  breakout_support: definition(
    "breakout_support",
    PATTERN_GROUPS.CLASSIC,
    "Пробой УП",
    "active",
    ["support-level", "approach-path", "trade-through", "acceptance-or-return"],
  ),
  cascade: definition("cascade", PATTERN_GROUPS.CLASSIC, "Каскад", "evidence_collection", [
    "one-minute-or-higher-extrema",
    "same-side-extrema-sequence",
    "stop-liquidity-zone-behind-extrema",
    "fast-sweep-through-zone",
  ]),
  rearranger: definition(
    "rearranger",
    PATTERN_GROUPS.ALGORITHM,
    "Переставляш",
    "evidence_collection",
    ["density-move-chain", "same-side", "size-similarity", "distance-to-spread"],
  ),
  size_supporter: definition(
    "size_supporter",
    PATTERN_GROUPS.ALGORITHM,
    "Подставляш сайзов",
    "evidence_collection",
    ["best-quote-repricing", "cancel-replace-chain", "size-similarity", "spread-pressure"],
  ),
  minute_algorithm: definition(
    "minute_algorithm",
    PATTERN_GROUPS.ALGORITHM,
    "Минутник",
    "evidence_collection",
    [
      "start-of-minute",
      "large-size-inside-spread",
      "recurs-each-minute",
      "allowed-price-range-up-to-five-percent",
      "directional-price-pressure",
      "activation-and-deactivation",
    ],
  ),
  hour_59_algorithm: definition(
    "hour_59_algorithm",
    PATTERN_GROUPS.ALGORITHM,
    "59-я минута",
    "evidence_collection",
    [
      "minute-in-hour-is-59",
      "rearranger-or-size-supporter-activation",
      "placement-or-repricing",
      "price-reaction",
    ],
  ),
  buyer: definition("buyer", PATTERN_GROUPS.ALGORITHM, "Покупаш", "blocked_raw_trade", [
    "raw-trade-side",
    "raw-trade-size",
    "size-repeat-distance",
    "inter-arrival-periodicity",
  ]),
  seller: definition("seller", PATTERN_GROUPS.ALGORITHM, "Продаваш", "blocked_raw_trade", [
    "raw-trade-side",
    "raw-trade-size",
    "size-repeat-distance",
    "inter-arrival-periodicity",
  ]),
  impulse: definition("impulse", PATTERN_GROUPS.MARKET_EVENT, "Импульс", "active", [
    "fast-directional-move",
    "volume-acceleration",
  ]),
  liquidation_cascade: definition(
    "liquidation_cascade",
    PATTERN_GROUPS.MARKET_EVENT,
    "Каскад ликвидаций",
    "active",
    ["aligned-liquidations", "fast-directional-move"],
  ),
});

export function patternDefinition(type) {
  return PATTERN_CATALOG[type] ?? null;
}

export function patternClock(at = Date.now()) {
  const date = new Date(Number(at) || Date.now());
  return Object.freeze({
    timezone: "UTC",
    minuteInHour: date.getUTCMinutes(),
    secondInMinute: date.getUTCSeconds(),
    millisecondInSecond: date.getUTCMilliseconds(),
    distanceToNextMinuteMs: 60_000 - (
      date.getUTCSeconds() * 1_000 + date.getUTCMilliseconds()
    ),
    isMinute59: date.getUTCMinutes() === 59,
  });
}

export function minuteStructureEvidence(candles, currentPrice = null) {
  const rows = (Array.isArray(candles) ? candles : [])
    .filter((item) => [
      item?.time,
      item?.open,
      item?.high,
      item?.low,
      item?.close,
    ].every(Number.isFinite))
    .slice(-32);
  const extrema = [];
  for (let index = 1; index < rows.length - 1; index += 1) {
    const previous = rows[index - 1];
    const candle = rows[index];
    const next = rows[index + 1];
    if (candle.high >= previous.high && candle.high > next.high) {
      extrema.push({ side: "high", price: candle.high, touchedAt: candle.time });
    }
    if (candle.low <= previous.low && candle.low < next.low) {
      extrema.push({ side: "low", price: candle.low, touchedAt: candle.time });
    }
  }
  const price = Number(currentPrice);
  return Object.freeze({
    timeframe: "1m",
    source: rows.length >= 3 ? "minute-candles" : "unavailable",
    candleCount: rows.length,
    extrema: extrema.slice(-12).map((item) => Object.freeze({
      ...item,
      distanceFromCurrentPercent: Number.isFinite(price) && price > 0
        ? ((item.price - price) / price) * 100
        : null,
    })),
    limitations: [
      "extrema-are-neutral-evidence-not-confirmed-stop-locations",
      "cascade-sweep-thresholds-not-calibrated",
    ],
  });
}

export function densityGeometry(orderBook) {
  const lifecycle = orderBook?.densityLifecycle;
  const densities = Array.isArray(lifecycle?.densities) ? lifecycle.densities : [];
  const rows = densities
    .map((item) => ({
      id: String(item?.id || "").slice(0, 120) || null,
      side: item?.side === "bid" ? "bid" : item?.side === "ask" ? "ask" : null,
      price: Number.isFinite(Number(item?.price)) ? Number(item.price) : null,
      currentQuote: Number.isFinite(Number(item?.currentQuote))
        ? Number(item.currentQuote)
        : null,
      maxQuote: Number.isFinite(Number(item?.maxQuote)) ? Number(item.maxQuote) : null,
      ageMs: Number.isFinite(Number(item?.ageMs)) ? Number(item.ageMs) : null,
      state: String(item?.state || "").slice(0, 40) || null,
      interaction: String(item?.interaction || "").slice(0, 40) || null,
      resolution: String(item?.resolution || "").slice(0, 40) || null,
      move: item?.move ? {
        fromPrice: Number(item.move.fromPrice) || null,
        toPrice: Number(item.move.toPrice) || null,
        distanceBps: Number(item.move.distanceBps) || null,
        matchedAt: Number(item.move.matchedAt) || null,
      } : null,
    }))
    .filter((item) => item.side && item.price)
    .slice(0, 24);

  const sideSummary = (side) => {
    const prices = rows.filter((item) => item.side === side).map((item) => item.price).sort((a, b) => a - b);
    const spacingsBps = [];
    for (let index = 1; index < prices.length; index += 1) {
      spacingsBps.push(((prices[index] - prices[index - 1]) / prices[index - 1]) * 10_000);
    }
    return {
      count: prices.length,
      prices,
      spacingsBps,
    };
  };

  return Object.freeze({
    state: String(lifecycle?.state || "unavailable"),
    computedAt: Number(lifecycle?.computedAt) || null,
    bid: sideSummary("bid"),
    ask: sideSummary("ask"),
    densities: rows,
    movedDensityCount: rows.filter((item) => item.move).length,
    source: rows.length ? "local-deep-book-density-lifecycle" : "unavailable",
  });
}
