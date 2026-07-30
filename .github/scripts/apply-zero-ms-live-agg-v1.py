from pathlib import Path
import re

OLD_BUILD = "26-74-sealed-agg-round-levels-v1"
NEW_BUILD = "26-75-zero-ms-live-agg-v1"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str, flags=0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 match, found {count}")
    return updated


orderbook = read("orderbook.js")

orderbook = replace_once(
    orderbook,
    "const TAPE_MAX_AGG_VISIBLE = 900;",
    "const TAPE_MAX_AGG_VISIBLE = 1_000;",
    "AGG visible limit",
)
for obsolete in [
    "const TAPE_AGG_LABEL_QUANTILE = .95;\n",
    "const TAPE_AGG_EVENT_GRACE_MS = 180;\n",
    "const TAPE_AGG_WALL_CLOCK_GRACE_MS = 700;\n",
    'const TAPE_AGG_LEVEL_KEY = "inpuls-tape-aggregation-level-v1";\n',
    'const TAPE_MIN_FILTER_KEY = "inpuls-tape-min-filter-v3";\n',
]:
    if obsolete not in orderbook:
        raise AssertionError(f"missing obsolete constant: {obsolete.strip()}")
    orderbook = orderbook.replace(obsolete, "", 1)

orderbook = regex_once(
    orderbook,
    r'export const TAPE_AGGREGATION_LEVELS = Object\.freeze\(\[\n(?:  .*\n)+?\]\);\n',
    'export const TAPE_AGGREGATION_PERIOD_MS = 0;\n',
    "aggregation levels constant",
)

orderbook = regex_once(
    orderbook,
    r'function aggregationLevel\(state\) \{[\s\S]*?\n\}\n\nfunction syncTapeModeButton\(button, state\) \{[\s\S]*?\n\}\n\n(?=function formatObservedAge)',
    '''function syncTapeModeButton(button, state) {
  const aggregated = state.mode === "agg";
  button.textContent = aggregated ? "AGG" : "RAW";
  button.classList.toggle("is-active", aggregated);
  button.setAttribute("aria-pressed", String(aggregated));
  button.title = aggregated
    ? "AGG 0 мс: объединяются только последовательные исполнения с одинаковым биржевым временем и направлением. Текущий агрегат появляется сразу; история не пересчитывается."
    : "Каждое исполнение отображается отдельно по точному времени";
}

''',
    "mode button without levels",
)

orderbook = replace_once(
    orderbook,
    "    const savedMinimum = localStorage.getItem(TAPE_MIN_FILTER_KEY);\n",
    "",
    "saved minimum filter",
)
orderbook = regex_once(
    orderbook,
    r'      aggLevelIndex: Math\.max\(0, Math\.min\([\s\S]*?\n      \)\),\n',
    "",
    "AGG state level",
)
orderbook = replace_once(
    orderbook,
    "      minQuote: savedMinimum === null ? 0 : Math.max(0, Number(savedMinimum) || 0),\n",
    "      minQuote: 0,\n",
    "fixed zero marker filter",
)
orderbook = orderbook.replace("      aggBaseTick: null,\n", "")
orderbook = orderbook.replace("      aggBaseTickSymbol: null,\n", "")
orderbook = orderbook.replace("           state.aggBaseTick = null;\n", "")
orderbook = orderbook.replace("           state.aggBaseTickSymbol = null;\n", "")
orderbook = orderbook.replace("         state.aggBaseTick = null;\n", "")
orderbook = orderbook.replace("         state.aggBaseTickSymbol = null;\n", "")

