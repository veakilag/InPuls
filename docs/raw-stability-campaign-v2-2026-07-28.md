# RAW stability campaign v2 — 28 July 2026

## Decision

Keep production TAPE on the documented Binance USDⓈ-M `<symbol>@aggTrade` stream.

The v2 campaign confirms that the undocumented `<symbol>@trade` candidate is materially faster and that the browser can sustain the tested 1 / 2 / 4-symbol matrix. It still does not justify production promotion because the RAW query route had one startup failure and Binance does not document the stream or the meaning of its zero-price/zero-quantity events.

## Campaign result

- 288,311 valid RAW executions;
- 78,443 matched aggregate groups;
- RAW arrived first in 79.7% of matched groups;
- first-arrival lead p50 ranged from 8 to 149 ms;
- first-arrival lead p95 ranged from 151 to 287 ms;
- matched volume difference was effectively zero;
- no transport gaps, duplicates, out-of-order events or source-only stalls;
- one RAW query-route startup failure recovered through the path fallback.

The four-symbol run contained the planned five-minute background cycle and a second accidental 1.62-second visibility change around minute 39. Both sources performed a clean restart. RAW recovered in about 4.19 seconds and AGG in about 4.25 seconds after the short cycle, with no continuity failures.

## Zero-value event finding

All 979 rejected RAW payloads had the same observed shape:

- event type `trade`;
- sequential trade ID;
- `p="0"`;
- `q="0"`;
- `st=1`.

They are not executed trades because both price and quantity are zero. Treating them as corrupt payloads understates aggregate ID coverage, while treating them as trades would overstate execution counts.

Lab v3 therefore:

1. accepts `p=0/q=0` RAW events as sequence markers;
2. advances the per-segment sequence anchor with their IDs;
3. retains them in aggregate `[f, l]` ID coverage with zero quantity;
4. reports them in a separate `sequenceMarkers` counter and bounded sample set;
5. excludes them from executed RAW message count and quote volume;
6. keeps all other one-sided zero or negative price/quantity payloads invalid.

This classification is empirical, not an assertion about an undocumented Binance event class.

## Production boundary

This PR changes only the isolated RAW laboratory and its diagnostics. `orderbook-worker.js` continues to subscribe to `<symbol>@aggTrade`; production TAPE does not consume `<symbol>@trade` or sequence markers.
