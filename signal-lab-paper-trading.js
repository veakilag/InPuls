export const SIGNAL_LAB_PAPER_VERSION = "signal-lab-paper-v1";

export const DEFAULT_PAPER_CONFIG = Object.freeze({
  initialEquity: 1_000,
  riskPerTradePercent: 0.25,
  feeBpsPerSide: 5,
  slippageBpsPerSide: 2,
  partialFraction: 0.5,
  moveStopToEntryAfterPartial: true,
  maximumOpenPositions: 3,
  maximumStoredTrades: 5_000,
  oneOpenPositionPerSymbol: true,
});

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const positive = (value, fallback) => {
  const number = finite(value);
  return number !== null && number > 0 ? number : fallback;
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const cleanSymbol = (value) => String(value ?? "").trim().toUpperCase();
const cleanText = (value, maximum = 160) => String(value ?? "").trim().slice(0, maximum);

function normalizedConfig(config = {}) {
  return Object.freeze({
    initialEquity: positive(config.initialEquity, DEFAULT_PAPER_CONFIG.initialEquity),
    riskPerTradePercent: clamp(
      positive(config.riskPerTradePercent, DEFAULT_PAPER_CONFIG.riskPerTradePercent),
      0.01,
      5,
    ),
    feeBpsPerSide: clamp(
      finite(config.feeBpsPerSide) ?? DEFAULT_PAPER_CONFIG.feeBpsPerSide,
      0,
      100,
    ),
    slippageBpsPerSide: clamp(
      finite(config.slippageBpsPerSide) ?? DEFAULT_PAPER_CONFIG.slippageBpsPerSide,
      0,
      100,
    ),
    partialFraction: clamp(
      finite(config.partialFraction) ?? DEFAULT_PAPER_CONFIG.partialFraction,
      0,
      0.95,
    ),
    moveStopToEntryAfterPartial: config.moveStopToEntryAfterPartial !== false,
    maximumOpenPositions: Math.max(
      1,
      Math.floor(positive(
        config.maximumOpenPositions,
        DEFAULT_PAPER_CONFIG.maximumOpenPositions,
      )),
    ),
    maximumStoredTrades: Math.max(
      100,
      Math.floor(positive(
        config.maximumStoredTrades,
        DEFAULT_PAPER_CONFIG.maximumStoredTrades,
      )),
    ),
    oneOpenPositionPerSymbol: config.oneOpenPositionPerSymbol !== false,
  });
}

function adverseFill(price, direction, action, slippageBps) {
  const rate = slippageBps / 10_000;
  if (action === "entry") {
    return direction === "up" ? price * (1 + rate) : price * (1 - rate);
  }
  return direction === "up" ? price * (1 - rate) : price * (1 + rate);
}

function grossPnl(direction, entryFillPrice, exitFillPrice, quantity) {
  return direction === "up"
    ? (exitFillPrice - entryFillPrice) * quantity
    : (entryFillPrice - exitFillPrice) * quantity;
}

function stopWasHit(position, price) {
  return position.direction === "up"
    ? price <= position.activeStopPrice
    : price >= position.activeStopPrice;
}

function levelWasHit(position, price, level) {
  return position.direction === "up" ? price >= level : price <= level;
}

function excursionR(position, price) {
  const signed = position.direction === "up"
    ? price - position.entrySignalPrice
    : position.entrySignalPrice - price;
  return signed / position.signalRiskDistance;
}

function freezePosition(position) {
  return Object.freeze({
    ...position,
    confirmations: Object.freeze([...(position.confirmations ?? [])]),
    fills: Object.freeze((position.fills ?? []).map((fill) => Object.freeze({ ...fill }))),
  });
}

export function createPaperPosition(plan, {
  episodeId = null,
  eventId = null,
  openedAt = Date.now(),
  equity = DEFAULT_PAPER_CONFIG.initialEquity,
  config = DEFAULT_PAPER_CONFIG,
} = {}) {
  if (!plan?.accepted) throw new TypeError("Accepted Signal Lab scalp plan is required");
  const normalized = normalizedConfig(config);
  const direction = plan.direction;
  const entrySignalPrice = positive(plan.entryPrice, null);
  const stopPrice = positive(plan.stopPrice, null);
  const partialPrice = positive(plan.partialPrice, null);
  const targetPrice = positive(plan.targetPrice, null);
  const maximumHoldMs = positive(plan.maximumHoldMs, null);
  const symbol = cleanSymbol(plan.symbol);
  if (!["up", "down"].includes(direction)) throw new TypeError("Paper direction is required");
  if (!symbol || !entrySignalPrice || !stopPrice || !partialPrice || !targetPrice) {
    throw new TypeError("Paper position requires symbol and positive price levels");
  }
  if (direction === "up" && !(stopPrice < entrySignalPrice && entrySignalPrice < partialPrice && partialPrice < targetPrice)) {
    throw new RangeError("Invalid long paper levels");
  }
  if (direction === "down" && !(stopPrice > entrySignalPrice && entrySignalPrice > partialPrice && partialPrice > targetPrice)) {
    throw new RangeError("Invalid short paper levels");
  }

  const entryFillPrice = adverseFill(
    entrySignalPrice,
    direction,
    "entry",
    normalized.slippageBpsPerSide,
  );
  const stopFillPrice = adverseFill(
    stopPrice,
    direction,
    "exit",
    normalized.slippageBpsPerSide,
  );
  const feeRate = normalized.feeBpsPerSide / 10_000;
  const lossBeforeFees = Math.abs(entryFillPrice - stopFillPrice);
  const roundTripStopFeesPerUnit = (entryFillPrice + stopFillPrice) * feeRate;
  const riskPerUnit = lossBeforeFees + roundTripStopFeesPerUnit;
  if (!(riskPerUnit > 0)) throw new RangeError("Paper risk per unit must be positive");

  const safeEquity = positive(equity, normalized.initialEquity);
  const riskBudget = safeEquity * normalized.riskPerTradePercent / 100;
  const quantity = riskBudget / riskPerUnit;
  const entryFee = entryFillPrice * quantity * feeRate;
  const at = Math.max(0, Math.floor(finite(openedAt) ?? Date.now()));
  const sourceEpisodeId = cleanText(episodeId || plan.episodeId || eventId || `${symbol}:${at}`);
  const sourceEventId = cleanText(eventId || plan.eventId || sourceEpisodeId);

  return freezePosition({
    entity: "SignalLabPaperPosition",
    version: SIGNAL_LAB_PAPER_VERSION,
    id: `paper:${sourceEpisodeId}`,
    episodeId: sourceEpisodeId,
    eventId: sourceEventId,
    strategyId: cleanText(plan.strategyId, 80),
    strategyLabel: cleanText(plan.strategyLabel, 120),
    patternId: cleanText(plan.patternId, 80),
    symbol,
    direction,
    status: "open",
    openedAt: at,
    expiresAt: at + maximumHoldMs,
    closedAt: null,
    entrySignalPrice,
    entryFillPrice,
    stopPrice,
    activeStopPrice: stopPrice,
    partialPrice,
    targetPrice,
    signalRiskDistance: Math.abs(entrySignalPrice - stopPrice),
    riskPerUnit,
    riskBudget,
    initialEquity: safeEquity,
    initialQuantity: quantity,
    openQuantity: quantity,
    closedQuantity: 0,
    partialFraction: normalized.partialFraction,
    partialFilled: false,
    partialFilledAt: null,
    partialFillPrice: null,
    movedStopToEntry: false,
    entryFee,
    exitFees: 0,
    grossPnl: 0,
    netPnl: null,
    netR: null,
    closeReason: null,
    lastPrice: entrySignalPrice,
    lastPriceAt: at,
    maximumFavorableR: 0,
    maximumAdverseR: 0,
    confirmations: [...(plan.confirmations ?? [])],
    fills: [{
      kind: "entry",
      at,
      marketPrice: entrySignalPrice,
      fillPrice: entryFillPrice,
      quantity,
      fee: entryFee,
    }],
  });
}

function closeQuantity(position, {
  marketPrice,
  quantity,
  at,
  kind,
  config,
}) {
  const normalized = normalizedConfig(config);
  const closeSize = Math.min(position.openQuantity, Math.max(0, quantity));
  if (!(closeSize > 0)) return position;
  const fillPrice = adverseFill(
    marketPrice,
    position.direction,
    "exit",
    normalized.slippageBpsPerSide,
  );
  const fee = fillPrice * closeSize * normalized.feeBpsPerSide / 10_000;
  const pnl = grossPnl(position.direction, position.entryFillPrice, fillPrice, closeSize);
  return freezePosition({
    ...position,
    openQuantity: Math.max(0, position.openQuantity - closeSize),
    closedQuantity: position.closedQuantity + closeSize,
    grossPnl: position.grossPnl + pnl,
    exitFees: position.exitFees + fee,
    fills: [...position.fills, {
      kind,
      at,
      marketPrice,
      fillPrice,
      quantity: closeSize,
      fee,
      grossPnl: pnl,
    }],
  });
}

function finalizePosition(position, reason, at) {
  const totalFees = position.entryFee + position.exitFees;
  const netPnl = position.grossPnl - totalFees;
  return freezePosition({
    ...position,
    status: "closed",
    closedAt: at,
    closeReason: reason,
    netPnl,
    netR: position.riskBudget > 0 ? netPnl / position.riskBudget : null,
    openQuantity: 0,
  });
}

export function applyPaperPrice(position, {
  price,
  at = Date.now(),
} = {}, config = DEFAULT_PAPER_CONFIG) {
  if (!position || position.entity !== "SignalLabPaperPosition") {
    throw new TypeError("SignalLabPaperPosition is required");
  }
  if (position.status !== "open") return position;
  const marketPrice = positive(price, null);
  const timestamp = Math.max(0, Math.floor(finite(at) ?? Date.now()));
  if (!marketPrice || timestamp < position.lastPriceAt) return position;

  const nextR = excursionR(position, marketPrice);
  let next = freezePosition({
    ...position,
    lastPrice: marketPrice,
    lastPriceAt: timestamp,
    maximumFavorableR: Math.max(position.maximumFavorableR, nextR),
    maximumAdverseR: Math.min(position.maximumAdverseR, nextR),
  });

  if (stopWasHit(next, marketPrice)) {
    next = closeQuantity(next, {
      marketPrice: next.activeStopPrice,
      quantity: next.openQuantity,
      at: timestamp,
      kind: next.partialFilled ? "breakeven-stop" : "stop",
      config,
    });
    return finalizePosition(next, next.partialFilled ? "breakeven-stop" : "stop", timestamp);
  }

  if (!next.partialFilled && levelWasHit(next, marketPrice, next.partialPrice)) {
    const closeSize = next.initialQuantity * normalizedConfig(config).partialFraction;
    next = closeQuantity(next, {
      marketPrice: next.partialPrice,
      quantity: closeSize,
      at: timestamp,
      kind: "partial",
      config,
    });
    next = freezePosition({
      ...next,
      partialFilled: true,
      partialFilledAt: timestamp,
      partialFillPrice: next.fills.at(-1)?.fillPrice ?? null,
      activeStopPrice: normalizedConfig(config).moveStopToEntryAfterPartial
        ? next.entrySignalPrice
        : next.activeStopPrice,
      movedStopToEntry: normalizedConfig(config).moveStopToEntryAfterPartial,
    });
  }

  if (next.openQuantity > 0 && levelWasHit(next, marketPrice, next.targetPrice)) {
    next = closeQuantity(next, {
      marketPrice: next.targetPrice,
      quantity: next.openQuantity,
      at: timestamp,
      kind: "target",
      config,
    });
    return finalizePosition(next, "target", timestamp);
  }

  if (timestamp >= next.expiresAt) {
    next = closeQuantity(next, {
      marketPrice,
      quantity: next.openQuantity,
      at: timestamp,
      kind: "time-stop",
      config,
    });
    return finalizePosition(next, "time-stop", timestamp);
  }

  return next;
}

export function forceClosePaperPosition(position, {
  price,
  at = Date.now(),
  reason = "invalidated",
} = {}, config = DEFAULT_PAPER_CONFIG) {
  if (!position || position.entity !== "SignalLabPaperPosition") {
    throw new TypeError("SignalLabPaperPosition is required");
  }
  if (position.status !== "open") return position;
  const marketPrice = positive(price, position.lastPrice);
  const timestamp = Math.max(position.lastPriceAt, Math.floor(finite(at) ?? Date.now()));
  const next = closeQuantity(position, {
    marketPrice,
    quantity: position.openQuantity,
    at: timestamp,
    kind: cleanText(reason, 40) || "forced-close",
    config,
  });
  return finalizePosition(next, cleanText(reason, 80) || "forced-close", timestamp);
}

function metricSummary(trades = []) {
  const closed = trades.filter((trade) => trade?.status === "closed" && finite(trade.netPnl) !== null);
  const wins = closed.filter((trade) => trade.netPnl > 0);
  const losses = closed.filter((trade) => trade.netPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const netPnl = closed.reduce((sum, trade) => sum + trade.netPnl, 0);
  const netR = closed.reduce((sum, trade) => sum + (finite(trade.netR) ?? 0), 0);
  let runningR = 0;
  let peakR = 0;
  let maximumDrawdownR = 0;
  for (const trade of [...closed].sort((left, right) => left.closedAt - right.closedAt)) {
    runningR += finite(trade.netR) ?? 0;
    peakR = Math.max(peakR, runningR);
    maximumDrawdownR = Math.max(maximumDrawdownR, peakR - runningR);
  }
  return Object.freeze({
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRatePercent: closed.length ? wins.length / closed.length * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    expectancyR: closed.length ? netR / closed.length : null,
    netR,
    netPnl,
    grossProfit,
    grossLoss,
    maximumDrawdownR,
  });
}

export function summarizePaperTrades(trades = []) {
  const groups = new Map();
  for (const trade of trades) {
    const key = cleanText(trade?.strategyId || "unknown", 80);
    const values = groups.get(key) ?? [];
    values.push(trade);
    groups.set(key, values);
  }
  return Object.freeze({
    overall: metricSummary(trades),
    strategies: Object.freeze([...groups.entries()]
      .map(([strategyId, values]) => Object.freeze({
        strategyId,
        strategyLabel: cleanText(values[0]?.strategyLabel || strategyId, 120),
        ...metricSummary(values),
      }))
      .sort((left, right) => (
        (right.expectancyR ?? -Infinity) - (left.expectancyR ?? -Infinity)
        || right.trades - left.trades
      ))),
  });
}

export class SignalLabPaperEngine {
  constructor(options = {}) {
    this.config = normalizedConfig(options.config ?? options);
    this.initialEquity = positive(options.initialEquity, this.config.initialEquity);
    this.equity = positive(options.equity, this.initialEquity);
    this.positions = new Map();
    this.trades = [];
    this.processedEpisodeIds = new Set();
    this.startedAt = Math.max(0, Math.floor(finite(options.startedAt) ?? Date.now()));
    this.updatedAt = this.startedAt;
    this.restore(options.snapshot ?? null);
  }

  restore(snapshot) {
    if (!snapshot || snapshot.version !== SIGNAL_LAB_PAPER_VERSION) return false;
    this.initialEquity = positive(snapshot.initialEquity, this.initialEquity);
    this.equity = positive(snapshot.equity, this.equity);
    this.startedAt = Math.max(0, Math.floor(finite(snapshot.startedAt) ?? this.startedAt));
    this.updatedAt = Math.max(this.startedAt, Math.floor(finite(snapshot.updatedAt) ?? this.updatedAt));
    this.positions = new Map(
      (Array.isArray(snapshot.positions) ? snapshot.positions : [])
        .filter((position) => position?.entity === "SignalLabPaperPosition" && position.status === "open")
        .map((position) => [position.id, freezePosition(position)]),
    );
    this.trades = (Array.isArray(snapshot.trades) ? snapshot.trades : [])
      .filter((trade) => trade?.entity === "SignalLabPaperPosition" && trade.status === "closed")
      .slice(-this.config.maximumStoredTrades)
      .map(freezePosition);
    this.processedEpisodeIds = new Set([
      ...(Array.isArray(snapshot.processedEpisodeIds) ? snapshot.processedEpisodeIds : []),
      ...this.positions.values().map((position) => position.episodeId),
      ...this.trades.map((trade) => trade.episodeId),
    ]);
    return true;
  }

  consider(plan, metadata = {}) {
    if (!plan?.accepted) return Object.freeze({ opened: false, reason: "plan-rejected" });
    const episodeId = cleanText(
      metadata.episodeId || plan.episodeId || metadata.eventId || plan.eventId,
    );
    if (!episodeId) return Object.freeze({ opened: false, reason: "episode-id-required" });
    if (this.processedEpisodeIds.has(episodeId)) {
      return Object.freeze({ opened: false, reason: "episode-already-processed" });
    }
    if (this.positions.size >= this.config.maximumOpenPositions) {
      return Object.freeze({ opened: false, reason: "maximum-open-positions" });
    }
    if (this.config.oneOpenPositionPerSymbol) {
      const symbol = cleanSymbol(plan.symbol);
      if ([...this.positions.values()].some((position) => position.symbol === symbol)) {
        return Object.freeze({ opened: false, reason: "symbol-position-already-open" });
      }
    }
    const position = createPaperPosition(plan, {
      episodeId,
      eventId: metadata.eventId || plan.eventId,
      openedAt: metadata.openedAt,
      equity: this.equity,
      config: this.config,
    });
    this.positions.set(position.id, position);
    this.processedEpisodeIds.add(episodeId);
    this.updatedAt = Math.max(this.updatedAt, position.openedAt);
    return Object.freeze({ opened: true, position });
  }

  updatePrice(update = {}) {
    const symbol = cleanSymbol(update.symbol);
    const price = positive(update.price, null);
    const at = Math.max(0, Math.floor(finite(update.at) ?? Date.now()));
    if (!symbol || !price) return Object.freeze({ updated: 0, closed: Object.freeze([]) });
    const closed = [];
    let updated = 0;
    for (const [id, position] of [...this.positions]) {
      if (position.symbol !== symbol) continue;
      const next = applyPaperPrice(position, { price, at }, this.config);
      if (next === position) continue;
      updated += 1;
      if (next.status === "closed") {
        this.positions.delete(id);
        this.equity += next.netPnl;
        this.trades.push(next);
        this.trades = this.trades.slice(-this.config.maximumStoredTrades);
        closed.push(next);
      } else {
        this.positions.set(id, next);
      }
    }
    this.updatedAt = Math.max(this.updatedAt, at);
    return Object.freeze({ updated, closed: Object.freeze(closed) });
  }

  invalidate({ episodeId = null, symbol = null, price = null, at = Date.now(), reason = "invalidated" } = {}) {
    const normalizedEpisodeId = cleanText(episodeId);
    const normalizedSymbol = cleanSymbol(symbol);
    const closed = [];
    for (const [id, position] of [...this.positions]) {
      if (normalizedEpisodeId && position.episodeId !== normalizedEpisodeId) continue;
      if (!normalizedEpisodeId && normalizedSymbol && position.symbol !== normalizedSymbol) continue;
      const trade = forceClosePaperPosition(position, {
        price: positive(price, position.lastPrice),
        at,
        reason,
      }, this.config);
      this.positions.delete(id);
      this.equity += trade.netPnl;
      this.trades.push(trade);
      closed.push(trade);
    }
    this.trades = this.trades.slice(-this.config.maximumStoredTrades);
    this.updatedAt = Math.max(this.updatedAt, Math.floor(finite(at) ?? Date.now()));
    return Object.freeze(closed);
  }

  report() {
    return Object.freeze({
      version: SIGNAL_LAB_PAPER_VERSION,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      initialEquity: this.initialEquity,
      equity: this.equity,
      returnPercent: (this.equity - this.initialEquity) / this.initialEquity * 100,
      openPositions: Object.freeze([...this.positions.values()]),
      trades: Object.freeze([...this.trades]),
      summary: summarizePaperTrades(this.trades),
      config: this.config,
    });
  }

  snapshot() {
    return Object.freeze({
      version: SIGNAL_LAB_PAPER_VERSION,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      initialEquity: this.initialEquity,
      equity: this.equity,
      positions: Object.freeze([...this.positions.values()]),
      trades: Object.freeze([...this.trades]),
      processedEpisodeIds: Object.freeze([...this.processedEpisodeIds]),
      config: this.config,
    });
  }
}
