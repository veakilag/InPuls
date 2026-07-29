# Scalper patterns research v1

This document defines what InPuls may observe. It does not claim that a named
algorithm, market maker, or single participant has been identified.

## Confidence rule

- `active`: the current measurable rule has a narrow, documented meaning.
- `evidence_collection`: the public descriptions converge, but thresholds must
  be learned and validated from recorded order-book episodes.
- `research`: public usage is inconsistent or incomplete. Store neutral inputs
  only; do not emit a user-facing signal.
- `blocked_raw_trade`: a valid detector needs individual executions. Aggregated
  `aggTrade` data is not sufficient to identify repeated same-size prints.

## Classic patterns

### Knife

A sharp downward impulse followed by a long entry near the lower extreme.
The signal direction in Market Memory is therefore `up`: it measures the
counter-move after the drop, not continuation of the drop. The current trigger
marks the approach candidate; the extreme and reversal still have to be
measured in the outcome path.

### Sharpening

The mirror image of Knife: a sharp upward impulse followed by a short entry
near the upper extreme. The signal direction is `down`, so Market Memory
measures the counter-move after the upward impulse.

### Resistance/support breakout

A resistance breakout trades above one resistance level or a very narrow
cluster of resistance levels. A support breakout trades below one support
level or a very narrow cluster of support levels. Candidate selection must
prefer the level whose latest touch is closest in time to the current price.
A valid result must distinguish acceptance beyond the level from a fast return
into the prior range. The two directions are separate signal types and stats.

### Cascade

A sequence of nearby highs or lows on a timeframe of at least one minute
creates stop-liquidity behind the extrema. A cascade is the sharp impulse that
sweeps that liquidity through the sequence. It is neither an order-book ladder
nor synonymous with exchange forced-liquidation flow. InPuls stores 1m pivot
extrema and the later price path; detector thresholds remain uncalibrated.

## Algorithm observations

### Rearranger

A significant limit-order shape repeatedly disappears at one price and
reappears at a nearby price on the same side with similar size, often following
the spread. Evidence is a cancel/replace or density move chain, not intent.

### Size supporter

A limit order repeatedly takes or retakes the best position in the spread and
reprices when another order improves the quote. Store best-price changes,
cancel/replace chains, side, size similarity, and distance to the spread.

### Minute algorithm and 59th-minute algorithm

The Minute algorithm places a strong visible size inside the spread at the
start of each minute, in either direction and within a working price range that
can extend up to about 5%. It repeats minute after minute and pushes price until
the behavior switches off. Store the minute phase, side, placement/repricing,
size, recurrence, active interval and price reaction.

The 59th-minute pattern is activation, placement or repricing during minute 59
of the hour, most often by a Rearranger or Size supporter. Timing alone is not
a signal: the corresponding order-book action must be present.

Magnet and Garden bed are paused. They are absent from the active catalog and
must not be emitted or presented as evidence-collection targets.

### Buyer/seller

A sequence of aggressive buys or sells with repeated equal/near-equal sizes
and/or stable inter-arrival timing. Detection needs Binance raw `@trade`.
Production still uses `@aggTrade`; therefore v1 records the limitation and does
not emit buyer/seller signals.

## Data boundary

Radar-wide price/trade metrics exist for every tracked symbol. Deep order-book
geometry exists only for symbols whose order book is open. Current evidence is
captured at signal time only. Continuous 24/7 pattern observation and cross-
device history require the future backend collector.
