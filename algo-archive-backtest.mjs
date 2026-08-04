import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  createBreakoutAtrStrategy,
  runTrainTest,
} from "./algo-backtest.js";
import { createCascadeStrategy } from "./algo-cascade-strategy.js";

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --key value arguments");
    out[key.slice(2)] = value;
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(",");
    const time = Number(cols[0]);
    if (!Number.isFinite(time)) continue;
    const candle = {
      time,
      open: Number(cols[1]),
      high: Number(cols[2]),
      low: Number(cols[3]),
      close: Number(cols[4]),
      volume: Number(cols[5]),
    };
    if ([candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)) rows.push(candle);
  }
  rows.sort((a, b) => a.time - b.time);
  return rows;
}

function metrics(value) {
  return {
    trades: value.trades,
    winRatePercent: Number((value.winRate * 100).toFixed(2)),
    profitFactor: Number.isFinite(value.profitFactor) ? Number(value.profitFactor.toFixed(3)) : "Infinity",
    netPnl: Number(value.netPnl.toFixed(4)),
    returnPercent: Number(value.returnPercent.toFixed(3)),
    maxDrawdownPercent: Number((value.maxDrawdownPercent * 100).toFixed(3)),
    averageR: Number(value.averageR.toFixed(3)),
    totalFees: Number(value.totalFees.toFixed(4)),
  };
}

function strategyDefinition(name) {
  if (name === "cascade") {
    const parameters = {
      lookback: 240,
      atrPeriod: 14,
      minimumExtrema: 3,
      minimumStepPercent: 0.08,
      minimumWidthPercent: 1,
      maximumWidthPercent: 5,
      stopAtr: 2,
      rewardRisk: 2,
      volumeLookback: 20,
      minimumVolumeRatio: 1,
    };
    return {
      label: "three-extrema 1m cascade v1",
      parameters,
      factory: () => createCascadeStrategy(parameters),
    };
  }
  if (name === "breakout") {
    const parameters = {
      lookback: 20,
      atrPeriod: 14,
      stopAtr: 1,
      rewardRisk: 1.5,
      minVolumeRatio: 1.2,
    };
    return {
      label: "20-candle ATR breakout baseline",
      parameters,
      factory: () => createBreakoutAtrStrategy(parameters),
    };
  }
  throw new RangeError(`Unsupported strategy: ${name}. Use breakout or cascade.`);
}

const options = parseArgs(process.argv.slice(2));
const days = Number(options.days ?? 7);
const inputs = String(options.inputs ?? "").split(",").filter(Boolean);
const strategyName = String(options.strategy ?? "breakout").trim().toLowerCase();
if (!Number.isFinite(days) || days < 1 || !inputs.length) {
  throw new Error("Use --strategy cascade --days 7 --inputs BTCUSDT=path.csv,ETHUSDT=path.csv");
}
const selectedStrategy = strategyDefinition(strategyName);

const config = {
  initialEquity: 1_000,
  riskPerTrade: 0.0025,
  feeRate: 0.0005,
  slippageRate: 0.0002,
  maxLeverage: 1,
};

const results = [];
for (const input of inputs) {
  const separator = input.indexOf("=");
  if (separator <= 0 || separator === input.length - 1) throw new Error(`Invalid input: ${input}`);
  const symbol = input.slice(0, separator).toUpperCase();
  const file = input.slice(separator + 1);
  const all = parseCsv(await readFile(file, "utf8"));
  if (all.length < 1000) throw new Error(`${symbol}: insufficient candles (${all.length})`);
  const endTime = all.at(-1).time;
  const startTime = endTime - days * 24 * 60 * 60_000;
  const candles = all.filter((candle) => candle.time >= startTime && candle.time <= endTime);
  const result = runTrainTest({
    candles,
    strategyFactory: selectedStrategy.factory,
    trainRatio: 0.7,
    contextBars: 300,
    config,
  });
  results.push({
    symbol,
    candles: candles.length,
    from: new Date(candles[0].time).toISOString(),
    to: new Date(candles.at(-1).time).toISOString(),
    splitTime: new Date(result.splitTime).toISOString(),
    train: metrics(result.train.metrics),
    test: metrics(result.test.metrics),
  });
}

results.sort((left, right) => right.test.returnPercent - left.test.returnPercent);
console.log(JSON.stringify({
  source: "official Binance monthly USD-M futures archive",
  interval: "1m",
  days,
  strategyId: strategyName,
  strategy: selectedStrategy.label,
  strategyParameters: selectedStrategy.parameters,
  config,
  results,
}, null, 2));
