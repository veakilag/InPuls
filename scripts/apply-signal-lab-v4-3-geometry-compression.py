from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:160]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_regex(path: str, pattern: str, replacement: str, label: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE | re.DOTALL)
    if count != 1:
        raise RuntimeError(f"{path}: expected one {label}, found {count}")
    target.write_text(updated, encoding="utf-8")


levels_path = "signal-lab-v7-multi-timeframe-levels.js"

# V4.3 principle: price geometry creates the extreme. Volatility adapts scale,
# but current NATR must never become a harsher filter during compression.
replace_regex(
    levels_path,
    r'// V4 calibration:[\s\S]*?export const LOCAL_HIERARCHICAL_ADMISSION = Object\.freeze\(\{[\s\S]*?\}\);',
    '''// V4.3 calibration: geometry creates a structural extreme first. Volatility\n// only adapts scale. A stable base NATR normalizes cross-asset significance and\n// distance; current NATR describes compression/expansion and may only RELAX a\n// scale requirement during compression. It never makes a nearby level harder to\n// keep merely because the spring is tightening. Numeric values remain reversible\n// calibration defaults, not a trading formula.\nexport const ADAPTIVE_HIERARCHICAL_ADMISSION = Object.freeze({\n  "1m": Object.freeze({\n    fallbackMinimumSwingPercent: 0.15,\n    reversalMultiplier: 1.00,\n    natrSwingMultiplier: 1.00,\n    freeDistanceNatr: 3,\n    maxDistanceMultiplier: 4.0,\n    minimumCompressionRelief: 0.60,\n  }),\n  "5m": Object.freeze({\n    fallbackMinimumSwingPercent: 0.18,\n    reversalMultiplier: 1.00,\n    natrSwingMultiplier: 0.90,\n    freeDistanceNatr: 4,\n    maxDistanceMultiplier: 3.5,\n    minimumCompressionRelief: 0.60,\n  }),\n  "15m": Object.freeze({\n    fallbackMinimumSwingPercent: 0,\n    reversalMultiplier: 1.00,\n    natrSwingMultiplier: 0.80,\n    freeDistanceNatr: 6,\n    maxDistanceMultiplier: 3.0,\n    minimumCompressionRelief: 0.65,\n  }),\n  "1h": Object.freeze({\n    fallbackMinimumSwingPercent: 0,\n    reversalMultiplier: 1.00,\n    natrSwingMultiplier: 0.70,\n    freeDistanceNatr: 8,\n    maxDistanceMultiplier: 2.5,\n    minimumCompressionRelief: 0.70,\n  }),\n});\n\n// Backward-compatible export name used by existing Stage-1 tests/documentation.\nexport const LOCAL_HIERARCHICAL_ADMISSION = Object.freeze({\n  "1m": Object.freeze({ minimumSwingPercent: 0.15, reversalMultiplier: 1.00 }),\n  "5m": Object.freeze({ minimumSwingPercent: 0.18, reversalMultiplier: 1.00 }),\n});''',
    "V4 admission policy block",
)

replace_once(
    levels_path,
    '''function validCandle(row) {\n  const time = finite(row?.time);\n  const high = finite(row?.high);\n  const low = finite(row?.low);\n  const close = finite(row?.close);\n  if (time === null || !(high > 0) || !(low > 0) || !(close > 0) || high < low) return null;\n  return { time, high, low, close };\n}\n\n// Standard normalized ATR context. NATR at the extreme is used to judge the\n// original swing in its own volatility regime; current NATR is used only to\n// normalize how far the level is from the current market.''',
    '''function validCandle(row) {\n  const time = finite(row?.time);\n  const high = finite(row?.high);\n  const low = finite(row?.low);\n  const close = finite(row?.close);\n  if (time === null || !(high > 0) || !(low > 0) || !(close > 0) || high < low) return null;\n  return { time, high, low, close };\n}\n\nfunction median(values) {\n  const rows = (Array.isArray(values) ? values : [])\n    .filter((value) => Number.isFinite(value) && value >= 0)\n    .slice()\n    .sort((left, right) => left - right);\n  if (!rows.length) return null;\n  const middle = Math.floor(rows.length / 2);\n  return rows.length % 2\n    ? rows[middle]\n    : (rows[middle - 1] + rows[middle]) / 2;\n}\n\n// V4.3 volatility context has two meanings:\n// - baseNatrPct: stable recent regime used for scale/distance normalization;\n// - currentNatrPct: current state used only to describe compression/expansion.\n// Historical NATR at the extreme is still retained for diagnostics.''',
)

