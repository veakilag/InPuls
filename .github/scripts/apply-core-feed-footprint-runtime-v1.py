from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
OLD_BUILD = "26-88-split-market-public-feed-v1"
NEW_BUILD = "26-89-core-feed-footprint-runtime-v1"


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
  market: Object.freeze({
    combined: "wss://fstream.binance.com/market/stream",
    raw: "wss://fstream.binance.com/market/ws",
  }),
  public: Object.freeze({
    combined: "wss://fstream.binance.com/public/stream",
    raw: "wss://fstream.binance.com/public/ws",
  }),
});

const CHANNEL_ROUTES = Object.freeze({
  core: "market",
  auxiliary: "market",
  market: "market",
  public: "public",
});

const GLOBAL_STREAMS = Object.freeze({
  core: Object.freeze(["!miniTicker@arr"]),
  auxiliary: Object.freeze([
    "!markPrice@arr@1s",
    "!forceOrder@arr",
  ]),
  // Compatibility contract for existing diagnostics and tests.
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
  if (kind === "auxiliary" || kind === "market") {
    for (const symbol of normalizeSymbols(symbols)) {
      streams.push(`${symbol.toLowerCase()}@aggTrade`);
    }
  }
  return [...new Set(streams)];
}

export function buildBinanceChannelTransports(kind, streams) {
  const route = CHANNEL_ROUTES[kind];
  const bases = CHANNEL_BASES[route];
  if (!bases) throw new TypeError(`Unknown Binance channel: ${kind}`);
  const normalized = [...new Set((streams ?? []).map(String).filter(Boolean))];
  if (!normalized.length) throw new TypeError(`Binance ${kind} channel requires streams`);
  const fallback = normalized.length === 1
    ? {
        name: `${kind} · raw-path`,
        url: `${bases.raw}/${normalized[0]}`,
        subscribeOnOpen: false,
      }
    : {
        name: `${kind} · subscribe`,
        url: bases.raw,
        subscribeOnOpen: true,
      };
  return [
    {
      name: `${kind} · combined`,
      url: `${bases.combined}?streams=${normalized.join("/")}`,
      subscribeOnOpen: false,
    },
    fallback,
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
new_feed = r'''class BinanceFeed {
  constructor() {
    this.trackedAggTrades = new Set();
    this.requestId = 1;
    this.manualClose = false;
    this.marketBootstrapTimer = null;
    this.marketBootstrapInFlight = false;
    this.lastMarketBootstrapAt = 0;
    this.channels = new Map([
      ["core", this.#createChannelState()],
      ["auxiliary", this.#createChannelState()],
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
    this.#connectChannel("core");
    this.#connectChannel("auxiliary");
    this.#connectChannel("public");
    this.#scheduleMarketBootstrap(3_500);
  }

  #requiredPacketReceived(kind, channel) {
    return kind === "core" ? channel.corePacketReceived : channel.packetReceived;
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
    if (kind === "core") setConnection("connecting", "Подключение к Binance…");

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
      if (kind === "core") {
        setConnection("offline", "Ошибка подключения Binance");
        this.#scheduleMarketBootstrap(0);
      }
      channel.reconnectTimer = setTimeout(() => this.#connectChannel(kind), 750);
      return;
    }
    channel.socket = socket;

    channel.watchdogTimer = setTimeout(() => {
      if (channel.socket !== socket || generation !== channel.generation) return;
      if (this.#requiredPacketReceived(kind, channel)) return;
      if (kind === "core") {
        setConnection("offline", "Нет miniTicker · резервный поток");
        this.#scheduleMarketBootstrap(0);
      }
      try { socket.close(); } catch {}
    }, kind === "core" ? 4_000 : 10_000);

    socket.addEventListener("open", () => {
      if (channel.socket !== socket || generation !== channel.generation) return;
      if (kind === "core") setConnection("connecting", "Синхронизация рынка…");
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
        if (kind === "core") setConnection("offline", "Ошибка подписки Binance");
        try { socket.close(); } catch {}
        return;
      }
      if (payload?.result === null || (payload?.id && payload?.result !== undefined)) return;

      const data = payload?.data ?? payload;
      channel.packetReceived = true;
      if (kind === "core" && isCoreMiniTickerPacket(data)) {
        channel.corePacketReceived = true;
        clearTimeout(channel.watchdogTimer);
        clearTimeout(this.marketBootstrapTimer);
        channel.watchdogTimer = null;
        this.marketBootstrapTimer = null;
        channel.reconnectAttempt = 0;
        state.connectedAt = Date.now();
        setConnection("online", "Онлайн");
      } else if (kind !== "core") {
        clearTimeout(channel.watchdogTimer);
        channel.watchdogTimer = null;
        channel.reconnectAttempt = 0;
      }
      this.#handle(data);
    });

    socket.addEventListener("close", () => {
      if (channel.socket !== socket || generation !== channel.generation || this.manualClose) return;
      channel.socket = null;
      clearTimeout(channel.watchdogTimer);
      channel.watchdogTimer = null;
      const requiredPacketReceived = this.#requiredPacketReceived(kind, channel);
      channel.transportIndex = nextBinanceTransportIndex(
        channel.transportIndex,
        transports.length,
        requiredPacketReceived,
      );
      channel.reconnectAttempt += 1;
      const delay = requiredPacketReceived
        ? Math.min(30_000, 1000 * 2 ** Math.min(channel.reconnectAttempt, 5))
        : 750;
      if (kind === "core") {
        setConnection("offline", `Переподключение через ${Math.max(1, Math.round(delay / 1000))}с`);
        this.#scheduleMarketBootstrap(0);
      }
      channel.reconnectTimer = setTimeout(() => this.#connectChannel(kind), delay);
    });

    socket.addEventListener("error", () => {
      if (channel.socket !== socket || generation !== channel.generation) return;
      if (kind === "core") setConnection("offline", "Ошибка market-потока");
      try { socket.close(); } catch {}
    });
  }

  updateAggTradeSubscriptions(symbols) {
    const next = new Set(normalizeSymbolList(symbols));
    const changed = next.size !== this.trackedAggTrades.size
      || [...next].some((symbol) => !this.trackedAggTrades.has(symbol));
    this.trackedAggTrades = next;
    if (changed) this.#connectChannel("auxiliary");
  }

  #send(kind, method, params) {
    const socket = this.channels.get(kind)?.socket;
    if (socket?.readyState !== WebSocket.OPEN || !params.length) return;
    socket.send(JSON.stringify({ method, params, id: this.requestId++ }));
  }

  #scheduleMarketBootstrap(delay = 0) {
    const core = this.channels.get("core");
    if (core?.corePacketReceived || this.marketBootstrapTimer || this.marketBootstrapInFlight) return;
    const minimumGap = Math.max(0, 10_000 - (Date.now() - this.lastMarketBootstrapAt));
    const wait = Math.max(0, Number(delay) || 0, minimumGap);
    this.marketBootstrapTimer = setTimeout(() => {
      this.marketBootstrapTimer = null;
      this.#bootstrapMarketFromRest();
    }, wait);
  }

  async #bootstrapMarketFromRest() {
    const core = this.channels.get("core");
    if (core?.corePacketReceived || this.marketBootstrapInFlight) return;
    this.marketBootstrapInFlight = true;
    this.lastMarketBootstrapAt = Date.now();
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
    let rows = null;
    for (const host of hosts) {
      try {
        const response = await Promise.race([
          fetch(`https://${host}/fapi/v1/ticker/24hr`, { cache: "no-store" }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3_500)),
        ]);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (Array.isArray(payload) && payload.length) {
          rows = payload;
          break;
        }
      } catch {
        // Try the next public Futures REST host.
      }
    }
    this.marketBootstrapInFlight = false;
    if (!rows || this.channels.get("core")?.corePacketReceived) return;
    const now = Date.now();
    const normalized = rows.map((ticker) => ({
      ...ticker,
      e: "24hrMiniTicker",
      E: Number(ticker?.E) || now,
    }));
    this.#handle(normalized);
    setConnection("offline", "REST-резерв · WS переподключается");
    this.#scheduleMarketBootstrap(10_000);
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
app = replace_balanced_block(app, r"class\s+BinanceFeed\s*\{", new_feed, "app BinanceFeed")
app = replace_once(
    app,
    "const feed = new BinanceFeed();\n",
    "const feed = new BinanceFeed();\nconst marketRowsBySymbol = new Map();\n",
    "market row cache",
)
app = replace_once(
    app,
    "  const fragment = document.createDocumentFragment();\n"
    "  for (const item of filtered) fragment.append(createRow(item));\n",
    "  const activeRowSymbols = new Set();\n"
    "  const fragment = document.createDocumentFragment();\n"
    "  for (const item of filtered) {\n"
    "    activeRowSymbols.add(item.symbol);\n"
    "    let row = marketRowsBySymbol.get(item.symbol);\n"
    "    if (!row) {\n"
    "      row = createRow(item);\n"
    "      marketRowsBySymbol.set(item.symbol, row);\n"
    "    } else {\n"
    "      updateRow(row, item);\n"
    "    }\n"
    "    fragment.append(row);\n"
    "  }\n"
    "  for (const symbol of marketRowsBySymbol.keys()) {\n"
    "    if (!activeRowSymbols.has(symbol)) marketRowsBySymbol.delete(symbol);\n"
    "  }\n",
    "keyed market rows",
)
new_create_row = r'''function createRow(item) {
  const row = els.tbodyTemplate.content.firstElementChild.cloneNode(true);
  const symbol = item.symbol;
  row.dataset.symbol = symbol;
  row.querySelector(".favorite-button").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(symbol);
  });
  row.addEventListener("click", () => selectChartSymbol(symbol, true));
  return updateRow(row, item);
}

function updateRow(row, item) {
  row.classList.toggle("has-signal", Boolean(item.primarySignal));
  row.classList.toggle("is-hot", item.score >= state.settings.alertScore);
  row.classList.toggle("is-selected", item.symbol === state.selectedChartSymbol);

  const favorite = row.querySelector(".favorite-button");
  const isFavorite = state.favorites.has(item.symbol);
  favorite.classList.toggle("is-active", isFavorite);
  favorite.setAttribute("aria-label", `${isFavorite ? "Убрать" : "Добавить"} ${item.symbol} ${isFavorite ? "из" : "в"} избранное`);

  row.querySelector(".pair-name").textContent = item.symbol.replace("USDT", "");
  row.querySelector(".pair-quote").textContent = "/USDT";
  row.querySelector(".price").textContent = formatPrice(item.price);
  setChange(row.querySelector(".change-15s"), item.change15s);
  setChange(row.querySelector(".change-1m"), item.change1m);
  setChange(row.querySelector(".change-5m"), item.change5m);
  row.querySelector(".turnover").textContent = formatCompactUsd(item.turnoverPerMinute);
  row.querySelector(".volume-boost").textContent = item.volumeBoost === null ? "разогрев" : `×${item.volumeBoost.toFixed(1)}`;
  row.querySelector(".tps").textContent = item.trades.tps > 0 ? Math.round(item.trades.tps).toLocaleString("ru-RU") : "—";
  renderFlow(row.querySelector(".flow"), item.trades.buyShare);
  renderSignal(row.querySelector(".signal-cell"), item);
  row.querySelector(".score-value").textContent = item.score;
  row.querySelector(".score-ring").style.setProperty("--score", `${item.score * 3.6}deg`);
  return row;
}'''
app = replace_balanced_block(app, r"function\s+createRow\s*\(item\)\s*\{", new_create_row, "createRow")
write("app.js", app)

flow = read("orderbook-flow-workspace.js")
flow = replace_once(
    flow,
    "detail?.replace || (incoming.length && state.historyOffset === 0)",
    "detail?.replace || (batch.trades.length && state.historyOffset === 0)",
    "footprint live redraw reference",
)
write("orderbook-flow-workspace.js", flow)

global_test = r'''import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildBinanceChannelStreams,
  buildBinanceChannelTransports,
  isBinanceSubscriptionError,
  isCoreMiniTickerPacket,
  nextBinanceTransportIndex,
} from "./binance-stream-routing.js?v=26-89-core-feed-footprint-runtime-v1";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("global feed isolates the critical miniTicker stream", () => {
  const core = buildBinanceChannelStreams("core");
  const auxiliary = buildBinanceChannelStreams("auxiliary", ["BTCUSDT", "ETHUSDT"]);
  const publicStreams = buildBinanceChannelStreams("public");
  assert.deepEqual(core, ["!miniTicker@arr"]);
  assert.deepEqual(auxiliary.slice(0, 2), ["!markPrice@arr@1s", "!forceOrder@arr"]);
  assert.ok(auxiliary.includes("btcusdt@aggTrade"));
  assert.ok(auxiliary.includes("ethusdt@aggTrade"));
  assert.deepEqual(publicStreams, ["!bookTicker"]);

  const coreTransports = buildBinanceChannelTransports("core", core);
  const publicTransports = buildBinanceChannelTransports("public", publicStreams);
  assert.match(coreTransports[0].url, /fstream\.binance\.com\/market\/stream\?streams=!miniTicker@arr/);
  assert.equal(coreTransports[1].url, "wss://fstream.binance.com/market/ws/!miniTicker@arr");
  assert.equal(coreTransports[1].subscribeOnOpen, false);
  assert.equal(publicTransports[1].url, "wss://fstream.binance.com/public/ws/!bookTicker");
});

