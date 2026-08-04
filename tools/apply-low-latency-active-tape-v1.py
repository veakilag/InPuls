from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_UI_KEY = "26-109-tape-main-clock-v1"
OLD_WORKER_KEY = "26-108-tape-arrival-clock-v1"
NEW_KEY = "26-110-low-latency-active-tape-v1"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# Worker: the selected symbol is already priorityRank() === 0. Give only that
# symbol a 4 ms micro-batch; keep background feeds at 25 ms to avoid message
# storms and preserve multi-panel performance.
path = "orderbook-worker.js"
text = read(path)
text = replace_once(
    text,
    "const TAPE_FLUSH_MS = 25;\n",
    "const PRIORITY_TAPE_FLUSH_MS = 4;\nconst TAPE_FLUSH_MS = 25;\n",
    "priority Tape flush constant",
)
old_method = '''  scheduleTapeFlush() {\n    if (!this.tapeTimer) {\n      this.tapeTimer = setTimeout(() => this.flushTapeBatch(), TAPE_FLUSH_MS);\n    }\n  }\n'''
new_method = '''  tapeFlushDelayMs() {\n    return this.priorityRank() === 0\n      ? PRIORITY_TAPE_FLUSH_MS\n      : TAPE_FLUSH_MS;\n  }\n\n  scheduleTapeFlush() {\n    if (!this.tapeTimer) {\n      this.tapeTimer = setTimeout(\n        () => this.flushTapeBatch(),\n        this.tapeFlushDelayMs(),\n      );\n    }\n  }\n'''
text = replace_once(text, old_method, new_method, "priority Tape flush method")
write(path, text)

# Legacy fallback: it has only one selected symbol, so reduce its artificial
# batch delay from one display frame to the same 4 ms latency target.
path = "orderbook.js"
text = read(path)
old_legacy = '''  #queueTradeDispatch(trade) {\n    if (!trade) return;\n    this.tradeDispatchBatch.push(trade);\n    if (this.tradeDispatchTimer) return;\n    this.tradeDispatchTimer = setTimeout(() => {\n      this.tradeDispatchTimer = null;\n      const trades = this.tradeDispatchBatch.splice(0);\n      if (trades.length) {\n        this.#dispatchTapeData({\n          replace: false,\n          live: true,\n          liveOnly: true,\n          trades,\n        });\n      }\n    }, 16);\n  }\n'''
new_legacy = '''  #queueTradeDispatch(trade) {\n    if (!trade) return;\n    this.tradeDispatchBatch.push(trade);\n    if (this.tradeDispatchTimer) return;\n    this.tradeDispatchTimer = setTimeout(() => {\n      this.tradeDispatchTimer = null;\n      const trades = this.tradeDispatchBatch.splice(0);\n      if (trades.length) {\n        this.#dispatchTapeData({\n          replace: false,\n          live: true,\n          liveOnly: true,\n          trades,\n        });\n      }\n    }, 4);\n  }\n'''
text = replace_once(text, old_legacy, new_legacy, "legacy Tape flush")
write(path, text)

# The Worker changed, so all browser entry points, Service Worker inventory and
# source-contract tests must request the new build. The UI release key is also
# moved once so stale PWA caches cannot mix old and new latency paths.
for candidate in (
    list(ROOT.glob("*.js"))
    + list(ROOT.glob("*.mjs"))
    + list(ROOT.glob("*.html"))
    + list((ROOT / "test").glob("*.js"))
):
    content = candidate.read_text(encoding="utf-8")
    updated = content.replace(OLD_UI_KEY, NEW_KEY).replace(OLD_WORKER_KEY, NEW_KEY)
    if updated != content:
        candidate.write_text(updated, encoding="utf-8")

# Focused regression contract. It deliberately checks that only the selected
# Worker feed gets the fast path and background batching stays unchanged.
test = ROOT / "test-low-latency-active-tape-v1.mjs"
test.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");\n\ntest("priority Worker Tape uses a 4 ms micro-batch", () => {\n  const source = read("./orderbook-worker.js");\n  assert.match(source, /const PRIORITY_TAPE_FLUSH_MS = 4/);\n  assert.match(source, /const TAPE_FLUSH_MS = 25/);\n  assert.match(source, /this\\.priorityRank\\(\\) === 0/);\n  assert.match(source, /\\? PRIORITY_TAPE_FLUSH_MS\\n\\s+: TAPE_FLUSH_MS/);\n  assert.match(source, /this\\.tapeFlushDelayMs\\(\\)/);\n});\n\ntest("legacy fallback uses the same 4 ms target", () => {\n  const source = read("./orderbook.js");\n  const block = source.match(/#queueTradeDispatch\\(trade\\) \\{[\\s\\S]*?\\n  \\}/)?.[0] ?? "";\n  assert.match(block, /\\}, 4\\);/);\n  assert.doesNotMatch(block, /\\}, 16\\);/);\n});\n\ntest("new Worker build is consistent across runtime", () => {\n  const orderbook = read("./orderbook.js");\n  const serviceWorker = read("./sw.js");\n  assert.match(orderbook, /orderbook-worker\\.js\\?v=26-110-low-latency-active-tape-v1/);\n  assert.match(serviceWorker, /orderbook-worker\\.js\\?v=26-110-low-latency-active-tape-v1/);\n});\n''', encoding="utf-8")
