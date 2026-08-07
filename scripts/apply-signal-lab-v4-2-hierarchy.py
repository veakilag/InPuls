from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:160]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


levels_path = "signal-lab-v7-multi-timeframe-levels.js"

# 1) Let NATR do the real cross-asset normalization on 5m. The old 0.45% hard floor
# was dominating calm BTC and deleting structurally valid local highs/lows.
replace_once(
    levels_path,
    '''  "5m": Object.freeze({\n    fallbackMinimumSwingPercent: 0.45,\n    reversalMultiplier: 1.55,\n    natrSwingMultiplier: 0.90,''',
    '''  "5m": Object.freeze({\n    fallbackMinimumSwingPercent: 0.18,\n    reversalMultiplier: 1.10,\n    natrSwingMultiplier: 0.90,''',
)
replace_once(
    levels_path,
    '''  "5m": Object.freeze({ minimumSwingPercent: 0.45, reversalMultiplier: 1.55 }),''',
    '''  "5m": Object.freeze({ minimumSwingPercent: 0.18, reversalMultiplier: 1.10 }),''',
)

# 2) Confluence means the same structural origin, not merely a nearby price.
# Same-TF siblings and later child-TF extrema near a senior level must stay separate.
replace_once(
    levels_path,
    '''function samePriceZone(left, right, options) {\n  if (!left || !right || left.side !== right.side) return false;\n  const anchor = Math.max(left.price, right.price);\n  const tolerance = levelTolerancePrice(anchor, options.tickSize, options.tolerancePct, options.toleranceTicks);\n  return Math.abs(left.price - right.price) <= tolerance;\n}\n\nfunction candleExtreme(candle, side) {''',
    '''function samePriceZone(left, right, options) {\n  if (!left || !right || left.side !== right.side) return false;\n  const anchor = Math.max(left.price, right.price);\n  const tolerance = levelTolerancePrice(anchor, options.tickSize, options.tolerancePct, options.toleranceTicks);\n  return Math.abs(left.price - right.price) <= tolerance;\n}\n\nfunction structuralOriginTime(level) {\n  return finite(level?.displayAt ?? level?.extremeAt ?? level?.nativeExtremeAt);\n}\n\nfunction sameStructuralOriginZone(left, right, options) {\n  if (!samePriceZone(left, right, options)) return false;\n  if (left?.sourceTimeframe === right?.sourceTimeframe) return left?.id === right?.id;\n\n  const leftStrength = STRUCTURAL_TF_STRENGTH[left?.sourceTimeframe] ?? 0;\n  const rightStrength = STRUCTURAL_TF_STRENGTH[right?.sourceTimeframe] ?? 0;\n  const senior = leftStrength >= rightStrength ? left : right;\n  const junior = senior === left ? right : left;\n  const seniorAt = structuralOriginTime(senior);\n  const juniorAt = structuralOriginTime(junior);\n  const juniorInterval = STRUCTURAL_TF_INTERVAL_MS[junior?.sourceTimeframe] ?? 0;\n  if (seniorAt === null || juniorAt === null || !(juniorInterval > 0)) return false;\n\n  // The senior level has already been refined down before the junior is admitted.\n  // A junior candle around that refined timestamp is the same structural origin.\n  // A later nearby local high/low is a separate event and must not be swallowed.\n  return Math.abs(juniorAt - seniorAt) <= juniorInterval;\n}\n\nexport function structuralHierarchySupersession(level, snapshot, sourceTimeframe, {\n  volatilityContext = null,\n  tickSize = 0,\n  tolerancePct = 0.03,\n  toleranceTicks = 3,\n} = {}) {\n  if (!level || !["HIGH", "LOW"].includes(level.side)) return null;\n  const levelPrice = finite(level.price);\n  const levelAt = structuralOriginTime(level);\n  if (!(levelPrice > 0) || levelAt === null) return null;\n\n  const rows = [\n    ...(Array.isArray(snapshot?.history) ? snapshot.history : []),\n    ...(Array.isArray(snapshot?.active) ? snapshot.active : []),\n  ];\n  const seen = new Set();\n  let winner = null;\n  const tolerance = levelTolerancePrice(levelPrice, tickSize, tolerancePct, toleranceTicks);\n\n  for (const candidate of rows) {\n    const key = candidate?.id ?? `${candidate?.side}:${candidate?.extremeAt}:${candidate?.price}`;\n    if (seen.has(key)) continue;\n    seen.add(key);\n    if (!candidate || candidate.side !== level.side) continue;\n\n    const candidateAt = finite(candidate.extremeAt);\n    const candidatePrice = finite(candidate.price);\n    if (candidateAt === null || candidateAt <= levelAt || !(candidatePrice > 0)) continue;\n    if (isAdaptiveStructuralTimeframe(sourceTimeframe)\n      && !structuralChildLevelSignificant(candidate, sourceTimeframe, { volatilityContext })) continue;\n\n    const beyond = level.side === "HIGH"\n      ? candidatePrice > levelPrice + tolerance\n      : candidatePrice < levelPrice - tolerance;\n    if (!beyond) continue;\n\n    const confirmedAt = finite(candidate.confirmedAt) ?? candidateAt;\n    if (!winner || confirmedAt < winner.at) {\n      winner = Object.freeze({\n        at: confirmedAt,\n        extremeAt: candidateAt,\n        price: candidatePrice,\n        extremeId: candidate.id ?? null,\n        side: candidate.side,\n        sourceTimeframe,\n        reason: "HIERARCHICAL_SUPERSESSION",\n      });\n    }\n  }\n  return winner;\n}\n\nfunction applyHierarchySupersession(levels, snapshot, sourceTimeframe, includeHistory, options) {\n  const next = [];\n  for (const level of Array.isArray(levels) ? levels : []) {\n    if (level?.active === false) {\n      next.push(level);\n      continue;\n    }\n    const supersession = structuralHierarchySupersession(level, snapshot, sourceTimeframe, options);\n    if (!supersession) {\n      next.push(level);\n      continue;\n    }\n    if (!includeHistory) continue;\n    next.push(Object.freeze({\n      ...level,\n      active: false,\n      crossedAt: level.crossedAt ?? supersession.at,\n      structurallySuperseded: true,\n      inactiveReason: "HIERARCHICAL_SUPERSESSION",\n      endAt: supersession.at,\n      status: "SUPERSEDED",\n    }));\n  }\n  return next;\n}\n\nfunction candleExtreme(candle, side) {''',
)

