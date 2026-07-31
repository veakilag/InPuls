from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
OLD_BUILD = "26-87-market-feed-footprint-series-v1"
NEW_BUILD = "26-88-split-market-public-feed-v1"


def read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def write(name: str, text: str) -> None:
    (ROOT / name).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, name: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{name}: expected exactly one occurrence, got {count}: {old[:140]!r}")
    return text.replace(old, new, 1)


def replace_balanced_block(text: str, start_pattern: str, replacement: str, name: str) -> str:
    match = re.search(start_pattern, text, re.M | re.S)
    if not match:
        raise RuntimeError(f"{name}: block start not found: {start_pattern}")
    open_index = match.end() - 1 if text[match.end() - 1] == "{" else text.find("{", match.end())
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


routing = r'''const CHANNEL_BASES = Object.freeze({
  market: "wss://fstream.binance.com/market/stream",
  public: "wss://fstream.binance.com/public/stream",
});

const GLOBAL_STREAMS = Object.freeze({
  market: Object.freeze([
    "!miniTicker@arr",
    "!markPrice@arr@1s",
    "!forceOrder@arr",
  ]),
  public: Object.freeze(["!bookTicker"]),
});

function normalizeSymbols(symbols) {
  return [...new Set([...(symbols ?? [])]
    .map((symbol) => String(symbol ?? "").trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]{1,20}USDT$/.test(symbol)))];
}

export function buildBinanceChannelStreams(kind, symbols = []) {
  if (!(kind in GLOBAL_STREAMS)) throw new TypeError(`Unknown Binance channel: ${kind}`);
  const streams = [...GLOBAL_STREAMS[kind]];
  if (kind === "market") {
    for (const symbol of normalizeSymbols(symbols)) {
      streams.push(`${symbol.toLowerCase()}@aggTrade`);
    }
  }
  return [...new Set(streams)];
}

export function buildBinanceChannelTransports(kind, streams) {
  const base = CHANNEL_BASES[kind];
  if (!base) throw new TypeError(`Unknown Binance channel: ${kind}`);
  const normalized = [...new Set((streams ?? []).map(String).filter(Boolean))];
  if (!normalized.length) throw new TypeError(`Binance ${kind} channel requires streams`);
  return [
    {
      name: `${kind} · combined`,
      url: `${base}?streams=${normalized.join("/")}`,
      subscribeOnOpen: false,
    },
    {
      name: `${kind} · subscribe`,
      url: base,
      subscribeOnOpen: true,
    },
  ];
}

export function nextBinanceTransportIndex(current, count, receivedRequiredPacket = false) {
  const total = Math.max(1, Math.floor(Number(count) || 1));
  const index = ((Math.floor(Number(current) || 0) % total) + total) % total;
  return receivedRequiredPacket ? index : (index + 1) % total;
}

export function isBinanceSubscriptionError(payload) {
  return Boolean(payload && typeof payload === "object" && Number.isFinite(Number(payload.code)));
}

export function isCoreMiniTickerPacket(data) {
  return Array.isArray(data) && data.some((ticker) =>
    ticker?.e === "24hrMiniTicker"
    && typeof ticker?.s === "string"
    && ticker.s.endsWith("USDT")
    && Number.isFinite(Number(ticker.c))
    && Number(ticker.c) > 0,
  );
}
'''
write("binance-stream-routing.js", routing)

app = read("app.js")
route_import = (
    'import { buildBinanceChannelStreams, buildBinanceChannelTransports, '
    'isBinanceSubscriptionError, isCoreMiniTickerPacket, nextBinanceTransportIndex } '
    f'from "./binance-stream-routing.js?v={NEW_BUILD}";\n'
)
if "./binance-stream-routing.js" not in app:
    app = route_import + app

