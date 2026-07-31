from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ORDERBOOK = ROOT / "orderbook.js"
FOOTPRINT = ROOT / "orderbook-flow-workspace.js"
TEST_FILE = ROOT / "test-sweep-tape-clock-v1.mjs"
OLD_BUILD = "26-79-agg-center-tape-scale-settings-v1"
NEW_BUILD = "26-80-sweep-tape-clock-v1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, got {count}")
    return text.replace(old, new, 1)


def replace_regex(text: str, pattern: str, replacement, label: str, expected=None) -> str:
    updated, count = re.subn(pattern, replacement, text, flags=re.MULTILINE | re.DOTALL)
    if expected is not None and count != expected:
        raise RuntimeError(f"{label}: expected {expected} matches, got {count}")
    if expected is None and count < 1:
        raise RuntimeError(f"{label}: expected at least 1 match")
    return updated


text = ORDERBOOK.read_text(encoding="utf-8")

text = replace_once(
    text,
    'const TAPE_TIME_SCALE_DEFAULT = 100;\nconst DENSITY_AGE_VISIBLE_KEY = "inpuls-density-age-visible-v1";',
    'const TAPE_TIME_SCALE_DEFAULT = 100;\n'
    'export const TAPE_SWEEP_MAX_GAP_MS = 35;\n'
    'export const TAPE_SWEEP_MAX_REVERSE_TICKS = 1;\n'
    'const TAPE_TIMELINE_CACHE_LIMIT = 240;\n'
    'const DENSITY_AGE_VISIBLE_KEY = "inpuls-density-age-visible-v1";',
    "sweep constants",
)

text = replace_once(
    text,
    '''    .orderbook-card .inpuls-tape-mode {
      margin-left: auto;
      min-width: 42px;
      height: 22px;
      padding-inline: 7px;
      font-weight: 800;
      letter-spacing: .03em;
    }
    .orderbook-card .inpuls-tape-mode.is-active {
      color: #42e1ad;
      border-color: rgba(66, 225, 173, .48);
      background: rgba(66, 225, 173, .09);
    }''',
    '''    .orderbook-card .inpuls-tape-mode {
      margin-left: auto;
      min-width: 54px;
      height: 22px;
      padding-inline: 7px;
      font-weight: 800;
      letter-spacing: .03em;
    }
    .orderbook-card .inpuls-tape-mode.is-active {
      color: #42e1ad;
      border-color: rgba(66, 225, 173, .48);
      background: rgba(66, 225, 173, .09);
    }
    .orderbook-card .inpuls-tape-mode.is-sweep {
      color: #ffd27a;
      border-color: rgba(255, 210, 122, .58);
      background: rgba(255, 210, 122, .10);
    }''',
    "mode styles",
)

text = replace_once(
    text,
    '''function syncTapeModeButton(button, state) {
  const aggregated = state.mode === "agg";
  button.textContent = aggregated ? "AGG" : "RAW";
  button.classList.toggle("is-active", aggregated);
  button.setAttribute("aria-pressed", String(aggregated));
  const source = state.aggregationSource === "raw" ? "@trade RAW" : "@aggTrade fallback";
  button.dataset.aggregationSource = state.aggregationSource === "raw" ? "raw" : "agg";
  button.title = aggregated
    ? `AGG 0 мс · ${source}: объединяются последовательные исполнения с одинаковым биржевым временем и направлением. Текущий агрегат появляется сразу; история не пересчитывается.`
    : "Каждое исполнение отображается отдельно по стабильному @aggTrade-потоку";
}''',
    '''function syncTapeModeButton(button, state) {
  if (!button) return;
  const mode = state.mode === "agg" || state.mode === "sweep" ? state.mode : "raw";
  const source = state.aggregationSource === "raw" ? "@trade RAW" : "@aggTrade fallback";
  button.textContent = mode === "agg" ? "AGG" : mode === "sweep" ? "СЕРИЯ" : "RAW";
  button.classList.toggle("is-active", mode !== "raw");
  button.classList.toggle("is-sweep", mode === "sweep");
  button.setAttribute("aria-pressed", String(mode !== "raw"));
  button.dataset.mode = mode;
  button.dataset.aggregationSource = state.aggregationSource === "raw" ? "raw" : "agg";
  button.title = mode === "agg"
    ? `AGG 0 мс · ${source}: последовательные исполнения одного направления с одинаковым биржевым временем.`
    : mode === "sweep"
      ? `СЕРИЯ · ${source}: соседние AGG одной стороны объединяются при непрерывных ID, паузе до ${TAPE_SWEEP_MAX_GAP_MS} мс и обратном ходе не больше ${TAPE_SWEEP_MAX_REVERSE_TICKS} тика.`
      : "Каждое исполнение отображается отдельно по стабильному @aggTrade-потоку";
}''',
    "mode button",
)

