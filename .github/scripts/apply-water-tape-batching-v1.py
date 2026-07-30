from pathlib import Path
import re

OLD_BUILD = "26-72-water-tape-fast-v1"
NEW_BUILD = "26-73-water-tape-batched-v1"


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label, flags=re.S):
    next_text, count = re.subn(pattern, lambda _: replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, got {count}")
    return next_text


for path in Path(".").rglob("*"):
    if not path.is_file() or ".git" in path.parts or ".github" in path.parts:
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".webmanifest"}:
        continue
    text = read(path)
    if OLD_BUILD in text:
        write(path, text.replace(OLD_BUILD, NEW_BUILD))

path = "orderbook.js"
text = read(path)

text = replace_once(
    text,
    'const TAPE_VIEWPORT_SAMPLE_MS = 50;\n',
    'const TAPE_VIEWPORT_SAMPLE_MS = 50;\nconst RAW_TAPE_MARKER_BUCKETS = 8;\n',
    "raw marker bucket constant",
)

text = replace_once(
    text,
    '''      rawNodeByKey: new Map(),
      rawRenderNodes: [],
      aggSourceBuckets: [],
      aggSnapshots: new Map(),''',
    '''      rawNodeByKey: new Map(),
      rawRenderNodes: [],
      aggSourceBuckets: [],
      aggSnapshots: new Map(),
      recentRawScratch: [],
      finalizedAggScratch: [],
      closedAggScratch: [],
      candidateScratch: [],
      pathProjectionScratch: [],
      markerProjectionScratch: [],
      rawMarkerBatches: Array.from({ length: RAW_TAPE_MARKER_BUCKETS * 2 }, () => []),
      lastStatusText: null,
      lastStatusTone: null,
      lastRangeAbove: null,
      lastRangeBelow: null,''',
    "frame scratch buffers",
)

text = replace_once(
    text,
    '''    state.status = status;''',
    '''    state.status = status;
    state.lastStatusText = null;
    state.lastStatusTone = null;''',
    "status cache reset",
)
text = replace_once(
    text,
    '''    state.rangeSummary = summary;''',
    '''    state.rangeSummary = summary;
    state.lastRangeAbove = null;
    state.lastRangeBelow = null;''',
    "range cache reset",
)

old_status = '''function setTapeState(state, text = "", tone = "neutral") {
  const element = state?.status;
  if (!element) return;
  const value = String(text || "");
  if (element.textContent !== value) element.textContent = value;
  element.dataset.tone = tone;
  element.classList.toggle("is-visible", Boolean(value));
}'''
new_status = '''function setTapeState(state, text = "", tone = "neutral") {
  const element = state?.status;
  if (!element) return;
  const value = String(text || "");
  const nextTone = String(tone || "neutral");
  if (state.lastStatusText === value && state.lastStatusTone === nextTone) return;
  state.lastStatusText = value;
  state.lastStatusTone = nextTone;
  if (element.textContent !== value) element.textContent = value;
  if (element.dataset.tone !== nextTone) element.dataset.tone = nextTone;
  element.classList.toggle("is-visible", Boolean(value));
}'''
text = replace_once(text, old_status, new_status, "cached Tape status")

