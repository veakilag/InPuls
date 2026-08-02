from pathlib import Path

BUILD = "26-97-smooth-chart-first-v1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing patch target: {label}")
    return text.replace(old, new, 1)


chart_path = Path("chart.js")
chart = chart_path.read_text(encoding="utf-8")

chart = replace_once(
    chart,
    """export function upsertCandle(candles, candle, limit = 180) {
  if (!candle || !Number.isFinite(candle.time)) return candles;
  const next = candles.slice();
  const last = next.at(-1);
  if (last?.time === candle.time) next[next.length - 1] = candle;
  else if (!last || candle.time > last.time) next.push(candle);
  else {
    const index = next.findIndex((item) => item.time === candle.time);
    if (index >= 0) next[index] = candle;
  }
  return next.slice(-limit);
}
""",
    """export function upsertCandle(candles, candle, limit = 180) {
  if (!candle || !Number.isFinite(candle.time)) return candles;
  const next = candles.slice();
  const last = next.at(-1);
  if (last?.time === candle.time) next[next.length - 1] = candle;
  else if (!last || candle.time > last.time) next.push(candle);
  else {
    const index = next.findIndex((item) => item.time === candle.time);
    if (index >= 0) next[index] = candle;
  }
  return next.slice(-limit);
}

export function upsertLiveCandleInPlace(candles, candle, limit = 180) {
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
}
""",
    "live candle helper",
)

chart = replace_once(
    chart,
    """    this.seriesCache = new Map();
    this.historyFlushTimer = null;
  }
""",
    """    this.seriesCache = new Map();
    this.historyFlushTimer = null;
    this.liveEmitHandle = null;
    this.liveEmitKind = null;
    this.pendingLiveMeta = null;
    this.cacheFlushTimer = null;
  }
""",
    "KlineFeed fields",
)

chart = replace_once(
    chart,
    """  destroy() {
    this.generation += 1;
    this.#cleanup();
  }
""",
    """  #scheduleLiveEmit(meta) {
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

  destroy() {
    this.generation += 1;
    this.#cleanup();
  }
""",
    "KlineFeed local scheduler",
)

chart = replace_once(
    chart,
    """        this.candles = upsertCandle(this.candles, candle, secondsMode ? 30_000 : 1500);
        this.seriesCache.set(`${this.symbol}:${this.interval}`, this.candles.slice());
        this.onData(this.candles, { symbol: this.symbol, interval: this.interval, range: this.range });
        if (secondsMode) this.#scheduleSecondHistorySave();
""",
    """        upsertLiveCandleInPlace(this.candles, candle, secondsMode ? 30_000 : 1_500);
        this.#scheduleSeriesCacheFlush();
        this.#scheduleLiveEmit({ symbol: this.symbol, interval: this.interval, range: this.range });
        if (secondsMode) this.#scheduleSecondHistorySave();
""",
    "live feed hot path",
)

chart = replace_once(
    chart,
    """  #cleanup() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.historyFlushTimer);
    this.abortController?.abort();
""",
    """  #cleanup() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.historyFlushTimer);
    clearTimeout(this.cacheFlushTimer);
    this.cacheFlushTimer = null;
    this.#cancelLiveEmit();
    this.abortController?.abort();
""",
    "KlineFeed cleanup",
)

chart_path.write_text(chart, encoding="utf-8")

app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")
app = replace_once(
    app,
    'from "./chart.js?v=23";',
    f'from "./chart.js?v={BUILD}";',
    "chart module cache key",
)

app = replace_once(
    app,
    """      if (this.trackedAggTrades.has(data.s)) {
        getSymbol(data.s, Number(data.E) || Date.now())?.updateBookTicker(data);
      }
      scheduleRender();
      return;
""",
    """      if (this.trackedAggTrades.has(data.s)) {
        getSymbol(data.s, Number(data.E) || Date.now())?.updateBookTicker(data);
      }
      // State stays current; the next miniTicker packet owns the expensive
      // market DOM refresh. Chart and Tape rendering are independent.
      return;
""",
    "bookTicker full render removal",
)

app = replace_once(
    app,
    """    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data) && this.trackedAggTrades.has(data.s)) {
      getSymbol(data.s)?.updateTrade(data);
      scheduleRender();
      return;
    }
""",
    """    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data) && this.trackedAggTrades.has(data.s)) {
      getSymbol(data.s)?.updateTrade(data);
      // Trade statistics update immediately without rebuilding every radar row.
      return;
    }
""",
    "aggTrade full render removal",
)

app = replace_once(
    app,
    """function scheduleRender() {
  if (scheduledMarketRender !== null) return;
  scheduledMarketRender = setTimeout(() => {
    scheduledMarketRender = null;
    render();
  }, 180);
}
""",
    """function scheduleRender() {
  if (scheduledMarketRender !== null) return;
  const run = () => {
    scheduledMarketRender = null;
    render();
  };
  if (typeof window.requestIdleCallback === "function") {
    scheduledMarketRender = window.requestIdleCallback(run, { timeout: 450 });
  } else {
    scheduledMarketRender = setTimeout(run, 180);
  }
}
""",
    "idle market render",
)

app = replace_once(
    app,
    """  const panel = { model, element: article, chart, feed: null };
  panel.feed = new KlineFeed({ onData: (candles, meta) => chart.setData(candles, meta), onStatus() {} });
""",
    """  const panel = { model, element: article, chart, feed: null };
  panel.feed = new KlineFeed({
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
  });
""",
    "extra chart live header",
)

