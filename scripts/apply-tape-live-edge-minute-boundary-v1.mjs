import fs from "node:fs";

const BUILD = "26-102-tape-live-edge-minute-boundary-v1";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(path, before, after) {
  const source = read(path);
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one anchor, found ${count}: ${before.slice(0, 90)}`);
  write(path, source.replace(before, after));
}

function appendOnce(path, marker, content) {
  const source = read(path);
  if (source.includes(marker)) return;
  write(path, `${source.trimEnd()}\n\n${content.trim()}\n`);
}

replaceOnce(
  "binance-clock.js",
  `    const local = Number(this.dateNow());\n    const candidate = this.isCalibrated() && Number.isFinite(perf)`,
  `    const local = Number(this.dateNow());\n    // Tape passes an explicit performance timestamp. Before Binance calibration,\n    // returning the workstation clock here can seed the moving live edge several\n    // seconds in the future. Display clocks may still use the local fallback.\n    if (!this.isCalibrated() && hasExplicitPerf) return null;\n    const candidate = this.isCalibrated() && Number.isFinite(perf)`,
);

replaceOnce(
  "chart.js",
  `const MARKET_WS = "wss://fstream.binance.com/market/ws";`,
  `import { binanceClock } from "./binance-clock.js?v=${BUILD}";\n\nconst MARKET_WS = "wss://fstream.binance.com/market/ws";`,
);

replaceOnce(
  "chart.js",
  `export function scaleFromDrag(initialScale, delta, sensitivity = 120) {`,
  `export function buildProvisionalCandle(previous, bucketStart, bucketMs) {\n  const source = previous && typeof previous === "object" ? previous : null;\n  const time = Number(bucketStart);\n  const duration = Number(bucketMs);\n  const close = Number(source?.close);\n  if (![time, duration, close].every(Number.isFinite) || duration <= 0 || time <= Number(source?.time)) return null;\n  return {\n    time,\n    open: close,\n    high: close,\n    low: close,\n    close,\n    volume: 0,\n    closeTime: time + duration - 1,\n    closed: false,\n    provisional: true,\n  };\n}\n\nexport function scaleFromDrag(initialScale, delta, sensitivity = 120) {`,
);

replaceOnce(
  "chart.js",
  `    this.cacheFlushTimer = null;\n  }`,
  `    this.cacheFlushTimer = null;\n    this.boundaryTimer = null;\n    this.clockStateHandler = () => this.#scheduleBoundaryTick(this.generation);\n    binanceClock.addEventListener("statechange", this.clockStateHandler);\n  }`,
);

replaceOnce(
  "chart.js",
  `    if (generation === this.generation) this.#connect(generation);`,
  `    if (generation === this.generation) {\n      this.#connect(generation);\n      this.#scheduleBoundaryTick(generation);\n    }`,
);

replaceOnce(
  "chart.js",
  `  destroy() {\n    this.generation += 1;\n    this.#cleanup();\n  }`,
  `  #scheduleBoundaryTick(generation) {\n    clearTimeout(this.boundaryTimer);\n    this.boundaryTimer = null;\n    const intervalMs = Number(INTERVAL_MS[this.interval]);\n    if (generation !== this.generation || !Number.isFinite(intervalMs) || intervalMs < 60_000) return;\n    const now = Number(binanceClock.now());\n    if (!Number.isFinite(now)) return;\n    const nextBoundary = Math.floor(now / intervalMs) * intervalMs + intervalMs;\n    const delay = Math.max(20, Math.min(2_000_000_000, nextBoundary - now + 12));\n    this.boundaryTimer = setTimeout(() => this.#advanceBoundary(generation), delay);\n  }\n\n  #advanceBoundary(generation) {\n    this.boundaryTimer = null;\n    const intervalMs = Number(INTERVAL_MS[this.interval]);\n    const now = Number(binanceClock.now());\n    if (generation !== this.generation || !Number.isFinite(intervalMs) || intervalMs < 60_000 || !Number.isFinite(now)) return;\n    const currentBucket = Math.floor(now / intervalMs) * intervalMs;\n    let previous = this.candles.at(-1);\n    let changed = false;\n    let guard = 0;\n    while (previous && Number(previous.time) < currentBucket && guard < 120) {\n      const provisional = buildProvisionalCandle(previous, Number(previous.time) + intervalMs, intervalMs);\n      if (!provisional) break;\n      upsertLiveCandleInPlace(this.candles, provisional, 1_500);\n      previous = this.candles.at(-1);\n      changed = true;\n      guard += 1;\n    }\n    if (changed) {\n      this.#scheduleSeriesCacheFlush();\n      this.#scheduleLiveEmit({\n        symbol: this.symbol,\n        interval: this.interval,\n        range: this.range,\n        provisionalBoundary: true,\n      });\n      globalThis.dispatchEvent?.(new CustomEvent("inpuls:kline-boundary", {\n        detail: { symbol: this.symbol, interval: this.interval, time: currentBucket },\n      }));\n    }\n    this.#scheduleBoundaryTick(generation);\n  }\n\n  destroy() {\n    this.generation += 1;\n    this.#cleanup();\n    binanceClock.removeEventListener("statechange", this.clockStateHandler);\n  }`,
);

