from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old[:100]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


replace_exact(
    "signal-lab-v4-levels-breakouts.js",
    'export const SIGNAL_LAB_V4_LEVEL_FORMULA_VERSION = "signal-lab-v4-levels-breakouts-v1-2026-08";',
    'export const SIGNAL_LAB_V4_LEVEL_FORMULA_VERSION = "signal-lab-v6-canonical-levels-v2-2026-08";',
)
replace_exact(
    "signal-lab-v4-levels-breakouts.js",
    """    const sourceTouches = Math.max(zone.sourcePoints.length, ...zone.sourcePoints.map((row) => row.touchCount ?? 1));
    zone.touchCount = Math.max(zone.touchCount, sourceTouches);
    const sourceAttackTimes = zone.sourcePoints.map((row) => row.extremeTime).filter(Number.isFinite);
    zone.attackTimes = [...new Set([...zone.attackTimes, ...sourceAttackTimes])].sort((a, b) => a - b);""",
    """    // Different timeframes may confirm the same physical swing. They strengthen the zone,
    // but must never be counted as independent price attacks. The finest available
    // timeframe owns the source timestamp; real subsequent attacks are added only
    // by #observeContactAndRearm after the level has rearmed.
    const sourceTouches = Math.max(1, ...zone.sourcePoints.map((row) => row.touchCount ?? 1));
    zone.touchCount = Math.max(zone.touchCount, sourceTouches);
    const timeframeRank = { "1m": 1, "5m": 2, "15m": 3, "1h": 4, "4h": 5, "1d": 6 };
    const finestRank = Math.min(...zone.sourcePoints.map((row) => timeframeRank[row.timeframe] ?? 99));
    const sourceAttackTimes = zone.sourcePoints
      .filter((row) => (timeframeRank[row.timeframe] ?? 99) === finestRank)
      .map((row) => row.extremeTime)
      .filter(Number.isFinite);
    zone.attackTimes = [...new Set([...zone.attackTimes, ...sourceAttackTimes])].sort((a, b) => a - b);""",
)
replace_exact(
    "signal-lab-v4-levels-breakouts.js",
    """      sourceExtremeCount: zone.extremeIds.length,
      multiTimeframeCount: zone.timeframes.length,""",
    """      sourceExtremeCount: zone.extremeIds.length,
      physicalAttackCount: zone.touchCount,
      multiTimeframeCount: zone.timeframes.length,
      timeframeConfirmationStrength: Math.max(1, zone.timeframes.length),""",
)

replace_exact(
    "signal-lab-v3-full-chart.js",
    "  for (const zone of zones.slice(0, 20)) {",
    "  for (const zone of zones.slice(0, 8)) {",
)
replace_exact(
    "signal-lab-v3-full-chart.js",
    "  for (const event of Array.isArray(levelMap?.eventHistory) ? levelMap.eventHistory.slice(-20) : []) {",
    "  for (const event of Array.isArray(levelMap?.eventHistory) ? levelMap.eventHistory.slice(-8) : []) {",
)
replace_exact(
    "signal-lab-v3-full-chart.js",
    "    .slice(0, 4);",
    "    .slice(0, 1);",
)
replace_exact(
    "signal-lab-v3-full-chart.js",
    """  addExtremeMapAnnotations(annotations, pack?.extremeMap, eventAt, eventPrice);
  addLevelMapAnnotations(annotations, pack?.levelMapLatest ?? pack?.levelMap, eventAt, eventPrice);""",
    """  const canonicalLevelMap = pack?.levelMapLatest ?? pack?.levelMap;
  // Raw per-timeframe extrema remain in Evidence Pack for diagnostics. On the normal
  // chart they are hidden once canonical zones are available, otherwise every physical
  // swing is drawn several times (1m/5m/15m/...).
  if (!(canonicalLevelMap?.activeZones?.length > 0)) {
    addExtremeMapAnnotations(annotations, pack?.extremeMap, eventAt, eventPrice);
  }
  addLevelMapAnnotations(annotations, canonicalLevelMap, eventAt, eventPrice);""",
)

replace_exact(
    "signal-lab-v3-collector.js",
    "./signal-lab-v4-levels-breakouts.js?v=signal-lab-v4-stage2",
    "./signal-lab-v4-levels-breakouts.js?v=signal-lab-v6-canonical-levels",
)
replace_exact(
    "owner-signal-lab-v3.js",
    "./signal-lab-v3-full-chart.js?v=signal-lab-v5-candles-1",
    "./signal-lab-v3-full-chart.js?v=signal-lab-v6-canonical-annotations",
)

