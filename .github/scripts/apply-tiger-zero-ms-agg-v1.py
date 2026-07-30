from pathlib import Path
import re

OLD_BUILD = "26-76-zero-ms-threshold-v1"
NEW_BUILD = "26-77-tiger-zero-ms-agg-v1"


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


worker = read("orderbook-worker.js")
worker = replace_once(
    worker,
    '''function tradeStreams(symbol) {
  const name = symbol.toLowerCase();
  return [`${name}@aggTrade`];
}
''',
    '''function tradeStreams(symbol) {
  const name = symbol.toLowerCase();
  // @aggTrade remains the stable visual RAW feed. @trade is consumed only by
  // the guarded Tiger-style 0 ms aggregation channel.
  return [`${name}@aggTrade`, `${name}@trade`];
}
''',
    "dual trade streams",
)
worker = replace_once(
    worker,
    '''    this.trades = new self.InPulsOrderBookBuffers.RecentRingBuffer(MAX_TRADE_HISTORY);
    this.tradeIds = new Set();
    this.tapeBatch = new self.InPulsOrderBookBuffers.LatestBatchQueue(MAX_PENDING_TAPE_TRADES);
''',
    '''    this.trades = new self.InPulsOrderBookBuffers.RecentRingBuffer(MAX_TRADE_HISTORY);
    this.tradeIds = new Set();
    this.tapeBatch = new self.InPulsOrderBookBuffers.LatestBatchQueue(MAX_PENDING_TAPE_TRADES);
    this.aggregationTrades = new self.InPulsOrderBookBuffers.RecentRingBuffer(MAX_TRADE_HISTORY);
    this.aggregationTradeIds = new Set();
    this.aggregationTapeBatch = new self.InPulsOrderBookBuffers.LatestBatchQueue(MAX_PENDING_TAPE_TRADES);
''',
    "aggregation channel buffers",
)
worker = replace_once(
    worker,
    '''  tradeSnapshot(limit = MAX_TRADE_HISTORY) {
    return this.trades.toArray(limit);
  }

  tradeKey(trade) {
''',
    '''  tradeSnapshot(limit = MAX_TRADE_HISTORY) {
    return this.trades.toArray(limit);
  }

  aggregationBoundary() {
    let boundary = null;
    for (const trade of this.aggregationTrades) {
      const value = Number(trade?.lastTradeId);
      if (Number.isInteger(value) && value >= 0) boundary = boundary === null ? value : Math.max(boundary, value);
    }
    return boundary;
  }

  tradeKey(trade) {
''',
    "aggregation boundary",
)
worker = replace_once(
    worker,
    '    this.tapeGuard.reset({ lastOutputTradeId: this.tradeBoundary() });\n',
    '    this.tapeGuard.reset({ lastOutputTradeId: this.aggregationBoundary() });\n',
    "guard boundary uses selected aggregation feed",
)
worker = worker.replace(
    '''      trades: [],
''',
    '''      trades: [],
      aggregationTrades: [],
      aggregationSource: "agg",
''',
)
if worker.count('aggregationTrades: [],') != 3:
    raise AssertionError(f"reset payloads: expected 3, found {worker.count('aggregationTrades: [],')}")
worker = replace_once(
    worker,
    '''    this.tapeBatch.clear();
  }
''',
    '''    this.tapeBatch.clear();
    this.aggregationTapeBatch.clear();
  }
''',
    "stop clears aggregation batch",
)
worker = replace_once(
    worker,
    '''    this.tapeBatch.clear();
    clearTimeout(this.tapeTimer);
''',
    '''    this.tapeBatch.clear();
    this.aggregationTapeBatch.clear();
    clearTimeout(this.tapeTimer);
''',
    "background clears aggregation batch",
)

