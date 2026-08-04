# InPuls Owner Algo Lab

`owner-algo-lab.html` is a local owner-only research dashboard for the algorithmic backtest module.

## Privacy boundary

The current InPuls production site is static and can be published through GitHub Pages. A hidden URL or `noindex` is not authentication.

For that reason, Algo Lab must remain in the research branch and be opened locally through `npm start` until a genuinely private deployment is configured. The page is intentionally:

- absent from the public InPuls navigation;
- absent from the Service Worker app shell;
- marked `noindex,nofollow,noarchive,nosnippet`;
- protected by a restrictive browser Content Security Policy;
- free of API keys, authenticated Binance calls and real-order endpoints;
- limited to public market-data reads;
- storing run history only in this browser's `localStorage`.

Do not merge or publish this page on a public static host as a substitute for authentication.

## What the first page does

- reads the current INPLAY rules and order from the same browser profile as InPuls;
- refreshes a current Binance Futures INPLAY snapshot;
- combines it with the fixed comparison universe BTC, ETH, SOL and XRP;
- downloads public historical candles;
- runs the ATR breakout baseline with chronological 70/30 train/test separation;
- displays out-of-sample trades, win rate, profit factor, return, drawdown and fees;
- keeps up to 12 experiment reports locally;
- exports the latest run as JSON;
- never places an order.

## Local use

```bash
npm start
```

Then open:

```text
http://127.0.0.1:4173/owner-algo-lab.html
```

The first practical baseline run should use:

- interval: `1m`;
- history: `7 days`;
- current InPuls INPLAY rules;
- up to `12` INPLAY symbols;
- concurrency: `2`.

## Research sequence

1. Establish the mechanical baseline on fixed symbols plus current INPLAY.
2. Repeat on 3m and 5m and on several non-overlapping date windows.
3. Add doubled-fee and doubled-slippage stress runs.
4. Reconstruct INPLAY point-in-time for each historical period to remove today's-leader selection bias.
5. Add the user's cascade setup as a separate strategy, never by modifying the baseline.
6. Use walk-forward testing and require at least 300 out-of-sample trades across regimes.
7. Advance only surviving strategies to paper trading.
8. Consider tiny real capital only after paper results remain consistent with backtests.

The current page is a research instrument, not a claim of profitability.
