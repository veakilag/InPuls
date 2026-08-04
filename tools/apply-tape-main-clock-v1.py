from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_KEY = "26-108-tape-arrival-clock-v1"
NEW_KEY = "26-109-tape-main-clock-v1"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# Tape visual coordinates must use the same BinanceClock instance as NOW · LIVE.
# Worker displayTime remains diagnostic only and is intentionally ignored here.
path = "orderbook.js"
text = read(path)
anchor = "function normalizeTapeTrade(trade) {\n"
helper = '''export function tapeDisplayTimeFromReceipt(\n  receivedAt,\n  executionTime,\n  exchangeNow = binanceClock.now(),\n  localNow = Date.now(),\n) {\n  const received = Number(receivedAt);\n  const execution = Number(executionTime);\n  const exchange = Number(exchangeNow);\n  const local = Number(localNow);\n  if ([received, exchange, local].every(Number.isFinite)) {\n    const aligned = received + (exchange - local);\n    return Number.isFinite(execution) ? Math.max(execution, aligned) : aligned;\n  }\n  return Number.isFinite(execution) ? execution : null;\n}\n\nfunction normalizeTapeTrade(trade) {\n'''
text = replace_once(text, anchor, helper, "insert Tape receipt alignment")
old_block = '''  const receivedAt = Number(trade?.receivedAt);\n  const rxLatencyMs = Number(trade?.rxLatencyMs);\n  const suppliedDisplayTime = Number(trade?.displayTime);\n  const displayTime = Number.isFinite(suppliedDisplayTime)\n    ? Math.max(time, suppliedDisplayTime)\n    : tapeVisualTime(time, eventTime, rxLatencyMs);\n'''
new_block = '''  const receivedAt = Number(trade?.receivedAt);\n  const rxLatencyMs = Number(trade?.rxLatencyMs);\n  const displayTime = tapeDisplayTimeFromReceipt(receivedAt, time);\n'''
text = replace_once(text, old_block, new_block, "use main Tape clock")
write(path, text)

# Footprint uses the same conversion from local packet receipt to the main
# BinanceClock domain. This aligns 1s and 1m buckets with Tape and NOW · LIVE.
path = "orderbook-flow-workspace.js"
text = read(path)
anchor = '''function footprintExchangeNow() {\n  const perfNow = typeof performance !== "undefined" && typeof performance.now === "function"\n    ? performance.now()\n    : undefined;\n  const exchangeNow = binanceClock.now(perfNow);\n  return Number.isFinite(Number(exchangeNow)) ? Number(exchangeNow) : Date.now();\n}\n'''
helper = anchor + '''\nexport function flowDisplayTimeFromReceipt(\n  receivedAt,\n  executionTime,\n  exchangeNow = footprintExchangeNow(),\n  localNow = Date.now(),\n) {\n  const received = Number(receivedAt);\n  const execution = Number(executionTime);\n  const exchange = Number(exchangeNow);\n  const local = Number(localNow);\n  if ([received, exchange, local].every(Number.isFinite)) {\n    const aligned = received + (exchange - local);\n    return Number.isFinite(execution) ? Math.max(execution, aligned) : aligned;\n  }\n  return Number.isFinite(execution) ? execution : null;\n}\n'''
text = replace_once(text, anchor, helper, "insert footprint receipt alignment")
old_block = '''  const executionTime = Number(trade?.time ?? trade?.tradeTime ?? trade?.eventTime);\n  const arrivalTime = Number(trade?.displayTime);\n  const time = Number.isFinite(arrivalTime)\n    ? Math.max(executionTime, arrivalTime)\n    : executionTime;\n'''
new_block = '''  const executionTime = Number(trade?.time ?? trade?.tradeTime ?? trade?.eventTime);\n  const receivedAt = Number(trade?.receivedAt);\n  const alignedTime = flowDisplayTimeFromReceipt(receivedAt, executionTime);\n  const legacyDisplayTime = Number(trade?.displayTime);\n  const time = Number.isFinite(receivedAt)\n    ? alignedTime\n    : (Number.isFinite(legacyDisplayTime)\n      ? Math.max(executionTime, legacyDisplayTime)\n      : executionTime);\n'''
text = replace_once(text, old_block, new_block, "use main footprint clock")
write(path, text)