binance_feed = r'''class BinanceFeed {
  constructor() {
    this.trackedAggTrades = new Set();
    this.requestId = 1;
    this.manualClose = false;
    this.channels = new Map([
      ["market", this.#createChannelState()],
      ["public", this.#createChannelState()],
    ]);
  }

  #createChannelState() {
    return {
      socket: null,
      reconnectTimer: null,
      watchdogTimer: null,
      reconnectAttempt: 0,
      transportIndex: 0,
      packetReceived: false,
      corePacketReceived: false,
      generation: 0,
    };
  }

  connect() {
    this.manualClose = false;
    this.#connectChannel("market");
    this.#connectChannel("public");
  }

  #connectChannel(kind) {
    const channel = this.channels.get(kind);
    if (!channel) return;
    clearTimeout(channel.reconnectTimer);
    clearTimeout(channel.watchdogTimer);
    channel.reconnectTimer = null;
    channel.watchdogTimer = null;
    channel.packetReceived = false;
    channel.corePacketReceived = false;
    channel.generation += 1;
    const generation = channel.generation;

    const previousSocket = channel.socket;
    channel.socket = null;
    try { previousSocket?.close(); } catch {}

    const streams = buildBinanceChannelStreams(kind, this.trackedAggTrades);
    const transports = buildBinanceChannelTransports(kind, streams);
    const transport = transports[channel.transportIndex % transports.length];
    if (kind === "market") setConnection("connecting", "Подключение к Binance…");

    let socket;
    try {
      socket = new WebSocket(transport.url);
    } catch {
      channel.transportIndex = nextBinanceTransportIndex(
        channel.transportIndex,
        transports.length,
        false,
      );
      channel.reconnectAttempt += 1;
      if (kind === "market") setConnection("offline", "Ошибка подключения Binance");
      channel.reconnectTimer = setTimeout(() => this.#connectChannel(kind), 750);
      return;
    }
    channel.socket = socket;

    channel.watchdogTimer = setTimeout(() => {
      if (channel.socket !== socket || generation !== channel.generation) return;
      const requiredPacketReceived = kind === "market"
        ? channel.corePacketReceived
        : channel.packetReceived;
      if (requiredPacketReceived) return;
      if (kind === "market") {
        setConnection("offline", "Нет miniTicker · резервный market-поток");
      }
      try { socket.close(); } catch {}
    }, 10_000);

    socket.addEventListener("open", () => {
      if (channel.socket !== socket || generation !== channel.generation) return;
      if (kind === "market") setConnection("connecting", "Синхронизация рынка…");
      if (transport.subscribeOnOpen) this.#send(kind, "SUBSCRIBE", streams);
    });

    socket.addEventListener("message", (event) => {
      if (channel.socket !== socket || generation !== channel.generation) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (isBinanceSubscriptionError(payload)) {
        if (kind === "market") setConnection("offline", "Ошибка подписки Binance");
        try { socket.close(); } catch {}
        return;
      }
      if (payload?.result === null || (payload?.id && payload?.result !== undefined)) return;

      const data = payload?.data ?? payload;
      channel.packetReceived = true;
      if (kind === "public") {
        clearTimeout(channel.watchdogTimer);
        channel.watchdogTimer = null;
        channel.reconnectAttempt = 0;
      } else if (isCoreMiniTickerPacket(data)) {
        channel.corePacketReceived = true;
        clearTimeout(channel.watchdogTimer);
        channel.watchdogTimer = null;
        channel.reconnectAttempt = 0;
        state.connectedAt = Date.now();
        setConnection("online", "Онлайн");
      }
      this.#handle(data);
    });

    socket.addEventListener("close", () => {
      if (channel.socket !== socket || generation !== channel.generation || this.manualClose) return;
      channel.socket = null;
      clearTimeout(channel.watchdogTimer);
      channel.watchdogTimer = null;
      const requiredPacketReceived = kind === "market"
        ? channel.corePacketReceived
        : channel.packetReceived;
      channel.transportIndex = nextBinanceTransportIndex(
        channel.transportIndex,
        transports.length,
        requiredPacketReceived,
      );
      channel.reconnectAttempt += 1;
      const delay = requiredPacketReceived
        ? Math.min(30_000, 1000 * 2 ** Math.min(channel.reconnectAttempt, 5))
        : 750;
      if (kind === "market") {
        setConnection("offline", `Переподключение через ${Math.max(1, Math.round(delay / 1000))}с`);
      }
      channel.reconnectTimer = setTimeout(() => this.#connectChannel(kind), delay);
    });

    socket.addEventListener("error", () => {
      if (channel.socket !== socket || generation !== channel.generation) return;
      if (kind === "market") setConnection("offline", "Ошибка market-потока");
      try { socket.close(); } catch {}
    });
  }

  updateAggTradeSubscriptions(symbols) {
    const next = new Set(normalizeSymbolList(symbols));
    const subscribe = [...next].filter((symbol) => !this.trackedAggTrades.has(symbol));
    const unsubscribe = [...this.trackedAggTrades].filter((symbol) => !next.has(symbol));
    this.trackedAggTrades = next;
    if (unsubscribe.length) {
      this.#send(
        "market",
        "UNSUBSCRIBE",
        unsubscribe.map((symbol) => `${symbol.toLowerCase()}@aggTrade`),
      );
    }
    if (subscribe.length) {
      this.#send(
        "market",
        "SUBSCRIBE",
        subscribe.map((symbol) => `${symbol.toLowerCase()}@aggTrade`),
      );
    }
  }

  #send(kind, method, params) {
    const socket = this.channels.get(kind)?.socket;
    if (socket?.readyState !== WebSocket.OPEN || !params.length) return;
    socket.send(JSON.stringify({ method, params, id: this.requestId++ }));
  }

  #handle(data) {
    if (Array.isArray(data)) {
      let hasMarketTicker = false;
      for (const ticker of data) {
        if (ticker?.e === "bookTicker" && isUsdtPerpetualSymbol(ticker.s)) {
          marketSizeScanner.ingestBookTicker(ticker);
          if (this.trackedAggTrades.has(ticker.s)) {
            getSymbol(ticker.s, Number(ticker.E) || Date.now())?.updateBookTicker(ticker);
          }
          continue;
        }
        if (ticker?.e === "markPriceUpdate" && isUsdtPerpetualSymbol(ticker.s)) {
          getSymbol(ticker.s, Number(ticker.E) || Date.now())?.updateFunding(ticker);
          continue;
        }
        if (!filterUsdtPerpetualTicker(ticker)) continue;
        getSymbol(ticker.s, Number(ticker.E) || Date.now())?.updateTicker(ticker);
        hasMarketTicker = true;
      }
      if (hasMarketTicker) collectSignalMemoryFromFeed(Date.now());
      if (hasMarketTicker) scheduleRender();
      return;
    }
    if (!data || typeof data !== "object") return;
    if (data.e === "bookTicker" && isUsdtPerpetualSymbol(data.s)) {
      marketSizeScanner.ingestBookTicker(data);
      if (this.trackedAggTrades.has(data.s)) {
        getSymbol(data.s, Number(data.E) || Date.now())?.updateBookTicker(data);
      }
      return;
    }
    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data) && this.trackedAggTrades.has(data.s)) {
      getSymbol(data.s)?.updateTrade(data);
      return;
    }
    if (data.e === "forceOrder") {
      const symbol = data.o?.s;
      if (isUsdtPerpetualSymbol(symbol) && (data.st === undefined || Number(data.st) === 1)) {
        getSymbol(symbol)?.updateLiquidation(data);
        scheduleRender();
      }
    }
  }
}'''
app = replace_balanced_block(app, r"class\s+BinanceFeed\s*\{", binance_feed, "app.js BinanceFeed")