orderbook = regex_once(
    orderbook,
    r'  const nativeMinimum = toolbar\.querySelector\("\[data-trade-min\]"\);[\s\S]*?\n  const heading = card\.querySelector\("\.orderbook-heading"\);',
    '''  const nativeMinimum = toolbar.querySelector("[data-trade-min]");
  nativeMinimum?.closest("label")?.classList.add("inpuls-native-min-filter");

  if (!state.controls?.isConnected) {
    const controls = document.createElement("div");
    controls.className = "inpuls-tape-controls";
    controls.innerHTML = '<button data-inpuls-tape-mode class="inpuls-tape-mode" type="button"></button>';
    toolbar.append(controls);
    state.controls = controls;

    const modeButton = controls.querySelector("[data-inpuls-tape-mode]");
    modeButton.addEventListener("click", () => {
      state.mode = state.mode === "agg" ? "raw" : "agg";
      localStorage.setItem(TAPE_MODE_KEY, state.mode);
      syncTapeModeButton(modeButton, state);
      scheduleTapeDraw(true, card);
    });
    syncTapeModeButton(modeButton, state);
    syncLayerButtons(card, state);
  } else {
    syncTapeModeButton(state.controls.querySelector("[data-inpuls-tape-mode]"), state);
  }

  const heading = card.querySelector(".orderbook-heading");''',
    "simplified Tape controls",
)

orderbook = regex_once(
    orderbook,
    r'export function aggregateTapeBuckets\([\s\S]*?\nfunction aggregateVisibleRowClusters',
    '''export function aggregateTapeZeroMs(trades) {
  const ordered = [...(trades ?? [])]
    .filter((trade) => {
      const time = Number(trade?.time);
      const price = Number(trade?.price);
      const quote = Number(trade?.quote);
      return [time, price, quote].every(Number.isFinite) && quote > 0;
    })
    .sort((left, right) => {
      const timeDelta = Number(left.time) - Number(right.time);
      if (timeDelta) return timeDelta;
      const leftId = Number(left.id);
      const rightId = Number(right.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
        return leftId - rightId;
      }
      return String(left.id).localeCompare(String(right.id));
    });

  const groups = [];
  let current = null;
  const finish = () => {
    if (!current) return;
    current.vwapPrice = current.quantity > 0
      ? current.quote / current.quantity
      : current.firstPrice;
    // The marker is anchored to the first execution. Its volume may grow while
    // OPEN, but it never jumps between price rows.
    current.price = current.firstPrice;
    current.lastTime = current.eventTime;
    current.bucketStart = current.eventTime;
    current.bucketEnd = current.eventTime;
    current.bucketMs = TAPE_AGGREGATION_PERIOD_MS;
    current.showLabel = true;
    groups.push(current);
    current = null;
  };

  for (const trade of ordered) {
    const eventTime = Number(trade.time);
    const side = trade.side === "sell" ? "sell" : "buy";
    const price = Number(trade.price);
    const quote = Number(trade.quote);
    const quantity = Number.isFinite(Number(trade.quantity)) && Number(trade.quantity) > 0
      ? Number(trade.quantity)
      : quote / price;
    const continues = current
      && current.eventTime === eventTime
      && current.side === side;

    if (!continues) {
      finish();
      current = {
        key: `agg0:${eventTime}:${side}:${tapeTradeKey(trade)}`,
        time: eventTime,
        lastTime: eventTime,
        eventTime,
        side,
        firstPrice: price,
        lastPrice: price,
        minPrice: price,
        maxPrice: price,
        price,
        vwapPrice: price,
        quantity: 0,
        quote: 0,
        buyQuote: 0,
        sellQuote: 0,
        count: 0,
      };
    }

    current.lastPrice = price;
    current.minPrice = Math.min(current.minPrice, price);
    current.maxPrice = Math.max(current.maxPrice, price);
    current.quantity += quantity;
    current.quote += quote;
    current[side === "sell" ? "sellQuote" : "buyQuote"] += quote;
    current.count += 1;
  }
  finish();
  return groups;
}

export function materializeZeroMsAggregates(state, groups, output = []) {
  if (!(state.aggSnapshots instanceof Map)) state.aggSnapshots = new Map();
  output.length = 0;
  const lastIndex = Math.max(-1, (groups?.length ?? 0) - 1);

  for (let index = 0; index <= lastIndex; index += 1) {
    const group = groups[index];
    if (index === lastIndex) {
      // The right-most group is OPEN and is the only marker allowed to grow.
      output.push(Object.freeze({ ...group, status: "open", showLabel: true }));
      continue;
    }
    let snapshot = state.aggSnapshots.get(group.key);
    if (!snapshot) {
      snapshot = Object.freeze({
        ...group,
        status: "sealed",
        sealedAt: Number(groups[index + 1]?.eventTime ?? group.eventTime),
        showLabel: true,
      });
      state.aggSnapshots.set(group.key, snapshot);
    }
    output.push(snapshot);
  }

  while (state.aggSnapshots.size > 1_800) {
    state.aggSnapshots.delete(state.aggSnapshots.keys().next().value);
  }
  return output;
}

function aggregateVisibleRowClusters''',
    "zero-ms sequential aggregation",
)

