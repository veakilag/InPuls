from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_BUILD = "26-104-tape-cluster-theme-clock-sync-v2"
NEW_BUILD = "26-105-tape-clock-frozen-projection-v1"


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


# Ship one coherent cache/runtime key across browser entry points and tests.
for path in ROOT.rglob("*"):
    if not path.is_file() or ".git" in path.parts or path.suffix not in {".js", ".mjs", ".html", ".md"}:
        continue
    content = path.read_text(encoding="utf-8")
    if OLD_BUILD in content:
        path.write_text(content.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

# Tape: exact exchange timestamps remain untouched; the shared Binance clock owns
# the right edge without a synthetic 180 ms future lead.
orderbook = read("orderbook.js")
orderbook = replace_once(
    orderbook,
    "const TAPE_LIVE_EDGE_LEAD_MS = 180;",
    "const TAPE_LIVE_EDGE_LEAD_MS = 0;",
    "Tape live-edge lead",
)
write("orderbook.js", orderbook)

clock_test = read("test-binance-clock-sync-v1.mjs")
clock_test = replace_once(
    clock_test,
    "  assert.equal(end, 11_180);",
    "  assert.equal(end, 11_000);",
    "Tape clock expectation",
)
write("test-binance-clock-sync-v1.mjs", clock_test)

# Footprint: interpolate every exact traded price independently. Closed intervals
# retain both their immutable data snapshot and their first completed projection,
# so ladder movement cannot merge levels, change volume, or make candles jump.
flow = read("orderbook-flow-workspace.js")
nearest_start = flow.index("function nearestRow(rows, price) {")
nearest_end = flow.index("\n\nfunction injectStyles()", nearest_start)
nearest = '''function nearestRow(rows, price) {
  const target = Number(price);
  const ordered = (rows ?? [])
    .map((row) => ({
      index: Number(row?.index),
      price: Number(row?.price),
      y: Number(row?.y),
      height: Math.max(1, Number(row?.height) || 1),
    }))
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.y))
    .sort((left, right) => left.price - right.price);
  if (!ordered.length || !Number.isFinite(target)) return null;
  if (ordered.length === 1) {
    return Math.abs(target - ordered[0].price) <= Number.EPSILON
      ? { ...ordered[0], price: target }
      : null;
  }

  let step = Infinity;
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index].price - ordered[index - 1].price;
    if (gap > Number.EPSILON && gap < step) step = gap;
  }
  if (!Number.isFinite(step)) return null;

  const low = ordered[0];
  const high = ordered.at(-1);
  const tolerance = step * .55 + Number.EPSILON;
  if (target < low.price - tolerance || target > high.price + tolerance) return null;

  const interpolate = (left, right) => {
    const span = right.price - left.price;
    const ratio = Math.abs(span) <= Number.EPSILON ? 0 : (target - left.price) / span;
    return {
      index: ratio < .5 ? left.index : right.index,
      price: target,
      y: left.y + (right.y - left.y) * ratio,
      height: left.height + (right.height - left.height) * ratio,
    };
  };

  if (target <= low.price) return interpolate(low, ordered[1]);
  if (target >= high.price) return interpolate(ordered.at(-2), high);
  for (let index = 1; index < ordered.length; index += 1) {
    if (target <= ordered[index].price) return interpolate(ordered[index - 1], ordered[index]);
  }
  return null;
}'''
flow = flow[:nearest_start] + nearest + flow[nearest_end:]

flow = replace_once(
    flow,
    "    sealedIntervals: new Map(),\n",
    "    sealedIntervals: new Map(),\n    sealedProjection: new Map(),\n    projectionHeight: null,\n",
    "Footprint state projection cache",
)
flow = flow.replace(
    "    state.sealedIntervals.clear();\n",
    "    state.sealedIntervals.clear();\n    state.sealedProjection.clear();\n",
)

columns_start = flow.index("  const columns = intervals.map((interval) => {")
columns_end = flow.index("\n\n  const dpr =", columns_start)
columns = '''  if (state.projectionHeight !== height) {
    state.projectionHeight = height;
    state.sealedProjection.clear();
  }
  const columns = intervals.map((interval) => {
    const projectionKey = `${interval.timeframe}:${interval.startTime}`;
    let projection = interval.partial ? null : state.sealedProjection.get(projectionKey);
    if (!projection) {
      const clusters = interval.cells
        .map((source) => {
          const row = nearestRow(rows, source.price);
          return row ? Object.freeze({
            row: Object.freeze({ ...row }),
            buyQuote: source.buyQuote,
            sellQuote: source.sellQuote,
            quote: source.quote,
            count: source.count,
            price: source.price,
          }) : null;
        })
        .filter(Boolean);
      const highRow = nearestRow(rows, interval.highPrice);
      const lowRow = nearestRow(rows, interval.lowPrice);
      const openRow = nearestRow(rows, interval.openPrice);
      const closeRow = nearestRow(rows, interval.closePrice);
      projection = Object.freeze({
        clusters: Object.freeze(clusters),
        candle: Object.freeze({ highRow, lowRow, openRow, closeRow }),
      });
      if (!interval.partial) {
        state.sealedProjection.set(projectionKey, projection);
        while (state.sealedProjection.size > FOOTPRINT_MAX_SEALED_INTERVALS) {
          state.sealedProjection.delete(state.sealedProjection.keys().next().value);
        }
      }
    }
    return {
      interval,
      clusters: projection.clusters,
      candle: projection.candle,
      poc: footprintPocCluster(projection.clusters, interval.closePrice),
    };
  });'''
flow = flow[:columns_start] + columns + flow[columns_end:]
flow = replace_once(
    flow,
    "    columns.forEach(({ interval, clusters, poc }, columnIndex) => {",
    "    columns.forEach(({ interval, clusters, poc, candle }, columnIndex) => {",
    "Footprint rendered column projection",
)
flow = replace_once(
    flow,
    "      const highRow = nearestRow(rows, interval.highPrice);\n      const lowRow = nearestRow(rows, interval.lowPrice);\n      const openRow = nearestRow(rows, interval.openPrice);\n      const closeRow = nearestRow(rows, interval.closePrice);",
    "      const { highRow, lowRow, openRow, closeRow } = candle;",
    "Footprint candle projection",
)
write("orderbook-flow-workspace.js", flow)

# Draggable site clock. It stays in the header until the user starts dragging;
# the chosen screen position is persisted and can be reset with a double click.
app = read("app.js")
app = replace_once(
    app,
    '  inplayOrder: "inpuls-inplay-order-v1",\n};',
    '  inplayOrder: "inpuls-inplay-order-v1",\n  clockPosition: "inpuls-clock-position-v1",\n};',
    "Clock storage key",
)
app = replace_once(app, "bindEvents();\n", "bindEvents();\nenableClockDrag();\n", "Clock drag bootstrap")
clock_drag = r'''

function clampClockPosition(left, top, width = 84, height = 22) {
  return {
    left: Math.max(8, Math.min(Number(left) || 8, Math.max(8, window.innerWidth - width - 8))),
    top: Math.max(8, Math.min(Number(top) || 8, Math.max(8, window.innerHeight - height - 8))),
  };
}

function enableClockDrag() {
  const clock = els.clock;
  if (!clock) return;
  let floating = false;

  const apply = (position, persist = true) => {
    const rect = clock.getBoundingClientRect();
    const next = clampClockPosition(position?.left, position?.top, rect.width || 84, rect.height || 22);
    floating = true;
    clock.style.position = "fixed";
    clock.style.left = `${next.left}px`;
    clock.style.top = `${next.top}px`;
    clock.style.zIndex = "1200";
    clock.style.padding = "2px 6px";
    clock.style.borderRadius = "6px";
    clock.style.background = "color-mix(in srgb, var(--panel) 92%, transparent)";
    clock.style.boxShadow = "0 4px 18px rgba(0, 0, 0, .22)";
    if (persist) localStorage.setItem(STORAGE_KEYS.clockPosition, JSON.stringify(next));
  };

  const reset = () => {
    floating = false;
    localStorage.removeItem(STORAGE_KEYS.clockPosition);
    for (const property of ["position", "left", "top", "zIndex", "padding", "borderRadius", "background", "boxShadow"]) {
      clock.style[property] = "";
    }
  };

  clock.style.touchAction = "none";
  clock.style.cursor = "grab";
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.clockPosition) || "null");
    if (saved && typeof saved === "object") apply(saved, false);
  } catch {}

  clock.addEventListener("dblclick", reset);
  clock.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = clock.getBoundingClientRect();
    const originLeft = rect.left;
    const originTop = rect.top;
    const startX = event.clientX;
    const startY = event.clientY;
    clock.setPointerCapture?.(event.pointerId);
    clock.style.cursor = "grabbing";
    if (!floating) apply({ left: originLeft, top: originTop }, false);

    const move = (moveEvent) => apply({
      left: originLeft + moveEvent.clientX - startX,
      top: originTop + moveEvent.clientY - startY,
    });
    const stop = () => {
      clock.style.cursor = "grab";
      clock.releasePointerCapture?.(event.pointerId);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
  });
  window.addEventListener("resize", () => {
    if (!floating) return;
    const rect = clock.getBoundingClientRect();
    apply({ left: rect.left, top: rect.top });
  });
}
'''
app = replace_once(
    app,
    "}\nbinanceClock.setTimeZone(state.timeZone === \"local\"",
    "}" + clock_drag + "\nbinanceClock.setTimeZone(state.timeZone === \"local\"",
    "Clock drag functions",
)
write("app.js", app)

# Extend an existing focused regression file without adding another npm script.
focused = read("test-footprint-poc-second-preview-v1.mjs")
focused += '''\n\ntest("closed footprint projection and draggable clock remain stable", () => {\n  const flow = read("./orderbook-flow-workspace.js");\n  assert.match(flow, /sealedProjection:\\s*new Map\\(\\)/);\n  assert.match(flow, /state\\.sealedProjection\\.get\\(projectionKey\\)/);\n  assert.doesNotMatch(flow, /clustersByRow/);\n  const app = read("./app.js");\n  assert.match(app, /clockPosition/);\n  assert.match(app, /enableClockDrag\\(\\)/);\n  assert.match(app, /pointermove/);\n});\n'''
write("test-footprint-poc-second-preview-v1.mjs", focused)

print(f"Applied {NEW_BUILD}")
