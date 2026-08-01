from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
OLD_BUILD = "26-91-runtime-boot-cache-feed-v1"
NEW_BUILD = "26-92-tape-series-stage1-v1"


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one occurrence, got {count}")
    return text.replace(old, new, 1)


def replace_balanced_function(text: str, name: str, replacement: str) -> str:
    match = re.search(rf"function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{", text)
    if not match:
        raise RuntimeError(f"function not found: {name}")
    open_index = text.find("{", match.start())
    depth = 0
    quote = None
    escaped = False
    line_comment = False
    block_comment = False
    index = open_index
    while index < len(text):
        char = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            if char == "*" and nxt == "/":
                block_comment = False
                index += 2
                continue
            index += 1
            continue
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char == "/" and nxt == "/":
            line_comment = True
            index += 2
            continue
        if char == "/" and nxt == "*":
            block_comment = True
            index += 2
            continue
        if char in ("'", '"', "`"):
            quote = char
            index += 1
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[:match.start()] + replacement.rstrip() + text[index + 1:]
        index += 1
    raise RuntimeError(f"unterminated function: {name}")


path = "orderbook.js"
text = read(path)

text = replace_once(
    text,
    "const TAPE_TIME_SCALE_DEFAULT = 100;\n",
    "const TAPE_TIME_SCALE_DEFAULT = 100;\n"
    "export const TAPE_SWEEP_WINDOW_MS = 100;\n"
    "export const TAPE_SWEEP_MIN_AGGREGATES = 2;\n"
    "const TAPE_SWEEP_MAX_DIRECTION_SPAN_PX = 52;\n"
    "const TAPE_SWEEP_LABEL_MIN_GAP_X = 6;\n"
    "const TAPE_SWEEP_LABEL_MIN_GAP_Y = 4;\n",
    "series constants",
)

text = replace_once(
    text,
    "    .orderbook-card .inpuls-tape-mode {\n"
    "      margin-left: auto;\n"
    "      min-width: 42px;\n",
    "    .orderbook-card .inpuls-tape-mode {\n"
    "      margin-left: auto;\n"
    "      min-width: 54px;\n",
    "mode width",
)
text = replace_once(
    text,
    "    .orderbook-card .inpuls-tape-mode.is-active {\n"
    "      color: #42e1ad;\n"
    "      border-color: rgba(66, 225, 173, .48);\n"
    "      background: rgba(66, 225, 173, .09);\n"
    "    }\n",
    "    .orderbook-card .inpuls-tape-mode.is-active {\n"
    "      color: #42e1ad;\n"
    "      border-color: rgba(66, 225, 173, .48);\n"
    "      background: rgba(66, 225, 173, .09);\n"
    "    }\n"
    "    .orderbook-card .inpuls-tape-mode.is-sweep {\n"
    "      color: #ffd27a;\n"
    "      border-color: rgba(255, 210, 122, .58);\n"
    "      background: rgba(255, 210, 122, .10);\n"
    "    }\n",
    "series mode style",
)

sync_mode = r'''function syncTapeModeButton(button, state) {
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
      ? `СЕРИЯ · ${source}: минимум ${TAPE_SWEEP_MIN_AGGREGATES} AGG одной стороны за ${TAPE_SWEEP_WINDOW_MS} мс от первого AGG или до первого AGG противоположной стороны.`
      : "Каждое исполнение отображается отдельно по стабильному @aggTrade-потоку";
}'''
text = replace_balanced_function(text, "syncTapeModeButton", sync_mode)

text = replace_once(
    text,
    "    const savedTimeScale = localStorage.getItem(TAPE_TIME_SCALE_KEY);\n"
    "    state = {\n"
    "      canvas: null,\n"
    "      context: null,\n"
    "      mode: localStorage.getItem(TAPE_MODE_KEY) === \"agg\" ? \"agg\" : \"raw\",\n",
    "    const savedTimeScale = localStorage.getItem(TAPE_TIME_SCALE_KEY);\n"
    "    const savedMode = localStorage.getItem(TAPE_MODE_KEY);\n"
    "    state = {\n"
    "      canvas: null,\n"
    "      context: null,\n"
    "      mode: savedMode === \"agg\" || savedMode === \"sweep\" ? savedMode : \"raw\",\n",
    "saved tape mode",
)

