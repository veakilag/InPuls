from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "signal-lab-v7-multi-timeframe-levels.js"
TEST = ROOT / "test/signal-lab-v7-local-frontier.test.js"

text = TARGET.read_text(encoding="utf-8")

old_policy = '  "1m": Object.freeze({ maxDistanceBaseNatr: 4 }),' 
new_policy = '''  "1m": Object.freeze({
    maxDistanceBaseNatr: 4,
    // V4.17: a single-touch native 1m pivot at the right edge is still an
    // unresolved micro turn. Keep it in event/history memory, but do not draw
    // it on the working map until two later 1m candles are fully available.
    minimumRightBars: 2,
  }),'''
if old_policy not in text:
    raise SystemExit("1m working-set policy anchor not found")
text = text.replace(old_policy, new_policy, 1)

anchor = 'export function structuralLocalWorkingSetVisible(level, volatilityContext, candles = [], {\n'
helper = '''export function structuralLocalRightEdgeMaturityDecision(level, candles = []) {
  const sourceTimeframe = level?.sourceTimeframe;
  const policy = LOCAL_WORKING_SET_POLICY[sourceTimeframe];
  const minimumRightBars = Math.max(0, Math.round(finite(policy?.minimumRightBars) ?? 0));
  if (!(minimumRightBars > 0) || level?.active === false) {
    return Object.freeze({ mature: true, reason: "RIGHT_EDGE_MATURITY_NOT_APPLICABLE", minimumRightBars });
  }

  const pivotAt = finite(level?.nativeExtremeAt ?? level?.extremeAt);
  if (pivotAt === null) {
    return Object.freeze({ mature: true, reason: "RIGHT_EDGE_MATURITY_MISSING_PIVOT", minimumRightBars });
  }

  const rows = (Array.isArray(candles) ? candles : [])
    .map(validCandle)
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);
  if (!rows.length) {
    return Object.freeze({ mature: true, reason: "RIGHT_EDGE_MATURITY_CONTEXT_UNAVAILABLE", minimumRightBars });
  }

  const pivotIndex = rows.findIndex((row) => row.time === pivotAt);
  if (pivotIndex < 0) {
    return Object.freeze({ mature: true, reason: "RIGHT_EDGE_MATURITY_PIVOT_CANDLE_UNAVAILABLE", minimumRightBars });
  }

  const rightBars = Math.max(0, rows.length - pivotIndex - 1);
  const mature = rightBars >= minimumRightBars;
  return Object.freeze({
    mature,
    reason: mature ? "RIGHT_EDGE_MATURE" : "RIGHT_EDGE_UNRESOLVED_FILTERED",
    pivotAt,
    rightBars,
    minimumRightBars,
    latestCandleAt: rows.at(-1)?.time ?? null,
  });
}

'''
if anchor not in text:
    raise SystemExit("working-set visible anchor not found")
if 'export function structuralLocalRightEdgeMaturityDecision' not in text:
    text = text.replace(anchor, helper + anchor, 1)

old_after_attacks = '''  if ((Number(level?.attackCount) || 1) > 1) return true;

  // V4.13: post-cluster local-only pivot guard.'''
new_after_attacks = '''  if ((Number(level?.attackCount) || 1) > 1) return true;

  // V4.17: do not promote the unresolved single-touch 1m tail at the data/live
  // edge into a working-map level. Detector/history remain complete. Two later
  // closed 1m bars are enough to distinguish a confirmed structural turn from
  // the last technical bounce/pullback pair without using percentage tuning.
  const maturityDecision = structuralLocalRightEdgeMaturityDecision(level, candles);
  if (!maturityDecision.mature) return false;

  // V4.13: post-cluster local-only pivot guard.'''
if old_after_attacks not in text:
    raise SystemExit("attack bypass anchor not found")
text = text.replace(old_after_attacks, new_after_attacks, 1)

old_frontier_comment = '''  // V4.16: preserve exactly one latest ACTIVE native frontier per side on local
  // views. This is intentionally NOT a global distance bypass: older local rays
  // still obey the working-set radius, and filtered pivots remain filtered.'''
