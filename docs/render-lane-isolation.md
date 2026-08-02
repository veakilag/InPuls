# Independent Tape and chart render lanes

Build: `26-96-independent-tape-chart-lanes-v1`.

## Goal

Prevent a busy Tape or footprint frame from consuming the same browser render turn as candlestick charts.

## Contract

- Candlestick callbacks are queued in a dedicated high-priority chart lane.
- The chart lane runs before paint, renders at most two charts per frame, and stops after a 7 ms budget.
- Tape drawing, Tape ingest, and footprint drawing use a separate flow lane.
- The flow lane runs after the browser paint opportunity, handles one heavy callback per task, and targets a 4 ms budget.
- Cancellation remains compatible with existing `cancelAnimationFrame` calls.
- Unrelated animation callbacks still use the browser-native scheduler.

## Data safety

This change affects visual scheduling only. It does not change Binance streams, Worker processing, depth `U/u/pu` sequencing, stored trades, Signal Lab, or user workspace data.

## Limitation

Both lanes still execute on the browser main thread. The separation reserves chart time and bounds flow work, but it is not the same as moving Canvas rendering to an `OffscreenCanvas` Worker. That larger migration should be justified by measured frame and long-task data.
