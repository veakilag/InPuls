from pathlib import Path


def replace_exact(path, old, new, expected=1):
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old[:140]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


extremes = "signal-lab-v4-extremes.js"
replace_exact(
    extremes,
    'export const SIGNAL_LAB_V4_EXTREME_FORMULA_VERSION = "signal-lab-v4-extremes-v1-2026-08";',
    'export const SIGNAL_LAB_V4_EXTREME_FORMULA_VERSION = "signal-lab-v6-candle-extremes-v2-2026-08";',
)
replace_exact(
    extremes,
    "    this.extremes = [];\n    this.extremeById = new Map();\n    this.eventLog = [];",
    "    this.extremes = [];\n    this.extremeById = new Map();\n    this.activeExtremeIds = new Set();\n    this.eventLog = [];",
)
replace_exact(
    extremes,
    "    this.extremes.push(row);\n    this.extremeById.set(id, row);\n    this.eventLog.push({ type: \"EXTREME_CONFIRMED\", at: confirmedAt, extremeId: id });",
    "    this.extremes.push(row);\n    this.extremeById.set(id, row);\n    this.activeExtremeIds.add(id);\n    this.eventLog.push({ type: \"EXTREME_CONFIRMED\", at: confirmedAt, extremeId: id });\n    if (this.eventLog.length > this.config.historyLimit * 2) {\n      this.eventLog.splice(0, this.eventLog.length - this.config.historyLimit * 2);\n    }",
)
replace_exact(
    extremes,
    "  #advanceCandidates(candle, knownAt) {",
    "  observePrice(price, at = Date.now(), {\n    dataQuality = this.dataQuality,\n    emitSnapshot = true,\n  } = {}) {\n    const value = finite(price);\n    const timestamp = finite(at);\n    if (value === null || value <= 0 || timestamp === null) {\n      return emitSnapshot ? this.snapshot() : null;\n    }\n    this.dataQuality = normalizeQuality(dataQuality);\n    const ticks = priceToTicks(value, this.tickSize);\n    this.#observeActiveTicks(ticks, ticks, timestamp, this.barIndex);\n    return emitSnapshot ? this.snapshot() : null;\n  }\n\n  #advanceCandidates(candle, knownAt) {",
)
replace_exact(
    extremes,
    "    for (const row of this.extremes) {\n      if (!row.active) continue;",
    "    for (const extremeId of [...this.activeExtremeIds]) {\n      const row = this.extremeById.get(extremeId);\n      if (!row?.active) {\n        this.activeExtremeIds.delete(extremeId);\n        continue;\n      }",
)
replace_exact(
    extremes,
    "        row.invalidatedAt = at;\n        row.dataQuality = this.dataQuality;\n        this.eventLog.push({ type: \"EXTREME_CROSSED\", at, extremeId: row.id });",
    "        row.invalidatedAt = at;\n        row.dataQuality = this.dataQuality;\n        this.activeExtremeIds.delete(row.id);\n        this.eventLog.push({ type: \"EXTREME_CROSSED\", at, extremeId: row.id });",
)
replace_exact(
    extremes,
    "  snapshot() {\n    return Object.freeze({",
    "  snapshot({ includeHistory = true, includeEvents = true } = {}) {\n    return Object.freeze({",
    expected=1,
)
replace_exact(
    extremes,
    "      history: Object.freeze(this.extremes.slice(-500).map(extremePublic)),\n      events: Object.freeze(clone(this.eventLog.slice(-1_000))),",
    "      history: Object.freeze(includeHistory ? this.extremes.slice(-500).map(extremePublic) : []),\n      events: Object.freeze(includeEvents ? clone(this.eventLog.slice(-1_000)) : []),",
)
replace_exact(
    extremes,
    "  snapshot(symbol) {\n    const normalized = normalizeSymbol(symbol);",
    "  observePrice(symbol, price, at, options = {}) {\n    const normalized = normalizeSymbol(symbol);\n    if (!normalized) return null;\n    const emitSnapshot = options.emitSnapshot !== false;\n    for (const timeframe of SIGNAL_LAB_V4_TIMEFRAMES) {\n      this.engines.get(this.#key(normalized, timeframe))?.observePrice(price, at, {\n        ...options,\n        emitSnapshot: false,\n      });\n    }\n    return emitSnapshot\n      ? this.snapshot(normalized, options.snapshotOptions ?? {})\n      : null;\n  }\n\n  snapshot(symbol, options = {}) {\n    const normalized = normalizeSymbol(symbol);",
)
replace_exact(
    extremes,
    "      if (engine) timeframes[timeframe] = engine.snapshot();",
    "      if (engine) timeframes[timeframe] = engine.snapshot(options);",
)
replace_exact(
    extremes,
    "    const snapshot = this.snapshot(symbol);",
    "    const snapshot = this.snapshot(symbol, { includeHistory: false, includeEvents: false });",
)