text = replace_once(
    text,
    "      aggSourceBuckets: [],\n"
    "      aggSnapshots: new Map(),\n"
    "      recentRawScratch: [],\n"
    "      finalizedAggScratch: [],\n"
    "      closedAggScratch: [],\n",
    "      aggSourceBuckets: [],\n"
    "      aggSnapshots: new Map(),\n"
    "      sweepSourceBuckets: [],\n"
    "      sweepSnapshots: new Map(),\n"
    "      recentRawScratch: [],\n"
    "      finalizedAggScratch: [],\n"
    "      closedAggScratch: [],\n"
    "      finalizedSweepScratch: [],\n"
    "      closedSweepScratch: [],\n",
    "series state",
)

text = replace_once(
    text,
    "      state.mode = state.mode === \"agg\" ? \"raw\" : \"agg\";\n",
    "      state.mode = state.mode === \"raw\" ? \"agg\" : state.mode === \"agg\" ? \"sweep\" : \"raw\";\n",
    "mode cycle",
)

reset_anchor = (
    "          state.aggSourceBuckets = [];\n"
    "          state.aggSnapshots?.clear?.();\n"
)
reset_replacement = (
    "          state.aggSourceBuckets = [];\n"
    "          state.aggSnapshots?.clear?.();\n"
    "          state.sweepSourceBuckets = [];\n"
    "          state.sweepSnapshots?.clear?.();\n"
)
reset_count = text.count(reset_anchor)
if reset_count != 2:
    raise RuntimeError(f"series reset: expected two anchors, got {reset_count}")
text = text.replace(reset_anchor, reset_replacement)

