from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)

root = Path('.')
context_path = root / 'signal-lab-v8-level-context.js'
runtime_path = root / 'signal-lab-v7-multi-timeframe-review-runtime.js'
test_path = root / 'test/signal-lab-v8-level-context.test.js'

context = context_path.read_text()
anchor = 'export const STACK_ROUTE_RESEARCH_VERSION = "v6.5-level-ladder-shadow-2026-08";'
if anchor not in context:
    # version sits later in some revisions; use approach version as stable insertion point
    anchor = 'export const APPROACH_CONTEXT_RESEARCH_VERSION = "v6.3.1-causal-path-shadow-2026-08";'

insert = r'''

const CROSS_ASSET_WORKING_NATR = 6;
const LEVEL_ZONE_LENSES_NATR = Object.freeze([0.10, 0.25, 0.50]);

function crossAssetDistanceNatr(row, currentPrice, currentNatrPct) {
  const distancePct = priceDistancePct(row?.price, currentPrice);
  return distancePct !== null && currentNatrPct > 0 ? distancePct / currentNatrPct : null;
}

function crossAssetAgeBuckets(rows) {
  const result = { le12: 0, le36: 0, le144: 0, gt144: 0, unknown: 0 };
  for (const row of rows) {
    const age = finite(row?.ageBars);
    if (age === null) result.unknown += 1;
    else if (age <= 12) result.le12 += 1;
    else if (age <= 36) result.le36 += 1;
    else if (age <= 144) result.le144 += 1;
    else result.gt144 += 1;
  }
  return Object.freeze(result);
}

function buildResearchZones(rows, side, currentPrice, currentNatrPct, thresholdNatr) {
  const source = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.side === side && finite(row?.price) > 0)
    .slice()
    .sort((left, right) => Math.abs(finite(left.price) - currentPrice) - Math.abs(finite(right.price) - currentPrice));
  const clusters = [];
  for (const row of source) {
    const price = finite(row.price);
    const previous = clusters.at(-1);
    if (!previous) {
      clusters.push([row]);
      continue;
    }
    const lastPrice = finite(previous.at(-1)?.price);
    const gapPct = currentPrice > 0 ? Math.abs(price - lastPrice) / currentPrice * 100 : null;
    const gapNatr = gapPct !== null && currentNatrPct > 0 ? gapPct / currentNatrPct : null;
    if (gapNatr !== null && gapNatr <= thresholdNatr) previous.push(row);
    else clusters.push([row]);
  }
  return Object.freeze(clusters.map((members, index) => {
    const prices = members.map((row) => finite(row.price)).filter((value) => value > 0);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const representative = members.slice().sort((left, right) => {
      const quality = (finite(right?.quality?.score) ?? -1) - (finite(left?.quality?.score) ?? -1);
      if (quality) return quality;
      return (finite(right?.relevance?.score) ?? -1) - (finite(left?.relevance?.score) ?? -1);
    })[0];
    const minDistanceNatr = Math.min(...members
      .map((row) => crossAssetDistanceNatr(row, currentPrice, currentNatrPct))
      .filter((value) => value !== null));
    const maxDistanceNatr = Math.max(...members
      .map((row) => crossAssetDistanceNatr(row, currentPrice, currentNatrPct))
      .filter((value) => value !== null));
    const spanPct = currentPrice > 0 ? Math.abs(maxPrice - minPrice) / currentPrice * 100 : null;
    return Object.freeze({
      index: index + 1,
      side,
      memberCount: members.length,
      visibleCount: members.filter((row) => row?.candidateState === "VISIBLE_MAP").length,
      shadowCount: members.filter((row) => row?.candidateState !== "VISIBLE_MAP").length,
      minPrice,
      maxPrice,
      representativePrice: finite(representative?.price),
      representativeQuality: finite(representative?.quality?.score),
      representativeRelevance: finite(representative?.relevance?.score),
      minDistanceNatr: round(minDistanceNatr, 3),
      maxDistanceNatr: round(maxDistanceNatr, 3),
      spanNatr: spanPct !== null && currentNatrPct > 0 ? round(spanPct / currentNatrPct, 3) : null,
      members: Object.freeze(members.map((row) => Object.freeze({
        id: row?.id ?? null,
        price: finite(row?.price),
        candidateState: row?.candidateState ?? "VISIBLE_MAP",
        qualityScore: finite(row?.quality?.score),
        relevanceScore: finite(row?.relevance?.score),
      }))),
    });
  }));
}

// V6.7 keeps the user-defined cascade envelope at 0-5%, but adds a
// volatility-normalized working lens so a quiet asset does not treat dozens of
// NATR as equally local. Zone clustering is shadow-only sensitivity research;
// it does not merge structural levels or alter Attack xN / PIERCED lifecycle.
export function buildCrossAssetHorizonResearchContext(levelContexts, {
  currentPrice = null,
  currentNatrPct = null,
  workingNatr = CROSS_ASSET_WORKING_NATR,
  zoneLensNatr = 0.25,
} = {}) {
  const rows = (Array.isArray(levelContexts) ? levelContexts : [])
    .filter((row) => row && finite(row?.price) > 0);
  const resolvedCurrentPrice = finite(currentPrice)
    ?? finite(rows.find((row) => finite(row?.currentPrice) > 0)?.currentPrice);
  const resolvedCurrentNatrPct = finite(currentNatrPct);
  if (!(resolvedCurrentPrice > 0) || !(resolvedCurrentNatrPct > 0)) {
    return Object.freeze({ state: "UNKNOWN", researchOnly: true });
  }

  const cascadeRows = rows.filter((row) => (priceDistancePct(row.price, resolvedCurrentPrice) ?? Infinity) <= FIVE_PERCENT);
  const resolvedWorkingNatr = Math.max(1, Number(workingNatr) || CROSS_ASSET_WORKING_NATR);
  const workingWindowPct = Math.min(FIVE_PERCENT, resolvedCurrentNatrPct * resolvedWorkingNatr);
  const workingRows = cascadeRows.filter((row) => (priceDistancePct(row.price, resolvedCurrentPrice) ?? Infinity) <= workingWindowPct);
  const correctSideWorkingRows = workingRows.filter((row) => (
    (row.side === "HIGH" && finite(row.price) > resolvedCurrentPrice)
    || (row.side === "LOW" && finite(row.price) < resolvedCurrentPrice)
  ));
  const withinNatr = (natr) => cascadeRows.filter((row) => {
    const distance = crossAssetDistanceNatr(row, resolvedCurrentPrice, resolvedCurrentNatrPct);
    return distance !== null && distance <= natr;
  }).length;
  const shadow5m = cascadeRows.filter((row) => row?.sourceTimeframe === "5m" && row?.candidateState !== "VISIBLE_MAP");
  const resolvedZoneLens = Math.max(0.01, Number(zoneLensNatr) || 0.25);
  const highZones = buildResearchZones(correctSideWorkingRows, "HIGH", resolvedCurrentPrice, resolvedCurrentNatrPct, resolvedZoneLens);
  const lowZones = buildResearchZones(correctSideWorkingRows, "LOW", resolvedCurrentPrice, resolvedCurrentNatrPct, resolvedZoneLens);
  const zoneSensitivity = Object.freeze(LEVEL_ZONE_LENSES_NATR.map((lens) => Object.freeze({
    lensNatr: lens,
    highZones: buildResearchZones(correctSideWorkingRows, "HIGH", resolvedCurrentPrice, resolvedCurrentNatrPct, lens).length,
    lowZones: buildResearchZones(correctSideWorkingRows, "LOW", resolvedCurrentPrice, resolvedCurrentNatrPct, lens).length,
  })));

  return Object.freeze({
    state: cascadeRows.length ? "CROSS_ASSET_CONTEXT_AVAILABLE" : "EMPTY_CASCADE_WINDOW",
    currentPrice: resolvedCurrentPrice,
    currentNatrPct: round(resolvedCurrentNatrPct, 4),
    cascadeWindowPct: FIVE_PERCENT,
    cascadeWindowNatr: round(FIVE_PERCENT / resolvedCurrentNatrPct, 2),
    workingNatr: resolvedWorkingNatr,
    workingWindowPct: round(workingWindowPct, 4),
    cascadeLevelCount: cascadeRows.length,
    workingLevelCount: workingRows.length,
    workingVisibleCount: workingRows.filter((row) => row?.candidateState === "VISIBLE_MAP").length,
    workingShadowCount: workingRows.filter((row) => row?.candidateState !== "VISIBLE_MAP").length,
    natrCounts: Object.freeze({ within1: withinNatr(1), within2: withinNatr(2), within4: withinNatr(4), within6: withinNatr(6), within12: withinNatr(12) }),
    shadow5mAge: crossAssetAgeBuckets(shadow5m),
    zoneLensNatr: resolvedZoneLens,
    highZones,
    lowZones,
    zoneSensitivity,
    workingLevelKeys: Object.freeze(workingRows.map((row) => `${row.side}:${Number(row.price).toPrecision(14)}:${row.candidateState ?? "VISIBLE_MAP"}`)),
    researchOnly: true,
  });
}

export const CROSS_ASSET_HORIZON_RESEARCH_VERSION = "v6.7-cross-asset-horizon-zones-shadow-2026-08";
'''
context = replace_once(context, anchor, insert + '\n' + anchor, 'insert cross asset context')
context_path.write_text(context)

