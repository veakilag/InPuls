# RAW stability campaign — 27 July 2026

## Decision

Do not promote the undocumented Binance USDⓈ-M `<symbol>@trade` stream to the production TAPE from this campaign.

The candidate is materially faster in steady visible operation, but lab v1 cannot distinguish rejected payloads from transport gaps and over-counts source-only stalls after quiet market periods. Production remains on documented `<symbol>@aggTrade`.

## Runs

| Panels | Symbol | RAW valid | RAW rejected | Matched AGG groups | Full RAW coverage | RAW earlier | First lead p50 | Complete lead p50 |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | BTCUSDT | 7,956 | 28 | 3,010 | 99.9668% | 89.30% | 56.9 ms | 53.6 ms |
| 2 | BTCUSDT | 10,658 | 55 | 3,978 | 99.9497% | 84.11% | 54.5 ms | 48.3 ms |
| 2 | ETHUSDT | 17,874 | 81 | 4,384 | 99.9772% | 84.85% | 54.0 ms | 48.8 ms |
| 4 | BTCUSDT | 144,650 | 316 | 50,999 | 99.9647% | 80.46% | 39.3 ms | 37.5 ms |
| 4 | ETHUSDT | 251,278 | 538 | 52,775 | 99.8996% | 76.30% | 22.7 ms | 17.8 ms |
| 4 | SOLUSDT | 52,774 | 264 | 7,328 | 99.8635% | 92.88% | 150.7 ms | 142.0 ms |
| 4 | XRPUSDT | 70,865 | 230 | 11,070 | 99.8826% | 92.21% | 131.0 ms | 110.5 ms |

The 15-minute two-symbol run included one planned RAW restart. Recovery completed in 4.253 seconds.

The one-hour four-symbol run included 5 minutes 10 seconds in the background. Clean recovery completed in 3.962 seconds for RAW and 4.922 seconds for AGG. There were no unplanned reconnects, endpoint failures, duplicates or out-of-order events in any run.

## Diagnostic finding

For every symbol/run row, the v1 RAW gap count exactly equals the rejected-event count:

- 28 = 28;
- 55 = 55;
- 81 = 81;
- 316 = 316;
- 538 = 538;
- 264 = 264;
- 230 = 230.

This is deterministic double attribution, not independent evidence of packet loss. A rejected event did not advance the v1 sequence anchor, so the next accepted ID was also reported as a gap.

The v1 stall detector also starts from the counterpart's last event before a quiet market period. The first trade after that period can therefore produce a false stall even when the paired feed follows normally. Reported stall duration includes market inactivity and is not a transport-delay measurement.

The four-symbol p95 RAW lead of roughly 0.8–1.5 seconds is contaminated by post-background route recovery because v1 begins matching 500 ms after both feeds first return. It must not be presented as steady-state latency.

## Product interpretation

Steady visible evidence still supports a useful latency advantage:

- RAW arrived first for 76.30% to 92.88% of matched groups;
- visible-run medians were roughly 23–151 ms for first arrival;
- matched-group volume difference p99 was effectively zero in every row;
- the browser handled four high-rate RAW streams without dropped diagnostic events.

That is enough to continue the laboratory, not enough to change production.

Binance currently documents `@aggTrade` as a 100 ms market stream and states that insurance-fund and ADL trades are not aggregated. The schema also distinguishes total quantity `q` from normal quantity `nq` without RPI-involved trades. The undocumented RAW stream therefore needs event-class diagnostics as well as ID and volume comparison.

Official references:

- https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market
- https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/public

## Required follow-up

Lab v2 must:

1. export exact rejection reasons and bounded sanitized payload shapes;
2. advance sequence state for an observed-but-rejected trade ID;
3. count only unobserved IDs as transport-gap candidates;
4. confirm a source-only stall from continued counterpart activity, not prior market silence;
5. exclude a five-second recovery warm-up from cross-route lead distributions;
6. keep production on `@aggTrade` until a clean v2 matrix explains the rejected event class and passes coverage, reconnect and background criteria.