extra_feed_old = r'''  const panel = { model, element: article, chart, feed: null };
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
  });'''
extra_feed_new = r'''  const panel = { model, element: article, chart, feed: null };
  const liveEmitPhaseMs = [...String(model.id)].reduce(
    (value, character) => (value * 33 + character.charCodeAt(0)) % 600,
    0,
  );
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
    liveEmitIntervalMs: 600,
    liveEmitPhaseMs,
  });'''
app = replace_once(app, extra_feed_old, extra_feed_new, "app.js extra chart phased updates")
write("app.js", app)

worker = read("orderbook-worker.js")
worker = replace_once(
    worker,
    r'''function tradeStreams(symbol) {
  const name = symbol.toLowerCase();
  // @aggTrade remains the stable visual RAW feed. @trade is consumed only by
  // the guarded Tiger-style 0 ms aggregation channel.
  return [`${name}@aggTrade`, `${name}@trade`];
}

function tradeTransports(streams) {
  const joined = streams.join("/");
  return [
    { name: "market · combined", url: `wss://fstream.binance.com/market/stream?streams=${joined}`, subscribe: false, streams },
    { name: "market · raw", url: `wss://fstream.binance.com/market/ws/${joined}`, subscribe: false, streams },
  ];
}''',
    r'''function tradeStreams(symbol) {
  const name = symbol.toLowerCase();
  // Production Tape uses the documented USD-M Futures @aggTrade stream.
  // Undocumented @trade remains excluded until a separate shadow study proves
  // continuity, duplication and latency behaviour over a long observation.
  return [`${name}@aggTrade`];
}

function tradeTransports(streams) {
  const stream = String(streams?.[0] ?? "");
  return [
    { name: "market · combined", url: `wss://fstream.binance.com/market/stream?streams=${stream}`, subscribe: false, streams: [stream] },
    { name: "market · raw", url: `wss://fstream.binance.com/market/ws/${stream}`, subscribe: false, streams: [stream] },
  ];
}''',
    "orderbook-worker trade transports",
)
worker = worker.replace(
    "        // The second channel is sequence-guarded. It starts on @aggTrade,\n"
    "        // promotes to individual @trade after warm-up, and falls back without\n"
    "        // overlaps when raw IDs gap, reorder or go stale.\n",
    "        // The guarded production path follows the same documented @aggTrade\n"
    "        // stream and keeps continuity/dedup protection without mixing sources.\n",
    1,
)
write("orderbook-worker.js", worker)

