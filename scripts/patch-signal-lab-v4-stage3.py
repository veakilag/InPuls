from pathlib import Path


def replace_once(path, old, new):
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"missing pattern in {path}: {old[:180]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Fix the duration check while the whole matching sequence is still being assembled.
replace_once(
    "signal-lab-v4-cascades.js",
    '''      const matched = [];
      let previousAt = event.setupDetectedAt;
      for (const levelId of event.levelIds) {
        const match = levelEvents.find((candidate) => (
          candidate.levelId === levelId
          && candidate.direction === event.direction
          && candidate.triggeredAt >= previousAt
          && candidate.triggeredAt - (event.triggeredAt ?? candidate.triggeredAt) <= event.maxCascadeDurationMs
        ));
        if (!match) break;
        matched.push(match);
        previousAt = match.triggeredAt;
      }''',
    '''      const matched = [];
      let previousAt = event.setupDetectedAt;
      let firstMatchedAt = event.triggeredAt;
      for (const levelId of event.levelIds) {
        const match = levelEvents.find((candidate) => (
          candidate.levelId === levelId
          && candidate.direction === event.direction
          && candidate.triggeredAt >= previousAt
          && (firstMatchedAt === null || candidate.triggeredAt - firstMatchedAt <= event.maxCascadeDurationMs)
        ));
        if (!match) break;
        matched.push(match);
        firstMatchedAt ??= match.triggeredAt;
        previousAt = match.triggeredAt;
      }''',
)

# New V4 candidate types and a broader, explicit calibration gate.
replace_once(
    "signal-lab-v3-candidates.js",
    '  CASCADE_DOWN: "cascade_structure_down",\n',
    '  CASCADE_DOWN: "cascade_structure_down",\n  CASCADE_V4_UP: "cascade_v4_up",\n  CASCADE_V4_DOWN: "cascade_v4_down",\n',
)
replace_once(
    "signal-lab-v3-candidates.js",
    '  [CANDIDATE_TYPES.CASCADE_DOWN]: "Кандидат каскада вниз",\n',
    '  [CANDIDATE_TYPES.CASCADE_DOWN]: "Кандидат каскада вниз",\n  [CANDIDATE_TYPES.CASCADE_V4_UP]: "Каскад V4 вверх",\n  [CANDIDATE_TYPES.CASCADE_V4_DOWN]: "Каскад V4 вниз",\n',
)
replace_once(
    "signal-lab-v3-candidates.js",
    '  minimumVolumeBoost: 1.35,\n',
    '  minimumVolumeBoost: 1.35,\n  v4MinimumQuoteVolume24h: 25_000_000,\n  v4CascadeMaximumDistancePct: 3,\n',
)
replace_once(
    "signal-lab-v3-candidates.js",
    '''  limitations = [],
}) {
  return Object.freeze({
    schemaVersion: 2,
    entity: "SignalLabCandidate",
    formulaVersion: SIGNAL_LAB_V3_FORMULA_VERSION,''',
    '''  limitations = [],
  formulaVersion = SIGNAL_LAB_V3_FORMULA_VERSION,
}) {
  return Object.freeze({
    schemaVersion: 2,
    entity: "SignalLabCandidate",
    formulaVersion,''',
)
replace_once(
    "signal-lab-v3-candidates.js",
    '''      limitations: Object.freeze([...new Set([
        "candidate-not-trade-signal",
        "only-four-patterns-are-collected",
        ...limitations,
      ])]),''',
    '''      limitations: Object.freeze([...new Set([
        "candidate-not-trade-signal",
        formulaVersion === SIGNAL_LAB_V3_FORMULA_VERSION
          ? "legacy-four-pattern-collector"
          : "v4-deterministic-calibration",
        ...limitations,
      ])]),''',
)

