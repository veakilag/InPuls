# Orderbook render scheduler

Build: `26-30-render-scheduler-v1`.

## Goal

Keep four or more open orderbooks responsive without changing exchange ingestion,
the Worker backpressure contract, or strict Binance depth sequencing.

## Main-thread contract

- Each panel stores only its latest complete book snapshot.
- One shared scheduler renders at most two ladder panels per animation frame and
  yields after an 8 ms main-thread budget.
- Repeated snapshots for an already queued panel are coalesced. This coalesces
  visual work only; the Worker still applies every `U/u/pu` depth event.
- Direct user interactions are promoted to the front of the queue.
- Removed or disconnected panels are discarded safely.

## TAPE contract

- The canvas renderer marks the flow as active, so the hidden legacy DOM
  footprint no longer computes and rewrites nodes on each depth frame.
- A TAPE batch renders at most two dirty cards or 8 ms of work, then continues
  on the next animation frame.
- Dirty cards remain queued until rendered; no visual card is lost when a batch
  yields.
- Recent trades use the already sorted history and stop scanning once the
  visible time window is passed.
- Live ingest divides its per-frame budget between pending symbols so a busy
  BTC stream cannot starve ETH, SOL, or XRP.

## Footprint contract

- Trade history already normalized by the runtime is merged linearly with the
  newest packet instead of sorting the full 6,000-trade history again.
- A trade or status event marks only cards for its symbol as dirty.
- Footprint draws at most two cards or 8 ms per animation frame and keeps the
  remaining cards queued for the following frame.
- Hidden tabs keep the last canvas and resume with one fresh all-card draw.

## Observability

The build adds:

- `orderbook.scheduler-wait`
- `orderbook.scheduler-frame`
- `orderbook.scheduler-coalesced`
- `orderbook.scheduler-yield`
- `orderbook.legacy-flow-skipped`
- `tape.scheduler-yield`
- `tape.ingest-frame`
- `footprint.scheduler-yield`

The acceptance test remains the same 60-second `1 / 2 / 4` orderbook capture.
Compare frame p95/p99, long tasks, `main-to-render`, `tape.draw-all`,
`footprint.draw-all`, and the new scheduler metrics. Worker source lag, gaps,
retries, and dropped TAPE events must not regress.