replace_exact(
    "test/signal-lab-v4-levels-breakouts.test.js",
    "  assert.equal(zone.touchCount, 2);",
    "  assert.equal(zone.touchCount, 1);\n  assert.equal(zone.setupFeatures.multiTimeframeCount, 2);",
)

Path("test/signal-lab-v6-canonical-structure.test.js").write_text(
    '''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LevelZoneEngine } from "../signal-lab-v4-levels-breakouts.js";
import { buildPatternAnnotations } from "../signal-lab-v3-full-chart.js";

function multiTfExtremeMap() {
  return {
    timeframes: {
      "1m": { active: [{ id: "h-1m", side: "HIGH", price: 100, priceTicks: "10000", extremeTime: 60_000, confirmedAt: 61_000, touchCount: 1 }] },
      "5m": { active: [{ id: "h-5m", side: "HIGH", price: 100.02, priceTicks: "10002", extremeTime: 0, confirmedAt: 62_000, touchCount: 1 }] },
      "15m": { active: [{ id: "h-15m", side: "HIGH", price: 100.01, priceTicks: "10001", extremeTime: 0, confirmedAt: 63_000, touchCount: 1 }] },
    },
  };
}

function engine() {
  return new LevelZoneEngine({
    symbol: "TESTUSDT",
    tickSize: 0.01,
    config: {
      mergeTicks: 4,
      mergePct: 0,
      mergeAtrFactor: 0,
      rearmTicks: 5,
      rearmPct: 0,
      rearmAtrFactor: 0,
      rearmBars: 2,
      rearmTimeMs: 1_000,
    },
  });
}

test("one physical multi-timeframe swing creates one canonical zone and one touch", () => {
  const subject = engine();
  const snapshot = subject.syncExtremeMap(multiTfExtremeMap(), { at: 70_000 });
  assert.equal(snapshot.activeZones.length, 1);
  const zone = snapshot.activeZones[0];
  assert.equal(zone.touchCount, 1);
  assert.deepEqual([...zone.timeframes].sort(), ["15m", "1m", "5m"]);
  assert.equal(zone.setupFeatures.multiTimeframeCount, 3);
  assert.equal(zone.setupFeatures.timeframeConfirmationStrength, 3);
  assert.equal(zone.attackTimes.length, 1);
});

test("only a real return after rearm increments canonical touch count", () => {
  const subject = engine();
  subject.syncExtremeMap(multiTfExtremeMap(), { at: 70_000 });
  subject.ingestPrice(99.90, 71_000);
  subject.ingestPrice(99.90, 72_500);
  subject.ingestPrice(100.01, 73_000);
  assert.equal(subject.snapshot().activeZones[0].touchCount, 2);
});

test("normal chart hides raw timeframe duplicates when canonical zones exist", () => {
  const levelMap = engine().syncExtremeMap(multiTfExtremeMap(), { at: 70_000 });
  const episode = {
    candidateType: "cascade_v4_up",
    firstSeenAt: 80_000,
    latest: { price: 99 },
    evidencePack: {
      window: { eventAt: 80_000 },
      extremeMap: multiTfExtremeMap(),
      levelMap,
      levelMapLatest: levelMap,
      cascadeMap: { history: [] },
      pricePoints: [],
    },
  };
  const annotations = buildPatternAnnotations(episode);
  const labels = annotations.map((row) => row.label ?? "");
  assert.equal(labels.some((label) => /^H (1m|5m|15m) ×/.test(label)), false);
  assert.equal(labels.filter((label) => label.startsWith("H зона ×1")).length, 1);
});

test("chart limits canonical levels and cascade overlays instead of drawing the whole map", () => {
  const chart = fs.readFileSync(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");
  assert.match(chart, /zones\\.slice\\(0, 8\\)/);
  assert.match(chart, /eventHistory\\.slice\\(-8\\)/);
  assert.match(chart, /\\.slice\\(0, 1\\);/);
  assert.match(chart, /canonicalLevelMap\\?\\.activeZones\\?\\.length/);
});
''',
    encoding="utf-8",
)

Path(".github/workflows/zz-signal-lab-canonical-patch.yml").unlink(missing_ok=True)
Path("scripts/apply-signal-lab-canonical-patch.py").unlink(missing_ok=True)
