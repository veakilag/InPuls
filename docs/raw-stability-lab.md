# RAW stability lab v2

## Purpose

`raw-stability-lab.html` is an isolated browser laboratory for deciding whether the faster but undocumented Binance USDⓈ-M Futures `<symbol>@trade` stream is stable enough to become a future production TAPE source.

This PR does **not** change production. The Worker continues to use one documented `<symbol>@aggTrade` stream through `/market`.

The laboratory opens two independent routed sessions over the same 1 / 2 / 4-symbol set:

- RAW candidate: `<symbol>@trade` through `/public`;
- control baseline: `<symbol>@aggTrade` through `/market`.

Both URL-combined and path-combined modes use the post-migration routed endpoints. The current Binance migration notice recommends the query-based combined mode and confirms that path-based combined subscriptions remain supported.

## What is measured

Per source and symbol:

- valid event count and quote notional;
- exact trade-ID continuity inside each uninterrupted WebSocket segment, separated from payloads that arrived but were rejected by validation;
- rejection reasons and bounded, public-market-only payload shape samples;
- duplicates, overlaps and out-of-order events;
- source-only stalls confirmed only after one feed continues producing events while the paired feed remains silent for three seconds;
- planned and unplanned reconnects;
- recovery time from restart request/socket close to the first valid event;
- visible and background wall time.

For every aggregate trade `[f, l]`:

- number of expected and received RAW executions;
- full coverage ratio;
- RAW first-arrival and complete-arrival lead;
- quote-volume difference.

Long-running distributions use bounded reservoir samples. Exact totals, gap counts, reconnects and failure counts are never sampled.

## Segment rules

A sequence anchor is reset whenever that source opens a new WebSocket segment. A gap between two separate connections is not reported as an intra-segment loss because the browser cannot observe trades emitted while disconnected.

Pending cross-source matches are discarded at a segment boundary. They are counted as abandoned and never mixed into the next segment.

An event with a usable trade ID can fail price, quantity or timestamp validation without proving a transport gap. The rejected ID advances the sequence anchor and is counted separately. Only IDs that were not observed at all remain transport-gap candidates.

After both feeds become live, matching waits five seconds before collecting lead samples. This prevents route startup and clean background recovery from contaminating steady-state latency.

A source-only stall is not inferred from a long period with no trades. The candidate starts at the first new event from the active feed and becomes a failure only if that feed keeps producing while the counterpart remains silent for three seconds.

When the tab returns from the background, the lab deliberately performs a clean restart of both sessions. This mirrors the production recovery rule and avoids treating a browser-delivered stale backlog as live data.

## Run matrix

Use separate exported JSON files:

1. one symbol, visible;
2. two symbols, including the **Break RAW** button once;
3. four symbols for at least one hour, including a background/foreground cycle.

The five-minute preset exists only to verify that the page and export work. A run needs at least 15 visible minutes before it can be marked clean.

The console helper is available for diagnostics:

```js
__INPULS_RAW_LAB__.snapshot()
__INPULS_RAW_LAB__.download()
__INPULS_RAW_LAB__.restartRaw()
__INPULS_RAW_LAB__.restartAll()
```

## Decision boundary

A green run means only that one exported observation was clean:

- no RAW gaps, duplicates, out-of-order events or source-only stalls;
- at least 99.99% fully covered aggregate groups;
- P99 RAW/aggregate volume difference no higher than 0.1%;
- both sources delivered data for every selected symbol.

Promotion still requires the full 1 / 2 / 4-symbol matrix, background recovery and reconnect coverage. If that campaign passes, the follow-up production change must keep `@aggTrade` as an automatic fallback and must not run both full-rate sources permanently.

Binance documents that `@aggTrade` contains only market trades; insurance-fund and ADL trades are not aggregated. It also exposes `nq` separately from `q` for quantity excluding RPI involvement. The hidden `@trade` candidate therefore cannot be promoted merely because raw IDs are fast or mostly contiguous: event-class and volume semantics must also be demonstrated.
