const BUILD = "26-95-stable-network-only-sw-v1";
const SIGNAL_LAB_COLLECTOR_STATUS_MESSAGE = "inpuls:signal-lab-collector-status";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys();
    await Promise.all(
      cacheKeys
        .filter((key) => key.startsWith("inpuls-"))
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
