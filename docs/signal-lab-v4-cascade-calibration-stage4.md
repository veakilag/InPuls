# Signal Lab V4 — Stage 4: manual cascade calibration

## Goal

Stage 4 does not change detector thresholds. It converts every V4 cascade episode into a reproducible comparison between machine output and manual review.

## Human label

Each cascade receives one class:

- `canonical` — canonical episode;
- `weak` — weak but admissible;
- `false` — false machine event;
- `ambiguous` — reviewer cannot choose one interpretation;
- `unavailable` — data is not sufficient.

The reviewer separately checks extrema, zone merge, touch count, setup timing, level order, trigger, confirmation, invalidation, look-ahead and outcome coverage.

## Corrections

Manual correction may store expected direction, lifecycle state, level count, level prices and touch counts. Machine values are never overwritten.

## Calibration eligibility

A sample is allowed into geometry calibration only when:

- a non-ambiguous class is explicitly selected;
- the machine event is available;
- data quality is not GAP, STALE or ERROR;
- no look-ahead error is flagged;
- every required geometry check is explicitly pass or fail rather than unknown/unavailable.

Outcome calibration additionally requires `OUTCOMES_SUFFICIENT = pass`.

False examples are retained because they are necessary for precision calibration. Ambiguous and unavailable examples remain in the dataset but are blocked from threshold fitting.

Formula: `signal-lab-v4-cascade-calibration-v1-2026-08`.
