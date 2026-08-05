import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateAtr,
  createBreakoutAtrStrategy,
  normalizeCandles,
  parseBinanceKlines,
  runBacktest,
  runTrainTest,
} from "./algo-backtest.js";

function candle(time, open, high, low, close, volume = 100) {
  return { time, open, high, low, close, volume };
}

function constantSignalStrategy({ side = "long", signalIndex = 1, stopDistance = 1, targetDistance = 2 } = {}) {
  return {
    id: "test-strategy",
    warmupBars: 0,
    prepare(candles) {
      return { candles };
    },
    signal({ index }) {
      return index === signalIndex
        ? { side, stopDistance, targetDistance, signalTime: index }
        : null;
    },
  };
}

test("normalizeCandles rejects inconsistent OHLC and unordered timestamps", () => {
  assert.throws(() => normalizeCandles([
    candle(2, 10, 11, 9, 10),
    candle(1, 10, 11, 9, 10),
  ]), /strictly increasing/);

  assert.throws(() => normalizeCandles([
    candle(1, 10, 9, 8, 10),
    candle(2, 10, 11, 9, 10),
  ]), /inconsistent OHLC/);
});

test("signals execute at the next candle open instead of the signal close", () => {
  const candles = [
    candle(0, 100, 101, 99, 100),
    candle(1, 100, 102, 99, 101),
    candle(2, 110, 113, 109.5, 112),
    candle(3, 112, 113, 111, 112),
  ];

  const result = runBacktest(candles, constantSignalStrategy({ signalIndex: 1 }), {
    initialEquity: 1_000,
    riskPerTrade: 0.01,
    feeRate: 0,
    slippageRate: 0,
    maxLeverage: 10,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryIndex, 2);
  assert.equal(result.trades[0].entryPrice, 110);
  assert.equal(result.trades[0].reason, "target");
});

test("position size risks the configured equity fraction when leverage is sufficient", () => {
  const candles = [
    candle(0, 100, 101, 99, 100),
    candle(1, 100, 101, 99, 100),
    candle(2, 100, 100.5, 98, 99),
  ];

  const result = runBacktest(candles, constantSignalStrategy({ signalIndex: 1, stopDistance: 1, targetDistance: 5 }), {
    initialEquity: 1_000,
    riskPerTrade: 0.01,
    feeRate: 0,
    slippageRate: 0,
    maxLeverage: 10,
  });

  assert.equal(result.trades[0].riskCash, 10);
  assert.equal(result.trades[0].quantity, 10);
  assert.equal(result.trades[0].netPnl, -10);
});

test("leverage cap prevents oversized risk-based positions", () => {
  const candles = [
    candle(0, 100, 101, 99, 100),
    candle(1, 100, 101, 99, 100),
    candle(2, 100, 103, 99.95, 102),
  ];

  const result = runBacktest(candles, constantSignalStrategy({ signalIndex: 1, stopDistance: 0.1, targetDistance: 2 }), {
    initialEquity: 1_000,
    riskPerTrade: 0.01,
    feeRate: 0,
    slippageRate: 0,
    maxLeverage: 1,
  });

  assert.equal(result.trades[0].quantity, 10);
  assert.equal(result.trades[0].netPnl, 20);
});

test("fees and adverse slippage are included on entry and exit", () => {
  const candles = [
    candle(0, 100, 101, 99, 100),
    candle(1, 100, 101, 99, 100),
    candle(2, 100, 103, 99, 102),
  ];

  const result = runBacktest(candles, constantSignalStrategy({ signalIndex: 1, stopDistance: 1, targetDistance: 2 }), {
    initialEquity: 1_000,
    riskPerTrade: 0.01,
    feeRate: 0.001,
    slippageRate: 0.001,
    maxLeverage: 10,
  });

  const trade = result.trades[0];
  assert.equal(trade.entryPrice, 100.1);
  assert.ok(trade.exitPrice < trade.targetPrice);
  assert.ok(trade.fees > 0);
  assert.ok(trade.netPnl < trade.grossPnl);
});

test("when stop and target are both touched in one candle, the stop wins conservatively", () => {
  const candles = [
    candle(0, 100, 101, 99, 100),
    candle(1, 100, 101, 99, 100),
    candle(2, 100, 103, 98, 100),
  ];

  const result = runBacktest(candles, constantSignalStrategy({ signalIndex: 1, stopDistance: 1, targetDistance: 2 }), {
    initialEquity: 1_000,
    riskPerTrade: 0.01,
    feeRate: 0,
    slippageRate: 0,
    maxLeverage: 10,
  });

  assert.equal(result.trades[0].reason, "stop");
  assert.equal(result.trades[0].netPnl, -10);
});

test("a stop gap exits at the worse opening price", () => {
  const candles = [
    candle(0, 100, 101, 99, 100),
    candle(1, 100, 101, 99, 100),
    candle(2, 100, 100.5, 99.5, 100),
    candle(3, 95, 96, 94, 95),
  ];

  const result = runBacktest(candles, constantSignalStrategy({ signalIndex: 1, stopDistance: 2, targetDistance: 5 }), {
    initialEquity: 1_000,
    riskPerTrade: 0.01,
    feeRate: 0,
    slippageRate: 0,
    maxLeverage: 10,
  });

  assert.equal(result.trades[0].reason, "gap_stop");
  assert.equal(result.trades[0].exitPrice, 95);
  assert.equal(result.trades[0].netPnl, -25);
});

test("short trades use mirrored stop and target logic", () => {
  const candles = [
    candle(0, 100, 101, 99, 100),
    candle(1, 100, 101, 99, 100),
    candle(2, 100, 100.5, 97, 98),
  ];

  const result = runBacktest(candles, constantSignalStrategy({ side: "short", signalIndex: 1, stopDistance: 1, targetDistance: 2 }), {
    initialEquity: 1_000,
    riskPerTrade: 0.01,
    feeRate: 0,
    slippageRate: 0,
    maxLeverage: 10,
  });

  assert.equal(result.trades[0].reason, "target");
  assert.equal(result.trades[0].netPnl, 20);
});

test("ATR is calculated without future candles", () => {
  const candles = [
    candle(0, 10, 12, 9, 11),
    candle(1, 11, 13, 10, 12),
    candle(2, 12, 15, 11, 14),
    candle(3, 14, 30, 13, 29),
  ];
  const atr = calculateAtr(candles, 3);
  assert.equal(atr[0], null);
  assert.equal(atr[1], null);
  assert.equal(atr[2], (3 + 3 + 4) / 3);
  assert.equal(atr[2], calculateAtr(candles.slice(0, 3), 3)[2]);
});

test("breakout strategy only looks at completed previous-window levels", () => {
  const candles = [
    candle(0, 100, 101, 99, 100, 100),
    candle(1, 100, 102, 99, 101, 100),
    candle(2, 101, 103, 100, 102, 100),
    candle(3, 102, 105, 101, 105, 300),
    candle(4, 106, 108, 105, 107, 100),
  ];
  const strategy = createBreakoutAtrStrategy({
    lookback: 3,
    atrPeriod: 3,
    stopAtr: 1,
    rewardRisk: 1.5,
    minVolumeRatio: 1,
    allowShort: false,
  });
  const context = strategy.prepare(candles);
  const signal = strategy.signal({ index: 3, context });
  assert.equal(signal.side, "long");
  assert.equal(signal.metadata.previousHigh, 103);
});

test("train/test split keeps test trades at or after the split boundary", () => {
  const candles = Array.from({ length: 30 }, (_, index) => candle(index, 100, 102, 98, 100, 100));
  const result = runTrainTest({
    candles,
    trainRatio: 0.7,
    contextBars: 5,
    strategyFactory: () => constantSignalStrategy({ signalIndex: 5, stopDistance: 1, targetDistance: 1 }),
    config: {
      initialEquity: 1_000,
      riskPerTrade: 0.01,
      feeRate: 0,
      slippageRate: 0,
      maxLeverage: 1,
    },
  });

  assert.equal(result.splitIndex, 21);
  assert.equal(result.test.trades.length, 1);
  assert.ok(result.test.trades.every((trade) => trade.entryTime >= result.splitTime));
});

test("Binance kline rows are converted to normalized candles", () => {
  const parsed = parseBinanceKlines([
    [1, "100", "102", "99", "101", "12.5", 2],
    [2, "101", "103", "100", "102", "15", 3],
  ]);
  assert.deepEqual(parsed[0], { time: 1, open: 100, high: 102, low: 99, close: 101, volume: 12.5 });
});
