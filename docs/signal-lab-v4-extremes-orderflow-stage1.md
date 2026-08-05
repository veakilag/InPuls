# Signal Lab V4 — Stage 1: active extrema and order-flow evidence

## Decision

The legacy V3 cascade/breakout detector is not silently replaced. V4 runs a deterministic, non-repainting multi-timeframe extrema map in parallel. The map must be manually calibrated before levels, compression, breakout acceptance and cascade state transitions become the production candidate source.

## Implemented

- Per-timeframe extrema engines for 1m, 5m, 15m, 1h, 4h and 1d.
- Exact price normalization through Binance tickSize and integer ticks.
- Candidate movement before confirmation; immutable confirmed extrema.
- Confirmation by observable reversal using min percent, ATR factor and minimum ticks.
- Separate extremeTime, detectedAt and confirmedAt.
- Equality is a retest; one valid tick through the level is BREAK_ATTEMPT and removes it from the active map while preserving history.
- Manual detector-error labels for calibration.
- 30-day paginated candle context on demand.
- Limited setup-aware order-flow recorder using REST snapshot + depth diff U/u/pu + exact aggTrade event times.
- At least two requested pre-event minutes, with actual coverage shown honestly.
- Shared replay time for footprint cluster, tape and a manually scrollable reconstructed local book.
- LIVE/GAP/RECOVERED/ERROR quality states.

## Deliberately deferred

- Level-zone merge and independent attack ×N calibration.
- Compression classification.
- Breakout acceptance modes.
- Cascade SETUP/TRIGGERED/CONFIRMED/EXTENDED/PARTIAL/FAILED.
- Production replacement of the legacy candidate detector.

These stages depend on a validated active-extrema map.

## Browser limitation

The browser records full order flow only for a limited armed symbol set. Two-minute pre-event coverage is guaranteed only when the symbol was armed before the trigger. Coverage is stored and displayed; missing history is never reconstructed or presented as complete. Long-term Market Memory and complete DNA require a 24/7 backend recorder.
