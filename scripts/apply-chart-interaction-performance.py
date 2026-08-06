from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)


chart_path = Path("chart.js")
chart = chart_path.read_text(encoding="utf-8")

chart = replace_once(
    chart,
    "    this.drawings = [];\n    this.annotations = [];\n    this.storageKey = storageKey;",
    "    this.drawings = [];\n    this.annotations = [];\n    this.annotationBuckets = { zone: [], line: [], ray: [], segment: [], event: [], point: [] };\n    this.storageKey = storageKey;",
    "annotation bucket state",
)

chart = replace_once(
    chart,
    "    this.drag = null;\n    this.renderFrame = null;\n    this.resizeObserver = new ResizeObserver(() => this.#requestRender());",
    "    this.drag = null;\n    this.renderFrame = null;\n    this.viewportPersistTimer = null;\n    this.wheelIdleTimer = null;\n    this.wheelActive = false;\n    this.resizeObserver = new ResizeObserver(() => this.#requestRender());",
    "interaction timers",
)

chart = replace_once(
    chart,
    "    try { localStorage.setItem(`${this.storageKey}-viewport`, JSON.stringify(Object.fromEntries(this.viewportStore))); } catch {}\n  }\n\n  #persistDrawings() {",
    "    try { localStorage.setItem(`${this.storageKey}-viewport`, JSON.stringify(Object.fromEntries(this.viewportStore))); } catch {}\n  }\n\n  #scheduleViewportPersist(delay = 180) {\n    clearTimeout(this.viewportPersistTimer);\n    this.viewportPersistTimer = setTimeout(() => {\n      this.viewportPersistTimer = null;\n      this.#persistViewport();\n    }, delay);\n  }\n\n  #persistDrawings() {",
    "debounced viewport persistence",
)

old_set_annotations = '''  setAnnotations(annotations = []) {
    this.annotations = (Array.isArray(annotations) ? annotations : [])
      .filter((item) => item && typeof item === "object")
      .map((item) => typeof structuredClone === "function" ? structuredClone(item) : JSON.parse(JSON.stringify(item)));
    this.#requestRender();
  }
'''
new_set_annotations = '''  setAnnotations(annotations = []) {
    const next = (Array.isArray(annotations) ? annotations : [])
      .filter((item) => item && typeof item === "object");
    const buckets = { zone: [], line: [], ray: [], segment: [], event: [], point: [] };
    for (const annotation of next) {
      if (buckets[annotation.type]) buckets[annotation.type].push(annotation);
    }
    this.annotations = next;
    this.annotationBuckets = buckets;
    this.#requestRender();
  }
'''
chart = replace_once(chart, old_set_annotations, new_set_annotations, "annotation bucketing")

chart = replace_once(
    chart,
    "    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);\n    this.renderFrame = null;\n    this.drag = null;",
    "    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);\n    clearTimeout(this.viewportPersistTimer);\n    clearTimeout(this.wheelIdleTimer);\n    this.renderFrame = null;\n    this.viewportPersistTimer = null;\n    this.wheelIdleTimer = null;\n    this.wheelActive = false;\n    this.drag = null;",
    "destroy interaction timers",
)

chart = replace_once(
    chart,
    '''    const rawMin = Math.min(...visible.map((item) => item.low));
    const rawMax = Math.max(...visible.map((item) => item.high));
    const priceSpan = rawMax - rawMin || rawMax * 0.001 || 1;
''',
    '''    const displayCandles = visible;
    let rawMin = Infinity;
    let rawMax = -Infinity;
    let maxVolume = 1;
    for (const candle of displayCandles) {
      if (candle.low < rawMin) rawMin = candle.low;
      if (candle.high > rawMax) rawMax = candle.high;
      if (candle.volume > maxVolume) maxVolume = candle.volume;
    }
    const priceSpan = rawMax - rawMin || rawMax * 0.001 || 1;
''',
    "single-pass visible candle bounds",
)

