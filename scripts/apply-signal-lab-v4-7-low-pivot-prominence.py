from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ROOT / "signal-lab-v7-multi-timeframe-levels.js"
text = LEVELS.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one occurrence, found {count}: {old[:180]!r}")
    text = text.replace(old, new, 1)


replace_once(
'''export const LOCAL_WORKING_SET_POLICY = Object.freeze({
  "1m": Object.freeze({ maxDistanceBaseNatr: 4 }),
  "5m": Object.freeze({ maxDistanceBaseNatr: 6 }),
});''',
'''export const LOCAL_WORKING_SET_POLICY = Object.freeze({
  "1m": Object.freeze({ maxDistanceBaseNatr: 4 }),
  "5m": Object.freeze({ maxDistanceBaseNatr: 6 }),
});

// V4.7 calibration: trader review on BTC 5m showed that two shallow pauses
// inside one rising impulse were incorrectly promoted to fresh LOW levels while
// deeper swing bases were the intended structure. Keep event generation recall-
// first, but require a local LOW to have a meaningful incoming down-leg and an
// outgoing rebound before it enters the hierarchy. HIGH is deliberately not
// gated yet: the current BTC compression/high sequence is already visually
// correct and must not be regressed until we have an explicit HIGH review set.
export const LOCAL_PIVOT_PROMINENCE_POLICY = Object.freeze({
  "1m": Object.freeze({ lookbackBars: 8, minimumIncomingBaseNatr: 0.75, minimumOutgoingBaseNatr: 0.60 }),
  "5m": Object.freeze({ lookbackBars: 6, minimumIncomingBaseNatr: 0.75, minimumOutgoingBaseNatr: 0.60 }),
});''',
)

anchor = '''function applyChildStructuralTakeout(levels, childSnapshot, childTimeframe, includeHistory, options) {
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
'''

addition = anchor + '''
function structuralPercentMove(from, to) {
  const start = finite(from);
  const end = finite(to);
  if (!(start > 0) || !(end > 0)) return null;
  return Math.abs(end - start) / start * 100;
}

// Causal prominence check for local LOW calibration. Only candles available by
// confirmedAt are used on the right side of the pivot; no later future candles
// participate. A shallow pause inside a rising leg therefore fails on the weak
// incoming down-leg even if price later accelerates upward.
export function structuralLocalPivotProminenceDecision(
  extreme,
  sourceTimeframe,
  candles,
  volatilityContext,
) {
  const policy = LOCAL_PIVOT_PROMINENCE_POLICY[sourceTimeframe];
  if (!policy || extreme?.side !== "LOW") {
    return Object.freeze({ admitted: true, reason: extreme?.side === "HIGH" ? "HIGH_CALIBRATION_BYPASS" : "PROMINENCE_NOT_APPLICABLE" });
  }

  const pivotAt = finite(extreme?.extremeAt);
  const confirmedAt = finite(extreme?.confirmedAt);
  const pivotPrice = finite(extreme?.price);
  if (pivotAt === null || !(pivotPrice > 0)) {
    return Object.freeze({ admitted: true, reason: "PROMINENCE_MISSING_EXTREME_DATA" });
  }

  const rows = (Array.isArray(candles) ? candles : [])
    .map(validCandle)
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  const pivotIndex = rows.findIndex((row) => row.time === pivotAt);
  if (pivotIndex < 0) {
    return Object.freeze({ admitted: true, reason: "PROMINENCE_PIVOT_CANDLE_UNAVAILABLE" });
  }

  const lookbackBars = Math.max(2, Math.round(finite(policy.lookbackBars) ?? 6));
  const before = rows.slice(Math.max(0, pivotIndex - lookbackBars), pivotIndex);
  const after = rows
    .slice(pivotIndex + 1)
    .filter((row) => confirmedAt === null || row.time <= confirmedAt);
  if (!before.length || !after.length) {
    return Object.freeze({ admitted: true, reason: "PROMINENCE_CONTEXT_INCOMPLETE" });
  }

  const incomingReference = Math.max(...before.map((row) => row.high));
  const outgoingReference = Math.max(...after.map((row) => row.high));
  const incomingPct = structuralPercentMove(incomingReference, pivotPrice);
  const outgoingPct = structuralPercentMove(pivotPrice, outgoingReference);
  const natrAtExtreme = structuralNatrAt(volatilityContext, pivotAt);
  const baseNatrPct = finite(volatilityContext?.baseNatrPct) ?? natrAtExtreme;
  if (!(baseNatrPct > 0) || incomingPct === null || outgoingPct === null) {
    return Object.freeze({ admitted: true, reason: "PROMINENCE_SCALE_UNAVAILABLE" });
  }

  const incomingBaseNatr = incomingPct / baseNatrPct;
  const outgoingBaseNatr = outgoingPct / baseNatrPct;
  const minimumIncomingBaseNatr = Math.max(0, finite(policy.minimumIncomingBaseNatr) ?? 0.75);
  const minimumOutgoingBaseNatr = Math.max(0, finite(policy.minimumOutgoingBaseNatr) ?? 0.60);
  const incomingPassed = incomingBaseNatr >= minimumIncomingBaseNatr;
  const outgoingPassed = outgoingBaseNatr >= minimumOutgoingBaseNatr;
  const admitted = incomingPassed && outgoingPassed;

  return Object.freeze({
    admitted,
    reason: admitted ? "LOW_PIVOT_PROMINENCE_PASS" : "LOW_PIVOT_PROMINENCE_FILTERED",
    incomingPct,
    outgoingPct,
    baseNatrPct,
    incomingBaseNatr,
    outgoingBaseNatr,
    minimumIncomingBaseNatr,
    minimumOutgoingBaseNatr,
    incomingPassed,
    outgoingPassed,
    lookbackBars,
    pivotAt,
    confirmedAt,
  });
}
'''
replace_once(anchor, addition)

