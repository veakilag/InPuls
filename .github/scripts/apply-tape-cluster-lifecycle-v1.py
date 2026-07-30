from pathlib import Path
import re

OLD_BUILD = "26-67-orderbook-static-tape-navigation-v1"
NEW_BUILD = "26-68-tape-cluster-lifecycle-v1"
OLD_TAPE_LAYOUT = "stable-tape-v3"
NEW_TAPE_LAYOUT = "stable-tape-v4"


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


# 1. Tape X layout: coordinates never depend on neighbouring/new items.
path = "orderbook-tape-layout.js"
text = read(path)
static_layout = r'''export function buildReadableTapeLayout(items, window, width) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const leftEdge = 1;
  const rightEdge = Math.max(
    leftEdge,
    Math.min(Number(window?.plotRight) || safeWidth, safeWidth) - 1,
  );
  const ordered = (items ?? [])
    .map((item, sequenceIndex) => ({
      ...item,
      sequenceIndex,
      baseX: timeToX(item.lastTime ?? item.time, window, safeWidth),
    }))
    .sort((left, right) => (
      Number(left.lastTime ?? left.time) - Number(right.lastTime ?? right.time)
      || left.sequenceIndex - right.sequenceIndex
    ));
  if (!ordered.length) return [];

  // Density may change marker size, but never rewrites historical coordinates.
  // This removes the former neighbour-dependent spreading that made old trades
  // jump whenever a new execution entered the same collision group.
  const bandSize = Math.max(1, TAPE_READABLE_LAYOUT.clusterGapPx);
  const densityByBand = new Map();
  for (const item of ordered) {
    const band = Math.round(item.baseX / bandSize);
    densityByBand.set(band, (densityByBand.get(band) || 0) + 1);
  }

  return ordered.map(({ sequenceIndex, baseX, ...item }) => {
    const band = Math.round(baseX / bandSize);
    return {
      ...item,
      x: clamp(baseX, leftEdge, rightEdge),
      density: densityByBand.get(band) || 1,
      yOffset: 0,
    };
  });
}'''
text = regex_once(
    text,
    r'export function buildReadableTapeLayout\(items, window, width\) \{[\s\S]*?\n\}\n\nexport function adaptiveRawDiameter',
    static_layout + "\n\nexport function adaptiveRawDiameter",
    "static Tape layout",
)
write(path, text)


# 2. Tape runtime: deterministic AGG, synchronized opaque canvas, age button.
path = "orderbook.js"
text = read(path)
text = replace_once(
    text,
    '''  const percent = ((level - current) / current) * 100;
  const absolute = Math.abs(percent);
  const digits = absolute >= 10 ? 1 : absolute >= 1 ? 2 : 3;
  return `${absolute.toFixed(digits)}%`;''',
    '''  const percent = Math.abs(((level - current) / current) * 100);
  return `${percent.toFixed(1)}%`;''',
    "one-decimal distance marker",
)
text = replace_once(
    text,
    'const TAPE_MODE_KEY = "inpuls-tape-mode-v2";\n',
    '''const TAPE_MODE_KEY = "inpuls-tape-mode-v2";
const TAPE_AGG_LEVEL_KEY = "inpuls-tape-aggregation-level-v1";
const DENSITY_AGE_VISIBLE_KEY = "inpuls-density-age-visible-v1";
export const TAPE_AGGREGATION_LEVELS = Object.freeze([
  Object.freeze({ label: "×1", bucketMs: 180, priceSteps: 1 }),
  Object.freeze({ label: "×2", bucketMs: 360, priceSteps: 1 }),
  Object.freeze({ label: "×4", bucketMs: 720, priceSteps: 2 }),
  Object.freeze({ label: "×8", bucketMs: 1_440, priceSteps: 4 }),
  Object.freeze({ label: "×16", bucketMs: 2_880, priceSteps: 8 }),
]);
''',
    "aggregation constants",
)
text = replace_once(
    text,
    '''    .orderbook-card .trade-flow .book-hover-percent {
      position: absolute !important;
      z-index: 12 !important;
      right: 2px !important;
      left: auto !important;
      transform: translateY(-50%) !important;
      pointer-events: none !important;
      white-space: nowrap;
    }''',
    '''    .orderbook-card .trade-flow .book-hover-percent {
      position: absolute !important;
      z-index: 12 !important;
      right: 1px !important;
      left: auto !important;
      width: 34px !important;
      height: 18px !important;
      box-sizing: border-box;
      display: grid !important;
      place-items: center;
      padding: 0 !important;
      border-radius: 2px !important;
      transform: translateY(-50%) !important;
      pointer-events: none !important;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }''',
    "square distance marker",
)
text = replace_once(
    text,
    '''    .orderbook-card .inpuls-tape-mode.is-active {
      color: #42e1ad;
      border-color: rgba(66, 225, 173, .48);
      background: rgba(66, 225, 173, .09);
    }''',
    '''    .orderbook-card .inpuls-tape-mode.is-active {
      color: #42e1ad;
      border-color: rgba(66, 225, 173, .48);
      background: rgba(66, 225, 173, .09);
    }
    .orderbook-card .inpuls-agg-step {
      width: 22px;
      min-width: 22px;
      height: 22px;
      padding: 0;
      border-radius: 4px;
      font-weight: 900;
    }
    .orderbook-card .inpuls-agg-step:disabled {
      opacity: .28;
      cursor: default;
    }
    .orderbook-card .inpuls-density-age-toggle {
      min-width: 38px;
      height: 18px;
      padding: 0 4px;
      border: 1px solid var(--line-soft);
      border-radius: 4px;
      background: var(--panel-2);
      color: var(--muted);
      font: 800 8px/1 Inter, system-ui, sans-serif;
      cursor: pointer;
    }
    .orderbook-card .inpuls-density-age-toggle.is-active {
      color: #5de1b5;
      border-color: rgba(93, 225, 181, .45);
      background: rgba(45, 179, 132, .1);
    }
    .orderbook-card .book-size[data-density-age]::after {
      content: attr(data-density-age);
      position: absolute;
      z-index: 3;
      right: 2px;
      top: 50%;
      transform: translateY(-50%);
      min-width: 27px;
      padding: 1px 3px;
      border: 1px solid rgba(224, 235, 239, .28);
      border-radius: 3px;
      background: rgba(4, 8, 11, .82);
      color: #e7f0f3;
      font: 800 7px/1 Inter, system-ui, sans-serif;
      text-align: center;
      font-variant-numeric: tabular-nums;
      pointer-events: none;
    }''',
    "aggregation and density age styles",
)

