from pathlib import Path

context_path = Path('signal-lab-v8-level-context.js')
text = context_path.read_text()

anchor = '''function levelSources(level) {\n  const rows = Array.isArray(level?.sources) && level.sources.length\n    ? level.sources\n    : [level?.sourceTimeframe].filter(Boolean);\n  return [...new Set(rows.map(String))];\n}\n'''
insert = r'''

function researchLevelSemanticKey(level) {
  const side = String(level?.side ?? "?");
  const timeframe = String(level?.sourceTimeframe ?? "?");
  const at = finite(level?.nativeExtremeAt ?? level?.extremeAt ?? level?.displayAt);
  const price = finite(level?.price);
  if (at === null || !(price > 0)) return null;
  return `${side}:${timeframe}:${at}:${price.toPrecision(14)}`;
}

// V6.1 shadow architecture: context research must be able to inspect source-
// qualified candidates that the current working-map filter hides. This does not
// change the chart or hierarchy. It only creates a deduplicated research pool.
export function mergeLevelResearchCandidatePool(visibleLevels, hiddenCandidates) {
  const visible = (Array.isArray(visibleLevels) ? visibleLevels : []).filter(Boolean);
  const hidden = (Array.isArray(hiddenCandidates) ? hiddenCandidates : []).filter(Boolean);
  const visibleIds = new Set();
  const semanticKeys = new Set();
  const rows = [];

  for (const level of visible) {
    if (level?.id) visibleIds.add(level.id);
    for (const id of Array.isArray(level?.memberIds) ? level.memberIds : []) {
      if (id) visibleIds.add(id);
    }
    const key = researchLevelSemanticKey(level);
    if (key) semanticKeys.add(key);
    rows.push(Object.freeze({ ...level, researchCandidateState: "VISIBLE_MAP" }));
  }

  for (const candidate of hidden) {
    if (candidate?.id && visibleIds.has(candidate.id)) continue;
    const key = researchLevelSemanticKey(candidate);
    if (key && semanticKeys.has(key)) continue;
    if (candidate?.id) visibleIds.add(candidate.id);
    if (key) semanticKeys.add(key);
    rows.push(Object.freeze({ ...candidate, researchCandidateState: "SOURCE_QUALIFIED_HIDDEN" }));
  }

  return Object.freeze(rows);
}
'''
if anchor not in text:
    raise SystemExit('levelSources anchor not found')
text = text.replace(anchor, anchor + insert, 1)

old_weighted = '''  const weighted = proximity === null\n    ? null\n    : (0.60 * proximity) + (0.25 * attacks) + (0.15 * confluence);\n'''
new_weighted = '''  // Current relevance is intentionally local to the product's 0-5% working\n  // range. A far-away historical level may have excellent structural quality,\n  // repeated attacks or confluence, but it is not relevant NOW merely because\n  // of those properties. Quality remains available separately.\n  const inFivePercentWindow = distancePct !== null ? distancePct <= FIVE_PERCENT : null;\n  const weighted = proximity === null\n    ? null\n    : inFivePercentWindow\n      ? (0.60 * proximity) + (0.25 * attacks) + (0.15 * confluence)\n      : 0;\n'''
if old_weighted not in text:
    raise SystemExit('weighted relevance block not found')
text = text.replace(old_weighted, new_weighted, 1)
text = text.replace(
    '    inFivePercentWindow: distancePct !== null ? distancePct <= FIVE_PERCENT : null,',
    '    inFivePercentWindow,',
    1,
)

old_row = '''      id: level?.id ?? null,\n      side: level?.side ?? null,\n      price: finite(level?.price),\n'''
new_row = '''      id: level?.id ?? null,\n      side: level?.side ?? null,\n      price: finite(level?.price),\n      candidateState: level?.researchCandidateState ?? "VISIBLE_MAP",\n'''
if old_row not in text:
    raise SystemExit('context row insertion point not found')
text = text.replace(old_row, new_row, 1)
text = text.replace(
    'export const LEVEL_CONTEXT_RESEARCH_VERSION = "v6-shadow-2026-08";',
    'export const LEVEL_CONTEXT_RESEARCH_VERSION = "v6.1-candidate-shadow-2026-08";',
    1,
)
context_path.write_text(text)

runtime_path = Path('signal-lab-v7-multi-timeframe-review-runtime.js')
runtime = runtime_path.read_text()
runtime = runtime.replace(
    'import { LEVEL_CONTEXT_RESEARCH_VERSION, buildLevelResearchContexts } from "./signal-lab-v8-level-context.js";',
    'import { LEVEL_CONTEXT_RESEARCH_VERSION, buildLevelResearchContexts, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";',
    1,
)

