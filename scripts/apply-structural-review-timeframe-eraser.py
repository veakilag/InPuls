from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# ---------------------------------------------------------------------------
# Shared chart: a candle owns its complete timeframe slot.
# ---------------------------------------------------------------------------
chart_path = ROOT / "chart.js"
chart = chart_path.read_text(encoding="utf-8")

old_helpers = '''export function candleCenterSlot(index) {
  return Number(index) + .5;
}

export function preserveViewFraction(nextAnchor, previousViewStart) {'''
new_helpers = '''export function candleCenterSlot(index) {
  return Number(index) + .5;
}

export function candleBodyWidthForStep(step, slotFill = .82) {
  const safeStep = Math.max(0, Number(step) || 0);
  const safeFill = Math.max(.1, Math.min(.95, Number(slotFill) || .82));
  return Math.max(1, safeStep * safeFill);
}

export function timeAtCandleSlot(candles, slot, intervalMs = 60_000) {
  if (!Array.isArray(candles) || !candles.length) return Date.now();
  const safeSlot = Number(slot);
  const safeInterval = Math.max(1, Number(intervalMs) || 60_000);
  if (!Number.isFinite(safeSlot)) return candles[0].time;
  const lower = Math.floor(safeSlot);
  const fraction = safeSlot - lower;
  if (lower < 0) return candles[0].time + safeSlot * safeInterval;
  if (lower >= candles.length - 1) {
    return candles.at(-1).time + (safeSlot - (candles.length - 1)) * safeInterval;
  }
  const start = Number(candles[lower]?.time);
  const end = Number(candles[lower + 1]?.time);
  const span = Number.isFinite(end - start) && end > start ? end - start : safeInterval;
  return start + fraction * span;
}

export function preserveViewFraction(nextAnchor, previousViewStart) {'''
if chart.count(old_helpers) != 1:
    raise RuntimeError("chart helper insertion point not found")
chart = chart.replace(old_helpers, new_helpers, 1)

old_time_at_index = '''  #timeAtIndex(index) {
    if (!this.candles.length) return Date.now();
    const rounded = Math.round(index);
    if (this.candles[rounded]) return this.candles[rounded].time;
    const interval = INTERVAL_MS[this.meta?.interval] ?? 60_000;
    if (rounded < 0) return this.candles[0].time + rounded * interval;
    return this.candles.at(-1).time + (rounded - this.candles.length + 1) * interval;
  }'''
new_time_at_index = '''  #timeAtIndex(index) {
    const interval = INTERVAL_MS[this.meta?.interval] ?? 60_000;
    return timeAtCandleSlot(this.candles, index, interval);
  }'''
if chart.count(old_time_at_index) != 1:
    raise RuntimeError("chart #timeAtIndex block not found")
chart = chart.replace(old_time_at_index, new_time_at_index, 1)

body_width_old = "const bodyWidth = Math.max(1, Math.min(8, step * 0.68));"
if chart.count(body_width_old) != 2:
    raise RuntimeError(f"expected two fixed candle width expressions, found {chart.count(body_width_old)}")
chart = chart.replace(body_width_old, "const bodyWidth = candleBodyWidthForStep(step);", 2)

erase_method_marker = '''  #loadDrawingStore() {'''
erase_method = '''  eraseDrawingAt(x, y, maximum = 14) {
    if (!this.layout || !this.drawings.length) return null;
    const point = { x: Number(x), y: Number(y) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const drawing = this.#drawingAt(point, Math.max(4, Number(maximum) || 14));
    if (!drawing) return null;
    const index = this.drawings.findIndex((item) => item.id === drawing.id);
    if (index < 0) return null;
    const [removed] = this.drawings.splice(index, 1);
    this.undoStack.push({ type: "delete", drawing: structuredClone(removed), index });
    this.#persistDrawings();
    this.#requestRender();
    return removed;
  }

  #loadDrawingStore() {'''
if chart.count(erase_method_marker) != 1:
    raise RuntimeError("chart erase method insertion point not found")
chart = chart.replace(erase_method_marker, erase_method, 1)
chart_path.write_text(chart, encoding="utf-8")


# ---------------------------------------------------------------------------
# Review page: parallel 1m history loading, progressive replay and eraser.
# ---------------------------------------------------------------------------
review_path = ROOT / "owner-signal-lab-structural-extremes-review.js"
review = review_path.read_text(encoding="utf-8")