# Synchronize the browser release key while leaving the Worker build unchanged.
for candidate in (
    list(ROOT.glob("*.js"))
    + list(ROOT.glob("*.mjs"))
    + list(ROOT.glob("*.html"))
    + list((ROOT / "test").glob("*.js"))
):
    content = candidate.read_text(encoding="utf-8")
    if OLD_KEY in content:
        candidate.write_text(content.replace(OLD_KEY, NEW_KEY), encoding="utf-8")

# Replace source-level contracts that incorrectly require Worker displayTime.
path = "test-tape-arrival-clock-v1.mjs"
text = read(path)
old = '''test("Worker publishes displayTime and Tape consumes it", () => {\n  const worker = read("./orderbook-worker.js");\n  const tape = read("./orderbook.js");\n  assert.match(worker, /const displayTime = Number\\.isFinite\\(calibratedReceivedTime\\)/);\n  assert.match(worker, /displayTime,\\n\\s+tradeTime: timing\\.tradeTime/);\n  assert.match(tape, /const suppliedDisplayTime = Number\\(trade\\?\\.displayTime\\)/);\n  assert.match(tape, /Math\\.max\\(time, suppliedDisplayTime\\)/);\n});'''
new = '''test("Tape aligns local receipt with the main Binance clock", () => {\n  const worker = read("./orderbook-worker.js");\n  const tape = read("./orderbook.js");\n  assert.match(worker, /receivedAt: timing\\.receivedAt/);\n  assert.match(tape, /tapeDisplayTimeFromReceipt\\(receivedAt, time\\)/);\n  assert.doesNotMatch(tape, /const suppliedDisplayTime = Number\\(trade\\?\\.displayTime\\)/);\n});'''
text = replace_once(text, old, new, "update arrival clock test")
write(path, text)

path = "test-tape-now-live-footprint-buckets-v1.mjs"
text = read(path)
old = '''test("Tape prefers explicit arrival time and preserves execution time", () => {\n  const source = read("./orderbook.js");\n  assert.match(source, /const suppliedDisplayTime = Number\\(trade\\?\\.displayTime\\)/);\n  assert.match(source, /Number\\.isFinite\\(suppliedDisplayTime\\)/);\n  assert.match(source, /Math\\.max\\(time, suppliedDisplayTime\\)/);\n  assert.match(source, /time,\\n\\s+displayTime: Number\\.isFinite\\(displayTime\\) \\? displayTime : time/);\n  assert.match(source, /trade\\.displayTime \\?\\? trade\\.time/);\n  assert.match(source, /tradeTime: Number\\.isFinite\\(tradeTime\\)/);\n});'''
new = '''test("Tape uses main-clock receipt time and preserves execution time", () => {\n  const source = read("./orderbook.js");\n  assert.match(source, /tapeDisplayTimeFromReceipt\\(receivedAt, time\\)/);\n  assert.match(source, /received \\+ \\(exchange - local\\)/);\n  assert.match(source, /time,\\n\\s+displayTime: Number\\.isFinite\\(displayTime\\) \\? displayTime : time/);\n  assert.match(source, /trade\\.displayTime \\?\\? trade\\.time/);\n  assert.match(source, /tradeTime: Number\\.isFinite\\(tradeTime\\)/);\n});'''
text = replace_once(text, old, new, "update NOW clock test")
write(path, text)

# Focused deterministic contract for a workstation clock that is ten seconds
# behind Binance. Both Tape and footprint must land in the same current second.
test = ROOT / "test-tape-main-clock-v1.mjs"
test.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\n\nimport { tapeDisplayTimeFromReceipt } from "./orderbook.js?v=26-109-tape-main-clock-v1";\nimport { flowDisplayTimeFromReceipt } from "./orderbook-flow-workspace.js?v=26-109-tape-main-clock-v1";\n\ntest("Tape and footprint share the main Binance clock", () => {\n  const localNow = 1_000_000;\n  const exchangeNow = 1_010_000;\n  const receivedAt = 999_850;\n  const executionTime = 999_700;\n  const expected = 1_009_850;\n  assert.equal(\n    tapeDisplayTimeFromReceipt(receivedAt, executionTime, exchangeNow, localNow),\n    expected,\n  );\n  assert.equal(\n    flowDisplayTimeFromReceipt(receivedAt, executionTime, exchangeNow, localNow),\n    expected,\n  );\n});\n\ntest("receipt alignment never moves before execution", () => {\n  assert.equal(tapeDisplayTimeFromReceipt(900, 1_200, 1_000, 1_000), 1_200);\n  assert.equal(flowDisplayTimeFromReceipt(900, 1_200, 1_000, 1_000), 1_200);\n});\n''', encoding="utf-8")
