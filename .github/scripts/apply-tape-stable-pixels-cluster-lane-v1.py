from pathlib import Path
import re

OLD_BUILD = "26-68-tape-cluster-lifecycle-v1"
NEW_BUILD = "26-69-tape-stable-pixels-v1"


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


# 1. Tape rendering, fixed psychological levels, persistent all-trade path.
path = "orderbook.js"
text = read(path)

old_distance = '''export function bookDistancePercentLabel(price, currentPrice) {
  if (price === null || price === undefined || price === "") return "";
  const level = Number(price);
  const current = Number(currentPrice);
  if (!Number.isFinite(level) || !Number.isFinite(current) || current <= 0) return "";
  const percent = Math.abs(((level - current) / current) * 100);
  return `${percent.toFixed(1)}%`;
}
'''
new_distance = old_distance + '''
export function bookPsychologicalPriceUnit(referencePrice) {
  const reference = Math.abs(Number(referencePrice));
  if (!Number.isFinite(reference) || reference <= 0) return null;
  const target = reference * .01;
  return 10 ** Math.round(Math.log10(target));
}

export function bookPriceEmphasis(price, referencePrice) {
  const value = Number(price);
  const majorUnit = bookPsychologicalPriceUnit(referencePrice);
  if (!Number.isFinite(value) || !Number.isFinite(majorUnit) || majorUnit <= 0) {
    return { round: false, half: false, majorUnit: null };
  }
  const halfUnit = majorUnit / 2;
  const tolerance = Math.max(Number.EPSILON, majorUnit * 1e-8);
  const nearMultiple = (unit) => {
    const ratio = value / unit;
    return Math.abs(value - Math.round(ratio) * unit) <= tolerance;
  };
  const round = nearMultiple(majorUnit);
  return {
    round,
    half: !round && nearMultiple(halfUnit),
    majorUnit,
  };
}
'''
text = replace_once(text, old_distance, new_distance, "psychological price helpers")

emphasis_block = '''  const prices = rows
    .map((row) => parseRuntimeNumber(row.querySelector("strong")?.textContent))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const referencePrice = prices.length
    ? prices[Math.floor((prices.length - 1) / 2)]
    : null;
  for (const row of rows) {
    const price = parseRuntimeNumber(row.querySelector("strong")?.textContent);
    const emphasis = bookPriceEmphasis(price, referencePrice);
    row.classList.toggle("is-price-round", emphasis.round);
    row.classList.toggle("is-price-half", emphasis.half);
  }

  const maximumTextPixels'''
text = regex_once(
    text,
    r'  const step = runtimePriceStep\(card\);\n  if \(Number\.isFinite\(step\) && step > 0\) \{[\s\S]*?\n  \}\n\n  const maximumTextPixels',
    emphasis_block,
    "step-independent price emphasis",
)

window_helpers = '''export function tapeWindowPixelQuantum(duration, width) {
  const safeDuration = Math.max(1, Number(duration) || 1);
  const safeWidth = Math.max(1, Math.floor(Number(width) || 1));
  return safeDuration / safeWidth;
}

export function snapTapeWindowEnd(endTime, duration, width) {
  const target = Number(endTime);
  const quantum = tapeWindowPixelQuantum(duration, width);
  if (!Number.isFinite(target)) return Date.now();
  return Math.ceil(target / quantum) * quantum;
}

'''
text = replace_once(
    text,
    'function buildContinuousTapeWindow(width, latestTime, requestedEndTime = null) {',
    window_helpers + 'function buildContinuousTapeWindow(width, latestTime, requestedEndTime = null) {',
    "Tape pixel window helpers",
)
text = replace_once(
    text,
    '''  const endTime = Number.isFinite(requested)
    ? Math.max(latest + 1, requested)
    : Math.max(latest + 1, Date.now());''',
    '''  const targetEndTime = Number.isFinite(requested)
    ? Math.max(latest + 1, requested)
    : Math.max(latest + 1, Date.now());
  // The camera advances only by complete CSS pixels. Historical dots preserve
  // their fractional pixel phase instead of shimmering on every execution.
  const endTime = snapTapeWindowEnd(targetEndTime, duration, safeWidth);''',
    "pixel-snapped Tape window",
)
text = replace_once(
    text,
    '''function layoutTapeSequence(items, window, width) {
  return buildReadableTapeLayout(items, window, width);
}
''',
    '''function layoutTapeSequence(items, window, width) {
  return buildReadableTapeLayout(items, window, width);
}

function snapTapeCoordinate(value, dpr = 1) {
  const scale = Math.max(1, Number(dpr) || 1);
  return Math.round(Number(value) * scale) / scale;
}
''',
    "Tape coordinate snap helper",
)

