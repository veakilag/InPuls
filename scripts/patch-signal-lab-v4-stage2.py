from pathlib import Path


def replace_once(path, old, new):
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"missing pattern in {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "signal-lab-v4-levels-breakouts.js",
    '    this.barIndex = -1;\n    this.dataQuality = "LIVE";',
    '    this.barIndex = -1;\n    this.lastCandleAt = null;\n    this.dataQuality = "LIVE";',
)
replace_once(
    "signal-lab-v4-levels-breakouts.js",
    '    if (![high, low, close, time].every((value) => value !== null) || !(high > 0) || !(low > 0) || !(close > 0)) {\n      return this.snapshot();\n    }\n    this.barIndex += 1;',
    '    if (![high, low, close, time].every((value) => value !== null) || !(high > 0) || !(low > 0) || !(close > 0)) {\n      return this.snapshot();\n    }\n    if (this.lastCandleAt !== null && time <= this.lastCandleAt) return this.snapshot();\n    this.lastCandleAt = time;\n    this.barIndex += 1;',
)

replace_once(
    "signal-lab-v3-collector.js",
    'import { SignalLabV3EvidenceRecorder } from "./signal-lab-v3-evidence.js?v=signal-lab-v4-stage1";\nimport {\n  SIGNAL_LAB_V4_TIMEFRAMES,\n  SignalLabV4ExtremeRegistry,\n} from "./signal-lab-v4-extremes.js?v=signal-lab-v4-stage1";\nimport { SignalLabV4OrderFlowRecorder } from "./signal-lab-v4-orderflow-recorder.js?v=signal-lab-v4-stage1";',
    'import { SignalLabV3EvidenceRecorder } from "./signal-lab-v3-evidence.js?v=signal-lab-v4-stage2";\nimport {\n  SIGNAL_LAB_V4_TIMEFRAMES,\n  SignalLabV4ExtremeRegistry,\n  atrFromClosedCandles,\n} from "./signal-lab-v4-extremes.js?v=signal-lab-v4-stage1";\nimport { SignalLabV4LevelBreakoutRegistry } from "./signal-lab-v4-levels-breakouts.js?v=signal-lab-v4-stage2";\nimport { SignalLabV4OrderFlowRecorder } from "./signal-lab-v4-orderflow-recorder.js?v=signal-lab-v4-stage1";',
)
replace_once(
    "signal-lab-v3-collector.js",
    '    this.extremes = new SignalLabV4ExtremeRegistry();\n    this.tickSizes = new Map();',
    '    this.extremes = new SignalLabV4ExtremeRegistry();\n    this.levels = new SignalLabV4LevelBreakoutRegistry();\n    this.tickSizes = new Map();',
)
replace_once(
    "signal-lab-v3-collector.js",
    '      extremeMaps: 0,\n      tickSizes: 0,',
    '      extremeMaps: 0,\n      levelMaps: 0,\n      breakoutEvents: 0,\n      tickSizes: 0,',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data)) {
      const receivedAt = Date.now();
      this.#symbol(data.s)?.updateTrade(data);
      this.extremes.ingestTrade(data.s, finite(data.p), finite(data.T) ?? finite(data.E) ?? receivedAt, {
        dataQuality: receivedAt - (finite(data.E) ?? receivedAt) <= 5_000 ? "LIVE" : "STALE",
      });
      this.orderFlow.ingestTrade(data, receivedAt);
      return;
    }''',
    '''    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data)) {
      const receivedAt = Date.now();
      const eventAt = finite(data.T) ?? finite(data.E) ?? receivedAt;
      const dataQuality = receivedAt - (finite(data.E) ?? receivedAt) <= 5_000 ? "LIVE" : "STALE";
      const tickSize = this.tickSizes.get(data.s) ?? null;
      this.#symbol(data.s)?.updateTrade(data);
      if (tickSize) {
        this.levels.ingestPrice(data.s, finite(data.p), eventAt, {
          tickSize,
          dataQuality,
          source: "AGG_TRADE",
        });
      }
      this.extremes.ingestTrade(data.s, finite(data.p), eventAt, { dataQuality });
      this.orderFlow.ingestTrade(data, receivedAt);
      return;
    }''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''        const tickSize = this.tickSizes.get(metrics.symbol) ?? null;
        if (tickSize && Array.isArray(metrics.minuteCandles) && metrics.minuteCandles.length > 1) {
          this.extremes.hydrate(metrics.symbol, "1m", metrics.minuteCandles.slice(0, -1), {
            tickSize,
            dataQuality: now - (finite(metrics.updatedAt) ?? 0) <= 5_000 ? "LIVE" : "STALE",
          });
        }
        return {
          ...metrics,
          tickSize,
          extremeMap: this.extremes.snapshot(metrics.symbol),
          bookCandidate: this.bookTracker.candidateFor(metrics.symbol, now),
        };''',
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
        return {
          ...metrics,
          tickSize,
          extremeMap,
          levelMap,
          bookCandidate: this.bookTracker.candidateFor(metrics.symbol, now),
        };''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '      extremeMaps: metrics.filter((row) => row.extremeMap && Object.keys(row.extremeMap.timeframes ?? {}).length).length,\n      tickSizes: this.tickSizes.size,',
    '      extremeMaps: metrics.filter((row) => row.extremeMap && Object.keys(row.extremeMap.timeframes ?? {}).length).length,\n      levelMaps: metrics.filter((row) => (row.levelMap?.activeZones?.length ?? 0) > 0).length,\n      breakoutEvents: metrics.reduce((sum, row) => sum + (row.levelMap?.activeEvents?.length ?? 0), 0),\n      tickSizes: this.tickSizes.size,',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''    const setupRanked = [...ranked].sort((left, right) => (
      this.extremes.watchScore(right.symbol, right.price)
      - this.extremes.watchScore(left.symbol, left.price)
      || candidateWatchScore(right, this.settings) - candidateWatchScore(left, this.settings)
    ));''',
    '''    const setupRanked = [...ranked].sort((left, right) => (
      this.levels.watchScore(right.symbol, right.price)
      - this.levels.watchScore(left.symbol, left.price)
      || this.extremes.watchScore(right.symbol, right.price)
      - this.extremes.watchScore(left.symbol, left.price)
      || candidateWatchScore(right, this.settings) - candidateWatchScore(left, this.settings)
    ));''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '        this.tickSizes.set(symbol, tickSize);\n        this.extremes.setTickSize(symbol, tickSize);',
    '        this.tickSizes.set(symbol, tickSize);\n        this.extremes.setTickSize(symbol, tickSize);\n        this.levels.setTickSize(symbol, tickSize);',
)

replace_once(
    "signal-lab-v3-evidence.js",
    'export const SIGNAL_LAB_V3_EVIDENCE_VERSION = "signal-lab-v4-extremes-orderflow-stage1-2026-08";',
    'export const SIGNAL_LAB_V3_EVIDENCE_VERSION = "signal-lab-v4-levels-breakouts-stage2-2026-08";',
)
replace_once(
    "signal-lab-v3-evidence.js",
    '      extremeMap: metrics?.extremeMap ? clone(metrics.extremeMap) : null,\n      extremeMapLatest: metrics?.extremeMap ? clone(metrics.extremeMap) : null,',
    '      extremeMap: metrics?.extremeMap ? clone(metrics.extremeMap) : null,\n      extremeMapLatest: metrics?.extremeMap ? clone(metrics.extremeMap) : null,\n      levelMap: metrics?.levelMap ? clone(metrics.levelMap) : null,\n      levelMapLatest: metrics?.levelMap ? clone(metrics.levelMap) : null,',
)
replace_once(
    "signal-lab-v3-evidence.js",
    '    if (metrics?.extremeMap) pack.extremeMapLatest = clone(metrics.extremeMap);',
    '    if (metrics?.extremeMap) pack.extremeMapLatest = clone(metrics.extremeMap);\n    if (metrics?.levelMap) pack.levelMapLatest = clone(metrics.levelMap);',
)
replace_once(
    "signal-lab-v3-evidence.js",
    '      depthDiffs: pack.orderFlowReplay?.events?.length ?? 0,\n    };',
    '      depthDiffs: pack.orderFlowReplay?.events?.length ?? 0,\n      activeLevelZones: pack.levelMapLatest?.activeZones?.length ?? 0,\n      activeBreakoutEvents: pack.levelMapLatest?.activeEvents?.length ?? 0,\n    };',
)

level_annotation = r'''
function addLevelMapAnnotations(target, levelMap, eventAt, eventPrice) {
  const zones = (Array.isArray(levelMap?.activeZones) ? levelMap.activeZones : [])
    .map((zone) => {
      const lower = finite(zone?.lowerPrice);
      const upper = finite(zone?.upperPrice);
      const boundary = zone?.side === "HIGH" ? upper : lower;
      const distance = eventPrice > 0 && boundary > 0 ? Math.abs(boundary - eventPrice) / eventPrice * 100 : 0;
      return { ...zone, lower, upper, boundary, distance };
    })
    .filter((zone) => zone.lower > 0 && zone.upper > 0 && zone.distance <= 8)
    .sort((left, right) => left.distance - right.distance);
  for (const zone of zones.slice(0, 20)) {
    const high = zone.side === "HIGH";
    const timeframes = (Array.isArray(zone.timeframes) ? zone.timeframes : []).join("/");
    const compression = zone?.setupFeatures?.compressionType;
    const label = `${high ? "H" : "L"} зона ×${zone.touchCount ?? 1}${timeframes ? ` · ${timeframes}` : ""}`;
    target.push({
      type: "zone",
      startAt: finite(zone.firstFormedAt) ?? eventAt - 60_000,
      endAt: eventAt + 60_000,
      low: zone.lower,
      high: zone.upper,
      label: compression && compression !== "NO_COMPRESSION" ? `${label} · ${compression}` : label,
      tone: high ? "danger" : "success",
    });
  }
  for (const event of Array.isArray(levelMap?.eventHistory) ? levelMap.eventHistory.slice(-20) : []) {
    const triggeredAt = finite(event?.triggeredAt);
    if (triggeredAt === null) continue;
    target.push({
      type: "event",
      time: triggeredAt,
      label: `ПРОХОД ${event.direction === "UP" ? "ВВЕРХ" : "ВНИЗ"}`,
      tone: "warning",
    });
    if (finite(event?.acceptedAt) !== null) {
      target.push({ type: "event", time: event.acceptedAt, label: "ПРИНЯТИЕ", tone: "success" });
    }
    if (finite(event?.reclaimedAt) !== null) {
      target.push({ type: "event", time: event.reclaimedAt, label: "ПРОКОЛ И ВОЗВРАТ", tone: "danger" });
    }
    if (finite(event?.retestedAt) !== null) {
      target.push({ type: "event", time: event.retestedAt, label: "РЕТЕСТ", tone: "blue" });
    }
  }
}
'''
replace_once(
    "signal-lab-v3-full-chart.js",
    '\nexport function buildPatternAnnotations(episode) {',
    level_annotation + '\nexport function buildPatternAnnotations(episode) {',
)
replace_once(
    "signal-lab-v3-full-chart.js",
    '  addExtremeMapAnnotations(annotations, pack?.extremeMap, eventAt, eventPrice);',
    '  addExtremeMapAnnotations(annotations, pack?.extremeMap, eventAt, eventPrice);\n  addLevelMapAnnotations(annotations, pack?.levelMapLatest ?? pack?.levelMap, eventAt, eventPrice);',
)

replace_once(
    "owner-signal-lab-v3.html",
    'owner-signal-lab-v3-evidence.css?v=signal-lab-v4-stage1',
    'owner-signal-lab-v3-evidence.css?v=signal-lab-v4-stage2',
)
replace_once(
    "owner-signal-lab-v3.html",
    'V4 параллельно строит неперерисовывающуюся карту high/low по каждому таймфрейму.\n          Пока карта не откалибрована, её разметка является исследовательской, а не подтверждённым каскадом.',
    'V4 параллельно строит неперерисовывающуюся карту high/low, объединяет близкие экстремумы в зоны ×N и отдельно фиксирует проход, принятие, ретест и прокол с возвратом.\n          Эти правила пока калибруются отдельно от каскада и не являются торговой командой.',
)
replace_once(
    "owner-signal-lab-v3.html",
    'owner-signal-lab-v3.js?v=signal-lab-v4-stage1',
    'owner-signal-lab-v3.js?v=signal-lab-v4-stage2',
)

Path("test/signal-lab-v4-levels-integration.test.js").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const collector = fs.readFileSync(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
const evidence = fs.readFileSync(new URL("../signal-lab-v3-evidence.js", import.meta.url), "utf8");
const fullChart = fs.readFileSync(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");

test("collector feeds level zones from extrema, closed candles and aggTrade", () => {
  assert.match(collector, /SignalLabV4LevelBreakoutRegistry/);
  assert.match(collector, /this\.levels\.ingestPrice/);
  assert.match(collector, /this\.levels\.ingestCandle/);
  assert.match(collector, /this\.levels\.sync/);
  assert.match(collector, /levelMap/);
});

test("evidence pack preserves initial and latest level maps", () => {
  assert.match(evidence, /levelMap:/);
  assert.match(evidence, /levelMapLatest:/);
  assert.match(evidence, /activeLevelZones/);
  assert.match(evidence, /activeBreakoutEvents/);
});

test("full chart explains zones, strict crossing, acceptance and reclaim", () => {
  assert.match(fullChart, /addLevelMapAnnotations/);
  assert.match(fullChart, /ПРОХОД/);
  assert.match(fullChart, /ПРИНЯТИЕ/);
  assert.match(fullChart, /ПРОКОЛ И ВОЗВРАТ/);
  assert.match(fullChart, /РЕТЕСТ/);
});

test("owner page describes calibrated levels before cascade", () => {
  assert.match(page, /зоны ×N/);
  assert.match(page, /проход, принятие, ретест/);
  assert.match(page, /signal-lab-v4-stage2/);
});
''', encoding="utf-8")

