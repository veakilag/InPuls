# Density Lifecycle v1

Density Lifecycle v1 consumes the normalized order-book events and tracks how
unusually large levels behave inside one continuous `bookEpoch`.

The data path is:

`snapshot baseline → sequenced diff → normalized events → density lifecycle → compact summary`

This release adds the internal lifecycle and compact runtime data only. It does
not add density rendering to the ladder yet.

## Significance formula

The detector uses quote notional (`price × quantity`) and calculates a separate
reference for bids and asks from the nearest 200 valid levels on each side:

- `medianQuote`: median quote notional;
- `p90Quote`: 90th percentile quote notional;
- `entryQuote = max(medianQuote × 6, p90Quote × 1.5)`;
- `exitQuote = entryQuote × 0.6`.

At least 20 valid levels are required on a side. There is no shared fixed-dollar
threshold: BTC and smaller altcoins are evaluated against their own current
book. The stronger entry threshold and lower exit threshold create hysteresis.
A level must remain below the exit threshold for one second before it is marked
as faded.

## Lifecycle states

- `appeared`: a depth event created a new significant level;
- `standing`: the significant level is present without a recent transition;
- `strengthening`: its quantity increased;
- `weakening`: its quantity decreased but the level remains tracked;
- `replenished`: within five seconds after a decrease, quantity recovered to at
  least 80% of the pre-decrease quantity;
- `removed`: depth quantity became zero;
- `faded`: the level remained below the hysteresis exit threshold.

Transition labels settle back to `standing` after 1.5 seconds. Every record keeps
current and maximum quantity/notional, observed age, last change, maximum time,
relative score, distance from the current middle, event counts, and replenishment
counts.

## Snapshot and age semantics

A snapshot is still only a baseline and does not fabricate `appeared` events.
Large levels already present in the snapshot are registered as `standing` with
`source: snapshot` and `observedBeforeDetection: true`.

`ageMs` means time observed by the current continuous InPuls feed. It is not the
unknown real age of an order before the snapshot. A gap, reconnect, background
restart, symbol change, or resync opens a new epoch and clears the lifecycle.

## Correctness boundaries

- The lifecycle runs only on the full snapshot + diff book.
- Partial top-20 fallback reports `partial` and exposes no density conclusions.
- `removed`, `weakened`, and `faded` describe depth changes only.
- No state claims execution, cancellation, market passage, spoofing, or trader
  intent without later correlation to the trade stream.
- A level trimmed beyond the 20,000-level local storage cap is not treated as a
  confirmed removal.
- Thresholds are adaptive and can change with the current book regime. This v1
  formula must be calibrated on recorded live distributions before becoming a
  paid signal or a cross-market comparison.

## Runtime limits

Worker and Legacy fallback use the same pure lifecycle module. Each symbol keeps
at most 64 active records and 64 recently closed records; closed records expire
after 15 seconds. Normal UI data contains only the 12 strongest active records,
six recent closures, two compact reference summaries, and counters. Raw
order-book events remain inside the feed.
