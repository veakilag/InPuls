# Signal Lab analytics v1

Signal Lab v1 is a local, descriptive analysis layer over `SignalEvent`,
`SignalContext`, and resolved `SignalObservation` entities. It does not predict
price, recommend a trade, or treat a historical continuation rate as expected
profitability.

## Storage

The browser stores signal entities in `inpuls-signal-lab-v1` IndexedDB:

- events, contexts, and observations use separate object stores;
- resolved observations replace their pending versions by stable ID;
- retention is 30 days, capped at 10,000 signal events;
- writes are serialized outside the render loop;
- storage failure never blocks the radar, order book, or market feed;
- pending horizons left by a previous browser session become `unavailable`
  with reason `browser-session-ended-before-horizon`.

This is a local browser profile history, not a 24/7 source of truth. A page
reload can split one continuous signal into two episodes. The later VPS worker
and PostgreSQL stage must remove that limitation.

## Windows and grouping

Every report contains `1d`, `3d`, `7d`, and `30d` windows. Each window has:

- cross-symbol signal groups;
- per-symbol groups;
- a separate row for every signal type, direction, horizon, formula version,
  and exact settings fingerprint.

Different formula versions or settings are never combined. Coin families and
market regimes are not invented while those classifiers are unavailable.

## Primary sample

Primary outcome statistics include only observations where:

1. state is `observed`;
2. price-path quality is `live`;
3. return, directional return, MFE, MAE, and effect duration are all present.

Partial observations are excluded from primary statistics and counted
separately. `unavailable`, awaiting `pending`, and overdue `pending` horizons
are also exposed separately.

Definitions:

- market return: `(finalPrice - baselinePrice) / baselinePrice * 100`;
- directional return: `marketReturn * signalDirection`;
- continuation: `directionalReturnPercent > 0`;
- MFE: maximum favorable directional excursion;
- MAE: maximum adverse directional excursion;
- effect duration: time from the signal to its MFE.

“Continuation” is not called a win rate. No fee, slippage, entry rule, exit
rule, or executable fill is implied.

## Evidence labels

- `none`: no usable observations;
- `insufficient`: 1–19;
- `exploratory`: 20–99;
- `substantial`: 100 or more.

`substantial` only describes sample size. It is not proof that the pattern will
repeat.

## Density rule

Density size never contributes to an evidence label or outcome statistic.
Signal Lab only counts whether a context contained an already observed density
interaction. Its importance remains `unrated`.

## Local inspection

The runtime exposes a read-only console surface:

```js
await window.inpulsSignalLab.report()
window.inpulsSignalLab.status()
```

There is deliberately no destructive `clear` or `delete` action on this
surface.
