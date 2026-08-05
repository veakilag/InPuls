from pathlib import Path


def replace_once(path, old, new):
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"missing pattern in {path}: {old[:180]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1. Extreme warmup and trade ingestion must not serialize the whole map after every candle/tick.
replace_once(
    "signal-lab-v4-extremes.js",
    '''      this.ingestCandle(row, { dataQuality });
    }
    return this.snapshot();
  }

  ingestCandle(raw, { dataQuality = this.dataQuality, availableAt = null } = {}) {
    const candle = normalizeCandle(raw, this.intervalMs);
    if (!candle?.closed) return this.snapshot();
    if (this.lastCandleTime !== null && candle.time <= this.lastCandleTime) return this.snapshot();''',
    '''      this.ingestCandle(row, { dataQuality, emitSnapshot: false });
    }
    return this.snapshot();
  }

  ingestCandle(raw, {
    dataQuality = this.dataQuality,
    availableAt = null,
    emitSnapshot = true,
  } = {}) {
    const candle = normalizeCandle(raw, this.intervalMs);
    if (!candle?.closed) return emitSnapshot ? this.snapshot() : null;
    if (this.lastCandleTime !== null && candle.time <= this.lastCandleTime) return emitSnapshot ? this.snapshot() : null;''',
)
replace_once(
    "signal-lab-v4-extremes.js",
    '''    this.#observeActiveRange(candle.low, candle.high, knownAt, this.barIndex);
    this.#advanceCandidates(candle, knownAt);
    return this.snapshot();
  }

  ingestTrade(price, at = Date.now(), { dataQuality = this.dataQuality } = {}) {
    const value = finite(price);
    const timestamp = finite(at);
    if (value === null || value <= 0 || timestamp === null) return this.snapshot();''',
    '''    this.#observeActiveRange(candle.low, candle.high, knownAt, this.barIndex);
    this.#advanceCandidates(candle, knownAt);
    return emitSnapshot ? this.snapshot() : null;
  }

  ingestTrade(price, at = Date.now(), {
    dataQuality = this.dataQuality,
    emitSnapshot = true,
  } = {}) {
    const value = finite(price);
    const timestamp = finite(at);
    if (value === null || value <= 0 || timestamp === null) return emitSnapshot ? this.snapshot() : null;''',
)
replace_once(
    "signal-lab-v4-extremes.js",
    '''    }
    return this.snapshot();
  }

  #advanceCandidates(candle, knownAt) {''',
    '''    }
    return emitSnapshot ? this.snapshot() : null;
  }

  #advanceCandidates(candle, knownAt) {''',
)
replace_once(
    "signal-lab-v4-extremes.js",
    '''  ingestTrade(symbol, price, at, options = {}) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return null;
    for (const timeframe of SIGNAL_LAB_V4_TIMEFRAMES) {
      this.engine(normalized, timeframe)?.ingestTrade(price, at, options);
    }
    return this.snapshot(normalized);
  }''',
    '''  ingestTrade(symbol, price, at, options = {}) {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return null;
    const emitSnapshot = options.emitSnapshot !== false;
    for (const timeframe of SIGNAL_LAB_V4_TIMEFRAMES) {
      this.engine(normalized, timeframe)?.ingestTrade(price, at, {
        ...options,
        emitSnapshot: false,
      });
    }
    return emitSnapshot ? this.snapshot(normalized) : null;
  }''',
)