series_functions = r'''
export function aggregateTapeSweeps(
  groups,
  {
    windowMs = TAPE_SWEEP_WINDOW_MS,
    minimumAggregates = TAPE_SWEEP_MIN_AGGREGATES,
  } = {},
) {
  const safeWindowMs = Math.max(1, Number(windowMs) || TAPE_SWEEP_WINDOW_MS);
  const safeMinimum = Math.max(2, Math.floor(Number(minimumAggregates) || TAPE_SWEEP_MIN_AGGREGATES));
  const ordered = [...(groups ?? [])]
    .filter((group) => {
      const time = Number(group?.eventTime ?? group?.time);
      const price = Number(group?.price ?? group?.firstPrice);
      const quote = Number(group?.quote);
      return Number.isFinite(time) && Number.isFinite(price) && price > 0 && Number.isFinite(quote) && quote > 0;
    })
    .sort((left, right) => {
      const timeDelta = Number(left.eventTime ?? left.time) - Number(right.eventTime ?? right.time);
      if (timeDelta) return timeDelta;
      return Number(left.timeOrdinal) - Number(right.timeOrdinal);
    });

  const result = [];
  const ordinalByTime = new Map();
  let current = null;

  const start = (group) => {
    const eventTime = Number(group.eventTime ?? group.time);
    const displayTime = Number(group.time ?? eventTime);
    const firstPrice = Number(group.firstPrice ?? group.price);
    const lastPrice = Number(group.lastPrice ?? group.price);
    const quote = Math.max(0, Number(group.quote) || 0);
    const quantity = Math.max(0, Number(group.quantity) || 0);
    current = {
      key: `sweep:${group.side}:${eventTime}:${group.key}`,
      kind: "sweep",
      side: group.side === "sell" ? "sell" : "buy",
      firstTime: displayTime,
      lastTime: Number(group.lastTime ?? displayTime),
      firstEventTime: eventTime,
      lastEventTime: eventTime,
      firstTradeId: Number.isInteger(Number(group.firstTradeId)) ? Number(group.firstTradeId) : null,
      lastTradeId: Number.isInteger(Number(group.lastTradeId)) ? Number(group.lastTradeId) : null,
      firstPrice,
      lastPrice,
      minPrice: Number(group.minPrice ?? firstPrice),
      maxPrice: Number(group.maxPrice ?? lastPrice),
      price: firstPrice,
      labelPrice: (firstPrice + lastPrice) / 2,
      vwapPrice: Number(group.vwapPrice ?? firstPrice),
      quantity,
      quote,
      buyQuote: Number(group.buyQuote) || 0,
      sellQuote: Number(group.sellQuote) || 0,
      count: Number(group.count) || 0,
      aggregateCount: 1,
      peakAggregateQuote: quote,
      sizeQuote: quote,
      closed: false,
    };
  };

  const append = (group) => {
    const eventTime = Number(group.eventTime ?? group.time);
    const displayTime = Number(group.time ?? eventTime);
    const lastPrice = Number(group.lastPrice ?? group.price);
    const quote = Math.max(0, Number(group.quote) || 0);
    const quantity = Math.max(0, Number(group.quantity) || 0);
    current.lastTime = Number(group.lastTime ?? displayTime);
    current.lastEventTime = eventTime;
    current.lastPrice = lastPrice;
    if (Number.isInteger(Number(group.lastTradeId))) current.lastTradeId = Number(group.lastTradeId);
    current.minPrice = Math.min(current.minPrice, Number(group.minPrice ?? lastPrice));
    current.maxPrice = Math.max(current.maxPrice, Number(group.maxPrice ?? lastPrice));
    current.quantity += quantity;
    current.quote += quote;
    current.buyQuote += Number(group.buyQuote) || 0;
    current.sellQuote += Number(group.sellQuote) || 0;
    current.count += Number(group.count) || 0;
    current.aggregateCount += 1;
    current.peakAggregateQuote = Math.max(current.peakAggregateQuote, quote);
    current.sizeQuote = current.peakAggregateQuote;
  };

  const finish = (closed) => {
    if (!current) return;
    current.closed = Boolean(closed);
    current.durationMs = Math.max(0, current.lastEventTime - current.firstEventTime);
    current.time = current.firstTime + Math.max(0, current.lastTime - current.firstTime) / 2;
    current.eventTime = current.firstEventTime + current.durationMs / 2;
    current.tradeTime = current.eventTime;
    current.receivedAt = current.time;
    current.labelPrice = (current.firstPrice + current.lastPrice) / 2;
    current.price = current.labelPrice;
    current.vwapPrice = current.quantity > 0 ? current.quote / current.quantity : current.firstPrice;
    const ordinalKey = Math.round(current.time);
    current.timeOrdinal = ordinalByTime.get(ordinalKey) ?? 0;
    ordinalByTime.set(ordinalKey, current.timeOrdinal + 1);
    if (current.aggregateCount >= safeMinimum) result.push(current);
    current = null;
  };

  for (const group of ordered) {
    const side = group.side === "sell" ? "sell" : "buy";
    const eventTime = Number(group.eventTime ?? group.time);
    if (!current) {
      start({ ...group, side });
      continue;
    }
    const opposite = side !== current.side;
    const outsideWindow = eventTime - current.firstEventTime > safeWindowMs;
    if (opposite || outsideWindow) {
      finish(true);
      start({ ...group, side });
      continue;
    }
    append({ ...group, side });
  }
  finish(false);
  return result;
}

export function materializeTapeSweeps(state, groups, output = []) {
  if (!(state.sweepSnapshots instanceof Map)) state.sweepSnapshots = new Map();
  output.length = 0;
  const lastIndex = Math.max(-1, (groups?.length ?? 0) - 1);
  for (let index = 0; index <= lastIndex; index += 1) {
    const group = groups[index];
    const sealed = Boolean(group.closed) || index < lastIndex;
    if (!sealed) {
      output.push(Object.freeze({
        ...group,
        status: "open",
        showLabel: stableTapeQuoteStrength(group.quote) >= .58 || Number(group.aggregateCount) >= 3,
      }));
      continue;
    }
    let snapshot = state.sweepSnapshots.get(group.key);
    if (!snapshot) {
      snapshot = Object.freeze({
        ...group,
        status: "sealed",
        sealedAt: Number(groups[index + 1]?.firstTime ?? group.lastTime),
        showLabel: stableTapeQuoteStrength(group.quote) >= .58 || Number(group.aggregateCount) >= 3,
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
    "function aggregateVisibleRowClusters(trades, rows, window, minimumQuote = 0) {\n",
    series_functions + "function aggregateVisibleRowClusters(trades, rows, window, minimumQuote = 0) {\n",
    "series aggregation functions",
)

text = replace_once(
    text,
    "  state.aggSourceBuckets = aggregateTapeZeroMs(aggregationInput);\n",
    "  state.aggSourceBuckets = aggregateTapeZeroMs(aggregationInput);\n"
    "  state.sweepSourceBuckets = aggregateTapeSweeps(state.aggSourceBuckets);\n",
    "series render model",
)

series_draw_helpers = r'''
function drawTapeSweepDirection(context, viewport, item, x, buy, stroke, strength, openSeries = false) {
  const firstPrice = Number(item?.firstPrice);
  const lastPrice = Number(item?.lastPrice);
  const lowPrice = Number(viewport?.lowPrice);
  const highPrice = Number(viewport?.highPrice);
  if (![firstPrice, lastPrice, lowPrice, highPrice].every(Number.isFinite)) return false;
  const start = projectTapePrice(viewport, clampTape(firstPrice, lowPrice, highPrice));
  const end = projectTapePrice(viewport, clampTape(lastPrice, lowPrice, highPrice));
  if (!start || !end) return false;

  const rawDelta = end.y - start.y;
  const maximumSpan = clampTape(
    (Number(viewport?.rowHeight) || 1) * 6,
    18,
    TAPE_SWEEP_MAX_DIRECTION_SPAN_PX,
  );
  const fromY = Math.abs(rawDelta) > maximumSpan
    ? end.y - Math.sign(rawDelta) * maximumSpan
    : start.y;
  const toY = end.y;
  const delta = toY - fromY;
  const bodyWidth = clampTape(4.8 + strength * 2.6, 4.8, 8.4);

  context.save();
  context.strokeStyle = stroke;
  context.fillStyle = buy
    ? `rgba(42, 191, 137, ${openSeries ? .25 : .38})`
    : `rgba(222, 70, 87, ${openSeries ? .26 : .40})`;
  context.lineWidth = clampTape(.85 + strength * .35, .85, 1.35);

  if (Math.abs(delta) < 3) {
    roundedRectPath(context, x - 5, toY - 2.5, 10, 5, 2.5);
    context.fill();
    context.stroke();
    context.restore();
    return true;
  }

  const top = Math.min(fromY, toY);
  const height = Math.max(6, Math.abs(delta));
  roundedRectPath(context, x - bodyWidth / 2, top, bodyWidth, height, bodyWidth / 2);
  context.fill();
  context.stroke();

  const direction = Math.sign(delta);
  context.globalAlpha = openSeries ? .62 : .88;
  context.beginPath();
  context.arc(x, fromY, Math.max(1.4, bodyWidth * .24), 0, Math.PI * 2);
  context.fillStyle = stroke;
  context.fill();
  context.beginPath();
  context.moveTo(x, toY + direction * 1.2);
  context.lineTo(x - bodyWidth * .62, toY - direction * 4.6);
  context.lineTo(x + bodyWidth * .62, toY - direction * 4.6);
  context.closePath();
  context.fill();
  context.restore();
  return true;
}

