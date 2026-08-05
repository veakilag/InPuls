# Signal Lab V4 — Stage 3: deterministic cascade state machine

## Input

Only `LevelZone` objects and their breakout lifecycle from Stage 2 are accepted. The legacy candle-staircase detector remains available for regression comparison but is not the source of truth for V4.

## Lifecycle

`SETUP → TRIGGERED → CONFIRMED → EXTENDED`

Terminal alternatives:

- `PARTIAL`: only the first level was crossed before the time window closed;
- `FAILED`: the setup disappeared before trigger, the price fully returned behind the first zone, the inter-level pullback exceeded the configured limit, or the bar/time connectivity was broken.

`geometricState` is stored separately. GAP/STALE data may prove that two geometric prices were crossed, but it cannot silently become a fully confirmed cascade.

## Rules

- two zones are the minimum cascade;
- three zones are the full multi-stage cascade;
- four or more are extended;
- adjacent gaps from 0% through exactly 5% are valid;
- original zone touch counts and source timeframes are retained;
- setup exists before the first level break;
- the chain is frozen after trigger;
- level breaks must occur in order;
- duration, bars between levels and inter-level pullback are configurable by timeframe;
- repeated updates do not create duplicate events;
- long and short are symmetric;
- setup, trigger, confirm and completion anchors track 15s/1m/3m/5m, MFE, MAE and data gaps.

Formula: `signal-lab-v4-cascade-v1-2026-08`.

## Candidate collection

V4 cascade candidates use a separate visible calibration gate:

- quote volume 24h at least $25m;
- first level no farther than 3%;
- at least two active zones;
- no minimum NATR gate.

These values are configuration, not final trading thresholds.
