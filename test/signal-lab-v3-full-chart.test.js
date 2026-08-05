import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregateEpisodePricePoints,
  buildPatternAnnotations,
  patternAnnotationSummary,
} from "../signal-lab-v3-full-chart.js";
import { SignalLabV3Store } from "../signal-lab-v3-store.js";

function breakoutEpisode() {
  return {
    id: "BICOUSDT:level_break_attempt_up:1000:1",
    symbol: "BICOUSDT",
    candidateType: "level_break_attempt_up",
    firstSeenAt: 60_000,
    latest: {
      price: 0.241,
      evidence: {
        level: 0.24,
        touchCount: 3,
        touchTimes: [10_000, 30_000, 50_000],
        tolerancePercent: 0.1,
      },
    },
    evidencePack: {
      window: { startAt: 0, eventAt: 60_000, updatedAt: 65_000 },
      pricePoints: [
        { at: 0, price: 0.238 },
        { at: 30_000, price: 0.24 },
        { at: 60_000, price: 0.241 },
      ],
    },
  };
}

test("full chart aggregates saved second history into stable OHLC candles", () => {
  const candles = aggregateEpisodePricePoints([
    { at: 1_000, price: 10 },
    { at: 2_000, price: 12 },
    { at: 4_000, price: 9 },
    { at: 6_000, price: 11 },
  ], 5_000);
  assert.equal(candles.length, 2);
  assert.deepEqual(
    { open: candles[0].open, high: candles[0].high, low: candles[0].low, close: candles[0].close },
    { open: 10, high: 12, low: 9, close: 9 },
  );
});

test("breakout annotations expose the repeated level and every stored touch", () => {
  const annotations = buildPatternAnnotations(breakoutEpisode());
  assert.ok(annotations.some((row) => row.type === "event" && row.label === "КАНДИДАТ"));
  assert.ok(annotations.some((row) => row.type === "zone" && /3 касания/.test(row.label)));
  assert.equal(annotations.filter((row) => row.type === "point" && /^T/.test(row.label)).length, 3);
  assert.ok(patternAnnotationSummary(annotations).some((row) => /Уровень пробоя/.test(row)));
});

test("cascade annotations label staircase extrema as highs or lows", () => {
  const annotations = buildPatternAnnotations({
    id: "CASCADE",
    symbol: "TESTUSDT",
    candidateType: "cascade_structure_up",
    firstSeenAt: 90_000,
    latest: {
      price: 104,
      evidence: {
        side: "high",
        extrema: [
          { at: 10_000, price: 100 },
          { at: 40_000, price: 102 },
          { at: 70_000, price: 103.5 },
        ],
        zoneLower: 100,
        zoneUpper: 103.5,
        nearestStepPrice: 103.5,
      },
    },
    evidencePack: { window: { eventAt: 90_000 }, pricePoints: [] },
  });
  assert.deepEqual(
    annotations.filter((row) => row.type === "point").map((row) => row.label),
    ["H1", "H2", "H3"],
  );
  assert.equal(annotations.filter((row) => row.type === "segment").length, 2);
});

test("memory store clear removes episodes, reviews and evidence together", async () => {
  const store = new SignalLabV3Store({ indexedDB: null });
  await store.initialize();
  const episode = {
    ...breakoutEpisode(),
    candidateType: "level_break_attempt_up",
    label: "Кандидат пробоя вверх",
    direction: "up",
    stage: "forming",
    lastSeenAt: 60_000,
    observations: 1,
    peakEvidenceScore: 50,
    reviewState: "unreviewed",
  };
  await store.upsertEpisodes([episode]);
  await store.saveReview(episode.id, { verdict: "false_positive", comment: "старый мусор" });
  assert.equal((await store.list()).length, 1);
  await store.clearAll();
  assert.equal((await store.list()).length, 0);
  assert.equal((await store.summary()).episodes, 0);
});

test("owner page exposes lazy full chart, markup controls and destructive clear", async () => {
  const html = await readFile(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
  assert.match(html, /OWNER SIGNAL LAB V4/);
  assert.match(html, /data-field="full-chart"/);
  assert.match(html, /data-chart-timeframe="1s"/);
  assert.match(html, /data-chart-timeframe="1h"/);
  assert.match(html, /data-chart-tool="horizontal"/);
  assert.match(html, /data-field="chart-annotations-toggle"/);
  assert.match(html, /id="clear-records"/);
  assert.match(runtime, /mountEpisodeFullChart/);
  assert.match(runtime, /disposeEpisodeFullCharts/);
  assert.match(runtime, /window\.confirm/);
  assert.match(runtime, /store\.clearAll\(\)/);
  assert.match(runtime, /collector = createCollector\(\)/);
});

test("shared InPuls chart engine owns passive pattern annotations", async () => {
  const source = await readFile(new URL("../chart.js", import.meta.url), "utf8");
  assert.match(source, /export class CandlestickChart/);
  assert.match(source, /setAnnotations\(annotations = \[\]\)/);
  assert.match(source, /#drawAnnotations\(ctx\)/);
  assert.match(source, /annotation\.type === "zone"/);
  assert.match(source, /annotation\.type === "point"/);
});


test("open full chart locks card rerenders until the reviewer closes it", async () => {
  const chartRuntime = await readFile(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");
  const ownerRuntime = await readFile(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
  assert.match(chartRuntime, /export function isEpisodeFullChartOpen/);
  assert.match(chartRuntime, /inpuls:signal-lab-chart-closed/);
  assert.match(ownerRuntime, /if \(isEpisodeFullChartOpen\(\)\) \{/);
  assert.match(ownerRuntime, /state\.pendingRender = true/);
  assert.match(ownerRuntime, /window\.addEventListener\("inpuls:signal-lab-chart-closed"/);
});