text = replace_once(
    text,
    '''  const latestTrade = recent[0];
  const rowSignature = rows.map((row) => `${row.price}:${row.y.toFixed(2)}:${row.height.toFixed(2)}`).join("|");''',
    '''  const latestTrade = recent[0];
  const range = visiblePriceRange(rows);
  const averageRowHeight = rows.reduce((sum, row) => sum + row.height, 0) / Math.max(1, rows.length);
  const rowSignature = [
    rows.length,
    Number(range?.low).toPrecision(12),
    Number(range?.high).toPrecision(12),
    Number(range?.step).toPrecision(12),
    snapTapeCoordinate(averageRowHeight, dpr),
  ].join(":");''',
    "stable Tape row signature",
)
text = replace_once(
    text,
    '''  const minQuote = Math.max(0, Number(state.minQuote) || 0);
  const range = visiblePriceRange(rows);
  const step = range?.step ?? .01;''',
    '''  const minQuote = Math.max(0, Number(state.minQuote) || 0);
  const step = range?.step ?? .01;''',
    "reuse visible Tape range",
)

old_candidates = '''  const rawCandidates = recent.filter((trade) => passesTapeFilter(trade, minQuote, 0));
  const aggregatedCandidates = state.mode === "agg"
    ? aggregateTapeBuckets(recent, step, state.aggLevelIndex, window)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : [];
  const items = state.mode === "agg"
    ? aggregateTapeBurstsContinuous(recent, rows, window, step, state.aggLevelIndex)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : rawTapeItemsContinuous(rawCandidates, rows, window);

  const candidates = state.mode === "agg" ? aggregatedCandidates : rawCandidates;
'''
new_candidates = '''  // The path is market context and always uses every execution. The threshold
  // controls only visible markers and their amount labels.
  const rawPathItems = rawTapeItemsContinuous(recent, rows, window);
  const rawCandidates = recent.filter((trade) => passesTapeFilter(trade, minQuote, 0));
  const aggregatedCandidates = state.mode === "agg"
    ? aggregateTapeBuckets(recent, step, state.aggLevelIndex, window)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : [];
  const items = state.mode === "agg"
    ? aggregateTapeBurstsContinuous(recent, rows, window, step, state.aggLevelIndex)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : rawTapeItemsContinuous(rawCandidates, rows, window);

  const candidates = state.mode === "agg" ? aggregatedCandidates : rawCandidates;
  const pathDrawItems = layoutTapeSequence(rawPathItems, window, rect.width);
  if (pathDrawItems.length > 1) {
    context.save();
    context.strokeStyle = "rgba(130, 151, 160, .34)";
    context.lineWidth = .7;
    context.beginPath();
    let previous = null;
    for (const pathItem of pathDrawItems) {
      const pathX = snapTapeCoordinate(pathItem.x ?? tapeTimeX(
        pathItem.lastTime ?? pathItem.time,
        window,
        rect.width,
      ), dpr);
      const pathY = snapTapeCoordinate(pathItem.row.y, dpr);
      const pathTime = Number(pathItem.lastTime ?? pathItem.time);
      const previousTime = Number(previous?.lastTime ?? previous?.time);
      if (!previous || pathTime - previousTime > 1_500) context.moveTo(pathX, pathY);
      else context.lineTo(pathX, pathY);
      previous = pathItem;
    }
    context.stroke();
    context.restore();
  }
'''
text = replace_once(text, old_candidates, new_candidates, "unfiltered market path")