chart = replace_once(
    chart,
    '''    // Never merge exchange candles into screen buckets. Bucket boundaries changed
    // after a one-pixel pan and made the same place appear to have different OHLC.
    // The zoom-out limit above guarantees a distinct screen slot for every candle.
    const displayCandles = visible;
    const maxVolume = Math.max(...displayCandles.map((item) => item.volume), 1);
    const step = plotWidth / this.visibleCount;
    const y = (price) => margins.top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight;

    this.#drawPriceGrid(ctx, width, margins, minPrice, maxPrice, y, plotHeight);
    this.#drawTimeGrid(ctx, margins, plotWidth, height);
    this.#drawSessionMarkers(ctx, margins, height);
''',
    '''    // Never merge exchange candles into screen buckets. Bucket boundaries changed
    // after a one-pixel pan and made the same place appear to have different OHLC.
    // The zoom-out limit above guarantees a distinct screen slot for every candle.
    const step = plotWidth / this.visibleCount;
    const y = (price) => margins.top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight;
    const interactionLite = Boolean(
      this.wheelActive
      || (this.drag && (this.drag.type === "pan" || this.drag.type === "time" || this.drag.type === "price")),
    );

    this.#drawPriceGrid(ctx, width, margins, minPrice, maxPrice, y, plotHeight);
    if (!interactionLite) {
      this.#drawTimeGrid(ctx, margins, plotWidth, height);
      this.#drawSessionMarkers(ctx, margins, height);
    }
''',
    "lightweight interaction render mode",
)

chart = replace_once(
    chart,
    "    this.#drawAnnotations(ctx);\n    this.#drawDrawings(ctx);",
    "    this.#drawAnnotations(ctx, !interactionLite);\n    this.#drawDrawings(ctx);",
    "interaction-aware annotation labels",
)

start = chart.find("  #drawAnnotations(ctx) {")
end = chart.find("\n  #drawDrawings(ctx) {", start)
if start < 0 or end < 0:
    raise SystemExit("draw annotations function markers were not found")