old_range = '''function setTapeRangeSummary(state, above = 0, below = 0) {
  const summary = state?.rangeSummary;
  if (!summary) return;
  const aboveElement = summary.querySelector("[data-inpuls-tape-above]");
  const belowElement = summary.querySelector("[data-inpuls-tape-below]");
  const safeAbove = Math.max(0, Math.floor(Number(above) || 0));
  const safeBelow = Math.max(0, Math.floor(Number(below) || 0));
  if (aboveElement) {
    aboveElement.textContent = `↑ ${safeAbove} выше`;
    aboveElement.classList.toggle("is-visible", safeAbove > 0);
  }
  if (belowElement) {
    belowElement.textContent = `↓ ${safeBelow} ниже`;
    belowElement.classList.toggle("is-visible", safeBelow > 0);
  }
}'''
new_range = '''function setTapeRangeSummary(state, above = 0, below = 0) {
  const summary = state?.rangeSummary;
  if (!summary) return;
  const safeAbove = Math.max(0, Math.floor(Number(above) || 0));
  const safeBelow = Math.max(0, Math.floor(Number(below) || 0));
  if (state.lastRangeAbove === safeAbove && state.lastRangeBelow === safeBelow) return;
  state.lastRangeAbove = safeAbove;
  state.lastRangeBelow = safeBelow;
  const aboveElement = summary.querySelector("[data-inpuls-tape-above]");
  const belowElement = summary.querySelector("[data-inpuls-tape-below]");
  if (aboveElement) {
    aboveElement.textContent = `↑ ${safeAbove} выше`;
    aboveElement.classList.toggle("is-visible", safeAbove > 0);
  }
  if (belowElement) {
    belowElement.textContent = `↓ ${safeBelow} ниже`;
    belowElement.classList.toggle("is-visible", safeBelow > 0);
  }
}'''
text = replace_once(text, old_range, new_range, "cached Tape range summary")

project_pattern = r'''export function projectTapePrice\(viewport, price\) \{[\s\S]*?\n\}

export function advanceWaterTapeClock'''
project_replacement = '''function projectTapePriceInto(viewport, price, output) {
  const target = Number(price);
  if (!viewport || !Number.isFinite(target)) return null;
  const low = Number(viewport.lowPrice);
  const high = Number(viewport.highPrice);
  const span = high - low;
  const step = Math.max(Number.EPSILON, Number(viewport.step) || 0);
  if (!Number.isFinite(span) || span <= Number.EPSILON) return null;
  if (target < low - step * .65 || target > high + step * .65) return null;
  const ratio = (target - low) / span;
  const result = output ?? {};
  result.price = target;
  result.y = Number(viewport.lowY) + (Number(viewport.highY) - Number(viewport.lowY)) * ratio;
  result.height = Math.max(1, Number(viewport.rowHeight) || 1);
  return result;
}

export function projectTapePrice(viewport, price) {
  return projectTapePriceInto(viewport, price, {});
}

export function advanceWaterTapeClock'''
text = regex_once(text, project_pattern, project_replacement, "reusable price projection")

finalized_pattern = r'''function finalizedAggregateTapeBuckets\(state, buckets, closedBefore\) \{
  if \(!\(state\.aggSnapshots instanceof Map\)\) state\.aggSnapshots = new Map\(\);
  const output = \[\];([\s\S]*?)
  return output;
\}'''
finalized_replacement = '''function finalizedAggregateTapeBuckets(state, buckets, closedBefore, output = []) {
  if (!(state.aggSnapshots instanceof Map)) state.aggSnapshots = new Map();
  output.length = 0;\1
  return output;
}'''
text = regex_once(text, finalized_pattern, finalized_replacement, "reusable AGG output")