replace_once(
    levels_path,
    '''    let cluster = clusters.find((row) => samePriceZone(row.primary, level, {\n      tickSize,\n      tolerancePct,\n      toleranceTicks,\n    }));''',
    '''    let cluster = clusters.find((row) => sameStructuralOriginZone(row.primary, level, {\n      tickSize,\n      tolerancePct,\n      toleranceTicks,\n    }));''',
)

# 3) Retire a senior inherited level when a later meaningful child-TF extreme has
# structurally gone beyond it. This fixes HFT levels that remained visible only
# because old supersession looked inside the same native timeframe.
replace_once(
    levels_path,
    '''  let hierarchy = [];\n  for (const sourceTimeframe of descent) {\n    const childCandles = candlesByTimeframe?.[sourceTimeframe] ?? [];\n    if (hierarchy.length) {\n      hierarchy = hierarchy.map((level) => refineStructuralLevelToTimeframe(\n        level,\n        sourceTimeframe,\n        childCandles,\n        { tickSize },\n      ));\n    }\n\n    const snapshot = snapshotsByTimeframe?.[sourceTimeframe];\n    const volatilityContext = volatilityByTimeframe[sourceTimeframe];''',
    '''  let hierarchy = [];\n  for (const sourceTimeframe of descent) {\n    const childCandles = candlesByTimeframe?.[sourceTimeframe] ?? [];\n    const snapshot = snapshotsByTimeframe?.[sourceTimeframe];\n    const volatilityContext = volatilityByTimeframe[sourceTimeframe];\n\n    if (hierarchy.length && snapshot) {\n      hierarchy = applyHierarchySupersession(\n        hierarchy,\n        snapshot,\n        sourceTimeframe,\n        includeHistory,\n        { volatilityContext, tickSize },\n      );\n    }\n\n    if (hierarchy.length) {\n      hierarchy = hierarchy.map((level) => refineStructuralLevelToTimeframe(\n        level,\n        sourceTimeframe,\n        childCandles,\n        { tickSize },\n      ));\n    }''',
)

replace_once(
    levels_path,
    '''        const confirmsInheritedLevel = candidateLevel && hierarchy.some((level) => samePriceZone(\n          level,\n          candidateLevel,\n          { tickSize, tolerancePct: 0.03, toleranceTicks: 3 },\n        ));''',
    '''        const confirmsInheritedLevel = candidateLevel && hierarchy.some((level) => sameStructuralOriginZone(\n          level,\n          candidateLevel,\n          { tickSize, tolerancePct: 0.03, toleranceTicks: 3 },\n        ));''',
)