sync_functions = r'''function aggregationLevel(state) {
  const index = Math.max(
    0,
    Math.min(
      TAPE_AGGREGATION_LEVELS.length - 1,
      Math.floor(Number(state?.aggLevelIndex) || 0),
    ),
  );
  return { index, ...TAPE_AGGREGATION_LEVELS[index] };
}

function syncTapeModeButton(button, state) {
  const aggregated = state.mode === "agg";
  const level = aggregationLevel(state);
  button.textContent = aggregated ? `AGG ${level.label}` : "RAW";
  button.classList.toggle("is-active", aggregated);
  button.setAttribute("aria-pressed", String(aggregated));
  button.title = aggregated
    ? `Фиксированные бакеты ${level.bucketMs} мс · цена ×${level.priceSteps}. Позиция прошлых агрегатов не меняется.`
    : "Каждое исполнение отображается отдельно по точному времени";
  state.controls?.querySelectorAll?.("[data-inpuls-agg-step]").forEach((control) => {
    control.disabled = !aggregated;
  });
}

function formatObservedAge(value) {
  const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}с`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}м${String(seconds).padStart(2, "0")}с`;
  const hours = Math.floor(minutes / 60);
  return `${hours}ч${String(minutes % 60).padStart(2, "0")}м`;
}

function decorateDensityAges(card, state = tapeCardStates.get(card)) {
  const rows = [...card.querySelectorAll(".orderbook-rows .book-ladder-row")];
  for (const row of rows) row.querySelector(".book-size")?.removeAttribute("data-density-age");
  if (!state?.densityAgeVisible) return;
  const symbol = cardSymbol(card);
  const data = symbol ? latestBookDataBySymbol.get(symbol) : null;
  const densities = data?.densityLifecycle?.densities;
  if (!Array.isArray(densities) || !densities.length) return;
  const step = Math.max(Number.EPSILON, runtimePriceStep(card) || 0);
  const now = Date.now();
  for (const row of rows) {
    if (!row.classList.contains("is-anomaly")) continue;
    const price = parseRuntimeNumber(row.querySelector("strong")?.textContent);
    const side = row.classList.contains("is-ask") ? "ask" : "bid";
    if (!Number.isFinite(price)) continue;
    const matches = densities.filter((density) => (
      density?.side === side
      && Number.isFinite(Number(density?.price))
      && Math.abs(Number(density.price) - price) <= Math.max(Number.EPSILON, step * .55)
    ));
    if (!matches.length) continue;
    matches.sort((left, right) => Number(right.currentQuote) - Number(left.currentQuote));
    const density = matches[0];
    const observedAt = Number(density.firstObservedAt);
    const age = Number.isFinite(observedAt)
      ? Math.max(0, now - observedAt)
      : Math.max(0, Number(density.ageMs) || 0);
    const size = row.querySelector(".book-size");
    if (size) {
      size.dataset.densityAge = formatObservedAge(age);
      size.title = `Наблюдаемый возраст плотности ${formatObservedAge(age)} · ${density.state || "active"}`;
    }
  }
}

function syncDensityAgeButton(button, state, card) {
  if (!button) return;
  button.classList.toggle("is-active", state.densityAgeVisible);
  button.setAttribute("aria-pressed", String(state.densityAgeVisible));
  button.title = state.densityAgeVisible
    ? "Скрыть наблюдаемый возраст аномальных плотностей"
    : "Показать наблюдаемый возраст аномальных плотностей";
  card.classList.toggle("is-density-age-visible", state.densityAgeVisible);
}
'''
text = regex_once(
    text,
    r'function syncTapeModeButton\(button, state\) \{[\s\S]*?\n\}\n\nfunction syncLayerButtons',
    sync_functions + "\nfunction syncLayerButtons",
    "Tape mode and density functions",
)
text = replace_once(
    text,
    '''      mode: localStorage.getItem(TAPE_MODE_KEY) === "agg" ? "agg" : "raw",
      minQuote: savedMinimum === null ? 0 : Math.max(0, Number(savedMinimum) || 0),''',
    '''      mode: localStorage.getItem(TAPE_MODE_KEY) === "agg" ? "agg" : "raw",
      aggLevelIndex: Math.max(0, Math.min(
        TAPE_AGGREGATION_LEVELS.length - 1,
        Math.floor(Number(localStorage.getItem(TAPE_AGG_LEVEL_KEY)) || 0),
      )),
      densityAgeVisible: localStorage.getItem(DENSITY_AGE_VISIBLE_KEY) === "1",
      minQuote: savedMinimum === null ? 0 : Math.max(0, Number(savedMinimum) || 0),''',
    "Tape state settings",
)
text = replace_once(
    text,
    '''      lastSymbol: null,
      hasFrame: false,''',
    '''      lastSymbol: null,
      hasFrame: false,
      lastRenderSignature: null,''',
    "Tape render signature state",
)
text = replace_once(
    text,
    'state.context = canvas.getContext("2d", { alpha: true, desynchronized: true });',
    'state.context = canvas.getContext("2d", { alpha: false, desynchronized: false });',
    "synchronized opaque Tape canvas",
)
text = replace_once(
    text,
    '''      <button data-inpuls-tape-mode class="inpuls-tape-mode" type="button"></button>`;''',
    '''      <button data-inpuls-agg-step="down" class="inpuls-agg-step" type="button" title="Меньше агрегация">−</button>
      <button data-inpuls-tape-mode class="inpuls-tape-mode" type="button"></button>
      <button data-inpuls-agg-step="up" class="inpuls-agg-step" type="button" title="Больше агрегация">+</button>`;''',
    "aggregation controls markup",
)
text = replace_once(
    text,
    '''    modeButton.addEventListener("click", () => {
      state.mode = state.mode === "agg" ? "raw" : "agg";
      localStorage.setItem(TAPE_MODE_KEY, state.mode);
      syncTapeModeButton(modeButton, state);
      scheduleTapeDraw(true, card);
    });
    syncTapeModeButton(modeButton, state);''',
    '''    modeButton.addEventListener("click", () => {
      state.mode = state.mode === "agg" ? "raw" : "agg";
      localStorage.setItem(TAPE_MODE_KEY, state.mode);
      syncTapeModeButton(modeButton, state);
      scheduleTapeDraw(true, card);
    });
    controls.querySelectorAll("[data-inpuls-agg-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const direction = button.dataset.inpulsAggStep === "up" ? 1 : -1;
        state.aggLevelIndex = Math.max(0, Math.min(
          TAPE_AGGREGATION_LEVELS.length - 1,
          state.aggLevelIndex + direction,
        ));
        state.mode = "agg";
        localStorage.setItem(TAPE_MODE_KEY, state.mode);
        localStorage.setItem(TAPE_AGG_LEVEL_KEY, String(state.aggLevelIndex));
        syncTapeModeButton(modeButton, state);
        scheduleTapeDraw(true, card);
      });
    });
    syncTapeModeButton(modeButton, state);''',
    "aggregation control handlers",
)
# Insert lifetime button into the same action row as AUTO/manual controls.
text = replace_once(
    text,
    '''  syncLayerButtons(card, state);

  const rows = card.querySelector(".orderbook-rows");''',
    '''  syncLayerButtons(card, state);

  const bookActions = card.querySelector(".inpuls-book-pane-actions");
  if (bookActions) {
    let densityButton = bookActions.querySelector("[data-inpuls-density-age]");
    if (!densityButton) {
      densityButton = document.createElement("button");
      densityButton.type = "button";
      densityButton.className = "inpuls-density-age-toggle";
      densityButton.dataset.inpulsDensityAge = "1";
      densityButton.textContent = "ВОЗР";
      bookActions.append(densityButton);
      densityButton.addEventListener("click", () => {
        state.densityAgeVisible = !state.densityAgeVisible;
        localStorage.setItem(DENSITY_AGE_VISIBLE_KEY, state.densityAgeVisible ? "1" : "0");
        syncDensityAgeButton(densityButton, state, card);
        decorateDensityAges(card, state);
      });
    }
    syncDensityAgeButton(densityButton, state, card);
  }
  decorateDensityAges(card, state);

  const rows = card.querySelector(".orderbook-rows");''',
    "density age button",
)
text = replace_once(
    text,
    '''  latestBookDataBySymbol.set(symbol, data);
  scheduleLiquidityForSymbol(symbol);''',
    '''  latestBookDataBySymbol.set(symbol, data);
  scheduleLiquidityForSymbol(symbol);
  requestAnimationFrame(() => {
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      if (cardSymbol(card) === symbol) decorateDensityAges(card);
    });
  });''',
    "density age refresh on book data",
)

