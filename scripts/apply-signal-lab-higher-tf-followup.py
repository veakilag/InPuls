from pathlib import Path


def replace_exact(path, old, new, expected=1):
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old[:160]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


# Keep enough minute candles only for warmed Signal Lab symbols, while the public metrics
# payload remains capped at the existing 100 candles.
replace_exact(
    "engine.js",
    "    this.minuteCandles = [];\n    this.fundingRate = null;",
    "    this.minuteCandles = [];\n    this.minuteCandleLimit = 100;\n    this.fundingRate = null;",
)
replace_exact(
    "engine.js",
    "      this.minuteCandles = this.minuteCandles.slice(-100);",
    "      this.minuteCandles = this.minuteCandles.slice(-this.minuteCandleLimit);",
)
replace_exact(
    "engine.js",
    "  hydrateMinuteCandles(candles) {\n    if (!Array.isArray(candles)) return;\n    const byTime = new Map(this.minuteCandles.map((candle) => [candle.time, candle]));",
    "  hydrateMinuteCandles(candles) {\n    if (!Array.isArray(candles)) return;\n    this.minuteCandleLimit = Math.max(100, Math.min(1_500, candles.length || 0));\n    const byTime = new Map(this.minuteCandles.map((candle) => [candle.time, candle]));",
)
replace_exact(
    "engine.js",
    "    this.minuteCandles = [...byTime.values()].sort((left, right) => left.time - right.time).slice(-100);",
    "    this.minuteCandles = [...byTime.values()]\n      .sort((left, right) => left.time - right.time)\n      .slice(-this.minuteCandleLimit);",
)

# Make live snapshots and active-level scoring proportional to active levels, not all history.
replace_exact(
    "signal-lab-v4-extremes.js",
    "  ingestCandles(rows, { dataQuality = this.dataQuality } = {}) {",
    "  ingestCandles(rows, { dataQuality = this.dataQuality, emitSnapshot = true } = {}) {",
)
replace_exact(
    "signal-lab-v4-extremes.js",
    "    return this.snapshot();\n  }\n\n  ingestCandle(raw, {",
    "    return emitSnapshot ? this.snapshot() : null;\n  }\n\n  ingestCandle(raw, {",
)
replace_exact(
    "signal-lab-v4-extremes.js",
    "  activeExtremes(side = null) {\n    return this.extremes\n      .filter((row) => row.active && (!side || row.side === side))\n      .map(extremePublic);\n  }",
    "  activeExtremes(side = null) {\n    return [...this.activeExtremeIds]\n      .map((id) => this.extremeById.get(id))\n      .filter((row) => row?.active && (!side || row.side === side))\n      .map(extremePublic);\n  }",
)

