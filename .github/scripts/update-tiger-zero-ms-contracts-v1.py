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


def replace_test(text: str, title: str, replacement: str, label: str) -> str:
    pattern = rf'test\("{re.escape(title)}",[\s\S]*?\n\}}\);'
    updated, count = re.subn(pattern, replacement, text, count=1)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 test, found {count}")
    return updated


worker = read("orderbook-worker.js")
pattern = r'''  insertTrade\(trade, newestFirst = true\) \{\n    if \(!trade\) return false;\n    const hasRawRange = [\s\S]*?\n    const key = this\.tradeKey\(trade\);\n    if \(this\.tradeIds\.has\(key\)\) return false;\n    if \(hasRawRange\) this\.tapeGuard\.advanceBoundary\(lastTradeId\);'''
replacement = '''  insertTrade(trade, newestFirst = true) {
    if (!trade) return false;
    const key = this.tradeKey(trade);
    if (this.tradeIds.has(key)) return false;'''
worker, count = re.subn(pattern, replacement, worker, count=1)
if count != 1:
    raise AssertionError(f"primary boundary: expected 1 block, found {count}")
write("orderbook-worker.js", worker)

path = "test-orderbook-guarded-raw-tape.mjs"
text = read(path)
text = replace_test(
    text,
    "production worker keeps aggregate live while the isolated guard retains RAW shadow checks",
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
)
write(path, text)

path = "test-orderbook-tape-latency.mjs"
text = read(path)
text = replace_once(
    text,
    '  assert.match(worker, /normalizeTrade\\(update, "agg", receivedAt\\)/);\n',
    '  assert.match(worker, /normalizeTrade\\(update, source, receivedAt\\)/);\n',
    "latency source",
)
write(path, text)

path = "test-raw-stability-core.mjs"
text = read(path)
text = replace_test(
    text,
    "browser lab keeps RAW isolated from production and uses routed multi-stream URLs",
    '''test("browser lab stays isolated while production adds a guarded raw AGG channel", () => {
  const source = readFileSync(new URL("./raw-stability-lab.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("./raw-stability-lab.html", import.meta.url), "utf8");
  const worker = readFileSync(new URL("./orderbook-worker.js", import.meta.url), "utf8");
  const serviceWorker = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  assert.match(source, /fstream\.binance\.com\/\$\{route\}\/stream\?streams=\$\{streams\}/);
  assert.match(source, /fstream\.binance\.com\/\$\{route\}\/ws\/\$\{streams\}/);
  assert.match(source, /background-resume-clean-restart/);
  assert.match(source, /manual-raw-restart/);
  assert.match(source, /source-only-stall/);
  assert.match(source, /window\.__INPULS_RAW_LAB__/);
  assert.match(html, /Production TAPE эта страница не переключает/);
  assert.match(source, /MATCH_GUARD_MS = 5_000/);
  assert.match(source, /sequenceObserved/);
  assert.match(source, /sequenceMarkers/);
  assert.match(source, /sequenceMarkerSamples/);
  assert.match(source, /invalidSamples/);
  assert.match(html, /raw-stability-lab\.js\?v=3/);
  assert.match(worker, /return \[`\$\{name\}@aggTrade`, `\$\{name\}@trade`\];/);
  assert.match(worker, /if \(aggregateEvent && this\.insertTrade\(trade, true\)\)/);
  assert.match(worker, /if \(decision\.emit && this\.insertAggregationTrade\(trade, true\)\)/);
  assert.match(serviceWorker, /inpuls-26-77-tiger-zero-ms-agg-v1/);
  assert.match(serviceWorker, /raw-stability-lab\.html/);
  assert.match(serviceWorker, /raw-stability-lab\.js\?v=3/);
  assert.match(serviceWorker, /raw-stability-core\.js\?v=3/);
});''',
    "raw stability contract",
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
text = replace_test(
    text,
    "production Worker uses routed Binance streams and aggregate trades only",
    '''test("production Worker keeps aggTrade for visual RAW and guards trade for AGG", () => {
  assert.match(worker, /fstream\.binance\.com\/public\/stream\?streams=/);
  assert.match(worker, /fstream\.binance\.com\/market\/stream\?streams=/);
  assert.match(worker, /return \[`\$\{name\}@aggTrade`, `\$\{name\}@trade`\];/);
  assert.match(worker, /aggregationTapeBatch/);
  assert.match(worker, /aggregationSource: guard\.mode/);
  assert.doesNotMatch(worker, /stream\.binancefuture\.com/);
  assert.doesNotMatch(app, /stream\.binancefuture\.com/);
  assert.match(worker, /AGG LIVE|tapeGuard\.label\(\)/);
});''',
    "backpressure dual source contract",
)
write(path, text)

path = "test/orderbook-render-scheduler.test.js"
text = read(path)
text = replace_test(
    text,
    "Tape ingestion shares each frame between active symbols",
    '''test("Tape ingestion shares each frame between symbols and both trade channels", () => {
  assert.match(runtime, /const liveShare = Math\.max\(1, Math\.floor\(budget \/ Math\.max\(1, pendingEntries\.length\)\)\)/);
  assert.match(runtime, /const allowance = pending\.resume[\s\S]*Math\.min\(budget, liveShare\)/);
  assert.match(runtime, /pending\.aggregationTrades/);
  assert.match(runtime, /tapeRecentRateBySymbol\.set\(symbol/);
  assert.match(runtime, /tape\.ingest-frame/);
});''',
    "dual channel scheduler contract",
)
write(path, text)

final_worker = read("orderbook-worker.js")
assert 'return [`${name}@aggTrade`, `${name}@trade`];' in final_worker
assert 'if (aggregateEvent && this.insertTrade(trade, true))' in final_worker
assert 'if (decision.emit && this.insertAggregationTrade(trade, true))' in final_worker
insert_start = final_worker.index('  insertTrade(trade')
insert_end = final_worker.index('\n  insertAggregationTrade', insert_start)
assert 'advanceBoundary' not in final_worker[insert_start:insert_end]
