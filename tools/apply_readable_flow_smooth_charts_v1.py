from pathlib import Path

OLD_BUILD = "26-83-arrival-clock-render-decouple-v1"
NEW_BUILD = "26-84-readable-flow-smooth-charts-v1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, got {count}")
    return text.replace(old, new, 1)


def replace_section(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"{label}: start marker missing")
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"{label}: end marker missing")
    return text[:start] + replacement.rstrip() + "\n\n" + text[end:]


# Atomic cache/build bump across browser entry points and test imports.
for path in Path(".").rglob("*"):
    if not path.is_file():
        continue
    if any(part in {".git", "node_modules", "tools", ".github"} for part in path.parts):
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".txt"}:
        continue
    source = path.read_text(encoding="utf-8")
    if OLD_BUILD in source:
        path.write_text(source.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")


# ---------------------------------------------------------------------------
# Tape: AGG and SERIES share one visual size contract. SERIES explicitly shows
# a sum (Σ) but its marker thickness is based on the largest underlying AGG,
# preventing the same market area from changing scale between modes.
# Both modes use collision-aware sparse labels under burst traffic.
# ---------------------------------------------------------------------------
orderbook_path = Path("orderbook.js")
orderbook = orderbook_path.read_text(encoding="utf-8")

orderbook = replace_once(
    orderbook,
    '''const TAPE_SWEEP_LABEL_MIN_GAP_X = 6;
const TAPE_SWEEP_LABEL_MIN_GAP_Y = 4;
const TAPE_TIMELINE_CACHE_LIMIT = 240;''',
    '''const TAPE_SWEEP_LABEL_MIN_GAP_X = 6;
const TAPE_SWEEP_LABEL_MIN_GAP_Y = 4;
const TAPE_AGG_LABEL_MIN_GAP_X = 5;
const TAPE_AGG_LABEL_MIN_GAP_Y = 3;
const TAPE_TIMELINE_CACHE_LIMIT = 240;''',
    "Tape label spacing constants",
)

orderbook = replace_once(
    orderbook,
    '''    current.vwapPrice = current.quantity > 0 ? current.quote / current.quantity : current.firstPrice;
    current.durationMs = Math.max(0, current.lastTime - current.firstTime);''',
    '''    current.vwapPrice = current.quantity > 0 ? current.quote / current.quantity : current.firstPrice;
    current.sizeQuote = Math.max(0, Number(current.peakAggregateQuote) || Number(current.quote) || 0);
    current.durationMs = Math.max(0, current.lastTime - current.firstTime);''',
    "Series visual size finalization",
)

orderbook = replace_once(
    orderbook,
    '''        aggregateCount: 0,
      };''',
    '''        aggregateCount: 0,
        peakAggregateQuote: 0,
      };''',
    "Series peak quote initialization",
)

orderbook = replace_once(
    orderbook,
    '''    current.quote += Number(group.quote) || 0;
    current.buyQuote += Number(group.buyQuote) || 0;''',
    '''    current.quote += Number(group.quote) || 0;
    current.peakAggregateQuote = Math.max(
      Number(current.peakAggregateQuote) || 0,
      Number(group.quote) || 0,
    );
    current.buyQuote += Number(group.buyQuote) || 0;''',
    "Series peak quote accumulation",
)

label_selector = r'''export function tapeVisualSizeQuote(item, mode = "agg") {
  const total = Math.max(0, Number(item?.quote) || 0);
  if (mode !== "sweep") return total;
  return Math.max(
    0,
    Number(item?.sizeQuote) || 0,
    Number(item?.peakAggregateQuote) || 0,
    total && !Number(item?.aggregateCount) ? total : 0,
  );
}

export function tapeDisplayLabel(item, mode = "agg") {
  const formatted = formatTapeUsd(item?.quote);
  return mode === "sweep" ? `Σ${formatted}` : formatted;
}

export function selectTapeLabelKeys(
  projectedItems,
  window,
  plotRight,
  measureText = (label) => String(label).length * 5,
  { mode = "agg", forceLabels = false } = {},
) {
  const right = Math.max(1, Number(plotRight) || 1);
  const sweepMode = mode === "sweep";
  const candidates = [];
  for (const projected of projectedItems ?? []) {
    const item = projected?.source;
    const y = Number(projected?.position?.y);
    if ((!forceLabels && !item?.showLabel) || !Number.isFinite(y)) continue;
    const label = tapeDisplayLabel(item, mode);
    const measured = Math.max(0, Number(measureText(label)) || 0);
    const strength = stableTapeQuoteStrength(tapeVisualSizeQuote(item, mode));
    const height = clampTape(7 + strength * 6, 7, 14);
    const width = clampTape(measured + 9, 18, Math.min(92, right * .28));
    const baseX = tapeTimeX(item.time, window, right);
    const x = aggregateStableX(baseX, item.timeOrdinal, width, right);
    candidates.push({
      key: item.key,
      x,
      y,
      width,
      height,
      quote: Number(item.quote) || 0,
      sizeQuote: tapeVisualSizeQuote(item, mode),
      aggregateCount: Number(item.aggregateCount) || 0,
      time: Number(item.time) || 0,
      open: item.status === "open",
    });
  }

  candidates.sort((left, rightItem) => {
    if (left.open !== rightItem.open) return left.open ? -1 : 1;
    if (left.quote !== rightItem.quote) return rightItem.quote - left.quote;
    if (left.sizeQuote !== rightItem.sizeQuote) return rightItem.sizeQuote - left.sizeQuote;
    if (left.aggregateCount !== rightItem.aggregateCount) {
      return rightItem.aggregateCount - left.aggregateCount;
    }
    return rightItem.time - left.time;
  });

  const maximumLabels = sweepMode
    ? Math.max(3, Math.min(10, Math.floor(right / 72)))
    : Math.max(4, Math.min(14, Math.floor(right / 62)));
  const gapX = sweepMode ? TAPE_SWEEP_LABEL_MIN_GAP_X : TAPE_AGG_LABEL_MIN_GAP_X;
  const gapY = sweepMode ? TAPE_SWEEP_LABEL_MIN_GAP_Y : TAPE_AGG_LABEL_MIN_GAP_Y;
  const accepted = [];
  const keys = new Set();
  for (const candidate of candidates) {
    if (accepted.length >= maximumLabels) break;
    const overlaps = accepted.some((placed) => (
      Math.abs(candidate.x - placed.x) < (candidate.width + placed.width) / 2 + gapX
      && Math.abs(candidate.y - placed.y) < (candidate.height + placed.height) / 2 + gapY
    ));
    if (overlaps) continue;
    accepted.push(candidate);
    keys.add(candidate.key);
  }
  return keys;
}

export function selectSweepLabelKeys(
  projectedItems,
  window,
  plotRight,
  measureText = (label) => String(label).length * 5,
) {
  return selectTapeLabelKeys(projectedItems, window, plotRight, measureText, { mode: "sweep" });
}'''
orderbook = replace_section(
    orderbook,
    "export function selectSweepLabelKeys(",
    "function drawRawTapeMarkerBatches(",
    label_selector,
    "Unified AGG/SERIES label selection",
)

orderbook = replace_once(
    orderbook,
    '''  const sweepLabelKeys = state.mode === "sweep"
    ? selectSweepLabelKeys(
      items,
      window,
      window.plotRight,
      (label) => context.measureText(label).width,
    )
    : null;''',
    '''  const sweepLabelKeys = state.mode === "sweep"
    ? selectTapeLabelKeys(
      items,
      window,
      window.plotRight,
      (label) => context.measureText(label).width,
      { mode: "sweep" },
    )
    : null;
  const aggLabelKeys = state.mode === "agg"
    ? selectTapeLabelKeys(
      items,
      window,
      window.plotRight,
      (label) => context.measureText(label).width,
      { mode: "agg", forceLabels: minQuote > 0 },
    )
    : null;''',
    "AGG and SERIES label key preparation",
)

orderbook = replace_once(
    orderbook,
    '''    const strength = stableTapeQuoteStrength(item.quote);
    const baseX = tapeTimeX(item.time, window, rect.width);''',
    '''    const strength = stableTapeQuoteStrength(tapeVisualSizeQuote(item, state.mode));
    const baseX = tapeTimeX(item.time, window, rect.width);''',
    "Shared visual size strength",
)

orderbook = replace_once(
    orderbook,
    '''    const showLabel = sweepMode
      ? Boolean(sweepLabelKeys?.has(item.key))
      : minQuote > 0 || Boolean(item.showLabel);
    const openAggregate = item.status === "open";
    const label = formatTapeUsd(item.quote);
    const diameter = clampTape(4 + strength * (sweepMode ? 5 : 6), 4, sweepMode ? 11 : 12);''',
    '''    const showLabel = sweepMode
      ? Boolean(sweepLabelKeys?.has(item.key))
      : Boolean(aggLabelKeys?.has(item.key));
    const openAggregate = item.status === "open";
    const label = tapeDisplayLabel(item, state.mode);
    const diameter = clampTape(4 + strength * 6, 4, 12);''',
    "Adaptive label visibility and semantic SERIES label",
)

orderbook = replace_once(
    orderbook,
    '''    const height = clampTape(7 + strength * (sweepMode ? 5 : 6), 7, sweepMode ? 14 : 14);
    const width = clampTape(measured + 9 + (sweepMode ? 1 : 0), 18, Math.min(sweepMode ? 84 : 92, rect.width * .28));''',
    '''    const height = clampTape(7 + strength * 6, 7, 14);
    const width = clampTape(measured + 9, 18, Math.min(92, rect.width * .28));''',
    "Unified AGG/SERIES badge geometry",
)

orderbook_path.write_text(orderbook, encoding="utf-8")


# ---------------------------------------------------------------------------
# Charts: live candle updates mutate only the tail, coalesce to one browser frame
# and throttle expensive full-array cache copies. Extra-chart price headers use
# the same live stream instead of waiting for the one-second market summary.
# ---------------------------------------------------------------------------
chart_path = Path("chart.js")
chart = chart_path.read_text(encoding="utf-8")

live_upsert = r'''export function upsertLiveCandleInPlace(candles, candle, limit = 180) {
  if (!Array.isArray(candles) || !candle || !Number.isFinite(candle.time)) return candles;
  const last = candles.at(-1);
  if (last?.time === candle.time) candles[candles.length - 1] = candle;
  else if (!last || candle.time > last.time) candles.push(candle);
  else {
    const index = candles.findIndex((item) => item.time === candle.time);
    if (index >= 0) candles[index] = candle;
  }
  const overflow = candles.length - Math.max(1, Math.floor(Number(limit) || 1));
  if (overflow > 0) candles.splice(0, overflow);
  return candles;
}'''
chart = replace_once(
    chart,
    "export function scaleFromDrag(initialScale, delta, sensitivity = 120) {",
    live_upsert + "\n\nexport function scaleFromDrag(initialScale, delta, sensitivity = 120) {",
    "Live in-place candle helper",
)

chart = replace_once(
    chart,
    '''    this.seriesCache = new Map();
    this.historyFlushTimer = null;''',
    '''    this.seriesCache = new Map();
    this.historyFlushTimer = null;
    this.liveEmitHandle = null;
    this.liveEmitKind = null;
    this.pendingLiveMeta = null;
    this.cacheFlushTimer = null;''',
    "KlineFeed live scheduling state",
)

live_methods = r'''  #scheduleLiveEmit(meta) {
    this.pendingLiveMeta = meta;
    if (this.liveEmitHandle !== null) return;
    const emit = () => {
      this.liveEmitHandle = null;
      this.liveEmitKind = null;
      const pending = this.pendingLiveMeta;
      this.pendingLiveMeta = null;
      if (!pending) return;
      this.onData(this.candles, pending);
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      this.liveEmitKind = "raf";
      this.liveEmitHandle = globalThis.requestAnimationFrame(emit);
    } else {
      this.liveEmitKind = "timeout";
      this.liveEmitHandle = setTimeout(emit, 16);
    }
  }

  #scheduleSeriesCacheFlush() {
    if (this.cacheFlushTimer !== null || !this.symbol || !this.interval) return;
    this.cacheFlushTimer = setTimeout(() => {
      this.cacheFlushTimer = null;
      if (!this.symbol || !this.interval) return;
      const limit = this.interval.endsWith("s") ? 30_000 : 1_500;
      this.seriesCache.set(`${this.symbol}:${this.interval}`, this.candles.slice(-limit));
    }, 250);
  }

  #cancelLiveEmit() {
    if (this.liveEmitHandle === null) return;
    if (this.liveEmitKind === "raf" && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(this.liveEmitHandle);
    } else {
      clearTimeout(this.liveEmitHandle);
    }
    this.liveEmitHandle = null;
    this.liveEmitKind = null;
    this.pendingLiveMeta = null;
  }
'''
chart = replace_once(
    chart,
    "  destroy() {\n    this.generation += 1;",
    live_methods + "\n  destroy() {\n    this.generation += 1;",
    "KlineFeed coalescing methods",
)

chart = replace_once(
    chart,
    '''        this.candles = upsertCandle(this.candles, candle, secondsMode ? 30_000 : 1500);
        this.seriesCache.set(`${this.symbol}:${this.interval}`, this.candles.slice());
        this.onData(this.candles, { symbol: this.symbol, interval: this.interval, range: this.range });
        if (secondsMode) this.#scheduleSecondHistorySave();''',
    '''        upsertLiveCandleInPlace(this.candles, candle, secondsMode ? 30_000 : 1_500);
        this.#scheduleSeriesCacheFlush();
        this.#scheduleLiveEmit({ symbol: this.symbol, interval: this.interval, range: this.range });
        if (secondsMode) this.#scheduleSecondHistorySave();''',
    "Coalesced live chart updates",
)

chart = replace_once(
    chart,
    '''  #cleanup() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.historyFlushTimer);''',
    '''  #cleanup() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.historyFlushTimer);
    clearTimeout(this.cacheFlushTimer);
    this.cacheFlushTimer = null;
    this.#cancelLiveEmit();''',
    "KlineFeed cleanup",
)

chart_path.write_text(chart, encoding="utf-8")


# ---------------------------------------------------------------------------
# Main UI clock: one cached formatter and one text mutation per second. Hidden
# timezone-map markers are refreshed only while the dialog is open and only once
# per minute, removing the remaining exact-second main-thread spike.
# ---------------------------------------------------------------------------
app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")

app = replace_once(
    app,
    '''function timeZoneClock(zone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat("ru-RU", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  } catch { return "--:--"; }
}''',
    '''const timeFormatterCache = new Map();
function cachedTimeFormatter(zone, withSeconds = false) {
  const key = `${zone}:${withSeconds ? "seconds" : "minutes"}`;
  let formatter = timeFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("ru-RU", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
      hour12: false,
    });
    timeFormatterCache.set(key, formatter);
  }
  return formatter;
}

function timeZoneClock(zone, date = new Date(), withSeconds = false) {
  try {
    return cachedTimeFormatter(zone, withSeconds).format(date);
  } catch { return withSeconds ? "--:--:--" : "--:--"; }
}''',
    "Cached time formatters",
)

app = replace_once(
    app,
    '''function updateTimeZoneClocks() {
  for (const marker of els.timeZoneMarkers?.querySelectorAll(".timezone-marker") ?? []) {
    const item = TIME_ZONE_CITIES.find((city) => city.zone === marker.dataset.zone && marker.getAttribute("aria-label")?.startsWith(city.city));
    if (item) marker.dataset.city = `${item.city} · ${timeZoneClock(item.zone)}`;
  }
  if (els.timeZoneDialog?.open) renderTimeZoneResults();
}''',
    '''let timeZoneClockMinuteKey = null;
function updateTimeZoneClocks(date = new Date()) {
  if (!els.timeZoneDialog?.open) return;
  const minuteKey = Math.floor(date.getTime() / 60_000);
  if (minuteKey === timeZoneClockMinuteKey) return;
  timeZoneClockMinuteKey = minuteKey;
  for (const marker of els.timeZoneMarkers?.querySelectorAll(".timezone-marker") ?? []) {
    const item = TIME_ZONE_CITIES.find((city) => city.zone === marker.dataset.zone && marker.getAttribute("aria-label")?.startsWith(city.city));
    if (item) marker.dataset.city = `${item.city} · ${timeZoneClock(item.zone, date)}`;
  }
  renderTimeZoneResults();
}''',
    "Minute-only visible timezone updates",
)

app = replace_once(
    app,
    '''  panel.feed = new KlineFeed({ onData: (candles, meta) => chart.setData(candles, meta), onStatus() {} });''',
    '''  panel.feed = new KlineFeed({
    onData: (candles, meta) => {
      chart.setData(candles, meta);
      const currentPrice = Number(candles.at(-1)?.close);
      const priceNode = article.querySelector("[data-mini-price]");
      if (priceNode && Number.isFinite(currentPrice)) {
        const nextText = formatPrice(currentPrice);
        if (priceNode.textContent !== nextText) priceNode.textContent = nextText;
      }
    },
    onStatus() {},
  });''',
    "Live extra-chart price header",
)

clock_block = r'''let lastHeaderClockText = "";
let clockTickTimer = null;
function updateClock(date = new Date()) {
  const zone = state.timeZone === "local"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : state.timeZone;
  const nextText = timeZoneClock(zone, date, true);
  if (nextText !== lastHeaderClockText) {
    lastHeaderClockText = nextText;
    els.clock.textContent = nextText;
  }
  updateTimeZoneClocks(date);
}
function scheduleClockTick() {
  clearTimeout(clockTickTimer);
  const delay = Math.max(40, 1_000 - (Date.now() % 1_000) + 12);
  clockTickTimer = setTimeout(() => {
    requestAnimationFrame(() => {
      updateClock(new Date());
      scheduleClockTick();
    });
  }, delay);
}
updateClock();
scheduleClockTick();'''
app = replace_section(
    app,
    "function updateClock() {",
    "render();",
    clock_block,
    "Lightweight header clock",
)
# restore the initial render removed by section replacement
app = app.replace(clock_block + "\n\nrender();", clock_block + "\nrender();", 1)

app_path.write_text(app, encoding="utf-8")


# Regression coverage.
test_path = Path("test-readable-flow-smooth-charts-v1.mjs")
test_path.write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  aggregateTapeSweeps,
  aggregateTapeZeroMs,
  selectTapeLabelKeys,
  tapeDisplayLabel,
  tapeVisualSizeQuote,
} from "./orderbook.js?v=26-84-readable-flow-smooth-charts-v1";
import { upsertLiveCandleInPlace } from "./chart.js?v=26-84-readable-flow-smooth-charts-v1";