agg_impl = r'''export function aggregateTapeBuckets(trades, priceStep = .01, levelIndex = 0, window = null) {
  const level = TAPE_AGGREGATION_LEVELS[Math.max(
    0,
    Math.min(TAPE_AGGREGATION_LEVELS.length - 1, Math.floor(Number(levelIndex) || 0)),
  )];
  const baseStep = Math.max(Number.EPSILON, Number(priceStep) || .01);
  const aggregateStep = baseStep * level.priceSteps;
  const buckets = new Map();
  for (const trade of trades ?? []) {
    const time = Number(trade?.time);
    const price = Number(trade?.price);
    const quote = Number(trade?.quote);
    if (![time, price, quote].every(Number.isFinite) || quote <= 0) continue;
    if (window && (time < window.startTime || time > window.endTime)) continue;
    const bucketStart = Math.floor(time / level.bucketMs) * level.bucketMs;
    const priceIndex = Math.round(price / aggregateStep);
    const key = `agg:${level.label}:${bucketStart}:${priceIndex}`;
    const item = buckets.get(key) ?? {
      key,
      time: bucketStart + level.bucketMs / 2,
      lastTime: bucketStart + level.bucketMs / 2,
      price: Number((priceIndex * aggregateStep).toPrecision(15)),
      quote: 0,
      buyQuote: 0,
      sellQuote: 0,
      count: 0,
      bucketStart,
      bucketMs: level.bucketMs,
    };
    item.quote += quote;
    item[trade.side === "sell" ? "sellQuote" : "buyQuote"] += quote;
    item.count += 1;
    buckets.set(key, item);
  }
  return [...buckets.values()].sort((left, right) => (
    left.time - right.time || left.price - right.price || left.key.localeCompare(right.key)
  ));
}

function aggregateTapeBurstsContinuous(trades, rows, window, step, levelIndex = 0) {
  return aggregateTapeBuckets(trades, step, levelIndex, window)
    .map((burst) => {
      const position = tapePricePosition(rows, burst.price);
      return position ? { ...burst, row: position } : null;
    })
    .filter(Boolean)
    .slice(-TAPE_MAX_AGG_VISIBLE);
}'''
text = regex_once(
    text,
    r'function aggregateTapeBurstsContinuous\(trades, rows, window, step\) \{[\s\S]*?\n\}',
    agg_impl,
    "deterministic Tape aggregation",
)
text = replace_once(
    text,
    '''  const items = state.mode === "agg"
    ? aggregateTapeBurstsContinuous(recent, rows, window, step)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : rawTapeItemsContinuous(rawCandidates, rows, window);

  const candidates = state.mode === "agg"
    ? aggregateTradeBursts(recent, minQuote, step, 180, 1)
    : rawCandidates;''',
    '''  const aggregatedCandidates = state.mode === "agg"
    ? aggregateTapeBuckets(recent, step, state.aggLevelIndex, window)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : [];
  const items = state.mode === "agg"
    ? aggregateTapeBurstsContinuous(recent, rows, window, step, state.aggLevelIndex)
        .filter((item) => passesTapeFilter(item, minQuote, 0))
    : rawTapeItemsContinuous(rawCandidates, rows, window);

  const candidates = state.mode === "agg" ? aggregatedCandidates : rawCandidates;''',
    "deterministic aggregate candidates",
)
# Add render signature before repaint; same input never repaints the canvas.
text = replace_once(
    text,
    '''  if (!recent.length) {
    paintTapeSurface(context, rect);''',
    '''  const latestTrade = recent[0];
  const rowSignature = rows.map((row) => `${row.price}:${row.y.toFixed(2)}:${row.height.toFixed(2)}`).join("|");
  const renderSignature = [
    symbol,
    state.mode,
    state.aggLevelIndex,
    state.minQuote,
    pixelWidth,
    pixelHeight,
    latestTrade ? tapeTradeKey(latestTrade) : "empty",
    window.startTime,
    window.endTime,
    rowSignature,
    frozen ? "frozen" : "live",
  ].join("::");
  if (state.hasFrame && state.lastRenderSignature === renderSignature) {
    decorateDensityAges(card, state);
    skip("unchanged-frame");
    return;
  }
  state.lastRenderSignature = renderSignature;

  if (!recent.length) {
    paintTapeSurface(context, rect);''',
    "Tape unchanged-frame signature",
)
text = replace_once(
    text,
    '''    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    state.hasFrame = false;''',
    '''    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    state.hasFrame = false;
    state.lastRenderSignature = null;''',
    "reset Tape signature on resize",
)
# Force draws invalidate only the target signature; periodic status no longer redraws canvas.
text = replace_once(
    text,
    '''  if (force) {
    tapeLastDrawAt = 0;''',
    '''  if (force) {
    if (card?.isConnected) {
      const state = tapeCardStates.get(card);
      if (state) state.lastRenderSignature = null;
    } else {
      document.querySelectorAll(".orderbook-card").forEach((target) => {
        const state = tapeCardStates.get(target);
        if (state) state.lastRenderSignature = null;
      });
    }
    tapeLastDrawAt = 0;''',
    "force draw signature reset",
)
text = replace_once(
    text,
    '''  tapeStateTimer = setInterval(() => {
    if (!tapeDocumentHidden) {
      scanTapeCards(document);
      scheduleTapeDraw();
    }
  }, TAPE_STATE_REFRESH_MS);''',
    '''  tapeStateTimer = setInterval(() => {
    if (tapeDocumentHidden) return;
    scanTapeCards(document);
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      const state = tapeCardStates.get(card);
      if (!state) return;
      decorateDensityAges(card, state);
      const symbol = cardSymbol(card);
      const suffix = staleTradeSuffix(symbol);
      if (suffix) setTapeState(state, `НЕТ НОВЫХ СДЕЛОК${suffix}`, "attention");
      else if (state.status?.textContent?.startsWith("НЕТ НОВЫХ СДЕЛОК")) setTapeState(state, "");
    });
  }, TAPE_STATE_REFRESH_MS);''',
    "status-only periodic refresh",
)
write(path, text)


