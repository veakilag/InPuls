import { readFile } from "node:fs/promises";
import process from "node:process";

import {
  createBreakoutAtrStrategy,
  parseBinanceKlines,
  runTrainTest,
} from "./algo-backtest.js";
import { fetchBinanceFuturesKlines } from "./binance-history.js";

function usage() {
  return [
    "Usage:",
    "  node algo-backtest-cli.mjs <binance-klines.json>",
    "  node algo-backtest-cli.mjs --symbol BTCUSDT --interval 1m --days 30",
    "",
    "File input must be a raw JSON array returned by Binance /fapi/v1/klines.",
  ].join("\n");
}

function parseOptions(args) {
  if (args.length === 1 && !args[0].startsWith("--")) return { file: args[0] };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(usage());
    options[key.slice(2)] = value;
  }
  if (!options.symbol) throw new Error(usage());
  return options;
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

async function loadCandles(options) {
  if (options.file) {
    const raw = JSON.parse(await readFile(options.file, "utf8"));
    return parseBinanceKlines(raw);
  }
  const days = Number(options.days ?? 30);
  if (!Number.isFinite(days) || days <= 0 || days > 365) throw new RangeError("days must be between 0 and 365");
  const endTime = Date.now();
  return fetchBinanceFuturesKlines({
    symbol: options.symbol,
    interval: options.interval ?? "1m",
    startTime: endTime - days * 24 * 60 * 60_000,
    endTime,
  });
}

try {
  const options = parseOptions(process.argv.slice(2));
  const candles = await loadCandles(options);
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

  console.log(JSON.stringify({
    candles: candles.length,
    strategy: result.train.strategy,
    splitTime: new Date(result.splitTime).toISOString(),
    train: printableMetrics(result.train.metrics),
    test: printableMetrics(result.test.metrics),
  }, null, 2));
} catch (error) {
  console.error(`Backtest failed: ${error.message}`);
  process.exitCode = 1;
}
