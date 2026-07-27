const CACHE = "inpuls-26-31-raw-stability-lab-v1";
const BUILD = "26-31-raw-stability-lab-v1";

const FORCED = new Map([
  ["/app.js", "./app.js?v=26-31-raw-stability-lab-v1"],
  ["/orderbook.js", "./orderbook.js?v=render-scheduler-v1"],
  ["/render-scheduler.js", "./render-scheduler.js?v=render-scheduler-v1"],
  ["/orderbook-worker.js", "./orderbook-worker.js?v=worker-bp-v1"],
  ["/orderbook-worker-buffers.js", "./orderbook-worker-buffers.js?v=worker-bp-v1"],
  ["/orderbook-tape-guard.js", "./orderbook-tape-guard.js?v=worker-bp-v1"],
  ["/orderbook-network.js", "./orderbook-network.js?v=obs-pr1-1"],
  ["/orderbook-tape-latency.js", "./orderbook-tape-latency.js?v=worker-bp-v1"],
  ["/orderbook-flow-workspace.js", "./orderbook-flow-workspace.js?v=render-scheduler-v1"],
  ["/observability.js", "./observability.js?v=render-scheduler-v1"],
]);

const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=23",
  "./app.js?v=26-31-raw-stability-lab-v1",
  "./chart.js?v=23",
  "./engine.js?v=23",
  "./orderbook.js?v=render-scheduler-v1",
  "./render-scheduler.js?v=render-scheduler-v1",
  "./orderbook-worker.js?v=worker-bp-v1",
  "./orderbook-worker-buffers.js?v=worker-bp-v1",
  "./orderbook-tape-guard.js?v=worker-bp-v1",
  "./orderbook-network.js?v=obs-pr1-1",
  "./orderbook-tape-layout.js?v=26-25-tape-v2-1",
  "./orderbook-tape-latency.js?v=worker-bp-v1",
  "./orderbook-flow-workspace.js?v=render-scheduler-v1",
  "./observability.js?v=render-scheduler-v1",
  "./raw-stability-lab.html",
  "./raw-stability-lab.js?v=1",
  "./raw-stability-core.js?v=1",
  "./trade-latency-core.js?v=2.1",
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
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("inpuls-") && key !== CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function fetchFresh(request) {
  return fetch(request, { cache: "no-store" });
}

function forcedUrlFor(url) {
  for (const [suffix, forced] of FORCED) {
    if (url.pathname.endsWith(suffix)) return new URL(forced, self.registration.scope);
  }
  return null;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const forcedUrl = forcedUrlFor(url);
  if (forcedUrl) {
    event.respondWith(fetchFresh(forcedUrl).catch(() => caches.match(forcedUrl)));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetchFresh(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html")),
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