# 3. Footprint: chart-equivalent intervals, deterministic exchange buckets and favourites.
path = "orderbook-flow-workspace.js"
text = read(path)
text = replace_once(
    text,
    '''export const FOOTPRINT_TIMEFRAMES = Object.freeze([60_000, 5 * 60_000]);
const FOOTPRINT_TIMEFRAME_KEY = "inpuls-footprint-timeframe-v1";
const FLOW_LAYER_VISIBILITY_EVENT = "inpuls:flow-layer-visibility";
const FOOTPRINT_MINUTE_MS = 60_000;
const FOOTPRINT_RETAIN_MINUTES = 30;''',
    '''export const FOOTPRINT_TIMEFRAMES = Object.freeze([
  "1s", "5s", "15s", "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "12h", "1d", "3d", "1w", "1M",
]);
const FOOTPRINT_TIMEFRAME_KEY = "inpuls-footprint-timeframe-v2";
const FOOTPRINT_FAVORITES_KEY = "inpuls-footprint-favorite-timeframes-v1";
const FLOW_LAYER_VISIBILITY_EVENT = "inpuls:flow-layer-visibility";
const FOOTPRINT_BASE_BUCKET_MS = 1_000;
const FOOTPRINT_RETAIN_MS = 30 * 60_000;
const FOOTPRINT_INTERVAL_MS = Object.freeze({
  "1s": 1_000, "5s": 5_000, "15s": 15_000,
  "1m": 60_000, "3m": 180_000, "5m": 300_000,
  "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000,
  "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000,
});
const FOOTPRINT_DEFAULT_FAVORITES = Object.freeze(["1m", "5m", "15m"]);''',
    "footprint interval constants",
)