text = replace_once(
    text,
    '''  if (!candidates.length) {
    setTapeState(state, "Нет сделок по текущему фильтру");
    skip("filter-empty", { recent: recent.length });
    return;
  }''',
    '''  if (!candidates.length) {
    setTapeState(state, "Линия всех сделок · нет маркеров по фильтру");
    state.hasFrame = true;
    skip("filter-empty", { recent: recent.length });
    return;
  }''',
    "filtered Tape keeps path",
)
text = replace_once(
    text,
    '''  if (!items.length) {
    setTapeState(state, "");
    skip("no-visible-items", { candidates: candidates.length });
    return;
  }''',
    '''  if (!items.length) {
    setTapeState(state, "Линия всех сделок · маркеры вне видимой цены");
    state.hasFrame = true;
    skip("no-visible-items", { candidates: candidates.length });
    return;
  }''',
    "offscreen markers keep path",
)

old_labels = '''  const aggLabels = state.mode === "agg"
    ? selectReadableAggLabels(
        drawItems.map((item) => ({
          ...item,
          label: formatTapeUsd(item.quote),
          height: clampTape(7 + strengthFor(item.quote) * 7, 7, 14),
          y: item.row.y,
        })),
        (label) => context.measureText(label).width,
        { width: window.plotRight },
        {
          quantile: TAPE_AGG_LABEL_QUANTILE,
          maximum: Math.max(2, Math.floor(rect.width / 150)),
        },
      )
    : new Set();'''
new_labels = '''  const aggLabels = state.mode === "agg"
    ? minQuote > 0
      ? new Set(drawItems.map((item) => item.key))
      : selectReadableAggLabels(
          drawItems.map((item) => ({
            ...item,
            label: formatTapeUsd(item.quote),
            height: clampTape(7 + strengthFor(item.quote) * 7, 7, 14),
            y: item.row.y,
          })),
          (label) => context.measureText(label).width,
          { width: window.plotRight },
          {
            quantile: TAPE_AGG_LABEL_QUANTILE,
            maximum: Math.max(2, Math.floor(rect.width / 150)),
          },
        )
    : new Set();'''
text = replace_once(text, old_labels, new_labels, "filtered AGG labels")

text = regex_once(
    text,
    r'\n  if \(drawItems\.length > 1\) \{[\s\S]*?\n  \}\n\n  for \(const item of drawItems\)',
    '\n  for (const item of drawItems)',
    "remove filtered-only path",
)
text = replace_once(text, '    const y = item.row.y;', '    const y = snapTapeCoordinate(item.row.y, dpr);', "snap Tape y")
text = replace_once(
    text,
    '''    const baseX = item.x ?? tapeTimeX(item.lastTime ?? item.time, window, rect.width);''',
    '''    const baseX = snapTapeCoordinate(
      item.x ?? tapeTimeX(item.lastTime ?? item.time, window, rect.width),
      dpr,
    );''',
    "snap Tape x",
)

raw_marker = '''    if (state.mode === "raw") {
      const diameter = adaptiveRawDiameter(strength, item.density, rect.width);
      const rightEdge = Math.max(diameter / 2 + .5, window.plotRight - diameter / 2 - .5);
      const x = clampTape(baseX, diameter / 2 + .5, rightEdge);
      context.beginPath();
      context.arc(x, y, diameter / 2, 0, Math.PI * 2);
      context.fillStyle = buy
        ? `rgba(50, 205, 151, ${clampTape(.3 + strength * .28, .3, .82)})`
        : `rgba(238, 91, 108, ${clampTape(.3 + strength * .28, .3, .82)})`;
      context.fill();
      if (diameter >= 4.2) {
        context.lineWidth = diameter >= 7 ? .95 : .6;
        context.strokeStyle = stroke;
        context.stroke();
      }
      continue;
    }'''