collector = "signal-lab-v3-collector.js"
replace_exact(
    collector,
    './signal-lab-v4-extremes.js?v=signal-lab-v4-performance-1',
    './signal-lab-v4-extremes.js?v=signal-lab-v6-candle-extremes',
)
replace_exact(
    collector,
    "const STRUCTURE_TRADE_INTERVAL_MS = 200;",
    "const STRUCTURE_TRADE_INTERVAL_MS = 500;",
)
replace_exact(
    collector,
    "    this.historyLoaded = new Set();\n    this.historyLoading = new Set();",
    "    this.historyLoaded = new Set();\n    this.historyLoading = new Set();\n    this.historyRetryAt = new Map();\n    this.lastClosedMinuteAt = new Map();",
)
replace_exact(
    collector,
    "      extremeMaps: 0,\n      levelMaps: 0,",
    "      extremeMaps: 0,\n      activeExtremes: 0,\n      levelMaps: 0,",
)
replace_exact(
    collector,
    "      this.extremes.ingestTrade(data.s, finite(data.p), eventAt, {\n        dataQuality,\n        emitSnapshot: false,\n      });",
    "      // Trades may invalidate or retest an already confirmed level, but they must\n      // never manufacture 1m/5m/15m/1h/4h/1d extrema. New extrema are confirmed only\n      // by closed candles in the corresponding timeframe.\n      this.extremes.observePrice(data.s, finite(data.p), eventAt, {\n        dataQuality,\n        emitSnapshot: false,\n      });",
)
old_metrics = '''        const structureReady = Boolean(
          tickSize
          && (this.historyLoaded.has(metrics.symbol) || this.trackedAggTrades.has(metrics.symbol))
        );
        if (structureReady && closedMinuteCandles.length) {
          this.extremes.hydrate(metrics.symbol, "1m", closedMinuteCandles, {
            tickSize,
            dataQuality,
          });
        }
        const extremeMap = structureReady ? this.extremes.snapshot(metrics.symbol) : null;
        const atr1m = structureReady ? atrFromClosedCandles(closedMinuteCandles) : null;
        if (structureReady && closedMinuteCandles.length) {
          this.levels.ingestCandle(metrics.symbol, closedMinuteCandles.at(-1), {
            tickSize,
            atr: atr1m,
            dataQuality,
          });
        }'''
new_metrics = '''        const structureReady = Boolean(
          tickSize
          && (this.historyLoaded.has(metrics.symbol) || this.trackedAggTrades.has(metrics.symbol))
        );
        const latestClosedMinute = closedMinuteCandles.at(-1) ?? null;
        const previousClosedMinuteAt = this.lastClosedMinuteAt.get(metrics.symbol) ?? null;
        const hasNewClosedMinute = Boolean(
          structureReady
          && latestClosedMinute
          && (previousClosedMinuteAt === null || latestClosedMinute.time > previousClosedMinuteAt)
        );
        if (hasNewClosedMinute) {
          this.extremes.hydrate(metrics.symbol, "1m", [latestClosedMinute], {
            tickSize,
            dataQuality,
          });
          this.lastClosedMinuteAt.set(metrics.symbol, latestClosedMinute.time);
        }
        const extremeMap = structureReady
          ? this.extremes.snapshot(metrics.symbol, { includeHistory: false, includeEvents: false })
          : null;
        const atr1m = structureReady ? atrFromClosedCandles(closedMinuteCandles) : null;
        if (hasNewClosedMinute) {
          this.levels.ingestCandle(metrics.symbol, latestClosedMinute, {
            tickSize,
            atr: atr1m,
            dataQuality,
          });
        }'''
