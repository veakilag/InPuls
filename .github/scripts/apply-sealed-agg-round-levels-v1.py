from pathlib import Path
import re

OLD_BUILD = "26-73-water-tape-batched-v1"
NEW_BUILD = "26-74-sealed-agg-round-levels-v1"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


orderbook = read("orderbook.js")

orderbook = replace_once(
    orderbook,
    "const TAPE_AGG_EVENT_GRACE_MS = 60;\nconst TAPE_AGG_WALL_CLOCK_GRACE_MS = 650;",
    "const TAPE_AGG_EVENT_GRACE_MS = 180;\nconst TAPE_AGG_WALL_CLOCK_GRACE_MS = 700;",
    "AGG seal grace",
)

orderbook = replace_once(
    orderbook,
    '''  const majorUnit = 10 ** Math.ceil(Math.log10(step * 20));
  const halfUnit = majorUnit / 2;
  const normalizeGridPrice = (index) => Number((index * step).toPrecision(15));
  const isMultiple = (price, unit) => {
    if (!Number.isFinite(unit) || unit <= 0) return false;
    const ratio = price / unit;
    return Math.abs(ratio - Math.round(ratio)) <= 1e-7;
  };
''',
    '''  // Psychological levels are derived from the market price, never from the
  // current display step. Zooming the ladder must not change row emphasis.
  const majorUnit = bookPsychologicalPriceUnit(market);
  const normalizeGridPrice = (index) => Number((index * step).toPrecision(15));
''',
    "step-dependent ladder emphasis",
)

orderbook = replace_once(
    orderbook,
    '''    const isRound = isMultiple(price, majorUnit);
    const isHalfRound = !isRound && isMultiple(price, halfUnit);
''',
    '''    const emphasis = bookPriceEmphasisForUnit(price, majorUnit);
    const isRound = emphasis.round;
    const isHalfRound = false;
''',
    "half-round ladder flags",
)

orderbook = replace_once(
    orderbook,
    '    row.classList.toggle("is-price-half", emphasis.half);',
    '    row.classList.remove("is-price-half");',
    "runtime half-round decoration",
)

combined_selector = '''    .orderbook-card .book-ladder-row.is-price-half:not(.is-market),
    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) {'''
round_selector = '''    .orderbook-card .book-ladder-row.is-price-round:not(.is-market) {'''
selector_count = orderbook.count(combined_selector)
if selector_count != 2:
    raise AssertionError(f"combined half/round selector: expected 2, found {selector_count}")
orderbook = orderbook.replace(combined_selector, round_selector)

half_style_pattern = re.compile(
    r'\n    \.orderbook-card \.book-ladder-row\.is-price-half:not\(\.is-market\) strong \{\n'
    r'(?:      .*\n)+?'
    r'    \}\n'
)
orderbook, removed_half_styles = half_style_pattern.subn("\n", orderbook)
if removed_half_styles != 2:
    raise AssertionError(f"half-round style blocks: expected 2, found {removed_half_styles}")

orderbook = replace_once(
    orderbook,
    '''      aggSourceBuckets: [],
      aggSnapshots: new Map(),
      recentRawScratch: [],
''',
    '''      aggSourceBuckets: [],
      aggSnapshots: new Map(),
      aggBaseTick: null,
      aggBaseTickSymbol: null,
      recentRawScratch: [],
''',
    "AGG state tick fields",
)

reset_pattern = re.compile(
    r'(?P<indent> +)state\.rawRenderNodes = \[\];\n'
    r'(?P=indent)state\.aggSourceBuckets = \[\];\n'
    r'(?P=indent)state\.aggSnapshots\?\.clear\?\.\(\);\n'
)

def add_agg_tick_reset(match: re.Match[str]) -> str:
    indent = match.group("indent")
    return (
        f"{indent}state.rawRenderNodes = [];\n"
        f"{indent}state.aggSourceBuckets = [];\n"
        f"{indent}state.aggBaseTick = null;\n"
        f"{indent}state.aggBaseTickSymbol = null;\n"
        f"{indent}state.aggSnapshots?.clear?.();\n"
    )

orderbook, reset_count = reset_pattern.subn(add_agg_tick_reset, orderbook)
if reset_count != 2:
    raise AssertionError(f"symbol/replace AGG reset blocks: expected 2, found {reset_count}")

orderbook = replace_once(
    orderbook,
    '''        localStorage.setItem(TAPE_AGG_LEVEL_KEY, String(state.aggLevelIndex));
        syncTapeModeButton(modeButton, state);
        scheduleTapeDraw(true, card);
''',
    '''        localStorage.setItem(TAPE_AGG_LEVEL_KEY, String(state.aggLevelIndex));
        state.renderModelKey = null;
        state.aggSourceBuckets = [];
        state.aggSnapshots?.clear?.();
        syncTapeModeButton(modeButton, state);
        scheduleTapeDraw(true, card);
''',
    "AGG level reset",
)