interval_core = r'''export function normalizeFootprintTimeframe(value) {
  const text = String(value ?? "");
  if (FOOTPRINT_TIMEFRAMES.includes(text)) return text;
  const legacy = Number(value);
  if (legacy === 60_000) return "1m";
  if (legacy === 300_000) return "5m";
  return "1m";
}

export function footprintIntervalStart(time, timeframeValue = "1m") {
  const at = Number(time) || Date.now();
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  if (timeframe === "1M") {
    const date = new Date(at);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  if (timeframe === "1w") {
    const week = FOOTPRINT_INTERVAL_MS[timeframe];
    const mondayEpoch = 4 * 86_400_000;
    return Math.floor((at - mondayEpoch) / week) * week + mondayEpoch;
  }
  const duration = FOOTPRINT_INTERVAL_MS[timeframe] || 60_000;
  return Math.floor(at / duration) * duration;
}

export function shiftFootprintInterval(startTime, timeframeValue, amount) {
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  const shift = Math.trunc(Number(amount) || 0);
  if (timeframe === "1M") {
    const date = new Date(Number(startTime));
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + shift, 1);
  }
  return Number(startTime) + (FOOTPRINT_INTERVAL_MS[timeframe] || 60_000) * shift;
}

export function footprintIntervalEnd(startTime, timeframeValue = "1m") {
  return shiftFootprintInterval(startTime, timeframeValue, 1);
}

export function createFootprintAccumulator() {
  return { seconds: new Map(), firstObservedAt: null, lastObservedAt: null };
}

function footprintSecondBucket(accumulator, startTime) {
  const bucket = accumulator.seconds.get(startTime) ?? {
    startTime,
    endTime: startTime + FOOTPRINT_BASE_BUCKET_MS,
    count: 0,
    quote: 0,
    firstTradeTime: Infinity,
    lastTradeTime: -Infinity,
    openPrice: null,
    closePrice: null,
    highPrice: null,
    lowPrice: null,
    cells: new Map(),
  };
  accumulator.seconds.set(startTime, bucket);
  return bucket;
}

function pruneFootprintAccumulator(accumulator, referenceTime = Date.now()) {
  const cutoff = Number(referenceTime) - FOOTPRINT_RETAIN_MS;
  for (const startTime of accumulator.seconds.keys()) {
    if (startTime < cutoff || startTime > Number(referenceTime) + FOOTPRINT_BASE_BUCKET_MS) {
      accumulator.seconds.delete(startTime);
    }
  }
}

export function ingestFootprintTrades(accumulator, incoming, { replace = false } = {}) {
  const target = accumulator?.seconds instanceof Map ? accumulator : createFootprintAccumulator();
  if (replace) {
    target.seconds.clear();
    target.firstObservedAt = null;
    target.lastObservedAt = null;
  }
  let latestTime = 0;
  for (const rawTrade of incoming ?? []) {
    const trade = normalizeFlowTrade(rawTrade);
    if (!trade) continue;
    latestTime = Math.max(latestTime, trade.time);
    target.firstObservedAt = target.firstObservedAt === null
      ? trade.time
      : Math.min(target.firstObservedAt, trade.time);
    target.lastObservedAt = target.lastObservedAt === null
      ? trade.time
      : Math.max(target.lastObservedAt, trade.time);
    const startTime = Math.floor(trade.time / FOOTPRINT_BASE_BUCKET_MS) * FOOTPRINT_BASE_BUCKET_MS;
    const bucket = footprintSecondBucket(target, startTime);
    const priceKey = Number(trade.price).toPrecision(15);
    const cell = bucket.cells.get(priceKey) ?? {
      price: trade.price,
      buyQuote: 0,
      sellQuote: 0,
      quote: 0,
      count: 0,
    };
    cell[trade.side === "sell" ? "sellQuote" : "buyQuote"] += trade.quote;
    cell.quote += trade.quote;
    cell.count += 1;
    bucket.cells.set(priceKey, cell);
    bucket.quote += trade.quote;
    bucket.count += 1;
    if (trade.time < bucket.firstTradeTime) {
      bucket.firstTradeTime = trade.time;
      bucket.openPrice = trade.price;
    }
    if (trade.time >= bucket.lastTradeTime) {
      bucket.lastTradeTime = trade.time;
      bucket.closePrice = trade.price;
    }
    bucket.highPrice = bucket.highPrice === null ? trade.price : Math.max(bucket.highPrice, trade.price);
    bucket.lowPrice = bucket.lowPrice === null ? trade.price : Math.min(bucket.lowPrice, trade.price);
  }
  pruneFootprintAccumulator(target, latestTime || Date.now());
  return target;
}

function footprintSnapshotAt(accumulator, timeframeValue, startTime, now) {
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  const endTime = footprintIntervalEnd(startTime, timeframe);
  const cells = new Map();
  let count = 0;
  let quote = 0;
  let firstTradeTime = Infinity;
  let lastTradeTime = -Infinity;
  let openPrice = null;
  let closePrice = null;
  let highPrice = null;
  let lowPrice = null;
  for (const bucket of accumulator?.seconds?.values?.() ?? []) {
    if (bucket.startTime < startTime || bucket.startTime >= endTime) continue;
    count += bucket.count;
    quote += bucket.quote;
    if (Number.isFinite(bucket.firstTradeTime) && bucket.firstTradeTime < firstTradeTime) {
      firstTradeTime = bucket.firstTradeTime;
      openPrice = bucket.openPrice;
    }
    if (Number.isFinite(bucket.lastTradeTime) && bucket.lastTradeTime >= lastTradeTime) {
      lastTradeTime = bucket.lastTradeTime;
      closePrice = bucket.closePrice;
    }
    if (Number.isFinite(bucket.highPrice)) highPrice = highPrice === null ? bucket.highPrice : Math.max(highPrice, bucket.highPrice);
    if (Number.isFinite(bucket.lowPrice)) lowPrice = lowPrice === null ? bucket.lowPrice : Math.min(lowPrice, bucket.lowPrice);
    for (const source of bucket.cells.values()) {
      const priceKey = Number(source.price).toPrecision(15);
      const cell = cells.get(priceKey) ?? { price: source.price, buyQuote: 0, sellQuote: 0, quote: 0, count: 0 };
      cell.buyQuote += source.buyQuote;
      cell.sellQuote += source.sellQuote;
      cell.quote += source.quote;
      cell.count += source.count;
      cells.set(priceKey, cell);
    }
  }
  const firstObservedAt = Number(accumulator?.firstObservedAt);
  return {
    timeframe,
    startTime,
    endTime,
    partial: Number(now) < endTime,
    sessionPartial: !Number.isFinite(firstObservedAt) || firstObservedAt > startTime + FOOTPRINT_BASE_BUCKET_MS,
    count,
    quote,
    openPrice,
    closePrice,
    highPrice,
    lowPrice,
    cells: [...cells.values()].sort((left, right) => right.price - left.price),
  };
}

export function footprintIntervalSnapshot(accumulator, timeframeValue = "1m", now = Date.now()) {
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  const startTime = footprintIntervalStart(now, timeframe);
  return footprintSnapshotAt(accumulator, timeframe, startTime, now);
}

export function footprintIntervalHistory(
  accumulator,
  timeframeValue = "1m",
  now = Date.now(),
  limit = FOOTPRINT_MAX_VISIBLE_COLUMNS,
  offset = 0,
) {
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  const maximum = Math.max(1, Math.min(FOOTPRINT_MAX_VISIBLE_COLUMNS, Math.floor(Number(limit) || 1)));
  const starts = [...(accumulator?.seconds?.keys?.() ?? [])].map(Number).filter(Number.isFinite);
  const currentStart = footprintIntervalStart(now, timeframe);
  const earliestStart = starts.length
    ? footprintIntervalStart(Math.min(...starts), timeframe)
    : currentStart;
  const latestOffset = footprintHistoryOffsetLimit(accumulator, timeframe, now);
  const safeOffset = Math.min(latestOffset, Math.max(0, Math.floor(Number(offset) || 0)));
  let cursor = shiftFootprintInterval(currentStart, timeframe, -safeOffset);
  const reversed = [];
  while (reversed.length < maximum && cursor >= earliestStart) {
    reversed.push(footprintSnapshotAt(accumulator, timeframe, cursor, now));
    cursor = shiftFootprintInterval(cursor, timeframe, -1);
  }
  return reversed.reverse();
}

export function footprintHistoryOffsetLimit(accumulator, timeframeValue = "1m", now = Date.now()) {
  const starts = [...(accumulator?.seconds?.keys?.() ?? [])].map(Number).filter(Number.isFinite);
  if (!starts.length) return 0;
  const timeframe = normalizeFootprintTimeframe(timeframeValue);
  const earliest = footprintIntervalStart(Math.min(...starts), timeframe);
  let cursor = footprintIntervalStart(now, timeframe);
  let count = 0;
  while (cursor > earliest && count < 10_000) {
    cursor = shiftFootprintInterval(cursor, timeframe, -1);
    count += 1;
  }
  return count;
}
'''
text = regex_once(
    text,
    r'export function footprintIntervalStart[\s\S]*?\nconst footprintBySymbol = new Map\(\);',
    interval_core + "\nconst footprintBySymbol = new Map();",
    "footprint exchange interval core",
)
# Add favourites helpers before theme functions.
fav_helpers = r'''function footprintTimeframeLabel(value) {
  return normalizeFootprintTimeframe(value)
    .replace("1M", "1мес")
    .replace("s", "с")
    .replace("m", "м")
    .replace("h", "ч")
    .replace("d", "д")
    .replace("w", "н");
}

function readFootprintFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOOTPRINT_FAVORITES_KEY) || "null");
    const values = Array.isArray(parsed) ? parsed : FOOTPRINT_DEFAULT_FAVORITES;
    const normalized = [...new Set(values.map(normalizeFootprintTimeframe))]
      .filter((item) => FOOTPRINT_TIMEFRAMES.includes(item))
      .sort((left, right) => FOOTPRINT_TIMEFRAMES.indexOf(left) - FOOTPRINT_TIMEFRAMES.indexOf(right));
    return normalized.length ? normalized.slice(0, 6) : [...FOOTPRINT_DEFAULT_FAVORITES];
  } catch {
    return [...FOOTPRINT_DEFAULT_FAVORITES];
  }
}

function saveFootprintFavorites(values) {
  localStorage.setItem(FOOTPRINT_FAVORITES_KEY, JSON.stringify(values));
}

function renderFootprintTimeframeControls(pane, state) {
  const favorites = readFootprintFavorites();
  const root = pane.querySelector("[data-footprint-favorites]");
  const menu = pane.querySelector("[data-footprint-menu]");
  if (root) {
    root.innerHTML = favorites.map((timeframe) => (
      `<button type="button" data-footprint-select="${timeframe}" class="${timeframe === state.timeframeMs ? "is-active" : ""}" aria-pressed="${timeframe === state.timeframeMs}">${footprintTimeframeLabel(timeframe)}</button>`
    )).join("");
  }
  if (menu) {
    menu.innerHTML = FOOTPRINT_TIMEFRAMES.map((timeframe) => {
      const favorite = favorites.includes(timeframe);
      return `<div><button type="button" data-footprint-select="${timeframe}" class="${timeframe === state.timeframeMs ? "is-active" : ""}">${footprintTimeframeLabel(timeframe)}</button><button type="button" data-footprint-favorite="${timeframe}" aria-label="${favorite ? "Убрать из избранного" : "Добавить в избранное"}">${favorite ? "★" : "☆"}</button></div>`;
    }).join("");
  }
}
'''
text = replace_once(
    text,
    'function footprintTheme() {',
    fav_helpers + '\nfunction footprintTheme() {',
    "footprint favourites helpers",
)
# Toolbar styles and popover.
text = replace_once(
    text,
    '''    .orderbook-card .inpuls-footprint-toolbar strong {
      margin-left: auto;
      color: var(--muted);
      white-space: nowrap;
    }''',
    '''    .orderbook-card .inpuls-footprint-toolbar strong {
      margin-left: auto;
      color: var(--muted);
      white-space: nowrap;
    }
    .orderbook-card .inpuls-footprint-favorites {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
      overflow: hidden;
    }
    .orderbook-card .inpuls-footprint-more { flex: 0 0 auto; }
    .orderbook-card .inpuls-footprint-menu {
      position: absolute;
      z-index: 20;
      top: 22px;
      left: 4px;
      display: grid;
      grid-template-columns: repeat(2, minmax(70px, 1fr));
      gap: 2px;
      width: min(210px, calc(100% - 8px));
      max-height: 210px;
      overflow: auto;
      padding: 4px;
      border: 1px solid var(--line);
      border-radius: 5px;
      background: color-mix(in srgb, var(--panel) 98%, #000);
      box-shadow: 0 8px 22px rgba(0,0,0,.48);
    }
    .orderbook-card .inpuls-footprint-menu[hidden] { display: none !important; }
    .orderbook-card .inpuls-footprint-menu > div {
      display: grid;
      grid-template-columns: 1fr 24px;
      gap: 2px;
    }
    .orderbook-card .inpuls-footprint-menu button { min-width: 0; }''',
    "footprint menu styles",
)
text = replace_once(
    text,
    '''    <div class="inpuls-footprint-toolbar">
      <button type="button" data-footprint-timeframe="60000" class="is-active" aria-pressed="true">1М</button>
      <button type="button" data-footprint-timeframe="300000" aria-pressed="false">5М</button>
      <strong data-footprint-navigation>LIVE</strong>
    </div>''',
    '''    <div class="inpuls-footprint-toolbar">
      <span class="inpuls-footprint-favorites" data-footprint-favorites></span>
      <button type="button" class="inpuls-footprint-more" data-footprint-more aria-expanded="false" title="Все таймфреймы и избранное">⋯</button>
      <div class="inpuls-footprint-menu" data-footprint-menu hidden></div>
      <strong data-footprint-navigation>LIVE</strong>
    </div>''',
    "footprint toolbar markup",
)
text = replace_once(
    text,
    '''    timeframeMs: FOOTPRINT_TIMEFRAMES.includes(
      Number(localStorage.getItem(FOOTPRINT_TIMEFRAME_KEY)),
    )
      ? Number(localStorage.getItem(FOOTPRINT_TIMEFRAME_KEY))
      : FOOTPRINT_TIMEFRAMES[0],''',
    '''    timeframeMs: normalizeFootprintTimeframe(localStorage.getItem(FOOTPRINT_TIMEFRAME_KEY) || "1m"),''',
    "footprint saved timeframe",
)
text = regex_once(
    text,
    r'  const syncTimeframes = \(\) => \{[\s\S]*?  syncTimeframes\(\);',
    '''  const syncTimeframes = () => renderFootprintTimeframeControls(pane, state);
  pane.querySelector(".inpuls-footprint-toolbar").addEventListener("click", (event) => {
    const select = event.target.closest("[data-footprint-select]");
    const favorite = event.target.closest("[data-footprint-favorite]");
    const more = event.target.closest("[data-footprint-more]");
    const menu = pane.querySelector("[data-footprint-menu]");
    if (more) {
      const open = menu?.hidden !== false;
      if (menu) menu.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
      return;
    }
    if (favorite) {
      const timeframe = normalizeFootprintTimeframe(favorite.dataset.footprintFavorite);
      const favorites = readFootprintFavorites();
      const next = favorites.includes(timeframe)
        ? favorites.filter((item) => item !== timeframe)
        : [...favorites, timeframe]
            .sort((left, right) => FOOTPRINT_TIMEFRAMES.indexOf(left) - FOOTPRINT_TIMEFRAMES.indexOf(right))
            .slice(0, 6);
      saveFootprintFavorites(next.length ? next : [timeframe]);
      syncTimeframes();
      return;
    }
    if (select) {
      state.timeframeMs = normalizeFootprintTimeframe(select.dataset.footprintSelect);
      state.historyOffset = 0;
      localStorage.setItem(FOOTPRINT_TIMEFRAME_KEY, state.timeframeMs);
      if (menu) menu.hidden = true;
      pane.querySelector("[data-footprint-more]")?.setAttribute("aria-expanded", "false");
      syncTimeframes();
      state.hasFrame = false;
      requestDraw(card);
    }
  });
  syncTimeframes();''',
    "footprint timeframe menu handlers",
)
# Mapping to intervals now uses string; mark session partial visibly.
text = replace_once(
    text,
    '''    navigation.textContent = state.historyOffset > 0
      ? `−${state.historyOffset}`
      : "LIVE";''',
    '''    const sessionPartial = intervals.some((interval) => interval.sessionPartial);
    navigation.textContent = state.historyOffset > 0
      ? `−${state.historyOffset}${sessionPartial ? " · P" : ""}`
      : `LIVE${sessionPartial ? " · PARTIAL" : ""}`;
    navigation.title = sessionPartial
      ? "Кластеры выровнены по биржевым свечам, но поток до открытия InPuls отсутствует"
      : "Кластеры полностью наблюдались в текущей сессии";''',
    "footprint data completeness state",
)
text = replace_once(
    text,
    '''        `${formatIntervalClock(interval.startTime)}${interval.partial ? " · LIVE" : ""}`,''',
    '''        `${formatIntervalClock(interval.startTime)}${interval.partial ? " · LIVE" : ""}${interval.sessionPartial ? " · P" : ""}`,''',
    "footprint partial label",
)
# Old accumulator property references in tests/runtime are gone after core replacement.
write(path, text)