chart = read("chart.js")
phased_helper_anchor = "export function upsertLiveCandleInPlace(candles, candle, limit = 180) {"
if "export function phasedLiveEmitDelay" not in chart:
    helper = r'''export function phasedLiveEmitDelay(now, intervalMs = 0, phaseMs = 0) {
  const current = Number(now);
  const interval = Math.max(0, Math.floor(Number(intervalMs) || 0));
  if (!Number.isFinite(current) || interval <= 0) return 0;
  const rawPhase = Math.floor(Number(phaseMs) || 0);
  const phase = ((rawPhase % interval) + interval) % interval;
  const remainder = ((Math.floor(current) - phase) % interval + interval) % interval;
  return remainder === 0 ? 0 : interval - remainder;
}

'''
    chart = chart.replace(phased_helper_anchor, helper + phased_helper_anchor, 1)

chart = replace_once(
    chart,
    "  constructor({ onData, onStatus }) {\n"
    "    this.onData = onData;\n"
    "    this.onStatus = onStatus;\n",
    "  constructor({ onData, onStatus, liveEmitIntervalMs = 0, liveEmitPhaseMs = 0 }) {\n"
    "    this.onData = onData;\n"
    "    this.onStatus = onStatus;\n"
    "    this.liveEmitIntervalMs = Math.max(0, Math.floor(Number(liveEmitIntervalMs) || 0));\n"
    "    this.liveEmitPhaseMs = Math.floor(Number(liveEmitPhaseMs) || 0);\n",
    "chart KlineFeed constructor",
)

old_schedule = r'''  #scheduleLiveEmit(meta) {
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
  }'''
new_schedule = r'''  #scheduleLiveEmit(meta) {
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
    const scheduleFrame = () => {
      if (typeof globalThis.requestAnimationFrame === "function") {
        this.liveEmitKind = "raf";
        this.liveEmitHandle = globalThis.requestAnimationFrame(emit);
      } else {
        this.liveEmitKind = "timeout";
        this.liveEmitHandle = setTimeout(emit, 16);
      }
    };
    const delay = phasedLiveEmitDelay(
      Date.now(),
      this.liveEmitIntervalMs,
      this.liveEmitPhaseMs,
    );
    if (delay > 8) {
      this.liveEmitKind = "timeout";
      this.liveEmitHandle = setTimeout(() => {
        this.liveEmitHandle = null;
        this.liveEmitKind = null;
        scheduleFrame();
      }, delay);
      return;
    }
    scheduleFrame();
  }'''
