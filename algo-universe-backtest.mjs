import process from "node:process";

import {
  createBreakoutAtrStrategy,
  runTrainTest,
} from "./algo-backtest.js";
import { fetchBinanceFuturesKlines } from "./binance-history.js";
import { createBinanceRequestScheduler } from "./binance-request.js";
import { fetchCurrentInPlayUniverse } from "./inplay-universe.js";

const DEFAULT_FIXED_SYMBOLS = Object.freeze(["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"]);
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}USDT$/;

function usage() {
  return [
    "Usage:",
    "  node algo-universe-backtest.mjs --interval 1m --days 30",
    "",
    "Optional:",
    "  --symbols BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT",
    "  --inplay-limit 18",
    "  --min-v24 100",
    "  --min-natr1 0.5",
    "  --min-natr5 0.8",
    "  --min-growth24 3",
    "  --concurrency 1",
    "  --request-delay-ms 500",
    "",
    "The run always combines the fixed comparison universe with a current INPLAY snapshot.",
    "All Binance HTTP requests share one scheduler, run sequentially and retry slowly on 418/429/5xx.",
  ].join("\n");
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(usage());
    options[key.slice(2)] = value;
  }
  return options;
}

function parseNumber(value, fallback, { min = -Infinity, max = Infinity, integer = false, label } = {}) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new RangeError(`${label} must be ${integer ? "an integer " : ""}between ${min} and ${max}`);
  }
  return number;
}

function parseNullableNumber(value) {
  if (value === undefined || value === "" || String(value).toLowerCase() === "null") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`invalid numeric filter: ${value}`);
  return number;
}

function parseSymbols(value) {
  const source = value === undefined ? DEFAULT_FIXED_SYMBOLS : String(value).split(",");
  const symbols = [...new Set(source.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length || symbols.some((symbol) => !SYMBOL_PATTERN.test(symbol))) {
    throw new RangeError("symbols must be comma-separated USDT futures symbols");
  }
  return symbols;
}

function createPool(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || queue.length === 0) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });
}