# 4. Add focused tests.
test_path = Path("test-tape-cluster-lifecycle-v1.mjs")
test_path.write_text(r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildReadableTapeLayout } from "./orderbook-tape-layout.js";
import {
  TAPE_AGGREGATION_LEVELS,
  aggregateTapeBuckets,
  bookDistancePercentLabel,
} from "./orderbook.js";
import {
  FOOTPRINT_TIMEFRAMES,
  createFootprintAccumulator,
  footprintIntervalHistory,
  footprintIntervalStart,
  ingestFootprintTrades,
} from "./orderbook-flow-workspace.js";

const runtime = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");

test("historical Tape X coordinates do not depend on newly appended neighbours", () => {
  const window = { startTime: 0, endTime: 1_000, duration: 1_000, plotRight: 500 };
  const first = [{ key: "a", time: 100 }, { key: "b", time: 101 }];
  const before = buildReadableTapeLayout(first, window, 500);
  const after = buildReadableTapeLayout([...first, { key: "c", time: 102 }], window, 500);
  assert.equal(after.find((item) => item.key === "a").x, before.find((item) => item.key === "a").x);
  assert.equal(after.find((item) => item.key === "b").x, before.find((item) => item.key === "b").x);
});

test("deterministic AGG keeps closed bucket identity and coordinates", () => {
  const trades = [
    { time: 1_010, price: 100.01, quote: 10, side: "buy" },
    { time: 1_090, price: 100.02, quote: 20, side: "sell" },
  ];
  const first = aggregateTapeBuckets(trades, .01, 2)[0];
  const next = aggregateTapeBuckets([...trades, { time: 4_000, price: 101, quote: 15, side: "buy" }], .01, 2)
    .find((item) => item.key === first.key);
  assert.equal(next.time, first.time);
  assert.equal(next.price, first.price);
  assert.equal(next.key, first.key);
  assert.equal(TAPE_AGGREGATION_LEVELS.length, 5);
});