orderbook = regex_once(
    orderbook,
    r'export function tapeAggregationTickFromBook\([\s\S]*?\n(?=function visibleWaterTapeNodes)',
    '''function refreshTapeRenderModel(state, symbol, stored) {
  const version = Number(tapeDataVersionBySymbol.get(symbol)) || 0;
  const modelKey = [symbol, version, "zero-ms"].join(":");
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
  state.aggSourceBuckets = aggregateTapeZeroMs(stored);
}

''',
    "zero-ms render model",
)

orderbook = regex_once(
    orderbook,
    r'  const range = state\.priceRange;\n  const visibleStep = range\?\.step \?\? \.01;[\s\S]*?\n  \);\n\n  paintTapeSurface',
    '''  const range = state.priceRange;
  refreshTapeRenderModel(state, symbol, stored);

  const recentRaw = visibleWaterTapeNodes(
    state.rawRenderNodes,
    window,
    state.recentRawScratch,
  );
  const liveAggregates = visibleWaterTapeNodes(
    materializeZeroMsAggregates(
      state,
      state.aggSourceBuckets,
      state.finalizedAggScratch,
    ),
    window,
    state.closedAggScratch,
  );

  paintTapeSurface''',
    "zero-ms draw source",
)

orderbook = replace_once(
    orderbook,
    '  const sourceItems = state.mode === "agg" ? closedAggregates : recentRaw;\n',
    '  const sourceItems = state.mode === "agg" ? liveAggregates : recentRaw;\n',
    "live AGG source",
)
orderbook = replace_once(
    orderbook,
    '    setTapeState(state, "Линия всех сделок · нет маркеров по фильтру");\n',
    '    setTapeState(state, state.mode === "agg" ? "Жду агрегированную сделку…" : "Жду сделку…");\n',
    "empty Tape status",
)
orderbook = replace_once(
    orderbook,
    '    setTapeState(state, "Линия всех сделок · маркеры вне видимой цены");\n',
    '    setTapeState(state, "Сделки находятся вне видимой ценовой шкалы");\n',
    "offscreen Tape status",
)

orderbook = replace_once(
    orderbook,
    '    const showLabel = minQuote > 0 || Boolean(item.showLabel);\n',
    '    const showLabel = Boolean(item.showLabel);\n    const openAggregate = item.status === "open";\n',
    "AGG label state",
)
orderbook = replace_once(
    orderbook,
    '    context.fillStyle = buy ? "rgba(42, 191, 137, .76)" : "rgba(222, 70, 87, .78)";\n',
    '    context.fillStyle = buy\n      ? `rgba(42, 191, 137, ${openAggregate ? .66 : .76})`\n      : `rgba(222, 70, 87, ${openAggregate ? .68 : .78})`;\n',
    "OPEN aggregate fill",
)

assert "data-inpuls-agg-step" not in orderbook
assert "TAPE_AGGREGATION_LEVELS" not in orderbook
assert "TAPE_AGG_LEVEL_KEY" not in orderbook
assert "TAPE_AGG_EVENT_GRACE_MS" not in orderbook
assert "TAPE_AGG_WALL_CLOCK_GRACE_MS" not in orderbook
assert "data-inpuls-trade-min" not in orderbook
assert "aggregateTapeZeroMs" in orderbook
assert "materializeZeroMsAggregates" in orderbook

write("orderbook.js", orderbook)

