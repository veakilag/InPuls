from pathlib import Path

path = Path('signal-lab-v7-multi-timeframe-levels.js')
text = path.read_text()

old = "    minimumRightBars: 2,\n  }),"
new = """    minimumRightBars: 2,
    // V4.22: a weaker same-side native 1m pivot formed within two bars of a
    // more extreme already-visible pivot, with no visible opposite pivot in
    // between, is a shadow duplicate rather than a new working-map level.
    sameSideShadowBars: 2,
  }),"""
if old not in text:
    raise SystemExit('V4.22 policy anchor not found')
text = text.replace(old, new, 1)

anchor = "function candleExtreme(candle, side) {\n"
helper = r'''export function filterLocalSameSideShadow(levels, viewTimeframe) {
  const source = Array.isArray(levels) ? levels.filter(Boolean) : [];
  const policy = LOCAL_WORKING_SET_POLICY[viewTimeframe];
  const shadowBars = Math.max(0, Math.round(finite(policy?.sameSideShadowBars) ?? 0));
  const intervalMs = STRUCTURAL_TF_INTERVAL_MS[viewTimeframe];
  if (!(shadowBars > 0) || !(intervalMs > 0) || !isLocalStructuralTimeframe(viewTimeframe)) {
    return Object.freeze([...source]);
  }

  const ordered = source.slice().sort((left, right) => {
    const leftAt = finite(left?.nativeExtremeAt ?? left?.extremeAt) ?? Infinity;
    const rightAt = finite(right?.nativeExtremeAt ?? right?.extremeAt) ?? Infinity;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
  });
  const maximumGapMs = shadowBars * intervalMs;
  const shadowedIds = new Set();

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    if (!current || current.active === false || current.sourceTimeframe !== viewTimeframe) continue;
    if ((Number(current.attackCount) || 1) > 1) continue;
    const currentSources = Array.isArray(current.sources) ? current.sources : [current.sourceTimeframe].filter(Boolean);
    if (currentSources.length > 1) continue;

    const currentAt = finite(current.nativeExtremeAt ?? current.extremeAt);
    const currentPrice = finite(current.price);
    if (currentAt === null || !(currentPrice > 0)) continue;

    for (let priorIndex = index - 1; priorIndex >= 0; priorIndex -= 1) {
      const prior = ordered[priorIndex];
      const priorAt = finite(prior?.nativeExtremeAt ?? prior?.extremeAt);
      if (priorAt === null) continue;
      if (currentAt - priorAt > maximumGapMs) break;
      if (prior?.active === false) continue;
      if (prior?.side !== current.side) break;
      if (prior?.sourceTimeframe !== viewTimeframe) continue;

      const priorPrice = finite(prior?.price);
      if (!(priorPrice > 0)) break;
      const priorMoreExtreme = current.side === 'HIGH'
        ? priorPrice > currentPrice
        : priorPrice < currentPrice;
      if (priorMoreExtreme && current?.id) shadowedIds.add(current.id);
      break;
    }
  }

  return Object.freeze(source.filter((level) => !shadowedIds.has(level?.id)));
}

'''
if anchor not in text:
    raise SystemExit('V4.22 helper anchor not found')
text = text.replace(anchor, helper + anchor, 1)

old_return = """  const workingHierarchy = hierarchy.filter((level) => structuralLocalWorkingSetVisible(
    level,
    volatilityByTimeframe[level?.sourceTimeframe],
    candlesByTimeframe?.[level?.sourceTimeframe] ?? [],
    { retainAsNativeFrontier: nativeFrontierIds.has(level?.id) },
  ));
  return Object.freeze(workingHierarchy);
}"""
new_return = """  const workingHierarchy = hierarchy.filter((level) => structuralLocalWorkingSetVisible(
    level,
    volatilityByTimeframe[level?.sourceTimeframe],
    candlesByTimeframe?.[level?.sourceTimeframe] ?? [],
    { retainAsNativeFrontier: nativeFrontierIds.has(level?.id) },
  ));
  const shadowFilteredHierarchy = filterLocalSameSideShadow(workingHierarchy, viewTimeframe);
  return Object.freeze(shadowFilteredHierarchy);
}"""
if old_return not in text:
    raise SystemExit('V4.22 working hierarchy anchor not found')
text = text.replace(old_return, new_return, 1)
path.write_text(text)

Path('test/signal-lab-v7-local-same-side-shadow.test.js').write_text(r'''import test from "node:test";
import assert from "node:assert/strict";

import { filterLocalSameSideShadow } from "../signal-lab-v7-multi-timeframe-levels.js";

const minute = 60_000;
const level = (id, side, price, minuteIndex, extra = {}) => ({
  id,
  side,
  price,
  extremeAt: minuteIndex * minute,
  nativeExtremeAt: minuteIndex * minute,
  sourceTimeframe: "1m",
  sources: ["1m"],
  active: true,
  attackCount: 1,
  ...extra,
});

test("V4.22 hides a weaker same-side 1m shadow within two bars", () => {
  const result = filterLocalSameSideShadow([
    level("high-0258", "HIGH", 0.0258, 3),
    level("low-01813", "LOW", 0.01813, 8),
    level("low-023", "LOW", 0.023, 10),
  ], "1m");
  assert.deepEqual(result.map((row) => row.id), ["high-0258", "low-01813"]);
});

test("V4.22 keeps a later pivot when a visible opposite pivot separates swings", () => {
  const result = filterLocalSameSideShadow([
    level("low-a", "LOW", 0.018, 8),
    level("high-between", "HIGH", 0.025, 9),
    level("low-b", "LOW", 0.023, 10),
  ], "1m");
  assert.deepEqual(result.map((row) => row.id), ["low-a", "high-between", "low-b"]);
});

test("V4.22 never hides x2 or confluence levels as shadows", () => {
  const result = filterLocalSameSideShadow([
    level("low-a", "LOW", 0.018, 8),
    level("low-x2", "LOW", 0.023, 10, { attackCount: 2 }),
    level("low-confluence", "LOW", 0.024, 10, { sources: ["1m", "5m"] }),
  ], "1m");
  assert.deepEqual(result.map((row) => row.id), ["low-a", "low-x2", "low-confluence"]);
});
''')