raw_marker_next = '''    if (state.mode === "raw") {
      if (minQuote > 0) {
        const label = formatTapeUsd(item.quote);
        const measured = context.measureText(label).width;
        const height = clampTape(9 + strength * 5, 9, 15);
        const width = clampTape(measured + 9, 24, Math.min(88, rect.width * .28));
        const x = clampTape(
          baseX,
          width / 2 + .5,
          Math.max(width / 2 + .5, window.plotRight - width / 2 - .5),
        );
        roundedRectPath(context, x - width / 2, y - height / 2, width, height, 2);
        context.fillStyle = buy ? "rgba(42, 191, 137, .82)" : "rgba(222, 70, 87, .84)";
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = stroke;
        context.stroke();
        context.fillStyle = "rgba(244, 250, 248, .99)";
        context.fillText(label, x, y + .2);
      } else {
        const diameter = adaptiveRawDiameter(strength, item.density, rect.width);
        const rightEdge = Math.max(diameter / 2 + .5, window.plotRight - diameter / 2 - .5);
        const x = clampTape(baseX, diameter / 2 + .5, rightEdge);
        context.beginPath();
        context.arc(x, y, diameter / 2, 0, Math.PI * 2);
        context.fillStyle = buy
          ? `rgba(50, 205, 151, ${clampTape(.3 + strength * .28, .3, .82)})`
          : `rgba(238, 91, 108, ${clampTape(.3 + strength * .28, .3, .82)})`;
        context.fill();
        if (diameter >= 4.2) {
          context.lineWidth = diameter >= 7 ? .95 : .6;
          context.strokeStyle = stroke;
          context.stroke();
        }
      }
      continue;
    }'''
text = replace_once(text, raw_marker, raw_marker_next, "RAW amount labels above threshold")
write(path, text)


# 2. Footprint: candle lane on the left, delta and volume immediately to the right.
path = "orderbook-flow-workspace.js"
text = read(path)
text = replace_once(
    text,
    '''function formatQuoteVolume(value) {
  return `$${formatUsd(value)}`;
}
''',
    '''function formatQuoteVolume(value) {
  return `$${formatUsd(value)}`;
}

function formatSignedQuoteDelta(value) {
  const amount = Number(value) || 0;
  if (Math.abs(amount) < .5) return "±0";
  return `${amount > 0 ? "+" : "−"}${formatUsd(Math.abs(amount))}`;
}
''',
    "signed footprint delta formatter",
)
text = replace_once(
    text,
    '''      const columnLeft = columnsLeft + columnIndex * columnWidth;
      const centerX = columnLeft + columnWidth / 2;
''',
    '''      const columnLeft = columnsLeft + columnIndex * columnWidth;
      const labelX = columnLeft + columnWidth / 2;
      const candleBodyWidth = Math.max(3, Math.min(7, columnWidth * .14));
      const candleLeft = columnLeft + 2;
      const candleX = candleLeft + candleBodyWidth / 2;
      const dataLeft = candleLeft + candleBodyWidth + 2;
      const dataWidth = Math.max(1, columnLeft + columnWidth - dataLeft - 1);
''',
    "footprint left candle lane",
)
text = replace_once(text, '        const cellLeft = columnLeft + 1;', '        const cellLeft = dataLeft;', "footprint data left")
text = replace_once(text, '        const cellWidth = Math.max(1, columnWidth - 2);', '        const cellWidth = dataWidth;', "footprint data width")
text = replace_once(
    text,
    '''        state.context.textAlign = "center";
        state.context.fillStyle = theme.text;
        state.context.fillText(
          formatQuoteVolume(cluster.quote),
          centerX,
          cluster.row.y,
        );''',
    '''        state.context.textAlign = "left";
        state.context.fillStyle = theme.text;
        state.context.font = "800 6.5px Inter, system-ui, sans-serif";
        state.context.fillText(
          `${formatSignedQuoteDelta(cluster.buyQuote - cluster.sellQuote)} · ${formatQuoteVolume(cluster.quote)}`,
          dataLeft + 2,
          cluster.row.y,
          Math.max(1, dataWidth - 4),
        );
        state.context.font = "800 7px Inter, system-ui, sans-serif";''',
    "footprint delta and volume label",
)
text = replace_once(text, '        state.context.moveTo(centerX, highRow.y);', '        state.context.moveTo(candleX, highRow.y);', "footprint wick top")
text = replace_once(text, '        state.context.lineTo(centerX, lowRow.y);', '        state.context.lineTo(candleX, lowRow.y);', "footprint wick bottom")
text = replace_once(
    text,
    '''        const bodyWidth = Math.max(2, Math.min(8, columnWidth * .16));
        state.context.fillRect(centerX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
        state.context.strokeRect(centerX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);''',
    '''        const bodyWidth = candleBodyWidth;
        state.context.fillRect(candleLeft, bodyTop, bodyWidth, bodyHeight);
        state.context.strokeRect(candleLeft, bodyTop, bodyWidth, bodyHeight);''',
    "left footprint candle body",
)
text = replace_once(
    text,
    '''        centerX,
        height - 5,''',
    '''        labelX,
        height - 5,''',
    "footprint time label center",
)
write(path, text)