function printableMetrics(metrics) {
  return {
    trades: metrics.trades,
    winRatePercent: Number((metrics.winRate * 100).toFixed(2)),
    profitFactor: Number.isFinite(metrics.profitFactor) ? Number(metrics.profitFactor.toFixed(3)) : "Infinity",
    netPnl: Number(metrics.netPnl.toFixed(4)),
    returnPercent: Number(metrics.returnPercent.toFixed(3)),
    maxDrawdownPercent: Number((metrics.maxDrawdownPercent * 100).toFixed(3)),
    averageR: Number(metrics.averageR.toFixed(3)),
    totalFees: Number(metrics.totalFees.toFixed(4)),
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(results, failures) {
  const successful = results.filter((item) => !item.error);
  const returns = successful.map((item) => item.test.returnPercent);
  const finiteProfitFactors = successful
    .map((item) => item.test.profitFactor)
    .filter(Number.isFinite);
  return {
    requestedSymbols: results.length,
    completedSymbols: successful.length,
    failedSymbols: failures.length,
    profitableOutOfSample: successful.filter((item) => item.test.netPnl > 0).length,
    totalOutOfSampleTrades: successful.reduce((sum, item) => sum + item.test.trades, 0),
    medianOutOfSampleReturnPercent: returns.length ? Number(median(returns).toFixed(3)) : null,
    averageFiniteOutOfSampleProfitFactor: finiteProfitFactors.length
      ? Number((finiteProfitFactors.reduce((sum, value) => sum + value, 0) / finiteProfitFactors.length).toFixed(3))
      : null,
  };
}

async function runSymbol({ symbol, source, interval, days, endTime, requestScheduler }) {
  const candles = await fetchBinanceFuturesKlines({
    symbol,
    interval,
    startTime: endTime - days * 24 * 60 * 60_000,
    endTime,
    requestScheduler,
  });
  const strategyFactory = () => createBreakoutAtrStrategy({
    lookback: 20,
    atrPeriod: 14,
    stopAtr: 1,
    rewardRisk: 1.5,
    minVolumeRatio: 1.2,
  });
  const result = runTrainTest({
    candles,
    strategyFactory,
    trainRatio: 0.7,
    contextBars: 100,
    config: {
      initialEquity: 1_000,
      riskPerTrade: 0.0025,
      feeRate: 0.0005,
      slippageRate: 0.0002,
      maxLeverage: 1,
    },
  });
  return {
    symbol,
    source,
    candles: candles.length,
    splitTime: new Date(result.splitTime).toISOString(),
    train: printableMetrics(result.train.metrics),
    test: printableMetrics(result.test.metrics),
  };
}

try {
  const options = parseOptions(process.argv.slice(2));
  const interval = options.interval ?? "1m";
  const days = parseNumber(options.days, 30, { min: 1, max: 365, label: "days" });
  const inplayLimit = parseNumber(options["inplay-limit"], 18, { min: 1, max: 100, integer: true, label: "inplay-limit" });
  const concurrency = parseNumber(options.concurrency, 1, { min: 1, max: 4, integer: true, label: "concurrency" });
  const requestDelayMs = parseNumber(options["request-delay-ms"], 500, { min: 250, max: 10_000, integer: true, label: "request-delay-ms" });
  const fixedSymbols = parseSymbols(options.symbols);
  const endTime = Date.now();
  const rules = {
    minV24: parseNullableNumber(options["min-v24"] ?? 100),
    minNatr1: parseNullableNumber(options["min-natr1"]),
    minNatr5: parseNullableNumber(options["min-natr5"]),
    minGrowth24: parseNullableNumber(options["min-growth24"]),
  };
  const requestScheduler = createBinanceRequestScheduler({ minIntervalMs: requestDelayMs });

  const inplay = await fetchCurrentInPlayUniverse({
    rules,
    limit: inplayLimit,
    now: endTime,
    concurrency,
    requestScheduler,
  });
  const inplaySymbols = inplay.matches.map((item) => item.symbol);
  const combinedSymbols = [...new Set([...fixedSymbols, ...inplaySymbols])];
  const fixedSet = new Set(fixedSymbols);
  const inplaySet = new Set(inplaySymbols);
  const sourceFor = (symbol) => fixedSet.has(symbol) && inplaySet.has(symbol)
    ? "fixed+current-inplay"
    : inplaySet.has(symbol) ? "current-inplay" : "fixed";

  const run = createPool(concurrency);
  const settled = await Promise.all(combinedSymbols.map((symbol) => run(async () => {
    try {
      return await runSymbol({
        symbol,
        source: sourceFor(symbol),
        interval,
        days,
        endTime,
        requestScheduler,
      });
    } catch (error) {
      return { symbol, source: sourceFor(symbol), error: error.message };
    }
  })));
  const failures = settled.filter((item) => item.error).map((item) => ({ symbol: item.symbol, error: item.error }));
  const results = settled
    .filter((item) => !item.error)
    .sort((left, right) => right.test.returnPercent - left.test.returnPercent);

  console.log(JSON.stringify({
    selection: {
      capturedAt: new Date(inplay.capturedAt).toISOString(),
      fixedSymbols,
      currentInPlaySymbols: inplaySymbols,
      combinedSymbols,
      inplayRules: inplay.rules,
      inplayScanned: inplay.scanned,
      inplayMetricFailures: inplay.failed,
      requestPolicy: {
        sequential: true,
        minIntervalMs: requestDelayMs,
        retryStatuses: [418, 429, "5xx"],
        maxRetries: 4,
      },
      selectionBiasWarning: "Current INPLAY is a present-time snapshot. Historical results on this snapshot are diagnostic and must not replace point-in-time universe reconstruction.",
    },
    interval,
    days,
    summary: summarize(settled, failures),
    results,
    failures,
  }, null, 2));
} catch (error) {
  console.error(`Universe backtest failed: ${error.message}`);
  process.exitCode = 1;
}
