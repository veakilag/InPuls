from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORDERBOOK = ROOT / "orderbook.js"
TEST_FILE = ROOT / "test-sweep-tape-clock-v1.mjs"
OLD_BUILD = "26-80-sweep-tape-clock-v1"
NEW_BUILD = "26-81-compact-series-trade-edge-v1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)


text = ORDERBOOK.read_text(encoding="utf-8")

text = replace_once(
    text,
    '''export const TAPE_SWEEP_MAX_GAP_MS = 35;
export const TAPE_SWEEP_MAX_REVERSE_TICKS = 1;
const TAPE_TIMELINE_CACHE_LIMIT = 240;''',
    '''export const TAPE_SWEEP_MAX_GAP_MS = 35;
export const TAPE_SWEEP_MAX_REVERSE_TICKS = 1;
export const TAPE_LIVE_EDGE_MAX_LEAD_MS = 1_200;
export const TAPE_SWEEP_MIN_AGGREGATES = 2;
const TAPE_SWEEP_MAX_DIRECTION_SPAN_PX = 34;
const TAPE_TIMELINE_CACHE_LIMIT = 240;''',
    "compact Series constants",
)

text = replace_once(
    text,
    '''export function advanceTapeDisplayClock(previousEnd, previousAt, wallNow, nowPerf) {
  const wall = Number(wallNow);
  const now = Number(nowPerf);
  if (!Number.isFinite(wall) || !Number.isFinite(now)) return null;
  const hasPrevious = previousEnd !== null
    && previousEnd !== undefined
    && Number.isFinite(Number(previousEnd));
  if (!hasPrevious) return wall;
  const previous = Number(previousEnd);
  const previousPerf = Number(previousAt);
  const elapsed = Number.isFinite(previousPerf)
    ? Math.max(0, Math.min(250, now - previousPerf))
    : 0;
  const predicted = previous + elapsed;
  const error = wall - predicted;
  const alpha = 1 - Math.exp(-Math.max(1, elapsed) / 240);
  const correction = clampTape(error * alpha, -4, 4);
  return Math.max(previous, predicted + correction);
}''',
    '''export function advanceTapeDisplayClock(
  previousEnd,
  previousAt,
  latestTradeTime,
  wallNow,
  nowPerf,
) {
  const latest = Number(latestTradeTime);
  const wall = Number(wallNow);
  const now = Number(nowPerf);
  if (![latest, wall, now].every(Number.isFinite)) return null;
  const desired = Math.max(
    latest + 1,
    Math.min(wall, latest + TAPE_LIVE_EDGE_MAX_LEAD_MS),
  );
  const hasPrevious = previousEnd !== null
    && previousEnd !== undefined
    && Number.isFinite(Number(previousEnd));
  if (!hasPrevious) return desired;
  const previous = Number(previousEnd);
  if (Math.abs(desired - previous) > TAPE_LIVE_EDGE_MAX_LEAD_MS * 2) return desired;
  const previousPerf = Number(previousAt);
  const elapsed = Number.isFinite(previousPerf)
    ? Math.max(0, Math.min(250, now - previousPerf))
    : 0;
  if (elapsed <= 0 || Math.abs(desired - previous) <= .5) return desired;
  const alpha = 1 - Math.exp(-elapsed / 90);
  const next = previous + (desired - previous) * alpha;
  return desired >= previous
    ? Math.min(desired, Math.max(previous, next))
    : Math.max(desired, Math.min(previous, next));
}''',
    "trade-anchored display clock",
)

text = replace_once(
    text,
    '''    current.vwapPrice = current.quantity > 0 ? current.quote / current.quantity : current.firstPrice;
    current.durationMs = Math.max(0, current.lastTime - current.firstTime);
    current.time = current.firstTime + current.durationMs / 2;
    current.eventTime = current.time;
    current.price = current.firstPrice;
    const ordinalKey = Math.round(current.time);
    current.timeOrdinal = ordinalByTime.get(ordinalKey) ?? 0;
    ordinalByTime.set(ordinalKey, current.timeOrdinal + 1);
    groupsOut.push(current);
    current = null;''',
    '''    current.vwapPrice = current.quantity > 0 ? current.quote / current.quantity : current.firstPrice;
    current.durationMs = Math.max(0, current.lastTime - current.firstTime);
    current.time = current.firstTime + current.durationMs / 2;
    current.eventTime = current.time;
    current.labelPrice = current.lastPrice;
    current.price = current.lastPrice;
    current.kind = "sweep";
    const ordinalKey = Math.round(current.time);
    current.timeOrdinal = ordinalByTime.get(ordinalKey) ?? 0;
    ordinalByTime.set(ordinalKey, current.timeOrdinal + 1);
    if (current.aggregateCount >= TAPE_SWEEP_MIN_AGGREGATES) groupsOut.push(current);
    current = null;''',
    "real Series only and last-price anchor",
)

