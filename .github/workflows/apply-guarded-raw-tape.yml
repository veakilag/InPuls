from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.cwd()
WORKER = ROOT / "orderbook-worker.js"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, got {count}")
    return source.replace(old, new, 1)


def replace_regex(source: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"Expected one {label} match, got {count}")
    return updated


def transform_worker(source: str) -> str:
    if not source.startswith('importScripts("./orderbook-tape-guard.js?v=1");'):
        source = 'importScripts("./orderbook-tape-guard.js?v=1");\n\n' + source

    source = replace_regex(
        source,
        r"function normalizeTrade\(event\) \{.*?\n\}",
        '''function normalizeTrade(event, sourceHint = null) {
  const eventType = String(event?.e ?? "").toLowerCase();
  const inferredRaw = eventType === "trade"
    || (Number.isFinite(Number(event?.t)) && !Number.isFinite(Number(event?.a)));
  const source = sourceHint === "raw" || (sourceHint !== "agg" && inferredRaw) ? "raw" : "agg";
  const price = Number(event?.p);
  const quantity = Number(event?.q);
  const time = Number(event?.T ?? event?.E);
  const id = source === "raw" ? Number(event?.t) : Number(event?.a);
  const firstTradeId = source === "raw" ? id : Number(event?.f);
  const lastTradeId = source === "raw" ? id : Number(event?.l);
  if (![price, quantity, time, id, firstTradeId, lastTradeId].every(Number.isFinite)) return null;
  if (price <= 0 || quantity <= 0 || time <= 0) return null;
  if (![id, firstTradeId, lastTradeId].every(Number.isInteger) || id < 0 || firstTradeId < 0 || lastTradeId < firstTradeId) return null;
  return {
    id,
    firstTradeId,
    lastTradeId,
    source,
    price,
    quantity,
    quote: price * quantity,
    time,
    side: event?.m ? "sell" : "buy",
  };
}''',
        "normalizeTrade",
    )

    source = replace_regex(
        source,
        r"function tradeStreamCandidates\(symbol\) \{.*?\n\}\n\nfunction tradeTransports\(stream\) \{.*?\n\}",
        '''function tradeStreams(symbol) {
  const name = symbol.toLowerCase();
  return [`${name}@trade`, `${name}@aggTrade`];
}

function tradeTransports(streams) {
  const joined = streams.join("/");
  return [
    { name: "standard · combined", url: `wss://fstream.binance.com/stream?streams=${joined}`, subscribe: false, streams },
    { name: "market · combined", url: `wss://fstream.binance.com/market/stream?streams=${joined}`, subscribe: false, streams },
    { name: "standard · subscribe", url: "wss://fstream.binance.com/ws", subscribe: true, streams },
    { name: "market · subscribe", url: "wss://fstream.binance.com/market/stream", subscribe: true, streams },
    { name: "alt · combined", url: `wss://stream.binancefuture.com/stream?streams=${joined}`, subscribe: false, streams },
  ];
}''',
        "trade transport block",
    )

    source = replace_once(
        source,
        '''    this.tradeReconnectAttempt = 0;
    this.lastResyncAt = 0;
  }

  addSubscriber() {''',
        '''    this.tradeReconnectAttempt = 0;
    this.lastResyncAt = 0;
    this.tradeTransportName = "—";
    this.tapeGuard = new self.InPulsTapeGuard({ rawWarmupTrades: 6, rawStaleMs: 1_500 });
  }

  tradeBoundary() {
    let boundary = null;
    for (const trade of this.trades) {
      const value = Number(trade?.lastTradeId);
      if (Number.isInteger(value) && value >= 0) boundary = boundary === null ? value : Math.max(boundary, value);
    }
    return boundary;
  }

  resetTapeGuard() {
    this.tapeGuard.reset({ lastOutputTradeId: this.tradeBoundary() });
  }

  addSubscriber() {''',
        "SymbolFeed constructor tail",
    )

    source = replace_once(
        source,
        '''    this.tradeReconnectAttempt = 0;
    this.tradeLive = false;
    this.tradeConnected = false;
    this.resetBook();''',
        '''    this.tradeReconnectAttempt = 0;
    this.tradeLive = false;
    this.tradeConnected = false;
    this.tradeTransportName = "—";
    this.resetTapeGuard();
    this.resetBook();''',
        "start tape reset",
    )

    source = replace_once(
        source,
        '''    try { this.tradeSocket?.close(); } catch {}
    this.socket = null;
    this.tradeSocket = null;''',
        '''    try { this.tradeSocket?.close(); } catch {}
    this.socket = null;
    this.tradeSocket = null;
    this.tapeGuard.disconnect("socket-stop");''',
        "stopSockets guard disconnect",
    )

    source = replace_regex(
        source,
        r"  liveStatusText\(tapeState = null\) \{.*?\n  \}",
        '''  liveStatusText(tapeState = null) {
    const partial = this.mode === "partial" ? " · 20" : "";
    const reconnectingTape = tapeState === "reconnect" || (this.tradeLive && !this.tradeConnected);
    const tape = reconnectingTape
      ? " · TAPE RECONNECT"
      : (this.tradeLive && this.tradeConnected ? ` · ${this.tapeGuard.label()}` : "");
    return `LIVE 100ms · WORKER${partial}${tape}`;
  }''',
        "liveStatusText",
    )

    source = replace_once(
        source,
        '''      this.setStatus("stale", `STALE ${Math.max(1, Math.floor(depthAge / 1_000))}с · WORKER${this.tradeLive && this.tradeConnected ? " · TAPE" : ""}`);''',
        '''      this.setStatus("stale", `STALE ${Math.max(1, Math.floor(depthAge / 1_000))}с · WORKER${this.tradeLive && this.tradeConnected ? ` · ${this.tapeGuard.label()}` : ""}`);''',
        "stale status source label",
    )

    source = replace_once(
        source,
        '''    this.tradeLive = false;
    this.tradeConnected = false;
    this.resetBook();
    this.setStatus("loading", "Восстановление Worker");''',
        '''    this.tradeLive = false;
    this.tradeConnected = false;
    this.tradeTransportName = "—";
    this.tapeGuard.disconnect("background-restart");
    this.resetBook();
    this.setStatus("loading", "Восстановление Worker");''',
        "background tape restart",
    )

    source = replace_once(
        source,
        '''          tradeTransport: this.tradeTransportIndex,
        },''',
        '''          tradeTransport: this.tradeTransportIndex,
          tradeTransportName: this.tradeTransportName,
          tape: this.tapeGuard.snapshot(now),
        },''',
        "health tape diagnostics",
    )

    source = replace_regex(
        source,
        r"  connectTrades\(generation\) \{.*?\n  \}\n\n  async loadRecentTrades",
        '''  connectTrades(generation) {
    if (generation !== this.generation || this.subscribers <= 0) return;
    clearTimeout(this.tradeReconnectTimer);
    clearTimeout(this.tradeFirstMessageTimer);
    this.tradeFirstMessageTimer = 0;

    const streams = tradeStreams(this.symbol);
    const transports = tradeTransports(streams);
    const transport = transports[this.tradeTransportIndex % transports.length];
    let socket;
    try { socket = new WebSocket(transport.url); }
    catch {
      this.tradeTransportIndex += 1;
      const delay = reconnectDelay(this.tradeReconnectAttempt++);
      this.tradeReconnectTimer = setTimeout(() => this.connectTrades(generation), delay);
      return;
    }
    this.tradeSocket = socket;
    this.tradeTransportName = transport.name;
    let receivedTrade = false;
    this.tradeFirstMessageTimer = setTimeout(() => {
      if (generation !== this.generation || socket !== this.tradeSocket || receivedTrade) return;
      try { socket.close(); } catch {}
    }, TRADE_FIRST_MESSAGE_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      this.tapeGuard.connect();
      if (transport.subscribe) {
        socket.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: transport.streams,
          id: Date.now() % 2_147_483_647,
        }));
      }
    });

    socket.addEventListener("message", (message) => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      const payload = parsePayload(message.data);
      if (!payload) return;
      const update = payload.data;
      const eventType = String(update?.e ?? "").toLowerCase();
      const payloadStream = payload.stream.toLowerCase();
      const rawEvent = eventType === "trade"
        || (payloadStream.endsWith("@trade") && !payloadStream.endsWith("@aggtrade"));
      const aggregateEvent = eventType === "aggtrade" || payloadStream.endsWith("@aggtrade");
      if (!rawEvent && !aggregateEvent) return;

      const source = rawEvent && !aggregateEvent ? "raw" : "agg";
      const trade = normalizeTrade(update, source);
      if (!trade) return;
      receivedTrade = true;
      clearTimeout(this.tradeFirstMessageTimer);
      this.tradeFirstMessageTimer = 0;
      this.lastTradeAt = Date.now();
      this.tradeTransportIndex = 0;
      this.tradeReconnectAttempt = 0;
      this.tradeLive = true;
      this.tradeConnected = true;

      const decision = this.tapeGuard.ingest(trade, this.lastTradeAt);
      this.publishLiveStatus();
      if (!decision.emit || !this.insertTrade(trade, true)) return;
      this.queueTape(trade);
      this.scheduleTradeSave();
    });

    socket.addEventListener("close", () => {
      if (generation !== this.generation || socket !== this.tradeSocket) return;
      clearTimeout(this.tradeFirstMessageTimer);
      this.tradeFirstMessageTimer = 0;
      this.tradeSocket = null;
      this.tradeConnected = false;
      this.tapeGuard.disconnect("socket-close");
      this.tradeTransportIndex += 1;
      if (this.tradeLive && this.depthReady) this.publishLiveStatus("reconnect");
      const delay = reconnectDelay(this.tradeReconnectAttempt++);
      this.tradeReconnectTimer = setTimeout(() => this.connectTrades(generation), delay);
    });

    socket.addEventListener("error", () => {
      if (generation === this.generation && socket === this.tradeSocket) {
        try { socket.close(); } catch {}
      }
    });
  }

  async loadRecentTrades''',
        "connectTrades",
    )

    source = replace_once(
        source,
        "      const trade = normalizeTrade(row);",
        '      const trade = normalizeTrade(row, "agg");',
        "REST aggregate normalization",
    )

    source = replace_once(
        source,
        '''    const key = `${trade.id}:${trade.time}:${trade.price}:${trade.quantity}`;''',
        '''    const firstTradeId = Number.isInteger(Number(trade.firstTradeId)) ? Number(trade.firstTradeId) : trade.id;
    const lastTradeId = Number.isInteger(Number(trade.lastTradeId)) ? Number(trade.lastTradeId) : trade.id;
    const key = `${firstTradeId}:${lastTradeId}:${trade.time}:${trade.price}:${trade.quantity}`;
    if (Number.isInteger(Number(lastTradeId))) this.tapeGuard.advanceBoundary(lastTradeId);''',
        "insertTrade key",
    )

    source = replace_once(
        source,
        '''      this.tradeIds = new Set(this.trades.map((item) => `${item.id}:${item.time}:${item.price}:${item.quantity}`));''',
        '''      this.tradeIds = new Set(this.trades.map((item) => {
        const firstTradeId = Number.isInteger(Number(item.firstTradeId)) ? Number(item.firstTradeId) : item.id;
        const lastTradeId = Number.isInteger(Number(item.lastTradeId)) ? Number(item.lastTradeId) : item.id;
        return `${firstTradeId}:${lastTradeId}:${item.time}:${item.price}:${item.quantity}`;
      }));''',
        "tradeIds rebuild",
    )

    return source


def main() -> None:
    original = WORKER.read_text(encoding="utf-8")
    transformed = transform_worker(original)
    if transformed == original:
        raise RuntimeError("Worker was not changed")
    WORKER.write_text(transformed, encoding="utf-8")

    (ROOT / "tools/apply-guarded-raw-tape.py").unlink(missing_ok=True)
    (ROOT / ".github/workflows/apply-guarded-raw-tape.yml").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