replace_exact(collector, old_metrics, new_metrics)
replace_exact(
    collector,
    "    const evidenceStatus = this.evidence.status();\n    this.#publish({",
    "    const evidenceStatus = this.evidence.status();\n    const activeExtremes = metrics.reduce((sum, row) => (\n      sum + Object.values(row.extremeMap?.timeframes ?? {}).reduce(\n        (timeframeSum, map) => timeframeSum + (map?.active?.length ?? 0),\n        0,\n      )\n    ), 0);\n    this.#publish({",
)
replace_exact(
    collector,
    "      extremeMaps: metrics.filter((row) => row.extremeMap && Object.keys(row.extremeMap.timeframes ?? {}).length).length,",
    "      extremeMaps: metrics.filter((row) => Object.values(row.extremeMap?.timeframes ?? {})\n        .some((map) => (map?.active?.length ?? 0) > 0)).length,\n      activeExtremes,",
)
old_queue = '''  #queueWarmup(metrics) {
    const ranked = metrics
      .filter((row) => (finite(row.quoteVolume24h) ?? 0) > this.settings.minimumQuoteVolume24h)
      .sort((left, right) => (finite(right.quoteVolume24h) ?? 0) - (finite(left.quoteVolume24h) ?? 0))
      .slice(0, this.maximumWarmupSymbols);
    const availableSlots = Math.max(0, 3 - this.historyLoading.size);
    const pending = ranked
      .map((row) => row.symbol)
      .filter((symbol) => !this.historyLoaded.has(symbol) && !this.historyLoading.has(symbol))
      .slice(0, availableSlots);
    for (const symbol of pending) this.#warmupSymbol(symbol);
  }'''
new_queue = '''  #queueWarmup(metrics) {
    const now = Date.now();
    const activeSymbols = [...new Set([...this.episodes.active.values()].map((episode) => episode.symbol))];
    const ranked = metrics
      .filter((row) => (finite(row.quoteVolume24h) ?? 0) > this.settings.minimumQuoteVolume24h)
      .sort((left, right) => (
        candidateWatchScore(right, this.settings) - candidateWatchScore(left, this.settings)
        || (finite(right.quoteVolume24h) ?? 0) - (finite(left.quoteVolume24h) ?? 0)
      ));
    const prioritized = [...new Set([
      ...activeSymbols,
      ...this.trackedAggTrades,
      ...ranked.map((row) => row.symbol),
    ])].slice(0, this.maximumWarmupSymbols);
    const availableSlots = Math.max(0, 3 - this.historyLoading.size);
    const pending = prioritized
      .filter((symbol) => !this.historyLoaded.has(symbol) && !this.historyLoading.has(symbol))
      .filter((symbol) => (this.historyRetryAt.get(symbol) ?? 0) <= now)
      .slice(0, availableSlots);
    for (const symbol of pending) this.#warmupSymbol(symbol);
  }'''
replace_exact(collector, old_queue, new_queue)
replace_exact(
    collector,
    "      this.historyLoaded.add(symbol);\n      this.#publish({",
    "      this.historyLoaded.add(symbol);\n      this.historyRetryAt.delete(symbol);\n      this.#publish({",
)
replace_exact(
    collector,
    "    } catch (error) {\n      this.#publish({ lastError: String(error?.message ?? error).slice(0, 180) });\n    } finally {",
    "    } catch (error) {\n      // Do not hammer Binance every second after 429/CORS/network failure.\n      this.historyRetryAt.set(symbol, Date.now() + 60_000);\n      this.#publish({ lastError: String(error?.message ?? error).slice(0, 180) });\n    } finally {",
)

owner = "owner-signal-lab-v3.js"
replace_exact(
    owner,
    './signal-lab-v3-collector.js?v=signal-lab-v5-rebuild-1',
    './signal-lab-v3-collector.js?v=signal-lab-v6-extreme-runtime',
)
replace_exact(
    owner,
    "  return `${connection} · проверки ${status.checks} · эпизоды ${status.createdEpisodes} · экстремумы ${status.extremeMaps ?? 0} · зоны ${status.levelMaps ?? 0}/${status.breakoutEvents ?? 0} · каскады ${status.cascadeSetups ?? 0}/${status.cascadeTriggered ?? 0}/${status.cascadeConfirmed ?? 0} · miniTicker ${status.miniTickerPackets ?? 0} · aggTrade ${status.aggTradePackets ?? 0}/${status.trackedTrades} · book ${status.bookPackets ?? 0} · ${depth} · пакеты ${status.evidencePacks ?? 0} · история ${status.warmupLoaded} · пакет ${age}`;",
    "  const error = status.lastError ? ` · ошибка: ${status.lastError}` : \"\";\n  return `${connection} · проверки ${status.checks} · эпизоды ${status.createdEpisodes} · экстремумы ${status.activeExtremes ?? 0} активных / ${status.extremeMaps ?? 0} монет · зоны ${status.levelMaps ?? 0}/${status.breakoutEvents ?? 0} · каскады ${status.cascadeSetups ?? 0}/${status.cascadeTriggered ?? 0}/${status.cascadeConfirmed ?? 0} · miniTicker ${status.miniTickerPackets ?? 0} · aggTrade ${status.aggTradePackets ?? 0}/${status.trackedTrades} · book ${status.bookPackets ?? 0} · ${depth} · пакеты ${status.evidencePacks ?? 0} · история ${status.warmupLoaded} · пакет ${age}${error}`;",
)
replace_exact(
    owner,
    "    scheduleRender(created.length || expired.length ? 250 : 1_200);",
    "    scheduleRender(created.length || expired.length ? 250 : evidenceUpdated.length ? 2_000 : 5_000);",
)
replace_exact(
    owner,
    "setInterval(() => scheduleRender(0), 5_000);",
    "setInterval(() => scheduleRender(0), 15_000);",
)

