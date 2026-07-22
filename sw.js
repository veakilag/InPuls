const CACHE = "inpuls-v26-4-second-tape";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=23",
  "./app.js?v=23",
  "./chart.js?v=23",
  "./engine.js?v=23",
  "./orderbook.js?v=26-4",
  "./assets/inpuls-world-map-v17.png",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => caches.open(CACHE))
      .then((cache) => cache.addAll(SHELL)),
  );
  self.clients.claim();
});

async function fetchFresh(request) {
  return fetch(request, { cache: "reload" });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // app.js всё ещё импортирует orderbook.js?v=23.
  // Независимо от старого query принудительно отдаём сборку v26.
  if (url.pathname.endsWith("/orderbook.js")) {
    const forcedUrl = new URL("./orderbook.js?v=26-4", self.registration.scope);
    event.respondWith(
      fetchFresh(forcedUrl).catch(() => caches.match(forcedUrl)),
    );
    return;
  }

  event.respondWith(
    fetchFresh(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
