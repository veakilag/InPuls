from pathlib import Path
import re

OLD_BUILD = "26-71-water-tape-v1"
NEW_BUILD = "26-72-water-tape-fast-v1"


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
    '''const TAPE_PRICE_VIEWPORT_TAU_MS = 90;
const TAPE_CLOCK_CORRECTION_TAU_MS = 120;''',
    '''const TAPE_PRICE_VIEWPORT_TAU_MS = 90;
const TAPE_CLOCK_CORRECTION_TAU_MS = 120;
const TAPE_VIEWPORT_SAMPLE_MS = 50;''',
    "viewport sample constant",
)

text = replace_once(
    text,
    'let tapeDrawAllRequested = true;\n',
    'let tapeDrawAllRequested = true;\nlet cachedTapeSurfaceColor = null;\n',
    "surface color cache",
)

text = replace_once(
    text,
    '''      priceViewport: null,
      priceViewportAt: null,
      renderModelKey: null,
      rawRenderNodes: [],
      aggSourceBuckets: [],''',
    '''      priceViewport: null,
      priceViewportAt: null,
      targetPriceViewport: null,
      priceRange: null,
      viewportSampleAt: null,
      viewportDirty: true,
      renderModelKey: null,
      rawNodeByKey: new Map(),
      rawRenderNodes: [],
      aggSourceBuckets: [],''',
    "cached viewport and node map state",
)

text = replace_once(
    text,
    '''      state.rowObserver = new MutationObserver(() => {
        decorateRuntimeBookRows(card);
        scheduleTapeDraw(false, card);
      });''',
    '''      state.rowObserver = new MutationObserver(() => {
        decorateRuntimeBookRows(card);
        state.viewportDirty = true;
        scheduleTapeDraw(false, card);
      });''',
    "row mutation viewport invalidation",
)

text = replace_once(
    text,
    '''    state.resizeObserver = new ResizeObserver(() => scheduleTapeDraw(true, card));''',
    '''    state.resizeObserver = new ResizeObserver(() => {
      state.viewportDirty = true;
      scheduleTapeDraw(true, card);
    });''',
    "resize viewport invalidation",
)

text = replace_once(
    text,
    '''          state.priceViewport = null;
          state.priceViewportAt = null;
          state.renderModelKey = null;
          state.rawRenderNodes = [];
          state.aggSourceBuckets = [];''',
    '''          state.priceViewport = null;
          state.priceViewportAt = null;
          state.targetPriceViewport = null;
          state.priceRange = null;
          state.viewportSampleAt = null;
          state.viewportDirty = true;
          state.renderModelKey = null;
          state.rawNodeByKey?.clear?.();
          state.rawRenderNodes = [];
          state.aggSourceBuckets = [];''',
    "symbol viewport and node reset",
)

old_replace_reset = '''      if (state) {
        state.hasFrame = false;
        state.cameraEndTime = null;
        state.cameraUpdatedAt = null;
        state.cameraAnimating = false;
        state.aggSnapshots?.clear?.();
      }'''
new_replace_reset = '''      if (state) {
        state.hasFrame = false;
        state.clockEndTime = null;
        state.clockPerfAt = null;
        state.priceViewport = null;
        state.priceViewportAt = null;
        state.targetPriceViewport = null;
        state.priceRange = null;
        state.viewportSampleAt = null;
        state.viewportDirty = true;
        state.renderModelKey = null;
        state.rawNodeByKey?.clear?.();
        state.rawRenderNodes = [];
        state.aggSourceBuckets = [];
        state.aggSnapshots?.clear?.();
      }'''
text = replace_once(text, old_replace_reset, new_replace_reset, "replace packet state reset")