new_draw_annotations = '''  #drawAnnotations(ctx, showLabels = true) {
    if (!this.layout || !this.annotations.length) return;
    const { margins, plotWidth, plotHeight, priceBottom, minPrice, maxPrice } = this.layout;
    const tones = {
      accent: "#43e1c2",
      blue: "#64b8ff",
      warning: "#f1bf62",
      danger: "#f27d86",
      success: "#5fe0a7",
      muted: "#8fa8ba",
    };
    const viewStartTime = this.#timeAtIndex(this.viewStart - 1);
    const viewEndTime = this.#timeAtIndex(this.viewStart + this.visibleCount + 1);
    const xForTime = (time) => {
      const index = this.#indexAtTime(Number(time));
      return margins.left + ((candleCenterSlot(index) - this.viewStart) / this.visibleCount) * plotWidth;
    };
    const yForPrice = (price) => margins.top
      + ((maxPrice - Number(price)) / (maxPrice - minPrice)) * plotHeight;
    const colorFor = (annotation) => tones[annotation?.tone] ?? tones.accent;
    const inTime = (time) => {
      const value = Number(time);
      return Number.isFinite(value) && value >= viewStartTime && value <= viewEndTime;
    };
    const spansTime = (startAt, endAt) => {
      const spanStart = Number(startAt);
      const spanEnd = Number(endAt);
      if (!Number.isFinite(spanStart) || !Number.isFinite(spanEnd)) return false;
      return Math.max(spanStart, spanEnd) >= viewStartTime && Math.min(spanStart, spanEnd) <= viewEndTime;
    };
    const inPrice = (price) => {
      const value = Number(price);
      return Number.isFinite(value) && value >= minPrice && value <= maxPrice;
    };
    const occupiedLabels = [];
    let labelCount = 0;
    const label = (text, x, y, color) => {
      if (!showLabels || !text || labelCount >= 56 || !Number.isFinite(x) || !Number.isFinite(y)) return;
      ctx.save();
      ctx.font = this.#font(8, true);
      const width = Math.min(190, ctx.measureText(String(text)).width + 10);
      const left = Math.max(margins.left, Math.min(margins.left + plotWidth - width, x));
      const top = Math.max(margins.top, Math.min(priceBottom - 17, y - 16));
      const box = { left, right: left + width, top, bottom: top + 15 };
      const overlaps = occupiedLabels.some((item) => !(
        box.right + 3 < item.left
        || box.left - 3 > item.right
        || box.bottom + 2 < item.top
        || box.top - 2 > item.bottom
      ));
      if (overlaps) {
        ctx.restore();
        return;
      }
      occupiedLabels.push(box);
      labelCount += 1;
      ctx.fillStyle = "rgba(6, 11, 16, .88)";
      ctx.fillRect(left, top, width, 15);
      ctx.strokeStyle = `${color}99`;
      ctx.strokeRect(left + .5, top + .5, width - 1, 14);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.fillText(String(text).slice(0, 42), left + 5, top + 11);
      ctx.restore();
    };

    const visibleZones = [];
    for (const annotation of this.annotationBuckets.zone) {
      const low = Math.min(Number(annotation.low), Number(annotation.high));
      const high = Math.max(Number(annotation.low), Number(annotation.high));
      if (spansTime(annotation.startAt, annotation.endAt) && high >= minPrice && low <= maxPrice) visibleZones.push(annotation);
    }
    const visibleLines = [];
    for (const annotation of this.annotationBuckets.line) {
      if (inPrice(annotation.price) && spansTime(annotation.startAt, annotation.endAt)) visibleLines.push(annotation);
    }
    const visibleRays = [];
    for (const annotation of this.annotationBuckets.ray) {
      const startAt = Number(annotation.startAt);
      if (Number.isFinite(startAt) && startAt <= viewEndTime && inPrice(annotation.price)) visibleRays.push(annotation);
    }
    const visibleSegments = [];
    for (const annotation of this.annotationBuckets.segment) {
      if (!annotation.a || !annotation.b) continue;
      const a = this.#screenPoint(annotation.a);
      const b = this.#screenPoint(annotation.b);
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
      if (Math.max(a.x, b.x) < margins.left || Math.min(a.x, b.x) > margins.left + plotWidth) continue;
      if (Math.max(a.y, b.y) < margins.top || Math.min(a.y, b.y) > priceBottom) continue;
      visibleSegments.push({ annotation, a, b });
    }
    const visibleEvents = [];
    for (const annotation of this.annotationBuckets.event) {
      if (inTime(annotation.time)) visibleEvents.push(annotation);
    }
    const visiblePoints = [];
    for (const annotation of this.annotationBuckets.point) {
      if (!inTime(annotation.time) || !inPrice(annotation.price)) continue;
      const point = this.#screenPoint({ time: annotation.time, price: annotation.price });
      if ([point.x, point.y].every(Number.isFinite)) visiblePoints.push({ annotation, point });
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(margins.left, margins.top, plotWidth, plotHeight);
    ctx.clip();

    for (const annotation of visibleZones) {
      const x1 = xForTime(annotation.startAt);
      const x2 = xForTime(annotation.endAt);
      const y1 = yForPrice(annotation.high);
      const y2 = yForPrice(annotation.low);
      const color = colorFor(annotation);
      ctx.fillStyle = `${color}18`;
      ctx.strokeStyle = `${color}88`;
      ctx.setLineDash([5, 4]);
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.max(2, Math.abs(y2 - y1)));
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.max(2, Math.abs(y2 - y1)));
      ctx.setLineDash([]);
    }

    for (const annotation of visibleLines) {
      const y = yForPrice(annotation.price);
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xForTime(annotation.startAt), y);
      ctx.lineTo(xForTime(annotation.endAt), y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const annotation of visibleRays) {
      const y = yForPrice(annotation.price);
      const originX = xForTime(annotation.startAt);
      const startX = Math.max(margins.left, originX);
      const endX = margins.left + plotWidth;
      if (startX > endX) continue;
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.setLineDash(annotation.state === "BROKEN" ? [3, 5] : [7, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      if (originX >= margins.left && originX <= endX) {
        ctx.fillStyle = "#071018";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(originX, y, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    for (const item of visibleSegments) {
      const color = colorFor(item.annotation);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(item.a.x, item.a.y);
      ctx.lineTo(item.b.x, item.b.y);
      ctx.stroke();
    }

    for (const annotation of visibleEvents) {
      const x = xForTime(annotation.time);
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, margins.top);
      ctx.lineTo(x, priceBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const item of visiblePoints) {
      const color = colorFor(item.annotation);
      ctx.fillStyle = "#071018";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(item.point.x, item.point.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    if (!showLabels) return;
    for (const annotation of visibleZones) {
      label(annotation.label, xForTime(annotation.startAt) + 4, yForPrice(annotation.high), colorFor(annotation));
    }
    for (const annotation of visibleLines) {
      label(annotation.label, xForTime(annotation.endAt) - 110, yForPrice(annotation.price), colorFor(annotation));
    }
    for (const annotation of visibleRays) {
      const originX = xForTime(annotation.startAt);
      label(annotation.label, Math.max(margins.left + 4, originX + 6), yForPrice(annotation.price), colorFor(annotation));
    }
    for (const item of visibleSegments) {
      label(item.annotation.label, (item.a.x + item.b.x) / 2, (item.a.y + item.b.y) / 2, colorFor(item.annotation));
    }
    for (const annotation of visibleEvents) {
      label(annotation.label, xForTime(annotation.time) + 5, margins.top + 17, colorFor(annotation));
    }
    for (const item of visiblePoints) {
      label(item.annotation.label, item.point.x + 6, item.point.y, colorFor(item.annotation));
    }
  }
'''
chart = chart[:start] + new_draw_annotations + chart[end:]

