from pathlib import Path

levels_path = Path('signal-lab-v7-multi-timeframe-levels.js')
text = levels_path.read_text()

text = text.replace(
'''export const LOCAL_TRADABLE_STRUCTURE_POLICY = Object.freeze({\n  "1m": Object.freeze({ minimumLegResetRatio: 0.30, maxAnchorBars: 60 }),\n  "5m": Object.freeze({ minimumLegResetRatio: 0.30, maxAnchorBars: 24 }),\n});''',
'''export const LOCAL_TRADABLE_STRUCTURE_POLICY = Object.freeze({\n  "1m": Object.freeze({ minimumLegResetRatio: 0.30 }),\n  "5m": Object.freeze({ minimumLegResetRatio: 0.30 }),\n});'''
)

old_expiry = '''  const anchorBars = (currentAt - priorAt) / intervalMs;\n  const maxAnchorBars = Math.max(1, Math.round(finite(policy.maxAnchorBars) ?? 1));\n  if (anchorBars > maxAnchorBars) {\n    return Object.freeze({\n      qualified: true,\n      reason: "TREND_LEG_ANCHOR_EXPIRED",\n      anchorBars,\n      maxAnchorBars,\n    });\n  }\n'''
new_expiry = '''  // V5.1: a directional leg does not expire because a fixed number of candles\n  // elapsed. The same-side structural anchor remains valid until price itself\n  // produces a meaningful reset/new structure. This prevents a long smooth trend\n  // from restarting the noise ladder every N bars.\n  const anchorBars = (currentAt - priorAt) / intervalMs;\n'''
if old_expiry not in text:
    raise SystemExit('V5.1 expiry anchor not found')
text = text.replace(old_expiry, new_expiry, 1)
text = text.replace('      maxAnchorBars,\n', '')
text = text.replace('    maxAnchorBars,\n', '')

old_native = '''    const nativeCandidates = normalizedSourceLevels(\n      snapshot,\n      sourceTimeframe,\n      endAt,\n      includeHistory,\n      (extreme) => {'''
new_native = '''    const rawNativeCandidates = normalizedSourceLevels(\n      snapshot,\n      sourceTimeframe,\n      endAt,\n      includeHistory,\n      (extreme) => {'''
if old_native not in text:
    raise SystemExit('V5.1 native candidates anchor not found')
text = text.replace(old_native, new_native, 1)

old_after_native = '''      },\n    );\n\n    // A lower-TF level near an inherited stronger level is confluence/refinement,\n    // not a new independent line. Clustering keeps the native label of the older\n    // stronger timeframe.\n    hierarchy = [...clusterStructuralLevels([...hierarchy, ...nativeCandidates], { tickSize })];'''
new_after_native = '''      },\n    );\n\n    // V5.1: qualify each native source timeframe BEFORE hierarchy/clustering.\n    // A weak 5m continuation pivot must not become immune merely because it later\n    // clusters into a senior-owned/confluent level. Detector/history remain recall-first.\n    const nativeCandidates = filterLocalTradableStructure(\n      rawNativeCandidates,\n      sourceTimeframe,\n      childCandles,\n    );\n\n    // A lower-TF level near an inherited stronger level is confluence/refinement,\n    // not a new independent line. Clustering keeps the native label of the older\n    // stronger timeframe.\n    hierarchy = [...clusterStructuralLevels([...hierarchy, ...nativeCandidates], { tickSize })];'''
if old_after_native not in text:
    raise SystemExit('V5.1 post-native anchor not found')
text = text.replace(old_after_native, new_after_native, 1)

old_final = '''  const shadowFilteredHierarchy = filterLocalSameSideShadow(workingHierarchy, viewTimeframe);\n  const tradableHierarchy = filterLocalTradableStructure(\n    shadowFilteredHierarchy,\n    viewTimeframe,\n    candlesByTimeframe?.[viewTimeframe] ?? [],\n  );\n  return Object.freeze(tradableHierarchy);'''
new_final = '''  const shadowFilteredHierarchy = filterLocalSameSideShadow(workingHierarchy, viewTimeframe);\n  // V5.1 qualification already happened on the native source timeframe before\n  // clustering. Do not re-run it here on senior-owned/confluent display objects.\n  return Object.freeze(shadowFilteredHierarchy);'''
if old_final not in text:
    raise SystemExit('V5.1 final post-cluster anchor not found')
text = text.replace(old_final, new_final, 1)

levels_path.write_text(text)

test_path = Path('test/signal-lab-v7-tradable-structure-v5.test.js')
test_text = test_path.read_text()
old_test = '''test("V5 expires an old same-side anchor instead of connecting unrelated regimes", () => {\n  const prior = level("low-old", "LOW", 100, 0);\n  const current = level("low-new", "LOW", 109, 61);\n  const decision = structuralTrendLegQualificationDecision(current, prior, "1m", [\n    candle(60, 110, 108), candle(61, 110, 109),\n  ]);\n  assert.equal(decision.qualified, true);\n  assert.equal(decision.reason, "TREND_LEG_ANCHOR_EXPIRED");\n});'''
new_test = '''test("V5.1 keeps a same-side leg anchor alive across a long smooth trend", () => {\n  const prior = level("low-old", "LOW", 100, 0);\n  const current = level("low-new", "LOW", 109, 61);\n  const decision = structuralTrendLegQualificationDecision(current, prior, "1m", [\n    candle(30, 106, 103), candle(60, 110, 108), candle(61, 110, 109),\n  ]);\n  assert.equal(decision.qualified, false);\n  assert.equal(decision.reason, "TREND_LEG_SHALLOW_CONTINUATION_FILTERED");\n  assert.equal(decision.anchorBars, 61);\n  assert.ok(decision.resetRatio < 0.30);\n});'''
if old_test not in test_text:
    raise SystemExit('V5.1 old expiry test not found')
test_text = test_text.replace(old_test, new_test, 1)

test_text += '''\n\ntest("V5.1 filters a native 5m staircase before it can become hierarchy noise", () => {\n  const five = 5 * minute;\n  const native = (id, price, index) => ({\n    id,\n    side: "LOW",\n    price,\n    extremeAt: index * five,\n    nativeExtremeAt: index * five,\n    displayAt: index * five,\n    sourceTimeframe: "5m",\n    sources: ["5m"],\n    refinedThroughTimeframe: "5m",\n    refinementPath: [{ timeframe: "5m", time: index * five }],\n    active: true,\n    attackCount: 1,\n  });\n  const rows = [\n    { time: 1 * five, high: 104, low: 101, close: 103 },\n    { time: 2 * five, high: 108, low: 103, close: 107 },\n    { time: 3 * five, high: 110, low: 106, close: 109 },\n    { time: 4 * five, high: 110, low: 107, close: 109 },\n    { time: 5 * five, high: 110, low: 108, close: 109 },\n    { time: 6 * five, high: 111, low: 108.5, close: 110 },\n  ];\n  const result = filterLocalTradableStructure([\n    native("base", 100, 0),\n    native("step-1", 108, 5),\n    native("step-2", 108.5, 6),\n  ], "5m", rows);\n  assert.deepEqual(result.map((row) => row.id), ["base"]);\n});\n'''
test_path.write_text(test_text)
