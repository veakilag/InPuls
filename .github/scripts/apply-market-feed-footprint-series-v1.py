from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
OLD_BUILD = "26-86-global-connection-radar-cleanup-v1"
NEW_BUILD = "26-87-market-feed-footprint-series-v1"


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def write(name: str, text: str) -> None:
    (ROOT / name).write_text(text, encoding="utf-8")


def require(text: str, needle: str, name: str) -> None:
    if needle not in text:
        raise RuntimeError(f"{name}: missing anchor {needle!r}")


def replace_once(text: str, old: str, new: str, name: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{name}: expected exactly one occurrence, got {count}: {old[:100]!r}")
    return text.replace(old, new, 1)


def replace_balanced_block(text: str, start_pattern: str, replacement: str, name: str) -> str:
    match = re.search(start_pattern, text, re.M | re.S)
    if not match:
        raise RuntimeError(f"{name}: block start not found: {start_pattern}")
    open_index = match.end() - 1 if match.end() and text[match.end() - 1] == "{" else text.find("{", match.end())
    if open_index < 0:
        raise RuntimeError(f"{name}: opening brace not found")
    depth = 0
    quote = None
    escaped = False
    line_comment = False
    block_comment = False
    index = open_index
    while index < len(text):
        char = text[index]
        next_char = text[index + 1] if index + 1 < len(text) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            if char == "*" and next_char == "/":
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
        if char == "/" and next_char == "/":
            line_comment = True
            index += 2
            continue
        if char == "/" and next_char == "*":
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
    raise RuntimeError(f"{name}: unterminated block")


def replace_class_method(text: str, class_name: str, method_name: str, replacement: str, name: str) -> str:
    class_match = re.search(rf"class\s+{re.escape(class_name)}\s*\{{", text)
    if not class_match:
        raise RuntimeError(f"{name}: class {class_name} not found")
    method_match = re.search(
        rf"^\s{{2}}{re.escape(method_name)}\s*\([^)]*\)\s*\{{",
        text[class_match.end():],
        re.M,
    )
    if not method_match:
        raise RuntimeError(f"{name}: method {class_name}.{method_name} not found")
    absolute = class_match.end() + method_match.start()
    exact_start = text[absolute:absolute + len(method_match.group(0))]
    return replace_balanced_block(text, re.escape(exact_start), replacement, name)


app = read("app.js")
app = replace_once(
    app,
    '    this.connectionTimer = null;\n',
    '    this.connectionTimer = null;\n'
    '    this.endpointIndex = 0;\n'
    '    this.marketPacketReceived = false;\n',
    "app.js constructor",
)
connect_method = r'''  connect() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimer);
    this.manualClose = false;
    this.marketPacketReceived = false;

    const streams = [
      "!miniTicker@arr",
      "!markPrice@arr@1s",
      "!forceOrder@arr",
      "!bookTicker",
    ];
    const endpoints = [
      `wss://fstream.binance.com/stream?streams=${streams.join("/")}`,
      "wss://fstream.binance.com/ws",
    ];
    const endpoint = endpoints[this.endpointIndex % endpoints.length];
    const rawEndpoint = endpoint.endsWith("/ws");
    setConnection("connecting", "Подключение к Binance…");

    const socket = new WebSocket(endpoint);
    this.socket = socket;
    this.connectionTimer = setTimeout(() => {
      if (this.socket !== socket || this.marketPacketReceived) return;
      setConnection("offline", "Нет рыночных данных · резервный поток");
      this.endpointIndex = (this.endpointIndex + 1) % endpoints.length;
      socket.close();
    }, 10_000);

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      setConnection("connecting", "Синхронизация рынка…");
      if (rawEndpoint) this.#send("SUBSCRIBE", streams);
      if (this.trackedAggTrades.size) {
        this.#send(
          "SUBSCRIBE",
          [...this.trackedAggTrades].flatMap((symbol) => [
            `${symbol.toLowerCase()}@aggTrade`,
            `${symbol.toLowerCase()}@bookTicker`,
          ]),
        );
      }
    });

    socket.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.result === null || payload.id) return;
      const data = payload.data ?? payload;
      if (!this.marketPacketReceived) {
        this.marketPacketReceived = true;
        clearTimeout(this.connectionTimer);
        this.reconnectAttempt = 0;
        state.connectedAt = Date.now();
        setConnection("online", "Онлайн");
      }
      this.#handle(data);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.manualClose) return;
      clearTimeout(this.connectionTimer);
      if (!this.marketPacketReceived) {
        this.endpointIndex = (this.endpointIndex + 1) % endpoints.length;
      }
      this.reconnectAttempt += 1;
      const delay = this.marketPacketReceived
        ? Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5))
        : 750;
      setConnection("offline", `Переподключение через ${Math.max(1, Math.round(delay / 1000))}с`);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectionTimer);
      setConnection("offline", "Ошибка потока");
    });
  }'''
app = replace_class_method(app, "BinanceFeed", "connect", connect_method, "app.js connect")
write("app.js", app)

flow = read("orderbook-flow-workspace.js")
flow = replace_once(
    flow,
    'import { observability } from "./observability.js?v=render-scheduler-v1";\n',
    'import { formatCompactUsd } from "./engine.js?v=26-65-structured-signal-collection-v1";\n'
    'import { observability } from "./observability.js?v=render-scheduler-v1";\n',
    "flow import",
)
flow = replace_once(
    flow,
    "const footprintBySymbol = new Map();\n",
    "const footprintBySymbol = new Map();\nconst footprintSourceBySymbol = new Map();\n",
    "flow source map",
)
old_selector = r'''export function selectFootprintTapeTrades(detail) {
  if (!detail?.live) return [];
  // The guarded aggregation channel is continuous: it starts on @aggTrade,
  // promotes to individual @trade only after validation and falls back without
  // overlaps. Never mix both arrays in one footprint accumulator.
  if (Array.isArray(detail?.aggregationTrades)) return detail.aggregationTrades;
  return Array.isArray(detail?.trades) ? detail.trades : [];
}'''
new_selector = r'''export function selectFootprintTapeBatch(detail, previousSource = null) {
  if (!detail?.live) {
    return { trades: [], source: previousSource, replace: false };
  }
  const guarded = Array.isArray(detail?.aggregationTrades)
    ? detail.aggregationTrades
    : [];
  const stable = Array.isArray(detail?.trades) ? detail.trades : [];

  if (guarded.length) {
    return {
      trades: guarded,
      source: "guarded",
      replace: previousSource === "stable",
    };
  }
  if ((!previousSource || previousSource === "stable") && stable.length) {
    return { trades: stable, source: "stable", replace: false };
  }
  return { trades: [], source: previousSource, replace: false };
}

export function selectFootprintTapeTrades(detail) {
  return selectFootprintTapeBatch(detail).trades;
}'''
flow = replace_once(flow, old_selector, new_selector, "flow selector")
old_accept = r'''  const incoming = selectFootprintTapeTrades(detail);
  const accumulator = footprintBySymbol.get(symbol) ?? createFootprintAccumulator();
  footprintBySymbol.set(
    symbol,
    ingestFootprintTrades(
      accumulator,
      incoming,
      { replace: Boolean(detail?.replace) },
    ),
  );'''
new_accept = r'''  const previousSource = footprintSourceBySymbol.get(symbol) ?? null;
  const batch = selectFootprintTapeBatch(detail, previousSource);
  if (batch.source) footprintSourceBySymbol.set(symbol, batch.source);
  const accumulator = footprintBySymbol.get(symbol) ?? createFootprintAccumulator();
  footprintBySymbol.set(
    symbol,
    ingestFootprintTrades(
      accumulator,
      batch.trades,
      { replace: Boolean(detail?.replace || batch.replace) },
    ),
  );'''
flow = replace_once(flow, old_accept, new_accept, "flow accept")
helper_anchor = 'function formatQuoteVolume(value) {'
require(flow, helper_anchor, "flow style helper")
helper = r'''function footprintBookVolumeTextStyle(state, theme) {
  const card = state?.card ?? state?.canvas?.closest?.("[data-panel-id]") ?? null;
  const sample = card?.querySelector?.(".book-size")
    ?? (typeof document !== "undefined" ? document.querySelector(".book-size") : null);
  if (sample && typeof getComputedStyle === "function") {
    const computed = getComputedStyle(sample);
    return {
      color: computed.color || theme.text,
      font: `${computed.fontWeight || "700"} ${computed.fontSize || "7px"} ${computed.fontFamily || "Arial, sans-serif"}`,
    };
  }
  return { color: theme.text, font: "700 7px Arial, sans-serif" };
}

'''
flow = flow.replace(helper_anchor, helper + helper_anchor, 1)
flow = replace_once(
    flow,
    "      for (const cluster of clusters) {\n"
    "        const totalQuote = Math.max(Number.EPSILON, cluster.quote);\n",
    "      const columnMaximumCluster = Math.max(0, ...clusters.map((cluster) => Number(cluster.quote) || 0));\n"
    "      for (const cluster of clusters) {\n"
    "        const isColumnMaximum = columnMaximumCluster > 0\n"
    "          && Math.abs(Number(cluster.quote) - columnMaximumCluster) <= Math.max(1e-9, columnMaximumCluster * 1e-12);\n"
    "        const totalQuote = Math.max(Number.EPSILON, cluster.quote);\n",
    "flow column max",
)
old_stroke = r'''        state.context.lineWidth = 1.15;
        state.context.strokeRect(cellLeft, cellTop, cellWidth, cellHeight);

        const volumeText = formatQuoteVolume(cluster.quote);
        state.context.fillStyle = theme.text;
        state.context.font = "700 7px Arial, sans-serif";
        state.context.textAlign = "center";
        state.context.fillText(
          volumeText,
          dataLeft + dataWidth / 2,
          cluster.row.y,
          Math.max(1, dataWidth - 4),
        );
        state.context.font = "800 7px Inter, system-ui, sans-serif";'''
new_stroke = r'''        state.context.save();
        if (isColumnMaximum) {
          state.context.shadowBlur = 6;
          state.context.shadowColor = dominantSide === "B"
            ? rgbaHex(theme.green, .82)
            : dominantSide === "S"
              ? rgbaHex(theme.red, .82)
              : rgbaHex(theme.text, .55);
        }
        state.context.lineWidth = isColumnMaximum ? 2.15 : 1.15;
        state.context.strokeRect(cellLeft, cellTop, cellWidth, cellHeight);
        state.context.restore();

        const volumeText = formatCompactUsd(cluster.quote);
        const bookVolumeStyle = footprintBookVolumeTextStyle(state, theme);
        state.context.fillStyle = bookVolumeStyle.color;
        state.context.font = bookVolumeStyle.font;
        state.context.textAlign = "center";
        state.context.textBaseline = "middle";
        state.context.fillText(
          volumeText,
          dataLeft + dataWidth / 2,
          cluster.row.y,
          Math.max(1, dataWidth - 4),
        );
        state.context.textBaseline = "alphabetic";
        state.context.font = "800 7px Inter, system-ui, sans-serif";'''
flow = replace_once(flow, old_stroke, new_stroke, "flow label style")
write("orderbook-flow-workspace.js", flow)

book = read("orderbook.js")
book = replace_once(
    book,
    'export const TAPE_SWEEP_MAX_GAP_MS = 35;\n',
    'export const TAPE_SWEEP_WINDOW_MS = 100;\n'
    '// Compatibility alias for tests and external consumers.\n'
    'export const TAPE_SWEEP_MAX_GAP_MS = TAPE_SWEEP_WINDOW_MS;\n',
    "series constant",
)
old_title = '      ? `СЕРИЯ · ${source}: соседние AGG одной стороны объединяются при непрерывных ID, паузе до ${TAPE_SWEEP_MAX_GAP_MS} мс и обратном ходе не больше ${TAPE_SWEEP_MAX_REVERSE_TICKS} тика.`'
new_title = '      ? `СЕРИЯ · ${source}: агрессивные исполнения одной стороны за ${TAPE_SWEEP_WINDOW_MS} мс от первой сделки или до первой сделки в обратную сторону.`'
book = replace_once(book, old_title, new_title, "series title")
new_sweeps = r'''export function aggregateTapeSweeps(
  trades,
  {
    windowMs = TAPE_SWEEP_WINDOW_MS,
  } = {},
) {
  const safeWindowMs = Math.max(1, Number(windowMs) || TAPE_SWEEP_WINDOW_MS);
  const eventTimeOf = (trade) => Number(trade?.eventTime ?? trade?.tradeTime ?? trade?.time);
  const displayTimeOf = (trade) => {
    const receivedAt = Number(trade?.receivedAt);
    return Number.isFinite(receivedAt) && receivedAt > 0
      ? receivedAt
      : Number(trade?.time ?? eventTimeOf(trade));
  };
  const idOf = (trade) => Number(trade?.lastTradeId ?? trade?.firstTradeId ?? trade?.id);
  const ordered = [...(trades ?? [])]
    .filter((trade) => {
      const price = Number(trade?.price);
      const quote = Number(trade?.quote);
      return Number.isFinite(eventTimeOf(trade))
        && Number.isFinite(displayTimeOf(trade))
        && Number.isFinite(price)
        && price > 0
        && Number.isFinite(quote)
        && quote > 0;
    })
    .sort((left, right) => {
      const timeDelta = eventTimeOf(left) - eventTimeOf(right);
      if (timeDelta) return timeDelta;
      return idOf(left) - idOf(right);
    });

  const result = [];
  let current = null;

  const start = (trade) => {
    const eventTime = eventTimeOf(trade);
    const displayTime = displayTimeOf(trade);
    const price = Number(trade.price);
    const quantity = Math.max(0, Number(trade.quantity) || 0);
    const quote = Math.max(0, Number(trade.quote) || price * quantity);
    const tradeId = idOf(trade);
    current = {
      key: `sweep:${trade.side}:${tradeId}:${eventTime}`,
      kind: "sweep",
      side: trade.side === "sell" ? "sell" : "buy",
      firstTradeId: tradeId,
      lastTradeId: tradeId,
      firstEventTime: eventTime,
      lastEventTime: eventTime,
      firstTime: displayTime,
      lastTime: displayTime,
      startTime: displayTime,
      endTime: displayTime,
      firstPrice: price,
      lastPrice: price,
      price,
      minPrice: price,
      maxPrice: price,
      labelPrice: price,
      quantity,
      quote,
      sizeQuote: quote,
      peakAggregateQuote: quote,
      count: 1,
      aggregateCount: 1,
      durationMs: 0,
      eventTime,
      tradeTime: eventTime,
      receivedAt: displayTime,
      time: displayTime,
      timeOrdinal: Number(trade?.timeOrdinal) || 0,
      showLabel: true,
    };
  };

  const append = (trade) => {
    const eventTime = eventTimeOf(trade);
    const displayTime = displayTimeOf(trade);
    const price = Number(trade.price);
    const quantity = Math.max(0, Number(trade.quantity) || 0);
    const quote = Math.max(0, Number(trade.quote) || price * quantity);
    current.lastTradeId = idOf(trade);
    current.lastEventTime = eventTime;
    current.lastTime = displayTime;
    current.endTime = displayTime;
    current.lastPrice = price;
    current.price = price;
    current.minPrice = Math.min(current.minPrice, price);
    current.maxPrice = Math.max(current.maxPrice, price);
    current.quantity += quantity;
    current.quote += quote;
    current.sizeQuote = Math.max(current.sizeQuote, quote);
    current.peakAggregateQuote = current.sizeQuote;
    current.count += 1;
    current.aggregateCount += 1;
  };

  const finish = () => {
    if (!current) return;
    if (current.count >= TAPE_SWEEP_MIN_AGGREGATES) {
      current.durationMs = Math.max(0, current.lastEventTime - current.firstEventTime);
      current.time = current.firstTime + Math.max(0, current.lastTime - current.firstTime) / 2;
      current.receivedAt = current.time;
      current.eventTime = current.firstEventTime + current.durationMs / 2;
      current.tradeTime = current.eventTime;
      current.labelPrice = (current.firstPrice + current.lastPrice) / 2;
      current.vwapPrice = current.quantity > 0 ? current.quote / current.quantity : current.firstPrice;
      result.push(current);
    }
    current = null;
  };

  for (const trade of ordered) {
    const side = trade.side === "sell" ? "sell" : "buy";
    const eventTime = eventTimeOf(trade);
    if (!current) {
      start({ ...trade, side });
      continue;
    }
    const opposite = side !== current.side;
    const outsideWindow = eventTime - current.firstEventTime > safeWindowMs;
    if (opposite || outsideWindow) {
      finish();
      start({ ...trade, side });
      continue;
    }
    append({ ...trade, side });
  }
  finish();
  return result;
}'''
book = replace_balanced_block(book, r'export function aggregateTapeSweeps\([\s\S]*?\n\) \{', new_sweeps, "aggregateTapeSweeps")
book = replace_once(
    book,
    "  state.sweepSourceBuckets = aggregateTapeSweeps(state.aggSourceBuckets);\n",
    "  state.sweepSourceBuckets = aggregateTapeSweeps(aggregationInput);\n",
    "series raw input",
)
write("orderbook.js", book)

focused = r'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { TAPE_SWEEP_WINDOW_MS, aggregateTapeSweeps } from "./orderbook.js?v=26-87-market-feed-footprint-series-v1";
import { selectFootprintTapeBatch } from "./orderbook-flow-workspace.js?v=26-87-market-feed-footprint-series-v1";

const trade = (id, eventTime, receivedAt, price, side, quote = 1_000) => ({
  id, firstTradeId: id, lastTradeId: id, eventTime, tradeTime: eventTime,
  receivedAt, time: receivedAt, price, quantity: quote / price, quote, side,
});

test("global market feed starts on combined streams and only becomes online after data", () => {
  const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /fstream\.binance\.com\/stream\?streams=/);
  assert.match(app, /fstream\.binance\.com\/ws/);
  assert.match(app, /if \(!this\.marketPacketReceived\)/);
  assert.match(app, /setConnection\("online", "Онлайн"\)/);
  assert.match(app, /Нет рыночных данных · резервный поток/);
});

