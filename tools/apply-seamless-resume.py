from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.cwd()
ORDERBOOK = ROOT / "orderbook.js"
WORKER = ROOT / "orderbook-worker.js"
SERVICE_WORKER = ROOT / "sw.js"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, got {count}")
    return source.replace(old, new, 1)


def replace_all(source: str, old: str, new: str, expected: int, label: str) -> str:
    count = source.count(old)
    if count != expected:
        raise RuntimeError(f"Expected {expected} {label} anchors, got {count}")
    return source.replace(old, new)


def transform_orderbook(source: str) -> str:
    source = replace_once(
        source,
        '''const ORDERBOOK_WORKER_URL = new URL("./orderbook-worker.js?v=26-22-background-restart", import.meta.url);
const ORDERBOOK_WORKER_TAPE_EVENT = "inpuls:tape-data";
const ORDERBOOK_BACKGROUND_HARD_RESTART_MS = 15_000;
const ORDERBOOK_RESUBSCRIBE_STAGGER_MS = 160;''',
        '''const ORDERBOOK_WORKER_URL = new URL("./orderbook-worker.js?v=26-23-seamless-resume", import.meta.url);
const ORDERBOOK_WORKER_TAPE_EVENT = "inpuls:tape-data";
const ORDERBOOK_RESUBSCRIBE_STAGGER_MS = 180;
const ORDERBOOK_RESUME_PROBE_MS = 3_500;
const ORDERBOOK_PRIORITY_LIMIT = 12;''',
        "worker resume constants",
    )

    source = replace_once(
        source,
        '''    this.lastHeartbeatAt = 0;
    this.restartCount = 0;
    this.needsResubscribe = false;
    this.hiddenAt = typeof document !== "undefined" && document.hidden ? Date.now() : 0;
    this.resubscribeEpoch = 0;
    this.#start();''',
        '''    this.lastHeartbeatAt = 0;
    this.restartCount = 0;
    this.needsResubscribe = false;
    this.resubscribeEpoch = 0;
    this.resumeProbeTimer = 0;
    this.resumeProbeToken = 0;
    this.prioritySymbols = [];
    this.#start();''',
        "manager constructor resume state",
    )

    source = replace_once(
        source,
        '''  #start() {
    if (typeof Worker !== "function") {''',
        '''  #promoteSymbol(symbol) {
    const value = String(symbol ?? "").toUpperCase();
    if (!value.endsWith("USDT")) return;
    this.prioritySymbols = [
      value,
      ...this.prioritySymbols.filter((item) => item !== value),
    ].slice(0, ORDERBOOK_PRIORITY_LIMIT);
  }

  #orderedSymbols() {
    const active = [...this.clientsBySymbol.keys()];
    const activeSet = new Set(active);
    const priority = this.prioritySymbols.filter((symbol) => activeSet.has(symbol));
    const prioritySet = new Set(priority);
    return [...priority, ...active.filter((symbol) => !prioritySet.has(symbol))];
  }

  #visibilityPayload(visible) {
    return {
      type: "visibility",
      visible: Boolean(visible),
      prioritySymbols: visible ? this.#orderedSymbols() : [],
    };
  }

  #start() {
    if (typeof Worker !== "function") {''',
        "manager priority helpers",
    )

    source = replace_once(
        source,
        '        name: "inpuls-orderbook-worker-v26-22",',
        '        name: "inpuls-orderbook-worker-v26-23",',
        "worker name",
    )

    source = replace_once(
        source,
        '      this.worker.postMessage({ type: "visibility", visible });',
        '      this.worker.postMessage(this.#visibilityPayload(visible));',
        "initial visibility payload",
    )

    source = replace_once(
        source,
        '''        this.visibilityHandler = () => {
          const visible = !document.hidden;
          if (!visible) {
            this.hiddenAt = Date.now();
            if (this.worker && !this.failed) {
              this.worker.postMessage({ type: "visibility", visible: false });
            }
            return;
          }

          const hiddenFor = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
          this.hiddenAt = 0;
          this.lastHeartbeatAt = Date.now();

          // После долгой заморозки Chromium может оставить WebSocket в OPEN,
          // хотя sequence и сетевой поток уже мертвы. Не пытаемся оживлять
          // такой Worker — создаём чистый и подписываем символы заново.
          if (hiddenFor >= ORDERBOOK_BACKGROUND_HARD_RESTART_MS) {
            this.#restart(`Возврат из фона ${Math.round(hiddenFor / 1_000)}с`);
            return;
          }

          if (!this.worker || this.failed) return;
          this.worker.postMessage({ type: "visibility", visible: true });
        };''',
        '''        this.visibilityHandler = () => {
          const visible = !document.hidden;
          this.resumeProbeToken += 1;
          clearTimeout(this.resumeProbeTimer);
          this.resumeProbeTimer = 0;

          if (!visible) {
            if (this.worker && !this.failed) {
              this.worker.postMessage(this.#visibilityPayload(false));
            }
            return;
          }

          if (!this.worker || this.failed) return;
          const probeToken = this.resumeProbeToken;
          this.lastHeartbeatAt = Date.now();
          this.worker.postMessage(this.#visibilityPayload(true));

          // Сначала даём существующему Worker продолжить работу. Полный
          // перезапуск нужен только если он действительно не проснулся.
          this.resumeProbeTimer = setTimeout(() => {
            this.resumeProbeTimer = 0;
            if (document.hidden || this.failed || !this.worker || probeToken !== this.resumeProbeToken) return;
            this.#restart("Worker не проснулся после фона");
          }, ORDERBOOK_RESUME_PROBE_MS);
        };''',
        "visibility resume handler",
    )

    source = replace_once(
        source,
        '''    clearTimeout(this.startupTimer);
    this.startupTimer = 0;
    this.workerReady = false;''',
        '''    clearTimeout(this.startupTimer);
    this.startupTimer = 0;
    clearTimeout(this.resumeProbeTimer);
    this.resumeProbeTimer = 0;
    this.resumeProbeToken += 1;
    this.workerReady = false;''',
        "restart probe cleanup",
    )

    source = replace_once(
        source,
        '    this.#notifyAll({ state: "loading", text: "Восстановление Worker" });',
        '    this.#notifyAll({ state: "stale", text: "СИНХРОНИЗАЦИЯ · последний кадр" });',
        "restart status",
    )

    source = replace_once(
        source,
        '''    this.clientsBySymbol.delete(symbol);
    this.lastDataBySymbol.delete(symbol);''',
        '''    this.clientsBySymbol.delete(symbol);
    this.prioritySymbols = this.prioritySymbols.filter((item) => item !== symbol);
    this.lastDataBySymbol.delete(symbol);''',
        "unregister priority cleanup",
    )

    source = replace_once(
        source,
        '''  select(id, previousSymbol, symbol) {
    if (!this.available()) return false;''',
        '''  select(id, previousSymbol, symbol) {
    this.#promoteSymbol(symbol);
    if (!this.available()) return false;''',
        "select priority",
    )

    source = replace_once(
        source,
        '''    if (!message || typeof message !== "object") return;
    this.lastHeartbeatAt = Date.now();''',
        '''    if (!message || typeof message !== "object") return;
    this.lastHeartbeatAt = Date.now();
    clearTimeout(this.resumeProbeTimer);
    this.resumeProbeTimer = 0;
    this.resumeProbeToken += 1;''',
        "message resume acknowledgement",
    )

    source = replace_once(
        source,
        '      this.worker?.postMessage({ type: "visibility", visible });',
        '      this.worker?.postMessage(this.#visibilityPayload(visible));',
        "ready visibility payload",
    )

    source = replace_once(
        source,
        '        const symbols = [...this.clientsBySymbol.keys()];',
        '        const symbols = this.#orderedSymbols();',
        "priority resubscribe order",
    )

    source = replace_once(
        source,
        '''    clearTimeout(this.startupTimer);
    this.startupTimer = 0;
    clearInterval(this.healthTimer);''',
        '''    clearTimeout(this.startupTimer);
    this.startupTimer = 0;
    clearTimeout(this.resumeProbeTimer);
    this.resumeProbeTimer = 0;
    this.resumeProbeToken += 1;
    clearInterval(this.healthTimer);''',
        "failure probe cleanup",
    )

    source = replace_once(
        source,
        'const ORDERBOOK_RUNTIME_STYLE_ID = "inpuls-orderbook-runtime-v26-22-background-restart";',
        'const ORDERBOOK_RUNTIME_STYLE_ID = "inpuls-orderbook-runtime-v26-23-seamless-resume";',
        "runtime style version",
    )

    return source