review = review.replace(
    '  freehand: "Рисуй мышью прямо на графике. После отпускания рисунок сохранится в разметке.",',
    '  freehand: "Рисуй мышью прямо на графике. После отпускания рисунок сохранится в разметке.",\n'
    '  erase: "Кликни по ручной метке, линии или штриху карандаша. Алгоритмический луч отмечай инструментом «Лишний».",',
    1,
)
review = review.replace(
    '  "attacks",\n]);',
    '  "attacks",\n  "erase",\n]);',
    1,
)
review = review.replace(
    '        <button type="button" data-review-tool="freehand">✎ Карандаш</button>',
    '        <button type="button" data-review-tool="freehand">✎ Карандаш</button>\n'
    '        <button type="button" data-review-tool="erase">⌫ Ластик</button>',
    1,
)

utility_marker = '''const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
'''
utility_code = '''const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function fetchJsonWithRetry(url, signal, attempts = 4) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal, cache: "no-store" });
      if (response.ok) return await response.json();
      const retryable = response.status === 418 || response.status === 429 || response.status >= 500;
      if (!retryable) throw new Error(`Binance HTTP ${response.status}`);
      lastError = new Error(`Binance HTTP ${response.status}`);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      lastError = error;
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
    }
  }
  throw lastError ?? new Error("Binance request failed");
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(items.length, concurrency)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}
'''
if review.count(utility_marker) != 1:
    raise RuntimeError("review utility insertion point not found")
review = review.replace(utility_marker, utility_code, 1)

fetch_pattern = re.compile(
    r'async function fetchThirtyDays\(symbol, selectedTimeframe, endAt, signal\) \{.*?\n\}\n\nfunction algorithmAnnotationRows',
    re.S,
)
fetch_replacement = '''async function fetchThirtyDays(symbol, selectedTimeframe, endAt, signal, onProgress = null) {
  const intervalMs = INTERVAL_MS[selectedTimeframe];
  const startAt = endAt - THIRTY_DAYS_MS;
  const key = `${symbol}:${selectedTimeframe}:${Math.floor(endAt / intervalMs)}`;
  if (cache.has(key)) {
    onProgress?.({ completed: 1, total: 1, cached: true });
    return structuredClone(cache.get(key));
  }

  const pageSize = 1_500;
  const pageSpan = intervalMs * pageSize;
  const alignedStart = Math.floor(startAt / intervalMs) * intervalMs;
  const windows = [];
  for (let cursor = alignedStart; cursor <= endAt; cursor += pageSpan) {
    windows.push({
      startTime: cursor,
      endTime: Math.min(endAt, cursor + pageSpan - 1),
    });
  }
  if (!windows.length) throw new Error("Не удалось построить диапазон загрузки");

  let completed = 0;
  const concurrency = selectedTimeframe === "1m" ? 4 : 3;
  const pages = await mapWithConcurrency(windows, concurrency, async (window) => {
    const url = new URL(KLINES_ENDPOINT);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", selectedTimeframe);
    url.searchParams.set("startTime", String(Math.floor(window.startTime)));
    url.searchParams.set("endTime", String(Math.floor(window.endTime)));
    url.searchParams.set("limit", String(pageSize));
    const payload = await fetchJsonWithRetry(url, signal);
    const page = (Array.isArray(payload) ? payload : [])
      .map((row) => parseKline(row, endAt))
      .filter(Boolean);
    completed += 1;
    onProgress?.({ completed, total: windows.length, cached: false });
    return page;
  });

  const byTime = new Map();
  for (const page of pages) {
    for (const candle of page) {
      if (candle.time < startAt || candle.time > endAt) continue;
      byTime.set(candle.time, candle);
    }
  }
  const candles = [...byTime.values()].sort((left, right) => left.time - right.time);
  if (!candles.length) throw new Error("Binance не вернул закрытые свечи");

  const expectedFirst = Math.ceil(startAt / intervalMs) * intervalMs;
  const expectedLast = Math.floor(endAt / intervalMs) * intervalMs;
  const actualFirst = candles[0].time;
  const actualLast = candles.at(-1).time;
  const requestedSpan = Math.max(intervalMs, expectedLast - expectedFirst + intervalMs);
  const coveredSpan = Math.max(
    0,
    Math.min(expectedLast, actualLast) - Math.max(expectedFirst, actualFirst) + intervalMs,
  );
  const result = {
    candles,
    pages: windows.length,
    startAt,
    endAt,
    coverageRatio: Math.min(1, coveredSpan / requestedSpan),
    complete: actualFirst <= expectedFirst + intervalMs && actualLast >= expectedLast - intervalMs,
  };
  cache.set(key, result);
  while (cache.size > 12) cache.delete(cache.keys().next().value);
  return structuredClone(result);
}

async function replayEngineIncrementally(engine, candles, signal, onProgress = null) {
  const chunkSize = candles.length > 10_000 ? 2_000 : 5_000;
  for (let offset = 0; offset < candles.length; offset += chunkSize) {
    if (signal?.aborted) {
      const error = new Error("Aborted");
      error.name = "AbortError";
      throw error;
    }
    const end = Math.min(candles.length, offset + chunkSize);
    engine.ingestCandles(candles.slice(offset, end));
    onProgress?.({ completed: end, total: candles.length });
    if (end < candles.length) await nextFrame();
  }
}

function algorithmAnnotationRows'''
review, fetch_count = fetch_pattern.subn(fetch_replacement, review, count=1)
if fetch_count != 1:
    raise RuntimeError(f"fetchThirtyDays replacement count={fetch_count}")