test("footprint bootstraps from stable Tape and switches once to guarded flow", () => {
  const stable = [{ id: 1 }];
  const guarded = [{ id: 2 }];
  assert.deepEqual(selectFootprintTapeBatch({ live: true, trades: stable, aggregationTrades: [] }, null), { trades: stable, source: "stable", replace: false });
  assert.deepEqual(selectFootprintTapeBatch({ live: true, trades: stable, aggregationTrades: guarded }, "stable"), { trades: guarded, source: "guarded", replace: true });
  assert.deepEqual(selectFootprintTapeBatch({ live: true, trades: stable, aggregationTrades: [] }, "guarded"), { trades: [], source: "guarded", replace: false });
});

test("Series groups raw aggressive trades for 100 ms and closes on the first opposite trade", () => {
  const series = aggregateTapeSweeps([
    trade(1, 1_000, 2_000, 100, "buy", 1_000),
    trade(2, 1_040, 2_040, 101, "buy", 2_000),
    trade(3, 1_100, 2_100, 102, "buy", 3_000),
    trade(4, 1_101, 2_101, 101, "sell", 4_000),
    trade(5, 1_150, 2_150, 100, "sell", 5_000),
  ]);
  assert.equal(TAPE_SWEEP_WINDOW_MS, 100);
  assert.equal(series.length, 2);
  assert.equal(series[0].side, "buy");
  assert.equal(series[0].count, 3);
  assert.equal(series[0].quote, 6_000);
  assert.equal(series[0].time, 2_050);
  assert.equal(series[0].labelPrice, 101);
  assert.equal(series[0].sizeQuote, 3_000);
  assert.equal(series[1].side, "sell");
  assert.equal(series[1].count, 2);
});