collector = "signal-lab-v3-collector.js"
replace_exact(
    collector,
    "const EXTREME_WARMUP = Object.freeze({\n  \"1m\": 1_500,\n  \"5m\": 1_500,\n  \"15m\": 1_500,\n  \"1h\": 900,\n  \"4h\": 720,\n  \"1d\": 365,\n});",
    "const EXTREME_WARMUP = Object.freeze({\n  \"1m\": 1_500,\n  \"5m\": 1_500,\n  \"15m\": 1_500,\n  \"1h\": 900,\n  \"4h\": 720,\n  \"1d\": 365,\n});\nconst TIMEFRAME_MINUTES = Object.freeze({\n  \"1m\": 1,\n  \"5m\": 5,\n  \"15m\": 15,\n  \"1h\": 60,\n  \"4h\": 240,\n  \"1d\": 1_440,\n});",
)
normalize_block = '''function normalizeKline(row) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const candle = {
    time: finite(row[0]),
    open: finite(row[1]),
    high: finite(row[2]),
    low: finite(row[3]),
    close: finite(row[4]),
    volume: Math.max(0, finite(row[5]) ?? 0),
    closeTime: finite(row[6]),
    closed: finite(row[6]) === null ? true : finite(row[6]) < Date.now(),
  };
  return [candle.time, candle.open, candle.high, candle.low, candle.close]
    .every((value) => value !== null && value > 0)
    ? candle
    : null;
}
'''
helper_block = normalize_block + '''
export function latestCompleteTimeframeCandle(minuteCandles, timeframe, now = Date.now()) {
  const size = TIMEFRAME_MINUTES[timeframe];
  if (!size || !Array.isArray(minuteCandles)) return null;
  const minuteMs = 60_000;
  const intervalMs = size * minuteMs;
  const byTime = new Map();
  for (const raw of minuteCandles) {
    const time = finite(raw?.time);
    const open = finite(raw?.open);
    const high = finite(raw?.high);
    const low = finite(raw?.low);
    const close = finite(raw?.close);
    if (![time, open, high, low, close].every((value) => value !== null) || time + minuteMs > now) continue;
    byTime.set(time, {
      time,
      open,
      high,
      low,
      close,
      volume: Math.max(0, finite(raw?.volume) ?? 0),
    });
  }
  if (!byTime.size) return null;
  const latestMinuteTime = Math.max(...byTime.keys());
  let bucketStart = Math.floor(latestMinuteTime / intervalMs) * intervalMs;
  if (latestMinuteTime < bucketStart + intervalMs - minuteMs) bucketStart -= intervalMs;
  if (bucketStart < 0) return null;
  const rows = [];
  for (let index = 0; index < size; index += 1) {
    const candle = byTime.get(bucketStart + index * minuteMs);
    if (!candle) return null;
    rows.push(candle);
  }
  return Object.freeze({
    time: bucketStart,
    open: rows[0].open,
    high: Math.max(...rows.map((row) => row.high)),
    low: Math.min(...rows.map((row) => row.low)),
    close: rows.at(-1).close,
    volume: rows.reduce((sum, row) => sum + row.volume, 0),
    closeTime: bucketStart + intervalMs - 1,
    closed: true,
  });
}
'''
replace_exact(collector, normalize_block, helper_block)
replace_exact(
    collector,
    "    this.lastClosedMinuteAt = new Map();",
    "    this.lastClosedCandleAt = new Map();",
)
old_metrics = '''        const latestClosedMinute = closedMinuteCandles.at(-1) ?? null;
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
new_metrics = '''        const completedCandles = structureReady
          ? SIGNAL_LAB_V4_TIMEFRAMES
            .map((timeframe) => [
              timeframe,
              latestCompleteTimeframeCandle(state.minuteCandles, timeframe, now),
            ])
            .filter(([, candle]) => candle)
          : [];
        let latestClosedMinute = null;
        let hasNewClosedMinute = false;
        for (const [timeframe, candle] of completedCandles) {
          const key = `${metrics.symbol}:${timeframe}`;
          const previousTime = this.lastClosedCandleAt.get(key) ?? null;
          if (previousTime !== null && candle.time <= previousTime) {
            if (timeframe === "1m") latestClosedMinute = candle;
            continue;
          }
          this.extremes.hydrate(metrics.symbol, timeframe, [candle], {
            tickSize,
            dataQuality,
            emitSnapshot: false,
          });
          this.lastClosedCandleAt.set(key, candle.time);
          if (timeframe === "1m") {
            latestClosedMinute = candle;
            hasNewClosedMinute = true;
          }
        }
        const extremeMap = structureReady
          ? this.extremes.snapshot(metrics.symbol, { includeHistory: false, includeEvents: false })
          : null;
        const atr1m = structureReady ? atrFromClosedCandles(closedMinuteCandles) : null;
        if (hasNewClosedMinute && latestClosedMinute) {
          this.levels.ingestCandle(metrics.symbol, latestClosedMinute, {
            tickSize,
            atr: atr1m,
            dataQuality,
          });
        }'''
replace_exact(collector, old_metrics, new_metrics)
replace_exact(
    collector,
    "        if (levelMap && closedMinuteCandles.length) {\n          this.cascades.ingestCandle(metrics.symbol, closedMinuteCandles.at(-1), {",
    "        if (levelMap && hasNewClosedMinute && latestClosedMinute) {\n          this.cascades.ingestCandle(metrics.symbol, latestClosedMinute, {",
)
replace_exact(
    collector,
    "        this.extremes.hydrate(symbol, timeframe, candles, {\n          tickSize,\n          dataQuality: \"RECOVERED\",\n        });\n        if (timeframe === \"1m\") this.#symbol(symbol)?.hydrateMinuteCandles(candles);",
    "        this.extremes.hydrate(symbol, timeframe, candles, {\n          tickSize,\n          dataQuality: \"RECOVERED\",\n          emitSnapshot: false,\n        });\n        const lastClosed = [...candles].reverse().find((candle) => candle.closed);\n        if (lastClosed) this.lastClosedCandleAt.set(`${symbol}:${timeframe}`, lastClosed.time);\n        if (timeframe === \"1m\") this.#symbol(symbol)?.hydrateMinuteCandles(candles);",
)

hotfix_test = Path("test/signal-lab-v6-extreme-runtime-hotfix.test.js")
test_text = hotfix_test.read_text(encoding="utf-8")
replace_import = 'import fs from "node:fs";\n'
if test_text.count(replace_import) != 1:
    raise SystemExit("unexpected hotfix test import")
test_text = test_text.replace(
    replace_import,
    replace_import + 'import { latestCompleteTimeframeCandle } from "../signal-lab-v3-collector.js";\n',
)
test_text += r'''

test("minute history produces only fully closed higher-timeframe candles", () => {
  const rows = Array.from({ length: 65 }, (_, index) => ({
    time: index * minute,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 1,
  }));
  const five = latestCompleteTimeframeCandle(rows, "5m", 65 * minute);
  assert.equal(five.time, 60 * minute);
  assert.equal(five.open, 160);
  assert.equal(five.close, 164.5);
  assert.equal(five.volume, 5);
  const hour = latestCompleteTimeframeCandle(rows, "1h", 65 * minute);
  assert.equal(hour.time, 0);
  assert.equal(hour.open, 100);
  assert.equal(hour.close, 159.5);
});

test("incomplete current bucket falls back to the previous complete bucket", () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    time: index * minute,
    open: 10 + index,
    high: 11 + index,
    low: 9 + index,
    close: 10.5 + index,
  }));
  const candle5m = latestCompleteTimeframeCandle(rows, "5m", 7 * minute);
  assert.equal(candle5m.time, 0);
  assert.equal(candle5m.close, 14.5);
});

test("warmed symbols retain enough minute history for a complete 1d candle", () => {
  const rows = Array.from({ length: 1_440 }, (_, index) => ({
    time: index * minute,
    open: 20,
    high: 21,
    low: 19,
    close: 20,
  }));
  const daily = latestCompleteTimeframeCandle(rows, "1d", 1_440 * minute);
  assert.equal(daily.time, 0);
  assert.equal(daily.closeTime, 1_440 * minute - 1);
});
'''
hotfix_test.write_text(test_text, encoding="utf-8")

Path("scripts/apply-signal-lab-higher-tf-followup.py").unlink()
Path(".github/workflows/zz-signal-lab-higher-tf-followup.yml").unlink()