old_projection_helpers = '''function visibleWaterTapeNodes(nodes, window) {
  return (nodes ?? []).filter((item) => (
    Number(item.time) >= window.startTime
    && Number(item.time) <= window.endTime
  ));
}

function projectWaterTapeNodes(nodes, viewport) {
  const projected = [];
  for (const item of nodes ?? []) {
    const position = projectTapePrice(viewport, item.price);
    if (position) projected.push({ ...item, position });
  }
  return projected;
}'''
new_projection_helpers = '''function visibleWaterTapeNodes(nodes, window, output = []) {
  output.length = 0;
  for (const item of nodes ?? []) {
    const time = Number(item.time);
    if (time < window.startTime) continue;
    if (time > window.endTime) break;
    output.push(item);
  }
  return output;
}

function filterWaterTapeCandidates(nodes, minimum, output = []) {
  output.length = 0;
  for (const item of nodes ?? []) {
    if (passesTapeFilter(item, minimum, 0)) output.push(item);
  }
  return output;
}

function projectWaterTapeNodes(nodes, viewport, output = []) {
  let count = 0;
  for (const source of nodes ?? []) {
    const slot = output[count] ?? { source: null, position: {} };
    const position = projectTapePriceInto(viewport, source.price, slot.position);
    if (!position) continue;
    slot.source = source;
    slot.position = position;
    output[count] = slot;
    count += 1;
  }
  output.length = count;
  return output;
}

function prepareRawTapeMarkerBatches(state) {
  if (!Array.isArray(state.rawMarkerBatches)) {
    state.rawMarkerBatches = Array.from(
      { length: RAW_TAPE_MARKER_BUCKETS * 2 },
      () => [],
    );
  }
  for (const batch of state.rawMarkerBatches) batch.length = 0;
  return state.rawMarkerBatches;
}

function rawTapeMarkerBucket(strength, buy) {
  const normalized = clampTape(Number(strength) || 0, 0, 1.35) / 1.35;
  const sizeIndex = Math.max(0, Math.min(
    RAW_TAPE_MARKER_BUCKETS - 1,
    Math.round(normalized * (RAW_TAPE_MARKER_BUCKETS - 1)),
  ));
  return (buy ? 0 : RAW_TAPE_MARKER_BUCKETS) + sizeIndex;
}

function drawRawTapeMarkerBatches(context, batches) {
  for (let batchIndex = 0; batchIndex < (batches?.length ?? 0); batchIndex += 1) {
    const batch = batches[batchIndex];
    if (!batch?.length) continue;
    const buy = batchIndex < RAW_TAPE_MARKER_BUCKETS;
    const sizeIndex = batchIndex % RAW_TAPE_MARKER_BUCKETS;
    const strength = sizeIndex / Math.max(1, RAW_TAPE_MARKER_BUCKETS - 1) * 1.35;
    const diameter = clampTape(1.8 + strength * 7, 1.8, 10.8);
    const radius = diameter / 2;
    context.beginPath();
    for (let index = 0; index < batch.length; index += 2) {
      const x = batch[index];
      const y = batch[index + 1];
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, Math.PI * 2);
    }
    context.fillStyle = buy
      ? `rgba(50, 205, 151, ${clampTape(.32 + strength * .26, .32, .84)})`
      : `rgba(238, 91, 108, ${clampTape(.32 + strength * .26, .32, .84)})`;
    context.fill();
    if (diameter >= 4.2) {
      context.lineWidth = diameter >= 7 ? .95 : .6;
      context.strokeStyle = buy ? "rgba(88, 239, 184, .9)" : "rgba(255, 121, 137, .9)";
      context.stroke();
    }
  }
}'''
text = replace_once(text, old_projection_helpers, new_projection_helpers, "reusable frame projection buffers")

