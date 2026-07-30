import { readFile, writeFile } from "node:fs/promises";

const OLD_BUILD = "26-78-agg-range-rx-v1";
const BUILD = "26-79-event-radar-beta-v1";

async function read(path) {
  return readFile(path, "utf8");
}

async function write(path, content) {
  await writeFile(path, content, "utf8");
}

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing anchor: ${label}`);
  return source.replace(before, after);
}

async function patchIndex() {
  let source = await read("index.html");
  source = source.replaceAll(OLD_BUILD, BUILD);
  if (!source.includes("event-radar-beta.css")) {
    source = replaceRequired(
      source,
      `    <link rel="stylesheet" href="./styles.css?v=${BUILD}" />`,
      `    <link rel="stylesheet" href="./styles.css?v=${BUILD}" />\n    <link rel="stylesheet" href="./event-radar-beta.css?v=event-radar-beta-v1" />`,
      "event radar stylesheet",
    );
  }
  if (!source.includes("id=\"event-radar-beta-toggle\"")) {
    source = replaceRequired(
      source,
      `        <button id="settings-open" class="icon-button" type="button" title="Настройки и размер шрифта" aria-label="Настройки">⚙</button>`,
      `        <button id="event-radar-beta-toggle" type="button" aria-pressed="true" title="Открыть событийный радар BETA">РАДАР BETA</button>\n        <button id="settings-open" class="icon-button" type="button" title="Настройки и размер шрифта" aria-label="Настройки">⚙</button>`,
      "event radar toggle",
    );
  }
  if (!source.includes("event-radar-beta.js")) {
    source = replaceRequired(
      source,
      `    <script type="module" src="./app.js?v=${BUILD}"></script>`,
      `    <script type="module" src="./event-radar-beta.js?v=event-radar-beta-v1"></script>\n    <script type="module" src="./app.js?v=${BUILD}"></script>`,
      "event radar module",
    );
  }
  await write("index.html", source);
}

async function patchApp() {
  let source = await read("app.js");
  source = source.replaceAll(OLD_BUILD, BUILD);
  if (!source.includes("inpuls:event-radar-update")) {
    source = replaceRequired(
      source,
      `  state.lastMetrics = metrics;\n  updateSignalMemory(marketwideMetrics, now);`,
      `  state.lastMetrics = metrics;\n  const eventRadarMetrics = metrics.map((item) => {\n    const marketwideSignals = marketSizeScanner.signalsFor(item.symbol, now);\n    const cascade = detectMarketwideCascade(item);\n    return {\n      ...item,\n      signals: [\n        ...(Array.isArray(item.signals) ? item.signals : []),\n        ...marketwideSignals,\n        ...(cascade ? [cascade] : []),\n      ],\n    };\n  });\n  window.dispatchEvent(new CustomEvent("inpuls:event-radar-update", {\n    detail: { metrics: eventRadarMetrics, now, favorites: [...state.favorites] },\n  }));\n  updateSignalMemory(marketwideMetrics, now);`,
      "event radar market update",
    );
    source = replaceRequired(
      source,
      `  applyWorkspaceLayout();\n  els.comfortSlider.value = String(state.comfort);`,
      `  applyWorkspaceLayout();\n  window.addEventListener("inpuls:event-radar-select", (event) => {\n    const symbol = normalizeUsdtPerpetualSymbol(event.detail?.symbol);\n    if (!symbol) return;\n    selectChartSymbol(symbol, true);\n    if (event.detail?.openOrderBook !== false) openOrderBookForSymbol(symbol);\n  });\n  window.addEventListener("inpuls:event-radar-favorite", (event) => {\n    const symbol = normalizeUsdtPerpetualSymbol(event.detail?.symbol);\n    if (symbol) toggleFavorite(symbol);\n  });\n  els.comfortSlider.value = String(state.comfort);`,
      "event radar actions",
    );
  }
  await write("app.js", source);
}

async function patchServiceWorker() {
  let source = await read("sw.js");
  source = source.replaceAll(OLD_BUILD, BUILD);
  if (!source.includes('["/event-radar-beta.js"')) {
    source = replaceRequired(
      source,
      `  ["/observability.js", "./observability.js?v=render-scheduler-v1"],`,
      `  ["/event-radar-beta.js", "./event-radar-beta.js?v=event-radar-beta-v1"],\n  ["/event-radar-beta.css", "./event-radar-beta.css?v=event-radar-beta-v1"],\n  ["/observability.js", "./observability.js?v=render-scheduler-v1"],`,
      "event radar forced assets",
    );
  }
  if (!source.includes('"./event-radar-beta.js?v=event-radar-beta-v1"')) throw new Error("Event radar JS missing from service worker");
  const shellAnchor = `  "./app.js?v=${BUILD}",`;
  if (!source.includes(`  "./event-radar-beta.css?v=event-radar-beta-v1",`)) {
    source = replaceRequired(
      source,
      shellAnchor,
      `${shellAnchor}\n  "./event-radar-beta.js?v=event-radar-beta-v1",\n  "./event-radar-beta.css?v=event-radar-beta-v1",`,
      "event radar shell assets",
    );
  }
  await write("sw.js", source);
}

async function patchReleaseFiles() {
  const files = ["refresh.html", "refresh.js", "reset-v26.html", "reset.js", "test/ui.test.js"];
  for (const path of files) {
    const source = await read(path);
    await write(path, source.replaceAll(OLD_BUILD, BUILD));
  }
  let version = (await read("VERSION.txt")).replaceAll(OLD_BUILD, BUILD);
  if (!version.includes("event-radar-beta-v1")) {
    version = version.trimEnd().replace(/\n?$/, "") + ", event-radar-beta-v1, event-age-lifecycle-v1, event-list-freeze-v1, event-data-state-v1\n";
  }
  await write("VERSION.txt", version);
}

async function patchUiTests() {
  let source = await read("test/ui.test.js");
  if (!source.includes("event radar beta is isolated")) {
    source += `\n\ntest("event radar beta is isolated from the three existing discovery blocks", async () => {\n  const [html, app, worker, widget, css] = await Promise.all([\n    source("index.html"), source("app.js"), source("sw.js"), source("event-radar-beta.js"), source("event-radar-beta.css"),\n  ]);\n  assert.match(html, /id="event-radar-beta-toggle"/);\n  assert.match(html, /event-radar-beta\\.js\\?v=event-radar-beta-v1/);\n  assert.match(app, /inpuls:event-radar-update/);\n  assert.match(app, /inpuls:event-radar-select/);\n  assert.match(app, /openOrderBookForSymbol\\(symbol\\)/);\n  assert.match(widget, /ПАУЗА/);\n  assert.match(widget, /eventRadarStatus/);\n  assert.match(widget, /eventRadarDataState/);\n  assert.match(css, /position: fixed/);\n  assert.match(worker, /event-radar-beta\\.js/);\n  assert.match(html, /class="inplay-strip"/);\n  assert.match(html, /data-panel="radar"/);\n  assert.match(html, /data-panel="scanner"/);\n});\n`;
  }
  await write("test/ui.test.js", source);
}

await patchIndex();
await patchApp();
await patchServiceWorker();
await patchReleaseFiles();
await patchUiTests();
