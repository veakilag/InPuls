const CACHE = "inpuls-v31-start-spot";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=23",
  "./app.js?v=23",
  "./chart.js?v=23",
  "./engine.js?v=23",
  "./orderbook.js?v=31",
  "./orderbook-worker.js?v=31-worker",
  "./boot-v31.html",
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

function textResponse(response, text, contentType = "text/javascript; charset=utf-8") {
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

function replaceRequired(source, oldText, newText, label, misses) {
  if (!source.includes(oldText)) {
    misses.push(label);
    return source;
  }
  return source.replace(oldText, newText);
}

async function patchedApp() {
  const sourceUrl = new URL("./app.js?v=23&source=v31", self.registration.scope);
  const response = await fetchFresh(sourceUrl);
  if (!response.ok) return response;
  let source = await response.text();
  const misses = [];

  // Гарантированно импортируем текущий Worker-стакан со Spot.
  source = replaceRequired(
    source,
    'from "./orderbook.js?v=23";',
    'from "./orderbook.js?v=31";',
    "orderbook-import",
    misses,
  );

  // Исправляем корневой рыночный поток приложения.
  source = replaceRequired(
    source,
    '      ? "wss://fstream.binance.com/market/stream"\n      : "wss://stream.binancefuture.com/market/stream";',
    '      ? "wss://fstream.binance.com/ws"\n      : "wss://stream.binancefuture.com/ws";',
    "main-binance-endpoint",
    misses,
  );

  // Не рендерим весь скринер в фоне и не копим очередь кадров.
  source = replaceRequired(
    source,
    `let scheduledMarketRender = null;
function scheduleRender() {
  if (scheduledMarketRender !== null) return;
  scheduledMarketRender = setTimeout(() => {
    scheduledMarketRender = null;
    render();
  }, 180);
}`,
    `let scheduledMarketRender = null;
let marketRenderPendingWhileHidden = false;
function scheduleRender() {
  if (document.hidden) {
    marketRenderPendingWhileHidden = true;
    return;
  }
  if (scheduledMarketRender !== null) return;
  scheduledMarketRender = setTimeout(() => {
    scheduledMarketRender = null;
    if (document.hidden) {
      marketRenderPendingWhileHidden = true;
      return;
    }
    marketRenderPendingWhileHidden = false;
    render();
  }, 180);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (scheduledMarketRender !== null) clearTimeout(scheduledMarketRender);
    scheduledMarketRender = null;
    marketRenderPendingWhileHidden = true;
    return;
  }
  if (marketRenderPendingWhileHidden) {
    marketRenderPendingWhileHidden = false;
    scheduleRender();
  }
});`,
    "background-market-render",
    misses,
  );

  // Периодический полный render также не запускается в скрытой вкладке.
  source = replaceRequired(
    source,
    "setInterval(render, 1000);",
    "setInterval(() => { if (!document.hidden) render(); }, 1000);",
    "background-interval-render",
    misses,
  );

  // Ручной скролл удерживается 5 секунд.
  source = replaceRequired(
    source,
    "panel.manualScrollUntil = Date.now() + 650;",
    "panel.manualScrollUntil = Date.now() + 5_000;",
    "manual-scroll-timeout",
    misses,
  );

  source = replaceRequired(
    source,
    `  const manualScrollFinished = now > panel.manualScrollUntil;
  const marketMovedAfterScroll = !Number.isFinite(panel.manualScrollAnchorPrice) || Math.abs(middle - panel.manualScrollAnchorPrice) >= panel.priceStep * .5;
  if (panel.model.bookCentered === false && manualScrollFinished && marketMovedAfterScroll && Math.abs(middle - panel.viewCenter) >= halfSpan * .9) panel.autoCentering = true;`,
    `  const manualScrollFinished = now > panel.manualScrollUntil;
  if (panel.model.bookCentered === false && manualScrollFinished && Math.abs(middle - panel.viewCenter) >= panel.priceStep * .25) panel.autoCentering = true;`,
    "delayed-auto-center",
    misses,
  );

  source = replaceRequired(
    source,
    `    panel.viewCenter += difference * .18;
    if (Math.abs(difference) <= panel.priceStep * .08) {
      panel.viewCenter = middle;
      panel.autoCentering = false;
      panel.manualScrollAnchorPrice = null;
    } else if (!panel.centerFrame) {
      panel.centerFrame = requestAnimationFrame(() => {
        panel.centerFrame = null;
        if (panel.latest) renderOrderBook(panel, panel.latest);
      });
    }`,
    `    panel.viewCenter += difference * .30;
    if (Math.abs(difference) <= panel.priceStep * .08) {
      panel.viewCenter = middle;
      panel.autoCentering = false;
      panel.manualScrollAnchorPrice = null;
    } else if (!panel.centerFrame) {
      panel.centerFrame = setTimeout(() => {
        panel.centerFrame = null;
        if (panel.latest && !document.hidden) renderOrderBook(panel, panel.latest);
      }, 80);
    }`,
    "throttled-auto-center",
    misses,
  );

  source = replaceRequired(
    source,
    "  if (panel.centerFrame) cancelAnimationFrame(panel.centerFrame);",
    "  if (panel.centerFrame) { cancelAnimationFrame(panel.centerFrame); clearTimeout(panel.centerFrame); }",
    "center-cleanup",
    misses,
  );

  // Spot-сайзы рядом с Futures.
  source = replaceRequired(
    source,
    `function bookLadderRow(row, middle, maxSize, anomalyThreshold) {
  const side = row.askQuote > row.bidQuote ? "ask" : row.bidQuote > row.askQuote ? "bid" : row.price >= middle ? "ask" : "bid";
  const size = Math.min(100, (row.quote / maxSize) * 100).toFixed(1);
  const anomalous = row.quote >= anomalyThreshold && row.quote > 0;
  return \`<div class="book-ladder-row is-\${side}\${anomalous ? " is-anomaly" : ""}\${row.isMarket ? " is-market" : ""}" style="--size:\${size}%"><span class="book-size">\${row.quote > 0 ? formatCompactUsd(row.quote) : ""}</span><strong>\${formatPrice(row.isMarket ? middle : row.price)}</strong></div>\`;
}`,
    `function bookLadderRow(row, middle, maxSize, anomalyThreshold) {
  const side = row.askQuote > row.bidQuote ? "ask" : row.bidQuote > row.askQuote ? "bid" : row.price >= middle ? "ask" : "bid";
  const size = Math.min(100, (row.quote / maxSize) * 100).toFixed(1);
  const anomalous = row.quote >= anomalyThreshold && row.quote > 0;
  const spotQuote = side === "ask" ? Number(row.spotAskQuote) || 0 : Number(row.spotBidQuote) || 0;
  const futuresText = row.quote > 0 ? formatCompactUsd(row.quote) : "";
  const spotText = spotQuote > 0 ? formatCompactUsd(spotQuote) : "";
  return \`<div class="book-ladder-row is-\${side}\${anomalous ? " is-anomaly" : ""}\${row.isMarket ? " is-market" : ""}" style="--size:\${size}%"><span class="book-size"><i class="book-futures-size" title="Futures">\${futuresText}</i><i class="book-spot-size" title="Spot">\${spotText}</i></span><strong>\${formatPrice(row.isMarket ? middle : row.price)}</strong></div>\`;
}`,
    "spot-row-render",
    misses,
  );

  // Приложение больше не удаляет контролирующий v31 Service Worker.
  source = replaceRequired(
    source,
    `// During active development always prefer the current GitHub Pages build.
// Offline PWA caching will return after the interface stabilizes.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("inpuls-")).map((key) => caches.delete(key)));
    }
  });
}`,
    `// InPuls v31: Service Worker сохраняется, чтобы стабильно выдавать актуальную сборку.`,
    "remove-self-unregister",
    misses,
  );

  source = `console.info("InPuls v31 runtime", { misses: ${JSON.stringify(misses)} });\n${source}`;
  return textResponse(response, source);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith("/app.js")) {
    event.respondWith(patchedApp().catch(() => fetchFresh(event.request)));
    return;
  }

  if (url.pathname.endsWith("/orderbook.js")) {
    const forcedUrl = new URL("./orderbook.js?v=31", self.registration.scope);
    event.respondWith(fetchFresh(forcedUrl).catch(() => caches.match(forcedUrl)));
    return;
  }

  if (url.pathname.endsWith("/orderbook-worker.js")) {
    const forcedUrl = new URL("./orderbook-worker.js?v=31-worker", self.registration.scope);
    event.respondWith(fetchFresh(forcedUrl).catch(() => caches.match(forcedUrl)));
    return;
  }

  event.respondWith(
    fetchFresh(event.request)
      .then((response) => {
        if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