replaceOnce(
  "chart.js",
  `    clearTimeout(this.cacheFlushTimer);\n    this.cacheFlushTimer = null;`,
  `    clearTimeout(this.cacheFlushTimer);\n    clearTimeout(this.boundaryTimer);\n    this.cacheFlushTimer = null;\n    this.boundaryTimer = null;`,
);

replaceOnce(
  "orderbook.js",
  `import { binanceClock } from "./binance-clock.js?v=26-101-binance-clock-sync-v1";`,
  `import { binanceClock } from "./binance-clock.js?v=${BUILD}";`,
);

replaceOnce(
  "orderbook.js",
  `export function aggregateFootprintClusters(trades, minimumQuote = 0, priceStep = .01, bucketMs = 5_000) {`,
  `export function ensureFootprintLiveBucket(items, currentPrice, endTime, bucketMs = 5_000) {\n  const source = Array.isArray(items) ? items : [];\n  const price = Number(currentPrice);\n  const end = Number(endTime);\n  const duration = Math.max(250, Math.floor(Number(bucketMs) || 5_000));\n  if (![price, end].every(Number.isFinite) || price <= 0) return source;\n  const time = Math.floor(Math.max(0, end - 1) / duration) * duration;\n  if (source.some((item) => Number(item?.time) === time)) return source;\n  return [...source, {\n    key: \`empty-live:\${time}\`,\n    time,\n    price,\n    quote: 0,\n    buyQuote: 0,\n    sellQuote: 0,\n    count: 0,\n    empty: true,\n  }];\n}\n\nexport function aggregateFootprintClusters(trades, minimumQuote = 0, priceStep = .01, bucketMs = 5_000) {`,
);

replaceOnce(
  "app.js",
  `import { calculateNatr, CandlestickChart, KlineFeed, parseRestKline, pearsonCorrelation } from "./chart.js?v=26-97-smooth-chart-first-v1";`,
  `import { calculateNatr, CandlestickChart, KlineFeed, parseRestKline, pearsonCorrelation } from "./chart.js?v=${BUILD}";`,
);

replaceOnce(
  "app.js",
  `import { aggregateFootprintClusters, aggregateTradePath, bookAnomalyQuote, bookDisplayedQuote, bookDistancePercentLabel, bookQuoteScale, bookScaleIndexForWheel, bookScaleLabel, buildDepthLadder, clampDepthViewCenter, inferPriceTick, maximumBookScaleIndex, marketAnchoredBookViewCenter, maximumDepthQuote, OrderBookFeed, parseRuntimeNumber, priceStepForScale, sessionBookAnomalyThreshold, tradeTimeWindow } from "./orderbook.js?v=26-101-binance-clock-sync-v1";`,
  `import { aggregateFootprintClusters, aggregateTradePath, bookAnomalyQuote, bookDisplayedQuote, bookDistancePercentLabel, bookQuoteScale, bookScaleIndexForWheel, bookScaleLabel, buildDepthLadder, clampDepthViewCenter, ensureFootprintLiveBucket, inferPriceTick, maximumBookScaleIndex, marketAnchoredBookViewCenter, maximumDepthQuote, OrderBookFeed, parseRuntimeNumber, priceStepForScale, sessionBookAnomalyThreshold, tradeTimeWindow } from "./orderbook.js?v=${BUILD}";`,
);

