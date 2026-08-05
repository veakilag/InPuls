from pathlib import Path


def replace_exact(path, old, new, expected=1):
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old[:180]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


collector = "signal-lab-v3-collector.js"
replace_exact(
    collector,
    "    this.lastClosedCandleAt = new Map();\n    this.lastSubscriptionRefreshAt = 0;",
    "    this.lastClosedCandleAt = new Map();\n    this.lastTimeframeAggregationAt = new Map();\n    this.lastSubscriptionRefreshAt = 0;",
)
old = '''        const completedCandles = structureReady
          ? SIGNAL_LAB_V4_TIMEFRAMES
            .map((timeframe) => [
              timeframe,
              latestCompleteTimeframeCandle(state.minuteCandles, timeframe, now),
            ])
            .filter(([, candle]) => candle)
          : [];
        let latestClosedMinute = null;
        let hasNewClosedMinute = false;
        for (const [timeframe, candle] of completedCandles) {'''
new = '''        const latestClosedSourceMinute = structureReady
          ? [...state.minuteCandles].reverse().find((candle) => (
            finite(candle?.time) !== null && candle.time + 60_000 <= now
          )) ?? null
          : null;
        const previousAggregationAt = this.lastTimeframeAggregationAt.get(metrics.symbol) ?? null;
        const hasNewSourceMinute = Boolean(
          latestClosedSourceMinute
          && (previousAggregationAt === null || latestClosedSourceMinute.time > previousAggregationAt)
        );
        const completedCandles = hasNewSourceMinute
          ? SIGNAL_LAB_V4_TIMEFRAMES
            .map((timeframe) => [
              timeframe,
              latestCompleteTimeframeCandle(state.minuteCandles, timeframe, now),
            ])
            .filter(([, candle]) => candle)
          : [];
        let latestClosedMinute = null;
        let hasNewClosedMinute = false;
        for (const [timeframe, candle] of completedCandles) {'''
replace_exact(collector, old, new)
replace_exact(
    collector,
    "        const extremeMap = structureReady\n          ? this.extremes.snapshot(metrics.symbol, { includeHistory: false, includeEvents: false })",
    "        if (hasNewSourceMinute) {\n          this.lastTimeframeAggregationAt.set(metrics.symbol, latestClosedSourceMinute.time);\n        }\n        const extremeMap = structureReady\n          ? this.extremes.snapshot(metrics.symbol, { includeHistory: false, includeEvents: false })",
)
replace_exact(
    collector,
    "        if (timeframe === \"1m\") this.#symbol(symbol)?.hydrateMinuteCandles(candles);",
    "        if (timeframe === \"1m\") {\n          this.#symbol(symbol)?.hydrateMinuteCandles(candles);\n          if (lastClosed) this.lastTimeframeAggregationAt.set(symbol, lastClosed.time);\n        }",
)

test_path = Path("test/signal-lab-v6-extreme-runtime-hotfix.test.js")
text = test_path.read_text(encoding="utf-8")
marker = '''  assert.match(collector, /latestCompleteTimeframeCandle\\(state\\.minuteCandles, timeframe, now\\)/);
  assert.match(collector, /hydrate\\(metrics\\.symbol, timeframe, \\[candle\\]/);'''
replacement = marker + '''
  assert.match(collector, /hasNewSourceMinute/);
  assert.match(collector, /lastTimeframeAggregationAt\\.set\\(metrics\\.symbol/);'''
if text.count(marker) != 1:
    raise SystemExit("unexpected all-timeframe assertion block")
test_path.write_text(text.replace(marker, replacement), encoding="utf-8")

Path("scripts/apply-signal-lab-aggregation-gate.py").unlink()
Path(".github/workflows/zz-signal-lab-aggregation-gate.yml").unlink()