worker = regex_once(
    worker,
    r'''        const update = payload\.data;\n        const eventType = String\(update\?\.e \?\? ""\)\.toLowerCase\(\);\n        const payloadStream = payload\.stream\.toLowerCase\(\);\n        const aggregateEvent = eventType === "aggtrade" \|\| payloadStream\.endsWith\("@aggtrade"\);\n        if \(!aggregateEvent\) return;\n\n        const receivedAt = Date\.now\(\);\n        const trade = normalizeTrade\(update, "agg", receivedAt\);[\s\S]*?        this\.queueTape\(trade\);''',
    '''        const update = payload.data;
        const eventType = String(update?.e ?? "").toLowerCase();
        const payloadStream = payload.stream.toLowerCase();
        const rawEvent = eventType === "trade" || payloadStream.endsWith("@trade");
        const aggregateEvent = eventType === "aggtrade" || payloadStream.endsWith("@aggtrade");
        if (!rawEvent && !aggregateEvent) return;

        const receivedAt = Date.now();
        const source = rawEvent ? "raw" : "agg";
        const trade = normalizeTrade(update, source, receivedAt);
        if (!trade) return;
        const firstTradeMessage = !receivedTrade;
        receivedTrade = true;
        clearTimeout(this.tradeFirstMessageTimer);
        this.tradeFirstMessageTimer = 0;
        this.lastTradeAt = receivedAt;
        this.lastTradeEventTime = trade.eventTime;
        this.lastTradeSourceLagMs = calibratedSourceLag(trade.eventTime, receivedAt);
        this.tradeLatency.record(trade.rxLatencyMs, receivedAt);
        this.tradeTransportIndex = 0;
        this.tradeReconnectAttempt = 0;
        this.tradeLive = true;
        this.tradeConnected = true;
        if (firstTradeMessage) {
          diagnose(this.symbol, "tape.ws.first-message", {
            state: "received",
            generation,
            transport: transportIndex,
            transportName: transport.name,
            source,
          });
        }

        const decision = this.tapeGuard.ingest(trade, this.lastTradeAt);
        let changed = false;

        // Preserve the visual RAW contract: it continues to receive only
        // Binance @aggTrade events, exactly as before this feature.
        if (aggregateEvent && this.insertTrade(trade, true)) {
          const matchedDensities = this.densityLifecycle.ingestTrades([trade]);
          if (matchedDensities.length) this.markDirty();
          this.queueTape(trade);
          changed = true;
        }

        // The second channel is sequence-guarded. It starts on @aggTrade,
        // promotes to individual @trade after warm-up, and falls back without
        // overlaps when raw IDs gap, reorder or go stale.
        if (decision.emit && this.insertAggregationTrade(trade, true)) {
          this.queueAggregationTape(trade);
          changed = true;
        }

        this.publishLiveStatus();
        if (!changed && rawEvent && decision.reason !== "raw-warmup") {
          diagnose(this.symbol, "tape.aggregation-source", {
            state: "skipped",
            source,
            reason: decision.reason,
            mode: decision.mode,
          });
        }''',
    "dual-source trade handler",
    flags=re.MULTILINE,
)