replaceOnce(
  "app.js",
  `  const items = panel.model.clustersVisible\n    ? aggregateFootprintClusters(visibleTrades, panel.model.tradeMinQuote, clusterStep, bucketMs)\n    : aggregateTradePath(visibleTrades, panel.model.tradeMinQuote, clusterStep, 260, bucketMs);`,
  `  let items = panel.model.clustersVisible\n    ? aggregateFootprintClusters(visibleTrades, panel.model.tradeMinQuote, clusterStep, bucketMs)\n    : aggregateTradePath(visibleTrades, panel.model.tradeMinQuote, clusterStep, 260, bucketMs);\n  if (panel.model.clustersVisible) {\n    const livePrice = Number(visibleTrades[0]?.price ?? trades[0]?.price ?? items.at(-1)?.price);\n    items = ensureFootprintLiveBucket(items, livePrice, window.end, bucketMs);\n  }`,
);

replaceOnce(
  "app.js",
  `      return \`<button class="footprint-cell\${cluster.quote >= anomaly ? " is-anomaly" : ""}\${selected ? " is-selected" : ""}" data-trade-path-key="\${cluster.key}" type="button" style="--x:\${cluster.x.toFixed(2)}%;--y:\${cluster.y.toFixed(2)}%;--cell-w:\${cellWidth.toFixed(1)}px" title="\${cluster.count} исполнений · \${formatPrice(cluster.price)}"><span>\${formatCompactUsd(cluster.sellQuote).replace("$", "")}</span><strong>\${formatCompactUsd(cluster.buyQuote).replace("$", "")}</strong></button>\`;`,
  `      const empty = cluster.empty === true;\n      return \`<button class="footprint-cell\${empty ? " is-empty" : ""}\${!empty && cluster.quote >= anomaly ? " is-anomaly" : ""}\${selected ? " is-selected" : ""}" data-trade-path-key="\${cluster.key}" type="button" style="--x:\${cluster.x.toFixed(2)}%;--y:\${cluster.y.toFixed(2)}%;--cell-w:\${cellWidth.toFixed(1)}px" title="\${empty ? "Текущий интервал · исполнений пока нет" : \`\${cluster.count} исполнений · \${formatPrice(cluster.price)}\`}"><span>\${empty ? "—" : formatCompactUsd(cluster.sellQuote).replace("$", "")}</span><strong>\${empty ? "—" : formatCompactUsd(cluster.buyQuote).replace("$", "")}</strong></button>\`;`,
);

replaceOnce("app.js", `./binance-clock.js?v=26-101-binance-clock-sync-v1`, `./binance-clock.js?v=${BUILD}`);

replaceOnce(
  "index.html",
  `<meta name="inpuls-build" content="26-101-binance-clock-sync-v1" />`,
  `<meta name="inpuls-build" content="${BUILD}" />`,
);
replaceOnce(
  "index.html",
  `<script src="./install-cta.js?v=comfort-tape-priority-v1"></script>`,
  `<script src="./install-cta.js?v=comfort-tape-priority-v1"></script>\n    <script type="module" src="./canvas-comfort-preview.js?v=${BUILD}"></script>`,
);
replaceOnce(
  "index.html",
  `<script type="module" src="./app.js?v=26-101-binance-clock-sync-v1"></script>`,
  `<script type="module" src="./app.js?v=${BUILD}"></script>`,
);

