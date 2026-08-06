from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


chart_path = Path("chart.js")
chart = chart_path.read_text(encoding="utf-8")

chart = replace_once(
    chart,
    'export function maximumVisibleCandles(plotWidth, minimumSpacing = 1.25) {\n  return Math.max(20, Math.floor(Math.max(1, Number(plotWidth) || 1) / Math.max(1, Number(minimumSpacing) || 1)));\n}\n',
    '''export function maximumVisibleCandles(plotWidth, minimumSpacing = 1.25) {
  return Math.max(20, Math.floor(Math.max(1, Number(plotWidth) || 1) / Math.max(1, Number(minimumSpacing) || 1)));
}

const ANNOTATION_TYPES = Object.freeze(["zone", "line", "ray", "segment", "event", "point"]);

export function buildAnnotationGroups(annotations = []) {
  const groups = Object.fromEntries(ANNOTATION_TYPES.map((type) => [type, []]));
  groups.other = [];
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    if (!annotation || typeof annotation !== "object") continue;
    const target = groups[annotation.type] ?? groups.other;
    target.push(annotation);
  }
  return groups;
}

export function shouldPlaceAnnotationLabel(y, top, bottom, occupied = [], minimumGap = 14) {
  const value = Number(y);
  if (!Number.isFinite(value) || value < Number(top) || value > Number(bottom)) return false;
  return !occupied.some((other) => Math.abs(Number(other) - value) < minimumGap);
}
''',
    "annotation helper insertion",
)

chart = replace_once(
    chart,
    '    this.drawings = [];\n    this.annotations = [];\n',
    '    this.drawings = [];\n    this.annotations = [];\n    this.annotationGroups = buildAnnotationGroups();\n',
    "annotation groups constructor",
)

chart = replace_once(
    chart,
    '    this.drag = null;\n    this.renderFrame = null;\n',
    '    this.drag = null;\n    this.renderFrame = null;\n    this.fastInteractionUntil = 0;\n    this.fastInteractionTimer = null;\n',
    "fast interaction constructor",
)

chart = replace_once(
    chart,
    '''  #requestRender() {
    if (this.renderFrame !== null) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }
''',
    '''  #requestRender() {
    if (this.renderFrame !== null) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  #markFastInteraction(duration = 150) {
    const now = performance.now();
    this.fastInteractionUntil = Math.max(this.fastInteractionUntil, now + duration);
    if (this.fastInteractionTimer !== null) clearTimeout(this.fastInteractionTimer);
    this.fastInteractionTimer = setTimeout(() => {
      this.fastInteractionTimer = null;
      this.#requestRender();
    }, duration + 24);
  }

  #isFastInteraction() {
    return Boolean(this.drag) || performance.now() < this.fastInteractionUntil;
  }
''',
    "fast interaction methods",
)

chart = replace_once(
    chart,
    '''  setAnnotations(annotations = []) {
    this.annotations = (Array.isArray(annotations) ? annotations : [])
      .filter((item) => item && typeof item === "object")
      .map((item) => typeof structuredClone === "function" ? structuredClone(item) : JSON.parse(JSON.stringify(item)));
    this.#requestRender();
  }
''',
    '''  setAnnotations(annotations = []) {
    this.annotations = (Array.isArray(annotations) ? annotations : [])
      .filter((item) => item && typeof item === "object")
      .map((item) => typeof structuredClone === "function" ? structuredClone(item) : JSON.parse(JSON.stringify(item)));
    this.annotationGroups = buildAnnotationGroups(this.annotations);
    this.#requestRender();
  }
''',
    "set annotation groups",
)

chart = replace_once(
    chart,
    '''    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    this.renderFrame = null;
    this.drag = null;
''',
    '''    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    if (this.fastInteractionTimer !== null) clearTimeout(this.fastInteractionTimer);
    this.renderFrame = null;
    this.fastInteractionTimer = null;
    this.drag = null;
''',
    "destroy interaction timer",
)