replace_once(
'''        if (confirmsInheritedLevel) return true;
        return structuralChildLevelSignificant(extreme, sourceTimeframe, { volatilityContext });''',
'''        if (confirmsInheritedLevel) return true;
        if (!structuralChildLevelSignificant(extreme, sourceTimeframe, { volatilityContext })) return false;
        return structuralLocalPivotProminenceDecision(
          extreme,
          sourceTimeframe,
          childCandles,
          volatilityContext,
        ).admitted;''',
)

LEVELS.write_text(text, encoding="utf-8")

TEST = ROOT / "test/signal-lab-v7-pivot-prominence.test.js"
TEST.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { structuralLocalPivotProminenceDecision } from "../signal-lab-v7-multi-timeframe-levels.js";

const STEP = 5 * 60_000;
const candle = (index, high, low, close = (high + low) / 2) => ({
  time: index * STEP,
  closeTime: (index + 1) * STEP - 1,
  high,
  low,
  close,
});

const volatility = Object.freeze({
  baseNatrPct: 0.20,
  currentNatrPct: 0.20,
  compressionRatio: 1,
  volatilityState: "NORMAL",
  times: Object.freeze([]),
  natrs: Object.freeze([]),
});

test("V4.7 filters a shallow LOW pause inside a rising impulse", () => {
  const candles = [
    candle(0, 100.10, 99.95),
    candle(1, 100.16, 100.00),
    candle(2, 100.22, 100.08),
    candle(3, 100.20, 100.12), // false local LOW: only ~0.10% incoming leg
    candle(4, 100.32, 100.13),
    candle(5, 100.42, 100.24),
  ];
  const decision = structuralLocalPivotProminenceDecision({
    side: "LOW",
    price: 100.12,
    extremeAt: 3 * STEP,
    confirmedAt: 5 * STEP + STEP - 1,
  }, "5m", candles, volatility);

  assert.equal(decision.admitted, false);
  assert.equal(decision.incomingPassed, false);
  assert.equal(decision.outgoingPassed, true);
  assert.equal(decision.reason, "LOW_PIVOT_PROMINENCE_FILTERED");
});

test("V4.7 keeps a genuine LOW with a standalone incoming leg and rebound", () => {
  const candles = [
    candle(0, 100.80, 100.55),
    candle(1, 100.70, 100.35),
    candle(2, 100.48, 100.12),
    candle(3, 100.18, 100.00),
    candle(4, 100.42, 100.05),
    candle(5, 100.78, 100.36),
  ];
  const decision = structuralLocalPivotProminenceDecision({
    side: "LOW",
    price: 100.00,
    extremeAt: 3 * STEP,
    confirmedAt: 5 * STEP + STEP - 1,
  }, "5m", candles, volatility);

  assert.equal(decision.admitted, true);
  assert.equal(decision.incomingPassed, true);
  assert.equal(decision.outgoingPassed, true);
  assert.equal(decision.reason, "LOW_PIVOT_PROMINENCE_PASS");
});

test("V4.7 deliberately leaves HIGH calibration unchanged", () => {
  const decision = structuralLocalPivotProminenceDecision({
    side: "HIGH",
    price: 100.5,
    extremeAt: 3 * STEP,
    confirmedAt: 5 * STEP + STEP - 1,
  }, "5m", [], volatility);
  assert.equal(decision.admitted, true);
  assert.equal(decision.reason, "HIGH_CALIBRATION_BYPASS");
});
''', encoding="utf-8")
