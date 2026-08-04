import { readFile } from "node:fs/promises";
import process from "node:process";
import { runBacktest } from "./algo-backtest.js";
import { buildResearchCandidates } from "./algo-research-strategies.js";
import { aggregateCandles } from "./inplay-universe.js";

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --key value arguments");
    result[key.slice(2)] = value;
  }
  return result;
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = line.split(",");
    const candle = {
      time: Number(columns[0]),
      open: Number(columns[1]),
      high: Number(columns[2]),
      low: Number(columns[3]),
      close: Number(columns[4]),
      volume: Number(columns[5]),
    };
    if ([candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)) rows.push(candle);
  }
  rows.sort((left, right) => left.time - right.time);
  const deduplicated = [];
  for (const candle of rows) {
    if (deduplicated.at(-1)?.time === candle.time) deduplicated[deduplicated.length - 1] = candle;
    else deduplicated.push(candle);
  }
  return deduplicated;
}

function lowerBound(candles, time) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function segmentSlice(candles, startTime, endTime, contextBars = 600) {
  const start = lowerBound(candles, startTime);
  const end = lowerBound(candles, endTime);
  if (end - start < 100) return null;
  const contextStart = Math.max(0, start - contextBars);
  return {
    candles: candles.slice(contextStart, end),
    startIndex: start - contextStart,
  };
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function summarizeTrades(symbolRuns) {
  const trades = symbolRuns.flatMap((run) => run.trades.map((trade) => ({ ...trade, symbol: run.symbol })));
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const netPnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const averageR = trades.length ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length : 0;
  const expectancyCash = trades.length ? netPnl / trades.length : 0;
  const profitFactor = grossLoss > 1e-12 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const bySymbol = symbolRuns.map((run) => {
    const metrics = run.result.metrics;
    return {
      symbol: run.symbol,
      trades: metrics.trades,
      winRate: metrics.winRate,
      profitFactor: metrics.profitFactor,
      averageR: metrics.averageR,
      netPnl: metrics.netPnl,
    };
  });
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor,
    averageR,
    expectancyCash,
    netPnl,
    totalFees: trades.reduce((sum, trade) => sum + trade.fees, 0),
    positiveSymbols: bySymbol.filter((item) => item.netPnl > 0).length,
    symbolsTested: bySymbol.length,
    bySymbol,
  };
}

function roundedMetrics(metrics, includeSymbols = false) {
  const result = {
    trades: metrics.trades,
    winRatePercent: Number((metrics.winRate * 100).toFixed(2)),
    profitFactor: Number.isFinite(metrics.profitFactor) ? Number(metrics.profitFactor.toFixed(3)) : "Infinity",
    averageR: Number(metrics.averageR.toFixed(3)),
    expectancyCash: Number(metrics.expectancyCash.toFixed(4)),
    netPnl: Number(metrics.netPnl.toFixed(4)),
    totalFees: Number(metrics.totalFees.toFixed(4)),
    positiveSymbols: metrics.positiveSymbols,
    symbolsTested: metrics.symbolsTested,
  };
  if (includeSymbols) {
    result.bySymbol = metrics.bySymbol.map((item) => ({
      symbol: item.symbol,
      trades: item.trades,
      winRatePercent: Number((item.winRate * 100).toFixed(2)),
      profitFactor: Number.isFinite(item.profitFactor) ? Number(item.profitFactor.toFixed(3)) : "Infinity",
      averageR: Number(item.averageR.toFixed(3)),
      netPnl: Number(item.netPnl.toFixed(4)),
    }));
  }
  return result;
}

function evaluateVariant({ variant, datasets, symbols, segment, config }) {
  const runs = [];
  for (const symbol of symbols) {
    const data = datasets.get(symbol)?.get(variant.timeframeMinutes);
    if (!data) continue;
    const sliced = segmentSlice(data, segment.start, segment.end);
    if (!sliced) continue;
    const result = runBacktest(sliced.candles, variant.candidate.factory(), {
      ...config,
      startIndex: sliced.startIndex,
    });
    runs.push({ symbol, result, trades: result.trades });
  }
  return summarizeTrades(runs);
}

