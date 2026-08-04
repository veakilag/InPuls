from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_WORKER = r"orderbook-worker\.js\?v=26-101-binance-clock-sync-v1"
NEW_WORKER = r"orderbook-worker\.js\?v=26-108-tape-arrival-clock-v1"

updated_worker_contracts = 0
for path in ROOT.glob("test-*.mjs"):
    content = path.read_text(encoding="utf-8")
    count = content.count(OLD_WORKER)
    if count < 1:
        continue
    path.write_text(content.replace(OLD_WORKER, NEW_WORKER), encoding="utf-8")
    updated_worker_contracts += count
if updated_worker_contracts < 1:
    raise SystemExit("no legacy Worker cache assertions found")

path = ROOT / "test-tape-now-live-footprint-buckets-v1.mjs"
content = path.read_text(encoding="utf-8")
old = '''test("Tape display time stays separate from execution time", () => {\n  const source = read("./orderbook.js");\n  assert.match(source, /const displayTime = tapeVisualTime\\(time, eventTime, rxLatencyMs\\)/);\n  assert.match(source, /time,\\n\\s+displayTime: Number\\.isFinite\\(displayTime\\) \\? displayTime : time/);\n  assert.match(source, /trade\\.displayTime \\?\\? trade\\.time/);\n  assert.match(source, /tradeTime: Number\\.isFinite\\(tradeTime\\)/);\n});'''
new = '''test("Tape prefers explicit arrival time and preserves execution time", () => {\n  const source = read("./orderbook.js");\n  assert.match(source, /const suppliedDisplayTime = Number\\(trade\\?\\.displayTime\\)/);\n  assert.match(source, /Number\\.isFinite\\(suppliedDisplayTime\\)/);\n  assert.match(source, /Math\\.max\\(time, suppliedDisplayTime\\)/);\n  assert.match(source, /time,\\n\\s+displayTime: Number\\.isFinite\\(displayTime\\) \\? displayTime : time/);\n  assert.match(source, /trade\\.displayTime \\?\\? trade\\.time/);\n  assert.match(source, /tradeTime: Number\\.isFinite\\(tradeTime\\)/);\n});'''
count = content.count(old)
if count != 1:
    raise SystemExit(f"Tape display-time contract: expected one block, found {count}")
path.write_text(content.replace(old, new), encoding="utf-8")