hit_test_marker = '''function nearestAlgorithmExtreme(point) {'''
hit_test_code = '''function screenPointFor(time, price) {
  if (!chart.layout) return null;
  const index = candleIndexForTime(time);
  if (index < 0) return null;
  const { margins, plotWidth, plotHeight, minPrice, maxPrice } = chart.layout;
  return {
    x: margins.left + ((index + .5 - chart.viewStart) / chart.visibleCount) * plotWidth,
    y: margins.top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight,
  };
}

function distanceToSegment(point, start, end) {
  if (!start || !end) return Infinity;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const t = clamp(ratio, 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function correctionDistance(correction, point) {
  if (!chart.layout) return Infinity;
  const right = chart.layout.margins.left + chart.layout.plotWidth;
  const top = chart.layout.margins.top;
  const bottom = chart.layout.priceBottom;
  if (correction.type === "ADD_EXTREME") {
    const origin = screenPointFor(correction.time, correction.price);
    if (!origin) return Infinity;
    return point.x >= origin.x - 10 ? Math.abs(point.y - origin.y) : Math.hypot(point.x - origin.x, point.y - origin.y);
  }
  if (correction.type === "REMOVE_EXTREME") {
    const anchor = screenPointFor(correction.extremeAt, correction.price);
    return anchor ? Math.hypot(point.x - anchor.x, point.y - anchor.y) : Infinity;
  }
  if (correction.type === "MOVE_EXTREME") {
    const from = screenPointFor(correction.from?.time, correction.from?.price);
    const to = screenPointFor(correction.to?.time, correction.to?.price);
    return Math.min(
      distanceToSegment(point, from, to),
      from ? Math.hypot(point.x - from.x, point.y - from.y) : Infinity,
      to ? Math.hypot(point.x - to.x, point.y - to.y) : Infinity,
    );
  }
  if (correction.type === "CONFIRM_AT" || correction.type === "CROSS_AT") {
    const anchor = screenPointFor(correction.time, correction.price);
    if (!anchor || point.y < top || point.y > bottom) return Infinity;
    return Math.abs(point.x - anchor.x);
  }
  if (correction.type === "ATTACK_COUNT") {
    const origin = screenPointFor(correction.extremeAt, correction.price);
    if (!origin) return Infinity;
    return distanceToSegment(point, origin, { x: right, y: origin.y });
  }
  return Infinity;
}

function eraseManualMarkup(point) {
  const drawing = chart.eraseDrawingAt(point.x, point.y, 16);
  if (drawing) return { kind: "drawing", label: drawing.type };

  let best = { index: -1, distance: 18 };
  reviewCorrections.forEach((correction, index) => {
    const distance = correctionDistance(correction, point);
    if (distance <= best.distance) best = { index, distance };
  });
  if (best.index < 0) return null;
  const [removed] = reviewCorrections.splice(best.index, 1);
  return { kind: "correction", label: correctionDescription(removed) };
}

function nearestAlgorithmExtreme(point) {'''
if review.count(hit_test_marker) != 1:
    raise RuntimeError("review hit-test insertion point not found")
review = review.replace(hit_test_marker, hit_test_code, 1)

structured_click_marker = '''  if (reviewTool === "add-high" || reviewTool === "add-low") {'''
structured_click_code = '''  if (reviewTool === "erase") {
    const removed = eraseManualMarkup(point);
    if (!removed) {
      elements.status.dataset.state = "error";
      elements.status.textContent = "Ластик не попал в ручную метку или рисунок. Алгоритмический луч отмечай инструментом «Лишний».";
      return;
    }
    persistReviewState();
    updateAnnotations();
    chart.render();
    elements.status.dataset.state = "complete";
    elements.status.textContent = `Удалено: ${removed.label}`;
    return;
  }

  if (reviewTool === "add-high" || reviewTool === "add-low") {'''
if review.count(structured_click_marker) != 1:
    raise RuntimeError("structured review click marker not found")
review = review.replace(structured_click_marker, structured_click_code, 1)

old_fetch_call = '''      fetchThirtyDays(symbol, timeframe, endAt, abortController.signal),'''
new_fetch_call = '''      fetchThirtyDays(
        symbol,
        timeframe,
        endAt,
        abortController.signal,
        ({ completed, total, cached }) => {
          if (localGeneration !== generation) return;
          elements.status.textContent = cached
            ? `История ${symbol} · ${timeframe} взята из кэша…`
            : `Загружаю ${symbol} · ${timeframe}: пакет ${completed}/${total}…`;
        },
      ),'''
