import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_STRUCTURAL_LEVEL_HORIZON_MS,
  buildStructuralLevelMap,
  clusterStructuralLevels,
  normalizeStructuralLevel,
  structuralLevelLabel,
  visibleSourceTimeframes,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const END = Date.UTC(2026, 7, 7, 0, 30, 0);

function extreme({
  id,
  side = "HIGH",
  price,
  extremeAt,
  attackCount = 1,
  active = true,
  crossedAt = null,
}) {
  return { id, side, price, extremeAt, attackCount, touchCount: attackCount, active, crossedAt, status: active ? "CONFIRMED_ACTIVE" : "CROSSED" };
}

test("lower chart sees its own timeframe and every stronger timeframe", () => {
  assert.deepEqual(visibleSourceTimeframes("1m"), ["1m", "5m", "15m", "1h", "4h", "1d"]);
  assert.deepEqual(visibleSourceTimeframes("5m"), ["5m", "15m", "1h", "4h", "1d"]);
  assert.deepEqual(visibleSourceTimeframes("4h"), ["4h", "1d"]);
  assert.deepEqual(visibleSourceTimeframes("1d"), ["1d"]);
});

test("1m and 5m levels expire from the map after 24 hours", () => {
  const recent = normalizeStructuralLevel(extreme({
    id: "recent",
    price: 100,
    extremeAt: END - LOCAL_STRUCTURAL_LEVEL_HORIZON_MS + 1,
  }), "1m", END);
  const old = normalizeStructuralLevel(extreme({
    id: "old",
    price: 100,
    extremeAt: END - LOCAL_STRUCTURAL_LEVEL_HORIZON_MS - 1,
  }), "1m", END);
  assert.ok(recent);
  assert.equal(old, null);

  const oldFourHour = normalizeStructuralLevel(extreme({
    id: "4h-old",
    price: 100,
    extremeAt: END - 40 * 24 * 60 * 60_000,
  }), "4h", END);
  assert.ok(oldFourHour);
});

test("near levels keep the strongest native timeframe", () => {
  const clustered = clusterStructuralLevels([
    normalizeStructuralLevel(extreme({ id: "5m", price: 100.02, extremeAt: END - 1_000, attackCount: 3 }), "5m", END),
    normalizeStructuralLevel(extreme({ id: "4h", price: 100, extremeAt: END - 2_000, attackCount: 2 }), "4h", END),
  ], { tickSize: 0.01, tolerancePct: 0.03, toleranceTicks: 3 });

  assert.equal(clustered.length, 1);
  assert.equal(clustered[0].sourceTimeframe, "4h");
  assert.deepEqual(clustered[0].sources, ["4h", "5m"]);
  assert.equal(structuralLevelLabel(clustered[0]), "H 4h + 5m · ×2");
});

test("5m map includes 15m, 1h, 4h and 1d without relabeling them to 5m", () => {
  const snapshotsByTimeframe = {
    "5m": { active: [extreme({ id: "5", side: "LOW", price: 90, extremeAt: END - 2_000 })], history: [] },
    "15m": { active: [extreme({ id: "15", side: "HIGH", price: 100, extremeAt: END - 3_000, attackCount: 1 })], history: [] },
    "1h": { active: [extreme({ id: "1h", side: "LOW", price: 80, extremeAt: END - 4_000 })], history: [] },
    "4h": { active: [extreme({ id: "4h", side: "HIGH", price: 110, extremeAt: END - 5_000, attackCount: 2 })], history: [] },
    "1d": { active: [extreme({ id: "1d", side: "LOW", price: 70, extremeAt: END - 6_000 })], history: [] },
  };
  const levels = buildStructuralLevelMap({
    snapshotsByTimeframe,
    viewTimeframe: "5m",
    endAt: END,
    tickSize: 0.01,
  });
  assert.deepEqual(new Set(levels.map((row) => row.sourceTimeframe)), new Set(["5m", "15m", "1h", "4h", "1d"]));
  const fourHour = levels.find((row) => row.id === "4h");
  assert.equal(structuralLevelLabel(fourHour), "H 4h · ×2");
});
