# Algo Signal Lab scalping v1

## Scope

This research track uses only short-lived patterns and contemporaneous facts already defined by Signal Lab. It does not optimize generic indicator strategies and does not hold positions beyond the existing 15-second, 1-minute, 3-minute and 5-minute observation horizons.

The module is a paper-trade candidate gate. It does not place exchange orders.

## Enabled strategy families

### 1. Cascade acceptance

- Signal Lab pattern: `cascade_breakout`.
- Episode state: `confirmed` or `weakening`.
- Required confirmation: trade acceleration and price acceptance.
- Entry freshness: 90 seconds.
- Maximum hold: 5 minutes.
- Exit study: partial at 1.2R, final at 2.5R.

### 2. Level breakout after tests

- Signal Lab pattern: `level_breakout`.
- Required confirmation: trade acceleration and price acceptance.
- Entry freshness: 120 seconds.
- Maximum hold: 5 minutes.
- Exit study: partial at 1R, final at 2.2R.

### 3. False breakout reclaim

- Signal Lab pattern: `false_breakout`.
- Required confirmation: price rejection and trade acceleration.
- Entry freshness: 60 seconds.
- Maximum hold: 3 minutes.
- Exit study: partial at 1R, final at 2R.

### 4. Knife / sharpening reversal

- Signal Lab patterns: `knife_reclaim`, `sharpening_rejection`.
- A fast `triggered` episode may be evaluated because waiting for a later state can consume the scalp.
- Required confirmation: price rejection plus at least one of trade acceleration, volume expansion or aggressor dominance.
- Entry freshness: 30 seconds.
- Maximum hold: 3 minutes.
- Exit study: partial at 0.8R, final at 1.8R.

### 5. Compression expansion

- Signal Lab pattern: `compression_breakout`.
- Required confirmation: volume expansion and trade acceleration.
- Entry freshness: 90 seconds.
- Maximum hold: 5 minutes.
- Exit study: partial at 1R, final at 2.5R.

### 6. Observed-liquidity hold reaction

- Signal Lab pattern: `liquidity_hold`.
- Required confirmation: book hold plus replenishment, aggressor dominance or price rejection.
- Entry freshness: 30 seconds.
- Maximum hold: 2 minutes.
- Exit study: partial at 0.8R, final at 1.5R.

## Global execution gate

Every candidate must satisfy all of the following:

- symbol is currently INPLAY;
- direction is explicit;
- future price path is `live`, not partial or unavailable;
- spread is known and no wider than 8 bps by default;
- market-data latency is known and no higher than 1,500 ms by default;
- reference price and structural invalidation price are present;
- invalidation is on the correct side of entry;
- stop distance is no wider than 1.5% of entry;
- the pattern-specific confirmations are present;
- one continuous episode creates at most one candidate.

## Context-only patterns in v1

- `liquidity_rearrangement`: a moved or removed density can strengthen, weaken or cancel another setup, but movement alone is not an entry.
- `liquidation_cascade`: liquidation flow is ambiguous between continuation and exhaustion. It remains a context fact until price acceptance/rejection and OI behavior split those two cases reliably.

## Evaluation order

1. Forward paper collection from Signal Lab events.
2. Evaluate 15s, 1m, 3m and 5m outcomes separately.
3. Reconstruct executable entry, stop and partial/final exits from the live price path.
4. Include fees, slippage and missed fills.
5. Rank each strategy separately; do not combine different pattern IDs or formula versions.
6. Require at least 100 live-quality paper trades before calling a family substantial.
7. Promotion target remains PF above 2, win rate above 40% and average result above 1R on an untouched forward sample.

## Current storage limitation

Signal Lab is browser-local and retains a bounded history. A page reload or closed browser can split or miss episodes. A reliable 24/7 forward test therefore needs the collector/API/PostgreSQL stage; until then, results are valid only for periods where the page stayed active and observation quality is `live`.