old_sweep_label = '        showLabel: stableTapeQuoteStrength(group.quote) >= .52,'
new_sweep_label = '        showLabel: stableTapeQuoteStrength(group.quote) >= .66 || Number(group.aggregateCount) >= 4,'
label_count = text.count(old_sweep_label)
if label_count != 2:
    raise RuntimeError(f"Series label thresholds: expected 2 matches, got {label_count}")
text = text.replace(old_sweep_label, new_sweep_label)

text = replace_once(
    text,
    '''export function aggregateLabelPrice(item) {
  const minimum = Number(item?.minPrice);''',
    '''export function aggregateLabelPrice(item) {
  const explicit = Number(item?.labelPrice);
  if (Number.isFinite(explicit)) return explicit;
  const minimum = Number(item?.minPrice);''',
    "explicit Series label price",
)

text = replace_once(
    text,
    '''  context.stroke();
  return true;
}

function drawRawTapeMarkerBatches(context, batches) {''',
    '''  context.stroke();
  return true;
}

function drawSweepDirection(
  context,
  viewport,
  item,
  x,
  buy,
  stroke,
  strength,
  openAggregate = false,
) {
  const lowPrice = Number(viewport?.lowPrice);
  const highPrice = Number(viewport?.highPrice);
  const firstPrice = Number(item?.firstPrice);
  const lastPrice = Number(item?.lastPrice);
  if (![lowPrice, highPrice, firstPrice, lastPrice].every(Number.isFinite)) return false;
  const start = projectTapePrice(viewport, clampTape(firstPrice, lowPrice, highPrice));
  const end = projectTapePrice(viewport, clampTape(lastPrice, lowPrice, highPrice));
  if (!start || !end) return false;
  const delta = end.y - start.y;
  const maximumSpan = clampTape(
    (Number(viewport?.rowHeight) || 1) * 4.2,
    12,
    TAPE_SWEEP_MAX_DIRECTION_SPAN_PX,
  );
  const fromY = Math.abs(delta) > maximumSpan
    ? end.y - Math.sign(delta || (buy ? -1 : 1)) * maximumSpan
    : start.y;
  const toY = end.y;
  const direction = Math.sign(toY - fromY) || (buy ? -1 : 1);

  context.save();
  context.globalAlpha = openAggregate ? .52 : .76;
  context.strokeStyle = stroke;
  context.fillStyle = stroke;
  context.lineWidth = clampTape(.85 + strength * .45, .85, 1.45);
  context.beginPath();
  context.moveTo(x, fromY);
  context.lineTo(x, toY);
  context.stroke();
  context.beginPath();
  context.moveTo(x, toY);
  context.lineTo(x - 2.6, toY - direction * 4.2);
  context.lineTo(x + 2.6, toY - direction * 4.2);
  context.closePath();
  context.fill();
  context.restore();
  return true;
}

function drawAggregateMotion(
  context,
  viewport,
  item,
  x,
  buy,
  stroke,
  strength,
  sweepMode,
  openAggregate = false,
) {
  return sweepMode
    ? drawSweepDirection(context, viewport, item, x, buy, stroke, strength, openAggregate)
    : drawAggregatePriceRange(context, viewport, item, x, buy, stroke, strength, openAggregate);
}

function drawRawTapeMarkerBatches(context, batches) {''',
    "compact Series direction renderer",
)

old_motion_call = '''      drawAggregatePriceRange(
        context,
        state.priceViewport,
        item,
        x,
        buy,
        stroke,
        strength,
        openAggregate,
      );'''
new_motion_call = '''      drawAggregateMotion(
        context,
        state.priceViewport,
        item,
        x,
        buy,
        stroke,
        strength,
        sweepMode,
        openAggregate,
      );'''
motion_count = text.count(old_motion_call)
if motion_count != 2:
    raise RuntimeError(f"aggregate motion calls: expected 2 matches, got {motion_count}")
text = text.replace(old_motion_call, new_motion_call)

