# Signal Lab V5 rebuild

## Locked pattern rule

Knife and sharpening require a preceding impulse strictly greater than 1.00%. Equality is rejected. The evidence pack stores the measured impulse, required threshold and `STRICT_GREATER_THAN` mode. Formula version: `signal-lab-v5-patterns-v1-2026-08`.

## Candles

The `30d` range requests the complete thirty-day interval before the event and includes the event candle. Binance klines are loaded page by page. The UI reports requested days, actual days, ratio, page count and `COMPLETE/PARTIAL`; partial fallback data is never labelled as a complete month. Default view is 1h/30d to keep the browser responsive, with lower timeframes loaded only after explicit selection.

## Order-flow Replay

Signal Lab uses the main InPuls orderbook DOM classes, styles, price-step rules, ladder projection, liquidity scaling, manual-scroll behavior and Ctrl+wheel scale sequence ×1…×1000. The heavy workspace is mounted only after explicit Replay interaction.

Recorder V2 keeps Binance Futures REST snapshot + depth@100ms diff sequence U/u/pu, checkpoints, quality transitions, AGG trades and a clearly labelled RAW `@trade` shadow stream. RAW is research evidence and is not silently treated as the production trade source. Evidence sessions merge rolling recorder captures, preserving two minutes before the event and appending the five-minute follow-up without requiring an eight-minute global in-memory book for every armed symbol.
