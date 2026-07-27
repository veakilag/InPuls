# Worker backpressure v1

## Production streams

- Depth uses Binance USDⓈ-M Futures `/public` routes.
- TAPE uses one `<symbol>@aggTrade` stream through `/market`.
- The high-volume `<symbol>@trade` stream is not part of the production Worker. RAW comparison remains isolated in `trade-latency-lab.html`.

Depth events are still applied one by one through the strict `U/u/pu` sequence checks. Backpressure never drops or coalesces exchange depth events; only rendered book frames and TAPE delivery are rate-limited.

## Bounded queues

- Recent trade history is a fixed-size ring buffer, so a live insert does not shift up to 12,000 array entries.
- The rolling RX latency window advances an index and compacts occasionally instead of shifting on every event.
- The Worker TAPE queue keeps at most 800 pending aggregate trades.
- Each flush sends at most the latest 500 pending trades and discards an older backlog instead of replaying stale seconds to the interface.
- The main thread keeps at most 900 not-yet-ingested live trades per symbol.

Dropped UI/TAPE events affect the visual history, not the local depth sequence. They are counted in diagnostics.

## Freshness and diagnostics

Every active feed emits a `worker.flow` diagnostic sample every two seconds with:

- depth and aggregate-trade events per second;
- mean and maximum processing time by stream;
- pending TAPE queue size and dropped count;
- calibrated depth and trade source lag.

The watchdog checks event freshness and calibrated source lag in addition to `WebSocket.readyState`. A stale depth feed restarts through the existing frozen-frame recovery path. A stale TAPE socket reconnects independently.
