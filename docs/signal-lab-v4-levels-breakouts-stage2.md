# Signal Lab V4 — Stage 2: Level zones and breakout lifecycle

## Purpose

Stage 2 consumes only confirmed active extrema from Stage 1. It does not replace the old cascade detector and does not infer stops as an observed fact.

## Deterministic rules

- close extrema merge only inside a configurable tolerance based on ticks, percentage and ATR;
- original extrema and timeframes are preserved inside every zone;
- `touchCount` counts independent attacks, not adjacent candles or trades;
- equality is a contact, not a break;
- a high zone is crossed only above its outer high boundary by at least one tick;
- a low zone is crossed only below its outer low boundary by at least one tick;
- `triggeredAt` and `acceptedAt` are separate;
- all acceptance checks are retained: close, time, distance, flow and hybrid;
- `GAP`, `STALE` and `ERROR` may record geometry but cannot produce full acceptance;
- quick return is stored as `SWEPT_RECLAIMED`;
- retest is possible only after acceptance;
- an event is updated rather than duplicated on every tick.

Formula: `signal-lab-v4-levels-breakouts-v1-2026-08`.

## Product state

The map is attached to Signal Lab evidence packs and rendered on the full chart. It is calibration evidence, not a production alert. Cascade state machine starts only after Stage 1 and Stage 2 are validated on user examples.
