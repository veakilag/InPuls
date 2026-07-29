const CACHE = "inpuls-26-55-scalper-pattern-evidence-v1";
const BUILD = "26-55-scalper-pattern-evidence-v1";

const FORCED = new Map([
  ["/app.js", "./app.js?v=26-55-scalper-pattern-evidence-v1"],
  ["/orderbook.js", "./orderbook.js?v=26-55-scalper-pattern-evidence-v1"],
  ["/orderbook-events.js", "./orderbook-events.js?v=orderbook-events-core-v1"],
  ["/orderbook-density.js", "./orderbook-density.js?v=density-trades-correlation-v1"],
  ["/engine.js", "./engine.js?v=26-55-scalper-pattern-evidence-v1"],
  ["/market-memory.js", "./market-memory.js?v=26-55-scalper-pattern-evidence-v1"],
  ["/market-pattern-scanner.js", "./market-pattern-scanner.js?v=marketwide-patterns-v1"],
  ["/pattern-catalog.js", "./pattern-catalog.js?v=26-55-scalper-pattern-evidence-v1"],
  ["/signal-lab.js", "./signal-lab.js?v=signal-lab-analytics-v1"],
  ["/owner-navigation.js", "./owner-navigation.js?v=owner-signal-lab-v1"],
  ["/owner-signal-lab-guard.js", "./owner-signal-lab-guard.js?v=26-55-scalper-pattern-evidence-v1"],
  ["/owner-signal-lab.js", "./owner-signal-lab.js?v=26-55-scalper-pattern-evidence-v1"],
  ["/owner-signal-lab.css", "./owner-signal-lab.css?v=26-55-scalper-pattern-evidence-v1"],
  ["/render-scheduler.js", "./render-scheduler.js?v=render-scheduler-v1"],
  ["/orderbook-worker.js", "./orderbook-worker.js?v=26-55-scalper-pattern-evidence-v1"],
  ["/orderbook-worker-buffers.js", "./orderbook-worker-buffers.js?v=worker-bp-v1"],
  ["/orderbook-depth-projection.js", "./orderbook-depth-projection.js?v=deep-book-v1"],
  ["/orderbook-tape-guard.js", "./orderbook-tape-guard.js?v=worker-bp-v1"],
  ["/orderbook-network.js", "./orderbook-network.js?v=obs-pr1-1"],
  ["/orderbook-tape-latency.js", "./orderbook-tape-latency.js?v=worker-bp-v1"],
  ["/orderbook-flow-workspace.js", "./orderbook-flow-workspace.js?v=26-55-scalper-pattern-evidence-v1"],
  ["/observability.js", "./observability.js?v=render-scheduler-v1"],
]);

const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=26-55-scalper-pattern-evidence-v1",
  "./app.js?v=26-55-scalper-pattern-evidence-v1",
  "./chart.js?v=23",
  "./engine.js?v=26-55-scalper-pattern-evidence-v1",
  "./orderbook.js?v=26-55-scalper-pattern-evidence-v1",
  "./orderbook-events.js?v=orderbook-events-core-v1",
  "./orderbook-density.js?v=density-trades-correlation-v1",
  "./market-memory.js?v=26-55-scalper-pattern-evidence-v1",
  "./market-pattern-scanner.js?v=marketwide-patterns-v1",
  "./pattern-catalog.js?v=26-55-scalper-pattern-evidence-v1",
  "./signal-lab.js?v=signal-lab-analytics-v1",
  "./owner-signal-lab.html",
  "./owner-signal-lab-guard.js?v=26-55-scalper-pattern-evidence-v1",
  "./owner-signal-lab.js?v=26-55-scalper-pattern-evidence-v1",
  "./owner-signal-lab.css?v=26-55-scalper-pattern-evidence-v1",
  "./owner-navigation.js?v=owner-signal-lab-v1",
  "./render-scheduler.js?v=render-scheduler-v1",
  "./orderbook-worker.js?v=26-55-scalper-pattern-evidence-v1",
  "./orderbook-worker-buffers.js?v=worker-bp-v1",
  "./orderbook-depth-projection.js?v=deep-book-v1",
  "./orderbook-tape-guard.js?v=worker-bp-v1",
  "./orderbook-network.js?v=obs-pr1-1",
  "./orderbook-tape-layout.js?v=stable-tape-v3",
  "./orderbook-tape-latency.js?v=worker-bp-v1",
  "./orderbook-flow-workspace.js?v=26-55-scalper-pattern-evidence-v1",
  "./observability.js?v=render-scheduler-v1",
  "./pwa-reset.js",
  "./refresh.html",
  "./refresh.js?v=26-55-scalper-pattern-evidence-v1",
  "./reset-v26.html",
  "./reset.js?v=26-55-scalper-pattern-evidence-v1",
  "./raw-stability-lab.html",
  "./raw-stability-lab.js?v=3",
  "./raw-stability-core.js?v=3",
  "./trade-latency-core.js?v=2.1",
  "./assets/inpuls-world-map-v17.png",
  "./manifest.webmanifest",
  "./icon.svg",
];

