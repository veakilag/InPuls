from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OLD_BUILD = "26-79-agg-center-tape-scale-settings-v1"
NEW_BUILD = "26-91-runtime-boot-cache-feed-v1"

ROUTING_IMPORT = (
    'import { buildBinanceChannelStreams, buildBinanceChannelTransports, '
    'isBinanceSubscriptionError, isCoreMiniTickerPacket, nextBinanceTransportIndex, '
    'normalizeBinanceRestMiniTicker } from "./binance-stream-routing.js?v='
    + NEW_BUILD
    + '";\n'
)

BINANCE_FEED_CLASS = r'''class BinanceFeed {
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
    const normalized = rows
      .map((ticker) => normalizeBinanceRestMiniTicker(ticker, now))
      .filter(Boolean);
    if (!normalized.length) {
      this.#scheduleMarketBootstrap(10_000);
      return;
    }
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
      scheduleRender();
      return;
    }
    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data) && this.trackedAggTrades.has(data.s)) {
      getSymbol(data.s)?.updateTrade(data);
      scheduleRender();
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


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)


app_path = ROOT / "app.js"
app = app_path.read_text(encoding="utf-8")
if "./binance-stream-routing.js" not in app:
    app = ROUTING_IMPORT + app
start = app.find("class BinanceFeed {")
end = app.find("\n\nconst marketSizeScanner", start)
if start < 0 or end < 0:
    raise RuntimeError("BinanceFeed boundaries not found")
app = app[:start] + BINANCE_FEED_CLASS + app[end:]
app = app.replace(OLD_BUILD, NEW_BUILD)
app_path.write_text(app, encoding="utf-8")

index_path = ROOT / "index.html"
index = index_path.read_text(encoding="utf-8").replace(OLD_BUILD, NEW_BUILD)
boot_tag = f'    <script src="./runtime-boot-recovery.js?v={NEW_BUILD}"></script>\n'
if "runtime-boot-recovery.js" not in index:
    index = replace_once(
        index,
        '    <script src="./install-cta.js?v=pwa-install-cta-v2"></script>\n',
        boot_tag + '    <script src="./install-cta.js?v=pwa-install-cta-v2"></script>\n',
        "runtime boot script insertion",
    )
index_path.write_text(index, encoding="utf-8")

sw_path = ROOT / "sw.js"
sw = sw_path.read_text(encoding="utf-8").replace(OLD_BUILD, NEW_BUILD)
forced_anchor = f'  ["/app.js", "./app.js?v={NEW_BUILD}"],\n'
forced_extra = (
    forced_anchor
    + f'  ["/runtime-boot-recovery.js", "./runtime-boot-recovery.js?v={NEW_BUILD}"],\n'
    + f'  ["/binance-stream-routing.js", "./binance-stream-routing.js?v={NEW_BUILD}"],\n'
)
if "runtime-boot-recovery.js" not in sw:
    sw = replace_once(sw, forced_anchor, forced_extra, "service worker forced map")
shell_anchor = f'  "./app.js?v={NEW_BUILD}",\n'
shell_extra = (
    shell_anchor
    + f'  "./runtime-boot-recovery.js?v={NEW_BUILD}",\n'
    + f'  "./binance-stream-routing.js?v={NEW_BUILD}",\n'
)
if sw.count("runtime-boot-recovery.js") < 2:
    sw = replace_once(sw, shell_anchor, shell_extra, "service worker shell")
sw_path.write_text(sw, encoding="utf-8")

for relative in [
    "VERSION.txt",
    "refresh.html",
    "refresh.js",
    "reset-v26.html",
    "reset.js",
]:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8").replace(OLD_BUILD, NEW_BUILD)
    path.write_text(text, encoding="utf-8")

# Keep contract tests aligned with the unique recovery generation without
# changing their behavioral assertions.
for path in [*ROOT.glob("test*.mjs"), *ROOT.glob("test/**/*.js")]:
    text = path.read_text(encoding="utf-8")
    if OLD_BUILD in text:
        path.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

checks = {
    "app import": "./binance-stream-routing.js" in app_path.read_text(encoding="utf-8"),
    "split core": 'this.#connectChannel("core")' in app_path.read_text(encoding="utf-8"),
    "split public": 'this.#connectChannel("public")' in app_path.read_text(encoding="utf-8"),
    "boot before app": index_path.read_text(encoding="utf-8").find("runtime-boot-recovery.js")
        < index_path.read_text(encoding="utf-8").find("app.js?v="),
    "unique build": NEW_BUILD in (ROOT / "VERSION.txt").read_text(encoding="utf-8"),
    "sw routing": "binance-stream-routing.js" in sw_path.read_text(encoding="utf-8"),
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise RuntimeError(f"runtime migration contract failed: {failed}")
