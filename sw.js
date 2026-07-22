const CACHE = "inpuls-v25-full-book";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=23",
  "./app.js?v=23",
  "./chart.js?v=23",
  "./engine.js?v=23",
  "./orderbook.js?v=23",
  "./orderbook-v24.js?v=24",
  "./orderbook-core-v25.js",
  "./orderbook-feed-v25.js",
  "./assets/inpuls-world-map-v17.png",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
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
