from pathlib import Path

OLD_BUILD = "26-77-tiger-zero-ms-agg-v1"
NEW_BUILD = "26-78-agg-range-rx-v1"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


latency_path = "orderbook-tape-latency.js"
latency = read(latency_path)
latency = replace_once(
    latency,
    '''    const validLatency = Number.isFinite(rawLatency) && rawLatency >= -100 && rawLatency <= 10_000
      ? Math.max(0, rawLatency)
      : null;
''',
    '''    // A negative value is clock-calibration uncertainty, not a real zero-latency packet.
    // Do not clamp it to zero because that creates a convincing but false RX 0ms status.
    const validLatency = Number.isFinite(rawLatency) && rawLatency >= 0 && rawLatency <= 10_000
      ? rawLatency
      : null;
''',
    "negative RX is unavailable instead of zero",
)
write(latency_path, latency)

worker_path = "orderbook-worker.js"
worker = read(worker_path)
worker = replace_once(
    worker,
    '''  latencyText() {
    const latency = this.tradeLatency.current();
    return Number.isFinite(latency) ? ` · RX ${Math.round(latency)}ms` : "";
  }
''',
    '''  latencyText() {
    const latency = this.tradeLatency.current();
    if (!Number.isFinite(latency)) return "";
    const value = latency < 1
      ? "<1"
      : latency < 10
        ? latency.toFixed(1)
        : String(Math.round(latency));
    return ` · RX ${value}ms`;
  }
''',
    "sub-ms RX formatting",
)
worker = replace_once(
    worker,
    '''        this.tradeLatency.record(trade.rxLatencyMs, receivedAt);
''',
    '''        // RX in the header describes the stable production Tape feed. The parallel
        // experimental @trade channel must not double-weight or zero the rolling median.
        if (aggregateEvent) this.tradeLatency.record(trade.rxLatencyMs, receivedAt);
''',
    "record RX only from stable aggTrade feed",
)
write(worker_path, worker)

runtime_path = "orderbook.js"
runtime = read(runtime_path)
helper_anchor = '''function drawRawTapeMarkerBatches(context, batches) {
  for (let batchIndex = 0; batchIndex < (batches?.length ?? 0); batchIndex += 1) {
'''
helper = '''function drawAggregatePriceRange(
  context,
  viewport,
  item,
  x,
  buy,
  stroke,
  strength,
  openAggregate = false,
) {
  const minimum = Number(item?.minPrice);
  const maximum = Number(item?.maxPrice);
  if (![minimum, maximum].every(Number.isFinite) || maximum - minimum <= Number.EPSILON) return false;
  const low = projectTapePrice(viewport, minimum);
  const high = projectTapePrice(viewport, maximum);
  if (!low || !high) return false;
  const top = Math.min(low.y, high.y);
  const bottom = Math.max(low.y, high.y);
  const height = Math.max(1, bottom - top);
  const minimumVisibleSpan = Math.max(1.5, (Number(viewport?.rowHeight) || 1) * .38);
  if (height < minimumVisibleSpan) return false;

  const width = clampTape(4 + strength * 3.2, 4, 8.5);
  roundedRectPath(context, x - width / 2, top, width, height, Math.min(2.5, width / 2));
  context.fillStyle = buy
    ? `rgba(42, 191, 137, ${openAggregate ? .22 : .30})`
    : `rgba(222, 70, 87, ${openAggregate ? .23 : .31})`;
  context.fill();
  context.lineWidth = .8;
  context.strokeStyle = stroke;
  context.stroke();
  return true;
}

function drawRawTapeMarkerBatches(context, batches) {
  for (let batchIndex = 0; batchIndex < (batches?.length ?? 0); batchIndex += 1) {
'''
runtime = replace_once(runtime, helper_anchor, helper, "aggregate price range helper")

runtime = replace_once(
    runtime,
    '''      context.beginPath();
      context.arc(x, y, diameter / 2, 0, Math.PI * 2);
''',
    '''      drawAggregatePriceRange(
        context,
        state.priceViewport,
        item,
        x,
        buy,
        stroke,
        strength,
        openAggregate,
      );
      context.beginPath();
      context.arc(x, y, diameter / 2, 0, Math.PI * 2);
''',
    "range behind compact aggregate marker",
)

runtime = replace_once(
    runtime,
    '''    roundedRectPath(context, x - width / 2, y - height / 2, width, height, height * .28);
    context.fillStyle = buy
''',
    '''    drawAggregatePriceRange(
      context,
      state.priceViewport,
      item,
      x,
      buy,
      stroke,
      strength,
      openAggregate,
    );
    roundedRectPath(context, x - width / 2, y - height / 2, width, height, height * .28);
    context.fillStyle = buy
''',
    "range behind labelled aggregate",
)
write(runtime_path, runtime)

new_test = '''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const worker = readFileSync(new URL("./orderbook-worker.js", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const latencySource = readFileSync(new URL("./orderbook-tape-latency.js", import.meta.url), "utf8");

function latencyApi() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(latencySource, context);
  return context.InPulsTapeLatency;
}

test("negative calibrated RX is unavailable instead of a false zero", () => {
  const { normalizeTiming } = latencyApi();
  assert.equal(normalizeTiming({ E: 1_000, T: 1_000 }, 999, 0).rxLatencyMs, null);
  assert.equal(normalizeTiming({ E: 1_000, T: 1_000 }, 1_000.4, 0).rxLatencyMs, 0.39999999999997726);
});

test("header RX uses only the stable aggTrade feed and never renders literal zero", () => {
  assert.match(worker, /if \(aggregateEvent\) this\.tradeLatency\.record\(trade\.rxLatencyMs, receivedAt\)/);
  assert.match(worker, /latency < 1\s*\? "<1"/);
  assert.doesNotMatch(worker, /Math\.round\(latency\)\}ms/);
});

test("AGG painter renders the aggregate price sweep instead of only its first-price label", () => {
  assert.match(runtime, /function drawAggregatePriceRange\(/);
  assert.match(runtime, /item\?\.minPrice/);
  assert.match(runtime, /item\?\.maxPrice/);
  assert.match(runtime, /projectTapePrice\(viewport, minimum\)/);
  assert.match(runtime, /projectTapePrice\(viewport, maximum\)/);
  assert.ok((runtime.match(/drawAggregatePriceRange\(/g) ?? []).length >= 3);
});
'''
write("test-agg-range-rx-fix-v1.mjs", new_test)

# Bump all release/cache references that explicitly carry the previous build.
for path in Path(".").rglob("*"):
    if not path.is_file() or ".git" in path.parts or path.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".json", ".md"}:
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    if OLD_BUILD in text:
        path.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

assert NEW_BUILD in read("VERSION.txt")
assert "if (aggregateEvent) this.tradeLatency.record" in read(worker_path)
assert "function drawAggregatePriceRange(" in read(runtime_path)
assert "rawLatency >= 0" in read(latency_path)
