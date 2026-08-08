from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


root = Path('.')
context_path = root / 'signal-lab-v8-level-context.js'
runtime_path = root / 'signal-lab-v7-multi-timeframe-review-runtime.js'
test_path = root / 'test/signal-lab-v8-level-context.test.js'

context = context_path.read_text()
old_roles = '''function targetRoleRows(localStructureContext) {
  const source = [
    ["NEAREST", localStructureContext?.nearestHigh],
    ["QUALITY", localStructureContext?.strongestHigh],
    ["NEAREST", localStructureContext?.nearestLow],
    ["QUALITY", localStructureContext?.strongestLow],
  ];
  const map = new Map();
'''
new_roles = '''function targetRoleRows(localStructureContext) {
  const source = [
    ["NEAREST", localStructureContext?.nearestHigh],
    ["QUALITY", localStructureContext?.strongestHigh],
    ["NEAREST", localStructureContext?.nearestLow],
    ["QUALITY", localStructureContext?.strongestLow],
  ];
  for (const row of Array.isArray(localStructureContext?.highStack) ? localStructureContext.highStack : []) {
    source.push(["STACK", row]);
  }
  for (const row of Array.isArray(localStructureContext?.lowStack) ? localStructureContext.lowStack : []) {
    source.push(["STACK", row]);
  }
  const map = new Map();
'''
context = replace_once(context, old_roles, new_roles, 'target stack roles')

anchor = '\n\nfunction researchMedian(values) {'
insert = r'''

function stackRouteSide(side, stackRows, currentPrice, currentNatrPct) {
  const rows = (Array.isArray(stackRows) ? stackRows : [])
    .filter((row) => row?.side === side && finite(row?.price) > 0)
    .slice()
    .sort((left, right) => {
      const leftDistance = Math.abs(finite(left?.price) - currentPrice);
      const rightDistance = Math.abs(finite(right?.price) - currentPrice);
      return leftDistance - rightDistance;
    });
  const levelRows = rows.map((row, index) => {
    const price = finite(row?.price);
    const distancePct = currentPrice > 0 ? Math.abs(price - currentPrice) / currentPrice * 100 : null;
    return Object.freeze({
      index: index + 1,
      id: row?.id ?? null,
      side,
      price,
      candidateState: row?.candidateState ?? "VISIBLE_MAP",
      qualityScore: finite(row?.qualityScore),
      relevanceScore: finite(row?.relevanceScore),
      distancePct: round(distancePct, 4),
      distanceNatr: distancePct !== null && currentNatrPct > 0 ? round(distancePct / currentNatrPct, 3) : null,
      confirmedAt: finite(row?.confirmedAt),
      originAt: finite(row?.originAt),
    });
  });
  const gaps = [];
  for (let index = 1; index < levelRows.length; index += 1) {
    const from = levelRows[index - 1];
    const to = levelRows[index];
    const gapPct = currentPrice > 0 ? Math.abs(to.price - from.price) / currentPrice * 100 : null;
    gaps.push(Object.freeze({
      fromIndex: from.index,
      toIndex: to.index,
      fromPrice: from.price,
      toPrice: to.price,
      gapPct: round(gapPct, 4),
      gapNatr: gapPct !== null && currentNatrPct > 0 ? round(gapPct / currentNatrPct, 3) : null,
    }));
  }
  const first = levelRows[0] ?? null;
  const last = levelRows.at(-1) ?? null;
  return Object.freeze({
    side,
    levels: Object.freeze(levelRows),
    levelCount: levelRows.length,
    visibleCount: levelRows.filter((row) => row.candidateState === "VISIBLE_MAP").length,
    shadowCount: levelRows.filter((row) => row.candidateState !== "VISIBLE_MAP").length,
    currentToFirstPct: first?.distancePct ?? null,
    currentToFirstNatr: first?.distanceNatr ?? null,
    spanToLastPct: last?.distancePct ?? null,
    spanToLastNatr: last?.distanceNatr ?? null,
    gaps: Object.freeze(gaps),
  });
}

// V6.5 represents the ordered 0-5% route through structural candidates.
// It deliberately does not call the route a cascade and does not score it.
// The output is geometry only: current-to-first distance, inter-level gaps,
// map visibility and ordered prices. Pattern semantics remain a later layer.
export function buildStackRouteResearchContext(localStructureContext) {
  const currentPrice = finite(localStructureContext?.currentPrice);
  const currentNatrPct = finite(localStructureContext?.currentNatrPct);
  if (!(currentPrice > 0)) {
    return Object.freeze({ state: "UNKNOWN", researchOnly: true });
  }
  const high = stackRouteSide("HIGH", localStructureContext?.highStack, currentPrice, currentNatrPct);
  const low = stackRouteSide("LOW", localStructureContext?.lowStack, currentPrice, currentNatrPct);
  return Object.freeze({
    state: high.levelCount || low.levelCount ? "STACK_ROUTE_AVAILABLE" : "EMPTY_STACK_ROUTE",
    currentPrice,
    currentNatrPct: round(currentNatrPct, 4),
    windowPct: finite(localStructureContext?.windowPct) ?? FIVE_PERCENT,
    high,
    low,
    researchOnly: true,
  });
}
'''
context = replace_once(context, anchor, insert + anchor, 'insert V6.5 route')
version_anchor = 'export const APPROACH_EVIDENCE_RESEARCH_VERSION = "v6.4-approach-evidence-shadow-2026-08";'
context = replace_once(
    context,
    version_anchor,
    'export const STACK_ROUTE_RESEARCH_VERSION = "v6.5-level-ladder-shadow-2026-08";\n\n' + version_anchor,
    'V6.5 version',
)
context_path.write_text(context)

