from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "signal-lab-v7-multi-timeframe-levels.js"
TEST = ROOT / "test/signal-lab-v7-local-frontier.test.js"

text = TARGET.read_text(encoding="utf-8")

old_sig = 'export function structuralLocalWorkingSetVisible(level, volatilityContext, candles = []) {'
new_sig = '''export function structuralLocalWorkingSetVisible(level, volatilityContext, candles = [], {
  retainAsNativeFrontier = false,
} = {}) {'''
if old_sig not in text:
    raise SystemExit("working-set signature anchor not found")
text = text.replace(old_sig, new_sig, 1)

old_after_pivot = '''  const pivotDecision = structuralLocalWorkingSetPivotDecision(level, candles, volatilityContext);
  if (!pivotDecision.visible) return false;

  // V4.15: child confluence is allowed to retain a VALID local pivot outside'''
new_after_pivot = '''  const pivotDecision = structuralLocalWorkingSetPivotDecision(level, candles, volatilityContext);
  if (!pivotDecision.visible) return false;

  // V4.16: the latest ACTIVE native local HIGH/LOW is the current structural
  // frontier for that view timeframe. It must still pass source-TF pivot quality
  // above, but a volatility expansion must not hide it merely because the stable
  // base-NATR distance radius became small relative to the move.
  if (retainAsNativeFrontier) return true;

  // V4.15: child confluence is allowed to retain a VALID local pivot outside'''
if old_after_pivot not in text:
    raise SystemExit("post-pivot anchor not found")
text = text.replace(old_after_pivot, new_after_pivot, 1)

old_working = '''  const workingHierarchy = hierarchy.filter((level) => structuralLocalWorkingSetVisible(
    level,
    volatilityByTimeframe[level?.sourceTimeframe],
    candlesByTimeframe?.[level?.sourceTimeframe] ?? [],
  ));
  return Object.freeze(workingHierarchy);'''
new_working = '''  // V4.16: preserve exactly one latest ACTIVE native frontier per side on local
  // views. This is intentionally NOT a global distance bypass: older local rays
  // still obey the working-set radius, and filtered pivots remain filtered.
  const nativeFrontierIds = new Set();
  if (isLocalStructuralTimeframe(viewTimeframe)) {
    for (const side of ["HIGH", "LOW"]) {
      let latest = null;
      let latestAt = -Infinity;
      for (const level of hierarchy) {
        if (level?.active === false || level?.side !== side) continue;
        if (level?.sourceTimeframe !== viewTimeframe) continue;
        const at = finite(level?.nativeExtremeAt ?? level?.extremeAt);
        if (at === null || at < latestAt) continue;
        latest = level;
        latestAt = at;
      }
      if (latest?.id) nativeFrontierIds.add(latest.id);
    }
  }

  const workingHierarchy = hierarchy.filter((level) => structuralLocalWorkingSetVisible(
    level,
    volatilityByTimeframe[level?.sourceTimeframe],
    candlesByTimeframe?.[level?.sourceTimeframe] ?? [],
    { retainAsNativeFrontier: nativeFrontierIds.has(level?.id) },
  ));
  return Object.freeze(workingHierarchy);'''
if old_working not in text:
    raise SystemExit("working hierarchy anchor not found")
text = text.replace(old_working, new_working, 1)
TARGET.write_text(text, encoding="utf-8")

test_text = TEST.read_text(encoding="utf-8")
append = '''\n\ntest("V4.16 retains the latest valid native 1m frontier outside distance radius without widening all locals", () => {\n  const oneMinute = level({\n    sourceTimeframe: "1m",\n    side: "HIGH",\n    price: 102.0,\n    sources: ["1m"],\n    confluenceCount: 1,\n  });\n  assert.equal(structuralLocalWorkingSetVisible(oneMinute, ctx), false);\n  assert.equal(structuralLocalWorkingSetVisible(oneMinute, ctx, [], { retainAsNativeFrontier: true }), true);\n});\n'''
if 'V4.16 retains the latest valid native 1m frontier' not in test_text:
    test_text += append
TEST.write_text(test_text, encoding="utf-8")