replace_regex(
    levels_path,
    r'export function buildStructuralVolatilityContext\(candles, \{ period = 14 \} = \{\}\) \{[\s\S]*?\n\}\n\nexport function structuralNatrAt',
    '''export function buildStructuralVolatilityContext(candles, { period = 14, baseWindow = 96 } = {}) {\n  const rows = (Array.isArray(candles) ? candles : [])\n    .map(validCandle)\n    .filter(Boolean)\n    .sort((left, right) => left.time - right.time);\n  if (!rows.length) {\n    return Object.freeze({\n      period,\n      baseWindow,\n      currentPrice: null,\n      currentNatrPct: null,\n      baseNatrPct: null,\n      compressionRatio: null,\n      volatilityState: "UNKNOWN",\n      times: Object.freeze([]),\n      natrs: Object.freeze([]),\n    });\n  }\n\n  const safePeriod = Math.max(1, Math.round(finite(period) ?? 14));\n  const safeBaseWindow = Math.max(safePeriod, Math.round(finite(baseWindow) ?? 96));\n  const times = [];\n  const natrs = [];\n  let previousClose = null;\n  let atr = null;\n  let seedTotal = 0;\n  let seedCount = 0;\n\n  for (const row of rows) {\n    const range = row.high - row.low;\n    const trueRange = previousClose === null\n      ? range\n      : Math.max(range, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose));\n\n    if (seedCount < safePeriod) {\n      seedTotal += trueRange;\n      seedCount += 1;\n      atr = seedTotal / seedCount;\n    } else {\n      atr = ((atr * (safePeriod - 1)) + trueRange) / safePeriod;\n    }\n\n    times.push(row.time);\n    natrs.push(atr > 0 ? (atr / row.close) * 100 : 0);\n    previousClose = row.close;\n  }\n\n  const currentNatrPct = natrs.at(-1) ?? null;\n  const baseNatrPct = median(natrs.slice(-safeBaseWindow));\n  const compressionRatio = currentNatrPct !== null && baseNatrPct > 0\n    ? currentNatrPct / baseNatrPct\n    : null;\n  const volatilityState = compressionRatio === null\n    ? "UNKNOWN"\n    : compressionRatio < 0.75\n      ? "COMPRESSION"\n      : compressionRatio > 1.35\n        ? "EXPANSION"\n        : "NORMAL";\n\n  return Object.freeze({\n    period: safePeriod,\n    baseWindow: safeBaseWindow,\n    currentPrice: rows.at(-1)?.close ?? null,\n    currentNatrPct,\n    baseNatrPct,\n    compressionRatio,\n    volatilityState,\n    times: Object.freeze(times),\n    natrs: Object.freeze(natrs),\n  });\n}\n\nexport function structuralNatrAt''',
    "volatility context function",
)

replace_once(
    levels_path,
    '''export function structuralDistanceNatr(price, volatilityContext) {\n  const levelPrice = finite(price);\n  const currentPrice = finite(volatilityContext?.currentPrice);\n  const currentNatrPct = finite(volatilityContext?.currentNatrPct);\n  if (!(levelPrice > 0) || !(currentPrice > 0) || !(currentNatrPct > 0)) return null;\n  const distancePct = Math.abs(levelPrice - currentPrice) / currentPrice * 100;\n  return distancePct / currentNatrPct;\n}\n''',
    '''export function structuralDistanceNatr(price, volatilityContext) {\n  const levelPrice = finite(price);\n  const currentPrice = finite(volatilityContext?.currentPrice);\n  const currentNatrPct = finite(volatilityContext?.currentNatrPct);\n  if (!(levelPrice > 0) || !(currentPrice > 0) || !(currentNatrPct > 0)) return null;\n  const distancePct = Math.abs(levelPrice - currentPrice) / currentPrice * 100;\n  return distancePct / currentNatrPct;\n}\n\nexport function structuralDistanceBaseNatr(price, volatilityContext) {\n  const levelPrice = finite(price);\n  const currentPrice = finite(volatilityContext?.currentPrice);\n  const baseNatrPct = finite(volatilityContext?.baseNatrPct);\n  if (!(levelPrice > 0) || !(currentPrice > 0) || !(baseNatrPct > 0)) return null;\n  const distancePct = Math.abs(levelPrice - currentPrice) / currentPrice * 100;\n  return distancePct / baseNatrPct;\n}\n''',
)