test("distance badge is unsigned and fixed to tenths", () => {
  assert.equal(bookDistancePercentLabel(101, 100), "1.0%");
  assert.equal(bookDistancePercentLabel(99.75, 100), "0.3%");
  assert.equal(bookDistancePercentLabel(100, 100), "0.0%");
});

test("footprint exposes the same timeframe set and exchange-aligned boundaries", () => {
  assert.deepEqual(FOOTPRINT_TIMEFRAMES, [
    "1s", "5s", "15s", "1m", "3m", "5m", "15m", "30m",
    "1h", "2h", "4h", "12h", "1d", "3d", "1w", "1M",
  ]);
  assert.equal(footprintIntervalStart(Date.UTC(2026, 6, 30, 12, 34, 56), "5m"), Date.UTC(2026, 6, 30, 12, 30, 0));
  assert.equal(footprintIntervalStart(Date.UTC(2026, 6, 30), "1M"), Date.UTC(2026, 6, 1));
  assert.equal(new Date(footprintIntervalStart(Date.UTC(2026, 6, 30), "1w")).getUTCDay(), 1);
});

test("first cluster candle is aligned but explicitly marked session-partial", () => {
  const accumulator = ingestFootprintTrades(createFootprintAccumulator(), [
    { id: 1, time: Date.UTC(2026, 6, 30, 12, 34, 20), price: 100, quantity: 1, quote: 100, side: "buy" },
  ]);
  const history = footprintIntervalHistory(accumulator, "5m", Date.UTC(2026, 6, 30, 12, 34, 30), 3, 0);
  assert.equal(history.at(-1).startTime, Date.UTC(2026, 6, 30, 12, 30, 0));
  assert.equal(history.at(-1).sessionPartial, true);
});