chart = replace_once(
    chart,
    '''    const rawMin = Math.min(...visible.map((item) => item.low));
    const rawMax = Math.max(...visible.map((item) => item.high));
''',
    '''    let rawMin = Infinity;
    let rawMax = -Infinity;
    let maxVolume = 1;
    for (const candle of visible) {
      rawMin = Math.min(rawMin, candle.low);
      rawMax = Math.max(rawMax, candle.high);
      maxVolume = Math.max(maxVolume, candle.volume);
    }
''',
    "single pass visible range",
)

chart = replace_once(
    chart,
    '    const displayCandles = visible;\n    const maxVolume = Math.max(...displayCandles.map((item) => item.volume), 1);\n',
    '    const displayCandles = visible;\n',
    "remove duplicate max volume",
)

chart = replace_once(
    chart,
    '''    this.#drawPriceGrid(ctx, width, margins, minPrice, maxPrice, y, plotHeight);
    this.#drawTimeGrid(ctx, margins, plotWidth, height);
    this.#drawSessionMarkers(ctx, margins, height);
''',
    '''    const fastInteraction = this.#isFastInteraction();
    this.#drawPriceGrid(ctx, width, margins, minPrice, maxPrice, y, plotHeight);
    this.#drawTimeGrid(ctx, margins, plotWidth, height);
    if (!fastInteraction) this.#drawSessionMarkers(ctx, margins, height);
''',
    "fast interaction render flag",
)

chart = replace_once(
    chart,
    '''    this.#drawAnnotations(ctx);
    this.#drawDrawings(ctx);
    if (this.hoverX !== null && this.hoverY !== null) this.#drawCrosshair(ctx);
''',
    '''    this.#drawAnnotations(ctx, fastInteraction);
    this.#drawDrawings(ctx, fastInteraction);
    if (!fastInteraction && this.hoverX !== null && this.hoverY !== null) this.#drawCrosshair(ctx);
''',
    "fast render calls",
)