text = replace_once(
    text,
    '''  const recentRaw = visibleWaterTapeNodes(state.rawRenderNodes, window);''',
    '''  const recentRaw = visibleWaterTapeNodes(
    state.rawRenderNodes,
    window,
    state.recentRawScratch,
  );''',
    "raw visibility scratch",
)
text = replace_once(
    text,
    '''      state.aggSourceBuckets,
      aggregateClosedBefore,
    ),
    window,
  );''',
    '''      state.aggSourceBuckets,
      aggregateClosedBefore,
      state.finalizedAggScratch,
    ),
    window,
    state.closedAggScratch,
  );''',
    "AGG scratch buffers",
)
text = replace_once(
    text,
    '''  paintTapeSurface(context, rect);
  state.hasFrame = false;
  setTapeRangeSummary(state, 0, 0);
  drawTapeTimeline(context, rect, window);''',
    '''  paintTapeSurface(context, rect);
  state.hasFrame = false;
  drawTapeTimeline(context, rect, window);''',
    "single range summary update",
)
text = replace_once(
    text,
    '''  const pathItems = projectWaterTapeNodes(recentRaw, state.priceViewport);''',
    '''  const pathItems = projectWaterTapeNodes(
    recentRaw,
    state.priceViewport,
    state.pathProjectionScratch,
  );''',
    "path projection scratch",
)
text = replace_once(
    text,
    '''    for (const item of pathItems) {
      const x = tapeTimeX(item.time, window, rect.width);
      const y = item.position.y;
      if (!previous || item.time - previous.time > 1_500) context.moveTo(x, y);
      else context.lineTo(x, y);
      previous = item;
    }''',
    '''    for (const projected of pathItems) {
      const item = projected.source;
      const x = tapeTimeX(item.time, window, rect.width);
      const y = projected.position.y;
      if (!previous || item.time - previous.time > 1_500) context.moveTo(x, y);
      else context.lineTo(x, y);
      previous = item;
    }''',
    "projected path source",
)
text = replace_once(
    text,
    '''  const candidates = sourceItems.filter((item) => passesTapeFilter(item, minQuote, 0));''',
    '''  const candidates = filterWaterTapeCandidates(
    sourceItems,
    minQuote,
    state.candidateScratch,
  );''',
    "candidate scratch",
)
text = replace_once(
    text,
    '''  const items = projectWaterTapeNodes(candidates, state.priceViewport);''',
    '''  const items = projectWaterTapeNodes(
    candidates,
    state.priceViewport,
    state.markerProjectionScratch,
  );''',
    "marker projection scratch",
)

old_marker_loop_start = '''  for (const item of items) {
    const y = item.position.y;
    const buy = item.buyQuote >= item.sellQuote;
    const stroke = buy ? "rgba(88, 239, 184, .9)" : "rgba(255, 121, 137, .9)";
    const strength = stableTapeQuoteStrength(item.quote);
    const baseX = tapeTimeX(item.time, window, rect.width);'''
new_marker_loop_start = '''  const rawMarkerBatches = state.mode === "raw" && minQuote === 0
    ? prepareRawTapeMarkerBatches(state)
    : null;

  for (const projected of items) {
    const item = projected.source;
    const y = projected.position.y;
    const buy = item.buyQuote >= item.sellQuote;
    const stroke = buy ? "rgba(88, 239, 184, .9)" : "rgba(255, 121, 137, .9)";
    const strength = stableTapeQuoteStrength(item.quote);
    const baseX = tapeTimeX(item.time, window, rect.width);'''
text = replace_once(text, old_marker_loop_start, new_marker_loop_start, "projected marker source")

old_raw_circle = '''      } else {
        const diameter = clampTape(1.8 + strength * 7, 1.8, 10.8);
        const x = clampTape(
          baseX,
          diameter / 2 + .5,
          Math.max(diameter / 2 + .5, window.plotRight - diameter / 2 - .5),
        );
        context.beginPath();
        context.arc(x, y, diameter / 2, 0, Math.PI * 2);
        context.fillStyle = buy
          ? `rgba(50, 205, 151, ${clampTape(.32 + strength * .26, .32, .84)})`
          : `rgba(238, 91, 108, ${clampTape(.32 + strength * .26, .32, .84)})`;
        context.fill();
        if (diameter >= 4.2) {
          context.lineWidth = diameter >= 7 ? .95 : .6;
          context.strokeStyle = stroke;
          context.stroke();
        }
      }'''
new_raw_circle = '''      } else {
        const bucketIndex = rawTapeMarkerBucket(strength, buy);
        const sizeIndex = bucketIndex % RAW_TAPE_MARKER_BUCKETS;
        const bucketStrength = sizeIndex / Math.max(1, RAW_TAPE_MARKER_BUCKETS - 1) * 1.35;
        const diameter = clampTape(1.8 + bucketStrength * 7, 1.8, 10.8);
        const x = clampTape(
          baseX,
          diameter / 2 + .5,
          Math.max(diameter / 2 + .5, window.plotRight - diameter / 2 - .5),
        );
        rawMarkerBatches[bucketIndex].push(x, y);
      }'''