text = replace_once(
    text,
    '''function decorateDensityAges(card, state = tapeCardStates.get(card)) {
  const rows = [...card.querySelectorAll(".orderbook-rows .book-ladder-row")];
  for (const row of rows) row.querySelector(".book-size")?.removeAttribute("data-density-age");
  if (!state?.densityAgeVisible) return;''',
    '''function clearDensityAges(card) {
  card.querySelectorAll(".orderbook-rows .book-size[data-density-age]").forEach((size) => {
    size.removeAttribute("data-density-age");
    size.removeAttribute("title");
  });
}

function decorateDensityAges(card, state = tapeCardStates.get(card)) {
  if (!state?.densityAgeVisible) {
    clearDensityAges(card);
    return;
  }
  const rows = [...card.querySelectorAll(".orderbook-rows .book-ladder-row")];
  for (const row of rows) row.querySelector(".book-size")?.removeAttribute("data-density-age");''',
    "density age fast path",
)

text = replace_once(
    text,
    '''  requestAnimationFrame(() => {
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      if (cardSymbol(card) === symbol) decorateDensityAges(card);
    });
  });''',
    '''  requestAnimationFrame(() => {
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      const state = tapeCardStates.get(card);
      if (cardSymbol(card) === symbol && state?.densityAgeVisible) decorateDensityAges(card, state);
    });
  });''',
    "density book update",
)

text = replace_once(
    text,
    '''    const savedMinimum = localStorage.getItem(TAPE_MIN_FILTER_KEY);
    const savedTimeScale = localStorage.getItem(TAPE_TIME_SCALE_KEY);
    state = {''',
    '''    const savedMinimum = localStorage.getItem(TAPE_MIN_FILTER_KEY);
    const savedTimeScale = localStorage.getItem(TAPE_TIME_SCALE_KEY);
    const savedMode = localStorage.getItem(TAPE_MODE_KEY);
    state = {''',
    "saved mode",
)

text = replace_once(
    text,
    '      mode: localStorage.getItem(TAPE_MODE_KEY) === "agg" ? "agg" : "raw",',
    '      mode: savedMode === "agg" || savedMode === "sweep" ? savedMode : "raw",',
    "state mode",
)

text = replace_once(
    text,
    '''      aggSourceBuckets: [],
      aggSnapshots: new Map(),
      recentRawScratch: [],
      finalizedAggScratch: [],
      closedAggScratch: [],
      candidateScratch: [],''',
    '''      aggSourceBuckets: [],
      aggSnapshots: new Map(),
      sweepSourceBuckets: [],
      sweepSnapshots: new Map(),
      recentRawScratch: [],
      finalizedAggScratch: [],
      closedAggScratch: [],
      finalizedSweepScratch: [],
      closedSweepScratch: [],
      candidateScratch: [],''',
    "sweep state",
)