const trade = (id, eventTime, receivedAt, price, side, quote) => ({
  id,
  firstTradeId: id,
  lastTradeId: id,
  time: receivedAt,
  receivedAt,
  tradeTime: eventTime,
  eventTime,
  price,
  quantity: quote / price,
  quote,
  side,
});

test("SERIES displays a sum but keeps the visual size of its largest child AGG", () => {
  const aggregates = aggregateTapeZeroMs([
    trade(1, 1_000, 9_000, 100, "buy", 2_000),
    trade(2, 1_010, 9_010, 101, "buy", 8_000),
    trade(3, 1_020, 9_020, 102, "buy", 4_000),
  ]);
  const series = aggregateTapeSweeps(aggregates, { tick: 1 })[0];
  assert.equal(series.quote, 14_000);
  assert.equal(series.peakAggregateQuote, 8_000);
  assert.equal(tapeVisualSizeQuote(series, "sweep"), 8_000);
  assert.equal(tapeDisplayLabel(series, "sweep"), "Σ14K");
  assert.equal(tapeDisplayLabel(aggregates[1], "agg"), "8.0K");
});

test("dense AGG windows keep markers but bound overlapping text labels", () => {
  const window = { startTime: 0, endTime: 2_000, duration: 2_000, plotRight: 240 };
  const projected = Array.from({ length: 50 }, (_, index) => ({
    source: {
      key: `agg-${index}`,
      time: 1_000 + index,
      timeOrdinal: index,
      quote: 100_000 - index,
      showLabel: true,
      status: index === 49 ? "open" : "sealed",
    },
    position: { y: 50 + (index % 3) },
  }));
  const keys = selectTapeLabelKeys(projected, window, 240, () => 28, { mode: "agg", forceLabels: true });
  assert.ok(keys.size > 0);
  assert.ok(keys.size <= 4);
  assert.ok(keys.has("agg-49"));
});

