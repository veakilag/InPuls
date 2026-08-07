from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:200]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


levels = "signal-lab-v7-multi-timeframe-levels.js"

replace_once(
    levels,
    '''export const LOCAL_HIERARCHICAL_ADMISSION = Object.freeze({\n  "1m": Object.freeze({ minimumSwingPercent: 0.30, reversalMultiplier: 1.00 }),\n  "5m": Object.freeze({ minimumSwingPercent: 0.12, reversalMultiplier: 1.00 }),\n});''',
    '''export const LOCAL_HIERARCHICAL_ADMISSION = Object.freeze({\n  "1m": Object.freeze({ minimumSwingPercent: 0.30, reversalMultiplier: 1.00 }),\n  "5m": Object.freeze({ minimumSwingPercent: 0.12, reversalMultiplier: 1.00 }),\n});\n\n// V4.5 controls only the visible LOCAL working map. Detector/history stay complete.\n// Macro levels belong to senior TFs, so an old single-touch 1m/5m level far from\n// the current working area does not need to remain as another permanent ray.\nexport const LOCAL_WORKING_SET_POLICY = Object.freeze({\n  "1m": Object.freeze({ maxDistanceBaseNatr: 6, strongSwingBaseNatr: 4 }),\n  "5m": Object.freeze({ maxDistanceBaseNatr: 10, strongSwingBaseNatr: 4 }),\n});''',
)

marker = '''function applyHierarchyAcceptance(levels, candles, sourceTimeframe, includeHistory, options) {\n  const next = [];\n  for (const level of Array.isArray(levels) ? levels : []) {\n    if (level?.active === false) {\n      next.push(level);\n      continue;\n    }\n    const acceptance = structuralHierarchyAcceptance(level, candles, options);\n    if (!acceptance) {\n      next.push(level);\n      continue;\n    }\n    if (!includeHistory) continue;\n    next.push(Object.freeze({\n      ...level,\n      active: false,\n      crossedAt: level.crossedAt ?? acceptance.at,\n      endAt: acceptance.at,\n      status: "ACCEPTED",\n      inactiveReason: "CHILD_TIMEFRAME_ACCEPTANCE",\n      acceptedOnTimeframe: sourceTimeframe,\n    }));\n  }\n  return next;\n}\n'''

insert = marker + r'''
// A senior level is no longer the active frontier when a later CONFIRMED child
// structural extreme exists beyond it. This is stronger evidence than a wick,
// but does not require two closes beyond the old price. It solves fast takeouts
// such as HFT where a new child swing high/low is confirmed after the old macro
// level has already been traversed.
export function structuralChildConfirmedTakeout(level, childSnapshot, childTimeframe, {
  tickSize = 0,
  toleranceTicks = 1,
} = {}) {
  if (!level || level.active === false || !["HIGH", "LOW"].includes(level.side)) return null;
  const levelPrice = finite(level.price);
  const originAt = finite(level.nativeExtremeAt ?? level.extremeAt);
  if (!(levelPrice > 0) || originAt === null) return null;

  const tolerance = Math.max(0, finite(tickSize) ?? 0)
    * Math.max(0, Math.round(finite(toleranceTicks) ?? 1));
  const history = Array.isArray(childSnapshot?.history) ? childSnapshot.history : [];
  let winner = null;

  for (const candidate of history) {
    if (!candidate || candidate.side !== level.side) continue;
    const extremeAt = finite(candidate.extremeAt);
    const confirmedAt = finite(candidate.confirmedAt) ?? extremeAt;
    const price = finite(candidate.price);
    if (extremeAt === null || confirmedAt === null || extremeAt <= originAt || !(price > 0)) continue;
    const beyond = level.side === "HIGH"
      ? price > levelPrice + tolerance
      : price < levelPrice - tolerance;
    if (!beyond) continue;
    if (!winner || confirmedAt < winner.at) {
      winner = Object.freeze({
        at: confirmedAt,
        extremeAt,
        price,
        side: level.side,
        childTimeframe,
        extremeId: candidate.id ?? null,
        reason: "CHILD_STRUCTURAL_TAKEOUT",
      });
    }
  }
  return winner;
}

function applyChildStructuralTakeout(levels, childSnapshot, childTimeframe, includeHistory, options) {
  const next = [];
  for (const level of Array.isArray(levels) ? levels : []) {
    if (level?.active === false) {
      next.push(level);
      continue;
    }
    const takeout = structuralChildConfirmedTakeout(level, childSnapshot, childTimeframe, options);
    if (!takeout) {
      next.push(level);
      continue;
    }
    if (!includeHistory) continue;
    next.push(Object.freeze({
      ...level,
      active: false,
      crossedAt: level.crossedAt ?? takeout.at,
      endAt: takeout.at,
      status: "TAKEN_OUT",
      inactiveReason: "CHILD_STRUCTURAL_TAKEOUT",
      takenOutOnTimeframe: childTimeframe,
      takenOutByExtremeId: takeout.extremeId,
    }));
  }
  return next;
}

export function structuralLocalWorkingSetVisible(level, volatilityContext) {
  const sourceTimeframe = level?.sourceTimeframe;
  const policy = LOCAL_WORKING_SET_POLICY[sourceTimeframe];
  if (!policy || level?.active === false) return true;

  const sources = Array.isArray(level?.sources) ? level.sources : [sourceTimeframe].filter(Boolean);
  if (sources.length > 1 || Number(level?.confluenceCount) > 1) return true;
  if ((Number(level?.attackCount) || 1) > 1) return true;

  const distanceBaseNatr = structuralDistanceBaseNatr(level?.price, volatilityContext);
  if (distanceBaseNatr === null || distanceBaseNatr <= policy.maxDistanceBaseNatr) return true;

  const swingPct = finite(level?.swingAmplitudePct);
  const baseNatrPct = finite(volatilityContext?.baseNatrPct);
  const normalizedSwing = swingPct !== null && baseNatrPct > 0 ? swingPct / baseNatrPct : null;
  return normalizedSwing !== null && normalizedSwing >= policy.strongSwingBaseNatr;
}
'''
replace_once(levels, marker, insert)

