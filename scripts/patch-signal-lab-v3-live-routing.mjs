import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, search, replacement, label) {
  const source = await readFile(path, "utf8");
  const matches = typeof search === "string"
    ? source.split(search).length - 1
    : [...source.matchAll(new RegExp(search.source, search.flags.includes("g") ? search.flags : `${search.flags}g`))].length;
  if (matches !== 1) throw new Error(`${label}: expected exactly one match, got ${matches}`);
  const next = source.replace(search, replacement);
  await writeFile(path, next);
}

await replaceOnce(
  "signal-lab-v3-collector.js",
  'const BINANCE_STREAM_ENDPOINT = "wss://fstream.binance.com/ws";',
  'const BINANCE_MARKET_STREAM_ENDPOINT = "wss://fstream.binance.com/market/ws";\nconst BINANCE_PUBLIC_STREAM_ENDPOINT = "wss://fstream.binance.com/public/ws";',
  "split Binance market/public endpoints",
);

await replaceOnce(
  "signal-lab-v3-collector.js",
  "    this.socket = null;\n    this.requestId = 1;\n    this.reconnectAttempt = 0;\n    this.reconnectTimer = null;\n    this.connectionTimer = null;",
  "    this.socket = null;\n    this.bookSocket = null;\n    this.requestId = 1;\n    this.bookRequestId = 1;\n    this.reconnectAttempt = 0;\n    this.bookReconnectAttempt = 0;\n    this.reconnectTimer = null;\n    this.bookReconnectTimer = null;\n    this.connectionTimer = null;\n    this.corePacketTimer = null;\n    this.bookConnectionTimer = null;",
  "collector channel state",
);

await replaceOnce(
  "signal-lab-v3-collector.js",
  "      lastMessageAt: null,\n      lastCheckAt: null,",
  "      lastMessageAt: null,\n      lastBookMessageAt: null,\n      lastCheckAt: null,\n      marketPackets: 0,\n      miniTickerPackets: 0,\n      bookPackets: 0,\n      aggTradePackets: 0,\n      subscriptionErrors: 0,",
  "collector diagnostics state",
);