html = "owner-signal-lab-v3.html"
replace_exact(
    html,
    '<script type="module" src="./owner-signal-lab-v3.js?v=signal-lab-v5-rebuild-1"></script>',
    '<script type="module" src="./owner-signal-lab-v3.js?v=signal-lab-v6-extreme-runtime"></script>',
)

test_file = Path("test/signal-lab-v6-extreme-runtime-hotfix.test.js")
test_file.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SignalLabV4ExtremeRegistry,
  TimeframeExtremeEngine,
} from "../signal-lab-v4-extremes.js";

const minute = 60_000;

function candle(index, open, high, low, close) {
  return {
    time: index * minute,
    closeTime: (index + 1) * minute - 1,
    open,
    high,
    low,
    close,
    closed: true,
  };
}

function engine() {
  return new TimeframeExtremeEngine({
    symbol: "TESTUSDT",
    timeframe: "1m",
    tickSize: 0.01,
    config: { minReversalPct: 0.2, atrMultiplier: 0, minTicks: 2 },
  });
}

test("trade observation invalidates confirmed levels without manufacturing candle extrema", () => {
  const subject = engine();
  subject.ingestCandles([
    candle(0, 99.96, 100, 99.95, 99.98),
    candle(1, 99.98, 99.99, 99.70, 99.75),
  ]);
  const before = subject.snapshot();
  assert.equal(before.history.length, 1);
  const candidateBefore = before.candidates.low;

  subject.observePrice(99.80, 2 * minute + 1);
  const observed = subject.snapshot();
  assert.equal(observed.history.length, 1);
  assert.deepEqual(observed.candidates.low, candidateBefore);
  assert.equal(observed.active.length, 1);

  subject.observePrice(100.01, 2 * minute + 2);
  assert.equal(subject.snapshot().active.length, 0);
  assert.equal(subject.snapshot().history.length, 1);
});

test("lean live snapshot preserves active extrema and omits heavy history", () => {
  const subject = engine();
  subject.ingestCandles([
    candle(0, 99.96, 100, 99.95, 99.98),
    candle(1, 99.98, 99.99, 99.70, 99.75),
  ]);
  const snapshot = subject.snapshot({ includeHistory: false, includeEvents: false });
  assert.equal(snapshot.active.length, 1);
  assert.deepEqual(snapshot.history, []);
  assert.deepEqual(snapshot.events, []);
});

test("registry observes only already hydrated timeframe engines", () => {
  const registry = new SignalLabV4ExtremeRegistry();
  registry.setTickSize("TESTUSDT", 0.01);
  registry.hydrate("TESTUSDT", "1m", [
    candle(0, 99.96, 100, 99.95, 99.98),
    candle(1, 99.98, 99.99, 99.70, 99.75),
  ]);
  registry.observePrice("TESTUSDT", 99.80, 2 * minute + 1, { emitSnapshot: false });
  const snapshot = registry.snapshot("TESTUSDT", { includeHistory: false, includeEvents: false });
  assert.deepEqual(Object.keys(snapshot.timeframes), ["1m"]);
  assert.equal(snapshot.timeframes["1m"].active.length, 1);
});

test("collector live path is candle-driven and uses lean extreme maps", () => {
  const collector = fs.readFileSync(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
  assert.match(collector, /this\.extremes\.observePrice\(data\.s/);
  assert.doesNotMatch(collector, /this\.extremes\.ingestTrade\(data\.s/);
  assert.match(collector, /hydrate\(metrics\.symbol, "1m", \[latestClosedMinute\]/);
  assert.match(collector, /includeHistory: false, includeEvents: false/);
  assert.match(collector, /historyRetryAt\.set\(symbol, Date\.now\(\) \+ 60_000\)/);
});

test("owner UI no longer rebuilds all episode cards every five seconds", () => {
  const owner = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
  assert.match(owner, /setInterval\(\(\) => scheduleRender\(0\), 15_000\)/);
  assert.match(owner, /activeExtremes \?\? 0/);
});
''', encoding="utf-8")

Path("scripts/apply-signal-lab-extreme-runtime-hotfix.py").unlink()
Path(".github/workflows/zz-signal-lab-extreme-runtime-hotfix.yml").unlink()