runtime = runtime_path.read_text()
old_import = 'import { APPROACH_CONTEXT_RESEARCH_VERSION, APPROACH_EVIDENCE_RESEARCH_VERSION, LEVEL_CONTEXT_RESEARCH_VERSION, LOCAL_STRUCTURE_RESEARCH_VERSION, buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";'
new_import = 'import { APPROACH_CONTEXT_RESEARCH_VERSION, APPROACH_EVIDENCE_RESEARCH_VERSION, LEVEL_CONTEXT_RESEARCH_VERSION, LOCAL_STRUCTURE_RESEARCH_VERSION, STACK_ROUTE_RESEARCH_VERSION, buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, buildStackRouteResearchContext, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";'
runtime = replace_once(runtime, old_import, new_import, 'runtime V6.5 import')

formatter_anchor = 'function formatApproachResearchRow(row) {'
formatter = r'''
function formatStackRouteSide(label, row) {
  if (!row || !Array.isArray(row.levels) || !row.levels.length) return `ROUTE ${label} | none`;
  const levels = row.levels.map((level) => {
    const map = level.candidateState === "VISIBLE_MAP" ? "V" : "S";
    return `L${level.index}:${debugNumber(level.price, level.price >= 1000 ? 1 : 6)}(${map},Q${level.qualityScore ?? "—"},R${level.relevanceScore ?? "—"},d${debugNumber(level.distanceNatr, 2)}N)`;
  }).join(" ; ");
  const gaps = row.gaps.length
    ? row.gaps.map((gap) => `L${gap.fromIndex}→L${gap.toIndex}:${debugNumber(gap.gapPct, 3)}%/${debugNumber(gap.gapNatr, 2)}N`).join(" ; ")
    : "none";
  return [
    `ROUTE ${label}`,
    `levels=${row.levelCount}`,
    `map=${row.visibleCount}V/${row.shadowCount}S`,
    `current→L1=${debugNumber(row.currentToFirstPct, 3)}%/${debugNumber(row.currentToFirstNatr, 2)}N`,
    `span=${debugNumber(row.spanToLastPct, 3)}%/${debugNumber(row.spanToLastNatr, 2)}N`,
    `gaps=${gaps}`,
    `ladder=${levels}`,
  ].join(" | ");
}

function formatStackRouteResearchContext(row) {
  if (!row || row.state === "UNKNOWN") return ["STACK ROUTE | unavailable"];
  return [
    `STACK ROUTE ${STACK_ROUTE_RESEARCH_VERSION} · RESEARCH ONLY · ordered levels, not cascade`,
    formatStackRouteSide("HIGH↑", row.high),
    formatStackRouteSide("LOW↓", row.low),
  ];
}

'''
runtime = replace_once(runtime, formatter_anchor, formatter + formatter_anchor, 'route formatter')

old_context = '''  window.__INPULS_LOCAL_STRUCTURE_CONTEXT__ = localStructureContext;
  const localStructureLines = formatLocalStructureResearchContext(localStructureContext);
  const structural5mCandles = state?.candlesByTimeframe?.["5m"] ?? [];'''
new_context = '''  window.__INPULS_LOCAL_STRUCTURE_CONTEXT__ = localStructureContext;
  const localStructureLines = formatLocalStructureResearchContext(localStructureContext);
  const stackRouteContext = buildStackRouteResearchContext(localStructureContext);
  window.__INPULS_STACK_ROUTE__ = stackRouteContext;
  const stackRouteLines = formatStackRouteResearchContext(stackRouteContext);
  const structural5mCandles = state?.candlesByTimeframe?.["5m"] ?? [];'''