text = replace_once(
    text,
    '''    modeButton.addEventListener("click", () => {
      state.mode = state.mode === "agg" ? "raw" : "agg";
      localStorage.setItem(TAPE_MODE_KEY, state.mode);
      syncTapeModeButton(modeButton, state);
      scheduleTapeDraw(true, card);
    });''',
    '''    modeButton.addEventListener("click", () => {
      state.mode = state.mode === "raw" ? "agg" : state.mode === "agg" ? "sweep" : "raw";
      localStorage.setItem(TAPE_MODE_KEY, state.mode);
      syncTapeModeButton(modeButton, state);
      scheduleTapeDraw(true, card);
    });''',
    "mode cycle",
)

text = replace_once(
    text,
    '''  }
  decorateDensityAges(card, state);

  const rows = card.querySelector(".orderbook-rows");''',
    '''  }

  const rows = card.querySelector(".orderbook-rows");''',
    "remove per-frame density decoration",
)

text = replace_regex(
    text,
    r'(?m)^(\s*)state\.aggSourceBuckets = \[\];\n\s*state\.aggSnapshots\?\.clear\?\.\(\);',
    lambda match: (
        f'{match.group(1)}state.aggSourceBuckets = [];\n'
        f'{match.group(1)}state.aggSnapshots?.clear?.();\n'
        f'{match.group(1)}state.sweepSourceBuckets = [];\n'
        f'{match.group(1)}state.sweepSnapshots?.clear?.();'
    ),
    "reset sweep state",
)

text = replace_once(
    text,
    '''  tapeStateTimer = setInterval(() => {
    if (tapeDocumentHidden) return;
    scanTapeCards(document);
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      const state = tapeCardStates.get(card);
      if (!state) return;
      decorateDensityAges(card, state);''',
    '''  tapeStateTimer = setInterval(() => {
    if (tapeDocumentHidden) return;
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      const state = tapeCardStates.get(card);
      if (!state) return;
      if (state.densityAgeVisible) decorateDensityAges(card, state);''',
    "second-boundary timer",
)

text = replace_once(
    text,
    '''function formatTapeClock(time) {
  const date = new Date(Number(time));
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function drawTapeTimeline(context, rect, window) {''',
    '''function formatTapeClock(time) {
  const date = new Date(Number(time));
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function cachedTapeClockLabel(state, time) {
  if (!(state.timelineLabelCache instanceof Map)) state.timelineLabelCache = new Map();
  let label = state.timelineLabelCache.get(time);
  if (!label) {
    label = formatTapeClock(time);
    state.timelineLabelCache.set(time, label);
  }
  while (state.timelineLabelCache.size > TAPE_TIMELINE_CACHE_LIMIT) {
    state.timelineLabelCache.delete(state.timelineLabelCache.keys().next().value);
  }
  return label;
}

function drawTapeTimeline(context, rect, window, state) {''',
    "timeline cache",
)

text = replace_once(
    text,
    '    context.fillText(formatTapeClock(time), x, rect.height - 5);',
    '    context.fillText(cachedTapeClockLabel(state, time), x, rect.height - 5);',
    "timeline cached labels",
)

text = replace_once(
    text,
    '''export function tapeSecondsForScale(width, scalePercent = TAPE_TIME_SCALE_DEFAULT) {''',
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
}