replace_regex(
    levels_path,
    r'function adaptiveDistanceMultiplier\(policy, distanceNatr\) \{[\s\S]*?export function structuralChildLevelSignificant',
    '''function adaptiveDistanceMultiplier(policy, distanceNatr) {\n  const distance = Math.max(0, finite(distanceNatr) ?? 0);\n  const free = Math.max(0.1, finite(policy?.freeDistanceNatr) ?? 1);\n  const maximum = Math.max(1, finite(policy?.maxDistanceMultiplier) ?? 1);\n  if (distance <= free) return 1;\n  return Math.min(maximum, 1 + ((distance - free) / free));\n}\n\nfunction compressionReliefFactor(policy, volatilityContext) {\n  const ratio = finite(volatilityContext?.compressionRatio);\n  if (!(ratio > 0) || ratio >= 1) return 1;\n  const floor = Math.max(0.25, Math.min(1, finite(policy?.minimumCompressionRelief) ?? 0.60));\n  return Math.max(floor, Math.min(1, Math.sqrt(ratio)));\n}\n\nexport function hierarchicalAdmissionRequiredPercent(extreme, sourceTimeframe, {\n  volatilityContext = null,\n} = {}) {\n  const policy = ADAPTIVE_HIERARCHICAL_ADMISSION[sourceTimeframe];\n  if (!policy) return 0;\n\n  const reversalThreshold = Math.max(0, finite(extreme?.reversalThresholdPct) ?? 0);\n  const fallbackMinimum = Math.max(0, finite(policy.fallbackMinimumSwingPercent) ?? 0);\n  const reversalRequirement = reversalThreshold * Math.max(0, finite(policy.reversalMultiplier) ?? 0);\n  const geometryRequirement = Math.max(fallbackMinimum, reversalRequirement);\n\n  const baseNatrPct = finite(volatilityContext?.baseNatrPct);\n  const natrAtExtreme = structuralNatrAt(volatilityContext, extreme?.extremeAt);\n  const scaleNatrPct = baseNatrPct ?? natrAtExtreme;\n  const distanceBaseNatr = structuralDistanceBaseNatr(extreme?.price, volatilityContext);\n  const distanceMultiplier = adaptiveDistanceMultiplier(policy, distanceBaseNatr);\n  const compressionRelief = compressionReliefFactor(policy, volatilityContext);\n  const scaleRequirement = scaleNatrPct !== null && scaleNatrPct > 0\n    ? scaleNatrPct\n      * Math.max(0, finite(policy.natrSwingMultiplier) ?? 0)\n      * distanceMultiplier\n      * compressionRelief\n    : 0;\n\n  return Math.max(geometryRequirement, scaleRequirement);\n}\n\nexport function structuralChildAdmissionDecision(extreme, sourceTimeframe, {\n  volatilityContext = null,\n} = {}) {\n  if (!isAdaptiveStructuralTimeframe(sourceTimeframe)) {\n    return Object.freeze({ admitted: true, reason: "SENIOR_TIMEFRAME" });\n  }\n\n  const swingPct = finite(extreme?.swingAmplitudePct);\n  if (swingPct === null) {\n    return Object.freeze({ admitted: true, reason: "MISSING_SWING_DIAGNOSTIC" });\n  }\n\n  const natrAtExtreme = structuralNatrAt(volatilityContext, extreme?.extremeAt);\n  if (natrAtExtreme === null && !isLocalStructuralTimeframe(sourceTimeframe)) {\n    return Object.freeze({\n      admitted: true,\n      reason: "NATR_UNAVAILABLE_KEEP_LEGACY",\n      swingPct,\n    });\n  }\n\n  const policy = ADAPTIVE_HIERARCHICAL_ADMISSION[sourceTimeframe];\n  const currentNatrPct = finite(volatilityContext?.currentNatrPct);\n  const baseNatrPct = finite(volatilityContext?.baseNatrPct);\n  const compressionRatio = finite(volatilityContext?.compressionRatio);\n  const volatilityState = volatilityContext?.volatilityState ?? "UNKNOWN";\n  const currentDistanceNatr = structuralDistanceNatr(extreme?.price, volatilityContext);\n  const distanceBaseNatr = structuralDistanceBaseNatr(extreme?.price, volatilityContext);\n  const distanceMultiplier = adaptiveDistanceMultiplier(policy, distanceBaseNatr);\n  const compressionRelief = compressionReliefFactor(policy, volatilityContext);\n  const reversalThreshold = Math.max(0, finite(extreme?.reversalThresholdPct) ?? 0);\n  const fallbackMinimum = Math.max(0, finite(policy.fallbackMinimumSwingPercent) ?? 0);\n  const reversalRequirement = reversalThreshold * Math.max(0, finite(policy.reversalMultiplier) ?? 0);\n  const geometryRequirement = Math.max(fallbackMinimum, reversalRequirement);\n  const scaleNatrPct = baseNatrPct ?? natrAtExtreme;\n  const scaleRequirement = scaleNatrPct !== null && scaleNatrPct > 0\n    ? scaleNatrPct\n      * Math.max(0, finite(policy.natrSwingMultiplier) ?? 0)\n      * distanceMultiplier\n      * compressionRelief\n    : 0;\n  const requiredSwingPct = Math.max(geometryRequirement, scaleRequirement);\n  const normalizedSwing = natrAtExtreme !== null && natrAtExtreme > 0\n    ? swingPct / natrAtExtreme\n    : null;\n  const baseNormalizedSwing = baseNatrPct !== null && baseNatrPct > 0\n    ? swingPct / baseNatrPct\n    : null;\n  const admitted = swingPct >= requiredSwingPct;\n\n  return Object.freeze({\n    admitted,\n    reason: admitted ? "GEOMETRY_SCALE_PASS" : "GEOMETRY_SCALE_FILTERED",\n    swingPct,\n    requiredSwingPct,\n    geometryRequirement,\n    scaleRequirement,\n    geometryPassed: swingPct >= geometryRequirement,\n    scalePassed: swingPct >= scaleRequirement,\n    natrAtExtreme,\n    normalizedSwing,\n    baseNatrPct,\n    baseNormalizedSwing,\n    currentNatrPct,\n    compressionRatio,\n    volatilityState,\n    compressionRelief,\n    currentDistanceNatr,\n    distanceBaseNatr,\n    // Backward-compatible diagnostic name; V4.3 intentionally means BASE-NATR distance here.\n    distanceNatr: distanceBaseNatr,\n    distanceMultiplier,\n  });\n}\n\nexport function structuralChildLevelSignificant''',
    "adaptive admission functions",
)