chart = replace_once(chart, old_schedule, new_schedule, "chart phased live scheduler")
write("chart.js", chart)

sw = read("sw.js")
forced_anchor = f'  ["/app.js", "./app.js?v={OLD_BUILD}"],\n'
if "/binance-stream-routing.js" not in sw:
    sw = replace_once(
        sw,
        forced_anchor,
        forced_anchor + f'  ["/binance-stream-routing.js", "./binance-stream-routing.js?v={NEW_BUILD}"],\n',
        "sw forced routing module",
    )
shell_anchor = f'  "./app.js?v={OLD_BUILD}",\n'
if f'"./binance-stream-routing.js?v={NEW_BUILD}"' not in sw:
    sw = replace_once(
        sw,
        shell_anchor,
        shell_anchor + f'  "./binance-stream-routing.js?v={NEW_BUILD}",\n',
        "sw shell routing module",
    )
write("sw.js", sw)

global_test = f'''import test from "node:test";
import assert from "node:assert/strict";
import {{ readFile }} from "node:fs/promises";

import {{
  buildBinanceChannelStreams,
  buildBinanceChannelTransports,
  isBinanceSubscriptionError,
  isCoreMiniTickerPacket,
  nextBinanceTransportIndex,
}} from "./binance-stream-routing.js?v={NEW_BUILD}";

const source = (name) => readFile(new URL(`./${{name}}`, import.meta.url), "utf8");

test("global feed separates Binance market and public namespaces", () => {{
  const market = buildBinanceChannelStreams("market", ["BTCUSDT", "ETHUSDT"]);
  const publicStreams = buildBinanceChannelStreams("public", ["BTCUSDT"]);
  assert.deepEqual(market.slice(0, 3), ["!miniTicker@arr", "!markPrice@arr@1s", "!forceOrder@arr"]);
  assert.ok(market.includes("btcusdt@aggTrade"));
  assert.ok(market.includes("ethusdt@aggTrade"));
  assert.ok(!market.some((stream) => stream.includes("bookTicker")));
  assert.deepEqual(publicStreams, ["!bookTicker"]);

  const marketTransports = buildBinanceChannelTransports("market", market);
  const publicTransports = buildBinanceChannelTransports("public", publicStreams);
  assert.match(marketTransports[0].url, /fstream\\.binance\\.com\\/market\\/stream\\?streams=/);
  assert.match(publicTransports[0].url, /fstream\\.binance\\.com\\/public\\/stream\\?streams=/);
  assert.equal(marketTransports[1].url, "wss://fstream.binance.com/market/stream");
  assert.equal(publicTransports[1].url, "wss://fstream.binance.com/public/stream");
}});

test("fallback transport advances exactly once before required data", () => {{
  assert.equal(nextBinanceTransportIndex(0, 2, false), 1);
  assert.equal(nextBinanceTransportIndex(1, 2, false), 0);
  assert.equal(nextBinanceTransportIndex(1, 2, true), 1);
}});

test("online requires a real miniTicker batch and subscription errors stay visible", () => {{
  assert.equal(isCoreMiniTickerPacket([{{ e: "markPriceUpdate", s: "BTCUSDT", p: "1" }}]), false);
  assert.equal(isCoreMiniTickerPacket([{{ e: "24hrMiniTicker", s: "BTCUSDT", c: "65000" }}]), true);
  assert.equal(isBinanceSubscriptionError({{ code: 2, msg: "Invalid request", id: 4 }}), true);
}});

test("runtime no longer mixes market and public streams on root endpoints", async () => {{
  const [app, worker] = await Promise.all([source("app.js"), source("orderbook-worker.js")]);
  assert.match(app, /#connectChannel\("market"\)/);
  assert.match(app, /#connectChannel\("public"\)/);
  assert.doesNotMatch(app, /fstream\\.binance\\.com\\/(?:stream|ws)(?:\\?|"|`)/);
  const workerRouting = worker.match(/function tradeStreams[\\s\\S]*?function trimSide/)?.[0] ?? "";
  assert.match(workerRouting, /return \[`\\${{name}}@aggTrade`\]/);
  assert.doesNotMatch(workerRouting, /@trade`/);
  assert.match(workerRouting, /market\\/ws\\/\\${{stream}}/);
  assert.doesNotMatch(workerRouting, /market\\/ws\\/\\${{joined}}/);
}});

test("Event Radar Beta assets are removed from runtime and PWA cache", async () => {{
  const [html, app, worker] = await Promise.all([
    source("index.html"), source("app.js"), source("sw.js"),
  ]);
  for (const text of [html, app, worker]) {{
    assert.doesNotMatch(text, /event-radar-beta/);
    assert.doesNotMatch(text, /inpuls:event-radar-/);
  }}
}});
'''
write("test-global-connection-radar-cleanup-v1.mjs", global_test)

