const CACHE = "inpuls-v28-worker-tape-spot";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=23",
  "./app.js?v=28",
  "./chart.js?v=23",
  "./engine.js?v=23",
  "./orderbook.js?v=28",
  "./orderbook-worker.js?v=28",
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

function replaceOnce(source, oldText, newText, label, misses) {
  if (!source.includes(oldText)) {
    misses.push(label);
    return source;
  }
  return source.replace(oldText, newText);
}

async function patchedApp() {
  const sourceUrl = new URL("./app.js?v=23", self.registration.scope);
  const response = await fetchFresh(sourceUrl);
  if (!response.ok) return response;
  let source = await response.text();
  const misses = [];

  source = replaceOnce(
    source,
    "panel.manualScrollUntil = Date.now() + 650;",
    "panel.manualScrollUntil = Date.now() + 5_000;",
    "manual-scroll-timeout",
    misses,
  );

  source = replaceOnce(
    source,
    `  const manualScrollFinished = now > panel.manualScrollUntil;\n  const marketMovedAfterScroll = !Number.isFinite(panel.manualScrollAnchorPrice) || Math.abs(middle - panel.manualScrollAnchorPrice) >= panel.priceStep * .5;\n  if (panel.model.bookCentered === false && manualScrollFinished && marketMovedAfterScroll && Math.abs(middle - panel.viewCenter) >= halfSpan * .9) panel.autoCentering = true;`,
    `  const manualScrollFinished = now > panel.manualScrollUntil;\n  if (panel.model.bookCentered === false && manualScrollFinished && Math.abs(middle - panel.viewCenter) >= panel.priceStep * .25) panel.autoCentering = true;`,
    "delayed-auto-center",
    misses,
  );

  source = replaceOnce(
    source,
    `    panel.viewCenter += difference * .18;\n    if (Math.abs(difference) <= panel.priceStep * .08) {\n      panel.viewCenter = middle;\n      panel.autoCentering = false;\n      panel.manualScrollAnchorPrice = null;\n    } else if (!panel.centerFrame) {\n      panel.centerFrame = requestAnimationFrame(() => {\n        panel.centerFrame = null;\n        if (panel.latest) renderOrderBook(panel, panel.latest);\n      });\n    }`,
    `    panel.viewCenter += difference * .30;\n    if (Math.abs(difference) <= panel.priceStep * .08) {\n      panel.viewCenter = middle;\n      panel.autoCentering = false;\n      panel.manualScrollAnchorPrice = null;\n    } else if (!panel.centerFrame) {\n      panel.centerFrame = setTimeout(() => {\n        panel.centerFrame = null;\n        if (panel.latest) renderOrderBook(panel, panel.latest);\n      }, 80);\n    }`,
    "throttled-auto-center",
    misses,
  );

  source = replaceOnce(
    source,
    "  if (panel.centerFrame) cancelAnimationFrame(panel.centerFrame);",
    "  if (panel.centerFrame) { cancelAnimationFrame(panel.centerFrame); clearTimeout(panel.centerFrame); }",
    "center-cleanup",
    misses,
  );

  source = replaceOnce(
    source,
    `function bookLadderRow(row, middle, maxSize, anomalyThreshold) {\n  const side = row.askQuote > row.bidQuote ? "ask" : row.bidQuote > row.askQuote ? "bid" : row.price >= middle ? "ask" : "bid";\n  const size = Math.min(100, (row.quote / maxSize) * 100).toFixed(1);\n  const anomalous = row.quote >= anomalyThreshold && row.quote > 0;\n  return \`<div class="book-ladder-row is-\${side}\${anomalous ? " is-anomaly" : ""}\${row.isMarket ? " is-market" : ""}" style="--size:\${size}%"><span class="book-size">\${row.quote > 0 ? formatCompactUsd(row.quote) : ""}</span><strong>\${formatPrice(row.isMarket ? middle : row.price)}</strong></div>\`;\n}`,
    `function bookLadderRow(row, middle, maxSize, anomalyThreshold) {\n  const side = row.askQuote > row.bidQuote ? "ask" : row.bidQuote > row.askQuote ? "bid" : row.price >= middle ? "ask" : "bid";\n  const size = Math.min(100, (row.quote / maxSize) * 100).toFixed(1);\n  const anomalous = row.quote >= anomalyThreshold && row.quote > 0;\n  const spotQuote = side === "ask" ? Number(row.spotAskQuote) || 0 : Number(row.spotBidQuote) || 0;\n  const futuresText = row.quote > 0 ? formatCompactUsd(row.quote) : "";\n  const spotText = spotQuote > 0 ? formatCompactUsd(spotQuote) : "";\n  return \`<div class="book-ladder-row is-\${side}\${anomalous ? " is-anomaly" : ""}\${row.isMarket ? " is-market" : ""}" style="--size:\${size}%"><span class="book-size"><i class="book-futures-size" title="Futures">\${futuresText}</i><i class="book-spot-size" title="Spot">\${spotText}</i></span><strong>\${formatPrice(row.isMarket ? middle : row.price)}</strong></div>\`;\n}`,
    "spot-row-render",
    misses,
  );

  if (misses.length) {
    source = `console.warn("InPuls v28: app patch misses", ${JSON.stringify(misses)});\n${source}`;
  }
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
    const forcedUrl = new URL("./orderbook.js?v=28", self.registration.scope);
    event.respondWith(fetchFresh(forcedUrl).catch(() => caches.match(forcedUrl)));
    return;
  }

  if (url.pathname.endsWith("/orderbook-worker.js")) {
    const forcedUrl = new URL("./orderbook-worker.js?v=28", self.registration.scope);
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