function expectedContentTypes(request) {
  const url = new URL(typeof request === "string" ? request : request.url, self.registration.scope);
  if (url.pathname.endsWith(".js")) return ["text/javascript", "application/javascript"];
  if (url.pathname.endsWith(".css")) return ["text/css"];
  if (url.pathname.endsWith(".svg")) return ["image/svg+xml"];
  if (url.pathname.endsWith(".png")) return ["image/png"];
  if (url.pathname.endsWith(".webmanifest")) return ["application/manifest+json"];
  if (url.pathname.endsWith(".html") || url.pathname.endsWith("/")) return ["text/html"];
  return [];
}

function isCacheableResponse(request, response) {
  if (!response?.ok || response.type === "opaque") return false;
  const requestUrl = new URL(typeof request === "string" ? request : request.url, self.registration.scope);
  const responseUrl = new URL(response.url || requestUrl.href);
  if (requestUrl.origin !== self.location.origin || responseUrl.origin !== self.location.origin) return false;
  const expected = expectedContentTypes(request);
  if (!expected.length) return false;
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  return expected.some((type) => contentType.includes(type));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.addAll(SHELL);
        const responses = await Promise.all(SHELL.map((url) => cache.match(url)));
        if (!responses.every((response, index) => isCacheableResponse(SHELL[index], response))) {
          throw new TypeError("InPuls app shell failed content-type validation");
        }
        await self.skipWaiting();
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
    })(),
  );
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

async function cacheFreshResponse(request, response) {
  if (!isCacheableResponse(request, response)) return false;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  return true;
}

function forcedUrlFor(url) {
  for (const [suffix, forced] of FORCED) {
    if (url.pathname.endsWith(suffix)) return new URL(forced, self.registration.scope);
  }
  return null;
}

function navigationShellFor(request) {
  const requestUrl = new URL(request.url);
  const ownerPath = new URL("./owner-signal-lab.html", self.registration.scope).pathname;
  return requestUrl.pathname === ownerPath ? "./owner-signal-lab.html" : "./index.html";
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const forcedUrl = forcedUrlFor(url);
  if (forcedUrl) {
    event.respondWith(
      fetchFresh(forcedUrl)
        .then(async (response) => {
          if (!await cacheFreshResponse(forcedUrl, response)) {
            throw new TypeError("Invalid runtime response");
          }
          return response;
        })
        .catch(() => caches.match(forcedUrl)),
    );
    return;
  }

  if (event.request.mode === "navigate") {
    const navigationShell = navigationShellFor(event.request);
    event.respondWith(
      fetchFresh(event.request)
        .then(async (response) => {
          if (isCacheableResponse(event.request, response)) {
            const cache = await caches.open(CACHE);
            await cache.put(navigationShell, response.clone());
          }
          return response;
        })
        .catch(() => caches.match(navigationShell)),
    );
    return;
  }

  event.respondWith(
    fetchFresh(event.request)
      .then(async (response) => {
        await cacheFreshResponse(event.request, response);
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
