const CACHE = "inpuls-26-91-runtime-boot-cache-feed-v1"; // Retired cache name kept only for migration cleanup.
const BUILD = "26-95-stable-network-only-sw-v1";
const SIGNAL_LAB_COLLECTOR_STATUS_MESSAGE = "inpuls:signal-lab-collector-status";

// Release inventory only. These files are intentionally never written to CacheStorage.
const RELEASE_ASSETS = Object.freeze([
  "./",
  "./index.html",
  "./app.js?v=26-91-runtime-boot-cache-feed-v1",
  "./event-radar-beta.js?v=event-radar-beta-v1",
  "./event-radar-beta.css?v=event-radar-beta-v1",
  "./market-memory.js?v=26-65-structured-signal-collection-v1",
  "./orderbook-events.js?v=orderbook-events-core-v1",
  "./orderbook-density.js?v=density-trades-correlation-v1",
  "./orderbook-network.js?v=obs-pr1-1",
  "./render-scheduler.js?v=render-scheduler-v1",
  "./signal-lab.js?v=signal-lab-analytics-v1",
  "./owner-signal-lab.html",
  "./owner-signal-lab-v2.js?v=26-82-signal-lab-event-driven-collector-v1",
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
