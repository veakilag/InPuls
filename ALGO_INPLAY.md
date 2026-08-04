# Current INPLAY universe backtests

The batch runner combines a stable comparison universe with a fresh current InPuls INPLAY snapshot.

```bash
node algo-universe-backtest.mjs --interval 1m --days 30
```

Default fixed symbols:

- BTCUSDT
- ETHUSDT
- SOLUSDT
- XRPUSDT

Current INPLAY uses the same rule dimensions as the screen:

- minimum V24 in millions of USDT;
- minimum NATR 1;
- minimum NATR 5;
- minimum 24-hour growth;
- up to 18 coins by default.

Example:

```bash
node algo-universe-backtest.mjs \
  --interval 1m \
  --days 30 \
  --min-v24 100 \
  --min-natr1 0.5 \
  --min-natr5 0.8 \
  --min-growth24 3 \
  --inplay-limit 18
```

Each symbol is labeled as `fixed`, `current-inplay`, or `fixed+current-inplay`.

## Selection-bias boundary

Testing today's INPLAY coins on older history is a useful diagnostic, but it is not an honest simulation of the historical selector because today's leaders are already known.

Before paper trading, the research pipeline must also reconstruct which coins satisfied INPLAY rules at each historical moment and test the strategy on that point-in-time universe.