export function tapeSecondsForScale(width, scalePercent = TAPE_TIME_SCALE_DEFAULT) {''',
    "display clock",
)

text = replace_once(
    text,
    '''    const quantity = Number.isFinite(Number(trade.quantity)) && Number(trade.quantity) > 0
      ? Number(trade.quantity)
      : quote / price;
    const continues = current''',
    '''    const quantity = Number.isFinite(Number(trade.quantity)) && Number(trade.quantity) > 0
      ? Number(trade.quantity)
      : quote / price;
    const rawFirstId = trade.firstTradeId ?? trade.id;
    const rawLastId = trade.lastTradeId ?? trade.id;
    const firstTradeId = Number.isInteger(Number(rawFirstId)) ? Number(rawFirstId) : null;
    const lastTradeId = Number.isInteger(Number(rawLastId)) ? Number(rawLastId) : firstTradeId;
    const continues = current''',
    "aggregate ids",
)

text = replace_once(
    text,
    '''        eventTime,
        side,
        firstPrice: price,''',
    '''        eventTime,
        side,
        firstTradeId,
        lastTradeId,
        firstPrice: price,''',
    "aggregate id fields",
)

text = replace_once(
    text,
    '''    current.lastPrice = price;
    current.minPrice = Math.min(current.minPrice, price);''',
    '''    current.lastPrice = price;
    if (Number.isInteger(lastTradeId)) current.lastTradeId = lastTradeId;
    current.minPrice = Math.min(current.minPrice, price);''',
    "aggregate last id",
)

sweep_functions = r'''
function inferSweepTick(groups) {
  const prices = [];
  for (const group of groups ?? []) {
    for (const value of [group?.firstPrice, group?.lastPrice, group?.minPrice, group?.maxPrice]) {
      const price = Number(value);
      if (Number.isFinite(price) && price > 0) prices.push(price);
    }
  }
  const unique = [...new Set(prices)].sort((left, right) => left - right);
  let tick = Infinity;
  for (let index = 1; index < unique.length; index += 1) {
    const gap = unique[index] - unique[index - 1];
    if (gap > Number.EPSILON && gap < tick) tick = gap;
  }
  return Number.isFinite(tick) ? tick : 0;
}

export function aggregateTapeSweeps(
  groups,
  {
    maxGapMs = TAPE_SWEEP_MAX_GAP_MS,
    maxReverseTicks = TAPE_SWEEP_MAX_REVERSE_TICKS,
    tick = null,
  } = {},
) {
  const ordered = [...(groups ?? [])]
    .filter((group) => Number.isFinite(Number(group?.eventTime ?? group?.time)))
    .sort((left, right) => {
      const timeDelta = Number(left.eventTime ?? left.time) - Number(right.eventTime ?? right.time);
      if (timeDelta) return timeDelta;
      return Number(left.timeOrdinal) - Number(right.timeOrdinal);
    });
  const priceTick = Math.max(Number.EPSILON, Number(tick) || inferSweepTick(ordered) || Number.EPSILON);
  const allowedReverse = priceTick * Math.max(0, Number(maxReverseTicks) || 0) + Number.EPSILON;
  const groupsOut = [];
  const ordinalByTime = new Map();
  let current = null;

  const finish = () => {
    if (!current) return;
    current.vwapPrice = current.quantity > 0 ? current.quote / current.quantity : current.firstPrice;
    current.durationMs = Math.max(0, current.lastTime - current.firstTime);
    current.time = current.firstTime + current.durationMs / 2;
    current.eventTime = current.time;
    current.price = current.firstPrice;
    const ordinalKey = Math.round(current.time);
    current.timeOrdinal = ordinalByTime.get(ordinalKey) ?? 0;
    ordinalByTime.set(ordinalKey, current.timeOrdinal + 1);
    groupsOut.push(current);
    current = null;
  };

  for (const group of ordered) {
    const eventTime = Number(group.eventTime ?? group.time);
    const side = group.side === "sell" ? "sell" : "buy";
    const firstPrice = Number(group.firstPrice ?? group.price);
    const lastPrice = Number(group.lastPrice ?? group.price);
    const firstId = Number.isInteger(Number(group.firstTradeId)) ? Number(group.firstTradeId) : null;
    const lastId = Number.isInteger(Number(group.lastTradeId)) ? Number(group.lastTradeId) : firstId;
    const gap = current ? eventTime - current.lastTime : Infinity;
    const idsContinuous = !current
      || !Number.isInteger(current.lastTradeId)
      || !Number.isInteger(firstId)
      || firstId === current.lastTradeId + 1;
    const directionContinuous = !current || (side === "buy"
      ? firstPrice >= current.lastPrice - allowedReverse
      : firstPrice <= current.lastPrice + allowedReverse);
    const continues = current
      && current.side === side
      && gap >= 0
      && gap <= Math.max(0, Number(maxGapMs) || 0)
      && idsContinuous
      && directionContinuous;

    if (!continues) {
      finish();
      current = {
        key: `sweep:${eventTime}:${side}:${group.key}`,
        side,
        firstTime: eventTime,
        lastTime: Number(group.lastTime ?? eventTime),
        firstTradeId: firstId,
        lastTradeId: lastId,
        firstPrice,
        lastPrice,
        minPrice: Number(group.minPrice ?? firstPrice),
        maxPrice: Number(group.maxPrice ?? firstPrice),
        price: firstPrice,
        vwapPrice: firstPrice,
        quantity: 0,
        quote: 0,
        buyQuote: 0,
        sellQuote: 0,
        count: 0,
        aggregateCount: 0,
      };
    }

    current.lastTime = Number(group.lastTime ?? eventTime);
    current.lastPrice = lastPrice;
    if (Number.isInteger(lastId)) current.lastTradeId = lastId;
    current.minPrice = Math.min(current.minPrice, Number(group.minPrice ?? firstPrice));
    current.maxPrice = Math.max(current.maxPrice, Number(group.maxPrice ?? firstPrice));
    current.quantity += Number(group.quantity) || 0;
    current.quote += Number(group.quote) || 0;
    current.buyQuote += Number(group.buyQuote) || 0;
    current.sellQuote += Number(group.sellQuote) || 0;
    current.count += Number(group.count) || 0;
    current.aggregateCount += 1;
  }
  finish();
  return groupsOut;
}

export function materializeTapeSweeps(state, groups, output = []) {
  if (!(state.sweepSnapshots instanceof Map)) state.sweepSnapshots = new Map();
  output.length = 0;
  const lastIndex = Math.max(-1, (groups?.length ?? 0) - 1);
  for (let index = 0; index <= lastIndex; index += 1) {
    const group = groups[index];
    if (index === lastIndex) {
      output.push(Object.freeze({
        ...group,
        status: "open",
        showLabel: stableTapeQuoteStrength(group.quote) >= .52,
      }));
      continue;
    }
    let snapshot = state.sweepSnapshots.get(group.key);
    if (!snapshot) {
      snapshot = Object.freeze({
        ...group,
        status: "sealed",
        sealedAt: Number(groups[index + 1]?.firstTime ?? group.lastTime),
        showLabel: stableTapeQuoteStrength(group.quote) >= .52,
      });
      state.sweepSnapshots.set(group.key, snapshot);
    }
    output.push(snapshot);
  }
  while (state.sweepSnapshots.size > 1_200) {
    state.sweepSnapshots.delete(state.sweepSnapshots.keys().next().value);
  }
  return output;
}

'''
text = replace_once(
    text,
    'function aggregateVisibleRowClusters(trades, rows, window, minimumQuote = 0) {',
    sweep_functions + 'function aggregateVisibleRowClusters(trades, rows, window, minimumQuote = 0) {',
    "sweep aggregation functions",
)

text = replace_once(
    text,
    '''function projectWaterTapeNodes(nodes, viewport, output = []) {
  let count = 0;
  for (const source of nodes ?? []) {
    const slot = output[count] ?? { source: null, position: {} };
    const position = projectTapePriceInto(viewport, source.price, slot.position);''',
    '''function projectWaterTapeNodes(nodes, viewport, output = [], aggregateRange = false) {
  let count = 0;
  for (const source of nodes ?? []) {
    const slot = output[count] ?? { source: null, position: {} };
    const projectedPrice = aggregateRange
      ? aggregateVisibleLabelPrice(viewport, source)
      : Number(source.price);
    const position = projectTapePriceInto(viewport, projectedPrice, slot.position);''',
    "aggregate projection",
)

text = replace_once(
    text,
    '''export function aggregateStableX(baseX, ordinal, markerWidth, plotRight) {''',
    '''export function aggregateVisibleLabelPrice(viewport, item) {
  if (!viewport) return NaN;
  const minimum = Number(item?.minPrice);
  const maximum = Number(item?.maxPrice);
  const label = aggregateLabelPrice(item);
  const low = Number(viewport.lowPrice);
  const high = Number(viewport.highPrice);
  const step = Math.max(Number.EPSILON, Number(viewport.step) || 0);
  if (![minimum, maximum, label, low, high].every(Number.isFinite)) return NaN;
  if (maximum < low - step * .65 || minimum > high + step * .65) return NaN;
  return clampTape(label, low, high);
}

export function aggregateStableX(baseX, ordinal, markerWidth, plotRight) {''',
    "visible aggregate label",
)

text = replace_once(
    text,
    '''function aggregateLabelY(viewport, item, fallbackY) {
  const position = projectTapePrice(viewport, aggregateLabelPrice(item));
  return position ? position.y : fallbackY;
}

function drawAggregatePriceRange(''',
    '''function drawAggregateAnchor(context, baseX, x, y, stroke, openAggregate = false) {
  if (![baseX, x, y].every(Number.isFinite) || Math.abs(x - baseX) < 2) return;
  context.save();
  context.strokeStyle = stroke;
  context.globalAlpha = openAggregate ? .36 : .58;
  context.lineWidth = .65;
  context.beginPath();
  context.moveTo(baseX, y);
  context.lineTo(x, y);
  context.stroke();
  context.beginPath();
  context.arc(baseX, y, 1.2, 0, Math.PI * 2);
  context.fillStyle = stroke;
  context.fill();
  context.restore();
}

function drawAggregatePriceRange(''',
    "aggregate anchor",
)

text = replace_once(
    text,
    '''  const low = projectTapePrice(viewport, minimum);
  const high = projectTapePrice(viewport, maximum);
  if (!low || !high) return false;''',
    '''  const visibleMinimum = clampTape(minimum, Number(viewport.lowPrice), Number(viewport.highPrice));
  const visibleMaximum = clampTape(maximum, Number(viewport.lowPrice), Number(viewport.highPrice));
  if (visibleMaximum < Number(viewport.lowPrice) || visibleMinimum > Number(viewport.highPrice)) return false;
  const low = projectTapePrice(viewport, visibleMinimum);
  const high = projectTapePrice(viewport, visibleMaximum);
  if (!low || !high) return false;''',
    "clip aggregate range",
)

text = replace_once(
    text,
    '''  const aggregationInput = aggregationStored?.length ? aggregationStored : stored;
  state.aggSourceBuckets = aggregateTapeZeroMs(aggregationInput);''',
    '''  const aggregationInput = aggregationStored?.length ? aggregationStored : stored;
  state.aggSourceBuckets = aggregateTapeZeroMs(aggregationInput);
  state.sweepSourceBuckets = aggregateTapeSweeps(state.aggSourceBuckets);''',
    "refresh sweep model",
)

text = replace_once(
    text,
    '''  const endTime = advanceWaterTapeClock(
    state.clockEndTime,
    state.clockPerfAt,
    latestTime,
    meta.lastPacketPerfAt,
    perfNow,
    frozen,
  );''',
    '''  const endTime = advanceTapeDisplayClock(
    state.clockEndTime,
    state.clockPerfAt,
    Date.now(),
    perfNow,
  );''',
    "wall clock timeline",
)

text = replace_once(
    text,
    '''  const liveAggregates = visibleWaterTapeNodes(
    materializeZeroMsAggregates(
      state,
      state.aggSourceBuckets,
      state.finalizedAggScratch,
    ),
    window,
    state.closedAggScratch,
  );

  paintTapeSurface(context, rect);
  state.hasFrame = false;
  drawTapeTimeline(context, rect, window);''',
    '''  const liveAggregates = visibleWaterTapeNodes(
    materializeZeroMsAggregates(
      state,
      state.aggSourceBuckets,
      state.finalizedAggScratch,
    ),
    window,
    state.closedAggScratch,
  );
  const liveSweeps = visibleWaterTapeNodes(
    materializeTapeSweeps(
      state,
      state.sweepSourceBuckets,
      state.finalizedSweepScratch,
    ),
    window,
    state.closedSweepScratch,
  );

  paintTapeSurface(context, rect);
  state.hasFrame = false;
  drawTapeTimeline(context, rect, window, state);''',
    "draw sweep and timeline state",
)

text = replace_once(
    text,
    '  const sourceItems = state.mode === "agg" ? liveAggregates : recentRaw;',
    '  const sourceItems = state.mode === "sweep" ? liveSweeps : state.mode === "agg" ? liveAggregates : recentRaw;',
    "source mode",
)

text = replace_once(
    text,
    '''  const items = projectWaterTapeNodes(
    candidates,
    state.priceViewport,
    state.markerProjectionScratch,
  );''',
    '''  const items = projectWaterTapeNodes(
    candidates,
    state.priceViewport,
    state.markerProjectionScratch,
    state.mode !== "raw",
  );''',
    "marker projection",
)

text = replace_once(
    text,
    '''    setTapeState(state, state.mode === "agg" ? "Жду агрегированную сделку…" : "Жду сделку…");''',
    '''    setTapeState(
      state,
      state.mode === "sweep"
        ? "Жду серию агрессивных сделок…"
        : state.mode === "agg"
          ? "Жду агрегированную сделку…"
          : "Жду сделку…",
    );''',
    "empty mode state",
)

text = replace_once(
    text,
    '''    const projectedY = projected.position.y;
    const y = state.mode === "agg"
      ? aggregateLabelY(state.priceViewport, item, projectedY)
      : projectedY;''',
    '''    const y = projected.position.y;''',
    "stable aggregate y",
)

text = replace_once(
    text,
    '''    const showLabel = minQuote > 0 || Boolean(item.showLabel);
    const openAggregate = item.status === "open";
    const label = formatTapeUsd(item.quote);
    const diameter = clampTape(4 + strength * 6, 4, 12);''',
    '''    const showLabel = minQuote > 0 || Boolean(item.showLabel);
    const openAggregate = item.status === "open";
    const sweepMode = state.mode === "sweep";
    const label = formatTapeUsd(item.quote);
    const diameter = clampTape(4 + strength * 6 + (sweepMode ? 1.5 : 0), 4, sweepMode ? 14 : 12);''',
    "sweep marker dimensions",
)

text = text.replace(
    '''      drawAggregatePriceRange(
        context,
        state.priceViewport,''',
    '''      drawAggregateAnchor(context, baseX, x, y, stroke, openAggregate);
      drawAggregatePriceRange(
        context,
        state.priceViewport,''',
)
if text.count('drawAggregateAnchor(context, baseX, x, y, stroke, openAggregate);') != 2:
    raise RuntimeError("aggregate anchors: expected two render branches")

text = replace_once(
    text,
    '''    const height = clampTape(7 + strength * 6, 7, 14);
    const width = clampTape(measured + 9, 18, Math.min(84, rect.width * .26));''',
    '''    const height = clampTape(7 + strength * 6 + (sweepMode ? 1.5 : 0), 7, sweepMode ? 16 : 14);
    const width = clampTape(measured + 9 + (sweepMode ? 4 : 0), 18, Math.min(92, rect.width * .28));''',
    "sweep label dimensions",
)

text = replace_once(
    text,
    '''    context.lineWidth = 1;
    context.strokeStyle = stroke;''',
    '''    context.lineWidth = sweepMode ? 1.25 : 1;
    context.strokeStyle = stroke;''',
    "sweep label border",
)

ORDERBOOK.write_text(text, encoding="utf-8")

footprint = FOOTPRINT.read_text(encoding="utf-8")
footprint = replace_once(
    footprint,
    '  state.context.font = "800 7px Inter, system-ui, sans-serif";',
    '  state.context.font = "700 7px Arial, sans-serif";',
    "footprint base font",
)
footprint = replace_once(
    footprint,
    '''        state.context.fillStyle = theme.text;
        state.context.font = "850 6.7px Inter, system-ui, sans-serif";''',
    '''        state.context.fillStyle = theme.text;
        state.context.font = "700 7px Arial, sans-serif";''',
    "footprint size label font",
)
footprint = replace_once(
    footprint,
    '        state.context.font = "800 7px Inter, system-ui, sans-serif";',
    '        state.context.font = "700 7px Arial, sans-serif";',
    "footprint font restore",
)
FOOTPRINT.write_text(footprint, encoding="utf-8")

for path in ROOT.rglob("*"):
    if not path.is_file() or any(part in {".git", "node_modules"} for part in path.parts):
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".webmanifest"}:
        continue
    content = path.read_text(encoding="utf-8")
    if OLD_BUILD in content:
        path.write_text(content.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

version = (ROOT / "VERSION.txt").read_text(encoding="utf-8")
feature_suffix = ", sweep-series-v1, wall-clock-tape-v1, second-boundary-jank-fix-v1, anchored-aggregate-labels-v1, unified-footprint-size-labels-v1"
if "sweep-series-v1" not in version:
    version = version.rstrip() + feature_suffix + "\n"
    (ROOT / "VERSION.txt").write_text(version, encoding="utf-8")

TEST_FILE.write_text(r'''import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  TAPE_SWEEP_MAX_GAP_MS,
  aggregateTapeZeroMs,
  aggregateTapeSweeps,
  aggregateVisibleLabelPrice,
  advanceTapeDisplayClock,
} from "./orderbook.js?v=26-80-sweep-tape-clock-v1";

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

test("Sweep joins adjacent same-side AGG across milliseconds", () => {
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
  assert.equal(sweeps.length, 3);
  assert.equal(sweeps[0].aggregateCount, 4);
  assert.equal(sweeps[0].count, 4);
  assert.equal(sweeps[0].minPrice, 100);
  assert.equal(sweeps[0].maxPrice, 102);
  assert.equal(sweeps[0].durationMs, 40);
  assert.equal(sweeps[1].firstPrice, 99);
  assert.equal(sweeps[2].side, "sell");
});

test("Sweep breaks on ID gap and excessive pause", () => {
  const zero = aggregateTapeZeroMs([
    trade(10, 2_000, 10, "sell"),
    trade(12, 2_001, 9, "sell"),
    trade(13, 2_100, 8, "sell"),
  ]);
  const sweeps = aggregateTapeSweeps(zero);
  assert.equal(sweeps.length, 3);
});

test("Aggregate labels are clipped to visible price range and absent outside it", () => {
  const viewport = { lowPrice: 100, highPrice: 110, step: 1, lowY: 100, highY: 0, rowHeight: 10 };
  assert.equal(aggregateVisibleLabelPrice(viewport, { minPrice: 90, maxPrice: 104 }), 100);
  assert.equal(aggregateVisibleLabelPrice(viewport, { minPrice: 104, maxPrice: 108 }), 106);
  assert.ok(Number.isNaN(aggregateVisibleLabelPrice(viewport, { minPrice: 80, maxPrice: 90 })));
});

test("Tape display clock follows wall clock smoothly instead of last trade packets", () => {
  const first = advanceTapeDisplayClock(null, null, 10_000, 0);
  const second = advanceTapeDisplayClock(first, 0, 10_016, 16);
  const third = advanceTapeDisplayClock(second, 16, 10_032, 32);
  assert.equal(first, 10_000);
  assert.ok(second >= 10_015 && second <= 10_017);
  assert.ok(third >= second);
});

test("Runtime exposes RAW, AGG and SERIES without per-second card rescans", () => {
  const source = fs.readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
  assert.match(source, /mode === "raw" \? "agg" : state\.mode === "agg" \? "sweep" : "raw"/);
  assert.match(source, /button\.textContent = mode === "agg" \? "AGG" : mode === "sweep" \? "СЕРИЯ" : "RAW"/);
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
