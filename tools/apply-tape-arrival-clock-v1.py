from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_KEY = "26-107-tape-clock-contracts-v1"
NEW_KEY = "26-108-tape-arrival-clock-v1"
OLD_WORKER_KEY = "26-101-binance-clock-sync-v1"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# Worker owns the calibrated receive timestamp. Do not reconstruct it later
# from a nullable per-packet RX value in the UI.
path = "orderbook-worker.js"
text = read(path)
text = replace_once(
    text,
    "  const timing = self.InPulsTapeLatency.normalizeTiming(event, receivedAt, serverClockOffsetMs);\n  const time = timing.tradeTime;\n",
    "  const timing = self.InPulsTapeLatency.normalizeTiming(event, receivedAt, serverClockOffsetMs);\n  const time = timing.tradeTime;\n  const localReceivedAt = Number(receivedAt);\n  const clockOffset = Number(serverClockOffsetMs);\n  const calibratedReceivedTime = Number.isFinite(localReceivedAt) && Number.isFinite(clockOffset)\n    ? localReceivedAt + clockOffset\n    : Number(timing.eventTime);\n  const displayTime = Number.isFinite(calibratedReceivedTime)\n    ? Math.max(time, calibratedReceivedTime)\n    : time;\n",
    "worker arrival clock",
)
text = replace_once(
    text,
    "    time,\n    tradeTime: timing.tradeTime,\n",
    "    time,\n    displayTime,\n    tradeTime: timing.tradeTime,\n",
    "worker displayTime field",
)
write(path, text)

# UI consumes the explicit Worker timestamp. The latency reconstruction remains
# only as a compatibility fallback for legacy feeds.
path = "orderbook.js"
text = read(path)
text = replace_once(
    text,
    "const ORDERBOOK_WORKER_URL = new URL(\"./orderbook-worker.js?v=26-101-binance-clock-sync-v1\", import.meta.url);",
    "const ORDERBOOK_WORKER_URL = new URL(\"./orderbook-worker.js?v=26-108-tape-arrival-clock-v1\", import.meta.url);",
    "worker cache key",
)
text = replace_once(
    text,
    "  const receivedAt = Number(trade?.receivedAt);\n  const rxLatencyMs = Number(trade?.rxLatencyMs);\n  const displayTime = tapeVisualTime(time, eventTime, rxLatencyMs);\n",
    "  const receivedAt = Number(trade?.receivedAt);\n  const rxLatencyMs = Number(trade?.rxLatencyMs);\n  const suppliedDisplayTime = Number(trade?.displayTime);\n  const displayTime = Number.isFinite(suppliedDisplayTime)\n    ? Math.max(time, suppliedDisplayTime)\n    : tapeVisualTime(time, eventTime, rxLatencyMs);\n",
    "consume explicit display time",
)
# Legacy fallback: stamp the actual arrival in the same calibrated clock domain.
text = replace_once(
    text,
    "export function normalizeMarketTrade(event) {\n  const price = Number(event?.p);\n  const quantity = Number(event?.q);\n  const time = Number(event?.T ?? event?.E);\n",
    "export function normalizeMarketTrade(event) {\n  const price = Number(event?.p);\n  const quantity = Number(event?.q);\n  const time = Number(event?.T ?? event?.E);\n  const receivedAt = Date.now();\n  const arrivalTime = Number(binanceClock.now());\n",
    "legacy arrival variables",
)
text = replace_once(
    text,
    "    quote: price * quantity,\n    time,\n    side: event?.m ? \"sell\" : \"buy\",\n",
    "    quote: price * quantity,\n    time,\n    displayTime: Number.isFinite(arrivalTime) ? Math.max(time, arrivalTime) : time,\n    tradeTime: time,\n    eventTime: Number(event?.E ?? time),\n    receivedAt,\n    rxLatencyMs: null,\n    side: event?.m ? \"sell\" : \"buy\",\n",
    "legacy arrival fields",
)
write(path, text)

