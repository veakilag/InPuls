from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_KEY = "26-111-header-command-bar-v1"
NEW_KEY = "26-112-tape-series-v1"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


path = "orderbook.js"
text = read(path)

text = replace_once(
    text,
    'export const TAPE_AGGREGATION_PERIOD_MS = 0;\n',
    '''export const TAPE_AGGREGATION_PERIOD_MS = 0;\nexport const TAPE_SERIES_MAX_GAP_MS = 500;\nexport const TAPE_MODES = Object.freeze(["raw", "agg", "series"]);\n\nexport function normalizeTapeMode(value) {\n  const mode = String(value ?? "").toLowerCase();\n  return TAPE_MODES.includes(mode) ? mode : "raw";\n}\n\nexport function nextTapeMode(value) {\n  const mode = normalizeTapeMode(value);\n  return TAPE_MODES[(TAPE_MODES.indexOf(mode) + 1) % TAPE_MODES.length];\n}\n''',
    "insert Tape series constants",
)

old_sync = '''function syncTapeModeButton(button, state) {\n  const aggregated = state.mode === "agg";\n  button.textContent = aggregated ? "AGG" : "RAW";\n  button.classList.toggle("is-active", aggregated);\n  button.setAttribute("aria-pressed", String(aggregated));\n  const source = state.aggregationSource === "raw" ? "@trade RAW" : "@aggTrade fallback";\n  button.dataset.aggregationSource = state.aggregationSource === "raw" ? "raw" : "agg";\n  button.title = aggregated\n    ? `AGG 0 мс · ${source}: объединяются последовательные исполнения с одинаковым биржевым временем и направлением. Текущий агрегат появляется сразу; история не пересчитывается.`\n    : "Каждое исполнение отображается отдельно по стабильному @aggTrade-потоку";\n}\n'''
new_sync = '''function syncTapeModeButton(button, state) {\n  if (!button) return;\n  const mode = normalizeTapeMode(state.mode);\n  const source = state.aggregationSource === "raw" ? "@trade RAW" : "@aggTrade fallback";\n  button.textContent = mode === "series" ? "СЕРИЯ" : mode.toUpperCase();\n  button.dataset.mode = mode;\n  button.dataset.aggregationSource = state.aggregationSource === "raw" ? "raw" : "agg";\n  button.classList.toggle("is-active", mode !== "raw");\n  button.setAttribute("aria-pressed", String(mode !== "raw"));\n  button.setAttribute("aria-label", `Режим ленты ${button.textContent}. Нажмите для переключения.`);\n  if (mode === "series") {\n    button.title = `СЕРИЯ ≤${TAPE_SERIES_MAX_GAP_MS} мс · ${source}: сделки одного агрессора суммируются до встречной сделки. Пауза больше ${TAPE_SERIES_MAX_GAP_MS} мс начинает новую серию.`;\n  } else if (mode === "agg") {\n    button.title = `AGG 0 мс · ${source}: объединяются последовательные исполнения с одинаковым биржевым временем и направлением. Текущий агрегат появляется сразу; история не пересчитывается.`;\n  } else {\n    button.title = "RAW: каждое исполнение отображается отдельно по стабильному @aggTrade-потоку";\n  }\n}\n'''
text = replace_once(text, old_sync, new_sync, "replace Tape mode button")

text = replace_once(
    text,
    '      mode: localStorage.getItem(TAPE_MODE_KEY) === "agg" ? "agg" : "raw",\n',
    '      mode: normalizeTapeMode(localStorage.getItem(TAPE_MODE_KEY)),\n',
    "normalize saved Tape mode",
)

text = replace_once(
    text,
    '''      aggSourceBuckets: [],\n      aggSnapshots: new Map(),\n      recentRawScratch: [],\n      finalizedAggScratch: [],\n      closedAggScratch: [],\n''',
    '''      aggSourceBuckets: [],\n      aggSnapshots: new Map(),\n      seriesSourceBuckets: [],\n      seriesSnapshots: new Map(),\n      recentRawScratch: [],\n      finalizedAggScratch: [],\n      closedAggScratch: [],\n      finalizedSeriesScratch: [],\n      closedSeriesScratch: [],\n''',
    "add Tape series state",
)