for (const [before, after] of [
  [`./app.js?v=26-101-binance-clock-sync-v1`, `./app.js?v=${BUILD}`],
  [`./binance-clock.js?v=26-101-binance-clock-sync-v1`, `./binance-clock.js?v=${BUILD}`],
  [`./chart.js?v=23`, `./chart.js?v=${BUILD}`],
  [`./orderbook.js?v=26-101-binance-clock-sync-v1`, `./orderbook.js?v=${BUILD}`],
]) replaceOnce("sw.js", before, after);

replaceOnce(
  "sw.js",
  `  "./binance-clock.js?v=${BUILD}",`,
  `  "./binance-clock.js?v=${BUILD}",\n  "./canvas-comfort-preview.js?v=${BUILD}",`,
);

appendOnce(
  "styles.css",
  ".footprint-cell.is-empty",
  `.footprint-cell.is-empty {\n  border-style: dashed;\n  border-color: color-mix(in srgb, var(--muted) 42%, transparent);\n  color: color-mix(in srgb, var(--muted) 72%, transparent);\n  background: color-mix(in srgb, var(--panel-2) 68%, transparent);\n  box-shadow: none;\n  opacity: .7;\n}\n.footprint-cell.is-empty span, .footprint-cell.is-empty strong { color: inherit; }`,
);

const clockTest = "test-binance-clock-sync-v1.mjs";
replaceOnce(
  clockTest,
  `  assert.equal(clock.calibrate({ offsetMs: 250, rttMs: 20, sampleCount: 3 }, localNow, perfNow), true);`,
  `  assert.equal(clock.now(perfNow), null, "Tape must not seed its live edge from workstation time before calibration");\n  assert.equal(clock.now(), localNow, "the visible clock may use local fallback during calibration");\n\n  assert.equal(clock.calibrate({ offsetMs: 250, rttMs: 20, sampleCount: 3 }, localNow, perfNow), true);`,
);
replaceOnce(clockTest, /26-101-binance-clock-sync-v1/g.source, BUILD);

write(
  "test-tape-live-edge-minute-boundary-v1.mjs",
  `import assert from "node:assert/strict";\nimport fs from "node:fs";\nimport test from "node:test";\n\nimport { buildProvisionalCandle } from "./chart.js";\nimport { ensureFootprintLiveBucket } from "./orderbook.js";\n\nconst BUILD = "${BUILD}";\nconst read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");\n\ntest("minute boundary creates a zero-volume provisional candle from the last close", () => {\n  const candle = buildProvisionalCandle(\n    { time: 60_000, close: 12.5 },\n    120_000,\n    60_000,\n  );\n  assert.deepEqual(candle, {\n    time: 120_000, open: 12.5, high: 12.5, low: 12.5, close: 12.5,\n    volume: 0, closeTime: 179_999, closed: false, provisional: true,\n  });\n});\n\ntest("current footprint interval is represented honestly before its first execution", () => {\n  const previous = [{ key: "old", time: 5_000, price: 10, quote: 100, buyQuote: 100, sellQuote: 0, count: 1 }];\n  const next = ensureFootprintLiveBucket(previous, 10.25, 10_001, 5_000);\n  assert.equal(next.length, 2);\n  assert.deepEqual(next.at(-1), {\n    key: "empty-live:10000", time: 10_000, price: 10.25, quote: 0,\n    buyQuote: 0, sellQuote: 0, count: 0, empty: true,\n  });\n});\n\ntest("runtime loads the live Canvas preview and fresh boundary build", () => {\n  const index = read("./index.html");\n  const app = read("./app.js");\n  const chart = read("./chart.js");\n  const sw = read("./sw.js");\n  assert.match(index, new RegExp(\`canvas-comfort-preview\\\\.js\\\\?v=\${BUILD}\`));\n  assert.match(index, new RegExp(\`app\\\\.js\\\\?v=\${BUILD}\`));\n  assert.match(app, new RegExp(\`chart\\\\.js\\\\?v=\${BUILD}\`));\n  assert.match(chart, /#scheduleBoundaryTick/);\n  assert.match(sw, new RegExp(\`canvas-comfort-preview\\\\.js\\\\?v=\${BUILD}\`));\n});\n`,
);

console.log(`Applied ${BUILD}`);