# Same-TF highs/lows are independent events even if prices are close. Cross-TF
# near-price levels are ownership/confluence and should not be duplicated.
replace_once(
    levels_path,
    '''function samePriceZone(left, right, options) {\n  if (!left || !right || left.side !== right.side) return false;\n  const anchor = Math.max(left.price, right.price);\n  const tolerance = levelTolerancePrice(anchor, options.tickSize, options.tolerancePct, options.toleranceTicks);\n  return Math.abs(left.price - right.price) <= tolerance;\n}\n\nfunction candleExtreme(candle, side) {''',
    '''function samePriceZone(left, right, options) {\n  if (!left || !right || left.side !== right.side) return false;\n  const anchor = Math.max(left.price, right.price);\n  const tolerance = levelTolerancePrice(anchor, options.tickSize, options.tolerancePct, options.toleranceTicks);\n  return Math.abs(left.price - right.price) <= tolerance;\n}\n\nfunction sameHierarchyZone(left, right, options) {\n  if (!samePriceZone(left, right, options)) return false;\n  if (left?.sourceTimeframe === right?.sourceTimeframe) return left?.id === right?.id;\n  return true;\n}\n\nexport function structuralHierarchyAcceptance(level, candles, {\n  tickSize = 0,\n  crossingToleranceTicks = 1,\n  acceptanceBars = 2,\n} = {}) {\n  if (!level || !["HIGH", "LOW"].includes(level.side)) return null;\n  const levelPrice = finite(level.price);\n  const originAt = finite(level.nativeExtremeAt ?? level.extremeAt);\n  if (!(levelPrice > 0) || originAt === null) return null;\n\n  const tolerance = Math.max(0, finite(tickSize) ?? 0)\n    * Math.max(0, Math.round(finite(crossingToleranceTicks) ?? 1));\n  const requiredBars = Math.max(1, Math.round(finite(acceptanceBars) ?? 2));\n  const rows = (Array.isArray(candles) ? candles : [])\n    .filter((row) => finite(row?.time) !== null)\n    .slice()\n    .sort((left, right) => Number(left.time) - Number(right.time));\n  let consecutive = 0;\n  let firstBeyondAt = null;\n\n  for (const candle of rows) {\n    const time = finite(candle?.time);\n    const closeTime = finite(candle?.closeTime) ?? time;\n    const close = finite(candle?.close);\n    if (time === null || time <= originAt || !(close > 0)) continue;\n    const beyond = level.side === "HIGH"\n      ? close > levelPrice + tolerance\n      : close < levelPrice - tolerance;\n    if (!beyond) {\n      consecutive = 0;\n      firstBeyondAt = null;\n      continue;\n    }\n    if (consecutive === 0) firstBeyondAt = closeTime;\n    consecutive += 1;\n    if (consecutive >= requiredBars) {\n      return Object.freeze({\n        at: closeTime,\n        firstBeyondAt,\n        side: level.side,\n        price: levelPrice,\n        acceptanceBars: requiredBars,\n        reason: "CHILD_TIMEFRAME_ACCEPTANCE",\n      });\n    }\n  }\n  return null;\n}\n\nfunction applyHierarchyAcceptance(levels, candles, sourceTimeframe, includeHistory, options) {\n  const next = [];\n  for (const level of Array.isArray(levels) ? levels : []) {\n    if (level?.active === false) {\n      next.push(level);\n      continue;\n    }\n    const acceptance = structuralHierarchyAcceptance(level, candles, options);\n    if (!acceptance) {\n      next.push(level);\n      continue;\n    }\n    if (!includeHistory) continue;\n    next.push(Object.freeze({\n      ...level,\n      active: false,\n      crossedAt: level.crossedAt ?? acceptance.at,\n      endAt: acceptance.at,\n      status: "ACCEPTED",\n      inactiveReason: "CHILD_TIMEFRAME_ACCEPTANCE",\n      acceptedOnTimeframe: sourceTimeframe,\n    }));\n  }\n  return next;\n}\n\nfunction candleExtreme(candle, side) {''',
)