text = replace_once(
    text,
    '      <label class="inpuls-tape-filter" title="Показывать маркеры RAW/AGG не меньше указанного объёма. Линия строится по всем сделкам.">\n',
    '      <label class="inpuls-tape-filter" title="Показывать маркеры RAW/AGG/СЕРИЯ не меньше указанного объёма. Линия строится по всем сделкам.">\n',
    "update Tape filter title",
)

text = replace_once(
    text,
    '''    modeButton.addEventListener("click", () => {\n      state.mode = state.mode === "agg" ? "raw" : "agg";\n      localStorage.setItem(TAPE_MODE_KEY, state.mode);\n      syncTapeModeButton(modeButton, state);\n      scheduleTapeDraw(true, card);\n    });\n''',
    '''    modeButton.addEventListener("click", () => {\n      state.mode = nextTapeMode(state.mode);\n      localStorage.setItem(TAPE_MODE_KEY, state.mode);\n      syncTapeModeButton(modeButton, state);\n      scheduleTapeDraw(true, card);\n    });\n''',
    "cycle Tape mode",
)

text = replace_once(
    text,
    '''          state.aggSourceBuckets = [];\n            state.aggSnapshots?.clear?.();\n''',
    '''          state.aggSourceBuckets = [];\n          state.seriesSourceBuckets = [];\n          state.aggSnapshots?.clear?.();\n          state.seriesSnapshots?.clear?.();\n''',
    "reset Tape series state",
)

series_aggregator = '''export function aggregateTapeSeries(trades, maximumGapMs = TAPE_SERIES_MAX_GAP_MS) {\n  const gapLimit = Math.max(20, Number(maximumGapMs) || TAPE_SERIES_MAX_GAP_MS);\n  const ordered = [...(trades ?? [])]\n    .filter((trade) => {\n      const executionTime = Number(trade?.tradeTime ?? trade?.eventTime ?? trade?.time);\n      const displayTime = Number(trade?.displayTime ?? trade?.time);\n      const price = Number(trade?.price);\n      const quote = Number(trade?.quote);\n      return [executionTime, displayTime, price, quote].every(Number.isFinite) && quote > 0;\n    })\n    .sort((left, right) => {\n      const leftTime = Number(left.tradeTime ?? left.eventTime ?? left.time);\n      const rightTime = Number(right.tradeTime ?? right.eventTime ?? right.time);\n      const timeDelta = leftTime - rightTime;\n      if (timeDelta) return timeDelta;\n      const leftId = Number(left.id);\n      const rightId = Number(right.id);\n      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {\n        return leftId - rightId;\n      }\n      return String(left.id).localeCompare(String(right.id));\n    });\n\n  const groups = [];\n  const ordinalByTime = new Map();\n  let current = null;\n\n  const finish = () => {\n    if (!current) return;\n    current.vwapPrice = current.quantity > 0\n      ? current.quote / current.quantity\n      : current.firstPrice;\n    current.price = (current.minPrice + current.maxPrice) / 2;\n    current.lastTime = current.time;\n    current.durationMs = Math.max(0, current.lastEventTime - current.firstEventTime);\n    current.bucketStart = current.firstEventTime;\n    current.bucketEnd = current.lastEventTime;\n    current.bucketMs = gapLimit;\n    const ordinal = ordinalByTime.get(current.time) ?? 0;\n    current.timeOrdinal = ordinal;\n    ordinalByTime.set(current.time, ordinal + 1);\n    groups.push(current);\n    current = null;\n  };\n\n  for (const trade of ordered) {\n    const executionTime = Number(trade.tradeTime ?? trade.eventTime ?? trade.time);\n    const displayTime = Number(trade.displayTime ?? trade.time);\n    const side = trade.side === "sell" ? "sell" : "buy";\n    const price = Number(trade.price);\n    const quote = Number(trade.quote);\n    const quantity = Number.isFinite(Number(trade.quantity)) && Number(trade.quantity) > 0\n      ? Number(trade.quantity)\n      : quote / price;\n    const continues = current\n      && current.side === side\n      && executionTime - current.lastEventTime <= gapLimit;\n\n    if (!continues) {\n      finish();\n      current = {\n        key: `series:${executionTime}:${side}:${tapeTradeKey(trade)}`,\n        time: displayTime,\n        lastTime: displayTime,\n        eventTime: executionTime,\n        firstEventTime: executionTime,\n        lastEventTime: executionTime,\n        side,\n        firstPrice: price,\n        lastPrice: price,\n        minPrice: price,\n        maxPrice: price,\n        price,\n        vwapPrice: price,\n        quantity: 0,\n        quote: 0,\n        buyQuote: 0,\n        sellQuote: 0,\n        count: 0,\n      };\n    }\n\n    current.time = Math.max(Number(current.time) || displayTime, displayTime);\n    current.lastTime = current.time;\n    current.lastEventTime = executionTime;\n    current.lastPrice = price;\n    current.minPrice = Math.min(current.minPrice, price);\n    current.maxPrice = Math.max(current.maxPrice, price);\n    current.quantity += quantity;\n    current.quote += quote;\n    current[side === "sell" ? "sellQuote" : "buyQuote"] += quote;\n    current.count += 1;\n  }\n\n  finish();\n  return groups;\n}\n\n'''
text = replace_once(
    text,
    'export function materializeZeroMsAggregates(state, groups, output = []) {\n',
    series_aggregator + 'export function materializeZeroMsAggregates(state, groups, output = []) {\n',
    "insert Tape series aggregator",
)