v4_detector = r'''
function detectCascadeV4Candidates(metrics, now, settings) {
  const quoteVolume24h = finite(metrics?.quoteVolume24h) ?? 0;
  if (quoteVolume24h < settings.v4MinimumQuoteVolume24h) return [];
  const events = Array.isArray(metrics?.cascadeMap?.active) ? metrics.cascadeMap.active : [];
  return events
    .filter((event) => (
      ["SETUP", "TRIGGERED", "CONFIRMED", "EXTENDED"].includes(event?.state)
      && (finite(event?.setupFeatures?.primaryDistancePct) ?? Infinity) <= settings.v4CascadeMaximumDistancePct
      && (event?.levelIds?.length ?? 0) >= 2
    ))
    .map((event) => {
      const direction = event.direction === "DOWN" ? "down" : "up";
      const state = event.state;
      const gaps = Array.isArray(event.adjacentGapPct) ? event.adjacentGapPct : [];
      const maxGap = gaps.length ? Math.max(...gaps.map((value) => finite(value) ?? 0)) : 0;
      const touchCounts = Array.isArray(event.touchCounts) ? event.touchCounts : [];
      const repeatedLevels = touchCounts.filter((count) => (finite(count) ?? 1) >= 2).length;
      const qualityLive = ["LIVE", "RECOVERED"].includes(String(event.dataQuality ?? "").toUpperCase());
      const distance = finite(event?.setupFeatures?.primaryDistancePct) ?? 0;
      const facts = [
        `${event.levelIds.length} активных уровня впереди`,
        `разрывы 0–${maxGap.toFixed(2)}% · общая ширина ${(finite(event.totalSpanPct) ?? 0).toFixed(2)}%`,
        repeatedLevels ? `${repeatedLevels} уровня имеют повторные атаки ×N` : "повторные атаки ×N пока не подтверждены",
        state === "SETUP" ? "первый уровень ещё не пройден" : `снято уровней: ${event.levelsBroken}`,
        `данные ${event.dataQuality ?? "UNKNOWN"}`,
      ];
      return candidate({
        metrics,
        now,
        type: direction === "up" ? CANDIDATE_TYPES.CASCADE_V4_UP : CANDIDATE_TYPES.CASCADE_V4_DOWN,
        direction,
        stage: state === "SETUP" ? "forming" : "triggered",
        formulaVersion: event.formulaVersion ?? metrics?.cascadeMap?.formulaVersion,
        evidence: {
          cascadeV4: event,
          cascadeState: state,
          geometricState: event.geometricState,
          levelsBroken: event.levelsBroken,
          levelIds: event.levelIds,
          levelPrices: event.levelPrices,
          adjacentGapPct: event.adjacentGapPct,
          totalSpanPct: event.totalSpanPct,
          touchCounts: event.touchCounts,
          variants: event.variants,
          setupDetectedAt: event.setupDetectedAt,
          triggeredAt: event.triggeredAt,
          confirmedAt: event.confirmedAt,
          dataQuality: event.dataQuality,
        },
        facts,
        hypotheses: ["cascade_breakout"],
        scoreParts: [
          Math.min(30, event.levelIds.length * 8),
          Math.min(18, repeatedLevels * 7),
          Math.max(0, 20 * (1 - distance / settings.v4CascadeMaximumDistancePct)),
          event.compressionType && event.compressionType !== "NO_COMPRESSION" ? 12 : 4,
          event.variants?.includes("MULTI_TIMEFRAME") ? 10 : 0,
          qualityLive ? 10 : 0,
        ],
        limitations: [
          "stops-behind-levels-are-a-microstructure-hypothesis-not-observed-orders",
          "cascade-v4-parameters-are-not-final-until-manual-validation",
          event.confirmationBlockedByDataQuality ? "confirmation-blocked-by-data-quality" : null,
        ],
      });
    });
}
'''
replace_once(
    "signal-lab-v3-candidates.js",
    '\nexport function detectExpertCandidates(metrics, now = Date.now(), options = {}) {',
    v4_detector + '\nexport function detectExpertCandidates(metrics, now = Date.now(), options = {}) {',
)
replace_once(
    "signal-lab-v3-candidates.js",
    '''  if (
    !symbol
    || price === null
    || price <= 0
    || warmupSeconds < settings.minimumWarmupSeconds
    || !isEligibleForSignalLabV3(metrics, settings)
  ) return [];

  const result = [];
  const thresholds = dynamicThresholds(metrics, settings);''',
    '''  if (
    !symbol
    || price === null
    || price <= 0
    || warmupSeconds < settings.minimumWarmupSeconds
  ) return [];

  const result = detectCascadeV4Candidates(metrics, now, settings);
  if (!isEligibleForSignalLabV3(metrics, settings)) {
    return result.sort((left, right) => right.evidenceScore - left.evidenceScore);
  }
  const thresholds = dynamicThresholds(metrics, settings);''',
)