export function selectTapeSweepLabelKeys(projectedItems, window, plotRight, forceLabels = false) {
  const right = Math.max(1, Number(plotRight) || 1);
  const candidates = [];
  for (const projected of projectedItems ?? []) {
    const item = projected?.source;
    if (!item || (!forceLabels && !item.showLabel)) continue;
    const label = `Σ${formatTapeUsd(item.quote)}`;
    const width = clampTape(label.length * 5.2 + 12, 24, Math.min(96, right * .30));
    const height = clampTape(9 + stableTapeQuoteStrength(item.sizeQuote ?? item.quote) * 5, 9, 16);
    const baseX = tapeTimeX(item.time, window, right);
    const x = aggregateStableX(baseX, item.timeOrdinal, width, right);
    const y = Number(projected?.position?.y);
    if (!Number.isFinite(y)) continue;
    candidates.push({
      key: item.key,
      x,
      y,
      width,
      height,
      quote: Number(item.quote) || 0,
      open: item.status === "open",
      time: Number(item.time) || 0,
    });
  }
  candidates.sort((left, rightItem) => {
    if (left.open !== rightItem.open) return left.open ? -1 : 1;
    const quoteDelta = rightItem.quote - left.quote;
    if (quoteDelta) return quoteDelta;
    return rightItem.time - left.time;
  });

  const maximumLabels = Math.max(3, Math.min(10, Math.floor(right / 72)));
  const accepted = [];
  const keys = new Set();
  for (const candidate of candidates) {
    const overlaps = accepted.some((other) => (
      Math.abs(candidate.x - other.x) < (candidate.width + other.width) / 2 + TAPE_SWEEP_LABEL_MIN_GAP_X
      && Math.abs(candidate.y - other.y) < (candidate.height + other.height) / 2 + TAPE_SWEEP_LABEL_MIN_GAP_Y
    ));
    if (overlaps) continue;
    accepted.push(candidate);
    keys.add(candidate.key);
    if (accepted.length >= maximumLabels) break;
  }
  return keys;
}