text = replace_once(
    text,
    '''    const showLabel = minQuote > 0 || Boolean(item.showLabel);
    const openAggregate = item.status === "open";
    const sweepMode = state.mode === "sweep";''',
    '''    const sweepMode = state.mode === "sweep";
    const showLabel = sweepMode
      ? Boolean(item.showLabel)
      : minQuote > 0 || Boolean(item.showLabel);
    const openAggregate = item.status === "open";''',
    "Series label density",
)

text = replace_once(
    text,
    '''    const diameter = clampTape(4 + strength * 6 + (sweepMode ? 1.5 : 0), 4, sweepMode ? 14 : 12);''',
    '''    const diameter = clampTape(4 + strength * (sweepMode ? 5 : 6), 4, sweepMode ? 11 : 12);''',
    "compact Series dot size",
)

text = replace_once(
    text,
    '''    const height = clampTape(7 + strength * 6 + (sweepMode ? 1.5 : 0), 7, sweepMode ? 16 : 14);
    const width = clampTape(measured + 9 + (sweepMode ? 4 : 0), 18, Math.min(92, rect.width * .28));''',
    '''    const height = clampTape(7 + strength * (sweepMode ? 5 : 6), 7, sweepMode ? 14 : 14);
    const width = clampTape(measured + 9 + (sweepMode ? 1 : 0), 18, Math.min(sweepMode ? 84 : 92, rect.width * .28));''',
    "compact Series label size",
)

text = replace_once(
    text,
    '''  const endTime = advanceTapeDisplayClock(
    state.clockEndTime,
    state.clockPerfAt,
    Date.now(),
    perfNow,
  );''',
    '''  const endTime = advanceTapeDisplayClock(
    state.clockEndTime,
    state.clockPerfAt,
    latestTime,
    Date.now(),
    perfNow,
  );''',
    "trade-anchored clock call",
)

ORDERBOOK.write_text(text, encoding="utf-8")