chart = replace_once(
    chart,
    "    this.drag = null;\n    this.canvas.style.cursor = \"crosshair\";\n  }\n\n  #handleWheel(event) {",
    "    this.drag = null;\n    this.canvas.style.cursor = \"crosshair\";\n    this.#requestRender();\n  }\n\n  #handleWheel(event) {",
    "restore full render after drag",
)

chart = replace_once(
    chart,
    "    const rect = this.canvas.getBoundingClientRect();\n    this.#lockPriceDomain();",
    "    const rect = this.canvas.getBoundingClientRect();\n    this.wheelActive = true;\n    clearTimeout(this.wheelIdleTimer);\n    this.wheelIdleTimer = setTimeout(() => {\n      this.wheelIdleTimer = null;\n      this.wheelActive = false;\n      this.#requestRender();\n    }, 140);\n    this.#lockPriceDomain();",
    "wheel lightweight mode",
)

chart = replace_once(
    chart,
    "    this.tooltip.hidden = true;\n    this.#persistViewport();\n    this.#requestRender();\n  }\n\n  #drawCrosshair(ctx) {",
    "    this.tooltip.hidden = true;\n    this.#scheduleViewportPersist();\n    this.#requestRender();\n  }\n\n  #drawCrosshair(ctx) {",
    "debounced wheel persistence",
)

chart_path.write_text(chart, encoding="utf-8")

app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")
app = replace_once(
    app,
    './chart.js?v=26-102-tape-live-edge-minute-boundary-v1',
    './chart.js?v=26-117-chart-interaction-performance-v1',
    "main chart cache version",
)
app_path.write_text(app, encoding="utf-8")

index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
index = replace_once(
    index,
    '<meta name="inpuls-build" content="26-116-spot-tape-routing-v2" />',
    '<meta name="inpuls-build" content="26-117-chart-interaction-performance-v1" />',
    "index build marker",
)
index = replace_once(
    index,
    '<script type="module" src="./app.js?v=26-116-spot-tape-routing-v2"></script>',
    '<script type="module" src="./app.js?v=26-117-chart-interaction-performance-v1"></script>',
    "index app cache version",
)
index_path.write_text(index, encoding="utf-8")