test("fallback transport advances exactly once before required data", () => {
  assert.equal(nextBinanceTransportIndex(0, 2, false), 1);
  assert.equal(nextBinanceTransportIndex(1, 2, false), 0);
  assert.equal(nextBinanceTransportIndex(1, 2, true), 1);
});

test("online requires a real miniTicker batch and subscription errors stay visible", () => {
  assert.equal(isCoreMiniTickerPacket([{ e: "markPriceUpdate", s: "BTCUSDT", p: "1" }]), false);
  assert.equal(isCoreMiniTickerPacket([{ e: "24hrMiniTicker", s: "BTCUSDT", c: "65000" }]), true);
  assert.equal(isBinanceSubscriptionError({ code: 2, msg: "Invalid request", id: 4 }), true);
});

test("runtime keeps core, auxiliary and public sockets independent", async () => {
  const [app, worker] = await Promise.all([source("app.js"), source("orderbook-worker.js")]);
  assert.match(app, /#connectChannel\("core"\)/);
  assert.match(app, /#connectChannel\("auxiliary"\)/);
  assert.match(app, /#connectChannel\("public"\)/);
  assert.match(app, /fapi\/v1\/ticker\/24hr/);
  assert.match(app, /REST-резерв · WS переподключается/);
  assert.match(app, /marketRowsBySymbol/);
  assert.match(app, /updateRow\(row, item\)/);
  const workerRouting = worker.match(/function tradeStreams[\s\S]*?function trimSide/)?.[0] ?? "";
  assert.match(workerRouting, /return \[`\${name}@aggTrade`\]/);
  assert.doesNotMatch(workerRouting, /@trade`/);
});

test("Event Radar Beta assets are removed from runtime and PWA cache", async () => {
  const [html, app, worker] = await Promise.all([
    source("index.html"), source("app.js"), source("sw.js"),
  ]);
  for (const text of [html, app, worker]) {
    assert.doesNotMatch(text, /event-radar-beta/);
    assert.doesNotMatch(text, /inpuls:event-radar-/);
  }
});
'''
write("test-global-connection-radar-cleanup-v1.mjs", global_test)

hotfix_test = r'''import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("Footprint live handler redraws from the selected batch without an undefined variable", async () => {
  const flow = await source("orderbook-flow-workspace.js");
  const accept = flow.match(/function acceptTape\(event\)[\s\S]*?function acceptBookStatus/)?.[0] ?? "";
  assert.match(accept, /batch\.trades\.length/);
  assert.doesNotMatch(accept, /incoming\.length/);
  assert.match(accept, /ingestFootprintTrades/);
  assert.match(accept, /requestDraw\(card\)/);
});

test("market table reuses symbol rows instead of recreating every row on each ticker batch", async () => {
  const app = await source("app.js");
  assert.match(app, /const marketRowsBySymbol = new Map\(\)/);
  assert.match(app, /let row = marketRowsBySymbol\.get\(item\.symbol\)/);
  assert.match(app, /updateRow\(row, item\)/);
  assert.match(app, /function updateRow\(row, item\)/);
  assert.doesNotMatch(app, /for \(const item of filtered\) fragment\.append\(createRow\(item\)\)/);
});

test("critical market discovery has a REST bootstrap while WebSocket reconnects", async () => {
  const app = await source("app.js");
  assert.match(app, /#scheduleMarketBootstrap\(3_500\)/);
  assert.match(app, /#bootstrapMarketFromRest\(\)/);
  assert.match(app, /fapi1\.binance\.com/);
  assert.match(app, /fapi2\.binance\.com/);
  assert.match(app, /e: "24hrMiniTicker"/);
  assert.match(app, /setConnection\("online", "Онлайн"\)/);
});
'''
write("test-core-feed-footprint-runtime-v1.mjs", hotfix_test)

for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".webmanifest"}:
        continue
    text = path.read_text(encoding="utf-8")
    if OLD_BUILD in text:
        path.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")