function scoreStability(train, validation) {
  if (!train.trades || !validation.trades) return -Infinity;
  const pfFloor = Math.min(finite(train.profitFactor), finite(validation.profitFactor), 5);
  const rFloor = Math.min(train.averageR, validation.averageR);
  const winFloor = Math.min(train.winRate, validation.winRate);
  const tradeWeight = Math.log1p(Math.min(train.trades, validation.trades));
  const symbolWeight = Math.min(train.positiveSymbols, validation.positiveSymbols);
  return rFloor * 5 + pfFloor + winFloor * 2 + tradeWeight * 0.25 + symbolWeight * 0.1;
}

function strictPass(metrics, doubled, minimumTrades) {
  return metrics.trades >= minimumTrades
    && metrics.profitFactor > 2
    && metrics.winRate > 0.4
    && metrics.averageR > 1
    && doubled.profitFactor > 1
    && doubled.averageR > 0;
}

const options = parseArgs(process.argv.slice(2));
const inputPairs = String(options.inputs ?? "").split(",").filter(Boolean);
if (!inputPairs.length) throw new Error("Use --inputs BTCUSDT=path.csv,ETHUSDT=path.csv");
const selectionSymbolsRequested = String(options["selection-symbols"] ?? "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT")
  .split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
const topN = Number(options["top-n"] ?? 30);
const minimumHoldoutTrades = Number(options["minimum-holdout-trades"] ?? 30);
if (!Number.isInteger(topN) || topN < 1 || topN > 100) throw new RangeError("top-n must be 1..100");
if (!Number.isInteger(minimumHoldoutTrades) || minimumHoldoutTrades < 10) throw new RangeError("minimum-holdout-trades must be >= 10");

const segments = {
  train: { start: Date.parse(options["train-start"] ?? "2026-01-01T00:00:00Z"), end: Date.parse(options["train-end"] ?? "2026-06-01T00:00:00Z") },
  validation: { start: Date.parse(options["validation-start"] ?? "2026-06-01T00:00:00Z"), end: Date.parse(options["validation-end"] ?? "2026-07-01T00:00:00Z") },
  holdout: { start: Date.parse(options["holdout-start"] ?? "2026-07-01T00:00:00Z"), end: Date.parse(options["holdout-end"] ?? "2026-08-01T00:00:00Z") },
};
for (const [name, segment] of Object.entries(segments)) {
  if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start) throw new RangeError(`${name} segment is invalid`);
}

const datasets = new Map();
for (const pair of inputPairs) {
  const separator = pair.indexOf("=");
  if (separator <= 0 || separator === pair.length - 1) throw new Error(`Invalid input: ${pair}`);
  const symbol = pair.slice(0, separator).toUpperCase();
  const file = pair.slice(separator + 1);
  const oneMinute = parseCsv(await readFile(file, "utf8"));
  if (oneMinute.length < 10_000) continue;
  datasets.set(symbol, new Map([
    [1, oneMinute],
    [5, aggregateCandles(oneMinute, 5)],
  ]));
}
if (!datasets.size) throw new Error("No usable datasets were loaded");

const allSymbols = [...datasets.keys()].sort();
const selectionSymbols = selectionSymbolsRequested.filter((symbol) => datasets.has(symbol));
if (selectionSymbols.length < 2) throw new Error("At least two selection symbols are required");

const baseConfig = {
  initialEquity: 1_000,
  riskPerTrade: 0.0025,
  feeRate: 0.0005,
  slippageRate: 0.0002,
  maxLeverage: 3,
};
const doubledCostConfig = {
  ...baseConfig,
  feeRate: baseConfig.feeRate * 2,
  slippageRate: baseConfig.slippageRate * 2,
};

const variants = [];
for (const candidate of buildResearchCandidates()) {
  for (const timeframeMinutes of [1, 5]) {
    variants.push({
      id: `${candidate.id};timeframe=${timeframeMinutes}m`,
      family: candidate.family,
      parameters: candidate.parameters,
      candidate,
      timeframeMinutes,
    });
  }
}

