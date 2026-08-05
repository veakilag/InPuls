import { readFile } from "node:fs/promises";
import process from "node:process";
import { runBacktest } from "./algo-backtest.js";
import { buildResearchCandidates } from "./algo-research-strategies.js";
import { aggregateCandles } from "./inplay-universe.js";

function argsMap(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || args[i + 1] === undefined) throw new Error("Expected --key value arguments");
    out[args[i].slice(2)] = args[i + 1];
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.split(",");
    const row = { time: +c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] };
    if ([row.time, row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite)) rows.push(row);
  }
  rows.sort((a, b) => a.time - b.time);
  return rows.filter((row, index) => index === 0 || row.time !== rows[index - 1].time);
}

function lowerBound(rows, time) {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sliceSegment(rows, start, end, context = 300) {
  const first = lowerBound(rows, start);
  const last = lowerBound(rows, end);
  if (last - first < 100) return null;
  const from = Math.max(0, first - context);
  return { rows: rows.slice(from, last), startIndex: first - from };
}

function aggregateRuns(runs) {
  const trades = runs.flatMap(({ symbol, result }) => result.trades.map((trade) => ({ ...trade, symbol })));
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const profit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const loss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const netPnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const bySymbol = runs.map(({ symbol, result }) => ({
    symbol,
    trades: result.metrics.trades,
    winRate: result.metrics.winRate,
    profitFactor: result.metrics.profitFactor,
    averageR: result.metrics.averageR,
    netPnl: result.metrics.netPnl,
  }));
  return {
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: loss > 1e-12 ? profit / loss : (profit > 0 ? Infinity : 0),
    averageR: trades.length ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length : 0,
    expectancyCash: trades.length ? netPnl / trades.length : 0,
    netPnl,
    totalFees: trades.reduce((sum, trade) => sum + trade.fees, 0),
    positiveSymbols: bySymbol.filter((row) => row.netPnl > 0).length,
    symbolsTested: bySymbol.length,
    bySymbol,
  };
}

function evaluate(candidate, data, symbols, segment, config) {
  const runs = [];
  for (const symbol of symbols) {
    const rows = data.get(symbol);
    if (!rows) continue;
    const sample = sliceSegment(rows, segment.start, segment.end);
    if (!sample) continue;
    runs.push({
      symbol,
      result: runBacktest(sample.rows, candidate.factory(), { ...config, startIndex: sample.startIndex }),
    });
  }
  return aggregateRuns(runs);
}

function finite(value) {
  return Number.isFinite(value) ? value : 9;
}

function score(train, validation) {
  return Math.min(train.averageR, validation.averageR) * 5
    + Math.min(finite(train.profitFactor), finite(validation.profitFactor), 5)
    + Math.min(train.winRate, validation.winRate) * 2
    + Math.log1p(Math.min(train.trades, validation.trades)) * 0.25;
}

function compact(metrics, detailed = false) {
  const out = {
    trades: metrics.trades,
    winRatePercent: +(metrics.winRate * 100).toFixed(2),
    profitFactor: Number.isFinite(metrics.profitFactor) ? +metrics.profitFactor.toFixed(3) : "Infinity",
    averageR: +metrics.averageR.toFixed(3),
    expectancyCash: +metrics.expectancyCash.toFixed(4),
    netPnl: +metrics.netPnl.toFixed(4),
    totalFees: +metrics.totalFees.toFixed(4),
    positiveSymbols: metrics.positiveSymbols,
    symbolsTested: metrics.symbolsTested,
  };
  if (detailed) out.bySymbol = metrics.bySymbol.map((row) => ({
    symbol: row.symbol,
    trades: row.trades,
    winRatePercent: +(row.winRate * 100).toFixed(2),
    profitFactor: Number.isFinite(row.profitFactor) ? +row.profitFactor.toFixed(3) : "Infinity",
    averageR: +row.averageR.toFixed(3),
    netPnl: +row.netPnl.toFixed(4),
  }));
  return out;
}

const options = argsMap(process.argv.slice(2));
const pairs = String(options.inputs ?? "").split(",").filter(Boolean);
if (!pairs.length) throw new Error("Missing --inputs");
const data = new Map();
for (const pair of pairs) {
  const split = pair.indexOf("=");
  if (split < 1) continue;
  const symbol = pair.slice(0, split).toUpperCase();
  const rows = parseCsv(await readFile(pair.slice(split + 1), "utf8"));
  if (rows.length >= 10_000) data.set(symbol, aggregateCandles(rows, 5));
}
const allSymbols = [...data.keys()].sort();
const selection = String(options["selection-symbols"] ?? "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT")
  .split(",").map((value) => value.trim().toUpperCase()).filter((symbol) => data.has(symbol)).slice(0, 4);
if (selection.length < 4) throw new Error("Four core selection symbols are required");

const segments = {
  train: { start: Date.parse("2026-01-01T00:00:00Z"), end: Date.parse("2026-06-01T00:00:00Z") },
  validation: { start: Date.parse("2026-06-01T00:00:00Z"), end: Date.parse("2026-07-01T00:00:00Z") },
  holdout: { start: Date.parse("2026-07-01T00:00:00Z"), end: Date.parse("2026-08-01T00:00:00Z") },
};
const costs = { initialEquity: 1_000, riskPerTrade: 0.0025, feeRate: 0.0005, slippageRate: 0.0002, maxLeverage: 3 };
const doubleCosts = { ...costs, feeRate: 0.001, slippageRate: 0.0004 };
const candidates = buildResearchCandidates().filter((candidate) => candidate.family !== "cascade");
const screened = [];
for (const candidate of candidates) {
  const train = evaluate(candidate, data, selection, segments.train, costs);
  const validation = evaluate(candidate, data, selection, segments.validation, costs);
  const eligible = train.trades >= 30 && validation.trades >= 10
    && train.profitFactor > 1 && validation.profitFactor > 1
    && train.averageR > 0 && validation.averageR > 0;
  screened.push({ candidate, train, validation, eligible, score: score(train, validation) });
}
const pool = screened.filter((row) => row.eligible).sort((a, b) => b.score - a.score);
const selected = (pool.length ? pool : screened.sort((a, b) => b.score - a.score)).slice(0, 30);
const results = [];
for (const row of selected) {
  const holdout = evaluate(row.candidate, data, allSymbols, segments.holdout, costs);
  const stressed = evaluate(row.candidate, data, allSymbols, segments.holdout, doubleCosts);
  const strictPass = holdout.trades >= 30 && holdout.profitFactor > 2 && holdout.winRate > 0.4
    && holdout.averageR > 1 && stressed.profitFactor > 1 && stressed.averageR > 0;
  results.push({ ...row, holdout, stressed, strictPass });
}
results.sort((a, b) => Number(b.strictPass) - Number(a.strictPass)
  || b.holdout.averageR - a.holdout.averageR
  || finite(b.holdout.profitFactor) - finite(a.holdout.profitFactor));

function report(row, detailed = false) {
  return {
    id: row.candidate.id,
    family: row.candidate.family,
    timeframe: "5m",
    parameters: row.candidate.parameters,
    preHoldoutScore: +row.score.toFixed(4),
    strictPass: row.strictPass,
    train: compact(row.train),
    validation: compact(row.validation),
    holdout: compact(row.holdout, detailed),
    doubledCostsHoldout: compact(row.stressed),
  };
}
const strict = results.filter((row) => row.strictPass);
console.log(JSON.stringify({
  methodology: {
    source: "official Binance USD-M monthly 1m archives aggregated to 5m",
    train: "2026-01-01/2026-06-01",
    validation: "2026-06-01/2026-07-01",
    untouchedHoldout: "2026-07-01/2026-08-01",
    selectionSymbols: selection,
    holdoutSymbols: allSymbols,
    variantsTested: candidates.length,
    eligibleBeforeHoldout: pool.length,
    evaluatedOnHoldout: selected.length,
    gate: "trades >= 30; PF > 2; WR > 40%; averageR > 1 after costs; positive under doubled costs",
    costs,
    doubledCosts: doubleCosts,
  },
  strictCandidatesFound: strict.length,
  strictCandidates: strict.slice(0, 10).map((row) => report(row, true)),
  bestHoldoutCandidates: results.slice(0, 10).map((row) => report(row, true)),
}, null, 2));