worker = replace_once(
    worker,
    '''  queueTape(trade) {
    if (!trade || !tabVisible) return;
    this.tapeBatch.push(trade);
    if (!this.tapeTimer) {
      this.tapeTimer = setTimeout(() => this.flushTapeBatch(), TAPE_FLUSH_MS);
    }
  }

  flushTapeBatch() {
    this.tapeTimer = 0;
    if (!tabVisible) {
      this.tapeBatch.clear();
      return;
    }
    const latest = this.tapeBatch.takeLatest(MAX_TAPE_BATCH_PER_POST);
    const trades = latest.items;
    this.tapeDroppedInWindow += latest.dropped;
    if (trades.length) {
      const sourceEventTimeMs = trades.reduce(
        (latest, trade) => Math.max(latest, Number(trade?.eventTime) || 0),
        0,
      );
      post(
        "tape",
        this.symbol,
        {
          replace: false,
          live: true,
          liveOnly: true,
          trades,
          backpressure: {
            dropped: latest.dropped,
            pending: this.tapeBatch.length,
          },
        },
        observabilityEnabled ? performance.now() : null,
        { sourceEventTimeMs, sourceKind: "live-trade" },
      );
    }
  }
''',
    '''  insertAggregationTrade(trade, newestFirst = true) {
    if (!trade) return false;
    const key = this.tradeKey(trade);
    if (this.aggregationTradeIds.has(key)) return false;
    this.aggregationTradeIds.add(key);
    const evicted = newestFirst
      ? this.aggregationTrades.prepend(trade)
      : this.aggregationTrades.append(trade);
    if (evicted === trade) {
      this.aggregationTradeIds.delete(key);
      return false;
    }
    if (evicted) this.aggregationTradeIds.delete(this.tradeKey(evicted));
    return true;
  }

  scheduleTapeFlush() {
    if (!this.tapeTimer) {
      this.tapeTimer = setTimeout(() => this.flushTapeBatch(), TAPE_FLUSH_MS);
    }
  }

  queueTape(trade) {
    if (!trade || !tabVisible) return;
    this.tapeBatch.push(trade);
    this.scheduleTapeFlush();
  }

  queueAggregationTape(trade) {
    if (!trade || !tabVisible) return;
    this.aggregationTapeBatch.push(trade);
    this.scheduleTapeFlush();
  }

  flushTapeBatch() {
    this.tapeTimer = 0;
    if (!tabVisible) {
      this.tapeBatch.clear();
      this.aggregationTapeBatch.clear();
      return;
    }
    const latest = this.tapeBatch.takeLatest(MAX_TAPE_BATCH_PER_POST);
    const aggregationLatest = this.aggregationTapeBatch.takeLatest(MAX_TAPE_BATCH_PER_POST);
    const trades = latest.items;
    const aggregationTrades = aggregationLatest.items;
    this.tapeDroppedInWindow += latest.dropped + aggregationLatest.dropped;
    if (trades.length || aggregationTrades.length) {
      const sourceEventTimeMs = [...trades, ...aggregationTrades].reduce(
        (latestTime, trade) => Math.max(latestTime, Number(trade?.eventTime) || 0),
        0,
      );
      const guard = this.tapeGuard.snapshot();
      post(
        "tape",
        this.symbol,
        {
          replace: false,
          live: true,
          liveOnly: true,
          trades,
          aggregationTrades,
          aggregationSource: guard.mode,
          aggregationHealth: guard,
          backpressure: {
            dropped: latest.dropped + aggregationLatest.dropped,
            pending: this.tapeBatch.length + this.aggregationTapeBatch.length,
          },
        },
        observabilityEnabled ? performance.now() : null,
        { sourceEventTimeMs, sourceKind: "live-trade-dual" },
      );
    }
  }
''',
    "parallel tape queues",
)
write("orderbook-worker.js", worker)

orderbook = read("orderbook.js")
orderbook = replace_once(
    orderbook,
    '''          trades: Array.isArray(message.trades) ? message.trades : [],
''',
    '''          trades: Array.isArray(message.trades) ? message.trades : [],
          aggregationTrades: Array.isArray(message.aggregationTrades) ? message.aggregationTrades : [],
          aggregationSource: message.aggregationSource === "raw" ? "raw" : "agg",
          aggregationHealth: message.aggregationHealth ?? null,
''',
    "worker bridge aggregation channel",
)
orderbook = replace_once(
    orderbook,
    'const tapeTradesBySymbol = new Map();\n',
    'const tapeTradesBySymbol = new Map();\nconst tapeAggregationTradesBySymbol = new Map();\n',
    "aggregation trade map",
)
orderbook = replace_once(
    orderbook,
    '''  button.title = aggregated
    ? "AGG 0 мс: объединяются только последовательные исполнения с одинаковым биржевым временем и направлением. Текущий агрегат появляется сразу; история не пересчитывается."
    : "Каждое исполнение отображается отдельно по точному времени";
''',
    '''  const source = state.aggregationSource === "raw" ? "@trade RAW" : "@aggTrade fallback";
  button.dataset.aggregationSource = state.aggregationSource === "raw" ? "raw" : "agg";
  button.title = aggregated
    ? `AGG 0 мс · ${source}: объединяются последовательные исполнения с одинаковым биржевым временем и направлением. Текущий агрегат появляется сразу; история не пересчитывается.`
    : "Каждое исполнение отображается отдельно по стабильному @aggTrade-потоку";
''',
    "source-aware AGG tooltip",
)
orderbook = replace_once(
    orderbook,
    '      minQuote: savedMinimum === null ? 0 : Math.max(0, Number(savedMinimum) || 0),\n',
    '      minQuote: savedMinimum === null ? 0 : Math.max(0, Number(savedMinimum) || 0),\n      aggregationSource: "agg",\n',
    "card aggregation source state",
)
orderbook = replace_once(
    orderbook,
    'function refreshTapeRenderModel(state, symbol, stored) {\n',
    'function refreshTapeRenderModel(state, symbol, stored, aggregationStored = stored) {\n',
    "render model dual inputs",
)
orderbook = replace_once(
    orderbook,
    '  state.aggSourceBuckets = aggregateTapeZeroMs(stored);\n',
    '  const aggregationInput = aggregationStored?.length ? aggregationStored : stored;\n  state.aggSourceBuckets = aggregateTapeZeroMs(aggregationInput);\n',
    "aggregate from selected feed",
)
orderbook = replace_once(
    orderbook,
    '''  const stored = tapeTradesBySymbol.get(symbol) ?? [];
  if (!stored.length) {
''',
    '''  const stored = tapeTradesBySymbol.get(symbol) ?? [];
  const aggregationStored = tapeAggregationTradesBySymbol.get(symbol) ?? [];
  if (!stored.length && !aggregationStored.length) {
''',
    "draw accepts aggregation-only packets",
)
orderbook = replace_once(
    orderbook,
    '''  const meta = tapeMetaBySymbol.get(symbol) ?? {};
  const latestTime = Number(meta.lastTradeTime)
    || Number(stored[0]?.time)
    || Date.now();
''',
    '''  const meta = tapeMetaBySymbol.get(symbol) ?? {};
  state.aggregationSource = meta.aggregationSource === "raw" ? "raw" : "agg";
  syncTapeModeButton(state.controls?.querySelector("[data-inpuls-tape-mode]"), state);
  const latestTime = Number(meta.lastTradeTime)
    || Number(stored[0]?.time)
    || Number(aggregationStored[0]?.time)
    || Date.now();
''',
    "draw source state",
)
orderbook = replace_once(
    orderbook,
    '  refreshTapeRenderModel(state, symbol, stored);\n',
    '  refreshTapeRenderModel(state, symbol, stored, aggregationStored);\n',
    "draw selected feed",
)