def transform_worker(source: str) -> str:
    source = replace_once(
        source,
        "const RESUME_STAGGER_MS = 140;",
        "const RESUME_STAGGER_MS = 180;",
        "resume stagger",
    )

    source = replace_once(
        source,
        '''    this.lastMessageAt = 0;
    this.lastRestartAt = 0;
    this.tradeBootstrapLoading = false;''',
        '''    this.lastMessageAt = 0;
    this.lastRestartAt = 0;
    this.syncing = false;
    this.tradeBootstrapLoading = false;''',
        "worker syncing state",
    )

    source = replace_once(
        source,
        '''    this.tradeLive = false;
    this.tradeConnected = false;
    this.tradeTransportName = "—";
    this.resetTapeGuard();''',
        '''    this.tradeLive = false;
    this.tradeConnected = false;
    this.tradeTransportName = "—";
    this.syncing = false;
    this.resetTapeGuard();''',
        "initial start syncing reset",
    )

    source = replace_once(
        source,
        '''  publishLiveStatus(tapeState = null) {
    const depthAge = this.lastDepthAt ? Date.now() - this.lastDepthAt : Infinity;''',
        '''  publishLiveStatus(tapeState = null) {
    if (this.syncing) {
      this.setStatus("stale", "СИНХРОНИЗАЦИЯ · последний кадр");
      return;
    }
    const depthAge = this.lastDepthAt ? Date.now() - this.lastDepthAt : Infinity;''',
        "syncing live status",
    )

    source = replace_once(
        source,
        '''      post("tape", this.symbol, {
        replace: false,
        resume: true,
        trades: resumeTrades,
      });

      const socketOpen = this.socket?.readyState === WebSocket.OPEN;''',
        '''      post("tape", this.symbol, {
        replace: false,
        resume: true,
        trades: resumeTrades,
      });
      this.loadRecentTrades(this.generation, { resume: true });

      const socketOpen = this.socket?.readyState === WebSocket.OPEN;''',
        "resume trade catchup",
    )

    source = replace_once(
        source,
        '''    this.lastRestartAt = now;
    this.stopSockets();''',
        '''    this.lastRestartAt = now;
    const preserveLastFrame = this.depthReady || (this.bids.size > 0 && this.asks.size > 0);
    this.syncing = preserveLastFrame;
    this.stopSockets();''',
        "background syncing start",
    )

    source = replace_once(
        source,
        '''    this.tapeGuard.disconnect("background-restart");
    this.resetBook();
    this.setStatus("loading", "Восстановление Worker");
    const generation = this.generation;
    this.connectDepth(generation);
    this.connectTrades(generation);''',
        '''    this.tapeGuard.disconnect("background-restart");
    this.resetBook();
    this.setStatus(
      preserveLastFrame ? "stale" : "loading",
      preserveLastFrame ? "СИНХРОНИЗАЦИЯ · последний кадр" : "Восстановление Worker",
    );
    const generation = this.generation;
    this.connectDepth(generation);
    this.connectTrades(generation);
    this.loadRecentTrades(generation, { resume: true });''',
        "background restart flow",
    )

    source = replace_once(
        source,
        '''          tradeTransportName: this.tradeTransportName,
          tape: this.tapeGuard.snapshot(now),''',
        '''          tradeTransportName: this.tradeTransportName,
          syncing: this.syncing,
          tape: this.tapeGuard.snapshot(now),''',
        "health syncing diagnostic",
    )

    source = replace_once(
        source,
        '''    this.depthBuffer = [];
    this.pendingSnapshot = null;
    this.depthReady = true;
    this.publishLiveStatus();''',
        '''    this.depthBuffer = [];
    this.pendingSnapshot = null;
    this.depthReady = true;
    this.syncing = false;
    this.publishLiveStatus();''',
        "snapshot atomic completion",
    )

    source = replace_once(
        source,
        '''    this.mode = "partial";
    this.transportIndex = 0;
    this.resetBook();
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    this.setStatus("loading", "Резервный Worker-стакан");''',
        '''    const preserveLastFrame = this.syncing || this.depthReady || (this.bids.size > 0 && this.asks.size > 0);
    this.mode = "partial";
    this.transportIndex = 0;
    this.syncing = preserveLastFrame;
    this.resetBook();
    clearTimeout(this.firstDepthTimer);
    clearTimeout(this.snapshotTimer);
    this.setStatus(
      preserveLastFrame ? "stale" : "loading",
      preserveLastFrame ? "СИНХРОНИЗАЦИЯ · последний кадр" : "Резервный Worker-стакан",
    );''',
        "partial syncing",
    )

    source = replace_once(
        source,
        '''    this.resyncCount += 1;
    this.resetBook();
    this.setStatus("loading", text);''',
        '''    this.resyncCount += 1;
    const preserveLastFrame = this.syncing || this.depthReady || (this.bids.size > 0 && this.asks.size > 0);
    this.syncing = preserveLastFrame;
    this.resetBook();
    this.setStatus(
      preserveLastFrame ? "stale" : "loading",
      preserveLastFrame ? `СИНХРОНИЗАЦИЯ · ${text}` : text,
    );''',
        "resync stale status",
    )

    source = replace_once(
        source,
        '''      this.setStatus("loading", this.mode === "deep" ? "Синхронизация Worker" : "Подключаю резерв Worker");
      if (this.mode === "deep") this.loadSnapshot(generation);''',
        '''      if (this.syncing) this.setStatus("stale", "СИНХРОНИЗАЦИЯ · последний кадр");
      else this.setStatus("loading", this.mode === "deep" ? "Синхронизация Worker" : "Подключаю резерв Worker");
      if (this.mode === "deep") this.loadSnapshot(generation);''',
        "socket open syncing status",
    )

    source = replace_once(
        source,
        '''        this.lastUpdateId = Number(update.u ?? update.lastUpdateId) || this.lastUpdateId;
        this.depthReady = true;
        this.cachedSorted = null;''',
        '''        this.lastUpdateId = Number(update.u ?? update.lastUpdateId) || this.lastUpdateId;
        this.depthReady = true;
        this.syncing = false;
        this.cachedSorted = null;''',
        "partial atomic completion",
    )

    source = replace_once(
        source,
        '''      this.socket = null;
      this.transportIndex += 1;
      this.resetBook();
      this.setStatus("offline", "RECONNECT · WORKER");''',
        '''      this.socket = null;
      this.transportIndex += 1;
      const preserveLastFrame = this.depthReady || this.syncing;
      this.syncing = preserveLastFrame;
      this.resetBook();
      this.setStatus(
        preserveLastFrame ? "stale" : "offline",
        preserveLastFrame ? "СИНХРОНИЗАЦИЯ · последний кадр" : "RECONNECT · WORKER",
      );''',
        "depth close last frame status",
    )

    source = replace_once(
        source,
        '''  async loadRecentTrades(generation) {
    if (generation !== this.generation || this.tradeBootstrapLoading) return;''',
        '''  async loadRecentTrades(generation, { resume = false } = {}) {
    if (generation !== this.generation || this.tradeBootstrapLoading) return;''',
        "trade catchup signature",
    )

    source = replace_once(
        source,
        '''    let added = false;
    for (const row of rows) {
      const trade = normalizeTrade(row, "agg");
      if (this.insertTrade(trade, true)) added = true;
    }
    if (!added) return;
    this.trades.sort((left, right) => Number(right.time) - Number(left.time));
    if (tabVisible) {
      post("tape", this.symbol, {
        replace: true,
        trades: this.trades.slice(0, MAX_TAPE_SNAPSHOT),
      });
    }''',
        '''    const addedTrades = [];
    for (const row of rows) {
      const trade = normalizeTrade(row, "agg");
      if (this.insertTrade(trade, true)) addedTrades.push(trade);
    }
    if (!addedTrades.length) return;
    this.trades.sort((left, right) => Number(right.time) - Number(left.time));
    if (tabVisible) {
      const trades = resume
        ? addedTrades.sort((left, right) => Number(left.time) - Number(right.time)).slice(-MAX_RESUME_TAPE_SNAPSHOT)
        : this.trades.slice(0, MAX_TAPE_SNAPSHOT);
      post("tape", this.symbol, {
        replace: !resume,
        resume,
        trades,
      });
    }''',
        "trade catchup payload",
    )

    source = replace_once(
        source,
        '''   const hasRawRange = Number.isInteger(Number(trade.firstTradeId))
  && Number.isInteger(Number(trade.lastTradeId));
const firstTradeId = hasRawRange ? Number(trade.firstTradeId) : trade.id;
const lastTradeId = hasRawRange ? Number(trade.lastTradeId) : trade.id;
const key = `${firstTradeId}:${lastTradeId}:${trade.time}:${trade.price}:${trade.quantity}`;
if (hasRawRange) this.tapeGuard.advanceBoundary(lastTradeId);''',
        '''    const hasRawRange = Number.isInteger(Number(trade.firstTradeId))
      && Number.isInteger(Number(trade.lastTradeId));
    const firstTradeId = hasRawRange ? Number(trade.firstTradeId) : trade.id;
    const lastTradeId = hasRawRange ? Number(trade.lastTradeId) : trade.id;
    const key = `${firstTradeId}:${lastTradeId}:${trade.time}:${trade.price}:${trade.quantity}`;
    if (hasRawRange) this.tapeGuard.advanceBoundary(lastTradeId);''',
        "legacy trade range formatting",
    )

    source = replace_once(
        source,
        '''    // Возвращаем книги по очереди, чтобы 3–6 окон не забивали главный поток одновременно.
    const active = [...feeds.values()].filter((feed) => feed.subscribers > 0);
    active.forEach((feed, index) => feed.resume(index * RESUME_STAGGER_MS, epoch));''',
        '''    // Видимый/последний выбранный инструмент восстанавливаем первым,
    // остальные книги — по очереди, без WebSocket-шторма.
    const prioritySymbols = Array.isArray(message.prioritySymbols)
      ? message.prioritySymbols.map((symbol) => String(symbol).toUpperCase())
      : [];
    const priorityRank = new Map(prioritySymbols.map((symbol, index) => [symbol, index]));
    const active = [...feeds.values()]
      .filter((feed) => feed.subscribers > 0)
      .sort((left, right) => (
        (priorityRank.get(left.symbol) ?? Number.MAX_SAFE_INTEGER)
        - (priorityRank.get(right.symbol) ?? Number.MAX_SAFE_INTEGER)
      ));
    active.forEach((feed, index) => feed.resume(index * RESUME_STAGGER_MS, epoch));''',
        "priority resume scheduling",
    )

    return source