series_materializer = '''\nexport function materializeTapeSeries(\n  state,\n  groups,\n  output = [],\n  now = binanceClock.now(),\n  maximumGapMs = TAPE_SERIES_MAX_GAP_MS,\n) {\n  if (!(state.seriesSnapshots instanceof Map)) state.seriesSnapshots = new Map();\n  output.length = 0;\n  const gapLimit = Math.max(20, Number(maximumGapMs) || TAPE_SERIES_MAX_GAP_MS);\n  const currentTime = Number(now);\n  const lastIndex = Math.max(-1, (groups?.length ?? 0) - 1);\n\n  for (let index = 0; index <= lastIndex; index += 1) {\n    const group = groups[index];\n    const isLast = index === lastIndex;\n    const timedOut = isLast\n      && Number.isFinite(currentTime)\n      && currentTime - Number(group.time) > gapLimit;\n    const showLabel = Number(group.count) > 1 || stableTapeQuoteStrength(group.quote) >= .62;\n\n    if (isLast && !timedOut) {\n      output.push(Object.freeze({\n        ...group,\n        status: "open",\n        showLabel,\n      }));\n      continue;\n    }\n\n    if (isLast) {\n      // A silence timeout closes the visual series, but it is not cached yet.\n      // A delayed packet can still complete it before a following series exists.\n      output.push(Object.freeze({\n        ...group,\n        status: "sealed",\n        sealedAt: Number(group.time) + gapLimit,\n        showLabel,\n      }));\n      continue;\n    }\n\n    let snapshot = state.seriesSnapshots.get(group.key);\n    if (!snapshot) {\n      snapshot = Object.freeze({\n        ...group,\n        status: "sealed",\n        sealedAt: Number(groups[index + 1]?.firstEventTime ?? group.lastEventTime),\n        showLabel,\n      });\n      state.seriesSnapshots.set(group.key, snapshot);\n    }\n    output.push(snapshot);\n  }\n\n  while (state.seriesSnapshots.size > 1_800) {\n    state.seriesSnapshots.delete(state.seriesSnapshots.keys().next().value);\n  }\n  return output;\n}\n'''
text = replace_once(
    text,
    '\nfunction aggregateVisibleRowClusters(trades, rows, window, minimumQuote = 0) {\n',
    series_materializer + '\nfunction aggregateVisibleRowClusters(trades, rows, window, minimumQuote = 0) {\n',
    "insert Tape series materializer",
)

text = replace_once(
    text,
    '  const modelKey = [symbol, version, "zero-ms"].join(":");\n',
    '  const modelKey = [symbol, version, "zero-ms-series-500"].join(":");\n',
    "version Tape render model",
)
text = replace_once(
    text,
    '''  const aggregationInput = aggregationStored?.length ? aggregationStored : stored;\n  state.aggSourceBuckets = aggregateTapeZeroMs(aggregationInput);\n}\n''',
    '''  const aggregationInput = aggregationStored?.length ? aggregationStored : stored;\n  state.aggSourceBuckets = aggregateTapeZeroMs(aggregationInput);\n  state.seriesSourceBuckets = aggregateTapeSeries(aggregationInput);\n}\n''',
    "build Tape series render model",
)

