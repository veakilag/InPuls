import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_STRUCTURAL_LEVEL_HORIZON_MS,
  buildHierarchicalStructuralLevelMap,
  buildStructuralLevelMap,
  clusterStructuralLevels,
  hierarchicalDescentTimeframes,
  normalizeStructuralLevel,
  refineStructuralLevelToTimeframe,
  structuralChildLevelSignificant,
  structuralExtremeSupersession,
  structuralHierarchyAcceptance,
  structuralLevelLabel,
  visibleSourceTimeframes,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const END = Date.UTC(2026, 7, 7, 0, 30, 0);

function extreme({
  id,
  side = "HIGH",
  price,
  extremeAt,
  confirmedAt = extremeAt + 1_000,
  attackCount = 1,
  active = true,
  crossedAt = null,
  swingAmplitudePct = 2,
  confirmingReversalPct = 1,
  reversalThresholdPct = 0.2,
}) {
  return {
    id,
    side,
    price,
    extremeAt,
    confirmedAt,
    attackCount,
    touchCount: Math.max(0, attackCount - 1),
    active,
    crossedAt,
    status: active ? "CONFIRMED_ACTIVE" : "CROSSED",
    swingAmplitudePct,
    confirmingReversalPct,
    reversalThresholdPct,
  };
}

function candle(time, high, low) {
  return { time, high, low, open: low, close: high, closeTime: time + 59_999 };
}

test("lower chart sees its own timeframe and every stronger timeframe", () => {
  assert.deepEqual(visibleSourceTimeframes("1m"), ["1m", "5m", "15m", "1h", "4h", "1d"]);
  assert.deepEqual(visibleSourceTimeframes("5m"), ["5m", "15m", "1h", "4h", "1d"]);
  assert.deepEqual(visibleSourceTimeframes("4h"), ["4h", "1d"]);
  assert.deepEqual(visibleSourceTimeframes("1d"), ["1d"]);
  assert.deepEqual(hierarchicalDescentTimeframes("1m"), ["1d", "4h", "1h", "15m", "5m", "1m"]);
});

test("review history uses six months for senior TFs and one month for 15m and below", async () => {
  const { STRUCTURAL_TF_LOOKBACK_MS } = await import("../signal-lab-v7-multi-timeframe-levels.js");
  const day = 24 * 60 * 60_000;
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["1m"], 30 * day);
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["5m"], 30 * day);
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["15m"], 30 * day);
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["1h"], 180 * day);
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["4h"], 180 * day);
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["1d"], 180 * day);
});

test("1m and 5m levels expire from the map after 30 days", () => {
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
  assert.equal(structuralLevelLabel(clustered[0]), "H 4h + 5m · ×2 · 100");
});

test("5m map includes 15m, 1h, 4h and 1d without relabeling them to 5m", () => {
  const snapshotsByTimeframe = {
    "5m": { active: [extreme({ id: "5", side: "LOW", price: 90, extremeAt: END - 2_000 })], history: [] },
    "15m": { active: [extreme({ id: "15", side: "HIGH", price: 100, extremeAt: END - 3_000, attackCount: 1 })], history: [] },
    "1h": { active: [extreme({ id: "1h", side: "LOW", price: 80, extremeAt: END - 4_000 })], history: [] },
    "4h": { active: [extreme({ id: "4h", side: "HIGH", price: 110, extremeAt: END - 5_000, attackCount: 2 })], history: [] },
    "1d": { active: [extreme({ id: "1d", side: "LOW", price: 70, extremeAt: END - 6_000 })], history: [] },
  };
  const levels = buildStructuralLevelMap({ snapshotsByTimeframe, viewTimeframe: "5m", endAt: END, tickSize: 0.01 });
  assert.deepEqual(new Set(levels.map((row) => row.sourceTimeframe)), new Set(["5m", "15m", "1h", "4h", "1d"]));
  const fourHour = levels.find((row) => row.id === "4h");
  assert.equal(structuralLevelLabel(fourHour), "H 4h · ×2 · 110");
});

test("older level keeps price and native timeframe while its timestamp is refined downward", () => {
  const dayStart = Date.UTC(2026, 7, 6, 0, 0, 0);
  let level = normalizeStructuralLevel(extreme({ id: "day-high", side: "HIGH", price: 110, extremeAt: dayStart }), "1d", END);
  level = refineStructuralLevelToTimeframe(level, "4h", [
    candle(dayStart, 105, 95),
    candle(dayStart + 4 * 60 * 60_000, 110, 97),
    candle(dayStart + 8 * 60 * 60_000, 108, 96),
  ], { tickSize: 0.01 });
  level = refineStructuralLevelToTimeframe(level, "1h", [
    candle(dayStart + 4 * 60 * 60_000, 107, 100),
    candle(dayStart + 5 * 60 * 60_000, 110, 101),
    candle(dayStart + 6 * 60 * 60_000, 109, 102),
  ], { tickSize: 0.01 });

  assert.equal(level.sourceTimeframe, "1d");
  assert.equal(level.price, 110);
  assert.equal(level.nativeExtremeAt, dayStart);
  assert.equal(level.displayAt, dayStart + 5 * 60 * 60_000);
  assert.equal(level.refinedThroughTimeframe, "1h");
  assert.deepEqual(level.refinementPath.map((row) => row.timeframe), ["1d", "4h", "1h"]);
});

