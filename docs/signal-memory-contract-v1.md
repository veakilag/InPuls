# Signal Memory Contract v1

## Purpose

This layer records what InPuls knew when a radar signal appeared without mixing the
signal, its contemporaneous market context, and later price outcomes.

## Entities

### SignalEvent

An immutable snapshot of the classifier output. It stores the symbol, venue,
direction, event price, score, explanation, formula version, and the numeric
settings used by that formula. It never contains later returns, MFE, or MAE.

### SignalContext

An immutable snapshot captured at the same time as the event. It contains:

- 15-second, 1-minute, 5-minute, and 24-hour price changes;
- turnover, volume acceleration, trade rate, aggressor split, funding, and
  liquidations;
- BTC movement and correlation;
- order-book spread, coverage, epoch, and observed density interactions when a
  live order book for that symbol exists;
- explicit placeholders and `partial` quality for open interest and market
  regime until those feeds and classifiers are implemented.

Untouched size-only density candidates are excluded. A touched, filled, consumed,
pulled, or moved episode may be included as context, but its importance remains
`unrated`. Public Binance data supports probabilistic price-level correlation, not
order-ID attribution.

### SignalObservation

Four separate pending observations are created for 15 seconds, 1 minute,
3 minutes, and 5 minutes. The Signal Observation Engine fills each entity from
the live future price path when its horizon becomes due. The exact formulas,
quality rules, and missed-horizon behavior are defined in
`signal-observation-engine-v1.md`.

## Runtime behavior

The browser keeps a bounded in-memory buffer. A continuous signal creates one
event. It must be absent for the release window before the same formula, symbol,
type, and direction can create a new event. Stale market snapshots cannot create
new signal facts.

The buffer is intentionally not persisted yet. PostgreSQL persistence belongs to
the later always-on worker/API stage.
