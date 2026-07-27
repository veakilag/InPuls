# PR 1.1 — Connection startup and observability correctness

## Purpose

The first live baseline exposed two measurement defects and one connection-startup risk:

- Worker and page `performance.now()` values were subtracted even though they belong to different clocks;
- the 2,000-frame ring buffer discarded the beginning of captures longer than about 33 seconds;
- every new Worker feed raced three Binance REST hosts for both depth and recent trades, leaving losing requests alive after the first success.

PR 1.1 fixes those issues before any render optimization is attempted.

## Connection startup

Depth snapshots, recent-trade bootstrap and server-clock synchronization now use a staggered host fallback:

1. `fapi.binance.com` starts immediately;
2. `fapi1.binance.com` starts after 250 ms only if no request has succeeded;
3. `fapi2.binance.com` starts after 650 ms only if no request has succeeded;
4. the first valid response wins and every in-flight loser is aborted.

This changes request scheduling only. Snapshot validation, Binance sequence rules (`U/u/pu`), partial-depth fallback, reconnect backoff and book limits are unchanged.

The Legacy fallback uses the same staggered depth-snapshot helper.

## Connection timeline

With `?obs=1`, the JSON export now includes `connectionEvents` for:

- Worker create, ready, restart and Legacy fallback;
- feed start;
- depth WebSocket create, open, first message, timeout, close, error and retry;
- depth snapshot scheduling, each host attempt, bridge gap, success, failure and partial fallback;
- transition to a synchronized depth book;
- TAPE WebSocket create, open, first message, timeout, close, error and retry;
- recent-trade bootstrap scheduling and each host attempt;
- connection status transitions.

REST failures are classified as `timeout`, `http`, `invalid`, `aborted`, `network-or-cors` or `unknown`. A browser `TypeError: Failed to fetch` cannot prove CORS by itself, so the diagnostic intentionally reports `network-or-cors`.

## Correct timing model

- `worker.post-to-main` uses epoch timestamps on both sides of the Worker boundary.
- `main-to-render` uses only the page's monotonic clock.
- `source-to-main` and `source-to-render` are recorded only for live depth or live trade messages and only after applying the measured Binance server-clock offset.
- cached and REST-bootstrap trade batches are tagged but excluded from live source-latency metrics.
- summaries are available both globally and in `metricsByTags`, split by symbol, message type, source and render layer.

## Capture completeness

The sample cap is now 12,000 rows per metric, enough for more than three minutes of 60 FPS frames. Exports also include:

- exact capture start, end and duration;
- five-second `intervals`, including frame timing and every sampled metric;
- tab visibility transitions and time spent visible/hidden;
- `renderSkips` with the layer, reason, symbol, count and first/last occurrence;
- connection events relative to the beginning of the capture.

## Render coverage

The main render is split into:

- `app.render.metrics`;
- `app.render.rows`;
- `app.render.dom`;
- `app.render.secondary`;
- `app.render` total.

Order-book coverage now includes:

- `orderbook.compute`;
- `orderbook.ladder-dom`;
- `orderbook.legacy-flow`;
- `orderbook.render-card`;
- existing TAPE and footprint timings;
- explicit TAPE/footprint skip reasons such as missing live stream, no trades, hidden layer, missing ladder rows or recovery freeze.

## Repeat baseline

After deployment, use the same URL and console commands:

```js
__INPULS_OBS__.reset()
```

Wait 60 seconds, then:

```js
__INPULS_OBS__.download()
```

Run 1, 2 and 4 order books. Keep TAPE visible, the browser tab foregrounded and use active symbols. A capture is valid only when every tested symbol reaches a `depth.live` event and a TAPE `first-message` event, or the timeline clearly records why it did not.