for path in ROOT.rglob("*"):
    if not path.is_file() or any(part in {".git", "node_modules"} for part in path.parts):
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".webmanifest"}:
        continue
    content = path.read_text(encoding="utf-8")
    if OLD_BUILD in content:
        path.write_text(content.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

version_path = ROOT / "VERSION.txt"
version = version_path.read_text(encoding="utf-8")
features = ", compact-series-v2, trade-anchored-tape-edge-v1, singleton-series-suppression-v1"
if "compact-series-v2" not in version:
    version_path.write_text(version.rstrip() + features + "\n", encoding="utf-8")

TEST_FILE.write_text(r'''import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  TAPE_LIVE_EDGE_MAX_LEAD_MS,
  TAPE_SWEEP_MAX_GAP_MS,
  TAPE_SWEEP_MIN_AGGREGATES,
  aggregateTapeZeroMs,
  aggregateTapeSweeps,
  materializeTapeSweeps,
  aggregateVisibleLabelPrice,
  advanceTapeDisplayClock,
} from "./orderbook.js?v=26-81-compact-series-trade-edge-v1";

const trade = (id, time, price, side, quantity = 1) => ({
  id,
  firstTradeId: id,
  lastTradeId: id,
  time,
  price,
  quantity,
  quote: price * quantity,
  side,
});

test("Series joins adjacent same-side AGG and hides singleton fragments", () => {
  const zero = aggregateTapeZeroMs([
    trade(1, 1_000, 100, "buy"),
    trade(2, 1_001, 101, "buy"),
    trade(3, 1_020, 102, "buy"),
    trade(4, 1_040, 101, "buy"),
    trade(5, 1_041, 99, "buy"),
    trade(6, 1_042, 98, "sell"),
  ]);
  const sweeps = aggregateTapeSweeps(zero);
  assert.equal(TAPE_SWEEP_MAX_GAP_MS, 35);
  assert.equal(TAPE_SWEEP_MIN_AGGREGATES, 2);
  assert.equal(sweeps.length, 1);
  assert.equal(sweeps[0].aggregateCount, 4);
  assert.equal(sweeps[0].count, 4);
  assert.equal(sweeps[0].minPrice, 100);
  assert.equal(sweeps[0].maxPrice, 102);
  assert.equal(sweeps[0].durationMs, 40);
  assert.equal(sweeps[0].labelPrice, 101);
  assert.equal(sweeps[0].kind, "sweep");
});

test("ID gaps and excessive pauses do not create fake one-trade Series", () => {
  const zero = aggregateTapeZeroMs([
    trade(10, 2_000, 10, "sell"),
    trade(12, 2_001, 9, "sell"),
    trade(13, 2_100, 8, "sell"),
  ]);
  assert.equal(aggregateTapeSweeps(zero).length, 0);
});

test("sealed Series history keeps identity while only the open Series grows", () => {
  const state = { sweepSnapshots: new Map() };
  const firstGroups = aggregateTapeSweeps(aggregateTapeZeroMs([
    trade(20, 3_000, 100, "buy"),
    trade(21, 3_001, 101, "buy"),
    trade(22, 3_010, 100, "sell"),
    trade(23, 3_011, 99, "sell"),
  ]));
  const firstView = materializeTapeSweeps(state, firstGroups, []);
  assert.equal(firstView.length, 2);
  assert.equal(firstView[0].status, "sealed");
  assert.equal(firstView[1].status, "open");
  const sealed = firstView[0];

  const nextGroups = aggregateTapeSweeps(aggregateTapeZeroMs([
    trade(20, 3_000, 100, "buy"),
    trade(21, 3_001, 101, "buy"),
    trade(22, 3_010, 100, "sell"),
    trade(23, 3_011, 99, "sell"),
    trade(24, 3_012, 98, "sell"),
  ]));
  const nextView = materializeTapeSweeps(state, nextGroups, []);
  assert.equal(nextView[0], sealed);
  assert.equal(nextView[1].status, "open");
  assert.equal(nextView[1].aggregateCount, 3);
});

test("Aggregate labels are clipped and Series labels use the ending price", () => {
  const viewport = { lowPrice: 100, highPrice: 110, step: 1, lowY: 100, highY: 0, rowHeight: 10 };
  assert.equal(aggregateVisibleLabelPrice(viewport, { minPrice: 90, maxPrice: 104 }), 100);
  assert.equal(aggregateVisibleLabelPrice(viewport, { minPrice: 104, maxPrice: 108 }), 106);
  assert.equal(aggregateVisibleLabelPrice(viewport, {
    minPrice: 104,
    maxPrice: 108,
    labelPrice: 108,
  }), 108);
  assert.ok(Number.isNaN(aggregateVisibleLabelPrice(viewport, { minPrice: 80, maxPrice: 90 })));
});

test("Tape edge stays near the latest trade instead of creating a large empty future", () => {
  const first = advanceTapeDisplayClock(null, null, 10_000, 20_000, 0);
  assert.equal(first, 10_000 + TAPE_LIVE_EDGE_MAX_LEAD_MS);
  const idle = advanceTapeDisplayClock(first, 0, 10_000, 20_016, 16);
  assert.equal(idle, first);
  const nextTrade = advanceTapeDisplayClock(idle, 16, 10_050, 20_032, 32);
  assert.ok(nextTrade > idle);
  assert.ok(nextTrade <= 10_050 + TAPE_LIVE_EDGE_MAX_LEAD_MS);
});

test("Runtime exposes compact Series and avoids per-second card rescans", () => {
  const source = fs.readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
  assert.match(source, /mode === "raw" \? "agg" : state\.mode === "agg" \? "sweep" : "raw"/);
  assert.match(source, /button\.textContent = mode === "agg" \? "AGG" : mode === "sweep" \? "СЕРИЯ" : "RAW"/);
  assert.match(source, /current\.aggregateCount >= TAPE_SWEEP_MIN_AGGREGATES/);
  assert.match(source, /function drawSweepDirection\(/);
  assert.match(source, /const showLabel = sweepMode\s*\? Boolean\(item\.showLabel\)/);
  assert.match(source, /advanceTapeDisplayClock\(\s*state\.clockEndTime,\s*state\.clockPerfAt,\s*latestTime,/);
  const timerBlock = source.match(/tapeStateTimer = setInterval\(\(\) => \{[\s\S]*?\}, TAPE_STATE_REFRESH_MS\);/)?.[0] ?? "";
  assert.ok(timerBlock.length > 0);
  assert.doesNotMatch(timerBlock, /scanTapeCards\(document\)/);
  assert.match(timerBlock, /if \(state\.densityAgeVisible\) decorateDensityAges/);
});

test("Footprint volume labels reuse order-book size typography", () => {
  const source = fs.readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
  assert.match(source, /state\.context\.font = "700 7px Arial, sans-serif"/);
});
''', encoding="utf-8")

print(f"Applied {NEW_BUILD}")