# Tests: import new helpers.
test_path = ROOT / "test/signal-lab-v7-multi-timeframe-levels.test.js"
test_text = test_path.read_text(encoding="utf-8")
test_text = test_text.replace(
    '''  buildHierarchicalStructuralLevelMap,\n  buildStructuralLevelMap,''',
    '''  buildHierarchicalStructuralLevelMap,\n  buildStructuralLevelMap,\n  buildStructuralVolatilityContext,''',
    1,
)
test_text = test_text.replace(
    '''  structuralExtremeSupersession,\n  structuralLevelLabel,''',
    '''  structuralExtremeSupersession,\n  structuralHierarchySupersession,\n  structuralLevelLabel,''',
    1,
)
marker = 'test("V4.2 keeps calm-market 5m structure while high-NATR noise stays filtered"'
if marker not in test_text:
    test_text += r'''

test("V4.2 keeps calm-market 5m structure while high-NATR noise stays filtered", () => {
  const start = END - 30 * 5 * 60_000;
  const calmCandles = Array.from({ length: 30 }, (_, index) => ({
    time: start + index * 5 * 60_000,
    high: 100.05,
    low: 99.95,
    open: 100,
    close: 100,
  }));
  const hotCandles = Array.from({ length: 30 }, (_, index) => ({
    time: start + index * 5 * 60_000,
    high: 102,
    low: 98,
    open: 100,
    close: 100,
  }));
  const sample = extreme({
    id: "btc-local-5m",
    side: "HIGH",
    price: 100.2,
    extremeAt: END - 10 * 60_000,
    swingAmplitudePct: 0.22,
    reversalThresholdPct: 0.18,
  });

  assert.equal(structuralChildLevelSignificant(sample, "5m", {
    volatilityContext: buildStructuralVolatilityContext(calmCandles),
  }), true);
  assert.equal(structuralChildLevelSignificant(sample, "5m", {
    volatilityContext: buildStructuralVolatilityContext(hotCandles),
  }), false);
});

test("V4.2 does not collapse separate same-timeframe nearby highs", () => {
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

test("V4.2 keeps a later junior high separate from a nearby senior high", () => {
  const senior = normalizeStructuralLevel(extreme({
    id: "4h-high",
    side: "HIGH",
    price: 100,
    extremeAt: END - 4 * 60 * 60_000,
  }), "4h", END);
  const laterJunior = normalizeStructuralLevel(extreme({
    id: "5m-later-high",
    side: "HIGH",
    price: 100.01,
    extremeAt: END - 60 * 60_000,
  }), "5m", END);
  const clustered = clusterStructuralLevels([senior, laterJunior], {
    tickSize: 0.01,
    tolerancePct: 0.03,
    toleranceTicks: 3,
  });
  assert.equal(clustered.length, 2);
});

test("V4.2 child timeframe can structurally retire a passed senior level", () => {
  const seniorHigh = extreme({
    id: "senior-high",
    side: "HIGH",
    price: 100,
    extremeAt: END - 8 * 60 * 60_000,
    confirmedAt: END - 7 * 60 * 60_000,
  });
  const childHigh = extreme({
    id: "child-high",
    side: "HIGH",
    price: 105,
    extremeAt: END - 2 * 60 * 60_000,
    confirmedAt: END - 119 * 60_000,
    swingAmplitudePct: 2,
    reversalThresholdPct: 0.18,
  });
  const normalizedSenior = normalizeStructuralLevel(seniorHigh, "4h", END);
  const supersession = structuralHierarchySupersession(
    normalizedSenior,
    { active: [childHigh], history: [childHigh] },
    "5m",
    { tickSize: 0.01 },
  );
  assert.equal(supersession?.extremeId, "child-high");
  assert.equal(supersession?.reason, "HIERARCHICAL_SUPERSESSION");

  const levels = buildHierarchicalStructuralLevelMap({
    snapshotsByTimeframe: {
      "1d": { active: [], history: [] },
      "4h": { active: [seniorHigh], history: [seniorHigh] },
      "1h": { active: [], history: [] },
      "15m": { active: [], history: [] },
      "5m": { active: [childHigh], history: [childHigh] },
    },
    candlesByTimeframe: { "1d": [], "4h": [], "1h": [], "15m": [], "5m": [] },
    viewTimeframe: "5m",
    endAt: END,
    tickSize: 0.01,
  });
  assert.equal(levels.some((row) => row.id === "senior-high"), false);
  assert.equal(levels.some((row) => row.id === "child-high"), true);
});
'''

test_path.write_text(test_text, encoding="utf-8")