replace_once(
    levels_path,
    '''    let cluster = clusters.find((row) => samePriceZone(row.primary, level, {\n      tickSize,\n      tolerancePct,\n      toleranceTicks,\n    }));''',
    '''    let cluster = clusters.find((row) => sameHierarchyZone(row.primary, level, {\n      tickSize,\n      tolerancePct,\n      toleranceTicks,\n    }));''',
)

replace_once(
    levels_path,
    '''  let hierarchy = [];\n  for (const sourceTimeframe of descent) {\n    const childCandles = candlesByTimeframe?.[sourceTimeframe] ?? [];\n    if (hierarchy.length) {\n      hierarchy = hierarchy.map((level) => refineStructuralLevelToTimeframe(\n        level,\n        sourceTimeframe,\n        childCandles,\n        { tickSize },\n      ));\n    }\n\n    const snapshot = snapshotsByTimeframe?.[sourceTimeframe];\n    const volatilityContext = volatilityByTimeframe[sourceTimeframe];''',
    '''  let hierarchy = [];\n  for (const sourceTimeframe of descent) {\n    const childCandles = candlesByTimeframe?.[sourceTimeframe] ?? [];\n    const snapshot = snapshotsByTimeframe?.[sourceTimeframe];\n    const volatilityContext = volatilityByTimeframe[sourceTimeframe];\n\n    if (hierarchy.length && childCandles.length) {\n      hierarchy = applyHierarchyAcceptance(\n        hierarchy,\n        childCandles,\n        sourceTimeframe,\n        includeHistory,\n        { tickSize, crossingToleranceTicks: 1, acceptanceBars: 2 },\n      );\n    }\n\n    if (hierarchy.length) {\n      hierarchy = hierarchy.map((level) => refineStructuralLevelToTimeframe(\n        level,\n        sourceTimeframe,\n        childCandles,\n        { tickSize },\n      ));\n    }''',
)

