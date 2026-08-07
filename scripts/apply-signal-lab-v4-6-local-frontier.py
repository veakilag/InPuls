from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one occurrence, found {count}: {old[:160]!r}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')

path = 'signal-lab-v7-multi-timeframe-levels.js'

replace_once(
    path,
    '''export const LOCAL_WORKING_SET_POLICY = Object.freeze({\n  "1m": Object.freeze({ maxDistanceBaseNatr: 6, strongSwingBaseNatr: 4 }),\n  "5m": Object.freeze({ maxDistanceBaseNatr: 10, strongSwingBaseNatr: 4 }),\n});''',
    '''export const LOCAL_WORKING_SET_POLICY = Object.freeze({\n  "1m": Object.freeze({ maxDistanceBaseNatr: 4 }),\n  "5m": Object.freeze({ maxDistanceBaseNatr: 6 }),\n});''',
)

replace_once(
    path,
    '''  const distanceBaseNatr = structuralDistanceBaseNatr(level?.price, volatilityContext);\n  if (distanceBaseNatr === null || distanceBaseNatr <= policy.maxDistanceBaseNatr) return true;\n\n  const swingPct = finite(level?.swingAmplitudePct);\n  const baseNatrPct = finite(volatilityContext?.baseNatrPct);\n  const normalizedSwing = swingPct !== null && baseNatrPct > 0 ? swingPct / baseNatrPct : null;\n  return normalizedSwing !== null && normalizedSwing >= policy.strongSwingBaseNatr;''',
    '''  const distanceBaseNatr = structuralDistanceBaseNatr(level?.price, volatilityContext);\n  if (distanceBaseNatr === null) return true;\n\n  // V4.6: a distant local-only single-touch swing is memory, not an eternal\n  // working-map ray. If it is truly macro-important it must be represented by\n  // a senior timeframe, confluence, or repeated attacks. Strong local swing\n  // magnitude alone no longer bypasses the working-area radius.\n  return distanceBaseNatr <= policy.maxDistanceBaseNatr;''',
)

replace_once(
    'test/signal-lab-v7-working-map-takeout.test.js',
    '''  assert.equal(structuralLocalWorkingSetVisible({ ...farLocal, swingAmplitudePct: 5 }, context), true);''',
    '''  assert.equal(structuralLocalWorkingSetVisible({ ...farLocal, swingAmplitudePct: 5 }, context), false);''',
)

# Focused regression: distant single-touch 5m lows are hidden, while nearby,
# confluence and repeated-attack levels remain visible.
test_path = ROOT / 'test/signal-lab-v7-local-frontier.test.js'
test_path.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_WORKING_SET_POLICY,
  structuralLocalWorkingSetVisible,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const ctx = {
  currentPrice: 100,
  baseNatrPct: 0.20,
};

function level(overrides = {}) {
  return {
    sourceTimeframe: "5m",
    side: "LOW",
    price: 99.8,
    active: true,
    attackCount: 1,
    confluenceCount: 1,
    sources: ["5m"],
    swingAmplitudePct: 1.5,
    ...overrides,
  };
}

test("V4.6 hides distant local-only single-touch 5m levels even when swing was large", () => {
  assert.equal(LOCAL_WORKING_SET_POLICY["5m"].maxDistanceBaseNatr, 6);
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 98.0 }), ctx), false);
});

test("V4.6 keeps nearby, confluence, and repeated-attack local levels", () => {
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 99.2 }), ctx), true);
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 97.0, attackCount: 2 }), ctx), true);
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 97.0, confluenceCount: 2, sources: ["1h", "5m"] }), ctx), true);
});
''', encoding='utf-8')