orderbook = replace_once(
    orderbook,
    '''function refreshTapeRenderModel(state, symbol, stored, step) {
  const version = Number(tapeDataVersionBySymbol.get(symbol)) || 0;
  const modelKey = [
    symbol,
    version,
    Number(step).toPrecision(12),
    state.aggLevelIndex,
  ].join(":");
''',
    '''export function tapeAggregationTickFromBook(data, fallbackStep = .01) {
  const bestBid = Number(data?.bids?.[0]?.[0]);
  const bestAsk = Number(data?.asks?.[0]?.[0]);
  const middle = Number.isFinite(bestBid) && Number.isFinite(bestAsk)
    ? (bestBid + bestAsk) / 2
    : null;
  const inferred = Number.isFinite(middle)
    ? inferPriceTick(data?.bids, data?.asks, middle)
    : null;
  if (Number.isFinite(inferred) && inferred > 0) return inferred;
  return Math.max(Number.EPSILON, Number(fallbackStep) || .01);
}

function stableTapeAggregationTick(state, symbol, fallbackStep = .01) {
  if (state.aggBaseTickSymbol !== symbol) {
    state.aggBaseTickSymbol = symbol;
    state.aggBaseTick = null;
  }
  const saved = Number(state.aggBaseTick);
  if (Number.isFinite(saved) && saved > 0) return saved;
  const tick = tapeAggregationTickFromBook(
    latestBookDataBySymbol.get(symbol),
    fallbackStep,
  );
  state.aggBaseTick = tick;
  return tick;
}

function refreshTapeRenderModel(state, symbol, stored, aggregationTick) {
  const version = Number(tapeDataVersionBySymbol.get(symbol)) || 0;
  const modelKey = [
    symbol,
    version,
    Number(aggregationTick).toPrecision(12),
    state.aggLevelIndex,
  ].join(":");
''',
    "stable AGG base tick",
)

orderbook = replace_once(
    orderbook,
    '''  state.aggSourceBuckets = aggregateTapeBuckets(
    stored,
    step,
    state.aggLevelIndex,
    null,
  );
''',
    '''  state.aggSourceBuckets = aggregateTapeBuckets(
    stored,
    aggregationTick,
    state.aggLevelIndex,
    null,
  );
''',
    "AGG bucket stable tick",
)

orderbook = replace_once(
    orderbook,
    '''  const range = state.priceRange;
  const step = range?.step ?? .01;
  refreshTapeRenderModel(state, symbol, stored, step);
''',
    '''  const range = state.priceRange;
  const visibleStep = range?.step ?? .01;
  const aggregationTick = stableTapeAggregationTick(
    state,
    symbol,
    visibleStep,
  );
  refreshTapeRenderModel(state, symbol, stored, aggregationTick);
''',
    "draw AGG tick separation",
)

orderbook = replace_once(
    orderbook,
    '''      snapshot = Object.freeze({
        ...bucket,
        showLabel: stableTapeQuoteStrength(bucket.quote) >= .62,
      });
''',
    '''      snapshot = Object.freeze({
        ...bucket,
        status: "sealed",
        sealedAt: Number(closedBefore),
        showLabel: stableTapeQuoteStrength(bucket.quote) >= .62,
      });
''',
    "sealed AGG snapshot",
)

orderbook = replace_once(
    orderbook,
    '''  const aggregateClosedBefore = Math.max(
    latestTime - TAPE_AGG_EVENT_GRACE_MS,
    Number(endTime) - TAPE_AGG_WALL_CLOCK_GRACE_MS,
  );
''',
    '''  // A bucket becomes visible only after both the event-time and wall-clock
  // grace periods have elapsed. Once visible, its frozen snapshot never mutates.
  const aggregateClosedBefore = Math.min(
    latestTime - TAPE_AGG_EVENT_GRACE_MS,
    Number(endTime) - TAPE_AGG_WALL_CLOCK_GRACE_MS,
  );
''',
    "conservative AGG sealing",
)

app = read("app.js")
app = replace_once(
    app,
    '      source.isHalfRound ? "is-price-half" : "",\n',
    '',
    "app half-round class",
)