old_surface = '''function tapeSurfaceColor() {
  if (typeof document === "undefined") return "#181b20";
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--panel")
    .trim() || "#181b20";
}'''
new_surface = '''function tapeSurfaceColor() {
  if (cachedTapeSurfaceColor) return cachedTapeSurfaceColor;
  if (typeof document === "undefined") return "#181b20";
  cachedTapeSurfaceColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--panel")
    .trim() || "#181b20";
  return cachedTapeSurfaceColor;
}'''
text = replace_once(text, old_surface, new_surface, "cached Tape surface color")

refresh_pattern = r'''function refreshTapeRenderModel\(state, symbol, stored, step\) \{[\s\S]*?\n\}

function visibleWaterTapeNodes'''
refresh_replacement = '''function refreshTapeRenderModel(state, symbol, stored, step) {
  const version = Number(tapeDataVersionBySymbol.get(symbol)) || 0;
  const modelKey = [
    symbol,
    version,
    Number(step).toPrecision(12),
    state.aggLevelIndex,
  ].join(":");
  if (state.renderModelKey === modelKey) return;
  state.renderModelKey = modelKey;

  const previousNodes = state.rawNodeByKey instanceof Map
    ? state.rawNodeByKey
    : new Map();
  const nextNodesByKey = new Map();
  const nextNodes = [];
  for (let index = stored.length - 1; index >= 0; index -= 1) {
    const trade = stored[index];
    const key = `raw:${tapeTradeKey(trade)}`;
    const node = previousNodes.get(key) ?? Object.freeze({
      key,
      id: trade.id,
      time: Number(trade.time),
      lastTime: Number(trade.time),
      price: Number(trade.price),
      quote: Number(trade.quote),
      buyQuote: trade.side === "buy" ? Number(trade.quote) : 0,
      sellQuote: trade.side === "sell" ? Number(trade.quote) : 0,
      count: 1,
    });
    nextNodesByKey.set(key, node);
    nextNodes.push(node);
  }
  state.rawNodeByKey = nextNodesByKey;
  state.rawRenderNodes = nextNodes;
  state.aggSourceBuckets = aggregateTapeBuckets(
    stored,
    step,
    state.aggLevelIndex,
    null,
  );
}

function visibleWaterTapeNodes'''
text = regex_once(text, refresh_pattern, refresh_replacement, "incremental render model")

old_viewport = '''  const rows = visibleBookRows(card, flow);
  const targetViewport = tapeViewportFromRows(rows);
  if (!targetViewport) {
    setTapeState(state, "Жду ценовую шкалу стакана…", "attention");
    skip("missing-price-viewport");
    return;
  }

  const perfNow = performance.now();
  const viewportElapsed = state.priceViewportAt === null
    ? 16
    : perfNow - Number(state.priceViewportAt);
  state.priceViewport = advanceTapePriceViewport(
    state.priceViewport,
    targetViewport,
    viewportElapsed,
  );
  state.priceViewportAt = perfNow;'''
new_viewport = '''  const perfNow = performance.now();
  const shouldSampleViewport = state.viewportDirty
    || !state.targetPriceViewport
    || state.viewportSampleAt === null
    || perfNow - Number(state.viewportSampleAt) >= TAPE_VIEWPORT_SAMPLE_MS;
  if (shouldSampleViewport) {
    const sampledRows = visibleBookRows(card, flow);
    const sampledViewport = tapeViewportFromRows(sampledRows);
    if (sampledViewport) {
      state.targetPriceViewport = sampledViewport;
      state.priceRange = visiblePriceRange(sampledRows);
      state.viewportSampleAt = perfNow;
      state.viewportDirty = false;
    }
  }
  const targetViewport = state.targetPriceViewport;
  if (!targetViewport) {
    setTapeState(state, "Жду ценовую шкалу стакана…", "attention");
    skip("missing-price-viewport");
    return;
  }

  const viewportElapsed = state.priceViewportAt === null
    ? 16
    : perfNow - Number(state.priceViewportAt);
  state.priceViewport = advanceTapePriceViewport(
    state.priceViewport,
    targetViewport,
    viewportElapsed,
  );
  state.priceViewportAt = perfNow;'''
