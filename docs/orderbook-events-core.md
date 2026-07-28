# Orderbook Events Core v1

The event core is the normalization boundary between Binance depth diffs and the
current in-memory book:

`snapshot baseline → sequenced diff → normalized events → current book`

## Event contract

Every accepted level change becomes one of four event types:

- `appeared`: quantity changed from zero or missing to a positive value;
- `increased`: an existing positive quantity grew;
- `decreased`: an existing positive quantity shrank but stayed positive;
- `removed`: an existing positive quantity became zero.

Each event records symbol, venue, side, price, previous/current/delta quantity,
the same three values in quote currency, exchange event/transaction times, local
receive time, Binance `U/u/pu`, book epoch, continuity (`live` or `recovered`),
and a local monotonic sequence.

## Correctness boundaries

- A REST snapshot creates a baseline and never fabricates `appeared` events.
- Only diffs accepted by the existing Binance sequence checks enter the core.
- Buffered bridge diffs are retained but marked `recovered` until the book is live.
- A gap, reconnect, background restart, symbol change, or explicit resync opens a
  new book epoch and clears retained events from the previous epoch.
- Missing zero levels, unchanged quantities, malformed rows, and negative
  quantities do not create events.
- Partial top-20 fallback is marked unavailable for lifecycle analysis because a
  level leaving that view is not proof that it was removed from the full book.
- `decreased` and `removed` describe a depth quantity change only. They do not
  claim cancellation, execution, or spoofing until the trade stream is correlated.
- The classification is exact inside the retained local book. A far-edge level
  discarded by the 20,000-level storage cap may later look like `appeared`.

## Runtime and limits

The Worker and Legacy fallback share the same pure event core. Each feed retains
at most 4,000 recent normalized events and exposes only a compact summary in
normal orderbook data. Raw events remain inside the feed for the next density
lifecycle stage, so this release does not add UI rendering or high-volume
Worker-to-main messages.
