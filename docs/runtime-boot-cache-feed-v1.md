# Runtime boot/cache/feed hotfix v1

## Problem

The browser could load the HTML shell while the JavaScript runtime stayed dead: the clock remained `--:--:--`, the connection label stayed at `Подключение…`, and charts/market rows did not initialize. Two conditions overlapped:

1. the rollback reused an old build/cache generation;
2. the rollback restored the pre-split Binance Futures global WebSocket route.

## Recovery

- load a non-module boot recovery script before `app.js`;
- unregister stale service workers and delete only `inpuls-*` CacheStorage entries when the runtime generation changes;
- preserve localStorage, IndexedDB and Signal Lab history;
- split Binance Futures traffic into current `market` and `public` routes;
- retain REST ticker bootstrap while the core miniTicker stream reconnects;
- use a unique build generation: `26-91-runtime-boot-cache-feed-v1`.

## Acceptance

- header clock advances;
- JavaScript has no page-level startup errors;
- market table receives rows;
- primary chart receives candles;
- core miniTicker, auxiliary market data and public bookTicker are not mixed on one obsolete route;
- no local history/database reset occurs.