runtime = replace_once(runtime, old_context, new_context, 'route context runtime')
runtime = replace_once(
    runtime,
    '    ...localStructureLines,\n    ...approachLines,',
    '    ...localStructureLines,\n    ...stackRouteLines,\n    ...approachLines,',
    'route debug lines',
)
runtime = replace_once(
    runtime,
    '`DEBUG V6.3.1 CAUSAL APPROACH CONTEXT · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`',
    '`DEBUG V6.5 LEVEL LADDER + V6.4 EVIDENCE · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`',
    'debug header V6.5',
)
runtime_path.write_text(runtime)

tests = test_path.read_text()
old_test_import = 'import { buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";'
new_test_import = 'import { buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, buildStackRouteResearchContext, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";'
tests = replace_once(tests, old_test_import, new_test_import, 'test import V6.5')
if 'V6.5 stack route preserves ordered barrier geometry without a score' in tests:
    raise SystemExit('V6.5 tests already present')
tests += r'''


test("V6.5 stack route preserves ordered barrier geometry without a score", () => {
  const contexts = [
    { id: "h1", side: "HIGH", price: 101, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 20 }, relevance: { score: 50 } },
    { id: "h2", side: "HIGH", price: 103, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 40 }, relevance: { score: 30 } },
    { id: "h3", side: "HIGH", price: 103.5, currentPrice: 100, candidateState: "VISIBLE_MAP", quality: { score: 90 }, relevance: { score: 20 } },
    { id: "l1", side: "LOW", price: 98, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 30 }, relevance: { score: 35 } },
  ];
  const structure = buildLocalStructureResearchContext(contexts, { currentPrice: 100, currentNatrPct: 2 });
  const route = buildStackRouteResearchContext(structure);
  assert.equal(route.high.levelCount, 3);
  assert.deepEqual(route.high.levels.map((row) => row.price), [101, 103, 103.5]);
  assert.equal(route.high.currentToFirstNatr, 0.5);
  assert.equal(route.high.gaps[0].gapNatr, 1);
  assert.equal(route.high.gaps[1].gapNatr, 0.25);
  assert.equal(route.high.spanToLastNatr, 1.75);
  assert.equal(route.high.visibleCount, 1);
  assert.equal(route.high.shadowCount, 2);
  assert.equal(route.low.levelCount, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(route, "score"), false);
  assert.equal(route.researchOnly, true);
});

test("V6.5 approach evidence covers every level in the local stack and merges roles", () => {
  const path = Array.from({ length: 18 }, (_, index) => ({
    time: index * STEP,
    open: 100 + index * 0.05,
    high: 100.8 + index * 0.05,
    low: 99.2 + index * 0.05,
    close: 100 + index * 0.05,
  }));
  const mk = (id, price, candidateState = "SOURCE_QUALIFIED_HIDDEN") => ({
    id,
    side: "HIGH",
    price,
    candidateState,
    qualityScore: id === "h3" ? 90 : id === "h2" ? 40 : 20,
    relevanceScore: id === "h1" ? 50 : 25,
    originAt: STEP,
    confirmedAt: 2 * STEP - 1,
  });
  const h1 = mk("h1", 101);
  const h2 = mk("h2", 102);
  const h3 = mk("h3", 103, "VISIBLE_MAP");
  const structure = {
    currentPrice: path.at(-1).close,
    currentNatrPct: 1.5,
    nearestHigh: h1,
    strongestHigh: h3,
    highStack: [h1, h2, h3],
    lowStack: [],
  };
  const approach = buildApproachCompressionResearchContext(path, structure, { currentNatrPct: 1.5, lookbackBars: 12 });
  assert.equal(approach.targets.length, 3);
  const byPrice = new Map(approach.targets.map((row) => [row.targetPrice, row]));
  assert.deepEqual(byPrice.get(101).roles, ["NEAREST", "STACK"]);
  assert.deepEqual(byPrice.get(102).roles, ["STACK"]);
  assert.deepEqual(byPrice.get(103).roles, ["QUALITY", "STACK"]);
  const evidence = buildApproachEvidenceResearchContext(approach);
  assert.equal(evidence.targets.length, 3);
  assert.equal(evidence.targets.every((row) => row.researchOnly), true);
});
'''
test_path.write_text(tests)

print('Applied V6.5 level ladder shadow layer')
