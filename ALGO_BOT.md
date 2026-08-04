# InPuls Algo Bot — research baseline v1

This module is intentionally **backtest-only**. It does not use API keys, place orders, or connect to a real account.

## What is included

- dependency-free candle validation;
- a deterministic backtest engine;
- next-candle execution to prevent look-ahead bias;
- long and short trades;
- equity-based position sizing;
- leverage cap;
- fees and adverse slippage on both sides;
- conservative handling when stop and target are touched in one candle (stop first);
- chronological train/test split with indicator context;
- a transparent ATR breakout baseline strategy;
- automatic public Binance USD-M Futures candle download (no API key);
- a CLI for either live history download or saved kline JSON;
- unit tests for the critical accounting and execution rules.

## Baseline strategy

The first strategy is deliberately simple. It is infrastructure validation, not a claim of profitability.

- timeframe: any candle interval supplied by the dataset;
- long: close above the highest high of the previous 20 completed candles;
- short: close below the lowest low of the previous 20 completed candles;
- volume filter: current volume at least 1.2x the previous-window average;
- stop: 1 ATR(14);
- target: 1.5R;
- signal generated after a candle closes;
- entry at the next candle open;
- one position at a time.

Default test assumptions:

- initial equity: 1,000 USDT;
- risk target: 0.25% of equity per trade;
- maximum leverage: 1x;
- taker fee model: 0.05% per side;
- slippage model: 0.02% per side;
- train/test split: 70% / 30% by time.

## Run tests

```bash
npm test
```

## Run a market-data backtest

Download and test public Binance futures history directly (no API key):

```bash
node algo-backtest-cli.mjs --symbol BTCUSDT --interval 1m --days 30
```

Or save the raw JSON response from Binance USD-M Futures `GET /fapi/v1/klines` and run:

```bash
node algo-backtest-cli.mjs ./btc-1m-klines.json
```

The CLI reports train and test results separately. The test result is the more important one.

## Promotion gate before paper trading

Do not connect this module to order execution until a strategy passes all of these gates on genuinely unseen data:

- at least 300 out-of-sample trades across several market regimes;
- positive net result after fees and slippage;
- profit factor above 1.2;
- maximum drawdown below 10%;
- remains positive when fees and slippage are doubled;
- no single symbol or short period explains most of the profit;
- stable rolling-window results rather than one lucky interval.

Passing these gates still does not guarantee future profit. It only justifies the next stage: paper trading.