text = replace_once(
    text,
    '''  const liveAggregates = visibleWaterTapeNodes(\n    materializeZeroMsAggregates(\n      state,\n      state.aggSourceBuckets,\n      state.finalizedAggScratch,\n    ),\n    window,\n    state.closedAggScratch,\n  );\n\n  paintTapeSurface(context, rect);\n''',
    '''  const liveAggregates = visibleWaterTapeNodes(\n    materializeZeroMsAggregates(\n      state,\n      state.aggSourceBuckets,\n      state.finalizedAggScratch,\n    ),\n    window,\n    state.closedAggScratch,\n  );\n  const liveSeries = visibleWaterTapeNodes(\n    materializeTapeSeries(\n      state,\n      state.seriesSourceBuckets,\n      state.finalizedSeriesScratch,\n      exchangeNow,\n    ),\n    window,\n    state.closedSeriesScratch,\n  );\n\n  paintTapeSurface(context, rect);\n''',
    "materialize Tape series",
)

text = replace_once(
    text,
    '  const sourceItems = state.mode === "agg" ? liveAggregates : recentRaw;\n',
    '''  const sourceItems = state.mode === "agg"\n    ? liveAggregates\n    : state.mode === "series"\n      ? liveSeries\n      : recentRaw;\n''',
    "select Tape series source",
)

text = replace_once(
    text,
    '    setTapeState(state, state.mode === "agg" ? "Жду агрегированную сделку…" : "Жду сделку…");\n',
    '''    setTapeState(\n      state,\n      state.mode === "agg"\n        ? "Жду агрегированную сделку…"\n        : state.mode === "series"\n          ? "Жду агрессивную серию…"\n          : "Жду сделку…",\n    );\n''',
    "add Tape series waiting state",
)

text = replace_once(
    text,
    '    const y = state.mode === "agg"\n      ? aggregateLabelY(state.priceViewport, item, projectedY)\n      : projectedY;\n',
    '    const y = state.mode !== "raw"\n      ? aggregateLabelY(state.priceViewport, item, projectedY)\n      : projectedY;\n',
    "render Tape series as aggregate",
)

text = replace_once(
    text,
    '''    .orderbook-card .inpuls-tape-mode {\n      margin-left: auto;\n      min-width: 42px;\n      height: 22px;\n''',
    '''    .orderbook-card .inpuls-tape-mode {\n      margin-left: auto;\n      min-width: 58px;\n      height: 22px;\n''',
    "widen Tape mode button",
)
text = replace_once(
    text,
    '''    .orderbook-card .inpuls-tape-mode.is-active {\n      color: #42e1ad;\n      border-color: rgba(66, 225, 173, .48);\n      background: rgba(66, 225, 173, .09);\n    }\n''',
    '''    .orderbook-card .inpuls-tape-mode.is-active {\n      color: #42e1ad;\n      border-color: rgba(66, 225, 173, .48);\n      background: rgba(66, 225, 173, .09);\n    }\n    .orderbook-card .inpuls-tape-mode[data-mode="series"] {\n      color: #d8b3ff;\n      border-color: rgba(170, 134, 255, .52);\n      background: rgba(170, 134, 255, .11);\n    }\n''',
    "style Tape series mode",
)

write(path, text)

# Update the existing Tape contract from two states to three.
path = "test-orderbook-tape-v2-core.mjs"
text = read(path)
old_test = '''test("Tape keeps RAW default and AGG explicit", () => {\n  assert.match(orderbook, /mode: localStorage\\.getItem\\(TAPE_MODE_KEY\\) === "agg" \\? "agg" : "raw"/);\n  assert.match(orderbook, /button\\.textContent = aggregated/);\n  assert.match(orderbook, /TAPE_AGGREGATION_PERIOD_MS = 0/);\n  assert.doesNotMatch(orderbook, /TAPE_AGGREGATION_LEVELS|data-inpuls-agg-step/);\n});\n'''
new_test = '''test("Tape cycles RAW, AGG and SERIES while keeping RAW default", () => {\n  assert.match(orderbook, /TAPE_MODES = Object\\.freeze\\(\\["raw", "agg", "series"\\]\\)/);\n  assert.match(orderbook, /mode: normalizeTapeMode\\(localStorage\\.getItem\\(TAPE_MODE_KEY\\)\\)/);\n  assert.match(orderbook, /state\\.mode = nextTapeMode\\(state\\.mode\\)/);\n  assert.match(orderbook, /button\\.textContent = mode === "series" \\? "СЕРИЯ" : mode\\.toUpperCase\\(\\)/);\n  assert.match(orderbook, /TAPE_AGGREGATION_PERIOD_MS = 0/);\n  assert.match(orderbook, /TAPE_SERIES_MAX_GAP_MS = 500/);\n  assert.doesNotMatch(orderbook, /TAPE_AGGREGATION_LEVELS|data-inpuls-agg-step/);\n});\n'''
text = replace_once(text, old_test, new_test, "update Tape mode contract")
write(path, text)