# 2. Collector: throttle UI status, structure calculations and market checks.
replace_once(
    "signal-lab-v3-collector.js",
    'const CONNECTION_TIMEOUT_MS = 10_000;\n',
    '''const CONNECTION_TIMEOUT_MS = 10_000;
const STATUS_NOTIFY_INTERVAL_MS = 350;
const CHECK_INTERVAL_MS = 1_000;
const STRUCTURE_TRADE_INTERVAL_MS = 200;
''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''    this.lastSubscriptionRefreshAt = 0;
    this.statusState = {''',
    '''    this.lastSubscriptionRefreshAt = 0;
    this.lastCheckAt = 0;
    this.checkTimer = null;
    this.pendingCheckAt = null;
    this.structureTradeAt = new Map();
    this.statusNotifyTimer = null;
    this.lastStatusNotifiedAt = 0;
    this.statusState = {''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''    clearTimeout(this.bookConnectionTimer);
    this.socket?.close();''',
    '''    clearTimeout(this.bookConnectionTimer);
    clearTimeout(this.checkTimer);
    clearTimeout(this.statusNotifyTimer);
    this.checkTimer = null;
    this.statusNotifyTimer = null;
    this.pendingCheckAt = null;
    this.socket?.close();''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '      if (hasMiniTicker) this.#check(Date.now());\n',
    '      if (hasMiniTicker) this.#scheduleCheck(Date.now());\n',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''      const tickSize = this.tickSizes.get(data.s) ?? null;
      this.#symbol(data.s)?.updateTrade(data);
      if (tickSize) {
        const levelMap = this.levels.ingestPrice(data.s, finite(data.p), eventAt, {
          tickSize,
          dataQuality,
          source: "AGG_TRADE",
        });
        this.cascades.sync(data.s, levelMap, {
          currentPrice: finite(data.p),
          at: eventAt,
          dataQuality,
        });
      }
      this.extremes.ingestTrade(data.s, finite(data.p), eventAt, { dataQuality });
      this.orderFlow.ingestTrade(data, receivedAt);''',
    '''      const tickSize = this.tickSizes.get(data.s) ?? null;
      this.#symbol(data.s)?.updateTrade(data);
      this.orderFlow.ingestTrade(data, receivedAt);
      const previousStructureAt = this.structureTradeAt.get(data.s) ?? 0;
      if (receivedAt - previousStructureAt < STRUCTURE_TRADE_INTERVAL_MS) return;
      this.structureTradeAt.set(data.s, receivedAt);
      if (tickSize) {
        const levelMap = this.levels.ingestPrice(data.s, finite(data.p), eventAt, {
          tickSize,
          dataQuality,
          source: "AGG_TRADE",
        });
        this.cascades.sync(data.s, levelMap, {
          currentPrice: finite(data.p),
          at: eventAt,
          dataQuality,
        });
      }
      this.extremes.ingestTrade(data.s, finite(data.p), eventAt, {
        dataQuality,
        emitSnapshot: false,
      });''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''        const tickSize = this.tickSizes.get(metrics.symbol) ?? null;
        const dataQuality = now - (finite(metrics.updatedAt) ?? 0) <= 5_000 ? "LIVE" : "STALE";
        const closedMinuteCandles = Array.isArray(metrics.minuteCandles)
          ? metrics.minuteCandles.slice(0, -1)
          : [];
        if (tickSize && closedMinuteCandles.length) {
          this.extremes.hydrate(metrics.symbol, "1m", closedMinuteCandles, {
            tickSize,
            dataQuality,
          });
        }
        const extremeMap = this.extremes.snapshot(metrics.symbol);
        const atr1m = atrFromClosedCandles(closedMinuteCandles);
        if (tickSize && closedMinuteCandles.length) {
          this.levels.ingestCandle(metrics.symbol, closedMinuteCandles.at(-1), {
            tickSize,
            atr: atr1m,
            dataQuality,
          });
        }
        const levelMap = tickSize
          ? this.levels.sync(metrics.symbol, extremeMap, {
            tickSize,
            atr: atr1m,
            currentPrice: metrics.price,
            at: now,
            dataQuality,
          })
          : null;
        if (levelMap && closedMinuteCandles.length) {
          this.cascades.ingestCandle(metrics.symbol, closedMinuteCandles.at(-1), {
            atr: atr1m,
            dataQuality,
          });
        }
        const cascadeMap = levelMap
          ? this.cascades.sync(metrics.symbol, levelMap, {
            currentPrice: metrics.price,
            at: now,
            atr: atr1m,
            dataQuality,
          })
          : null;''',
    '''        const tickSize = this.tickSizes.get(metrics.symbol) ?? null;
        const dataQuality = now - (finite(metrics.updatedAt) ?? 0) <= 5_000 ? "LIVE" : "STALE";
        const closedMinuteCandles = Array.isArray(metrics.minuteCandles)
          ? metrics.minuteCandles.slice(0, -1)
          : [];
        const structureReady = Boolean(
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
        }
        const levelMap = structureReady
          ? this.levels.sync(metrics.symbol, extremeMap, {
            tickSize,
            atr: atr1m,
            currentPrice: metrics.price,
            at: now,
            dataQuality,
          })
          : null;
        if (levelMap && closedMinuteCandles.length) {
          this.cascades.ingestCandle(metrics.symbol, closedMinuteCandles.at(-1), {
            atr: atr1m,
            dataQuality,
          });
        }
        const cascadeMap = levelMap
          ? this.cascades.sync(metrics.symbol, levelMap, {
            currentPrice: metrics.price,
            at: now,
            atr: atr1m,
            dataQuality,
          })
          : null;''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''  #check(now) {
    const metrics = this.#metrics(now);''',
    '''  #scheduleCheck(now) {
    const elapsed = now - this.lastCheckAt;
    if (elapsed >= CHECK_INTERVAL_MS && !this.checkTimer) {
      this.lastCheckAt = now;
      this.#check(now);
      return;
    }
    this.pendingCheckAt = now;
    if (this.checkTimer) return;
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      const scheduledAt = this.pendingCheckAt ?? Date.now();
      this.pendingCheckAt = null;
      this.lastCheckAt = scheduledAt;
      this.#check(scheduledAt);
    }, Math.max(0, CHECK_INTERVAL_MS - elapsed));
  }

  #check(now) {
    const metrics = this.#metrics(now);''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''  #publish(patch = {}) {
    Object.assign(this.statusState, patch);
    try {
      this.onStatus(Object.freeze({ ...this.statusState }));
    } catch {
      // UI callbacks must not interrupt the collector.
    }
  }''',
    '''  #publish(patch = {}) {
    Object.assign(this.statusState, patch);
    const now = Date.now();
    const urgent = Object.prototype.hasOwnProperty.call(patch, "connection")
      || (Object.prototype.hasOwnProperty.call(patch, "lastError") && patch.lastError);
    const notify = () => {
      clearTimeout(this.statusNotifyTimer);
      this.statusNotifyTimer = null;
      this.lastStatusNotifiedAt = Date.now();
      try {
        this.onStatus(Object.freeze({ ...this.statusState }));
      } catch {
        // UI callbacks must not interrupt the collector.
      }
    };
    if (urgent || now - this.lastStatusNotifiedAt >= STATUS_NOTIFY_INTERVAL_MS) {
      notify();
      return;
    }
    if (this.statusNotifyTimer) return;
    this.statusNotifyTimer = setTimeout(
      notify,
      STATUS_NOTIFY_INTERVAL_MS - (now - this.lastStatusNotifiedAt),
    );
  }''',
)

