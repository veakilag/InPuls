import { SignalLabLocalStore } from "./signal-lab.js";
import { evaluateSignalLabScalp } from "./signal-lab-scalping-strategies.js";
import {
  DEFAULT_PAPER_CONFIG,
  SignalLabPaperEngine,
} from "./signal-lab-paper-trading.js";

const BUILD = "signal-lab-forward-paper-v1";
const STORAGE_KEY = "inpuls-signal-lab-paper-v1";
const POLL_MS = 2_000;
const SNAPSHOT_LOOKBACK_MS = 10 * 60_000;
const INPLAY_ORDER_KEY = "inpuls-inplay-order-v1";

const PATTERN_MAP = Object.freeze({
  cascade: "cascade_breakout",
  breakout_resistance: "level_breakout",
  breakout_support: "level_breakout",
  knife: "knife_reclaim",
  sharpening: "sharpening_rejection",
  size_supporter: "liquidity_hold",
  rearranger: "liquidity_rearrangement",
  liquidation_cascade: "liquidation_cascade",
});

const REVERSAL_PATTERNS = new Set([
  "knife_reclaim",
  "sharpening_rejection",
  "false_breakout",
]);

const elements = {
  status: document.querySelector("#paper-status"),
  session: document.querySelector("#paper-session"),
  equity: document.querySelector("#paper-equity"),
  return: document.querySelector("#paper-return"),
  open: document.querySelector("#paper-open"),
  trades: document.querySelector("#paper-trades"),
  winRate: document.querySelector("#paper-win-rate"),
  profitFactor: document.querySelector("#paper-profit-factor"),
  expectancy: document.querySelector("#paper-expectancy"),
  netR: document.querySelector("#paper-net-r"),
  rejected: document.querySelector("#paper-rejected"),
  openBody: document.querySelector("#paper-open-body"),
  tradesBody: document.querySelector("#paper-trades-body"),
  strategyBody: document.querySelector("#paper-strategy-body"),
  refresh: document.querySelector("#paper-refresh"),
  exportJson: document.querySelector("#paper-export"),
  reset: document.querySelector("#paper-reset"),
};

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const cleanSymbol = (value) => String(value ?? "").trim().toUpperCase();
const formatNumber = (value, digits = 2) => {
  const number = finite(value);
  return number === null ? "—" : number.toFixed(digits);
};
const formatPercent = (value, digits = 2) => {
  const number = finite(value);
  return number === null ? "—" : `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
};
const formatR = (value) => {
  const number = finite(value);
  return number === null ? "—" : `${number >= 0 ? "+" : ""}${number.toFixed(3)}R`;
};
const formatMoney = (value) => {
  const number = finite(value);
  return number === null
    ? "—"
    : new Intl.NumberFormat("ru-RU", { style: "currency", currency: "USD" }).format(number);
};
const formatTime = (value) => {
  const number = finite(value);
  return number === null
    ? "—"
    : new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(number));
};

function loadJson(key, fallback = null) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function restoreEngine() {
  const saved = loadJson(STORAGE_KEY, null);
  const startedAt = finite(saved?.startedAt) ?? Date.now();
  const engine = new SignalLabPaperEngine({
    config: saved?.config ?? DEFAULT_PAPER_CONFIG,
    initialEquity: finite(saved?.initialEquity) ?? DEFAULT_PAPER_CONFIG.initialEquity,
    equity: finite(saved?.equity) ?? DEFAULT_PAPER_CONFIG.initialEquity,
    startedAt,
  });
  if (!saved || saved.version !== "signal-lab-paper-v1") return engine;
  engine.initialEquity = finite(saved.initialEquity) ?? engine.initialEquity;
  engine.equity = finite(saved.equity) ?? engine.equity;
  engine.startedAt = startedAt;
  engine.updatedAt = finite(saved.updatedAt) ?? startedAt;
  engine.positions = new Map(
    (Array.isArray(saved.positions) ? saved.positions : [])
      .filter((position) => position?.status === "open" && position?.id)
      .map((position) => [position.id, Object.freeze(position)]),
  );
  engine.trades = (Array.isArray(saved.trades) ? saved.trades : [])
    .filter((trade) => trade?.status === "closed")
    .slice(-engine.config.maximumStoredTrades)
    .map((trade) => Object.freeze(trade));
  engine.processedEpisodeIds = new Set([
    ...(Array.isArray(saved.processedEpisodeIds) ? saved.processedEpisodeIds : []),
    ...[...engine.positions.values()].map((position) => position.episodeId),
    ...engine.trades.map((trade) => trade.episodeId),
  ]);
  return engine;
}

const signalStore = new SignalLabLocalStore();
let engine = restoreEngine();
let polling = false;
let timer = null;
let scanDiagnostics = new Map();
let latestScanAt = null;

function persistEngine() {
  saveJson(STORAGE_KEY, engine.snapshot());
}

function inplaySymbols() {
  const value = loadJson(INPLAY_ORDER_KEY, []);
  return new Set((Array.isArray(value) ? value : []).slice(0, 18).map(cleanSymbol));
}

function observationsByEvent(snapshot) {
  const grouped = new Map();
  for (const observation of snapshot.observations ?? []) {
    const values = grouped.get(observation.eventId) ?? [];
    values.push(observation);
    grouped.set(observation.eventId, values);
  }
  return grouped;
}

function contextByEvent(snapshot) {
  return new Map((snapshot.contexts ?? []).map((context) => [context.eventId, context]));
}

function liveObservation(observations, horizon) {
  return observations.find((observation) => (
    observation?.horizon === horizon
    && observation?.state === "observed"
    && observation?.quality?.state === "live"
    && finite(observation?.finalPrice) !== null
  )) ?? null;
}

function directEvidencePrices(evidence = {}) {
  if (!evidence || typeof evidence !== "object") return [];
  return [
    evidence.level,
    evidence.levelPrice,
    evidence.referencePrice,
    evidence.breakoutLevel,
    evidence.support,
    evidence.resistance,
  ].map(finite).filter((value) => value !== null && value > 0);
}

function deriveInvalidation(event, context, confirmation) {
  const entryPrice = finite(confirmation?.finalPrice);
  if (!(entryPrice > 0)) return null;
  const candidates = [];
  candidates.push(...directEvidencePrices(event?.detectorEvidence));

  const candles = Array.isArray(context?.chartContext?.candles)
    ? context.chartContext.candles.slice(-8)
    : [];
  for (const candle of candles) {
    const value = event.direction === "up" ? finite(candle?.low) : finite(candle?.high);
    if (value !== null && value > 0) candidates.push(value);
  }
  for (const point of confirmation?.pricePath ?? []) {
    const value = finite(point?.price);
    if (value !== null && value > 0) candidates.push(value);
  }

  const structural = event.direction === "up"
    ? candidates.filter((value) => value < entryPrice).sort((left, right) => right - left)[0]
    : candidates.filter((value) => value > entryPrice).sort((left, right) => left - right)[0];
  if (!(structural > 0)) return null;
  const buffered = event.direction === "up" ? structural * 0.9998 : structural * 1.0002;
  const riskPercent = Math.abs(entryPrice - buffered) / entryPrice * 100;
  return riskPercent >= 0.05 && riskPercent <= 1.5 ? buffered : null;
}

function supportingLiquidityEpisodes(event, context) {
  const expectedSide = event.direction === "up" ? "bid" : "ask";
  return (context?.liquidity?.episodes ?? []).filter((episode) => episode?.side === expectedSide);
}

function opposingLiquidityEpisodes(event, context) {
  const expectedSide = event.direction === "up" ? "ask" : "bid";
  return (context?.liquidity?.episodes ?? []).filter((episode) => episode?.side === expectedSide);
}

function confirmationSet(event, context, observation) {
  const confirmations = new Set();
  const volumeAcceleration = finite(context?.market?.volumeAcceleration);
  const buyShare = finite(context?.trades?.aggressiveBuySharePercent);
  const directionalReturn = finite(observation?.directionalReturnPercent);
  const mfe = finite(observation?.mfePercent);
  const mae = Math.abs(finite(observation?.maePercent) ?? 0);
  const patternId = PATTERN_MAP[event.signalType] ?? event.signalType;

  if (volumeAcceleration !== null && volumeAcceleration >= 1.2) {
    confirmations.add("trade_acceleration");
  }
  if (volumeAcceleration !== null && volumeAcceleration >= 1.5) {
    confirmations.add("volume_expansion");
  }
  if (buyShare !== null) {
    const directionalShare = event.direction === "up" ? buyShare : 100 - buyShare;
    if (directionalShare >= 58) confirmations.add("aggressor_dominance");
  }
  if (directionalReturn !== null && directionalReturn > 0 && (mfe ?? 0) >= 0.04 && (mfe ?? 0) >= mae) {
    confirmations.add(REVERSAL_PATTERNS.has(patternId) ? "price_rejection" : "price_acceptance");
  }

  const supporting = supportingLiquidityEpisodes(event, context);
  if (supporting.some((episode) => (
    episode.interaction !== "unobserved"
    && ["standing", "strengthening", "replenished"].includes(episode.state)
  ))) confirmations.add("book_hold");
  if (supporting.some((episode) => episode.state === "replenished")) {
    confirmations.add("book_replenishment");
  }
  if (opposingLiquidityEpisodes(event, context).some((episode) => (
    ["pulled", "moved"].includes(episode.resolution)
    || episode.state === "removed"
  ))) confirmations.add("book_removal");

  if ((finite(context?.liquidations?.totalQuote) ?? 0) > 0) {
    confirmations.add("liquidation_burst");
  }
  return confirmations;
}

function buildScalpPlan(event, context, observation, now, currentInplay) {
  const patternId = PATTERN_MAP[event.signalType] ?? event.signalType;
  const invalidationPrice = deriveInvalidation(event, context, observation);
  const confirmations = confirmationSet(event, context, observation);
  const observedSpread = finite(context?.liquidity?.spreadBps);
  const latencyMs = (() => {
    const capturedAt = finite(context?.capturedAt);
    const updatedAt = finite(context?.market?.updatedAt);
    return capturedAt !== null && updatedAt !== null ? Math.max(0, capturedAt - updatedAt) : 1_500;
  })();
  const episode = {
    id: `paper-episode:${event.id}`,
    primaryEventId: event.id,
    symbol: event.symbol,
    patternId,
    direction: event.direction,
    state: "confirmed",
    candidateStartedAt: event.triggeredAt,
    triggeredAt: event.triggeredAt,
    confirmedAt: observation.finalPriceAt,
    lastEventAt: observation.finalPriceAt,
    referencePrice: event.price,
    lastPrice: observation.finalPrice,
    invalidationPrice,
    confirmations: [...confirmations],
  };
  const executionContext = {
    confirmations: [...confirmations],
    inplay: currentInplay.has(cleanSymbol(event.symbol)),
    pathQuality: observation?.quality?.state,
    spreadBps: observedSpread ?? 8,
    spreadSource: observedSpread === null ? "conservative-unobserved-cap" : "live-order-book",
    latencyMs,
  };
  return evaluateSignalLabScalp(episode, executionContext, { now });
}

function orderedFuturePoints(observations, openedAt) {
  const values = [];
  const seen = new Set();
  for (const observation of observations) {
    if (observation?.state !== "observed" || observation?.quality?.state !== "live") continue;
    for (const point of observation.pricePath ?? []) {
      const at = finite(point?.at);
      const price = finite(point?.price);
      if (at === null || price === null || price <= 0 || at <= openedAt) continue;
      const key = `${at}:${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      values.push({ at, price });
    }
  }
  return values.sort((left, right) => left.at - right.at);
}

