# Stable network-only Service Worker v1

## Problem

The cache-escaping rescue page restored the current tab, but the application then registered the old cache-owning Service Worker again. A later normal opening could therefore return the stale app shell and leave the runtime at `Подключение…` with empty market panels.

## Decision

Temporarily keep Service Worker registration for compatibility and Signal Lab client status, but remove all app-shell caching. The worker now:

- deletes every `inpuls-*` CacheStorage entry on activation;
- serves same-origin requests directly from the network with `cache: no-store`;
- preserves the Signal Lab collector-status message contract;
- provides no offline fallback until a versioned PWA update architecture is implemented.

## Acceptance

- rescue followed by a normal root opening remains healthy;
- a standard browser reload remains healthy;
- no InPuls app-shell cache is recreated;
- settings and IndexedDB are not touched;
- market data, charts, order book, Tape, Footprint and Signal Lab formulas are unchanged.