text = replace_once(text, old_raw_circle, new_raw_circle, "batched RAW circles")

text = replace_once(
    text,
    '''  }

  state.hasFrame = true;
  if (observability.enabled) {''',
    '''  }

  if (rawMarkerBatches) drawRawTapeMarkerBatches(context, rawMarkerBatches);

  state.hasFrame = true;
  if (observability.enabled) {''',
    "flush RAW marker batches",
)

text = replace_once(
    text,
    '''  if (recentRate > 1_200) return Math.max(base, 66);
  if (recentRate > 600) return Math.max(base, 48);
  if (recentRate > 250) return Math.max(base, 32);''',
    '''  if (recentRate > 2_000) return Math.max(base, 32);
  if (recentRate > 1_000) return Math.max(base, 24);
  if (recentRate > 500) return Math.max(base, 20);''',
    "batched marker frame targets",
)

write(path, text)

write("test-water-tape-batching-v1.mjs", r'''import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

function block(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test("frame arrays and projection slots are reused", () => {
  assert.match(source, /recentRawScratch: \[\]/);
  assert.match(source, /pathProjectionScratch: \[\]/);
  assert.match(source, /markerProjectionScratch: \[\]/);
  const projection = block("function projectWaterTapeNodes", "\nfunction prepareRawTapeMarkerBatches");
  assert.match(projection, /const slot = output\[count\] \?\?/);
  assert.match(projection, /projectTapePriceInto/);
  assert.doesNotMatch(projection, /projected = \[\]|\{ \.\.\.item/);
});

test("unfiltered RAW dots are drawn in a bounded number of Canvas batches", () => {
  const painter = block("function drawTapeCard(card) {", "\nfunction drawAllTapes()");
  const batching = block("function drawRawTapeMarkerBatches", "\nfunction drawTapeCard");
  assert.match(painter, /prepareRawTapeMarkerBatches\(state\)/);
  assert.match(painter, /rawMarkerBatches\[bucketIndex\]\.push\(x, y\)/);
  assert.match(painter, /drawRawTapeMarkerBatches\(context, rawMarkerBatches\)/);
  assert.match(batching, /context\.fill\(\)/);
  assert.match(batching, /RAW_TAPE_MARKER_BUCKETS \* 2/);
});

test("status overlays do not mutate DOM twice per frame", () => {
  const status = block("function setTapeState", "\nfunction setTapeRangeSummary");
  const range = block("function setTapeRangeSummary", "\nfunction visiblePriceRange");
  const painter = block("function drawTapeCard(card) {", "\nfunction drawAllTapes()");
  assert.match(status, /state\.lastStatusText === value/);
  assert.match(range, /state\.lastRangeAbove === safeAbove/);
  assert.equal((painter.match(/setTapeRangeSummary\(state, 0, 0\)/g) ?? []).length, 0);
});

test("batched renderer keeps near-fluid cadence under high trade rate", () => {
  const cadence = block("function targetTapeFrameMs", "\nfunction activeTapeCards");
  assert.match(cadence, /recentRate > 2_000/);
  assert.match(cadence, /Math\.max\(base, 32\)/);
  assert.match(cadence, /recentRate > 500/);
  assert.match(cadence, /Math\.max\(base, 20\)/);
});
''')

version_path = "VERSION.txt"
version = read(version_path)
feature = "batched-water-tape-markers-v1"
lines = version.splitlines()
for index, line in enumerate(lines):
    if line.startswith("Features:") and feature not in line:
        lines[index] = line + f", {feature}"
        break
write(version_path, "\n".join(lines) + "\n")

orderbook = read("orderbook.js")
assert OLD_BUILD not in "\n".join(read(p) for p in ["VERSION.txt", "app.js", "index.html", "orderbook.js", "sw.js"])
assert "rawMarkerBatches[bucketIndex].push(x, y)" in orderbook
assert "drawRawTapeMarkerBatches(context, rawMarkerBatches)" in orderbook