new_test = '''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TAPE_AGGREGATION_PERIOD_MS,
  aggregateTapeZeroMs,
  materializeZeroMsAggregates,
} from "./orderbook.js";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

const trade = (id, time, side, price, quote) => ({
  id,
  time,
  side,
  price,
  quote,
  quantity: quote / price,
});

test("zero-ms AGG groups only consecutive executions with equal event time and side", () => {
  assert.equal(TAPE_AGGREGATION_PERIOD_MS, 0);
  const groups = aggregateTapeZeroMs([
    trade(5, 1001, "buy", 101, 505),
    trade(2, 1000, "buy", 100, 200),
    trade(1, 1000, "buy", 99, 99),
    trade(3, 1000, "sell", 98, 196),
    trade(4, 1001, "buy", 100, 300),
  ]);

  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => [group.eventTime, group.side, group.count]), [
    [1000, "buy", 2],
    [1000, "sell", 1],
    [1001, "buy", 2],
  ]);
  assert.equal(groups[0].quote, 299);
  assert.equal(groups[0].price, 99, "marker stays on the first execution price");
  assert.notEqual(groups[0].vwapPrice, groups[0].price);
});

test("only the right-most aggregate is OPEN and sealed history keeps object identity", () => {
  const state = { aggSnapshots: new Map() };
  const first = aggregateTapeZeroMs([
    trade(1, 1000, "buy", 100, 100),
    trade(2, 1001, "sell", 101, 202),
  ]);
  const firstView = materializeZeroMsAggregates(state, first, []);
  assert.equal(firstView[0].status, "sealed");
  assert.equal(firstView[1].status, "open");
  assert.equal(Object.isFrozen(firstView[0]), true);
  assert.equal(Object.isFrozen(firstView[1]), true);

  const sealed = firstView[0];
  const updated = aggregateTapeZeroMs([
    trade(1, 1000, "buy", 100, 100),
    trade(2, 1001, "sell", 101, 202),
    trade(3, 1001, "sell", 102, 204),
  ]);
  const updatedView = materializeZeroMsAggregates(state, updated, []);
  assert.equal(updatedView[0], sealed, "historical aggregate is reused, not rebuilt");
  assert.equal(updatedView[1].status, "open");
  assert.equal(updatedView[1].quote, 406, "only current OPEN aggregate grows immediately");
});

test("Tape UI has RAW/AGG only and no period, level or volume-filter controls", () => {
  assert.doesNotMatch(orderbook, /TAPE_AGGREGATION_LEVELS|data-inpuls-agg-step|AGG ×/);
  assert.doesNotMatch(orderbook, /TAPE_AGG_EVENT_GRACE_MS|TAPE_AGG_WALL_CLOCK_GRACE_MS/);
  assert.doesNotMatch(orderbook, /data-inpuls-trade-min|TAPE_MIN_FILTER_KEY/);
  assert.match(orderbook, /button\.textContent = aggregated \? "AGG" : "RAW"/);
  assert.match(orderbook, /AGG 0 мс/);
  assert.match(orderbook, /status: "open"/);
  assert.match(orderbook, /status: "sealed"/);
});
'''
write("test-sealed-agg-round-levels-v1.mjs", new_test)

for path in Path(".").rglob("*"):
    if not path.is_file() or ".git" in path.parts:
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".css"}:
        continue
    text = path.read_text(encoding="utf-8")
    if OLD_BUILD in text:
        path.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

version = read("VERSION.txt")
features = [
    "zero-ms-live-agg-v1",
    "same-event-time-side-aggregation-v1",
    "immediate-open-aggregate-v1",
    "no-aggregation-levels-v1",
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

orderbook = read("orderbook.js")
assert NEW_BUILD in read("VERSION.txt")
assert "export const TAPE_AGGREGATION_PERIOD_MS = 0;" in orderbook
assert "aggregateTapeZeroMs" in orderbook
assert "materializeZeroMsAggregates" in orderbook
assert 'button.textContent = aggregated ? "AGG" : "RAW";' in orderbook
assert "data-inpuls-agg-step" not in orderbook
assert "data-inpuls-trade-min" not in orderbook
assert "TAPE_AGGREGATION_LEVELS" not in orderbook
assert "TAPE_AGG_EVENT_GRACE_MS" not in orderbook
assert "TAPE_AGG_WALL_CLOCK_GRACE_MS" not in orderbook
assert OLD_BUILD not in "\n".join(
    read(path)
    for path in ["VERSION.txt", "app.js", "index.html", "orderbook.js", "sw.js"]
)