text = replace_once(text, old_viewport, new_viewport, "sampled viewport painter")
text = replace_once(
    text,
    '''  const range = visiblePriceRange(rows);
  const step = range?.step ?? .01;''',
    '''  const range = state.priceRange;
  const step = range?.step ?? .01;''',
    "cached painter range",
)

text = replace_once(
    text,
    '''  globalThis.addEventListener("inpuls:theme-change", () => scheduleTapeDraw(true));''',
    '''  globalThis.addEventListener("inpuls:theme-change", () => {
    cachedTapeSurfaceColor = null;
    scheduleTapeDraw(true);
  });''',
    "theme cache invalidation",
)

text = replace_once(
    text,
    '''    // Центрирование удалено: обычный скролл остаётся там,
    // где его оставил пользователь. Ctrl + колесо меняет только шаг.
    setTimeout(() => scheduleTapeDraw(false, card), 0);''',
    '''    // Центрирование удалено: обычный скролл остаётся там,
    // где его оставил пользователь. Ctrl + колесо меняет только шаг.
    const state = tapeCardStates.get(card);
    if (state) state.viewportDirty = true;
    setTimeout(() => scheduleTapeDraw(false, card), 0);''',
    "wheel viewport invalidation",
)

write(path, text)

# Add performance-specific source contracts.
write("test-water-tape-performance-v1.mjs", r'''import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

function block(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test("60 FPS painter does not force DOM geometry on every frame", () => {
  const painter = block("function drawTapeCard(card) {", "\nfunction drawAllTapes()");
  assert.match(painter, /const shouldSampleViewport = state\.viewportDirty/);
  assert.match(painter, /TAPE_VIEWPORT_SAMPLE_MS/);
  assert.match(painter, /state\.targetPriceViewport/);
  assert.equal((painter.match(/visibleBookRows\(card, flow\)/g) ?? []).length, 1);
});

test("render model reuses immutable nodes and skips full sorting", () => {
  const model = block("function refreshTapeRenderModel", "\nfunction visibleWaterTapeNodes");
  assert.match(model, /previousNodes\.get\(key\) \?\? Object\.freeze/);
  assert.match(model, /for \(let index = stored\.length - 1; index >= 0; index -= 1\)/);
  assert.doesNotMatch(model, /\.sort\(/);
  assert.match(model, /state\.rawNodeByKey = nextNodesByKey/);
});

test("Tape surface theme lookup is cached outside the frame hot path", () => {
  assert.match(source, /let cachedTapeSurfaceColor = null/);
  assert.match(source, /if \(cachedTapeSurfaceColor\) return cachedTapeSurfaceColor/);
  assert.match(source, /cachedTapeSurfaceColor = null;[\s\S]*scheduleTapeDraw\(true\)/);
});

test("replace packets reset only current water renderer state", () => {
  const accept = block("function acceptTapeData(event) {", "\nfunction bindTapeCard");
  assert.match(accept, /state\.clockEndTime = null/);
  assert.match(accept, /state\.targetPriceViewport = null/);
  assert.match(accept, /state\.rawNodeByKey\?\.clear/);
  assert.doesNotMatch(accept, /cameraEndTime|cameraUpdatedAt|cameraAnimating/);
});
''')

version_path = "VERSION.txt"
version = read(version_path)
feature = "water-tape-hot-path-v1"
lines = version.splitlines()
for index, line in enumerate(lines):
    if line.startswith("Features:") and feature not in line:
        lines[index] = line + f", {feature}"
        break
write(version_path, "\n".join(lines) + "\n")

orderbook = read("orderbook.js")
assert OLD_BUILD not in "\n".join(read(p) for p in ["VERSION.txt", "app.js", "index.html", "orderbook.js", "sw.js"])
assert "state.cameraEndTime" not in orderbook
assert "state.cameraUpdatedAt" not in orderbook
assert "state.cameraAnimating" not in orderbook