start = chart.index("  #drawAnnotations(ctx) {")
end = chart.index("\n  #drawDrawings(ctx) {", start)
optimized_annotations = '''  #drawAnnotations(ctx, fastInteraction = false) {
    if (!this.layout || !this.annotations.length) return;
    const { margins, plotWidth, plotHeight, priceBottom } = this.layout;
    const groups = this.annotationGroups ?? buildAnnotationGroups(this.annotations);
    const tones = {
      accent: "#43e1c2",
      blue: "#64b8ff",
      warning: "#f1bf62",
      danger: "#f27d86",
      success: "#5fe0a7",
      muted: "#8fa8ba",
    };
    const right = margins.left + plotWidth;
    const xForTime = (time) => {
      const index = this.#indexAtTime(Number(time));
      return margins.left + ((candleCenterSlot(index) - this.viewStart) / this.visibleCount) * plotWidth;
    };
    const yForPrice = (price) => margins.top
      + ((this.layout.maxPrice - Number(price)) / (this.layout.maxPrice - this.layout.minPrice)) * plotHeight;
    const colorFor = (annotation) => tones[annotation?.tone] ?? tones.accent;
    const label = (text, x, y, color) => {
      if (!text || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      if (y < margins.top || y > priceBottom || x > right) return false;
      ctx.save();
      ctx.font = this.#font(8, true);
      const width = Math.min(190, ctx.measureText(String(text)).width + 10);
      const left = Math.max(margins.left, Math.min(right - width, x));
      const top = Math.max(margins.top, Math.min(priceBottom - 17, y - 16));
      ctx.fillStyle = "rgba(6, 11, 16, .88)";
      ctx.fillRect(left, top, width, 15);
      ctx.strokeStyle = `${color}99`;
      ctx.strokeRect(left + .5, top + .5, width - 1, 14);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.fillText(String(text).slice(0, 42), left + 5, top + 11);
      ctx.restore();
      return true;
    };

    const rayLabelCandidates = [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(margins.left, margins.top, plotWidth, plotHeight);
    ctx.clip();

    for (const annotation of groups.zone) {
      const x1 = xForTime(annotation.startAt);
      const x2 = xForTime(annotation.endAt);
      if (Math.max(x1, x2) < margins.left || Math.min(x1, x2) > right) continue;
      const y1 = yForPrice(annotation.high);
      const y2 = yForPrice(annotation.low);
      if (Math.max(y1, y2) < margins.top || Math.min(y1, y2) > priceBottom) continue;
      const color = colorFor(annotation);
      ctx.fillStyle = `${color}18`;
      ctx.strokeStyle = `${color}88`;
      ctx.setLineDash([5, 4]);
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.max(2, Math.abs(y2 - y1)));
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.max(2, Math.abs(y2 - y1)));
      ctx.setLineDash([]);
    }

    for (const annotation of groups.line) {
      const y = yForPrice(annotation.price);
      if (y < margins.top || y > priceBottom) continue;
      const x1 = xForTime(annotation.startAt);
      const x2 = xForTime(annotation.endAt);
      if (Math.max(x1, x2) < margins.left || Math.min(x1, x2) > right) continue;
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const annotation of groups.ray) {
      const y = yForPrice(annotation.price);
      if (y < margins.top || y > priceBottom) continue;
      const originX = xForTime(annotation.startAt);
      const startX = Math.max(margins.left, originX);
      if (startX > right) continue;
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.lineWidth = fastInteraction ? 1 : 1.25;
      ctx.setLineDash(annotation.state === "BROKEN" ? [3, 5] : [7, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      if (!fastInteraction && originX >= margins.left && originX <= right) {
        ctx.fillStyle = "#071018";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(originX, y, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (!fastInteraction && annotation.label) rayLabelCandidates.push({ annotation, originX, y, color });
    }

    for (const annotation of groups.segment) {
      if (!annotation.a || !annotation.b) continue;
      const a = this.#screenPoint(annotation.a);
      const b = this.#screenPoint(annotation.b);
      if (Math.max(a.x, b.x) < margins.left || Math.min(a.x, b.x) > right) continue;
      if (Math.max(a.y, b.y) < margins.top || Math.min(a.y, b.y) > priceBottom) continue;
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const annotation of groups.event) {
      const x = xForTime(annotation.time);
      if (x < margins.left || x > right) continue;
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, margins.top);
      ctx.lineTo(x, priceBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (!fastInteraction) {
      for (const annotation of groups.point) {
        const point = this.#screenPoint({ time: annotation.time, price: annotation.price });
        if (point.x < margins.left || point.x > right || point.y < margins.top || point.y > priceBottom) continue;
        const color = colorFor(annotation);
        ctx.fillStyle = "#071018";
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();

    if (fastInteraction) return;

    for (const annotation of groups.zone) {
      const x1 = xForTime(annotation.startAt);
      const x2 = xForTime(annotation.endAt);
      const y1 = yForPrice(annotation.high);
      const y2 = yForPrice(annotation.low);
      if (Math.max(x1, x2) < margins.left || Math.min(x1, x2) > right) continue;
      if (Math.max(y1, y2) < margins.top || Math.min(y1, y2) > priceBottom) continue;
      label(annotation.label, Math.max(margins.left + 4, x1 + 4), y1, colorFor(annotation));
    }
    for (const annotation of groups.line) {
      const y = yForPrice(annotation.price);
      const x1 = xForTime(annotation.startAt);
      const x2 = xForTime(annotation.endAt);
      if (y < margins.top || y > priceBottom || Math.max(x1, x2) < margins.left || Math.min(x1, x2) > right) continue;
      label(annotation.label, Math.min(right - 110, x2 - 110), y, colorFor(annotation));
    }

    const occupiedRayLabelYs = [];
    for (const candidate of rayLabelCandidates) {
      if (!shouldPlaceAnnotationLabel(candidate.y, margins.top + 8, priceBottom - 4, occupiedRayLabelYs, 15)) continue;
      if (label(candidate.annotation.label, Math.max(margins.left + 4, candidate.originX + 6), candidate.y, candidate.color)) {
        occupiedRayLabelYs.push(candidate.y);
      }
    }

    for (const annotation of groups.segment) {
      if (!annotation.label) continue;
      const a = this.#screenPoint(annotation.a);
      const b = this.#screenPoint(annotation.b);
      if (Math.max(a.x, b.x) < margins.left || Math.min(a.x, b.x) > right) continue;
      if (Math.max(a.y, b.y) < margins.top || Math.min(a.y, b.y) > priceBottom) continue;
      label(annotation.label, (a.x + b.x) / 2, (a.y + b.y) / 2, colorFor(annotation));
    }
    for (const annotation of groups.event) {
      const x = xForTime(annotation.time);
      if (x < margins.left || x > right) continue;
      label(annotation.label, x + 5, margins.top + 17, colorFor(annotation));
    }
    for (const annotation of groups.point) {
      const point = this.#screenPoint({ time: annotation.time, price: annotation.price });
      if (point.x < margins.left || point.x > right || point.y < margins.top || point.y > priceBottom) continue;
      label(annotation.label, point.x + 6, point.y, colorFor(annotation));
    }
  }
'''
chart = chart[:start] + optimized_annotations + chart[end:]

