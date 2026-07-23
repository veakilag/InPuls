const CACHE = "inpuls-v26-15-price-ladder";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=23",
  "./app.js?v=23",
  "./chart.js?v=23",
  "./engine.js?v=23",
  "./orderbook.js?v=26-15-price-ladder",
  "./orderbook-worker.js?v=26-15-price-ladder",
  "./assets/inpuls-world-map-v17.png",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(SHELL.map((url) => cache.add(url))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function fetchFresh(request) {
  return fetch(request, { cache: "no-store" });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/orderbook.js")) {
    const forcedUrl = new URL("./orderbook.js?v=26-15-price-ladder", self.registration.scope);
    event.respondWith(fetchFresh(forcedUrl).catch(() => caches.match(forcedUrl)));
    return;
  }

  if (url.pathname.endsWith("/orderbook-worker.js")) {
    const forcedUrl = new URL("./orderbook-worker.js?v=26-15-price-ladder", self.registration.scope);
    event.respondWith(fetchFresh(forcedUrl).catch(() => caches.match(forcedUrl)));
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