const collectorSource = await readFile("signal-lab-v3-collector.js", "utf8");
const lifecyclePattern = /  connect\(\) \{[\s\S]*?\n  status\(\) \{/;
if (!lifecyclePattern.test(collectorSource)) throw new Error("collector lifecycle block not found");
const lifecycleReplacement = `  connect() {
    this.manualClose = false;
    this.#connectMarket();
    this.#connectBook();
  }

  #connectMarket() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimer);
    clearTimeout(this.corePacketTimer);
    if (this.manualClose) return;
    this.#publish({
      connection: "connecting",
      startedAt: this.statusState.startedAt ?? Date.now(),
      lastError: null,
    });
    const checksAtOpen = this.statusState.checks;
    const socket = new WebSocket(BINANCE_MARKET_STREAM_ENDPOINT);
    this.socket = socket;
    this.connectionTimer = setTimeout(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.CONNECTING) return;
      this.#publish({ connection: "error", lastError: "Binance market не отвечает более 10 секунд" });
      socket.close();
    }, CONNECTION_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectionTimer);
      this.reconnectAttempt = 0;
      this.#publish({ connection: "syncing", lastError: null });
      this.#send("SUBSCRIBE", [
        "!miniTicker@arr",
        "!markPrice@arr@1s",
        "!forceOrder@arr",
      ]);
      if (this.trackedAggTrades.size) {
        this.#send("SUBSCRIBE", [...this.trackedAggTrades].map(
          (symbol) => \`${symbol.toLowerCase()}@aggTrade\`,
        ));
      }
      this.corePacketTimer = setTimeout(() => {
        if (this.socket !== socket || this.statusState.checks !== checksAtOpen) return;
        this.#publish({
          connection: "error",
          lastError: "Сокет открыт, но обязательный miniTicker не поступает",
        });
        socket.close();
      }, 7_000);
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (Number.isFinite(Number(payload?.code))) {
        this.#publish({
          connection: "error",
          subscriptionErrors: this.statusState.subscriptionErrors + 1,
          lastError: \`Binance subscription: ${String(payload?.msg ?? payload.code).slice(0, 140)}\`,
        });
        socket.close();
        return;
      }
      if (payload?.result === null || (payload?.id && payload?.result !== undefined)) return;
      const data = payload?.data ?? payload;
      const receivedAt = Date.now();
      const hasMiniTicker = Array.isArray(data) && data.some((row) => (
        row?.e === "24hrMiniTicker"
        && isUsdtPerpetualSymbol(row.s)
        && finite(row.c) > 0
      ));
      const aggTradePackets = Array.isArray(data)
        ? data.filter((row) => row?.e === "aggTrade").length
        : data?.e === "aggTrade" ? 1 : 0;
      const patch = {
        lastMessageAt: receivedAt,
        marketPackets: this.statusState.marketPackets + 1,
        aggTradePackets: this.statusState.aggTradePackets + aggTradePackets,
      };
      if (hasMiniTicker) {
        clearTimeout(this.corePacketTimer);
        patch.connection = "live";
        patch.miniTickerPackets = this.statusState.miniTickerPackets + 1;
        patch.lastError = null;
      }
      this.#publish(patch);
      this.#handle(data);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.manualClose) return;
      clearTimeout(this.connectionTimer);
      clearTimeout(this.corePacketTimer);
      this.reconnectAttempt += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
      this.#publish({ connection: "reconnecting" });
      this.reconnectTimer = setTimeout(() => this.#connectMarket(), delay);
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectionTimer);
      clearTimeout(this.corePacketTimer);
      this.#publish({ connection: "error", lastError: "Ошибка market-потока Binance" });
    });
  }

  #connectBook() {
    clearTimeout(this.bookReconnectTimer);
    clearTimeout(this.bookConnectionTimer);
    if (this.manualClose) return;
    const socket = new WebSocket(BINANCE_PUBLIC_STREAM_ENDPOINT);
    this.bookSocket = socket;
    this.bookConnectionTimer = setTimeout(() => {
      if (this.bookSocket !== socket || socket.readyState !== WebSocket.CONNECTING) return;
      socket.close();
    }, CONNECTION_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (this.bookSocket !== socket) return;
      clearTimeout(this.bookConnectionTimer);
      this.bookReconnectAttempt = 0;
      socket.send(JSON.stringify({
        method: "SUBSCRIBE",
        params: ["!bookTicker"],
        id: this.bookRequestId++,
      }));
    });

    socket.addEventListener("message", (event) => {
      if (this.bookSocket !== socket) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (Number.isFinite(Number(payload?.code))) {
        this.#publish({
          subscriptionErrors: this.statusState.subscriptionErrors + 1,
          lastError: \`Binance book subscription: ${String(payload?.msg ?? payload.code).slice(0, 140)}\`,
        });
        socket.close();
        return;
      }
      if (payload?.result === null || (payload?.id && payload?.result !== undefined)) return;
      const raw = payload?.data ?? payload;
      const normalizeBook = (row) => {
        if (!row || typeof row !== "object") return row;
        if (row.e === "bookTicker") return row;
        if (
          isUsdtPerpetualSymbol(row.s)
          && finite(row.b) !== null
          && finite(row.B) !== null
          && finite(row.a) !== null
          && finite(row.A) !== null
        ) return { ...row, e: "bookTicker", E: finite(row.E) ?? Date.now() };
        return row;
      };
      const data = Array.isArray(raw) ? raw.map(normalizeBook) : normalizeBook(raw);
      this.#publish({
        lastBookMessageAt: Date.now(),
        bookPackets: this.statusState.bookPackets + 1,
      });
      this.#handle(data);
    });

    socket.addEventListener("close", () => {
      if (this.bookSocket !== socket || this.manualClose) return;
      clearTimeout(this.bookConnectionTimer);
      this.bookReconnectAttempt += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.bookReconnectAttempt, 5));
      this.bookReconnectTimer = setTimeout(() => this.#connectBook(), delay);
    });

    socket.addEventListener("error", () => {
      if (this.bookSocket !== socket) return;
      clearTimeout(this.bookConnectionTimer);
    });
  }

  disconnect() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.bookReconnectTimer);
    clearTimeout(this.connectionTimer);
    clearTimeout(this.corePacketTimer);
    clearTimeout(this.bookConnectionTimer);
    this.socket?.close();
    this.bookSocket?.close();
    this.socket = null;
    this.bookSocket = null;
    this.#publish({ connection: "stopped" });
  }

  status() {`;
await writeFile(
  "signal-lab-v3-collector.js",
  collectorSource.replace(lifecyclePattern, lifecycleReplacement),
);

await replaceOnce(
  "owner-signal-lab-v3.js",
  'import { SignalLabV3Collector } from "./signal-lab-v3-collector.js";',
  'import { SignalLabV3Collector } from "./signal-lab-v3-collector.js?v=signal-lab-v3-live-routing-v1";',
  "collector cache version",
);

await replaceOnce(
  "owner-signal-lab-v3.js",
  '    connecting: "подключение",\n    live: "LIVE",',
  '    connecting: "подключение",\n    syncing: "синхронизация",\n    live: "LIVE",',
  "syncing status label",
);

await replaceOnce(
  "owner-signal-lab-v3.js",
  '  return `${connection} · проверки ${status.checks} · эпизоды ${status.createdEpisodes} · aggTrade ${status.trackedTrades} · история ${status.warmupLoaded} · пакет ${age}`;',
  '  return `${connection} · проверки ${status.checks} · эпизоды ${status.createdEpisodes} · miniTicker ${status.miniTickerPackets ?? 0} · aggTrade ${status.aggTradePackets ?? 0}/${status.trackedTrades} · book ${status.bookPackets ?? 0} · история ${status.warmupLoaded} · пакет ${age}`;',
  "diagnostic status text",
);

const html = await readFile("owner-signal-lab-v3.html", "utf8");
const htmlNext = html.replaceAll("signal-lab-v3-expert-candidates", "signal-lab-v3-live-routing-v1");
if (htmlNext === html) throw new Error("owner html cache version not found");
await writeFile("owner-signal-lab-v3.html", htmlNext);

await writeFile("test/signal-lab-v3-collector.test.js", `import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const collectorSource = await readFile(
  new URL("../signal-lab-v3-collector.js", import.meta.url),
  "utf8",
);
const ownerHtml = await readFile(
  new URL("../owner-signal-lab-v3.html", import.meta.url),
  "utf8",
);
const ownerRuntime = await readFile(
  new URL("../owner-signal-lab-v3.js", import.meta.url),
  "utf8",
);

test("Signal Lab V3 separates Binance market and public routes", () => {
  assert.match(collectorSource, /wss:\\/\\/fstream\\.binance\\.com\\/market\\/ws/);
  assert.match(collectorSource, /wss:\\/\\/fstream\\.binance\\.com\\/public\\/ws/);
  assert.doesNotMatch(collectorSource, /wss:\\/\\/fstream\\.binance\\.com\\/ws[\"']/);
  assert.match(collectorSource, /params:\s*\["!bookTicker"\]/);
  assert.match(collectorSource, /"!miniTicker@arr"/);
});

test("Signal Lab V3 reports LIVE only after a real miniTicker packet", () => {
  assert.match(collectorSource, /connection:\s*"syncing"/);
  assert.match(collectorSource, /row\?\.e === "24hrMiniTicker"/);
  assert.match(collectorSource, /patch\.connection = "live"/);
  assert.match(collectorSource, /mandatory miniTicker|обязательный miniTicker/i);
  assert.match(collectorSource, /subscriptionErrors/);
  assert.match(collectorSource, /miniTickerPackets/);
  assert.match(collectorSource, /bookPackets/);
  assert.match(collectorSource, /aggTradePackets/);
});

test("Signal Lab V3 owner page exposes truthful live diagnostics", () => {
  assert.match(ownerHtml, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(ownerHtml, /signal-lab-v3-live-routing-v1/);
  assert.match(ownerRuntime, /syncing:\s*"синхронизация"/);
  assert.match(ownerRuntime, /miniTicker/);
  assert.match(ownerRuntime, /aggTradePackets/);
  assert.match(ownerRuntime, /bookPackets/);
  assert.doesNotMatch(ownerHtml, /api[_-]?key|secret|private[_-]?key/i);
});
`);

console.log("Signal Lab V3 live routing hotfix applied");