test("same-side trades outside the 100 ms window start a new Series", () => {
  const series = aggregateTapeSweeps([
    trade(10, 5_000, 6_000, 10, "buy"),
    trade(11, 5_100, 6_100, 11, "buy"),
    trade(12, 5_101, 6_101, 12, "buy"),
    trade(13, 5_150, 6_150, 13, "buy"),
  ]);
  assert.equal(series.length, 2);
  assert.equal(series[0].count, 2);
  assert.equal(series[1].count, 2);
});

test("footprint uses order-book USD formatting and highlights the column maximum", () => {
  const source = fs.readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
  assert.match(source, /formatCompactUsd\(cluster\.quote\)/);
  assert.match(source, /querySelector\?\.\("\.book-size"\)/);
  assert.match(source, /const isColumnMaximum =/);
  assert.match(source, /lineWidth = isColumnMaximum \? 2\.15 : 1\.15/);
});
'''
write("test-market-feed-footprint-series-v1.mjs", focused)

sweep_test = read("test-sweep-tape-clock-v1.mjs")
sweep_test = sweep_test.replace("  TAPE_SWEEP_MAX_GAP_MS,\n", "  TAPE_SWEEP_MAX_GAP_MS,\n  TAPE_SWEEP_WINDOW_MS,\n")
first_start = sweep_test.index('test("Series joins adjacent same-side AGG')
third_start = sweep_test.index('test("sealed Series history')
replacement_tests = r'''test("Series groups same-side raw executions for a fixed 100 ms window", () => {
  const sweeps = aggregateTapeSweeps([
    trade(1, 1_000, 100, "buy"),
    trade(2, 1_040, 101, "buy"),
    trade(3, 1_100, 102, "buy"),
    trade(4, 1_101, 101, "sell"),
    trade(5, 1_150, 99, "sell"),
  ]);
  assert.equal(TAPE_SWEEP_WINDOW_MS, 100);
  assert.equal(TAPE_SWEEP_MAX_GAP_MS, 100);
  assert.equal(TAPE_SWEEP_MIN_AGGREGATES, 2);
  assert.equal(sweeps.length, 2);
  assert.equal(sweeps[0].aggregateCount, 3);
  assert.equal(sweeps[0].count, 3);
  assert.equal(sweeps[0].durationMs, 100);
  assert.equal(sweeps[0].labelPrice, 101);
  assert.equal(sweeps[0].kind, "sweep");
});

