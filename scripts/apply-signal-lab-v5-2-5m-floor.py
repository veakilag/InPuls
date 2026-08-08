from pathlib import Path

levels_path = Path('signal-lab-v7-multi-timeframe-levels.js')
levels = levels_path.read_text()

old_orders = '''export const STRUCTURAL_TF_ORDER = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);\nexport const STRUCTURAL_TF_DESCENT_ORDER = Object.freeze(["1d", "4h", "1h", "15m", "5m", "1m"]);\n'''
new_orders = '''export const STRUCTURAL_TF_ORDER = Object.freeze(["1m", "5m", "15m", "1h", "4h", "1d"]);\nexport const STRUCTURAL_TF_DESCENT_ORDER = Object.freeze(["1d", "4h", "1h", "15m", "5m", "1m"]);\n\n// V5.2 product contract: 1m remains a chart/micro-context timeframe only.\n// Persistent structural levels and future pattern formation start at 5m.\n// Keep the legacy six-TF constants above for engine/backward compatibility,\n// but hierarchy source selection must never admit native 1m extrema.\nexport const STRUCTURAL_PERSISTENT_TF_ORDER = Object.freeze(["5m", "15m", "1h", "4h", "1d"]);\nexport const STRUCTURAL_PERSISTENT_TF_DESCENT_ORDER = Object.freeze(["1d", "4h", "1h", "15m", "5m"]);\n'''
if old_orders not in levels:
    raise SystemExit('timeframe order block not found')
levels = levels.replace(old_orders, new_orders, 1)

old_helpers = '''export function visibleSourceTimeframes(viewTimeframe) {\n  const index = STRUCTURAL_TF_ORDER.indexOf(String(viewTimeframe));\n  if (index < 0) return Object.freeze([]);\n  return Object.freeze(STRUCTURAL_TF_ORDER.slice(index));\n}\n\nexport function hierarchicalDescentTimeframes(viewTimeframe) {\n  const index = STRUCTURAL_TF_DESCENT_ORDER.indexOf(String(viewTimeframe));\n  if (index < 0) return Object.freeze([]);\n  return Object.freeze(STRUCTURAL_TF_DESCENT_ORDER.slice(0, index + 1));\n}\n'''
new_helpers = '''export function visibleSourceTimeframes(viewTimeframe) {\n  const view = String(viewTimeframe);\n  if (view === "1m") return Object.freeze([...STRUCTURAL_PERSISTENT_TF_ORDER]);\n  const index = STRUCTURAL_PERSISTENT_TF_ORDER.indexOf(view);\n  if (index < 0) return Object.freeze([]);\n  return Object.freeze(STRUCTURAL_PERSISTENT_TF_ORDER.slice(index));\n}\n\nexport function hierarchicalDescentTimeframes(viewTimeframe) {\n  const view = String(viewTimeframe);\n  if (view === "1m") return Object.freeze([...STRUCTURAL_PERSISTENT_TF_DESCENT_ORDER]);\n  const index = STRUCTURAL_PERSISTENT_TF_DESCENT_ORDER.indexOf(view);\n  if (index < 0) return Object.freeze([]);\n  return Object.freeze(STRUCTURAL_PERSISTENT_TF_DESCENT_ORDER.slice(0, index + 1));\n}\n'''
if old_helpers not in levels:
    raise SystemExit('timeframe helper block not found')
levels = levels.replace(old_helpers, new_helpers, 1)
levels_path.write_text(levels)

runtime_path = Path('signal-lab-v7-multi-timeframe-review-runtime.js')
runtime = runtime_path.read_text()
old_generation = '''export const STRUCTURAL_REVIEW_GENERATION_CONFIG = Object.freeze({\n  "1m": Object.freeze({\n    minimumSwingPercent: 0.08,\n    minimumPercent: 0.06,\n    atrMultiplier: 0,\n    minimumBarsAfterCandidate: 1,\n  }),\n  "5m": Object.freeze({\n    minimumSwingPercent: 0.10,\n    minimumPercent: 0.08,\n    atrMultiplier: 0,\n    minimumBarsAfterCandidate: 1,\n  }),\n});\n'''
new_generation = '''export const STRUCTURAL_REVIEW_GENERATION_CONFIG = Object.freeze({\n  // V5.2: 1m intentionally has no structural generation config. The 1m chart\n  // may display inherited 5m+ levels, but native persistent structure starts here.\n  "5m": Object.freeze({\n    minimumSwingPercent: 0.10,\n    minimumPercent: 0.08,\n    atrMultiplier: 0,\n    minimumBarsAfterCandidate: 1,\n  }),\n});\n'''
if old_generation not in runtime:
    raise SystemExit('generation config block not found')