orderbook = regex_once(
    orderbook,
    r'function drainTapeIngest\(\) \{[\s\S]*?\n\}\n\nfunction acceptTapeData\(event\) \{[\s\S]*?\n\}\n\n(?=function bindTapeCard)',
    '''function drainTapeIngest() {
  tapeIngestFrame = 0;
  const frameStartedAt = performance.now();
  let budget = TAPE_INGEST_PER_FRAME;
  const cardCount = Math.max(1, document.querySelectorAll(".orderbook-card").length);
  if (cardCount >= 6) budget = 120;
  else if (cardCount >= 3) budget = 170;
  const pendingEntries = [...tapePendingBySymbol.entries()];
  const liveShare = Math.max(1, Math.floor(budget / Math.max(1, pendingEntries.length)));
  let processedSymbols = 0;
  let processedTrades = 0;

  for (const [symbol, pending] of pendingEntries) {
    if (budget <= 0) break;
    const allowance = pending.resume
      ? TAPE_RESUME_MAX_PENDING
      : Math.min(budget, liveShare);
    let primaryTake = Math.min(pending.trades.length, Math.ceil(allowance / 2));
    let aggregationTake = Math.min(pending.aggregationTrades.length, allowance - primaryTake);
    let unused = allowance - primaryTake - aggregationTake;
    if (unused > 0) {
      const extraPrimary = Math.min(unused, pending.trades.length - primaryTake);
      primaryTake += extraPrimary;
      unused -= extraPrimary;
    }
    if (unused > 0) {
      aggregationTake += Math.min(unused, pending.aggregationTrades.length - aggregationTake);
    }

    const primaryChunk = pending.trades.splice(0, primaryTake);
    const aggregationChunk = pending.aggregationTrades.splice(0, aggregationTake);
    const changed = pending.replace || primaryChunk.length || aggregationChunk.length;
    if (!changed) {
      tapePendingBySymbol.delete(symbol);
      continue;
    }

    processedSymbols += 1;
    processedTrades += primaryChunk.length + aggregationChunk.length;
    tapeTradesBySymbol.set(
      symbol,
      mergeTapeHistory(tapeTradesBySymbol.get(symbol) ?? [], primaryChunk, pending.replace),
    );
    tapeAggregationTradesBySymbol.set(
      symbol,
      mergeTapeHistory(tapeAggregationTradesBySymbol.get(symbol) ?? [], aggregationChunk, pending.replace),
    );
    tapeDataVersionBySymbol.set(
      symbol,
      (Number(tapeDataVersionBySymbol.get(symbol)) || 0) + 1,
    );
    pending.replace = false;
    if (pending.resume) {
      pending.resume = false;
      budget = 0;
    } else {
      budget -= Math.max(1, primaryChunk.length + aggregationChunk.length);
    }

    const stored = tapeTradesBySymbol.get(symbol) ?? [];
    const aggregationStored = tapeAggregationTradesBySymbol.get(symbol) ?? [];
    const latestTime = Math.max(
      Number(stored[0]?.time) || 0,
      Number(aggregationStored[0]?.time) || 0,
    ) || Date.now();
    const previousMeta = tapeMetaBySymbol.get(symbol) ?? {};
    tapeMetaBySymbol.set(symbol, {
      lastPacketAt: Date.now(),
      lastPacketPerfAt: performance.now(),
      lastTradeTime: latestTime,
      packets: (Number(previousMeta.packets) || 0) + 1,
      aggregationSource: pending.aggregationSource === "raw" ? "raw" : "agg",
      aggregationHealth: pending.aggregationHealth ?? previousMeta.aggregationHealth ?? null,
    });
    tapeRecentRateBySymbol.set(symbol, stored.reduce(
      (count, trade) => count + (trade.time >= latestTime - 1_000 ? 1 : 0),
      0,
    ));

    const cards = [...document.querySelectorAll(".orderbook-card")]
      .filter((card) => cardSymbol(card) === symbol && flowLayerVisible(card));
    cards.forEach((card) => scheduleTapeDraw(false, card));

    if (!pending.trades.length && !pending.aggregationTrades.length) {
      tapePendingBySymbol.delete(symbol);
    }
  }

  if (observability.enabled) {
    observability.record("tape.ingest-frame", performance.now() - frameStartedAt, {
      symbols: processedSymbols,
      trades: processedTrades,
      pendingSymbols: tapePendingBySymbol.size,
    });
  }
  if (tapePendingBySymbol.size) scheduleTapeIngest();
}

function acceptTapeData(event) {
  const detail = event?.detail;
  const symbol = String(detail?.symbol ?? "").toUpperCase();
  if (!symbol.endsWith("USDT")) return;
  if (!detail?.replace && !detail?.live) return;
  const incoming = detail?.live && Array.isArray(detail?.trades)
    ? detail.trades.map(normalizeTapeTrade).filter(Boolean)
    : [];
  const incomingAggregation = detail?.live && Array.isArray(detail?.aggregationTrades)
    ? detail.aggregationTrades.map(normalizeTapeTrade).filter(Boolean)
    : [];
  if (!detail?.replace && !incoming.length && !incomingAggregation.length) return;
  if (detail?.replace) {
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      if (cardSymbol(card) !== symbol) return;
      const state = tapeCardStates.get(card);
      if (state) {
        state.hasFrame = false;
        state.clockEndTime = null;
        state.clockPerfAt = null;
        state.priceViewport = null;
        state.priceViewportAt = null;
        state.targetPriceViewport = null;
        state.priceRange = null;
        state.viewportSampleAt = null;
        state.viewportDirty = true;
        state.renderModelKey = null;
        state.rawNodeByKey?.clear?.();
        state.rawRenderNodes = [];
        state.aggSourceBuckets = [];
        state.aggSnapshots?.clear?.();
      }
    });
  }

  const pending = tapePendingBySymbol.get(symbol) ?? {
    trades: [],
    aggregationTrades: [],
    aggregationSource: "agg",
    aggregationHealth: null,
    replace: false,
    resume: false,
  };
  pending.aggregationSource = detail?.aggregationSource === "raw" ? "raw" : "agg";
  pending.aggregationHealth = detail?.aggregationHealth ?? pending.aggregationHealth;
  if (detail.resume) {
    pending.trades = incoming.slice(0, TAPE_RESUME_MAX_PENDING);
    pending.aggregationTrades = incomingAggregation.slice(0, TAPE_RESUME_MAX_PENDING);
    pending.replace = false;
    pending.resume = true;
  } else if (detail.replace) {
    pending.trades = incoming.slice(0, TAPE_MAX_STORED);
    pending.aggregationTrades = incomingAggregation.slice(0, TAPE_MAX_STORED);
    pending.replace = true;
    pending.resume = false;
  } else {
    if (incoming.length) pending.trades.push(...incoming);
    if (incomingAggregation.length) pending.aggregationTrades.push(...incomingAggregation);
    for (const [name, queue] of [
      ["primary", pending.trades],
      ["aggregation", pending.aggregationTrades],
    ]) {
      if (queue.length <= TAPE_LIVE_MAX_PENDING) continue;
      const dropped = queue.length - TAPE_LIVE_MAX_PENDING;
      queue.splice(0, dropped);
      observability.record("tape.main-dropped", dropped, { symbol, channel: name });
    }
  }
  tapePendingBySymbol.set(symbol, pending);
  scheduleTapeIngest();
}

''',
    "dual channel main ingest",
    flags=re.MULTILINE,
)
write("orderbook.js", orderbook)