app = replace_once(
    app,
    """function timeZoneClock(zone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat("ru-RU", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  } catch { return "--:--"; }
}
""",
    """const timeFormatterCache = new Map();
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
}
""",
    "clock formatter cache",
)

app = replace_once(
    app,
    """function updateTimeZoneClocks() {
  for (const marker of els.timeZoneMarkers?.querySelectorAll(".timezone-marker") ?? []) {
    const item = TIME_ZONE_CITIES.find((city) => city.zone === marker.dataset.zone && marker.getAttribute("aria-label")?.startsWith(city.city));
    if (item) marker.dataset.city = `${item.city} · ${timeZoneClock(item.zone)}`;
  }
  if (els.timeZoneDialog?.open) renderTimeZoneResults();
}
""",
    """let timeZoneClockMinuteKey = null;
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
}
""",
    "hidden timezone scan removal",
)

app = replace_once(
    app,
    """setInterval(render, 1000);
setInterval(updateTrackedSymbols, 15_000);
""",
    """// Rendering is event-driven. A fixed full-app rebuild on each exact second
// caused a visible main-thread stall in every open chart.
setInterval(updateTrackedSymbols, 15_000);
""",
    "global exact-second render removal",
)

app = replace_once(
    app,
    """function updateClock() {
  els.clock.textContent = new Intl.DateTimeFormat("ru-RU", {
    ...(state.timeZone === "local" ? {} : { timeZone: state.timeZone }),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
  updateTimeZoneClocks();
}
setInterval(updateClock, 1000);
updateClock();
render();
""",
    """let lastHeaderClockText = "";
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
scheduleClockTick();
render();
""",
    "lightweight clock tick",
)

app_path.write_text(app, encoding="utf-8")

index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
index = replace_once(
    index,
    './app.js?v=26-91-runtime-boot-cache-feed-v1',
    f'./app.js?v={BUILD}',
    "app entry cache key",
)
index_path.write_text(index, encoding="utf-8")

Path("test-smooth-chart-first-v1.mjs").write_text(r'''import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { upsertLiveCandleInPlace } from "./chart.js?v=26-97-smooth-chart-first-v1";

const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
const chart = fs.readFileSync(new URL("./chart.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");

test("live candles update in place instead of copying history per packet", () => {
  const candles = [{ time: 1_000, open: 1, high: 2, low: 1, close: 2, volume: 1 }];
  const identity = candles;
  upsertLiveCandleInPlace(candles, { time: 1_000, open: 1, high: 3, low: 1, close: 3, volume: 2 }, 10);
  assert.equal(candles, identity);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].close, 3);
  upsertLiveCandleInPlace(candles, { time: 2_000, open: 3, high: 4, low: 3, close: 4, volume: 1 }, 10);
  assert.equal(candles.length, 2);
});

test("KlineFeed coalesces live chart paints and throttles cache snapshots", () => {
  assert.match(chart, /upsertLiveCandleInPlace\(this\.candles, candle/);
  assert.match(chart, /#scheduleLiveEmit\(/);
  assert.match(chart, /requestAnimationFrame\(emit\)/);
  assert.match(chart, /#scheduleSeriesCacheFlush\(/);
  assert.match(chart, /}, 250\);/);
});

test("full application rendering is no longer tied to each exact second", () => {
  assert.doesNotMatch(app, /setInterval\(render,\s*1000\)/);
  assert.doesNotMatch(app, /updateTrade\(data\);\s*scheduleRender\(\)/);
  assert.doesNotMatch(app, /updateBookTicker\(data\);[\s\S]{0,120}scheduleRender\(\)/);
  assert.match(app, /requestIdleCallback\(run, \{ timeout: 450 \}\)/);
});

test("clock work avoids hidden timezone scans and cached modules are refreshed", () => {
  assert.match(app, /if \(!els\.timeZoneDialog\?\.open\) return/);
  assert.match(app, /const timeFormatterCache = new Map\(\)/);
  assert.doesNotMatch(app, /setInterval\(updateClock,\s*1000\)/);
  assert.match(html, /app\.js\?v=26-97-smooth-chart-first-v1/);
  assert.match(app, /chart\.js\?v=26-97-smooth-chart-first-v1/);
});
''', encoding="utf-8")

Path("docs/smooth-chart-first-v1.md").write_text(r'''# Smooth chart first

Build: `26-97-smooth-chart-first-v1`.

## Problem

A fixed `render()` of the whole application was running on every exact second. At the same time each live kline packet copied the complete candle history and immediately emitted another chart update. The combination produced a visible periodic stall in every open chart.

## Changes

- Remove the fixed one-second full application render.
- Do not rebuild the market DOM for tracked `bookTicker` and `aggTrade` packets.
- Schedule market-table refreshes during an idle browser slot.
- Update the current live candle in place.
- Coalesce live chart notifications to one callback per animation frame.
- Copy the candle cache no more than once per 250 ms.
- Cache clock formatters and skip timezone-map scans while the dialog is closed.
- Keep the price in each additional chart header updated directly from its own feed.

## Safety boundary

The change does not alter candle values, Binance streams, signal formulas, order-book sequencing, Tape data, workspace storage, or Signal Lab history. It changes only UI scheduling and allocation on the live chart path.
''', encoding="utf-8")