def transform_service_worker(source: str) -> str:
    cache_old = "v26-22-background-restart"
    cache_new = "v26-23-seamless-resume"
    asset_old = "v=26-22-background-restart"
    asset_new = "v=26-23-seamless-resume"

    cache_count = source.count(cache_old)
    asset_count = source.count(asset_old)
    if cache_count != 1:
        raise RuntimeError(
            f"Expected one Service Worker cache name anchor, got {cache_count}"
        )
    if asset_count != 4:
        raise RuntimeError(
            f"Expected four Service Worker asset version anchors, got {asset_count}"
        )

    updated = source.replace(cache_old, cache_new).replace(asset_old, asset_new)
    required = (
        'const CACHE = "inpuls-v26-23-seamless-resume";',
        '"./orderbook.js?v=26-23-seamless-resume"',
        '"./orderbook-worker.js?v=26-23-seamless-resume"',
        'new URL("./orderbook.js?v=26-23-seamless-resume"',
        'new URL("./orderbook-worker.js?v=26-23-seamless-resume"',
    )
    missing = [anchor for anchor in required if anchor not in updated]
    if missing:
        raise RuntimeError(
            "Service Worker cache update is incomplete: " + ", ".join(missing)
        )
    if cache_old in updated or asset_old in updated:
        raise RuntimeError("Old Service Worker cache version remains after replacement")
    print(
        f"Updated {cache_count} cache name and {asset_count} asset version anchors"
    )
    return updated


def main() -> None:
    orderbook_source = ORDERBOOK.read_text(encoding="utf-8")
    worker_source = WORKER.read_text(encoding="utf-8")
    sw_source = SERVICE_WORKER.read_text(encoding="utf-8")

    updated_orderbook = transform_orderbook(orderbook_source)
    updated_worker = transform_worker(worker_source)
    updated_sw = transform_service_worker(sw_source)

    if updated_orderbook == orderbook_source:
        raise RuntimeError("orderbook.js was not changed")
    if updated_worker == worker_source:
        raise RuntimeError("orderbook-worker.js was not changed")
    if updated_sw == sw_source:
        raise RuntimeError("sw.js was not changed")

    ORDERBOOK.write_text(updated_orderbook, encoding="utf-8")
    WORKER.write_text(updated_worker, encoding="utf-8")
    SERVICE_WORKER.write_text(updated_sw, encoding="utf-8")

    (ROOT / "tools/apply-seamless-resume.py").unlink(missing_ok=True)
    (ROOT / ".github/workflows/apply-seamless-resume.yml").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