# Footprint uses the same explicit arrival timestamp for the visible live
# interval. This aligns its active minute with Tape and NOW · LIVE while the
# original execution timestamp remains preserved on the source trade.
path = "orderbook-flow-workspace.js"
text = read(path)
text = replace_once(
    text,
    "  const quote = Number(trade?.quote ?? price * quantity);\n  const time = Number(trade?.time ?? trade?.tradeTime ?? trade?.eventTime);\n",
    "  const quote = Number(trade?.quote ?? price * quantity);\n  const executionTime = Number(trade?.time ?? trade?.tradeTime ?? trade?.eventTime);\n  const arrivalTime = Number(trade?.displayTime);\n  const time = Number.isFinite(arrivalTime)\n    ? Math.max(executionTime, arrivalTime)\n    : executionTime;\n",
    "footprint arrival time",
)
# Two footer rows: total traded quote first, interval time below.
old_footer = '''      state.context.fillStyle = theme.panel;\n      state.context.fillRect(columnLeft + 1, height - 11, Math.max(0, columnWidth - 2), 11);\n      state.context.textAlign = "center";\n      state.context.fillStyle = interval.partial\n        ? rgbaHex(theme.green, .96)\n        : rgbaHex(theme.muted, .82);\n      state.context.font = "700 6.5px Inter, system-ui, sans-serif";\n      state.context.fillText(\n        `${formatIntervalClock(interval.startTime)}${interval.partial ? " · LIVE" : ""}${interval.sessionPartial ? " · P" : ""}`,\n        labelX,\n        height - 5,\n      );\n      state.context.font = "800 7px Inter, system-ui, sans-serif";\n'''
new_footer = '''      state.context.fillStyle = theme.panel;\n      state.context.fillRect(columnLeft + 1, height - 22, Math.max(0, columnWidth - 2), 22);\n      state.context.textAlign = "center";\n      state.context.fillStyle = rgbaHex(theme.text, .94);\n      state.context.font = "800 6.5px Inter, system-ui, sans-serif";\n      state.context.fillText(\n        formatQuoteVolume(interval.quote),\n        labelX,\n        height - 16,\n        Math.max(1, columnWidth - 4),\n      );\n      state.context.fillStyle = interval.partial\n        ? rgbaHex(theme.green, .96)\n        : rgbaHex(theme.muted, .82);\n      state.context.font = "700 6.5px Inter, system-ui, sans-serif";\n      state.context.fillText(\n        `${formatIntervalClock(interval.startTime)}${interval.partial ? " · LIVE" : ""}${interval.sessionPartial ? " · P" : ""}`,\n        labelX,\n        height - 5,\n        Math.max(1, columnWidth - 4),\n      );\n      state.context.font = "800 7px Inter, system-ui, sans-serif";\n'''
text = replace_once(text, old_footer, new_footer, "footprint total footer")
write(path, text)

# Keep every browser entry point and regression contract on one release key.
for candidate in (
    list(ROOT.glob("*.js"))
    + list(ROOT.glob("*.mjs"))
    + list(ROOT.glob("*.html"))
    + list((ROOT / "test").glob("*.js"))
):
    content = candidate.read_text(encoding="utf-8")
    if OLD_KEY in content:
        candidate.write_text(content.replace(OLD_KEY, NEW_KEY), encoding="utf-8")

# Focused regression coverage for explicit arrival time and the column total.
test = ROOT / "test-tape-arrival-clock-v1.mjs"
test.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nimport { normalizeFlowTrade } from "./orderbook-flow-workspace.js?v=26-108-tape-arrival-clock-v1";\n\nconst read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");\n\ntest("footprint live interval uses explicit arrival time", () => {\n  const trade = normalizeFlowTrade({\n    id: 1,\n    price: 42,\n    quantity: 2,\n    quote: 84,\n    time: 1_000,\n    tradeTime: 1_000,\n    displayTime: 11_000,\n    side: "buy",\n  });\n  assert.equal(trade.time, 11_000);\n});\n\ntest("Worker publishes displayTime and Tape consumes it", () => {\n  const worker = read("./orderbook-worker.js");\n  const tape = read("./orderbook.js");\n  assert.match(worker, /const displayTime = Number\\.isFinite\\(calibratedReceivedTime\\)/);\n  assert.match(worker, /displayTime,\\n\\s+tradeTime: timing\\.tradeTime/);\n  assert.match(tape, /const suppliedDisplayTime = Number\\(trade\\?\\.displayTime\\)/);\n  assert.match(tape, /Math\\.max\\(time, suppliedDisplayTime\\)/);\n});\n\ntest("footprint column shows total quote above its time", () => {\n  const source = read("./orderbook-flow-workspace.js");\n  assert.match(source, /formatQuoteVolume\\(interval\\.quote\\)/);\n  assert.match(source, /height - 22/);\n  assert.match(source, /height - 16/);\n  assert.match(source, /height - 5/);\n});\n''', encoding="utf-8")