old_loop = '''    if (hierarchy.length && childCandles.length) {\n      hierarchy = applyHierarchyAcceptance(\n        hierarchy,\n        childCandles,\n        sourceTimeframe,\n        includeHistory,\n        { tickSize, crossingToleranceTicks: 1, acceptanceBars: 2 },\n      );\n    }\n'''
new_loop = '''    if (hierarchy.length && snapshot) {\n      hierarchy = applyChildStructuralTakeout(\n        hierarchy,\n        snapshot,\n        sourceTimeframe,\n        includeHistory,\n        { tickSize, toleranceTicks: 1 },\n      );\n    }\n\n    if (hierarchy.length && childCandles.length) {\n      hierarchy = applyHierarchyAcceptance(\n        hierarchy,\n        childCandles,\n        sourceTimeframe,\n        includeHistory,\n        { tickSize, crossingToleranceTicks: 1, acceptanceBars: 2 },\n      );\n    }\n'''
replace_once(levels, old_loop, new_loop)

old_return = '''  return Object.freeze(hierarchy);\n}\n'''
new_return = '''  if (includeHistory) return Object.freeze(hierarchy);\n\n  const workingHierarchy = hierarchy.filter((level) => structuralLocalWorkingSetVisible(\n    level,\n    volatilityByTimeframe[level?.sourceTimeframe],\n  ));\n  return Object.freeze(workingHierarchy);\n}\n'''
# Replace only final hierarchical-map return (the file contains this exact ending once).
if (ROOT / levels).read_text(encoding="utf-8").count(old_return) != 1:
    raise RuntimeError("expected one hierarchical map return")
replace_once(levels, old_return, new_return)

# Focused tests.
test_path = ROOT / "test/signal-lab-v7-working-map-takeout.test.js"
test_path.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import {
  structuralChildConfirmedTakeout,
  structuralLocalWorkingSetVisible,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const seniorHigh = {
  id: "senior-high",
  side: "HIGH",
  price: 100,
  extremeAt: 1_000,
  nativeExtremeAt: 1_000,
  sourceTimeframe: "1h",
  active: true,
};

test("V4.5 confirmed child extreme beyond senior HIGH retires the old frontier", () => {
  const snapshot = {
    history: [
      { id: "child-high", side: "HIGH", price: 101, extremeAt: 2_000, confirmedAt: 2_500 },
    ],
  };
  const takeout = structuralChildConfirmedTakeout(seniorHigh, snapshot, "15m", {
    tickSize: 0.01,
    toleranceTicks: 1,
  });
  assert.equal(takeout?.reason, "CHILD_STRUCTURAL_TAKEOUT");
  assert.equal(takeout?.at, 2_500);
  assert.equal(takeout?.childTimeframe, "15m");
});

test("V4.5 wick-like child point without confirmed structural extreme is not enough", () => {
  const takeout = structuralChildConfirmedTakeout(seniorHigh, { history: [] }, "15m", {
    tickSize: 0.01,
  });
  assert.equal(takeout, null);
});

test("V4.5 far single-touch local level is hidden from working map but confluence/attacks survive", () => {
  const context = { currentPrice: 100, baseNatrPct: 1 };
  const farLocal = {
    side: "LOW",
    price: 88,
    sourceTimeframe: "5m",
    active: true,
    attackCount: 1,
    confluenceCount: 1,
    sources: ["5m"],
    swingAmplitudePct: 2,
  };
  assert.equal(structuralLocalWorkingSetVisible(farLocal, context), false);
  assert.equal(structuralLocalWorkingSetVisible({ ...farLocal, attackCount: 2 }, context), true);
  assert.equal(structuralLocalWorkingSetVisible({ ...farLocal, sources: ["1h", "5m"], confluenceCount: 2 }, context), true);
  assert.equal(structuralLocalWorkingSetVisible({ ...farLocal, swingAmplitudePct: 5 }, context), true);
});
''', encoding="utf-8")
