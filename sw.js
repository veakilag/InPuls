const BUILD = "32";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function jsResponse(source) {
  return new Response(source, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/app.js")) {
    if (url.searchParams.get("raw") === "v32") {
      event.respondWith(fetch(event.request, { cache: "no-store" }));
      return;
    }

    const bootstrapUrl = new URL("./app-bootstrap-v32.js?v=32", self.registration.scope);
    event.respondWith(
      Promise.resolve(
        jsResponse(`import ${JSON.stringify(bootstrapUrl.href)};`),
      ),
    );
    return;
  }

  if (url.pathname.endsWith("/orderbook.js")) {
    const target = new URL("./orderbook.js?v=32", self.registration.scope);
    event.respondWith(fetch(target, { cache: "no-store" }));
    return;
  }

  if (url.pathname.endsWith("/orderbook-worker.js")) {
    const target = new URL("./orderbook-worker.js?v=32-worker", self.registration.scope);
    event.respondWith(fetch(target, { cache: "no-store" }));
    return;
  }

  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