'''
text = replace_once(
    text,
    "function drawTapeCard(card) {\n",
    series_draw_helpers + "function drawTapeCard(card) {\n",
    "series draw helpers",
)

live_agg_block = '''  const liveAggregates = visibleWaterTapeNodes(
    materializeZeroMsAggregates(
      state,
      state.aggSourceBuckets,
      state.finalizedAggScratch,
    ),
    window,
    state.closedAggScratch,
  );
'''
text = replace_once(
    text,
    live_agg_block,
    live_agg_block + '''  const liveSweeps = visibleWaterTapeNodes(
    materializeTapeSweeps(
      state,
      state.sweepSourceBuckets,
      state.finalizedSweepScratch,
    ),
    window,
    state.closedSweepScratch,
  );
''',
    "live series materialization",
)

text = replace_once(
    text,
    "  const sourceItems = state.mode === \"agg\" ? liveAggregates : recentRaw;\n",
    "  const sourceItems = state.mode === \"sweep\" ? liveSweeps : state.mode === \"agg\" ? liveAggregates : recentRaw;\n",
    "series source selection",
)

text = replace_once(
    text,
    "    setTapeState(state, state.mode === \"agg\" ? \"Жду агрегированную сделку…\" : \"Жду сделку…\");\n",
    "    setTapeState(\n"
    "      state,\n"
    "      state.mode === \"sweep\"\n"
    "        ? \"Жду серию агрессивных сделок…\"\n"
    "        : state.mode === \"agg\"\n"
    "          ? \"Жду агрегированную сделку…\"\n"
    "          : \"Жду сделку…\",\n"
    "    );\n",
    "series empty state",
)

text = replace_once(
    text,
    "    const y = state.mode === \"agg\"\n"
    "      ? aggregateLabelY(state.priceViewport, item, projectedY)\n"
    "      : projectedY;\n",
    "    const y = state.mode !== \"raw\"\n"
    "      ? aggregateLabelY(state.priceViewport, item, projectedY)\n"
    "      : projectedY;\n",
    "series label y",
)

text = replace_once(
    text,
    "  const rawMarkerBatches = state.mode === \"raw\" && minQuote === 0\n"
    "    ? prepareRawTapeMarkerBatches(state)\n"
    "    : null;\n\n"
    "  for (const projected of items) {\n",
    "  const rawMarkerBatches = state.mode === \"raw\" && minQuote === 0\n"
    "    ? prepareRawTapeMarkerBatches(state)\n"
    "    : null;\n"
    "  const sweepLabelKeys = state.mode === \"sweep\"\n"
    "    ? selectTapeSweepLabelKeys(items, window, window.plotRight, minQuote > 0)\n"
    "    : null;\n\n"
    "  for (const projected of items) {\n",
    "series label selection",
)

text = replace_once(
    text,
    "    const strength = stableTapeQuoteStrength(item.quote);\n"
    "    const baseX = tapeTimeX(item.time, window, rect.width);\n\n"
    "    if (state.mode === \"raw\") {\n",
    "    const sizeQuote = state.mode === \"sweep\" ? Number(item.sizeQuote ?? item.quote) : Number(item.quote);\n"
    "    const strength = stableTapeQuoteStrength(sizeQuote);\n"
    "    const baseX = tapeTimeX(item.time, window, rect.width);\n\n"
    "    if (state.mode === \"raw\") {\n",
    "series size scale",
)

series_draw_branch = r'''
    if (state.mode === "sweep") {
      const openSeries = item.status === "open";
      const showLabel = Boolean(sweepLabelKeys?.has(item.key));
      const label = `Σ${formatTapeUsd(item.quote)}`;
      const measured = context.measureText(label).width;
      const height = clampTape(9 + strength * 5, 9, 16);
      const width = clampTape(measured + 12, 24, Math.min(96, rect.width * .30));
      const markerWidth = showLabel ? width : clampTape(6 + strength * 3, 6, 12);
      const x = aggregateStableX(
        baseX,
        item.timeOrdinal,
        markerWidth,
        window.plotRight,
      );
      drawTapeSweepDirection(
        context,
        state.priceViewport,
        item,
        x,
        buy,
        stroke,
        strength,
        openSeries,
      );
      if (showLabel) {
        roundedRectPath(context, x - width / 2, y - height / 2, width, height, height * .32);
        context.fillStyle = buy
          ? `rgba(42, 191, 137, ${openSeries ? .66 : .78})`
          : `rgba(222, 70, 87, ${openSeries ? .68 : .80})`;
        context.fill();
        context.lineWidth = 1.25;
        context.strokeStyle = stroke;
        context.stroke();
        context.fillStyle = "rgba(244, 250, 248, .99)";
        context.fillText(label, x, y + .2);
      }
      continue;
    }

