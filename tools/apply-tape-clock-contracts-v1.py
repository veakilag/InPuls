from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_KEY = "26-106-tape-now-live-price-buckets-v1"
NEW_KEY = "26-107-tape-clock-contracts-v1"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# Tape: keep execution time immutable for aggregation/footprint, and use
# exchange-calibrated receive time only for visual placement near NOW · LIVE.
path = "orderbook.js"
text = read(path)
helper_anchor = "function normalizeTapeTrade(trade) {\n"
helper = '''export function tapeVisualTime(tradeTime, eventTime, rxLatencyMs) {\n  const trade = Number(tradeTime);\n  const event = Number(eventTime);\n  const latency = Number.isFinite(Number(rxLatencyMs))\n    ? clampTape(Number(rxLatencyMs), 0, 10_000)\n    : 0;\n  const source = Number.isFinite(event) ? event : trade;\n  if (!Number.isFinite(source)) return null;\n  const receivedExchangeTime = source + latency;\n  return Number.isFinite(trade)\n    ? Math.max(trade, receivedExchangeTime)\n    : receivedExchangeTime;\n}\n\nfunction normalizeTapeTrade(trade) {\n'''
text = replace_once(text, helper_anchor, helper, "insert tapeVisualTime")
text = replace_once(
    text,
    "  const latency = Number.isFinite(rxLatencyMs) ? clampTape(rxLatencyMs, 0, 5_000) : 0;\n  const displayTime = time + latency;\n",
    "  const displayTime = tapeVisualTime(time, eventTime, rxLatencyMs);\n",
    "use event-time receive clock",
)
text = replace_once(
    text,
    "    time: displayTime,\n    displayTime,\n",
    "    time,\n    displayTime: Number.isFinite(displayTime) ? displayTime : time,\n",
    "preserve execution time",
)
text = replace_once(
    text,
    "      time: Number(trade.time),\n      lastTime: Number(trade.time),\n",
    "      time: Number(trade.displayTime ?? trade.time),\n      lastTime: Number(trade.displayTime ?? trade.time),\n",
    "raw marker visual time",
)
write(path, text)

# Footprint: choose the modal ladder step instead of the minimum gap. The
# current-price row may sit between two real ladder levels and must not halve
# the aggregation step. Also seed an empty live interval with the prior close.
path = "orderbook-flow-workspace.js"
text = read(path)
old_row_step = '''function rowStep(rows) {\n  const prices = [...new Set(rows.map((row) => row.price))].sort((a, b) => a - b);\n  let step = Infinity;\n  for (let index = 1; index < prices.length; index += 1) {\n    const gap = prices[index] - prices[index - 1];\n    if (gap > Number.EPSILON && gap < step) step = gap;\n  }\n  return Number.isFinite(step) ? step : .01;\n}\n'''
new_row_step = '''export function stableFootprintPriceStep(rows) {\n  const prices = [...new Set((rows ?? [])\n    .map((row) => Number(row?.price))\n    .filter(Number.isFinite))]\n    .sort((left, right) => left - right);\n  const frequencies = new Map();\n  for (let index = 1; index < prices.length; index += 1) {\n    const gap = prices[index] - prices[index - 1];\n    if (!(gap > Number.EPSILON)) continue;\n    const normalized = Number(gap.toPrecision(12));\n    const key = String(normalized);\n    const entry = frequencies.get(key) ?? { value: normalized, count: 0 };\n    entry.count += 1;\n    frequencies.set(key, entry);\n  }\n  let best = null;\n  for (const entry of frequencies.values()) {\n    if (\n      !best\n      || entry.count > best.count\n      || (entry.count === best.count && entry.value < best.value)\n    ) best = entry;\n  }\n  return best?.value ?? .01;\n}\n\nfunction rowStep(rows) {\n  return stableFootprintPriceStep(rows);\n}\n'''
text = replace_once(text, old_row_step, new_row_step, "stable footprint step")
provisional_anchor = '''  const firstObservedAt = Number(accumulator?.firstObservedAt);\n  const retainedFromAt = Number(accumulator?.retainedFromAt);\n  return {\n'''
provisional = '''  const partial = Number(now) < endTime;\n  if (partial && count === 0) {\n    let previousClose = null;\n    let previousTradeTime = -Infinity;\n    for (const bucket of accumulator?.seconds?.values?.() ?? []) {\n      if (bucket.startTime >= startTime) continue;\n      const candidateTime = Number(bucket.lastTradeTime);\n      const candidateClose = Number(bucket.closePrice);\n      if (Number.isFinite(candidateClose) && candidateTime > previousTradeTime) {\n        previousTradeTime = candidateTime;\n        previousClose = candidateClose;\n      }\n    }\n    if (Number.isFinite(previousClose)) {\n      openPrice = previousClose;\n      closePrice = previousClose;\n      highPrice = previousClose;\n      lowPrice = previousClose;\n    }\n  }\n  const firstObservedAt = Number(accumulator?.firstObservedAt);\n  const retainedFromAt = Number(accumulator?.retainedFromAt);\n  return {\n'''
text = replace_once(text, provisional_anchor, provisional, "provisional live interval")
text = replace_once(
    text,
    "    partial: Number(now) < endTime,\n",
    "    partial,\n",
    "reuse partial flag",
)
write(path, text)

# Release key must stay coherent across browser entry points, service worker,
# runtime imports and source-contract tests.
for candidate in list(ROOT.glob("*.js")) + list(ROOT.glob("*.mjs")) + list(ROOT.glob("*.html")) + list((ROOT / "test").glob("*.js")):
    content = candidate.read_text(encoding="utf-8")
    if OLD_KEY in content:
        candidate.write_text(content.replace(OLD_KEY, NEW_KEY), encoding="utf-8")

# Focused regression coverage for the three independent time contracts.
test = ROOT / "test-tape-clock-contracts-v1.mjs"
test.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\n\nimport { tapeVisualTime } from "./orderbook.js?v=26-107-tape-clock-contracts-v1";\nimport {\n  createFootprintAccumulator,\n  footprintIntervalSnapshot,\n  ingestFootprintTrades,\n  stableFootprintPriceStep,\n} from "./orderbook-flow-workspace.js?v=26-107-tape-clock-contracts-v1";\n\ntest("Tape visual time uses calibrated receive time", () => {\n  assert.equal(tapeVisualTime(10_000, 10_150, 200), 10_350);\n  assert.equal(tapeVisualTime(10_500, 10_000, 100), 10_500);\n});\n\ntest("footprint step ignores an off-grid current-price row", () => {\n  const rows = [1, 1.01, 1.02, 1.025, 1.03, 1.04, 1.05].map((price) => ({ price }));\n  assert.equal(stableFootprintPriceStep(rows), .01);\n});\n\ntest("new live interval exists before its first trade", () => {\n  const accumulator = createFootprintAccumulator();\n  ingestFootprintTrades(accumulator, [{\n    id: 1,\n    price: 42,\n    quantity: 1,\n    quote: 42,\n    time: 59_500,\n    side: "buy",\n  }]);\n  const snapshot = footprintIntervalSnapshot(accumulator, "1m", 60_250);\n  assert.equal(snapshot.startTime, 60_000);\n  assert.equal(snapshot.partial, true);\n  assert.equal(snapshot.count, 0);\n  assert.equal(snapshot.openPrice, 42);\n  assert.equal(snapshot.closePrice, 42);\n  assert.equal(snapshot.cells.length, 0);\n});\n''', encoding="utf-8")
