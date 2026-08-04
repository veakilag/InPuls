# Current InPuls INPLAY backtests

The algorithmic research module can test the stable comparison set together with a fresh current INPLAY snapshot.

## Current selection rules

The selector mirrors the current InPuls rule dimensions:

- minimum 24-hour quote turnover (`V24`);
- minimum `NATR 1`;
- minimum `NATR 5`;
- minimum 24-hour growth;
- up to 18 symbols.

The fixed comparison universe remains BTCUSDT, ETHUSDT, SOLUSDT and XRPUSDT. Each symbol is labelled by source in the output.

## CLI

```bash
node algo-universe-backtest.mjs --interval 1m --days 30
```

Example with explicit current INPLAY rules:

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

## Private browser dashboard

The browser workflow is available in `owner-algo-lab.html` and documented in `ALGO_LAB.md`.

Use it only through the local server for now:

```bash
npm start
```

```text
http://127.0.0.1:4173/owner-algo-lab.html
```

It is intentionally absent from public navigation and from the Service Worker cache. Do not publish it on public GitHub Pages and do not treat a hidden URL as authentication.

## Research limitation

A current INPLAY snapshot is a present-time selection. Testing today's active symbols on old candles can produce selection bias. These runs are useful for diagnosis and infrastructure validation, but they are not sufficient evidence for paper or real trading.

The required next research layer is point-in-time INPLAY reconstruction: each historical test window must contain only symbols that passed the INPLAY rules at that historical time.
