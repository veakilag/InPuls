const CACHE = "inpuls-v24-activation-fix-1";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=23",
  "./app.js?v=24",
  "./chart.js?v=23",
  "./engine.js?v=23",
  "./orderbook.js?v=23",
  "./orderbook-v24.js?v=24",
  "./orderbook-feed-v24.js",
  "./assets/inpuls-world-map-v17.png",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

function responseWithText(response, text, contentType) {
  const headers = new Headers(response.headers);
  headers.set("content-type", contentType);
  headers.set("cache-control", "no-store, max-age=0");
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(text, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function patchedDocument(request) {
  const response = await fetch(request, { cache: "no-store" });
  if (!response.ok) return response;

  let html = await response.text();

  // Видимая версия интерфейса.
  html = html
    .replace('<meta name="inpuls-build" content="23" />', '<meta name="inpuls-build" content="24" />')
    .replace('SCREENER <small>v23</small>', 'SCREENER <small>v24</small>')
    .replace(
      '<script type="module" src="./app.js?v=23"></script>',
      '<script type="module" src="./app.js?v=24"></script>',
    );

  return responseWithText(response, html, "text/html; charset=utf-8");
}

async function patchedApp(request) {
  const sourceUrl = new URL("./app.js?v=23", self.registration.scope);
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) return response;

  let source = await response.text();
  const oldImport = 'from "./orderbook.js?v=23";';
  const newImport = 'from "./orderbook-v24.js?v=24";';

  if (!source.includes(oldImport)) {
    return responseWithText(
      response,
      'throw new Error("InPuls v24: не найден импорт старого стакана в app.js");',
      "text/javascript; charset=utf-8",
    );
  }

  source = source.replace(oldImport, newImport);
  return responseWithText(response, source, "text/javascript; charset=utf-8");
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isDocument =
    event.request.mode === "navigate" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/InPuls/");

  const isApp = url.pathname.endsWith("/app.js");

  if (isDocument) {
    event.respondWith(
      patchedDocument(event.request).catch(() => caches.match(event.request)),
    );
    return;
  }

  if (isApp) {
    event.respondWith(patchedApp(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
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