test("runtime ships aggregation controls, synchronized canvas and density age toggle", () => {
  assert.match(runtime, /desynchronized: false/);
  assert.match(runtime, /data-inpuls-agg-step/);
  assert.match(runtime, /data-inpuls-density-age/);
  assert.match(runtime, /densityLifecycle\?\.densities/);
  assert.match(workspace, /data-footprint-favorite/);
  assert.match(workspace, /LIVE\$\{sessionPartial \? " · PARTIAL"/);
});
''', encoding="utf-8")

# Update existing fixed percentage assertions.
path = "test/orderbook.test.js"
text = read(path)
text = text.replace('assert.equal(bookDistancePercentLabel(101, 100), "1.00%");', 'assert.equal(bookDistancePercentLabel(101, 100), "1.0%");')
text = text.replace('assert.equal(bookDistancePercentLabel(99.75, 100), "0.250%");', 'assert.equal(bookDistancePercentLabel(99.75, 100), "0.3%");')
text = text.replace('assert.equal(bookDistancePercentLabel(100, 100), "0.000%");', 'assert.equal(bookDistancePercentLabel(100, 100), "0.0%");')
write(path, text)

# Runtime/cache version is atomic across app shell and tests.
for file in Path(".").rglob("*"):
    if not file.is_file() or ".git" in file.parts:
        continue
    if file.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".md", ".json"}:
        continue
    try:
        content = file.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    updated = content.replace(OLD_BUILD, NEW_BUILD).replace(OLD_TAPE_LAYOUT, NEW_TAPE_LAYOUT)
    if updated != content:
        file.write_text(updated, encoding="utf-8")

version = read("VERSION.txt")
feature = "static-tape-x-v2, deterministic-agg-levels-v1, exchange-aligned-footprint-v2, footprint-timeframe-favorites-v1, density-observed-age-v1"
if feature not in version:
    version = version.rstrip() + ", " + feature + "\n"
write("VERSION.txt", version)