# Deterministic behavior and source contracts for Series mode.
write("test-tape-series-v1.mjs", '''import test from "node:test";\nimport assert from "node:assert/strict";\n\nimport {\n  TAPE_SERIES_MAX_GAP_MS,\n  aggregateTapeSeries,\n  materializeTapeSeries,\n  nextTapeMode,\n  normalizeTapeMode,\n} from "./orderbook.js?v=26-112-tape-series-v1";\n\nfunction trade(id, time, side, price, quote) {\n  return {\n    id,\n    time,\n    tradeTime: time,\n    eventTime: time,\n    displayTime: time,\n    side,\n    price,\n    quote,\n    quantity: quote / price,\n  };\n}\n\ntest("Tape mode cycles RAW to AGG to SERIES", () => {\n  assert.equal(normalizeTapeMode(null), "raw");\n  assert.equal(nextTapeMode("raw"), "agg");\n  assert.equal(nextTapeMode("agg"), "series");\n  assert.equal(nextTapeMode("series"), "raw");\n});\n\ntest("same aggressor merges until opposite side or silence boundary", () => {\n  const groups = aggregateTapeSeries([\n    trade(1, 1_000, "buy", 100, 1_000),\n    trade(2, 1_240, "buy", 101, 2_000),\n    trade(3, 1_241, "sell", 100, 500),\n    trade(4, 1_700, "sell", 99, 1_500),\n    trade(5, 2_201, "sell", 98, 700),\n  ]);\n\n  assert.equal(TAPE_SERIES_MAX_GAP_MS, 500);\n  assert.equal(groups.length, 3);\n  assert.deepEqual(groups.map((group) => group.side), ["buy", "sell", "sell"]);\n  assert.deepEqual(groups.map((group) => group.count), [2, 2, 1]);\n  assert.equal(groups[0].quote, 3_000);\n  assert.equal(groups[0].minPrice, 100);\n  assert.equal(groups[0].maxPrice, 101);\n  assert.equal(groups[0].time, 1_240);\n  assert.equal(groups[1].quote, 2_000);\n  assert.equal(groups[2].firstEventTime - groups[1].lastEventTime, 501);\n});\n\ntest("only the live right-most series grows and silence seals it visually", () => {\n  const groups = aggregateTapeSeries([\n    trade(10, 10_000, "buy", 100, 1_000),\n    trade(11, 10_100, "buy", 101, 2_000),\n    trade(12, 10_200, "sell", 100, 500),\n  ]);\n  const state = {};\n  const live = materializeTapeSeries(state, groups, [], 10_400);\n  assert.equal(live[0].status, "sealed");\n  assert.equal(live[1].status, "open");\n  assert.equal(live[0].showLabel, true);\n  assert.equal(state.seriesSnapshots.size, 1);\n\n  const timedOut = materializeTapeSeries(state, groups, [], 10_701);\n  assert.equal(timedOut.at(-1).status, "sealed");\n  assert.equal(state.seriesSnapshots.size, 1);\n});\n''')

# Ship one coherent browser build. Worker logic is unchanged but its URL is
# refreshed so every open orderbook loads the same release inventory.
for candidate in (
    list(ROOT.glob("*.js"))
    + list(ROOT.glob("*.mjs"))
    + list(ROOT.glob("*.html"))
    + list((ROOT / "test").glob("*.js"))
):
    content = candidate.read_text(encoding="utf-8")
    if OLD_KEY in content:
        candidate.write_text(content.replace(OLD_KEY, NEW_KEY), encoding="utf-8")