# 3. Focused regression tests.
test_path = Path("test-tape-stability-followup-v1.mjs")
test_path.write_text(r'''import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  bookPriceEmphasis,
  bookPsychologicalPriceUnit,
  snapTapeWindowEnd,
  tapeWindowPixelQuantum,
} from "./orderbook.js";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const footprint = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");

test("psychological round levels do not depend on selected book step", () => {
  assert.equal(bookPsychologicalPriceUnit(.093), .001);
  assert.deepEqual(bookPriceEmphasis(.093, .093), {
    round: true,
    half: false,
    majorUnit: .001,
  });
  assert.deepEqual(bookPriceEmphasis(.0925, .093), {
    round: false,
    half: true,
    majorUnit: .001,
  });
  assert.equal(bookPsychologicalPriceUnit(100_000), 1_000);
});

test("Tape camera advances on a complete CSS-pixel time grid", () => {
  const duration = 12_000;
  const width = 600;
  assert.equal(tapeWindowPixelQuantum(duration, width), 20);
  assert.equal(snapTapeWindowEnd(10_001, duration, width), 10_020);
  assert.equal(snapTapeWindowEnd(10_019, duration, width), 10_020);
});

test("filter preserves all-trade path and labels every qualifying RAW marker", () => {
  assert.match(orderbook, /const rawPathItems = rawTapeItemsContinuous\(recent, rows, window\)/);
  assert.match(orderbook, /const pathDrawItems = layoutTapeSequence\(rawPathItems/);
  assert.match(orderbook, /if \(minQuote > 0\) \{[\s\S]*const label = formatTapeUsd\(item\.quote\)/);
  assert.match(orderbook, /Линия всех сделок · нет маркеров по фильтру/);
});

test("footprint candle owns the left lane and data begins after its body", () => {
  assert.match(footprint, /const candleLeft = columnLeft \+ 2/);
  assert.match(footprint, /const dataLeft = candleLeft \+ candleBodyWidth \+ 2/);
  assert.match(footprint, /formatSignedQuoteDelta\(cluster\.buyQuote - cluster\.sellQuote\)/);
  assert.match(footprint, /state\.context\.moveTo\(candleX, highRow\.y\)/);
});
''', encoding="utf-8")


# 4. Atomic runtime build/cache update.
for candidate in Path(".").rglob("*"):
    if not candidate.is_file():
        continue
    if candidate.parts[0] == ".git":
        continue
    if candidate.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".webmanifest"}:
        continue
    content = candidate.read_text(encoding="utf-8")
    if OLD_BUILD in content:
        candidate.write_text(content.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

version_path = Path("VERSION.txt")
version = version_path.read_text(encoding="utf-8")
features = [
    "stable-tape-pixel-grid-v1",
    "filtered-all-trade-path-v1",
    "left-footprint-candle-lane-v1",
    "step-independent-round-levels-v1",
]
if "Features:" in version:
    for feature in features:
        if feature not in version:
            version = version.rstrip() + f", {feature}\n"
version_path.write_text(version, encoding="utf-8")