function recordDiagnostic(reason) {
  scanDiagnostics.set(reason, (scanDiagnostics.get(reason) ?? 0) + 1);
}

async function scan() {
  if (polling) return;
  polling = true;
  try {
    const now = Date.now();
    const sinceAt = Math.max(0, engine.startedAt - SNAPSHOT_LOOKBACK_MS);
    const snapshot = await signalStore.snapshot({ sinceAt, untilAt: now });
    const contexts = contextByEvent(snapshot);
    const groupedObservations = observationsByEvent(snapshot);
    const currentInplay = inplaySymbols();
    scanDiagnostics = new Map();

    for (const event of snapshot.events ?? []) {
      if ((finite(event?.triggeredAt) ?? 0) < engine.startedAt) continue;
      const patternId = PATTERN_MAP[event.signalType] ?? event.signalType;
      const observations = groupedObservations.get(event.id) ?? [];
      const confirmation = liveObservation(observations, "15s");
      if (!confirmation) {
        recordDiagnostic("ожидается подтверждение 15с");
        continue;
      }
      if (!engine.processedEpisodeIds.has(`paper-episode:${event.id}`)) {
        const plan = buildScalpPlan(
          { ...event, signalType: event.signalType, patternId },
          contexts.get(event.id) ?? null,
          confirmation,
          now,
          currentInplay,
        );
        if (plan.accepted) {
          const opened = engine.consider(plan, {
            episodeId: `paper-episode:${event.id}`,
            eventId: event.id,
            openedAt: confirmation.finalPriceAt,
          });
          if (!opened.opened) recordDiagnostic(opened.reason);
        } else {
          for (const reason of plan.reasons ?? ["сигнал отклонён"]) recordDiagnostic(reason);
        }
      }

      const position = [...engine.positions.values()]
        .find((item) => item.eventId === event.id);
      if (!position) continue;
      for (const point of orderedFuturePoints(observations, position.openedAt)) {
        if (![...engine.positions.values()].some((item) => item.id === position.id)) break;
        engine.updatePrice({ symbol: event.symbol, price: point.price, at: point.at });
      }
    }

    latestScanAt = now;
    engine.updatedAt = Math.max(engine.updatedAt, now);
    persistEngine();
    render();
  } catch (error) {
    elements.status.dataset.state = "error";
    elements.status.textContent = `Ошибка paper runtime: ${String(error?.message || error).slice(0, 160)}`;
  } finally {
    polling = false;
  }
}