visual_test = read("test-orderbook-visual-priority.mjs")
visual_test = replace_once(
    visual_test,
    '''test("round prices affect only text and the liquidity meter stays readable", () => {
  assert.match(orderbook, /\\.book-ladder-row\\.is-price-round:not\\(\\.is-market\\) \\{[\\s\\S]*background: transparent !important/);
  assert.match(orderbook, /\\.book-ladder-row\\.is-price-half:not\\(\\.is-market\\) strong/);
  assert.match(orderbook, /\\.book-ladder-row\\.is-price-round:not\\(\\.is-market\\) strong/);
  assert.match(orderbook, /function stableBookPsychologicalUnit\\(card, referencePrice\\)/);
  assert.match(orderbook, /is-price-round:not\\(\\.is-market\\) strong \\{[\\s\\S]*font-size: inherit !important;[\\s\\S]*font-weight: 800 !important;/);
''',
    '''test("only full round prices affect text and the liquidity meter stays readable", () => {
  assert.match(orderbook, /\\.book-ladder-row\\.is-price-round:not\\(\\.is-market\\) \\{[\\s\\S]*background: transparent !important/);
  assert.doesNotMatch(orderbook, /\\.book-ladder-row\\.is-price-half/);
  assert.match(orderbook, /\\.book-ladder-row\\.is-price-round:not\\(\\.is-market\\) strong/);
  assert.match(orderbook, /function stableBookPsychologicalUnit\\(card, referencePrice\\)/);
  assert.match(orderbook, /const majorUnit = bookPsychologicalPriceUnit\\(market\\)/);
  assert.match(orderbook, /row\\.classList\\.remove\\("is-price-half"\\)/);
  assert.match(orderbook, /is-price-round:not\\(\\.is-market\\) strong \\{[\\s\\S]*font-size: inherit !important;[\\s\\S]*font-weight: 800 !important;/);
''',
    "visual priority round-only test",
)

new_test = '''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bookPriceEmphasisForUnit,
  bookPsychologicalPriceUnit,
  buildDepthLadder,
  tapeAggregationTickFromBook,
} from "./orderbook.js";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("ladder emphasis is round-only and independent from compression", () => {
  const market = .01417;
  const unit = bookPsychologicalPriceUnit(market);
  const fine = buildDepthLadder([], [], market, market, .000005, 121);
  const compressed = buildDepthLadder([], [], market, market, .00005, 121);

  assert.equal(fine.some((row) => row.isHalfRound), false);
  assert.equal(compressed.some((row) => row.isHalfRound), false);
  for (const row of [...fine, ...compressed]) {
    assert.equal(row.isRound, bookPriceEmphasisForUnit(row.price, unit).round);
  }
  assert.doesNotMatch(app, /source\\.isHalfRound|is-price-half/);
  assert.doesNotMatch(orderbook, /\\.book-ladder-row\\.is-price-half/);
});

test("AGG price grid comes from the exchange book instead of the visible ladder step", () => {
  const book = {
    bids: [[.01416, 10], [.01415, 10], [.01414, 10]],
    asks: [[.01417, 10], [.01418, 10], [.01419, 10]],
  };
  assert.equal(tapeAggregationTickFromBook(book, .0005), .00001);
  assert.match(orderbook, /stableTapeAggregationTick\\([\\s\\S]*latestBookDataBySymbol\\.get\\(symbol\\)/);
  assert.match(orderbook, /refreshTapeRenderModel\\(state, symbol, stored, aggregationTick\\)/);
  assert.doesNotMatch(orderbook, /refreshTapeRenderModel\\(state, symbol, stored, step\\)/);
});

test("AGG markers are exposed only as sealed immutable snapshots", () => {
  assert.match(orderbook, /snapshot = Object\\.freeze\\(\\{[\\s\\S]*status: "sealed"/);
  assert.match(orderbook, /const aggregateClosedBefore = Math\\.min\\(/);
  assert.match(orderbook, /state\\.aggSnapshots\\.get\\(bucket\\.key\\)/);
  assert.match(orderbook, /if \\(snapshot\\) output\\.push\\(snapshot\\)/);
});
'''
write("test-sealed-agg-round-levels-v1.mjs", new_test)

write("orderbook.js", orderbook)
write("app.js", app)
write("test-orderbook-visual-priority.mjs", visual_test)

# Keep every runtime/cache reference on one build to force a clean browser refresh.
for path in Path(".").iterdir():
    if not path.is_file() or path.suffix.lower() not in {".js", ".mjs", ".html", ".txt"}:
        continue
    text = path.read_text(encoding="utf-8")
    if OLD_BUILD in text:
        path.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

version = read("VERSION.txt")
features = [
    "sealed-agg-buckets-v1",
    "zoom-independent-agg-price-grid-v1",
    "round-only-price-emphasis-v1",
]
lines = version.splitlines()
for index, line in enumerate(lines):
    if line.startswith("Features:"):
        for feature in features:
            if feature not in line:
                line += f", {feature}"
        lines[index] = line
        break
write("VERSION.txt", "\n".join(lines) + "\n")

# Generated-tree guards.
orderbook = read("orderbook.js")
app = read("app.js")
assert "const majorUnit = bookPsychologicalPriceUnit(market);" in orderbook
assert '.book-ladder-row.is-price-half' not in orderbook
assert 'source.isHalfRound ? "is-price-half"' not in app
assert "stableTapeAggregationTick" in orderbook
assert "const aggregateClosedBefore = Math.min(" in orderbook
assert 'status: "sealed"' in orderbook
assert OLD_BUILD not in "\n".join(
    read(path)
    for path in ["VERSION.txt", "app.js", "index.html", "orderbook.js", "sw.js"]
)
