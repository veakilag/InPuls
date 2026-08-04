from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_BUILD = "26-105-tape-clock-frozen-projection-v1"
NEW_BUILD = "26-106-tape-now-live-price-buckets-v1"


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


# Keep browser entry points, Service Worker inventory and runtime-contract tests
# on one cache key so the deployed page cannot mix old and new modules.
for path in ROOT.rglob("*"):
    if not path.is_file() or ".git" in path.parts:
        continue
    if path.suffix not in {".js", ".mjs", ".html", ".md"}:
        continue
    content = path.read_text(encoding="utf-8")
    if OLD_BUILD in content:
        path.write_text(content.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")


orderbook = read("orderbook.js")
orderbook = replace_once(
    orderbook,
    "const TAPE_MAX_AGG_VISIBLE = 1_000;\nconst TAPE_SECOND_MS = 1_000;",
    "const TAPE_MAX_AGG_VISIBLE = 1_000;\nconst TAPE_RETENTION_MS = 2 * 60_000;\nconst TAPE_LIVE_EDGE_GUTTER_PX = 10;\nconst TAPE_SECOND_MS = 1_000;",
    "Tape retention constants",
)
orderbook = replace_once(
    orderbook,
    "    .orderbook-card .inpuls-tape-time-scale {\n      min-width: 116px;",
    "    .orderbook-card .inpuls-tape-time-scale {\n      flex: 0 1 174px;\n      min-width: 156px;",
    "Tape slider container width",
)
orderbook = replace_once(
    orderbook,
    "    .orderbook-card .inpuls-tape-time-scale input {\n      width: 54px;\n      min-width: 42px;",
    "    .orderbook-card .inpuls-tape-time-scale input {\n      flex: 1 1 118px;\n      width: 118px;\n      min-width: 92px;",
    "Tape slider input width",
)
orderbook = replace_once(
    orderbook,
    '''    .orderbook-card .inpuls-tape-time-scale output {\n      width: 29px;\n      color: var(--text);\n      text-align: right;\n      font-variant-numeric: tabular-nums;\n    }\n''',
    "",
    "Tape percent output styles",
)
orderbook = replace_once(
    orderbook,
    '''      <label class="inpuls-tape-time-scale" title="Временной диапазон ленты. Меньше — крупнее текущий поток; больше — длиннее история.">\n        <span>ВРЕМЯ</span>\n        <input data-inpuls-tape-time-scale type="range" min="${TAPE_TIME_SCALE_MIN}" max="${TAPE_TIME_SCALE_MAX}" step="5" value="${state.timeScale}" aria-label="Временной масштаб ленты" />\n        <output data-inpuls-tape-time-scale-value>${Math.round(state.timeScale)}%</output>\n      </label>''',
    '''      <label class="inpuls-tape-time-scale" title="Точный временной масштаб ленты. История ограничена последними двумя минутами.">\n        <span>ВРЕМЯ</span>\n        <input data-inpuls-tape-time-scale type="range" min="${TAPE_TIME_SCALE_MIN}" max="${TAPE_TIME_SCALE_MAX}" step="1" value="${state.timeScale}" aria-label="Временной масштаб ленты" />\n      </label>''',
    "Tape slider markup",
)
orderbook = orderbook.replace(
    '    const timeScaleValue = controls.querySelector("[data-inpuls-tape-time-scale-value]");\n',
    "",
)
orderbook = orderbook.replace(
    '      timeScaleValue.textContent = `${Math.round(state.timeScale)}%`;\n',
    "",
)
orderbook = orderbook.replace(
    '    const timeScaleValue = state.controls.querySelector("[data-inpuls-tape-time-scale-value]");\n',
    "",
)
orderbook = orderbook.replace(
    '    if (timeScaleValue) timeScaleValue.textContent = `${Math.round(state.timeScale)}%`;\n',
    "",
)
orderbook = orderbook.replace(
    '      const output = activeState.controls?.querySelector("[data-inpuls-tape-time-scale-value]");\n',
    "",
)
orderbook = orderbook.replace(
    '      if (output) output.textContent = `${Math.round(activeState.timeScale)}%`;\n',
    "",
)

orderbook = replace_once(
    orderbook,
    "  return clampTape(baseSeconds * scale / 100, 4, 180);",
    "  return clampTape(baseSeconds * scale / 100, 4, TAPE_RETENTION_MS / TAPE_SECOND_MS);",
    "Tape maximum visible history",
)
orderbook = replace_once(
    orderbook,
    "    plotRight: safeWidth,",
    "    plotRight: Math.max(1, safeWidth - TAPE_LIVE_EDGE_GUTTER_PX),",
    "Tape live-edge plot gutter",
)

live_edge_function = '''\nfunction drawTapeLiveEdge(context, rect, window) {\n  const x = Math.max(1, Math.min(Number(window?.plotRight) || rect.width, rect.width - 1));\n  context.save();\n  context.setLineDash([3, 3]);\n  context.lineWidth = 1;\n  context.strokeStyle = "rgba(66, 225, 173, .58)";\n  context.beginPath();\n  context.moveTo(x, 3);\n  context.lineTo(x, Math.max(3, rect.height - 15));\n  context.stroke();\n  context.setLineDash([]);\n  context.fillStyle = "rgba(93, 225, 181, .9)";\n  context.font = "800 7px Inter, system-ui, sans-serif";\n  context.textAlign = "right";\n  context.textBaseline = "top";\n  context.fillText("NOW · LIVE", x - 3, 4);\n  context.restore();\n}\n'''
orderbook = replace_once(
    orderbook,
    "\nfunction rawTapeItemsContinuous(trades, rows, window) {",
    live_edge_function + "\nfunction rawTapeItemsContinuous(trades, rows, window) {",
    "Tape live-edge renderer",
)
orderbook = replace_once(
    orderbook,
    "  drawTapeTimeline(context, rect, window);",
    "  drawTapeTimeline(context, rect, window);\n  drawTapeLiveEdge(context, rect, window);",
    "Tape live-edge draw call",
)

# Convert the stable display coordinate to estimated exchange-arrival time. Exact
# trade/event fields remain available for grouping, diagnostics and replay.
orderbook = replace_once(
    orderbook,
    "  const rxLatencyMs = Number(trade?.rxLatencyMs);\n  if (![price, quantity, quote, time].every(Number.isFinite) || quote <= 0) return null;",
    "  const rxLatencyMs = Number(trade?.rxLatencyMs);\n  const latency = Number.isFinite(rxLatencyMs) ? clampTape(rxLatencyMs, 0, 5_000) : 0;\n  const displayTime = time + latency;\n  if (![price, quantity, quote, time].every(Number.isFinite) || quote <= 0) return null;",
    "Tape arrival coordinate",
)
orderbook = replace_once(
    orderbook,
    "    time,\n    tradeTime: Number.isFinite(tradeTime) ? tradeTime : time,",
    "    time: displayTime,\n    displayTime,\n    tradeTime: Number.isFinite(tradeTime) ? tradeTime : time,",
    "Normalized Tape display time",
)
orderbook = replace_once(
    orderbook,
    "function tapeTradeKey(trade) {\n  return `${String(trade.id)}:${trade.time}:${trade.price}:${trade.quantity}`;\n}",
    "function tapeTradeKey(trade) {\n  const executionTime = Number(trade?.tradeTime ?? trade?.eventTime ?? trade?.time);\n  return `${String(trade.id)}:${executionTime}:${trade.price}:${trade.quantity}`;\n}",
    "Tape stable dedup key",
)

# Zero-ms grouping remains based on the exact execution time, while time is the
# display/arrival coordinate used by the moving live viewport.
orderbook = replace_once(
    orderbook,
    "    const eventTime = Number(trade.time);\n    const side = trade.side === \"sell\" ? \"sell\" : \"buy\";",
    "    const eventTime = Number(trade.tradeTime ?? trade.eventTime ?? trade.time);\n    const displayTime = Number(trade.displayTime ?? trade.time);\n    const side = trade.side === \"sell\" ? \"sell\" : \"buy\";",
    "Aggregate exact event time",
)
orderbook = replace_once(
    orderbook,
    "        time: eventTime,\n        lastTime: eventTime,",
    "        time: displayTime,\n        lastTime: displayTime,",
    "Aggregate display time",
)
orderbook = replace_once(
    orderbook,
    "    current.lastPrice = price;",
    "    current.time = Math.max(Number(current.time) || displayTime, displayTime);\n    current.lastTime = current.time;\n    current.lastPrice = price;",
    "Aggregate latest display time",
)
orderbook = replace_once(
    orderbook,
    "    current.lastTime = current.eventTime;\n    current.bucketStart = current.eventTime;",
    "    current.lastTime = current.time;\n    current.bucketStart = current.eventTime;",
    "Aggregate finish display time",
)

# Never render anything older than the strict two-minute Tape retention window,
# even when a previously stored scale value requests a wider duration.
orderbook = replace_once(
    orderbook,
    "function visibleWaterTapeNodes(nodes, window, output = []) {\n  output.length = 0;\n  for (const item of nodes ?? []) {\n    const time = Number(item.time);\n    if (time < window.startTime) continue;",
    "function visibleWaterTapeNodes(nodes, window, output = []) {\n  output.length = 0;\n  const retentionStart = Math.max(window.startTime, window.endTime - TAPE_RETENTION_MS);\n  for (const item of nodes ?? []) {\n    const time = Number(item.time);\n    if (time < retentionStart) continue;",
    "Tape two-minute visible retention",
)
write("orderbook.js", orderbook)


flow = read("orderbook-flow-workspace.js")
aggregation_function = '''\nexport function aggregateFootprintCellsByStep(cells, priceStep) {\n  const step = Math.max(Number.EPSILON, Number(priceStep) || .01);\n  const buckets = new Map();\n  for (const source of cells ?? []) {\n    const price = Number(source?.price);\n    if (!Number.isFinite(price)) continue;\n    const bucketIndex = Math.round(price / step);\n    const bucketPrice = Number((bucketIndex * step).toPrecision(15));\n    const key = String(bucketIndex);\n    const bucket = buckets.get(key) ?? {\n      price: bucketPrice,\n      buyQuote: 0,\n      sellQuote: 0,\n      quote: 0,\n      count: 0,\n    };\n    bucket.buyQuote += Math.max(0, Number(source.buyQuote) || 0);\n    bucket.sellQuote += Math.max(0, Number(source.sellQuote) || 0);\n    bucket.quote += Math.max(0, Number(source.quote) || 0);\n    bucket.count += Math.max(0, Number(source.count) || 0);\n    buckets.set(key, bucket);\n  }\n  return [...buckets.values()].sort((left, right) => right.price - left.price);\n}\n'''
flow = replace_once(
    flow,
    "\nexport function footprintPocCluster(clusters, referencePrice = null) {",
    aggregation_function + "\nexport function footprintPocCluster(clusters, referencePrice = null) {",
    "Footprint price-step aggregation export",
)
flow = replace_once(
    flow,
    "  const columns = intervals.map((interval) => {\n    const clusters = interval.cells\n      .map((source) => {",
    "  const displayPriceStep = rowStep(rows);\n  const columns = intervals.map((interval) => {\n    const clusters = aggregateFootprintCellsByStep(interval.cells, displayPriceStep)\n      .map((source) => {",
    "Footprint render aggregation",
)
write("orderbook-flow-workspace.js", flow)


test_path = "test-tape-now-live-footprint-buckets-v1.mjs"
test_content = '''import assert from "node:assert/strict";\nimport fs from "node:fs";\nimport test from "node:test";\n\nimport {\n  aggregateFootprintCellsByStep,\n} from "./orderbook-flow-workspace.js";\nimport { tapeSecondsForScale } from "./orderbook.js";\n\nconst read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");\n\ntest("footprint aggregates exact prices by the current ladder step", () => {\n  const result = aggregateFootprintCellsByStep([\n    { price: 100.01, buyQuote: 120, sellQuote: 0, quote: 120, count: 1 },\n    { price: 100.04, buyQuote: 0, sellQuote: 80, quote: 80, count: 1 },\n    { price: 100.11, buyQuote: 50, sellQuote: 0, quote: 50, count: 1 },\n  ], .1);\n  assert.equal(result.length, 2);\n  const first = result.find((item) => item.price === 100);\n  assert.equal(first.quote, 200);\n  assert.equal(first.buyQuote, 120);\n  assert.equal(first.sellQuote, 80);\n});\n\ntest("Tape never exposes more than two minutes", () => {\n  assert.equal(tapeSecondsForScale(4_000, 300), 120);\n});\n\ntest("Tape ships a right-side NOW line and a precise slider", () => {\n  const source = read("./orderbook.js");\n  assert.match(source, /NOW · LIVE/);\n  assert.match(source, /TAPE_RETENTION_MS = 2 \* 60_000/);\n  assert.match(source, /data-inpuls-tape-time-scale[^>]+step="1"/);\n  assert.doesNotMatch(source, /data-inpuls-tape-time-scale-value/);\n  assert.match(source, /width: 118px/);\n});\n\ntest("Tape display time includes bounded receive latency", () => {\n  const source = read("./orderbook.js");\n  assert.match(source, /const displayTime = time \+ latency/);\n  assert.match(source, /tradeTime: Number\.isFinite\(tradeTime\)/);\n});\n'''
write(test_path, test_content)

print(f"Applied {NEW_BUILD}")