function cell(row, value, className = "") {
  const node = document.createElement("td");
  node.textContent = value;
  if (className) node.className = className;
  row.append(node);
}

function renderOpenPositions(report) {
  elements.openBody.replaceChildren();
  for (const position of report.openPositions) {
    const row = document.createElement("tr");
    cell(row, position.symbol);
    cell(row, position.strategyLabel || position.strategyId);
    cell(row, position.direction === "up" ? "LONG" : "SHORT");
    cell(row, formatNumber(position.entryFillPrice, 6));
    cell(row, formatNumber(position.activeStopPrice, 6));
    cell(row, formatNumber(position.targetPrice, 6));
    cell(row, formatR(position.maximumFavorableR));
    cell(row, formatR(position.maximumAdverseR));
    cell(row, formatTime(position.expiresAt));
    elements.openBody.append(row);
  }
  if (!report.openPositions.length) {
    const row = document.createElement("tr");
    const node = document.createElement("td");
    node.colSpan = 9;
    node.className = "paper-empty";
    node.textContent = "Открытых виртуальных позиций нет";
    row.append(node);
    elements.openBody.append(row);
  }
}

function renderTrades(report) {
  elements.tradesBody.replaceChildren();
  for (const trade of [...report.trades].reverse().slice(0, 100)) {
    const row = document.createElement("tr");
    cell(row, formatTime(trade.closedAt));
    cell(row, trade.symbol);
    cell(row, trade.strategyLabel || trade.strategyId);
    cell(row, trade.direction === "up" ? "LONG" : "SHORT");
    cell(row, trade.closeReason);
    cell(row, formatR(trade.netR), trade.netR >= 0 ? "paper-positive" : "paper-negative");
    cell(row, formatMoney(trade.netPnl), trade.netPnl >= 0 ? "paper-positive" : "paper-negative");
    cell(row, formatR(trade.maximumFavorableR));
    cell(row, formatR(trade.maximumAdverseR));
    elements.tradesBody.append(row);
  }
  if (!report.trades.length) {
    const row = document.createElement("tr");
    const node = document.createElement("td");
    node.colSpan = 9;
    node.className = "paper-empty";
    node.textContent = "Forward-сделок пока нет. Основной InPuls должен оставаться открытым и собирать Signal Lab.";
    row.append(node);
    elements.tradesBody.append(row);
  }
}

