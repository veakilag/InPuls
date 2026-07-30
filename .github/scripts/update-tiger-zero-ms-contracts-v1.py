from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str, flags=0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 match, found {count}")
    return updated


worker = read("orderbook-worker.js")
worker = regex_once(
    worker,
    r'''  insertTrade\(trade, newestFirst = true\) \{\n    if \(!trade\) return false;\n    const hasRawRange = [\s\S]*?\n    const key = this\.tradeKey\(trade\);\n    if \(this\.tradeIds\.has\(key\)\) return false;\n    if \(hasRawRange\) this\.tapeGuard\.advanceBoundary\(lastTradeId\);''',
    '''  insertTrade(trade, newestFirst = true) {
    if (!trade) return false;
    const key = this.tradeKey(trade);
    if (this.tradeIds.has(key)) return false;''',
    "primary feed must not advance aggregation guard boundary",
    flags=re.MULTILINE,
)
write("orderbook-worker.js", worker)

path = "test-orderbook-guarded-raw-tape.mjs"
text = read(path)
text = regex_once(
    text,
    r'test\("production worker keeps aggregate live while the isolated guard retains RAW shadow checks", \(context\) => \{[\s\S]*?\n\}\);',
    '''test("production worker keeps visual RAW stable and routes guarded raw trades only to AGG", (context) => {
  const workerUrl = new URL("./orderbook-worker.js", import.meta.url);
  if (!existsSync(workerUrl)) { context.skip("worker is added by the branch transformer"); return; }
  const worker = readFileSync(workerUrl, "utf8");
  const guard = readFileSync(new URL("./orderbook-tape-guard.js", import.meta.url), "utf8");
  assert.match(worker, /importScripts\("\.\/orderbook-tape-guard\.js\?v=worker-bp-v1"\);/);
  assert.match(worker, /return \[`\$\{name\}@aggTrade`, `\$\{name\}@trade`\];/);
  assert.match(worker, /if \(aggregateEvent && this\.insertTrade\(trade, true\)\)/);
  assert.match(worker, /if \(decision\.emit && this\.insertAggregationTrade\(trade, true\)\)/);
  assert.match(worker, /aggregationSource: guard\.mode/);
  assert.match(worker, /\/market\/stream\?streams=/);
  assert.match(worker, /new self\.InPulsTapeGuard/);
  assert.match(worker, /decision = this\.tapeGuard\.ingest/);
  assert.match(guard, /RAW SHADOW/);
  assert.match(guard, /AGG LIVE/);
  assert.match(worker, /tapeGuard\.label\(\)/);
  const insertStart = worker.indexOf("  insertTrade(trade");
  const insertEnd = worker.indexOf("\n  insertAggregationTrade", insertStart);
  const primaryInsert = worker.slice(insertStart, insertEnd);
  assert.doesNotMatch(primaryInsert, /tapeGuard\.advanceBoundary/);
});''',
    "guarded raw worker contract",
    flags=re.MULTILINE,
)
write(path, text)

path = "test-orderbook-tape-latency.mjs"
text = read(path)
text = replace_once(
    text,
    '  assert.match(worker, /normalizeTrade\\(update, "agg", receivedAt\\)/);\n',
    '  assert.match(worker, /normalizeTrade\\(update, source, receivedAt\\)/);\n',
    "latency dual source",
)
write(path, text)

path = "test-raw-stability-core.mjs"
text = read(path)
text = replace_once(
    text,
    '  assert.match(worker, /return \\[ `?`?/',
    '  assert.match(worker, /return \\[ `?`?/',
    "noop",
) if False else text
text = replace_once(
    text,
    '  assert.match(worker, /return \\[\`\\$\\{name\\}@aggTrade\`\\];/);\n  assert.doesNotMatch(worker, /return \\[\`\\$\\{name\\}@trade\`\\];/);\n',
    '  assert.match(worker, /return \\[\`\\$\\{name\\}@aggTrade\`, \`\\$\\{name\\}@trade\`\\];/);\n  assert.match(worker, /if \\(aggregateEvent && this\\.insertTrade\\(trade, true\\)\\)/);\n  assert.match(worker, /if \\(decision\\.emit && this\\.insertAggregationTrade\\(trade, true\\)\\)/);\n',
    "raw stability dual stream contract",
)
write(path, text)

path = "test/connection-observability.test.js"
text = read(path)
text = replace_once(
    text,
    '  assert.match(worker, /sourceKind: "live-trade"/);\n',
    '  assert.match(worker, /sourceKind: "live-trade-dual"/);\n',
    "dual source observability",
)
write(path, text)

path = "test/orderbook-backpressure.test.js"
text = read(path)
text = replace_once(
    text,
    'test("production Worker uses routed Binance streams and aggregate trades only", () => {\n',
    'test("production Worker keeps aggTrade for visual RAW and guards trade for AGG", () => {\n',
    "backpressure test name",
)
text = replace_once(
    text,
    '  assert.match(worker, /return \\[\`\\$\\{name\\}@aggTrade\`\\];/);\n  assert.doesNotMatch(worker, /\`\\$\\{name\\}@trade\`/);\n',
    '  assert.match(worker, /return \\[\`\\$\\{name\\}@aggTrade\`, \`\\$\\{name\\}@trade\`\\];/);\n  assert.match(worker, /aggregationTapeBatch/);\n  assert.match(worker, /aggregationSource: guard\\.mode/);\n',
    "backpressure dual stream",
)
write(path, text)

path = "test/orderbook-render-scheduler.test.js"
text = read(path)
text = replace_once(
    text,
    '  assert.match(runtime, /Math\\.min\\(budget, liveShare, pending\\.trades\\.length\\)/);\n',
    '  assert.match(runtime, /const allowance = pending\\.resume[\\s\\S]*Math\\.min\\(budget, liveShare\\)/);\n  assert.match(runtime, /pending\\.aggregationTrades/);\n',
    "dual channel scheduler",
)
write(path, text)

final_worker = read("orderbook-worker.js")
assert 'return [`${name}@aggTrade`, `${name}@trade`];' in final_worker
assert 'if (aggregateEvent && this.insertTrade(trade, true))' in final_worker
assert 'if (decision.emit && this.insertAggregationTrade(trade, true))' in final_worker
insert_start = final_worker.index('  insertTrade(trade')
insert_end = final_worker.index('\n  insertAggregationTrade', insert_start)
assert 'advanceBoundary' not in final_worker[insert_start:insert_end]