# 3. UI: render a small collapsed window and mount heavy widgets only for visible cards.
replace_once(
    "owner-signal-lab-v3.js",
    '    limit: 1_000,\n',
    '    limit: 250,\n',
)
replace_once(
    "owner-signal-lab-v3.js",
    'function scheduleRender(delay = 180) {\n',
    'function scheduleRender(delay = 900) {\n',
)
replace_once(
    "owner-signal-lab-v3.js",
    '''    const visible = merged.slice(0, 60);
    const cards = visible.map(renderCard);''',
    '''    const visible = merged.slice(0, 12);
    const cards = visible.map(renderCard);''',
)
replace_once(
    "owner-signal-lab-v3.js",
    '        mountEpisodeFullChart(card, visible[index], { autoOpen: index === 0 });\n',
    '        mountEpisodeFullChart(card, visible[index], { autoOpen: false });\n',
)
replace_once(
    "owner-signal-lab-v3.js",
    '    scheduleRender(created.length || expired.length ? 0 : 450);\n',
    '    scheduleRender(created.length || expired.length ? 250 : 1_200);\n',
)

Path("test/signal-lab-v4-performance-hotfix.test.js").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const collector = fs.readFileSync(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
const extremes = fs.readFileSync(new URL("../signal-lab-v4-extremes.js", import.meta.url), "utf8");
const owner = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");

test("extreme warmup and trades avoid repeated full snapshots", () => {
  assert.match(extremes, /emitSnapshot: false/);
  assert.match(extremes, /return emitSnapshot \? this\.snapshot\(\) : null/);
  assert.match(extremes, /return emitSnapshot \? this\.snapshot\(normalized\) : null/);
});

test("collector throttles status, checks and structure trade processing", () => {
  assert.match(collector, /STATUS_NOTIFY_INTERVAL_MS = 350/);
  assert.match(collector, /CHECK_INTERVAL_MS = 1_000/);
  assert.match(collector, /STRUCTURE_TRADE_INTERVAL_MS = 200/);
  assert.match(collector, /#scheduleCheck\(now\)/);
  assert.match(collector, /structureReady/);
  assert.match(collector, /emitSnapshot: false/);
});

test("owner UI renders a bounded collapsed card window", () => {
  assert.match(owner, /limit: 250/);
  assert.match(owner, /merged\.slice\(0, 12\)/);
  assert.match(owner, /autoOpen: false/);
  assert.doesNotMatch(owner, /merged\.slice\(0, 60\)/);
});
''', encoding="utf-8")