format_anchor = '''function formatLevelResearchContextRow(row) {\n  const missing = Object.entries(row?.coverage ?? {})\n'''
helper = r'''
function buildLevelContextCandidatePool(state, levelMap) {
  const hiddenCandidates = [];
  if (state?.viewTimeframe === "5m") {
    const timeframe = "5m";
    const snapshot = state?.snapshotsByTimeframe?.[timeframe];
    const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
    const volatility = buildStructuralVolatilityContext(candles);
    for (const extreme of Array.isArray(snapshot?.active) ? snapshot.active : []) {
      if (!extreme || extreme.active === false || !["HIGH", "LOW"].includes(extreme?.side)) continue;
      const significance = structuralChildAdmissionDecision(extreme, timeframe, { volatilityContext: volatility });
      const prominence = structuralLocalPivotProminenceDecision(extreme, timeframe, candles, volatility);
      if (significance?.admitted === false || prominence?.admitted === false) continue;
      hiddenCandidates.push(Object.freeze({
        ...extreme,
        sourceTimeframe: timeframe,
        nativeExtremeAt: extreme?.extremeAt,
        sources: Object.freeze([timeframe]),
        confluenceCount: 1,
        // Do not reinterpret lifecycle touchCount as Attack ×N. Exact attack
        // semantics remain owned by the structural lifecycle engine.
        attackCount: Math.max(1, Math.round(Number(extreme?.attackCount) || 1)),
        active: true,
      }));
    }
  }
  return mergeLevelResearchCandidatePool(levelMap, hiddenCandidates);
}

'''
if format_anchor not in runtime:
    raise SystemExit('formatLevelResearchContextRow anchor not found')
runtime = runtime.replace(format_anchor, helper + format_anchor, 1)

old_format_start = '''  return [\n    `CTX ${row.side} ${sources} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)}`,\n    `Q=${row.quality?.score ?? "—"}`,\n'''
new_format_start = '''  return [\n    `CTX ${row.side} ${sources} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)}`,\n    `map=${row.candidateState === "VISIBLE_MAP" ? "VISIBLE" : "shadow"}`,\n    `Q=${row.quality?.score ?? "—"}`,\n'''
if old_format_start not in runtime:
    raise SystemExit('context formatter start not found')
runtime = runtime.replace(old_format_start, new_format_start, 1)

old_context_build = '''  const levelContextRows = [...buildLevelResearchContexts(levelMap, {\n    candlesByTimeframe: state.candlesByTimeframe,\n    viewTimeframe: state.viewTimeframe,\n    endAt: state.endAt,\n  })];\n  window.__INPULS_LEVEL_CONTEXT__ = levelContextRows;\n'''
new_context_build = '''  const levelContextPool = buildLevelContextCandidatePool(state, levelMap);\n  const levelContextRows = [...buildLevelResearchContexts(levelContextPool, {\n    candlesByTimeframe: state.candlesByTimeframe,\n    viewTimeframe: state.viewTimeframe,\n    endAt: state.endAt,\n  })];\n  window.__INPULS_LEVEL_CONTEXT_CANDIDATES__ = levelContextPool;\n  window.__INPULS_LEVEL_CONTEXT__ = levelContextRows;\n'''
if old_context_build not in runtime:
    raise SystemExit('level context build block not found')
runtime = runtime.replace(old_context_build, new_context_build, 1)

old_header = '''    `LEVEL CONTEXT ${LEVEL_CONTEXT_RESEARCH_VERSION} · RESEARCH ONLY · Q=structural geometry · R=price/structure relevance only`,\n'''
new_header = '''    `LEVEL CONTEXT ${LEVEL_CONTEXT_RESEARCH_VERSION} · RESEARCH ONLY · pool=${levelContextPool.length} visible=${levelContextRows.filter((row) => row.candidateState === "VISIBLE_MAP").length} shadow=${levelContextRows.filter((row) => row.candidateState !== "VISIBLE_MAP").length} · Q=structural geometry · R=0-5% current relevance`,\n'''
if old_header not in runtime:
    raise SystemExit('level context header not found')
runtime = runtime.replace(old_header, new_header, 1)
runtime_path.write_text(runtime)

test_path = Path('test/signal-lab-v8-level-context.test.js')
test = test_path.read_text()
test = test.replace(
    'import { buildLevelResearchContexts } from "../signal-lab-v8-level-context.js";',
    'import { buildLevelResearchContexts, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";',
    1,
)
test += r'''

test("V6.1 far-away confluence and attacks do not manufacture current relevance outside 5%", () => {
  const farStrong = {
    ...base,
    id: "far-strong",
    price: 120,
    attackCount: 5,
    sources: ["5m", "15m", "1h"],
    confluenceCount: 3,
  };
  const [row] = buildLevelResearchContexts([farStrong], {
    candlesByTimeframe: { "5m": candles },
    viewTimeframe: "5m",
    endAt: 40 * STEP - 1,
    currentPrice: 100,
  });
  assert.equal(row.relevance.inFivePercentWindow, false);
  assert.equal(row.relevance.score, 0);
  assert.equal(row.relevance.attackComponent, 100);
  assert.equal(row.relevance.confluenceComponent, 100);
});

test("V6.1 research pool adds hidden source-qualified candidates without duplicating visible members", () => {
  const visible = [{
    ...base,
    id: "senior-primary",
    memberIds: ["native-visible"],
    price: 102,
    sources: ["15m", "5m"],
    sourceTimeframe: "15m",
  }];
  const hidden = [
    { ...base, id: "native-visible", price: 102 },
    { ...base, id: "hidden-near", price: 101 },
  ];
  const pool = mergeLevelResearchCandidatePool(visible, hidden);
  assert.equal(pool.length, 2);
  assert.equal(pool.find((row) => row.id === "senior-primary")?.researchCandidateState, "VISIBLE_MAP");
  assert.equal(pool.find((row) => row.id === "hidden-near")?.researchCandidateState, "SOURCE_QUALIFIED_HIDDEN");
  assert.equal(pool.some((row) => row.id === "native-visible"), false);
});
'''
test_path.write_text(test)