runtime = runtime.replace(old_generation, new_generation, 1)
runtime = runtime.replace('15м/5м/1м: 1 мес', '15м/5м: 1 мес · 1м: только график')
# Structural diagnostics now describe the persistent floor only. 1m remains chart-only.
runtime = runtime.replace('if (!(["1m", "5m"].includes(timeframe)) || level?.active === false) continue;', 'if (timeframe !== "5m" || level?.active === false) continue;')
runtime = runtime.replace('if (!(["1m", "5m"].includes(timeframe))) return Object.freeze([]);', 'if (timeframe !== "5m") return Object.freeze([]);')
runtime = runtime.replace('if (!(timeframe === "1m" || timeframe === "5m")) return Object.freeze([]);', 'if (timeframe !== "5m") return Object.freeze([]);')
runtime_path.write_text(runtime)

test_path = Path('test/signal-lab-v7-multi-timeframe-levels.test.js')
test_text = test_path.read_text()
old_tf_test = '''test("lower chart sees its own timeframe and every stronger timeframe", () => {\n  assert.deepEqual(visibleSourceTimeframes("1m"), ["1m", "5m", "15m", "1h", "4h", "1d"]);\n  assert.deepEqual(visibleSourceTimeframes("5m"), ["5m", "15m", "1h", "4h", "1d"]);\n  assert.deepEqual(visibleSourceTimeframes("4h"), ["4h", "1d"]);\n  assert.deepEqual(visibleSourceTimeframes("1d"), ["1d"]);\n  assert.deepEqual(hierarchicalDescentTimeframes("1m"), ["1d", "4h", "1h", "15m", "5m", "1m"]);\n});\n'''
new_tf_test = '''test("1m chart inherits 5m+ structure but native persistent structure starts at 5m", () => {\n  assert.deepEqual(visibleSourceTimeframes("1m"), ["5m", "15m", "1h", "4h", "1d"]);\n  assert.deepEqual(visibleSourceTimeframes("5m"), ["5m", "15m", "1h", "4h", "1d"]);\n  assert.deepEqual(visibleSourceTimeframes("4h"), ["4h", "1d"]);\n  assert.deepEqual(visibleSourceTimeframes("1d"), ["1d"]);\n  assert.deepEqual(hierarchicalDescentTimeframes("1m"), ["1d", "4h", "1h", "15m", "5m"]);\n});\n'''
if old_tf_test not in test_text:
    raise SystemExit('timeframe contract test not found')
test_text = test_text.replace(old_tf_test, new_tf_test, 1)

old_hierarchy_case = '''    "15m": { active: [], history: [] },\n    "5m": { active: [], history: [] },\n    "1m": { active: [\n      extreme({ id: "noise", side: "LOW", price: 100, extremeAt: END - 10 * 60_000, swingAmplitudePct: 0.15, reversalThresholdPct: 0.10 }),\n      extreme({ id: "local", side: "HIGH", price: 104, extremeAt: END - 5 * 60_000, swingAmplitudePct: 0.60, reversalThresholdPct: 0.10 }),\n    ], history: [] },\n'''
new_hierarchy_case = '''    "15m": { active: [], history: [] },\n    "5m": { active: [\n      extreme({ id: "local-5m", side: "HIGH", price: 104, extremeAt: END - 5 * 60_000, swingAmplitudePct: 0.60, reversalThresholdPct: 0.10 }),\n    ], history: [] },\n    // Native 1m data may exist for chart/research compatibility, but the\n    // persistent hierarchy must ignore it completely.\n    "1m": { active: [\n      extreme({ id: "local-1m", side: "LOW", price: 100, extremeAt: END - 2 * 60_000, swingAmplitudePct: 5, reversalThresholdPct: 0.10 }),\n    ], history: [] },\n'''
if old_hierarchy_case not in test_text:
    raise SystemExit('hierarchy fixture block not found')
test_text = test_text.replace(old_hierarchy_case, new_hierarchy_case, 1)
old_assertions = '''  assert.ok(levels.find((row) => row.id === "d" && row.sourceTimeframe === "1d"));\n  assert.ok(levels.find((row) => row.id === "h4" && row.sourceTimeframe === "4h"));\n  assert.ok(levels.find((row) => row.id === "local" && row.sourceTimeframe === "1m"));\n  assert.equal(levels.some((row) => row.id === "noise"), false);\n});\n'''
new_assertions = '''  assert.ok(levels.find((row) => row.id === "d" && row.sourceTimeframe === "1d"));\n  assert.ok(levels.find((row) => row.id === "h4" && row.sourceTimeframe === "4h"));\n  assert.ok(levels.find((row) => row.id === "local-5m" && row.sourceTimeframe === "5m"));\n  assert.equal(levels.some((row) => row.sourceTimeframe === "1m"), false);\n  assert.equal(levels.some((row) => row.id === "local-1m"), false);\n});\n'''
if old_assertions not in test_text:
    raise SystemExit('hierarchy assertions not found')
test_text = test_text.replace(old_assertions, new_assertions, 1)
test_path.write_text(test_text)