replace_once(
    levels_path,
    '''        const confirmsInheritedLevel = candidateLevel && hierarchy.some((level) => samePriceZone(\n          level,\n          candidateLevel,\n          { tickSize, tolerancePct: 0.03, toleranceTicks: 3 },\n        ));''',
    '''        const confirmsInheritedLevel = candidateLevel && hierarchy.some((level) => sameHierarchyZone(\n          level,\n          candidateLevel,\n          { tickSize, tolerancePct: 0.03, toleranceTicks: 3 },\n        ));''',
)

# Extend adaptive tests with the compression semantics that triggered V4.3.
adaptive_test = ROOT / "test/signal-lab-v7-adaptive-hierarchy.test.js"
text = adaptive_test.read_text(encoding="utf-8")
text = text.replace(
    '''  structuralChildAdmissionDecision,\n  structuralDistanceNatr,''',
    '''  structuralChildAdmissionDecision,\n  structuralDistanceBaseNatr,\n  structuralDistanceNatr,''',
    1,
)
marker = 'test("V4.3 current NATR compression relaxes scale but never hardens distance"'
if marker not in text:
    text += r'''

test("V4.3 current NATR compression relaxes scale but never hardens distance", () => {
  const start = END - 120 * MINUTE;
  const rows = Array.from({ length: 120 }, (_, index) => {
    const compressed = index >= 106;
    const halfRange = compressed ? 0.05 : 0.25;
    return {
      time: start + index * MINUTE,
      open: 100,
      high: 100 + halfRange,
      low: 100 - halfRange,
      close: 100,
      closeTime: start + index * MINUTE + MINUTE - 1,
    };
  });
  const context = buildStructuralVolatilityContext(rows);
  const candidate = extreme({
    id: "compression-high",
    side: "HIGH",
    price: 100.1,
    swingAmplitudePct: 0.32,
    reversalThresholdPct: 0.10,
  });
  const decision = structuralChildAdmissionDecision(candidate, "1m", { volatilityContext: context });

  assert.equal(context.volatilityState, "COMPRESSION");
  assert.ok(context.currentNatrPct < context.baseNatrPct);
  assert.ok(context.compressionRatio < 1);
  assert.equal(decision.admitted, true);
  assert.ok(decision.compressionRelief < 1);
  assert.equal(decision.distanceNatr, decision.distanceBaseNatr);
  assert.ok(structuralDistanceNatr(candidate.price, context) > structuralDistanceBaseNatr(candidate.price, context));
});
'''
adaptive_test.write_text(text, encoding="utf-8")

# Extend hierarchy tests for same-TF independence and child-TF acceptance.
levels_test = ROOT / "test/signal-lab-v7-multi-timeframe-levels.test.js"
text = levels_test.read_text(encoding="utf-8")
text = text.replace(
    '''  structuralExtremeSupersession,\n  structuralLevelLabel,''',
    '''  structuralExtremeSupersession,\n  structuralHierarchyAcceptance,\n  structuralLevelLabel,''',
    1,
)
marker = 'test("V4.3 keeps nearby same-timeframe highs as separate structural events"'
if marker not in text:
    text += r'''

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
'''
levels_test.write_text(text, encoding="utf-8")

# Keep the calibration docs explicit about semantics, not a price prediction.
doc = ROOT / "docs/signal-lab-v7-structural-extremes-stage1.md"
if doc.exists():
    text = doc.read_text(encoding="utf-8")
    marker = "## V4.3 — geometry first, compression aware"
    if marker not in text:
        text += '''\n\n## V4.3 — geometry first, compression aware\n\n- Экстремум сначала определяется геометрией цены и подтверждённым reversal; NATR не создаёт и не отменяет экстремум сам по себе.\n- `baseNatrPct` (median recent NATR) нормализует масштаб монеты и расстояние уровня до текущей цены.\n- `currentNatrPct / baseNatrPct` описывает `COMPRESSION / NORMAL / EXPANSION`; compression может только смягчить scale-admission, но не сделать его жёстче.\n- Близкие экстремумы одного TF не схлопываются в один уровень. Близкий младший TF к старшему остаётся ownership/confluence старшего уровня.\n- Унаследованный старший уровень снимается на младшем TF только после двух последовательных закрытий за уровнем (`CHILD_TIMEFRAME_ACCEPTANCE`); одиночный wick/pierce не является финальным пробоем.\n- Detector/history и точный подсчёт атак ×N не изменены; V4.3 меняет только hierarchical map/calibration semantics.\n'''
        doc.write_text(text, encoding="utf-8")