chart = chart.replace("  #drawDrawings(ctx) {", "  #drawDrawings(ctx, fastInteraction = false) {", 1)
chart = replace_once(
    chart,
    '''    ctx.restore();

    for (const alert of items.filter((item) => item.type === "alert")) {
''',
    '''    ctx.restore();

    if (fastInteraction) return;

    for (const alert of items.filter((item) => item.type === "alert")) {
''',
    "skip drawing labels during interaction",
)

chart = replace_once(
    chart,
    '''  #handlePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
''',
    '''  #handlePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (this.drag) this.#markFastInteraction();
''',
    "mark pointer interaction",
)

chart = replace_once(
    chart,
    '''    this.#persistViewport();
    this.drag = null;
    this.canvas.style.cursor = "crosshair";
  }
''',
    '''    this.#persistViewport();
    this.drag = null;
    this.fastInteractionUntil = 0;
    if (this.fastInteractionTimer !== null) clearTimeout(this.fastInteractionTimer);
    this.fastInteractionTimer = null;
    this.canvas.style.cursor = "crosshair";
    this.#requestRender();
  }
''',
    "restore detailed render after pointer up",
)

chart = replace_once(
    chart,
    '''  #handleWheel(event) {
    event.preventDefault();
    if (!this.layout || this.candles.length < 2) return;
''',
    '''  #handleWheel(event) {
    event.preventDefault();
    if (!this.layout || this.candles.length < 2) return;
    this.#markFastInteraction(180);
''',
    "mark wheel interaction",
)

chart = replace_once(
    chart,
    'const zoneOffsetFormatters = new Map();\n',
    '''const zoneOffsetFormatters = new Map();
const dateTimeFormatters = new Map();

function cachedDateTimeFormatter(key, options) {
  if (!dateTimeFormatters.has(key)) dateTimeFormatters.set(key, new Intl.DateTimeFormat("ru-RU", options));
  return dateTimeFormatters.get(key);
}
''',
    "date formatter cache",
)

