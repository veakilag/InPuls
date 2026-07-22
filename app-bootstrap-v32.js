console.info("InPuls v32 bootstrap: start");

const statusText = document.querySelector("#connection-text");
const clock = document.querySelector("#clock");

function showBootError(error) {
  const message = error?.stack || error?.message || String(error);
  console.error("InPuls v32 bootstrap failed:", error);
  if (statusText) statusText.textContent = "Ошибка запуска";
  if (clock) {
    clock.textContent = "ОШИБКА";
    clock.title = message;
  }
  let panel = document.querySelector("#inpuls-boot-error");
  if (!panel) {
    panel = document.createElement("pre");
    panel.id = "inpuls-boot-error";
    panel.style.cssText = [
      "position:fixed",
      "z-index:999999",
      "left:16px",
      "right:16px",
      "bottom:16px",
      "max-height:40vh",
      "overflow:auto",
      "padding:14px",
      "border:1px solid #ff5d6c",
      "border-radius:10px",
      "background:#180b0f",
      "color:#ffb8c0",
      "font:12px/1.45 ui-monospace,monospace",
      "white-space:pre-wrap",
    ].join(";");
    document.body.append(panel);
  }
  panel.textContent = message;
}

function replaceRequired(source, oldText, newText, label, misses) {
  if (!source.includes(oldText)) {
    misses.push(label);
    return source;
  }
  return source.replace(oldText, newText);
}

try {
  const rawUrl = new URL("./app.js?v=23&raw=v32", location.href);
  const response = await fetch(rawUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`app.js: HTTP ${response.status}`);

  let source = await response.text();
  const misses = [];

  const engineUrl = new URL("./engine.js?v=23", location.href).href;
  const chartUrl = new URL("./chart.js?v=23", location.href).href;
  const orderbookUrl = new URL("./orderbook.js?v=32", location.href).href;

  source = replaceRequired(
    source,
    'from "./engine.js?v=23";',
    `from ${JSON.stringify(engineUrl)};`,
    "engine-import",
    misses,
  );
  source = replaceRequired(
    source,
    'from "./chart.js?v=23";',
    `from ${JSON.stringify(chartUrl)};`,
    "chart-import",
    misses,
  );
  source = replaceRequired(
    source,
    'from "./orderbook.js?v=23";',
    `from ${JSON.stringify(orderbookUrl)};`,
    "orderbook-import",
    misses,
  );

  source = replaceRequired(
    source,
    '      ? "wss://fstream.binance.com/market/stream"\n      : "wss://stream.binancefuture.com/market/stream";',
    '      ? "wss://fstream.binance.com/ws"\n      : "wss://stream.binancefuture.com/ws";',
    "main-binance-endpoint",
    misses,
  );

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

  source = replaceRequired(
    source,
    "setInterval(render, 1000);",
    "setInterval(() => { if (!document.hidden) render(); }, 1000);",
    "background-interval-render",
    misses,
  );

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
    `// InPuls v32: загрузчиком управляет стабильный bootstrap.`,
    "remove-self-unregister",
    misses,
  );

  const critical = ["engine-import", "chart-import", "orderbook-import", "main-binance-endpoint"];
  const criticalMisses = misses.filter((item) => critical.includes(item));
  if (criticalMisses.length) {
    throw new Error(`Не найдены обязательные участки app.js: ${criticalMisses.join(", ")}`);
  }

  source = `console.info("InPuls v32 app", { misses: ${JSON.stringify(misses)} });\n${source}`;

  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    await import(blobUrl);
    console.info("InPuls v32 bootstrap: app started", { misses });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
} catch (error) {
  showBootError(error);
}