test("shallow 1m micro swing is not admitted while meaningful 1m swing is", () => {
  assert.equal(structuralChildLevelSignificant(extreme({
    id: "noise",
    side: "LOW",
    price: 100,
    extremeAt: END - 1_000,
    swingAmplitudePct: 0.18,
    reversalThresholdPct: 0.10,
  }), "1m"), false);

  assert.equal(structuralChildLevelSignificant(extreme({
    id: "meaningful",
    side: "HIGH",
    price: 101,
    extremeAt: END - 2_000,
    swingAmplitudePct: 0.55,
    reversalThresholdPct: 0.10,
  }), "1m"), true);
});

test("later confirmed higher HIGH structurally retires an older passed HIGH", () => {
  const oldHigh = extreme({
    id: "old-high",
    side: "HIGH",
    price: 100,
    extremeAt: END - 10_000,
    confirmedAt: END - 9_000,
  });
  const newHigh = extreme({
    id: "new-high",
    side: "HIGH",
    price: 105,
    extremeAt: END - 5_000,
    confirmedAt: END - 4_000,
  });
  const snapshot = { active: [oldHigh, newHigh], history: [oldHigh, newHigh] };

  const supersession = structuralExtremeSupersession(oldHigh, snapshot);
  assert.equal(supersession?.extremeId, "new-high");
  assert.equal(supersession?.at, END - 4_000);

  const activeMap = buildStructuralLevelMap({
    snapshotsByTimeframe: { "1h": snapshot },
    viewTimeframe: "1h",
    endAt: END,
    tickSize: 0.01,
  });
  assert.equal(activeMap.some((row) => row.id === "old-high"), false);
  assert.equal(activeMap.some((row) => row.id === "new-high"), true);

  const historyMap = buildStructuralLevelMap({
    snapshotsByTimeframe: { "1h": snapshot },
    viewTimeframe: "1h",
    endAt: END,
    includeHistory: true,
    tickSize: 0.01,
  });
  const retired = historyMap.find((row) => row.id === "old-high");
  assert.equal(retired?.active, false);
  assert.equal(retired?.structurallySuperseded, true);
  assert.equal(retired?.status, "SUPERSEDED");
  assert.equal(structuralLevelLabel(retired), "H 1h · ×1 · 100 · СНЯТ");
});

test("later confirmed lower LOW structurally retires an older passed LOW", () => {
  const oldLow = extreme({
    id: "old-low",
    side: "LOW",
    price: 90,
    extremeAt: END - 12_000,
    confirmedAt: END - 11_000,
  });
  const newLow = extreme({
    id: "new-low",
    side: "LOW",
    price: 84,
    extremeAt: END - 6_000,
    confirmedAt: END - 5_000,
  });
  const snapshot = { active: [oldLow, newLow], history: [oldLow, newLow] };

  const supersession = structuralExtremeSupersession(oldLow, snapshot);
  assert.equal(supersession?.extremeId, "new-low");

  const levels = buildHierarchicalStructuralLevelMap({
    snapshotsByTimeframe: { "1h": snapshot, "4h": { active: [], history: [] }, "1d": { active: [], history: [] } },
    candlesByTimeframe: { "1d": [], "4h": [], "1h": [] },
    viewTimeframe: "1h",
    endAt: END,
    tickSize: 0.01,
  });
  assert.equal(levels.some((row) => row.id === "old-low"), false);
  assert.equal(levels.some((row) => row.id === "new-low"), true);
});

test("a later same-side extreme that does not pass the old price does not retire it", () => {
  const oldHigh = extreme({ id: "old", side: "HIGH", price: 100, extremeAt: END - 10_000 });
  const lowerHigh = extreme({ id: "lower", side: "HIGH", price: 98, extremeAt: END - 5_000 });
  const snapshot = { active: [oldHigh, lowerHigh], history: [oldHigh, lowerHigh] };
  assert.equal(structuralExtremeSupersession(oldHigh, snapshot), null);
});