old_formatters = '''function formatTime(timestamp, withDate = false, timeZone) {
  return new Intl.DateTimeFormat("ru-RU", {
    ...(timeZone ? { timeZone } : {}),
    ...(withDate ? { day: "2-digit", month: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatAxisTime(timestamp, rangeMs, tickStep, timeZone) {
  const options = timeZone ? { timeZone } : {};
  if (tickStep < 60_000) return new Intl.DateTimeFormat("ru-RU", { ...options, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(timestamp));
  if (rangeMs <= 3 * 86_400_000) return new Intl.DateTimeFormat("ru-RU", { ...options, hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  if (rangeMs <= 120 * 86_400_000) return new Intl.DateTimeFormat("ru-RU", { ...options, day: "2-digit", month: "short" }).format(new Date(timestamp)).replace(".", "");
  return new Intl.DateTimeFormat("ru-RU", { ...options, month: "short", year: "2-digit" }).format(new Date(timestamp)).replace(".", "");
}
'''
new_formatters = '''function formatTime(timestamp, withDate = false, timeZone) {
  const zone = timeZone || "local";
  const key = `time:${zone}:${withDate ? "date" : "clock"}`;
  return cachedDateTimeFormatter(key, {
    ...(timeZone ? { timeZone } : {}),
    ...(withDate ? { day: "2-digit", month: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatAxisTime(timestamp, rangeMs, tickStep, timeZone) {
  const zone = timeZone || "local";
  const options = timeZone ? { timeZone } : {};
  if (tickStep < 60_000) {
    return cachedDateTimeFormatter(`axis:${zone}:second`, { ...options, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(timestamp));
  }
  if (rangeMs <= 3 * 86_400_000) {
    return cachedDateTimeFormatter(`axis:${zone}:minute`, { ...options, hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
  }
  if (rangeMs <= 120 * 86_400_000) {
    return cachedDateTimeFormatter(`axis:${zone}:day`, { ...options, day: "2-digit", month: "short" }).format(new Date(timestamp)).replace(".", "");
  }
  return cachedDateTimeFormatter(`axis:${zone}:month`, { ...options, month: "short", year: "2-digit" }).format(new Date(timestamp)).replace(".", "");
}
'''
chart = replace_once(chart, old_formatters, new_formatters, "cached date formatters")

chart_path.write_text(chart, encoding="utf-8")

for path in [Path("signal-lab-v3-full-chart.js"), Path("signal-lab-chart-modal.js"), Path("owner-signal-lab-v3.js"), Path("owner-signal-lab-v3.html")]:
    text = path.read_text(encoding="utf-8")
    if "signal-lab-v9-extreme-rays" not in text:
        raise SystemExit(f"{path}: cache key not found")
    path.write_text(text.replace("signal-lab-v9-extreme-rays", "signal-lab-v10-pan-performance"), encoding="utf-8")

performance_test = Path("test/chart-interaction-performance.test.js")
performance_test.write_text('''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildAnnotationGroups,
  shouldPlaceAnnotationLabel,
} from "../chart.js";

test("chart groups annotations once instead of filtering the full list every frame", () => {
  const source = [
    { type: "ray", price: 100 },
    { type: "zone", low: 99, high: 101 },
    { type: "ray", price: 102 },
    { type: "unknown" },
  ];
  const groups = buildAnnotationGroups(source);
  assert.equal(groups.ray.length, 2);
  assert.equal(groups.zone.length, 1);
  assert.equal(groups.other.length, 1);
});

test("annotation labels are culled outside the viewport and when vertically crowded", () => {
  assert.equal(shouldPlaceAnnotationLabel(50, 10, 100, []), true);
  assert.equal(shouldPlaceAnnotationLabel(5, 10, 100, []), false);
  assert.equal(shouldPlaceAnnotationLabel(50, 10, 100, [58], 15), false);
  assert.equal(shouldPlaceAnnotationLabel(50, 10, 100, [70], 15), true);
});

test("chart interaction path keeps a fast render mode and cached time formatters", () => {
  const chart = fs.readFileSync(new URL("../chart.js", import.meta.url), "utf8");
  assert.match(chart, /#markFastInteraction\\(duration = 150\\)/);
  assert.match(chart, /#drawAnnotations\\(ctx, fastInteraction = false\\)/);
  assert.match(chart, /if \\(fastInteraction\\) return;/);
  assert.match(chart, /const dateTimeFormatters = new Map\\(\\)/);
  assert.doesNotMatch(chart, /this\\.annotations\\.filter\\(\\(item\\) => item\\.type === "ray"\\)/);
});

test("Signal Lab cache chain points to the pan performance build", () => {
  for (const path of [
    "../signal-lab-v3-full-chart.js",
    "../signal-lab-chart-modal.js",
    "../owner-signal-lab-v3.js",
    "../owner-signal-lab-v3.html",
  ]) {
    const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /signal-lab-v10-pan-performance/);
  }
});
''', encoding="utf-8")