modal_path = Path("signal-lab-chart-modal.js")
modal = modal_path.read_text(encoding="utf-8")
modal = replace_once(
    modal,
    './chart.js?v=signal-lab-v9-extreme-rays',
    './chart.js?v=26-117-chart-interaction-performance-v1',
    "Signal Lab chart cache version",
)
modal_path.write_text(modal, encoding="utf-8")

owner_js_path = Path("owner-signal-lab-v3.js")
owner_js = owner_js_path.read_text(encoding="utf-8")
owner_js = replace_once(
    owner_js,
    './signal-lab-chart-modal.js?v=signal-lab-v9-extreme-rays',
    './signal-lab-chart-modal.js?v=26-117-chart-interaction-performance-v1',
    "Signal Lab modal cache version",
)
owner_js_path.write_text(owner_js, encoding="utf-8")

owner_html_path = Path("owner-signal-lab-v3.html")
owner_html = owner_html_path.read_text(encoding="utf-8")
owner_html = replace_once(
    owner_html,
    './owner-signal-lab-v3.js?v=signal-lab-v9-extreme-rays',
    './owner-signal-lab-v3.js?v=26-117-chart-interaction-performance-v1',
    "Signal Lab page cache version",
)
owner_html_path.write_text(owner_html, encoding="utf-8")

sw_path = Path("sw.js")
sw = sw_path.read_text(encoding="utf-8")
sw = replace_once(
    sw,
    'const BUILD = "26-116-spot-tape-routing-v2";',
    'const BUILD = "26-117-chart-interaction-performance-v1";',
    "service worker build",
)
sw = replace_once(
    sw,
    './app.js?v=26-116-spot-tape-routing-v2',
    './app.js?v=26-117-chart-interaction-performance-v1',
    "service worker app inventory",
)
sw = replace_once(
    sw,
    './chart.js?v=26-102-tape-live-edge-minute-boundary-v1',
    './chart.js?v=26-117-chart-interaction-performance-v1',
    "service worker chart inventory",
)
sw = replace_once(
    sw,
    './owner-signal-lab-v3.js?v=signal-lab-v3-evidence-replay-v1',
    './owner-signal-lab-v3.js?v=26-117-chart-interaction-performance-v1',
    "service worker Signal Lab inventory",
)
sw_path.write_text(sw, encoding="utf-8")

test_path = Path("test/chart-interaction-performance.test.js")
test_path.write_text(
    '''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const chart = fs.readFileSync(new URL("../chart.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("chart buckets annotations once instead of filtering the whole set per layer", () => {
  assert.match(chart, /this\\.annotationBuckets = buckets/);
  const start = chart.indexOf("#drawAnnotations(ctx, showLabels = true)");
  const end = chart.indexOf("#drawDrawings(ctx)", start);
  const body = chart.slice(start, end);
  assert.doesNotMatch(body, /this\\.annotations\\.filter/);
  assert.match(body, /visibleRays/);
  assert.match(body, /if \\(!showLabels\\) return/);
});

test("drag and wheel use lightweight rendering and restore detail", () => {
  assert.match(chart, /const interactionLite = Boolean/);
  assert.match(chart, /this\\.wheelActive = true/);
  assert.match(chart, /this\\.#drawAnnotations\\(ctx, !interactionLite\\)/);
  assert.match(chart, /this\\.#scheduleViewportPersist\\(\\)/);
  assert.match(chart, /this\\.drag = null;\\n    this\\.canvas\\.style\\.cursor = "crosshair";\\n    this\\.#requestRender\\(\\);/);
});

test("release pages request the optimized chart build", () => {
  assert.match(app, /chart\\.js\\?v=26-117-chart-interaction-performance-v1/);
  assert.match(index, /app\\.js\\?v=26-117-chart-interaction-performance-v1/);
});
''',
    encoding="utf-8",
)