runtime = runtime_path.read_text()
old_import = 'import { APPROACH_CONTEXT_RESEARCH_VERSION, APPROACH_EVIDENCE_RESEARCH_VERSION, LEVEL_CONTEXT_RESEARCH_VERSION, LOCAL_STRUCTURE_RESEARCH_VERSION, STACK_ROUTE_RESEARCH_VERSION, buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, buildStackRouteResearchContext, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";'
new_import = 'import { APPROACH_CONTEXT_RESEARCH_VERSION, APPROACH_EVIDENCE_RESEARCH_VERSION, CROSS_ASSET_HORIZON_RESEARCH_VERSION, LEVEL_CONTEXT_RESEARCH_VERSION, LOCAL_STRUCTURE_RESEARCH_VERSION, STACK_ROUTE_RESEARCH_VERSION, buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildCrossAssetHorizonResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, buildStackRouteResearchContext, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";'
runtime = replace_once(runtime, old_import, new_import, 'runtime import')

formatter_anchor = 'function formatApproachResearchRow(row) {'
formatter = r'''
function formatCrossAssetZones(label, zones) {
  const rows = Array.isArray(zones) ? zones : [];
  if (!rows.length) return `${label} | none`;
  return `${label} | ${rows.map((zone) => {
    const price = zone.minPrice === zone.maxPrice
      ? debugNumber(zone.minPrice, zone.minPrice >= 1000 ? 1 : 6)
      : `${debugNumber(zone.minPrice, zone.minPrice >= 1000 ? 1 : 6)}–${debugNumber(zone.maxPrice, zone.maxPrice >= 1000 ? 1 : 6)}`;
    return `Z${zone.index}:${price}(n${zone.memberCount},${zone.visibleCount}V/${zone.shadowCount}S,d${debugNumber(zone.minDistanceNatr, 2)}-${debugNumber(zone.maxDistanceNatr, 2)}N,span${debugNumber(zone.spanNatr, 2)}N,Q${zone.representativeQuality ?? "—"})`;
  }).join(" ; ")}`;
}

function formatCrossAssetHorizonResearchContext(row) {
  if (!row || row.state === "UNKNOWN") return ["CROSS-ASSET HORIZON | unavailable"];
  const age = row.shadow5mAge ?? {};
  const sensitivity = Array.isArray(row.zoneSensitivity) ? row.zoneSensitivity : [];
  return [
    `CROSS-ASSET HORIZON ${CROSS_ASSET_HORIZON_RESEARCH_VERSION} · RESEARCH ONLY · 5% cascade envelope preserved`,
    [
      "HORIZON",
      `5%=${debugNumber(row.cascadeWindowNatr, 2)}N`,
      `working=min(5%,${debugNumber(row.workingNatr, 1)}N)=${debugNumber(row.workingWindowPct, 3)}%`,
      `raw5=${row.cascadeLevelCount ?? 0}`,
      `working=${row.workingLevelCount ?? 0}(${row.workingVisibleCount ?? 0}V/${row.workingShadowCount ?? 0}S)`,
    ].join(" | "),
    `NATR COUNTS | ≤1N=${row.natrCounts?.within1 ?? 0} | ≤2N=${row.natrCounts?.within2 ?? 0} | ≤4N=${row.natrCounts?.within4 ?? 0} | ≤6N=${row.natrCounts?.within6 ?? 0} | ≤12N=${row.natrCounts?.within12 ?? 0}`,
    `SHADOW 5m AGE in 0-5% | ≤12b=${age.le12 ?? 0} | 13-36b=${age.le36 ?? 0} | 37-144b=${age.le144 ?? 0} | >144b=${age.gt144 ?? 0} | unknown=${age.unknown ?? 0}`,
    `ZONE SENSITIVITY | ${sensitivity.map((item) => `${debugNumber(item.lensNatr, 2)}N=${item.highZones}H/${item.lowZones}L`).join(" ; ") || "none"}`,
    formatCrossAssetZones(`ZONES HIGH↑ @${debugNumber(row.zoneLensNatr, 2)}N`, row.highZones),
    formatCrossAssetZones(`ZONES LOW↓ @${debugNumber(row.zoneLensNatr, 2)}N`, row.lowZones),
  ];
}

function formatLocalStructureCompact(row) {
  if (!row || row.state === "UNKNOWN") return ["LOCAL STRUCTURE | unavailable"];
  const counts = row.counts ?? {};
  return [
    `LOCAL STRUCTURE ${LOCAL_STRUCTURE_RESEARCH_VERSION} · compact`,
    `STRUCT WINDOW | current=${debugNumber(row.currentPrice, row.currentPrice >= 1000 ? 1 : 6)} | natr=${debugNumber(row.currentNatrPct, 3)}% | 5%=${counts.within5Pct ?? 0} | HIGH↑=${counts.highsAbove ?? 0} | LOW↓=${counts.lowsBelow ?? 0} | mismatch=${counts.sideMismatch ?? 0} | map=${counts.visible ?? 0}V/${counts.shadow ?? 0}S`,
    formatResearchBracket("STRUCT NEAREST", row.nearestBracket),
    formatResearchBracket("STRUCT QUALITY", row.strongestBracket),
  ];
}

'''
runtime = replace_once(runtime, formatter_anchor, formatter + formatter_anchor, 'runtime cross asset formatter')

