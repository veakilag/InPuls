# Owner Signal Lab v1

Owner Signal Lab is a separate, unlinked technical dashboard for the local
Signal Lab history. It is not part of the public trading workspace.

## Access and privacy boundary

- the page is served from the same origin as InPuls so it can read the existing
  `inpuls-signal-lab-v1` IndexedDB;
- the page is not linked from the public InPuls interface and declares
  `noindex,nofollow,noarchive`;
- the history remains inside the current browser profile and is not uploaded;
- another browser or device cannot read this local history;
- GitHub Pages cannot provide account-level authorization for a static route.
  The URL itself is therefore not a cryptographic access boundary. True
  owner-only access from multiple devices requires the later backend, auth, and
  server-side storage stage.

A third-party dashboard cannot read the current IndexedDB directly because
browser storage is isolated by origin. Grafana or another external dashboard
becomes useful only after the 24/7 worker writes Signal Memory entities to a
server-side database.

## Dashboard

The page exposes:

- `1d / 3d / 7d / 30d` windows;
- symbol, signal, and horizon filters;
- event count, usable live observations, usable coverage, and missing data;
- per-symbol descriptive continuation, median directional return, median MFE,
  median MAE, median time-to-MFE, and sample evidence level.

Rows never combine different signal formula versions or settings because the
underlying Signal Lab report already separates those contracts.

## InPuls handoff

The dashboard builds a same-origin URL:

```text
./?symbol=ETHUSDT&open=orderbook&source=signal-lab
```

InPuls validates the symbol, selects it on the primary chart, and:

1. focuses an existing order book for that symbol;
2. otherwise creates a new order-book panel when space is available;
3. otherwise reuses the first existing order-book panel;
4. reports a visible error if the workspace has no room and no reusable book.

The handoff opens the current live order book. It does not recreate the order
book at the historical signal timestamp. That needs Replay and 24/7 stored
market data.

## Boot recovery

- The owner page registers and updates the current InPuls Service Worker.
- Dashboard dependencies use the current build as their cache-buster.
- Module, IndexedDB, and report startup have bounded timeouts.
- A failed startup renders an explicit error with a retry action instead of
  remaining in the loading state.
- Retrying never clears IndexedDB events or observations.
