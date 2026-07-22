const CACHE = "inpuls-v24";
const SHELL = ["./", "./index.html", "./styles.css?v=23", "./app.js?v=23", "./chart.js?v=23", "./engine.js?v=23", "./orderbook.js?v=23", "./orderbook-v24.js?v=24", "./orderbook-feed-v24.js", "./assets/inpuls-world-map-v17.png", "./manifest.webmanifest", "./icon.svg"];
const ORDERBOOK_IMPORT_MAP = '<script type="importmap">{"imports":{"./orderbook.js?v=23":"./orderbook-v24.js?v=24"}}</script>';

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

async function documentResponse(request) {
  const response = await fetch(request, { cache: "no-store" });
  if (!response.ok) return response;
  const html = await response.text();
  if (html.includes(ORDERBOOK_IMPORT_MAP)) return new Response(html, response);
  const marker = '<script type="module" src="./app.js?v=23"></script>';
  const patched = html.replace(marker, `${ORDERBOOK_IMPORT_MAP}\n    ${marker}`);
  return new Response(patched, { status: response.status, statusText: response.statusText, headers: response.headers });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  const isDocument = event.request.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/");
  event.respondWith(
    (isDocument ? documentResponse(event.request) : fetch(event.request))
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