new_frontier_comment = '''  // V4.17: preserve exactly one latest MATURE ACTIVE native frontier per side on
  // local views. An unresolved right-edge micro pivot must not steal frontier
  // ownership from the preceding structural swing. This remains only a distance
  // bypass; pivot-quality and right-edge maturity are still mandatory.'''
if old_frontier_comment not in text:
    raise SystemExit("frontier comment anchor not found")
text = text.replace(old_frontier_comment, new_frontier_comment, 1)

old_loop = '''        if (level?.active === false || level?.side !== side) continue;
        if (level?.sourceTimeframe !== viewTimeframe) continue;
        const at = finite(level?.nativeExtremeAt ?? level?.extremeAt);'''
new_loop = '''        if (level?.active === false || level?.side !== side) continue;
        if (level?.sourceTimeframe !== viewTimeframe) continue;
        const maturityDecision = structuralLocalRightEdgeMaturityDecision(
          level,
          candlesByTimeframe?.[viewTimeframe] ?? [],
        );
        if (!maturityDecision.mature && (Number(level?.attackCount) || 1) <= 1) continue;
        const at = finite(level?.nativeExtremeAt ?? level?.extremeAt);'''
if old_loop not in text:
    raise SystemExit("native frontier loop anchor not found")
text = text.replace(old_loop, new_loop, 1)

TARGET.write_text(text, encoding="utf-8")

test_text = TEST.read_text(encoding="utf-8")
old_import = '''  LOCAL_WORKING_SET_POLICY,
  structuralLocalWorkingSetVisible,
} from "../signal-lab-v7-multi-timeframe-levels.js";'''
new_import = '''  LOCAL_WORKING_SET_POLICY,
  structuralLocalRightEdgeMaturityDecision,
  structuralLocalWorkingSetVisible,
} from "../signal-lab-v7-multi-timeframe-levels.js";'''
if old_import not in test_text:
    raise SystemExit("test import anchor not found")
test_text = test_text.replace(old_import, new_import, 1)

append = '''

test("V4.17 hides unresolved single-touch native 1m pivots at the right edge", () => {
  const oneMinute = level({
    sourceTimeframe: "1m",
    side: "HIGH",
    price: 100.1,
    extremeAt: 120_000,
    nativeExtremeAt: 120_000,
    sources: ["1m"],
  });
  const oneBarRight = [
    { time: 60_000, high: 100, low: 99, close: 99.5 },
    { time: 120_000, high: 100.1, low: 99.4, close: 99.8 },
    { time: 180_000, high: 100, low: 99.5, close: 99.7 },
  ];
  const twoBarsRight = [
    ...oneBarRight,
    { time: 240_000, high: 99.9, low: 99.3, close: 99.6 },
  ];

  assert.equal(LOCAL_WORKING_SET_POLICY["1m"].minimumRightBars, 2);
  assert.equal(structuralLocalRightEdgeMaturityDecision(oneMinute, oneBarRight).mature, false);
  assert.equal(structuralLocalWorkingSetVisible(oneMinute, ctx, oneBarRight), false);
  assert.equal(structuralLocalRightEdgeMaturityDecision(oneMinute, twoBarsRight).mature, true);
  assert.equal(structuralLocalWorkingSetVisible(oneMinute, ctx, twoBarsRight), true);
});

test("V4.17 repeated attacks bypass right-edge maturity because x2+ is already confirmed structure", () => {
  const repeated = level({
    sourceTimeframe: "1m",
    side: "HIGH",
    price: 100.1,
    extremeAt: 120_000,
    nativeExtremeAt: 120_000,
    attackCount: 2,
    sources: ["1m"],
  });
  const edge = [
    { time: 60_000, high: 100, low: 99, close: 99.5 },
    { time: 120_000, high: 100.1, low: 99.4, close: 99.8 },
  ];
  assert.equal(structuralLocalWorkingSetVisible(repeated, ctx, edge), true);
});
'''
if 'V4.17 hides unresolved single-touch native 1m pivots at the right edge' not in test_text:
    test_text += append
TEST.write_text(test_text, encoding="utf-8")
