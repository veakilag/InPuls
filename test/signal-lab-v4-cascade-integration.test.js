import test from "node:test";
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