old_context = '''  const approachEvidenceContext = buildApproachEvidenceResearchContext(approachContext);\n  window.__INPULS_APPROACH_EVIDENCE__ = approachEvidenceContext;\n  const approachEvidenceLines = formatApproachEvidenceResearchContext(approachEvidenceContext);\n  const researchParams = new URL(window.location.href).searchParams;'''
new_context = '''  const approachEvidenceContext = buildApproachEvidenceResearchContext(approachContext);\n  window.__INPULS_APPROACH_EVIDENCE__ = approachEvidenceContext;\n  const approachEvidenceLines = formatApproachEvidenceResearchContext(approachEvidenceContext);\n  const crossAssetContext = buildCrossAssetHorizonResearchContext(levelContextRows, {\n    currentPrice: localStructureContext.currentPrice,\n    currentNatrPct: structural5mVolatility.currentNatrPct ?? localStructureContext.currentNatrPct,\n  });\n  window.__INPULS_CROSS_ASSET_HORIZON__ = crossAssetContext;\n  const crossAssetLines = formatCrossAssetHorizonResearchContext(crossAssetContext);\n  const researchParams = new URL(window.location.href).searchParams;'''
runtime = replace_once(runtime, old_context, new_context, 'runtime cross asset context')

old_snapshot = '''  const localResearchRows = levelContextRows.filter((row) => row?.relevance?.inFivePercentWindow);\n  const researchSnapshotText = [\n    `RESEARCH SNAPSHOT v6.6-compact-cross-asset-2026-08 · ${researchSymbol} · ${state.viewTimeframe} · endAt=${new Date(state.endAt).toISOString()}`,\n    ...localStructureLines,\n    ...stackRouteLines,\n    ...approachEvidenceLines,\n    `LOCAL LEVELS 0-5% · rows=${localResearchRows.length}`,\n    ...localResearchRows.map(formatLevelResearchContextRow),\n  ].join("\\n");'''
new_snapshot = '''  const compactDistanceNatr = (row) => {\n    const distancePct = finite(row?.relevance?.distancePct);\n    const natr = finite(crossAssetContext?.currentNatrPct);\n    return distancePct !== null && natr > 0 ? distancePct / natr : null;\n  };\n  const workingResearchRows = levelContextRows.filter((row) => row?.relevance?.inFivePercentWindow && (compactDistanceNatr(row) ?? Infinity) <= (crossAssetContext?.workingNatr ?? 6));\n  const workingEvidenceContext = Object.freeze({\n    ...approachEvidenceContext,\n    targets: Object.freeze((Array.isArray(approachEvidenceContext?.targets) ? approachEvidenceContext.targets : []).filter((row) => (finite(row?.currentDistanceNatr) ?? Infinity) <= (crossAssetContext?.workingNatr ?? 6))),\n  });\n  const researchSnapshotText = [\n    `RESEARCH SNAPSHOT v6.7-cross-asset-compact-2026-08 · ${researchSymbol} · ${state.viewTimeframe} · endAt=${new Date(state.endAt).toISOString()}`,\n    ...formatLocalStructureCompact(localStructureContext),\n    ...crossAssetLines,\n    ...formatApproachEvidenceResearchContext(workingEvidenceContext),\n    `WORKING LEVELS ≤${debugNumber(crossAssetContext?.workingNatr ?? 6, 1)}N AND 0-5% · rows=${workingResearchRows.length}`,\n    ...workingResearchRows.map(formatLevelResearchContextRow),\n  ].join("\\n");'''
runtime = replace_once(runtime, old_snapshot, new_snapshot, 'compact snapshot v6.7')
runtime = replace_once(runtime, '    ...approachEvidenceLines,\n    `LEVEL CONTEXT', '    ...approachEvidenceLines,\n    ...crossAssetLines,\n    `LEVEL CONTEXT', 'full debug cross asset lines')
runtime_path.write_text(runtime)