market_test = read("test-market-feed-footprint-series-v1.mjs")
old_market_test = r'''test("global market feed starts on combined streams and only becomes online after data", () => {
  const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /fstream\.binance\.com\/stream\?streams=/);
  assert.match(app, /fstream\.binance\.com\/ws/);
  assert.match(app, /if \(!this\.marketPacketReceived\)/);
  assert.match(app, /setConnection\("online", "Онлайн"\)/);
  assert.match(app, /Нет рыночных данных · резервный поток/);
});'''
new_market_test = r'''test("global market feed goes online only after a valid miniTicker packet", () => {
  const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /isCoreMiniTickerPacket\(data\)/);
  assert.match(app, /setConnection\("online", "Онлайн"\)/);
  assert.match(app, /Нет miniTicker · резервный market-поток/);
  assert.match(app, /isBinanceSubscriptionError\(payload\)/);
});'''
market_test = replace_once(market_test, old_market_test, new_market_test, "market feed focused test")
write("test-market-feed-footprint-series-v1.mjs", market_test)

chart_test = f'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {{ phasedLiveEmitDelay }} from "./chart.js?v=23";

test("parallel chart phases spread canvas work across the interval", () => {{
  assert.equal(phasedLiveEmitDelay(1_200, 600, 0), 0);
  assert.equal(phasedLiveEmitDelay(1_200, 600, 150), 150);
  assert.equal(phasedLiveEmitDelay(1_200, 600, 300), 300);
  assert.equal(phasedLiveEmitDelay(1_234, 0, 300), 0);
}});

test("extra charts use phased updates while the primary chart remains unrestricted", () => {{
  const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const chart = fs.readFileSync(new URL("./chart.js", import.meta.url), "utf8");
  assert.match(app, /liveEmitIntervalMs: 600/);
  assert.match(app, /liveEmitPhaseMs/);
  assert.match(chart, /phasedLiveEmitDelay/);
  assert.match(chart, /this\.liveEmitIntervalMs/);
}});
'''
write("test-parallel-chart-phasing-v1.mjs", chart_test)

# Bump all runtime/cache/test references without touching this temporary migration.
for path in ROOT.rglob("*"):
    if not path.is_file() or ".git" in path.parts or ".github" in path.parts:
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".webmanifest"}:
        continue
    text = path.read_text(encoding="utf-8")
    if OLD_BUILD in text:
        path.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

version = read("VERSION.txt")
if "split-market-public-feed-v1" not in version:
    version = re.sub(
        r"^(Features: .*)$",
        r"\1, split-market-public-feed-v1, production-agg-tape-v1, phased-parallel-charts-v1",
        version,
        flags=re.M,
    )
    write("VERSION.txt", version)

# Final structural guards fail the migration before tests if the runtime is incomplete.
app = read("app.js")
worker = read("orderbook-worker.js")
sw = read("sw.js")
for needle, name in [
    ("/market/stream", "market namespace"),
    ("/public/stream", "public namespace"),
    ("isCoreMiniTickerPacket", "miniTicker online guard"),
    ("liveEmitIntervalMs: 600", "parallel chart phase"),
]:
    if needle not in app and needle not in read("binance-stream-routing.js"):
        raise RuntimeError(f"missing {name}")
if 'return [`${name}@aggTrade`];' not in worker:
    raise RuntimeError("worker production aggTrade stream not installed")
if "binance-stream-routing.js" not in sw:
    raise RuntimeError("routing module missing from service worker cache")