test("live chart candles update in place without copying the full history", () => {
  const candles = [{ time: 1_000, open: 1, high: 2, low: 1, close: 2, volume: 1 }];
  const identity = candles;
  upsertLiveCandleInPlace(candles, { time: 1_000, open: 1, high: 3, low: 1, close: 3, volume: 2 }, 10);
  assert.equal(candles, identity);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].close, 3);
  upsertLiveCandleInPlace(candles, { time: 2_000, open: 3, high: 4, low: 3, close: 4, volume: 1 }, 10);
  assert.equal(candles.length, 2);
});

test("hidden timezone map no longer performs exact-second marker scans", () => {
  const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /if \(!els\.timeZoneDialog\?\.open\) return/);
  assert.match(app, /minuteKey === timeZoneClockMinuteKey/);
  assert.doesNotMatch(app, /setInterval\(updateClock,\s*1000\)/);
  assert.match(app, /requestAnimationFrame\(\(\) => \{\s*updateClock/);
});

test("KlineFeed coalesces live data and throttles full-array cache copies", () => {
  const chart = fs.readFileSync(new URL("./chart.js", import.meta.url), "utf8");
  assert.match(chart, /upsertLiveCandleInPlace\(this\.candles, candle/);
  assert.match(chart, /#scheduleLiveEmit\(/);
  assert.match(chart, /#scheduleSeriesCacheFlush\(/);
  assert.match(chart, /this\.cacheFlushTimer = setTimeout/);
});
''', encoding="utf-8")

print(f"Applied {NEW_BUILD}")
