import test from "node:test";
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

test("normal chart keeps one deduplicated active ray together with the canonical zone", () => {
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
  const rays = annotations.filter((row) => row.type === "ray");
  const labels = annotations.map((row) => row.label ?? "");
  assert.equal(rays.length, 1);
  assert.equal(rays[0].label, "H 1m/5m/15m ×1");
  assert.equal(rays[0].price, 100.02);
  assert.equal(labels.filter((label) => label.startsWith("H зона ×1")).length, 1);
});

test("chart limits canonical overlays while always emitting deduplicated active rays", () => {
  const chart = fs.readFileSync(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");
  assert.match(chart, /zones\.slice\(0, 8\)/);
  assert.match(chart, /eventHistory\.slice\(-8\)/);
  assert.match(chart, /\.slice\(0, 1\);/);
  assert.match(chart, /groups\.slice\(0, 32\)/);
  assert.match(chart, /addExtremeMapAnnotations\(annotations, pack\?\.extremeMap, eventAt, eventPrice\)/);
  assert.doesNotMatch(chart, /if \(!\(canonicalLevelMap\?\.activeZones\?\.length > 0\)\)/);
});