test("hierarchical map starts at 1d, refines it and only then adds significant children", () => {
  const dayStart = Date.UTC(2026, 7, 6, 0, 0, 0);
  const snapshotsByTimeframe = {
    "1d": { active: [extreme({ id: "d", side: "HIGH", price: 110, extremeAt: dayStart, attackCount: 2 })], history: [] },
    "4h": { active: [extreme({ id: "h4", side: "LOW", price: 90, extremeAt: dayStart + 8 * 60 * 60_000 })], history: [] },
    "1h": { active: [], history: [] },
    "15m": { active: [], history: [] },
    "5m": { active: [], history: [] },
    "1m": { active: [
      extreme({ id: "noise", side: "LOW", price: 100, extremeAt: END - 10 * 60_000, swingAmplitudePct: 0.15, reversalThresholdPct: 0.10 }),
      extreme({ id: "local", side: "HIGH", price: 104, extremeAt: END - 5 * 60_000, swingAmplitudePct: 0.60, reversalThresholdPct: 0.10 }),
    ], history: [] },
  };
  const candlesByTimeframe = {
    "4h": [candle(dayStart, 105, 95), candle(dayStart + 4 * 60 * 60_000, 110, 94)],
    "1h": [candle(dayStart + 4 * 60 * 60_000, 108, 96), candle(dayStart + 5 * 60 * 60_000, 110, 97)],
    "15m": [],
    "5m": [],
    "1m": [],
  };

  const levels = buildHierarchicalStructuralLevelMap({
    snapshotsByTimeframe,
    candlesByTimeframe,
    viewTimeframe: "1m",
    endAt: END,
    tickSize: 0.01,
  });

  assert.ok(levels.find((row) => row.id === "d" && row.sourceTimeframe === "1d"));
  assert.ok(levels.find((row) => row.id === "h4" && row.sourceTimeframe === "4h"));
  assert.ok(levels.find((row) => row.id === "local" && row.sourceTimeframe === "1m"));
  assert.equal(levels.some((row) => row.id === "noise"), false);
});


test("V4.3 keeps nearby same-timeframe highs as separate structural events", () => {
  const first = normalizeStructuralLevel(extreme({
    id: "5m-a",
    side: "HIGH",
    price: 100,
    extremeAt: END - 30 * 60_000,
  }), "5m", END);
  const second = normalizeStructuralLevel(extreme({
    id: "5m-b",
    side: "HIGH",
    price: 100.01,
    extremeAt: END - 10 * 60_000,
  }), "5m", END);
  const clustered = clusterStructuralLevels([first, second], {
    tickSize: 0.01,
    tolerancePct: 0.03,
    toleranceTicks: 3,
  });
  assert.equal(clustered.length, 2);
});

test("V4.3 still merges a junior duplicate into senior ownership/confluence", () => {
  const senior = normalizeStructuralLevel(extreme({
    id: "4h-high",
    side: "HIGH",
    price: 100,
    extremeAt: END - 4 * 60 * 60_000,
  }), "4h", END);
  const junior = normalizeStructuralLevel(extreme({
    id: "5m-high",
    side: "HIGH",
    price: 100.01,
    extremeAt: END - 60 * 60_000,
  }), "5m", END);
  const clustered = clusterStructuralLevels([senior, junior], {
    tickSize: 0.01,
    tolerancePct: 0.03,
    toleranceTicks: 3,
  });
  assert.equal(clustered.length, 1);
  assert.equal(clustered[0].sourceTimeframe, "4h");
  assert.deepEqual(clustered[0].sources, ["4h", "5m"]);
});

test("V4.3 child timeframe retires an inherited HIGH only after two closes beyond", () => {
  const level = normalizeStructuralLevel(extreme({
    id: "1h-high",
    side: "HIGH",
    price: 100,
    extremeAt: END - 60 * 60_000,
  }), "1h", END);
  const oneClose = [
    { time: END - 15 * 60_000, closeTime: END - 10 * 60_000 - 1, high: 101, low: 99, close: 100.5 },
  ];
  const accepted = [
    ...oneClose,
    { time: END - 10 * 60_000, closeTime: END - 5 * 60_000 - 1, high: 101.2, low: 100, close: 100.7 },
  ];
  assert.equal(structuralHierarchyAcceptance(level, oneClose, { tickSize: 0.01 }), null);
  assert.equal(structuralHierarchyAcceptance(level, accepted, { tickSize: 0.01 })?.reason, "CHILD_TIMEFRAME_ACCEPTANCE");
});

test("V4.3 hierarchical map removes a passed inherited LOW on child candles", () => {
  const seniorLow = extreme({
    id: "1h-low",
    side: "LOW",
    price: 90,
    extremeAt: END - 2 * 60 * 60_000,
  });
  const childCandles = [
    { time: END - 15 * 60_000, closeTime: END - 10 * 60_000 - 1, high: 91, low: 88, open: 90, close: 89.5 },
    { time: END - 10 * 60_000, closeTime: END - 5 * 60_000 - 1, high: 90, low: 88, open: 89.5, close: 89.0 },
  ];
  const levels = buildHierarchicalStructuralLevelMap({
    snapshotsByTimeframe: {
      "1d": { active: [], history: [] },
      "4h": { active: [], history: [] },
      "1h": { active: [seniorLow], history: [seniorLow] },
      "15m": { active: [], history: [] },
      "5m": { active: [], history: [] },
    },
    candlesByTimeframe: {
      "1d": [],
      "4h": [],
      "1h": [],
      "15m": [],
      "5m": childCandles,
    },
    viewTimeframe: "5m",
    endAt: END,
    tickSize: 0.01,
  });
  assert.equal(levels.some((row) => row.id === "1h-low"), false);
});