'''
text = replace_once(
    text,
    "    const showLabel = minQuote > 0 || Boolean(item.showLabel);\n",
    series_draw_branch + "    const showLabel = minQuote > 0 || Boolean(item.showLabel);\n",
    "series painter branch",
)

write(path, text)

series_test = r'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  TAPE_SWEEP_MIN_AGGREGATES,
  TAPE_SWEEP_WINDOW_MS,
  aggregateTapeSweeps,
  materializeTapeSweeps,
  selectTapeSweepLabelKeys,
} from "./orderbook.js?v=26-92-tape-series-stage1-v1";

function agg({ key, time, side, quote, price, ordinal = 0 }) {
  return {
    key,
    eventTime: time,
    time,
    lastTime: time,
    timeOrdinal: ordinal,
    side,
    quote,
    quantity: quote / price,
    buyQuote: side === "buy" ? quote : 0,
    sellQuote: side === "sell" ? quote : 0,
    count: 1,
    firstPrice: price,
    lastPrice: price,
    minPrice: price,
    maxPrice: price,
    price,
  };
}

test("Series joins at least two same-side AGG inside 100 ms", () => {
  const groups = aggregateTapeSweeps([
    agg({ key: "a", time: 1_000, side: "buy", quote: 1_000, price: 100 }),
    agg({ key: "b", time: 1_060, side: "buy", quote: 5_000, price: 101 }),
  ]);
  assert.equal(TAPE_SWEEP_WINDOW_MS, 100);
  assert.equal(TAPE_SWEEP_MIN_AGGREGATES, 2);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].aggregateCount, 2);
  assert.equal(groups[0].quote, 6_000);
  assert.equal(groups[0].sizeQuote, 5_000);
  assert.equal(groups[0].closed, false);
  assert.equal(groups[0].labelPrice, 100.5);
});

test("Opposite side closes the current Series immediately", () => {
  const groups = aggregateTapeSweeps([
    agg({ key: "a", time: 1_000, side: "buy", quote: 1_000, price: 100 }),
    agg({ key: "b", time: 1_040, side: "buy", quote: 2_000, price: 101 }),
    agg({ key: "c", time: 1_050, side: "sell", quote: 3_000, price: 100.5 }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].side, "buy");
  assert.equal(groups[0].closed, true);

  const state = { sweepSnapshots: new Map() };
  const materialized = materializeTapeSweeps(state, groups);
  assert.equal(materialized[0].status, "sealed");
  assert.ok(Object.isFrozen(materialized[0]));
});

test("Series does not bridge more than 100 ms and does not show a single AGG", () => {
  const groups = aggregateTapeSweeps([
    agg({ key: "a", time: 1_000, side: "buy", quote: 1_000, price: 100 }),
    agg({ key: "b", time: 1_101, side: "buy", quote: 2_000, price: 101 }),
  ]);
  assert.deepEqual(groups, []);
});

test("Sealed Series snapshots preserve object identity", () => {
  const groups = aggregateTapeSweeps([
    agg({ key: "a", time: 1_000, side: "buy", quote: 1_000, price: 100 }),
    agg({ key: "b", time: 1_040, side: "buy", quote: 2_000, price: 101 }),
    agg({ key: "c", time: 1_050, side: "sell", quote: 3_000, price: 100.5 }),
  ]);
  const state = { sweepSnapshots: new Map() };
  const first = materializeTapeSweeps(state, groups)[0];
  const second = materializeTapeSweeps(state, groups)[0];
  assert.strictEqual(first, second);
});

test("Collision control keeps the stronger overlapping Series label", () => {
  const window = { startTime: 0, endTime: 10_000, duration: 10_000, plotRight: 500 };
  const projected = [
    { source: { key: "small", time: 5_000, timeOrdinal: 0, quote: 1_000, sizeQuote: 1_000, showLabel: true, status: "sealed" }, position: { y: 100 } },
    { source: { key: "large", time: 5_010, timeOrdinal: 0, quote: 10_000, sizeQuote: 8_000, showLabel: true, status: "sealed" }, position: { y: 101 } },
  ];
  const keys = selectTapeSweepLabelKeys(projected, window, 500);
  assert.equal(keys.size, 1);
  assert.ok(keys.has("large"));
});

test("Runtime cycles RAW to AGG to Series without touching Worker subscription", () => {
  const source = fs.readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
  assert.match(source, /state\.mode === "raw" \? "agg" : state\.mode === "agg" \? "sweep" : "raw"/);
  assert.match(source, /button\.textContent = mode === "agg" \? "AGG" : mode === "sweep" \? "СЕРИЯ" : "RAW"/);
  assert.match(source, /state\.sweepSourceBuckets = aggregateTapeSweeps\(state\.aggSourceBuckets\)/);
  assert.doesNotMatch(source, /updateAggTradeSubscriptions\([^)]*sweep/);
});
'''
write("test-tape-series-stage1-v1.mjs", series_test)

for file in ROOT.rglob("*"):
    if not file.is_file() or file.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".webmanifest"}:
        continue
    source = file.read_text(encoding="utf-8")
    if OLD_BUILD in source:
        file.write_text(source.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

version = read("VERSION.txt")
if NEW_BUILD not in version:
    raise RuntimeError("VERSION.txt was not bumped")
index = read("index.html")
if NEW_BUILD not in index:
    raise RuntimeError("index build was not bumped")
sw = read("sw.js")
if NEW_BUILD not in sw:
    raise RuntimeError("service worker build was not bumped")
boot = read("runtime-boot-recovery.js")
if NEW_BUILD not in boot:
    raise RuntimeError("boot recovery build was not bumped")