if review.count(old_fetch_call) != 1:
    raise RuntimeError("review fetch call not found")
review = review.replace(old_fetch_call, new_fetch_call, 1)

old_engine_replay = '''    const engine = new StructuralExtremeEngine({ symbol, timeframe, tickSize });
    engine.ingestCandles(loaded.candles);
    const snapshot = engine.snapshot();'''
new_engine_replay = '''    const engine = new StructuralExtremeEngine({ symbol, timeframe, tickSize });
    await replayEngineIncrementally(
      engine,
      loaded.candles,
      abortController.signal,
      ({ completed, total }) => {
        if (localGeneration !== generation) return;
        elements.status.textContent = `Анализирую ${symbol} · ${timeframe}: ${completed.toLocaleString("ru-RU")}/${total.toLocaleString("ru-RU")} свечей…`;
      },
    );
    if (localGeneration !== generation) return;
    const snapshot = engine.snapshot();'''
if review.count(old_engine_replay) != 1:
    raise RuntimeError("review engine replay block not found")
review = review.replace(old_engine_replay, new_engine_replay, 1)
review_path.write_text(review, encoding="utf-8")


# ---------------------------------------------------------------------------
# Tests.
# ---------------------------------------------------------------------------
chart_test_path = ROOT / "test/chart.test.js"
chart_test = chart_test_path.read_text(encoding="utf-8")
old_import = 'import { aggregateCandles, calculateNatr, candleCenterSlot, candleIndexAtSlot, drawingPercentChange, KlineFeed, maximumVisibleCandles, nicePriceStep, niceTimeTickStep, parseRestKline, parseStreamKline, pearsonCorrelation, preserveViewFraction, scaleFromDrag, sessionLabels, snapPointToCandle, snapPriceToCandle, upsertCandle, visibleCountFromDrag } from "../chart.js";'
new_import = 'import { aggregateCandles, calculateNatr, candleBodyWidthForStep, candleCenterSlot, candleIndexAtSlot, drawingPercentChange, KlineFeed, maximumVisibleCandles, nicePriceStep, niceTimeTickStep, parseRestKline, parseStreamKline, pearsonCorrelation, preserveViewFraction, scaleFromDrag, sessionLabels, snapPointToCandle, snapPriceToCandle, timeAtCandleSlot, upsertCandle, visibleCountFromDrag } from "../chart.js";'
if chart_test.count(old_import) != 1:
    raise RuntimeError("chart test import line not found")
chart_test = chart_test.replace(old_import, new_import, 1)

test_marker = '''test("screen density keeps at least one distinct pixel slot per rendered candle", () => {'''
new_tests = '''test("one candle occupies one complete timeframe slot", () => {
  const day = 86_400_000;
  const candles = [{ time: 0 }, { time: day }, { time: 2 * day }];
  assert.equal(timeAtCandleSlot(candles, 0, day), 0);
  assert.equal(timeAtCandleSlot(candles, .5, day), day / 2);
  assert.equal(timeAtCandleSlot(candles, 1, day), day);
  assert.equal(timeAtCandleSlot(candles, 1.5, day), day + day / 2);
});

test("candle body scales with its slot instead of a fixed eight-pixel cap", () => {
  assert.equal(candleBodyWidthForStep(100), 82);
  assert.equal(candleBodyWidthForStep(10), 8.2);
  assert.equal(candleBodyWidthForStep(1), 1);
});

test("screen density keeps at least one distinct pixel slot per rendered candle", () => {'''
if chart_test.count(test_marker) != 1:
    raise RuntimeError("chart test insertion marker not found")
chart_test = chart_test.replace(test_marker, new_tests, 1)
chart_test_path.write_text(chart_test, encoding="utf-8")

isolation_path = ROOT / "test/signal-lab-v7-structural-extremes-isolation.test.js"
isolation = isolation_path.read_text(encoding="utf-8")
isolation = isolation.replace(
    '    "freehand",\n  ]) {',
    '    "freehand",\n    "erase",\n  ]) {',
    1,
)
isolation = isolation.replace(
    '  assert.match(review, /elements\\.canvas\\.addEventListener\\("pointerdown", handleStructuredReviewClick, true\\)/);',
    '  assert.match(review, /elements\\.canvas\\.addEventListener\\("pointerdown", handleStructuredReviewClick, true\\)/);\n'
    '  assert.match(review, /mapWithConcurrency/);\n'
    '  assert.match(review, /replayEngineIncrementally/);\n'
    '  assert.match(review, /eraseDrawingAt/);',
    1,
)
isolation_path.write_text(isolation, encoding="utf-8")

print("Applied candle-slot, 1m loading and eraser fixes")
