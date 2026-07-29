# Signal Observation Engine v1

## Purpose

This engine fills the pending 15-second, 1-minute, 3-minute, and 5-minute
`SignalObservation` entities created by the Signal Memory contract. It records
what actually happened after a signal. It does not predict price or label an
episode profitable.

## Price path

The event price is the baseline. While at least one observation for the event is
pending, the browser records a new point only when a fresh exchange market
update for that symbol is available. Repeated renders of the same source update
do not create duplicate points.

The final price is the first fresh point observed at or after the horizon. It
must arrive no more than 5 seconds late. This tolerance handles normal delivery
and render scheduling without silently replacing a missed horizon with a much
later price.

## Formulas

For baseline price `P0` and a later price `Pt`:

- `returnPercent = (Pt - P0) / P0 * 100`;
- `directionalReturnPercent = returnPercent` for an up signal and
  `-returnPercent` for a down signal;
- `maxAbovePercent` is the largest market-signed rise above `P0`;
- `maxBelowPercent` is the largest market-signed fall below `P0`;
- `mfePercent` is the maximum direction-adjusted excursion, floored at zero;
- `maePercent` is the minimum direction-adjusted excursion, capped at zero;
- `effectDurationMs` is the elapsed time from the signal to the MFE point.

`returnPercent` therefore always describes the market move. MFE, MAE, and the
directional return describe that move relative to the signal direction.

## Quality

An observed result includes the sample count, first and last sample times,
largest gap in the path, and final-sample delay.

- `live`: no adjacent observed price points are more than 5 seconds apart;
- `partial`: the result exists, but the price path contains a larger gap;
- `unavailable`: no fresh final price arrived within 5 seconds after the
  horizon.

If the browser is suspended or closed across a horizon, the observation becomes
`unavailable`. The engine never backfills it from a price received much later.
This is an intentional limitation of the browser-only stage. Continuous 24/7
capture and persistence belong to the later worker/API and PostgreSQL stage.

## Retention

The live price path is held only until all four observations for an event are
resolved or the event is pruned from the bounded in-memory buffer. It is not
persisted across a page reload in this stage.