function renderStrategies(report) {
  elements.strategyBody.replaceChildren();
  for (const strategy of report.summary.strategies) {
    const row = document.createElement("tr");
    cell(row, strategy.strategyLabel);
    cell(row, String(strategy.trades));
    cell(row, formatPercent(strategy.winRatePercent));
    cell(row, strategy.profitFactor === Infinity ? "∞" : formatNumber(strategy.profitFactor, 3));
    cell(row, formatR(strategy.expectancyR));
    cell(row, formatR(strategy.netR));
    cell(row, formatR(-strategy.maximumDrawdownR));
    elements.strategyBody.append(row);
  }
  if (!report.summary.strategies.length) {
    const row = document.createElement("tr");
    const node = document.createElement("td");
    node.colSpan = 7;
    node.className = "paper-empty";
    node.textContent = "Рейтинг появится после первых закрытых сделок";
    row.append(node);
    elements.strategyBody.append(row);
  }
}

function render() {
  const report = engine.report();
  const summary = report.summary.overall;
  elements.status.dataset.state = "available";
  elements.status.textContent = latestScanAt
    ? `Forward paper работает · последняя проверка ${formatTime(latestScanAt)}`
    : "Forward paper запускается…";
  elements.session.textContent = formatTime(report.startedAt);
  elements.equity.textContent = formatMoney(report.equity);
  elements.return.textContent = formatPercent(report.returnPercent);
  elements.open.textContent = String(report.openPositions.length);
  elements.trades.textContent = String(summary.trades);
  elements.winRate.textContent = formatPercent(summary.winRatePercent);
  elements.profitFactor.textContent = summary.profitFactor === Infinity
    ? "∞"
    : formatNumber(summary.profitFactor, 3);
  elements.expectancy.textContent = formatR(summary.expectancyR);
  elements.netR.textContent = formatR(summary.netR);
  elements.rejected.textContent = [...scanDiagnostics.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(" · ") || "нет готовых кандидатов";
  renderOpenPositions(report);
  renderTrades(report);
  renderStrategies(report);
}

function exportReport() {
  const payload = {
    build: BUILD,
    exportedAt: Date.now(),
    report: engine.report(),
    diagnostics: Object.fromEntries(scanDiagnostics),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `inpuls-signal-paper-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function resetSession() {
  localStorage.removeItem(STORAGE_KEY);
  engine = new SignalLabPaperEngine({
    config: DEFAULT_PAPER_CONFIG,
    startedAt: Date.now(),
  });
  scanDiagnostics = new Map();
  persistEngine();
  render();
  scan();
}

elements.refresh.addEventListener("click", scan);
elements.exportJson.addEventListener("click", exportReport);
elements.reset.addEventListener("click", resetSession);

await signalStore.initialize();
render();
await scan();
timer = setInterval(scan, POLL_MS);
window.addEventListener("beforeunload", () => {
  clearInterval(timer);
  persistEngine();
});

window.inpulsSignalPaper = Object.freeze({
  report: () => engine.report(),
  scan,
  reset: resetSession,
  build: BUILD,
});