const screened = [];
for (const variant of variants) {
  const train = evaluateVariant({ variant, datasets, symbols: selectionSymbols, segment: segments.train, config: baseConfig });
  const validation = evaluateVariant({ variant, datasets, symbols: selectionSymbols, segment: segments.validation, config: baseConfig });
  const minimumTrainTrades = variant.timeframeMinutes === 1 ? 60 : 30;
  const minimumValidationTrades = variant.timeframeMinutes === 1 ? 15 : 10;
  const eligible = train.trades >= minimumTrainTrades
    && validation.trades >= minimumValidationTrades
    && train.averageR > 0
    && validation.averageR > 0
    && train.profitFactor > 1
    && validation.profitFactor > 1;
  screened.push({ variant, train, validation, eligible, score: scoreStability(train, validation) });
}

const eligible = screened.filter((item) => item.eligible).sort((left, right) => right.score - left.score);
const fallback = screened.slice().sort((left, right) => right.score - left.score);
const selected = (eligible.length ? eligible : fallback).slice(0, topN);

const holdoutResults = [];
for (const item of selected) {
  const holdout = evaluateVariant({ variant: item.variant, datasets, symbols: allSymbols, segment: segments.holdout, config: baseConfig });
  const doubledCosts = evaluateVariant({ variant: item.variant, datasets, symbols: allSymbols, segment: segments.holdout, config: doubledCostConfig });
  holdoutResults.push({
    ...item,
    holdout,
    doubledCosts,
    strictPass: strictPass(holdout, doubledCosts, minimumHoldoutTrades),
  });
}

holdoutResults.sort((left, right) => {
  if (left.strictPass !== right.strictPass) return left.strictPass ? -1 : 1;
  return right.holdout.averageR - left.holdout.averageR
    || finite(right.holdout.profitFactor) - finite(left.holdout.profitFactor)
    || right.holdout.trades - left.holdout.trades;
});

const strictCandidates = holdoutResults.filter((item) => item.strictPass);
const reportCandidate = (item, includeSymbols = false) => ({
  id: item.variant.id,
  family: item.variant.family,
  timeframe: `${item.variant.timeframeMinutes}m`,
  parameters: item.variant.parameters,
  preHoldoutScore: Number(item.score.toFixed(4)),
  selectedFromEligiblePool: item.eligible,
  strictPass: item.strictPass,
  train: roundedMetrics(item.train),
  validation: roundedMetrics(item.validation),
  holdout: roundedMetrics(item.holdout, includeSymbols),
  doubledCostsHoldout: roundedMetrics(item.doubledCosts),
});

console.log(JSON.stringify({
  methodology: {
    source: "official Binance USD-M monthly 1m archives",
    train: { start: new Date(segments.train.start).toISOString(), end: new Date(segments.train.end).toISOString() },
    validation: { start: new Date(segments.validation.start).toISOString(), end: new Date(segments.validation.end).toISOString() },
    untouchedHoldout: { start: new Date(segments.holdout.start).toISOString(), end: new Date(segments.holdout.end).toISOString() },
    timeframes: ["1m", "5m"],
    selectionSymbols,
    holdoutSymbols: allSymbols,
    variantsTested: variants.length,
    eligibleBeforeHoldout: eligible.length,
    evaluatedOnHoldout: selected.length,
    strictGate: {
      minimumHoldoutTrades,
      profitFactor: "> 2",
      winRate: "> 40%",
      averageR: "> 1R after costs",
      doubledCosts: "profit factor > 1 and averageR > 0",
    },
    costs: baseConfig,
    doubledCosts: doubledCostConfig,
    warning: "Per-symbol simulations are pooled for research and do not model simultaneous portfolio capital usage.",
  },
  strictCandidatesFound: strictCandidates.length,
  strictCandidates: strictCandidates.slice(0, 10).map((item) => reportCandidate(item, true)),
  bestHoldoutCandidates: holdoutResults.slice(0, 10).map((item) => reportCandidate(item, true)),
  bestPreHoldoutCandidates: selected.slice(0, 10).map((item) => reportCandidate(item, false)),
}, null, 2));