# Collector: feed the cascade engine from live trades, closed candles and LevelMap.
replace_once(
    "signal-lab-v3-collector.js",
    'import { SignalLabV4LevelBreakoutRegistry } from "./signal-lab-v4-levels-breakouts.js?v=signal-lab-v4-stage2";\n',
    'import { SignalLabV4LevelBreakoutRegistry } from "./signal-lab-v4-levels-breakouts.js?v=signal-lab-v4-stage2";\nimport { SignalLabV4CascadeRegistry } from "./signal-lab-v4-cascades.js?v=signal-lab-v4-stage3";\n',
)
replace_once(
    "signal-lab-v3-collector.js",
    '    this.levels = new SignalLabV4LevelBreakoutRegistry();\n    this.tickSizes = new Map();',
    '    this.levels = new SignalLabV4LevelBreakoutRegistry();\n    this.cascades = new SignalLabV4CascadeRegistry();\n    this.tickSizes = new Map();',
)
replace_once(
    "signal-lab-v3-collector.js",
    '      breakoutEvents: 0,\n      tickSizes: 0,',
    '      breakoutEvents: 0,\n      cascadeSetups: 0,\n      cascadeTriggered: 0,\n      cascadeConfirmed: 0,\n      tickSizes: 0,',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''      if (tickSize) {
        this.levels.ingestPrice(data.s, finite(data.p), eventAt, {
          tickSize,
          dataQuality,
          source: "AGG_TRADE",
        });
      }
      this.extremes.ingestTrade(data.s, finite(data.p), eventAt, { dataQuality });''',
    '''      if (tickSize) {
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
      this.extremes.ingestTrade(data.s, finite(data.p), eventAt, { dataQuality });''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''        const levelMap = tickSize
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
    '''        const levelMap = tickSize
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
          : null;
        return {
          ...metrics,
          tickSize,
          extremeMap,
          levelMap,
          cascadeMap,
          bookCandidate: this.bookTracker.candidateFor(metrics.symbol, now),
        };''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '      breakoutEvents: metrics.reduce((sum, row) => sum + (row.levelMap?.activeEvents?.length ?? 0), 0),\n      tickSizes: this.tickSizes.size,',
    '''      breakoutEvents: metrics.reduce((sum, row) => sum + (row.levelMap?.activeEvents?.length ?? 0), 0),
      cascadeSetups: metrics.reduce((sum, row) => sum + (row.cascadeMap?.active?.filter((event) => event.state === "SETUP").length ?? 0), 0),
      cascadeTriggered: metrics.reduce((sum, row) => sum + (row.cascadeMap?.active?.filter((event) => event.state === "TRIGGERED").length ?? 0), 0),
      cascadeConfirmed: metrics.reduce((sum, row) => sum + (row.cascadeMap?.active?.filter((event) => ["CONFIRMED", "EXTENDED"].includes(event.state)).length ?? 0), 0),
      tickSizes: this.tickSizes.size,''',
)
replace_once(
    "signal-lab-v3-collector.js",
    '''    const setupRanked = [...ranked].sort((left, right) => (
      this.levels.watchScore(right.symbol, right.price)
      - this.levels.watchScore(left.symbol, left.price)''',
    '''    const setupRanked = [...ranked].sort((left, right) => (
      this.cascades.watchScore(right.symbol, right.price)
      - this.cascades.watchScore(left.symbol, left.price)
      || this.levels.watchScore(right.symbol, right.price)
      - this.levels.watchScore(left.symbol, left.price)''',
)

# Evidence package and coverage.
replace_once(
    "signal-lab-v3-evidence.js",
    'export const SIGNAL_LAB_V3_EVIDENCE_VERSION = "signal-lab-v4-levels-breakouts-stage2-2026-08";',
    'export const SIGNAL_LAB_V3_EVIDENCE_VERSION = "signal-lab-v4-cascade-stage3-2026-08";',
)
replace_once(
    "signal-lab-v3-evidence.js",
    '      levelMapLatest: metrics?.levelMap ? clone(metrics.levelMap) : null,\n      outcomes: {},',
    '      levelMapLatest: metrics?.levelMap ? clone(metrics.levelMap) : null,\n      cascadeMap: metrics?.cascadeMap ? clone(metrics.cascadeMap) : null,\n      cascadeMapLatest: metrics?.cascadeMap ? clone(metrics.cascadeMap) : null,\n      outcomes: {},',
)
replace_once(
    "signal-lab-v3-evidence.js",
    '    if (metrics?.levelMap) pack.levelMapLatest = clone(metrics.levelMap);\n',
    '    if (metrics?.levelMap) pack.levelMapLatest = clone(metrics.levelMap);\n    if (metrics?.cascadeMap) pack.cascadeMapLatest = clone(metrics.cascadeMap);\n',
)
replace_once(
    "signal-lab-v3-evidence.js",
    '      activeBreakoutEvents: pack.levelMapLatest?.activeEvents?.length ?? 0,\n',
    '      activeBreakoutEvents: pack.levelMapLatest?.activeEvents?.length ?? 0,\n      activeCascadeEvents: pack.cascadeMapLatest?.active?.length ?? 0,\n      cascadeHistoryEvents: pack.cascadeMapLatest?.history?.length ?? 0,\n',
)

# Full chart annotations for setup, sequential levels and lifecycle.
cascade_annotation = r'''
function addCascadeMapAnnotations(target, cascadeMap, eventAt, eventPrice) {
  const events = Array.isArray(cascadeMap?.history) ? cascadeMap.history : [];
  const ranked = events
    .filter((event) => Array.isArray(event?.levelPrices) && event.levelPrices.length >= 2)
    .map((event) => ({
      ...event,
      distance: eventPrice > 0
        ? Math.abs((finite(event.levelPrices[0]) ?? eventPrice) - eventPrice) / eventPrice * 100
        : 0,
    }))
    .filter((event) => event.distance <= 8)
    .sort((left, right) => right.setupDetectedAt - left.setupDetectedAt || left.distance - right.distance)
    .slice(0, 4);
  for (const event of ranked) {
    const endAt = finite(event.completedAt) ?? finite(event.failedAt) ?? eventAt + 60_000;
    event.levelPrices.forEach((price, index) => {
      const value = finite(price);
      if (!(value > 0)) return;
      const gap = index > 0 ? finite(event.adjacentGapPct?.[index - 1]) : null;
      const touches = event.touchCounts?.[index] ?? 1;
      target.push({
        type: "line",
        price: value,
        startAt: event.setupDetectedAt,
        endAt,
        label: `К${index + 1} ×${touches}${gap === null ? "" : ` · gap ${gap.toFixed(2)}%`}`,
        tone: index < event.levelsBroken ? "success" : "warning",
      });
    });
    target.push({ type: "event", time: event.setupDetectedAt, label: `КАСКАД SETUP · ${event.levelIds.length} уровня`, tone: "blue" });
    if (finite(event.triggeredAt) !== null) target.push({ type: "event", time: event.triggeredAt, label: "КАСКАД TRIGGERED · снят К1", tone: "warning" });
    if (finite(event.confirmedAt) !== null) target.push({ type: "event", time: event.confirmedAt, label: "КАСКАД CONFIRMED · снят К2", tone: "success" });
    if (event.state === "EXTENDED") target.push({ type: "event", time: event.brokenAt?.[2] ?? event.completedAt, label: `КАСКАД EXTENDED · ${event.levelsBroken} уровня`, tone: "success" });
    if (event.state === "PARTIAL") target.push({ type: "event", time: event.failedAt, label: "КАСКАД PARTIAL", tone: "warning" });
    if (event.state === "FAILED") target.push({ type: "event", time: event.failedAt, label: `КАСКАД FAILED · ${event.failureReasons?.[0] ?? "отмена"}`, tone: "danger" });
  }
}
'''
replace_once(
    "signal-lab-v3-full-chart.js",
    '\nexport function buildPatternAnnotations(episode) {',
    cascade_annotation + '\nexport function buildPatternAnnotations(episode) {',
)
replace_once(
    "signal-lab-v3-full-chart.js",
    '  addLevelMapAnnotations(annotations, pack?.levelMapLatest ?? pack?.levelMap, eventAt, eventPrice);\n',
    '  addLevelMapAnnotations(annotations, pack?.levelMapLatest ?? pack?.levelMap, eventAt, eventPrice);\n  addCascadeMapAnnotations(annotations, pack?.cascadeMapLatest ?? pack?.cascadeMap, eventAt, eventPrice);\n',
)

# Owner UI wording, status and cache keys.
replace_once(
    "owner-signal-lab-v3.html",
    'owner-signal-lab-v3-evidence.css?v=signal-lab-v4-stage2',
    'owner-signal-lab-v3-evidence.css?v=signal-lab-v4-stage3',
)
replace_once(
    "owner-signal-lab-v3.html",
    '''          Новые эпизоды создаются только для монет с 24-часовым оборотом выше $100 млн и NATR5 выше 1%.
          Лаборатория собирает только четыре паттерна: каскад, пробой, нож и заточку.
          Нож и заточка могут стать обратной реакцией после пробоя, каскада или сильного импульса.
          V4 параллельно строит неперерисовывающуюся карту high/low, объединяет близкие экстремумы в зоны ×N и отдельно фиксирует проход, принятие, ретест и прокол с возвратом.
          Эти правила пока калибруются отдельно от каскада и не являются торговой командой.''',
    '''          Legacy-кандидаты продолжают использовать фильтр оборота $100 млн и NATR5 1%, чтобы не потерять существующую выборку.
          Каскад V4 собирается отдельным детерминированным контуром от $25 млн оборота и не дальше 3% до первой ступени.
          Система заранее фиксирует SETUP, затем отдельно TRIGGERED, CONFIRMED, EXTENDED, PARTIAL и FAILED.
          Стопы за экстремумами остаются гипотезой микроструктуры: интерфейс показывает только уровни, проходы, качество данных и фактический результат.''',
)
replace_once(
    "owner-signal-lab-v3.html",
    'owner-signal-lab-v3.js?v=signal-lab-v4-stage2',
    'owner-signal-lab-v3.js?v=signal-lab-v4-stage3',
)
replace_once(
    "owner-signal-lab-v3.js",
    'signal-lab-v3-candidates.js?v=signal-lab-v4-stage1',
    'signal-lab-v3-candidates.js?v=signal-lab-v4-stage3',
)
replace_once(
    "owner-signal-lab-v3.js",
    'signal-lab-v3-collector.js?v=signal-lab-v4-stage1',
    'signal-lab-v3-collector.js?v=signal-lab-v4-stage3',
)
replace_once(
    "owner-signal-lab-v3.js",
    'signal-lab-v3-full-chart.js?v=signal-lab-v4-stage1',
    'signal-lab-v3-full-chart.js?v=signal-lab-v4-stage3',
)
replace_once(
    "owner-signal-lab-v3.js",
    '  return `${connection} · проверки ${status.checks} · эпизоды ${status.createdEpisodes} · экстремумы ${status.extremeMaps ?? 0} · miniTicker',
    '  return `${connection} · проверки ${status.checks} · эпизоды ${status.createdEpisodes} · экстремумы ${status.extremeMaps ?? 0} · зоны ${status.levelMaps ?? 0}/${status.breakoutEvents ?? 0} · каскады ${status.cascadeSetups ?? 0}/${status.cascadeTriggered ?? 0}/${status.cascadeConfirmed ?? 0} · miniTicker',
)

Path("docs/signal-lab-v4-cascade-stage3.md").write_text(r'''# Signal Lab V4 — Stage 3: deterministic cascade state machine

## Input

Only `LevelZone` objects and their breakout lifecycle from Stage 2 are accepted. The legacy candle-staircase detector remains available for regression comparison but is not the source of truth for V4.

## Lifecycle

`SETUP → TRIGGERED → CONFIRMED → EXTENDED`

Terminal alternatives:

- `PARTIAL`: only the first level was crossed before the time window closed;
- `FAILED`: the setup disappeared before trigger, the price fully returned behind the first zone, the inter-level pullback exceeded the configured limit, or the bar/time connectivity was broken.

`geometricState` is stored separately. GAP/STALE data may prove that two geometric prices were crossed, but it cannot silently become a fully confirmed cascade.

## Rules

- two zones are the minimum cascade;
- three zones are the full multi-stage cascade;
- four or more are extended;
- adjacent gaps from 0% through exactly 5% are valid;
- original zone touch counts and source timeframes are retained;
- setup exists before the first level break;
- the chain is frozen after trigger;
- level breaks must occur in order;
- duration, bars between levels and inter-level pullback are configurable by timeframe;
- repeated updates do not create duplicate events;
- long and short are symmetric;
- setup, trigger, confirm and completion anchors track 15s/1m/3m/5m, MFE, MAE and data gaps.

Formula: `signal-lab-v4-cascade-v1-2026-08`.

## Candidate collection

V4 cascade candidates use a separate visible calibration gate:

- quote volume 24h at least $25m;
- first level no farther than 3%;
- at least two active zones;
- no minimum NATR gate.

These values are configuration, not final trading thresholds.
''', encoding="utf-8")

Path("test/signal-lab-v4-cascade-integration.test.js").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { detectExpertCandidates } from "../signal-lab-v3-candidates.js";

const collector = fs.readFileSync(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
const evidence = fs.readFileSync(new URL("../signal-lab-v3-evidence.js", import.meta.url), "utf8");
const chart = fs.readFileSync(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");
const owner = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");

test("collector wires level lifecycle into cascade registry and metrics", () => {
  assert.match(collector, /SignalLabV4CascadeRegistry/);
  assert.match(collector, /this\.cascades\.sync/);
  assert.match(collector, /this\.cascades\.ingestCandle/);
  assert.match(collector, /cascadeMap/);
  assert.match(collector, /cascadeConfirmed/);
});

test("evidence and chart preserve cascade lifecycle", () => {
  assert.match(evidence, /cascadeMapLatest/);
  assert.match(evidence, /activeCascadeEvents/);
  assert.match(chart, /addCascadeMapAnnotations/);
  assert.match(chart, /КАСКАД SETUP/);
  assert.match(chart, /КАСКАД CONFIRMED/);
  assert.match(chart, /КАСКАД PARTIAL/);
});

test("owner status exposes setup, triggered and confirmed cascade counts", () => {
  assert.match(owner, /cascadeSetups/);
  assert.match(owner, /cascadeTriggered/);
  assert.match(owner, /cascadeConfirmed/);
  assert.match(owner, /signal-lab-v4-stage3/);
});

test("V4 setup becomes a reviewable candidate before first break", () => {
  const rows = detectExpertCandidates({
    symbol: "TESTUSDT",
    price: 99,
    updatedAt: 10_000,
    warmupSeconds: 60,
    quoteVolume24h: 30_000_000,
    natr5m: 0.2,
    cascadeMap: {
      active: [{
        id: "cascade-1",
        direction: "UP",
        state: "SETUP",
        geometricState: "SETUP",
        levelIds: ["h1", "h2"],
        levelPrices: [100, 102],
        adjacentGapPct: [2],
        totalSpanPct: 2,
        levelsBroken: 0,
        touchCounts: [2, 1],
        variants: ["MULTI_TOUCH_LEVEL"],
        compressionType: "REPEATED_ATTACKS",
        setupDetectedAt: 9_000,
        triggeredAt: null,
        confirmedAt: null,
        dataQuality: "LIVE",
        formulaVersion: "signal-lab-v4-cascade-v1-2026-08",
        setupFeatures: { primaryDistancePct: 1.01 },
      }],
    },
  }, 10_000);
  const candidate = rows.find((row) => row.candidateType === "cascade_v4_up");
  assert.ok(candidate);
  assert.equal(candidate.stage, "forming");
  assert.equal(candidate.formulaVersion, "signal-lab-v4-cascade-v1-2026-08");
  assert.ok(candidate.facts.some((fact) => fact.includes("2 активных уровня")));
});
''', encoding="utf-8")
