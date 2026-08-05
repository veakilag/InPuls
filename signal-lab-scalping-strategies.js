import { normalizePatternId } from "./signal-lab-v2-catalog.js";

export const SIGNAL_LAB_SCALPING_VERSION = "signal-lab-scalping-v1";

const CONFIRMED_STATES = new Set(["confirmed", "weakening"]);
const FAST_STATES = new Set(["triggered", "confirmed", "weakening"]);

const STRATEGIES = Object.freeze({
  cascade_acceptance: Object.freeze({
    id: "cascade_acceptance",
    label: "Каскад с принятием",
    patterns: Object.freeze(["cascade_breakout"]),
    states: CONFIRMED_STATES,
    requiredConfirmations: Object.freeze(["trade_acceleration", "price_acceptance"]),
    maximumAgeMs: 90_000,
    maximumHoldMs: 300_000,
    partialAtR: 1.2,
    finalAtR: 2.5,
  }),
  level_breakout_retest: Object.freeze({
    id: "level_breakout_retest",
    label: "Пробой уровня после тестов",
    patterns: Object.freeze(["level_breakout"]),
    states: CONFIRMED_STATES,
    requiredConfirmations: Object.freeze(["trade_acceleration", "price_acceptance"]),
    maximumAgeMs: 120_000,
    maximumHoldMs: 300_000,
    partialAtR: 1.0,
    finalAtR: 2.2,
  }),
  false_breakout_reclaim: Object.freeze({
    id: "false_breakout_reclaim",
    label: "Ложный пробой с возвратом",
    patterns: Object.freeze(["false_breakout"]),
    states: CONFIRMED_STATES,
    requiredConfirmations: Object.freeze(["price_rejection", "trade_acceleration"]),
    maximumAgeMs: 60_000,
    maximumHoldMs: 180_000,
    partialAtR: 1.0,
    finalAtR: 2.0,
  }),
  impulse_reversal: Object.freeze({
    id: "impulse_reversal",
    label: "Нож / заточка с быстрым возвратом",
    patterns: Object.freeze(["knife_reclaim", "sharpening_rejection"]),
    states: FAST_STATES,
    requiredConfirmations: Object.freeze(["price_rejection"]),
    anyConfirmations: Object.freeze(["trade_acceleration", "volume_expansion", "aggressor_dominance"]),
    maximumAgeMs: 30_000,
    maximumHoldMs: 180_000,
    partialAtR: 0.8,
    finalAtR: 1.8,
  }),
  compression_expansion: Object.freeze({
    id: "compression_expansion",
    label: "Выход из сжатия",
    patterns: Object.freeze(["compression_breakout"]),
    states: CONFIRMED_STATES,
    requiredConfirmations: Object.freeze(["volume_expansion", "trade_acceleration"]),
    maximumAgeMs: 90_000,
    maximumHoldMs: 300_000,
    partialAtR: 1.0,
    finalAtR: 2.5,
  }),
  liquidity_hold_reaction: Object.freeze({
    id: "liquidity_hold_reaction",
    label: "Удержание наблюдаемой ликвидности",
    patterns: Object.freeze(["liquidity_hold"]),
    states: CONFIRMED_STATES,
    requiredConfirmations: Object.freeze(["book_hold"]),
    anyConfirmations: Object.freeze(["book_replenishment", "aggressor_dominance", "price_rejection"]),
    maximumAgeMs: 30_000,
    maximumHoldMs: 120_000,
    partialAtR: 0.8,
    finalAtR: 1.5,
  }),
});

export const SIGNAL_LAB_SCALPING_STRATEGIES = STRATEGIES;

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const boolean = (value) => value === true;

const collectConfirmations = (episode = {}, context = {}) => {
  const values = [
    ...(Array.isArray(episode.confirmations) ? episode.confirmations : []),
    ...(Array.isArray(context.confirmations) ? context.confirmations : []),
    ...(Array.isArray(context.confirmationIds) ? context.confirmationIds : []),
  ];
  return new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean));
};

const latestTimestamp = (episode = {}) => {
  const values = [
    episode.confirmedAt,
    episode.triggeredAt,
    episode.lastEventAt,
    episode.candidateStartedAt,
  ].map(finite).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
};

const findStrategy = (patternId) => Object.values(STRATEGIES)
  .find((strategy) => strategy.patterns.includes(patternId)) ?? null;

