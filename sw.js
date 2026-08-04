const CACHE = "inpuls-26-91-runtime-boot-cache-feed-v1"; // Retired cache name kept only for migration cleanup.
const BUILD = "26-95-stable-network-only-sw-v1";
const SIGNAL_LAB_COLLECTOR_STATUS_MESSAGE = "inpuls:signal-lab-collector-status";

// Release inventory only. These files are intentionally never written to CacheStorage.
const RELEASE_ASSETS = Object.freeze([
  "./",
  "./index.html",
  "./styles.css?v=26-91-runtime-boot-cache-feed-v1",
  "./app.js?v=26-109-tape-main-clock-v1",
  "./binance-clock-core.js?v=26-101-binance-clock-sync-v1",
  "./binance-clock.js?v=26-102-tape-live-edge-minute-boundary-v1",
  "./canvas-comfort-preview.js?v=26-109-tape-main-clock-v1",
  "./event-radar-beta.js?v=event-radar-beta-v1",
  "./event-radar-beta.css?v=event-radar-beta-v1",
  "./chart.js?v=26-102-tape-live-edge-minute-boundary-v1",
  "./engine.js?v=26-65-structured-signal-collection-v1",
  "./orderbook.js?v=26-109-tape-main-clock-v1",
  "./orderbook-events.js?v=orderbook-events-core-v1",
  "./orderbook-density.js?v=density-trades-correlation-v1",
  "./market-memory.js?v=26-65-structured-signal-collection-v1",
  "./market-pattern-scanner.js?v=marketwide-patterns-v1",
  "./pattern-catalog.js?v=26-91-runtime-boot-cache-feed-v1",
  "./signal-lab.js?v=signal-lab-analytics-v1",
  "./signal-lab-v2-store.js?v=26-82-signal-lab-event-driven-collector-v1",
  "./signal-lab-v2-catalog.js?v=26-82-signal-lab-event-driven-collector-v1",
  "./signal-lab-v2-episodes.js?v=26-82-signal-lab-event-driven-collector-v1",
  "./signal-lab-v2-review.js?v=26-82-signal-lab-event-driven-collector-v1",
  "./signal-lab-v2-training.js?v=26-82-signal-lab-event-driven-collector-v1",
  "./owner-signal-lab.html",
  "./owner-signal-lab-guard.js?v=26-82-signal-lab-event-driven-collector-v1",
  "./owner-signal-lab-v2.js?v=26-82-signal-lab-event-driven-collector-v1",
  "./owner-signal-lab-v2-card.js?v=26-82-signal-lab-event-driven-collector-v1",
  "./owner-signal-lab-v2-chart.js?v=26-82-signal-lab-event-driven-collector-v1",
  "./owner-signal-lab.css?v=26-64-signal-lab-without-impulse-v1",
  "./owner-signal-lab-v2.css?v=26-82-signal-lab-event-driven-collector-v1",
  "./owner-navigation.js?v=owner-signal-lab-v1",
  "./render-scheduler.js?v=render-scheduler-v1",
  "./orderbook-worker.js?v=26-109-tape-main-clock-v1",
  "./orderbook-worker-buffers.js?v=worker-bp-v1",
  "./orderbook-depth-projection.js?v=deep-book-v1",
  "./orderbook-tape-guard.js?v=worker-bp-v1",
  "./orderbook-network.js?v=obs-pr1-1",
  "./orderbook-tape-layout.js?v=stable-tape-v4",
  "./orderbook-tape-latency.js?v=worker-bp-v1",
  "./orderbook-flow-workspace.js?v=26-109-tape-main-clock-v1",
  "./observability.js?v=render-scheduler-v1",
  "./pwa-reset.js",
  "./refresh.html",
  "./refresh.js?v=26-91-runtime-boot-cache-feed-v1",
  "./reset-v26.html",
  "./reset.js?v=26-91-runtime-boot-cache-feed-v1",
  "./raw-stability-lab.html",
  "./raw-stability-lab.js?v=3",
  "./raw-stability-core.js?v=3",
  "./trade-latency-core.js?v=2.1",
  "./assets/inpuls-world-map-v17.png",
  "./manifest.webmanifest",
  "./icon.svg",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys();
    await Promise.all(
      cacheKeys
        .filter((key) => key === CACHE || key.startsWith("inpuls-"))
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

function isSignalCollectorClient(client) {
  try {
    const url = new URL(client.url);
    const scopePath = new URL("./", self.registration.scope).pathname;
    const indexPath = new URL("./index.html", self.registration.scope).pathname;
    return url.origin === self.location.origin
      && (url.pathname === scopePath || url.pathname === indexPath);
  } catch {
    return false;
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== SIGNAL_LAB_COLLECTOR_STATUS_MESSAGE) return;
  const replyPort = event.ports?.[0] ?? null;
  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    const collectors = windowClients.filter(isSignalCollectorClient);
    replyPort?.postMessage({
      type: SIGNAL_LAB_COLLECTOR_STATUS_MESSAGE,
      active: collectors.length > 0,
      checkedAt: Date.now(),
      build: BUILD,
      releaseAssets: RELEASE_ASSETS.length,
      clients: collectors.map((client) => ({
        id: client.id,
        url: client.url,
        visibilityState: client.visibilityState ?? "unknown",
        focused: client.focused === true,
      })),
    });
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