Path("docs/signal-lab-v4-levels-breakouts-stage2.md").write_text(r'''# Signal Lab V4 — Stage 2: Level zones and breakout lifecycle

## Purpose

Stage 2 consumes only confirmed active extrema from Stage 1. It does not replace the old cascade detector and does not infer stops as an observed fact.

## Deterministic rules

- close extrema merge only inside a configurable tolerance based on ticks, percentage and ATR;
- original extrema and timeframes are preserved inside every zone;
- `touchCount` counts independent attacks, not adjacent candles or trades;
- equality is a contact, not a break;
- a high zone is crossed only above its outer high boundary by at least one tick;
- a low zone is crossed only below its outer low boundary by at least one tick;
- `triggeredAt` and `acceptedAt` are separate;
- all acceptance checks are retained: close, time, distance, flow and hybrid;
- `GAP`, `STALE` and `ERROR` may record geometry but cannot produce full acceptance;
- quick return is stored as `SWEPT_RECLAIMED`;
- retest is possible only after acceptance;
- an event is updated rather than duplicated on every tick.

Formula: `signal-lab-v4-levels-breakouts-v1-2026-08`.

## Product state

The map is attached to Signal Lab evidence packs and rendered on the full chart. It is calibration evidence, not a production alert. Cascade state machine starts only after Stage 1 and Stage 2 are validated on user examples.
''', encoding="utf-8")