test("the first opposite execution closes the current Series immediately", () => {
  const sweeps = aggregateTapeSweeps([
    trade(10, 2_000, 10, "sell"),
    trade(11, 2_010, 9, "sell"),
    trade(12, 2_011, 10, "buy"),
    trade(13, 2_020, 11, "buy"),
  ]);
  assert.equal(sweeps.length, 2);
  assert.equal(sweeps[0].side, "sell");
  assert.equal(sweeps[1].side, "buy");
});

'''
sweep_test = sweep_test[:first_start] + replacement_tests + sweep_test[third_start:]
sweep_test = sweep_test.replace("const firstGroups = aggregateTapeSweeps(aggregateTapeZeroMs([", "const firstGroups = aggregateTapeSweeps([")
sweep_test = sweep_test.replace("  ]));\n  const firstView", "  ]);\n  const firstView", 1)
sweep_test = sweep_test.replace("const nextGroups = aggregateTapeSweeps(aggregateTapeZeroMs([", "const nextGroups = aggregateTapeSweeps([")
sweep_test = sweep_test.replace("  ]));\n  const nextView", "  ]);\n  const nextView", 1)
sweep_test = sweep_test.replace('assert.match(source, /current\\.aggregateCount >= TAPE_SWEEP_MIN_AGGREGATES/);', 'assert.match(source, /current\\.count >= TAPE_SWEEP_MIN_AGGREGATES/);')
sweep_test = sweep_test.replace('assert.match(source, /state\\.context\\.font = "700 7px Arial, sans-serif"/);', 'assert.match(source, /formatCompactUsd\\(cluster\\.quote\\)/);\n  assert.match(source, /querySelector\\?\\.\\("\\.book-size"\\)/);')
write("test-sweep-tape-clock-v1.mjs", sweep_test)

connection_test = read("test-global-connection-radar-cleanup-v1.mjs")
connection_test = connection_test.replace('test("global market feed uses the supported raw subscription endpoint", async () => {', 'test("global market feed uses combined streams with a raw fallback", async () => {')
connection_test = connection_test.replace(
    '  assert.match(app, /wss:\\\/\\\/fstream\\.binance\\.com\\/ws/);\n  assert.doesNotMatch(app, /fstream\\.binance\\.com\\/market\\/stream/);\n  assert.match(app, /socket\\.readyState !== WebSocket\\.CONNECTING/);\n  assert.match(app, /Binance не отвечает/);\n',
    '  assert.match(app, /fstream\\.binance\\.com\\/stream\\?streams=/);\n  assert.match(app, /wss:\\\/\\\/fstream\\.binance\\.com\\/ws/);\n  assert.doesNotMatch(app, /fstream\\.binance\\.com\\/market\\/stream/);\n  assert.match(app, /marketPacketReceived/);\n  assert.match(app, /Нет рыночных данных · резервный поток/);\n',
)
write("test-global-connection-radar-cleanup-v1.mjs", connection_test)

for path in ROOT.rglob("*"):
    if not path.is_file() or ".git" in path.parts or ".github" in path.parts:
        continue
    if path.suffix not in {".js", ".mjs", ".html", ".txt"}:
        continue
    text = path.read_text(encoding="utf-8")
    if OLD_BUILD in text:
        path.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

version = read("VERSION.txt")
if "combined-market-feed-fallback-v1" not in version:
    version = version.rstrip() + ", combined-market-feed-fallback-v1, footprint-poc-v1, raw-100ms-series-v1\n"
write("VERSION.txt", version)

print("Applied", NEW_BUILD)