const directionalPrice = (entry, distance, direction, multiplier) => (
  direction === "up"
    ? entry + distance * multiplier
    : entry - distance * multiplier
);

export function evaluateSignalLabScalp(episode = {}, context = {}, {
  now = Date.now(),
  maximumSpreadBps = 8,
  maximumLatencyMs = 1_500,
  requireInplay = true,
} = {}) {
  const reasons = [];
  const patternId = normalizePatternId(episode.patternId ?? episode.signalType);
  const strategy = findStrategy(patternId);
  const direction = episode.direction;
  const state = episode.state ?? episode.patternState;
  const entryPrice = finite(episode.lastPrice ?? episode.price ?? episode.referencePrice);
  const invalidationPrice = finite(episode.invalidationPrice ?? context.invalidationPrice);
  const eventAt = latestTimestamp(episode);
  const confirmations = collectConfirmations(episode, context);
  const spreadBps = finite(context.spreadBps ?? context.orderBookSpreadBps);
  const latencyMs = finite(context.latencyMs ?? context.marketDataLatencyMs);
  const pathQuality = context.pathQuality ?? context.quality ?? "unknown";
  const inplay = context.inplay ?? context.isInplay;

  if (!strategy) reasons.push("pattern-not-scalping-enabled");
  if (!["up", "down"].includes(direction)) reasons.push("direction-required");
  if (strategy && !strategy.states.has(state)) reasons.push("episode-not-ready");
  if (entryPrice === null || entryPrice <= 0) reasons.push("entry-price-required");
  if (invalidationPrice === null || invalidationPrice <= 0) reasons.push("invalidation-price-required");
  if (entryPrice !== null && invalidationPrice !== null) {
    if (direction === "up" && invalidationPrice >= entryPrice) reasons.push("invalid-long-invalidation");
    if (direction === "down" && invalidationPrice <= entryPrice) reasons.push("invalid-short-invalidation");
  }
  if (eventAt === null || now < eventAt) reasons.push("event-time-invalid");
  if (strategy && eventAt !== null && now - eventAt > strategy.maximumAgeMs) reasons.push("signal-stale");
  if (requireInplay && !boolean(inplay)) reasons.push("not-inplay");
  if (pathQuality !== "live") reasons.push("market-path-not-live");
  if (spreadBps === null || spreadBps > maximumSpreadBps) reasons.push("spread-too-wide-or-unknown");
  if (latencyMs === null || latencyMs > maximumLatencyMs) reasons.push("latency-too-high-or-unknown");

  if (strategy) {
    for (const confirmation of strategy.requiredConfirmations) {
      if (!confirmations.has(confirmation)) reasons.push(`missing:${confirmation}`);
    }
    if (strategy.anyConfirmations?.length
      && !strategy.anyConfirmations.some((confirmation) => confirmations.has(confirmation))) {
      reasons.push(`missing-any:${strategy.anyConfirmations.join("|")}`);
    }
  }

  if (reasons.length) {
    return Object.freeze({
      accepted: false,
      version: SIGNAL_LAB_SCALPING_VERSION,
      strategyId: strategy?.id ?? null,
      patternId,
      reasons: Object.freeze([...new Set(reasons)]),
    });
  }

  const riskDistance = Math.abs(entryPrice - invalidationPrice);
  const riskPercent = riskDistance / entryPrice * 100;
  if (!(riskDistance > 0) || riskPercent > 1.5) {
    return Object.freeze({
      accepted: false,
      version: SIGNAL_LAB_SCALPING_VERSION,
      strategyId: strategy.id,
      patternId,
      reasons: Object.freeze([riskPercent > 1.5 ? "stop-too-wide-for-scalp" : "zero-risk-distance"]),
    });
  }

  return Object.freeze({
    accepted: true,
    version: SIGNAL_LAB_SCALPING_VERSION,
    strategyId: strategy.id,
    strategyLabel: strategy.label,
    patternId,
    symbol: String(episode.symbol ?? "").trim().toUpperCase(),
    direction,
    entryPrice,
    stopPrice: invalidationPrice,
    partialPrice: directionalPrice(entryPrice, riskDistance, direction, strategy.partialAtR),
    targetPrice: directionalPrice(entryPrice, riskDistance, direction, strategy.finalAtR),
    partialAtR: strategy.partialAtR,
    targetAtR: strategy.finalAtR,
    maximumHoldMs: strategy.maximumHoldMs,
    riskPercent,
    confirmations: Object.freeze([...confirmations]),
  });
}