new_test = '''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { aggregateTapeZeroMs } from "./orderbook.js";

const worker = readFileSync(new URL("./orderbook-worker.js", import.meta.url), "utf8");
const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

const raw = (id, time, side, quote, price = 100) => ({
  id,
  firstTradeId: id,
  lastTradeId: id,
  source: "raw",
  time,
  tradeTime: time,
  eventTime: time,
  side,
  price,
  quantity: quote / price,
  quote,
});

test("Worker keeps visual RAW on aggTrade and exposes guarded trade input for AGG", () => {
  assert.match(worker, /return \[`\$\{name\}@aggTrade`, `\$\{name\}@trade`\]/);
  assert.match(worker, /if \(aggregateEvent && this\.insertTrade\(trade, true\)\)/);
  assert.match(worker, /if \(decision\.emit && this\.insertAggregationTrade\(trade, true\)\)/);
  assert.match(worker, /aggregationTrades,/);
  assert.match(worker, /aggregationSource: guard\.mode/);
});

test("Main renders AGG from the selected source and keeps fallback", () => {
  assert.match(orderbook, /const tapeAggregationTradesBySymbol = new Map\(\)/);
  assert.match(orderbook, /aggregationInput = aggregationStored\?\.length \? aggregationStored : stored/);
  assert.match(orderbook, /aggregationSource: message\.aggregationSource === "raw" \? "raw" : "agg"/);
  assert.match(orderbook, /@trade RAW/);
  assert.match(orderbook, /@aggTrade fallback/);
});

test("Tiger-style zero-ms aggregation joins individual same-time same-side executions", () => {
  const groups = aggregateTapeZeroMs([
    raw(10, 1_000, "buy", 100),
    raw(11, 1_000, "buy", 200),
    raw(12, 1_000, "sell", 50),
    raw(13, 1_001, "sell", 70),
  ]);
  assert.deepEqual(groups.map((item) => [item.eventTime, item.side, item.count, item.quote]), [
    [1_000, "buy", 2, 300],
    [1_000, "sell", 1, 50],
    [1_001, "sell", 1, 70],
  ]);
});

test("Tape marker threshold remains available", () => {
  assert.match(orderbook, /data-inpuls-trade-min/);
  assert.match(orderbook, /TAPE_MIN_FILTER_KEY/);
});
'''
write("test-tiger-zero-ms-agg-source-v1.mjs", new_test)

paths = [
    Path("VERSION.txt"), Path("app.js"), Path("index.html"), Path("orderbook.js"),
    Path("orderbook-worker.js"), Path("refresh.html"), Path("refresh.js"),
    Path("reset-v26.html"), Path("reset.js"), Path("sw.js"),
]
paths += list(Path(".").glob("test*.mjs"))
paths += list(Path("test").rglob("*.js"))
seen = set()
for path in paths:
    if path in seen or not path.exists():
        continue
    seen.add(path)
    text = path.read_text(encoding="utf-8")
    if OLD_BUILD in text:
        path.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

assert NEW_BUILD in read("VERSION.txt")
final_worker = read("orderbook-worker.js")
final_orderbook = read("orderbook.js")
assert '${name}@trade' in final_worker
assert 'aggregationTapeBatch' in final_worker
assert 'aggregationTrades' in final_worker
assert 'tapeAggregationTradesBySymbol' in final_orderbook
assert 'data-inpuls-trade-min' in final_orderbook
assert 'TAPE_AGGREGATION_LEVELS' not in final_orderbook
