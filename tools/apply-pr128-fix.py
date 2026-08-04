from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
OLD_BUILD = "26-104-tape-cluster-theme-clock-sync-v2"
NEW_BUILD = "26-105-tape-clock-frozen-projection-v1"


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_or_keep(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"{label}: source marker not found")
    return text.replace(old, new, 1)


def replace_block(text: str, start_marker: str, end_marker: str, new_block: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"{label}: start marker not found")
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"{label}: end marker not found")
    return text[:start] + new_block + text[end:]


for path in ROOT.rglob("*"):
    if (
        not path.is_file()
        or ".git" in path.parts
        or path.suffix not in {".js", ".mjs", ".html", ".md"}
    ):
        continue
    content = path.read_text(encoding="utf-8")
    if OLD_BUILD in content:
        path.write_text(content.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

orderbook = read("orderbook.js")
orderbook = replace_or_keep(
    orderbook,
    "const TAPE_LIVE_EDGE_LEAD_MS = 180;",
    "const TAPE_LIVE_EDGE_LEAD_MS = 0;",
    "Tape live edge",
)
write("orderbook.js", orderbook)

clock_test = read("test-binance-clock-sync-v1.mjs")
clock_test = replace_or_keep(
    clock_test,
    "  assert.equal(end, 11_180);",
    "  assert.equal(end, 11_000);",
    "Tape clock test",
)
write("test-binance-clock-sync-v1.mjs", clock_test)

flow = read("orderbook-flow-workspace.js")
new_nearest = '''function nearestRow(rows, price) {
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
    if (target <= ordered[index].price) {
      return interpolate(ordered[index - 1], ordered[index]);
    }
  }
  return null;
}'''
if "const ordered = (rows ?? [])" not in flow:
    flow = replace_block(
        flow,
        "function nearestRow(rows, price) {",
        "\n\nfunction injectStyles()",
        new_nearest,
        "Exact footprint row projection",
    )

new_columns = '''  const columns = intervals.map((interval) => {
    const clusters = interval.cells
      .map((source) => {
        const row = nearestRow(rows, source.price);
        return row ? {
          row,
          buyQuote: source.buyQuote,
          sellQuote: source.sellQuote,
          quote: source.quote,
          count: source.count,
          price: source.price,
        } : null;
      })
      .filter(Boolean);
    return {
      interval,
      clusters,
      poc: footprintPocCluster(clusters, interval.closePrice),
    };
  });'''
if "const clustersByRow = new Map();" in flow:
    flow = replace_block(
        flow,
        "  const columns = intervals.map((interval) => {",
        "\n\n  const dpr =",
        new_columns,
        "Independent footprint clusters",
    )
if "const clustersByRow = new Map();" in flow:
    raise RuntimeError("Independent footprint clusters: aggregation remained")
write("orderbook-flow-workspace.js", flow)

app = read("app.js")
app = replace_or_keep(
    app,
    '  inplayOrder: "inpuls-inplay-order-v1",\n};',
    '  inplayOrder: "inpuls-inplay-order-v1",\n  clockPosition: "inpuls-clock-position-v1",\n};',
    "Clock storage key",
)
app = replace_or_keep(
    app,
    "bindEvents();\n",
    "bindEvents();\nenableClockDrag();\n",
    "Clock drag bootstrap",
)
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
    const next = clampClockPosition(
      position?.left,
      position?.top,
      rect.width || 84,
      rect.height || 22,
    );
    floating = true;
    clock.style.position = "fixed";
    clock.style.left = `${next.left}px`;
    clock.style.top = `${next.top}px`;
    clock.style.zIndex = "1200";
    clock.style.padding = "2px 6px";
    clock.style.borderRadius = "6px";
    clock.style.background = "color-mix(in srgb, var(--panel) 92%, transparent)";
    clock.style.boxShadow = "0 4px 18px rgba(0, 0, 0, .22)";
    if (persist) {
      localStorage.setItem(STORAGE_KEYS.clockPosition, JSON.stringify(next));
    }
  };

  const reset = () => {
    floating = false;
    localStorage.removeItem(STORAGE_KEYS.clockPosition);
    for (const property of [
      "position",
      "left",
      "top",
      "zIndex",
      "padding",
      "borderRadius",
      "background",
      "boxShadow",
    ]) {
      clock.style[property] = "";
    }
  };

  clock.style.touchAction = "none";
  clock.style.cursor = "grab";
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.clockPosition) || "null",
    );
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
if "function enableClockDrag()" not in app:
    marker = '}\nbinanceClock.setTimeZone(state.timeZone === "local"'
    if marker not in app:
        raise RuntimeError("Clock drag functions: insertion marker not found")
    app = app.replace(
        marker,
        "}" + clock_drag + '\nbinanceClock.setTimeZone(state.timeZone === "local"',
        1,
    )
write("app.js", app)

focused = read("test-footprint-poc-second-preview-v1.mjs")
test_name = 'test("closed footprint levels and site clock stay stable"'
if test_name not in focused:
    focused += r'''


test("closed footprint levels and site clock stay stable", () => {
  const flow = read("./orderbook-flow-workspace.js");
  assert.doesNotMatch(flow, /clustersByRow/);
  assert.match(flow, /interval\.cells[\s\S]*nearestRow\(rows, source\.price\)/);
  const orderbook = read("./orderbook.js");
  assert.match(orderbook, /const TAPE_LIVE_EDGE_LEAD_MS = 0;/);
  const app = read("./app.js");
  assert.match(app, /clockPosition/);
  assert.match(app, /enableClockDrag\(\)/);
  assert.match(app, /pointermove/);
});
'''
write("test-footprint-poc-second-preview-v1.mjs", focused)

print(f"Applied {NEW_BUILD}")