tests = test_path.read_text()
old_test_import = 'import { buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, buildStackRouteResearchContext, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";'
new_test_import = 'import { buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildCrossAssetHorizonResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, buildStackRouteResearchContext, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";'
tests = replace_once(tests, old_test_import, new_test_import, 'test import')
if 'V6.7 low-volatility asset keeps 5% cascade envelope but narrows the working lens to 6N' in tests:
    raise SystemExit('V6.7 tests already present')
tests += r'''


test("V6.7 low-volatility asset keeps 5% cascade envelope but narrows the working lens to 6N", () => {
  const rows = [
    { id: "h1", side: "HIGH", price: 100.2, sourceTimeframe: "5m", candidateState: "SOURCE_QUALIFIED_HIDDEN", ageBars: 5, quality: { score: 50 }, relevance: { score: 50 } },
    { id: "h2", side: "HIGH", price: 100.5, sourceTimeframe: "5m", candidateState: "SOURCE_QUALIFIED_HIDDEN", ageBars: 50, quality: { score: 60 }, relevance: { score: 40 } },
    { id: "h3", side: "HIGH", price: 101.5, sourceTimeframe: "5m", candidateState: "SOURCE_QUALIFIED_HIDDEN", ageBars: 500, quality: { score: 70 }, relevance: { score: 30 } },
  ];
  const row = buildCrossAssetHorizonResearchContext(rows, { currentPrice: 100, currentNatrPct: 0.1 });
  assert.equal(row.cascadeWindowNatr, 50);
  assert.equal(row.workingWindowPct, 0.6);
  assert.equal(row.cascadeLevelCount, 3);
  assert.equal(row.workingLevelCount, 2);
  assert.equal(row.natrCounts.within6, 2);
  assert.equal(row.researchOnly, true);
});

test("V6.7 high-volatility asset never expands the working lens beyond the 0-5% cascade envelope", () => {
  const rows = [
    { id: "inside", side: "HIGH", price: 104, sourceTimeframe: "5m", candidateState: "VISIBLE_MAP", ageBars: 3, quality: { score: 60 }, relevance: { score: 40 } },
    { id: "outside", side: "HIGH", price: 110, sourceTimeframe: "5m", candidateState: "VISIBLE_MAP", ageBars: 3, quality: { score: 60 }, relevance: { score: 0 } },
  ];
  const row = buildCrossAssetHorizonResearchContext(rows, { currentPrice: 100, currentNatrPct: 3 });
  assert.equal(row.workingWindowPct, 5);
  assert.equal(row.cascadeLevelCount, 1);
  assert.equal(row.workingLevelCount, 1);
});

test("V6.7 zone lens groups near-duplicate barriers without mutating raw level count", () => {
  const rows = [
    { id: "a", side: "HIGH", price: 100.05, sourceTimeframe: "5m", candidateState: "SOURCE_QUALIFIED_HIDDEN", ageBars: 4, quality: { score: 40 }, relevance: { score: 50 } },
    { id: "b", side: "HIGH", price: 100.20, sourceTimeframe: "5m", candidateState: "VISIBLE_MAP", ageBars: 20, quality: { score: 80 }, relevance: { score: 45 } },
    { id: "c", side: "HIGH", price: 101.00, sourceTimeframe: "5m", candidateState: "SOURCE_QUALIFIED_HIDDEN", ageBars: 200, quality: { score: 70 }, relevance: { score: 35 } },
  ];
  const row = buildCrossAssetHorizonResearchContext(rows, { currentPrice: 100, currentNatrPct: 1, zoneLensNatr: 0.25 });
  assert.equal(row.workingLevelCount, 3);
  assert.equal(row.highZones.length, 2);
  assert.equal(row.highZones[0].memberCount, 2);
  assert.equal(row.highZones[0].visibleCount, 1);
  assert.equal(row.highZones[0].representativePrice, 100.2);
  assert.deepEqual(row.shadow5mAge, { le12: 1, le36: 0, le144: 0, gt144: 1, unknown: 0 });
  assert.equal(Object.prototype.hasOwnProperty.call(row, "score"), false);
});
'''
test_path.write_text(tests)

print('Applied V6.7 cross-asset horizon + zone research layer')
