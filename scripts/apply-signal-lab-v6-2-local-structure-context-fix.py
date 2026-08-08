from pathlib import Path

# 1) Extend existing level context with relational local-structure diagnostics.
context_path = Path('signal-lab-v8-level-context.js')
text = context_path.read_text()
anchor = 'export const LEVEL_CONTEXT_RESEARCH_VERSION = "v6.1-candidate-shadow-2026-08";'
if anchor not in text:
    raise SystemExit('level context version anchor not found')
insert = r'''

function researchBoundaryRow(row, currentPrice) {
  if (!row) return null;
  const price = finite(row?.price);
  if (!(price > 0)) return null;
  return Object.freeze({
    id: row?.id ?? null,
    side: row?.side ?? null,
    price,
    distancePct: round(priceDistancePct(price, currentPrice), 4),
    qualityScore: finite(row?.quality?.score),
    relevanceScore: finite(row?.relevance?.score),
    candidateState: row?.candidateState ?? "VISIBLE_MAP",
    sourceTimeframe: row?.sourceTimeframe ?? null,
    sources: Object.freeze(Array.isArray(row?.sources) ? [...row.sources] : []),
  });
}

function strongestResearchBoundary(rows, currentPrice) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((left, right) => {
      const qualityDelta = (finite(right?.quality?.score) ?? -1) - (finite(left?.quality?.score) ?? -1);
      if (qualityDelta) return qualityDelta;
      const relevanceDelta = (finite(right?.relevance?.score) ?? -1) - (finite(left?.relevance?.score) ?? -1);
      if (relevanceDelta) return relevanceDelta;
      return (priceDistancePct(left?.price, currentPrice) ?? Infinity)
        - (priceDistancePct(right?.price, currentPrice) ?? Infinity);
    })[0] ?? null;
}

function bracketMetrics(lowRow, highRow, sourceRows, currentPrice, currentNatrPct) {
  const low = researchBoundaryRow(lowRow, currentPrice);
  const high = researchBoundaryRow(highRow, currentPrice);
  if (!low || !high || !(high.price > low.price) || !(currentPrice > 0)) return null;
  const widthPct = (high.price - low.price) / currentPrice * 100;
  const position = (currentPrice - low.price) / (high.price - low.price);
  const contained = (Array.isArray(sourceRows) ? sourceRows : []).filter((row) => {
    const price = finite(row?.price);
    return price !== null && price >= low.price && price <= high.price;
  });
  return Object.freeze({
    low,
    high,
    widthPct: round(widthPct, 4),
    widthNatr: currentNatrPct > 0 ? round(widthPct / currentNatrPct, 3) : null,
    currentPosition: round(position, 4),
    containedLevels: contained.length,
    visibleLevels: contained.filter((row) => row?.candidateState === "VISIBLE_MAP").length,
    shadowLevels: contained.filter((row) => row?.candidateState !== "VISIBLE_MAP").length,
  });
}

// V6.2: relational context only. It deliberately does not produce another
// aggregate trading score. "Nearest" and "strongest" boundaries are exposed
// separately so later outcome data can determine which relationship matters.
export function buildLocalStructureResearchContext(levelContexts, {
  currentPrice = null,
  currentNatrPct = null,
} = {}) {
  const all = (Array.isArray(levelContexts) ? levelContexts : [])
    .filter((row) => row && finite(row?.price) > 0);
  const resolvedCurrentPrice = finite(currentPrice)
    ?? finite(all.find((row) => finite(row?.currentPrice) > 0)?.currentPrice);
  const resolvedCurrentNatrPct = finite(currentNatrPct);
  if (!(resolvedCurrentPrice > 0)) {
    return Object.freeze({ state: "UNKNOWN", researchOnly: true });
  }

  const local = all.filter((row) => {
    const distance = priceDistancePct(row?.price, resolvedCurrentPrice);
    return distance !== null && distance <= FIVE_PERCENT;
  });
  const highsAbove = local.filter((row) => row?.side === "HIGH" && finite(row?.price) > resolvedCurrentPrice);
  const lowsBelow = local.filter((row) => row?.side === "LOW" && finite(row?.price) < resolvedCurrentPrice);
  const sideMismatch = local.filter((row) => (
    (row?.side === "HIGH" && finite(row?.price) < resolvedCurrentPrice)
    || (row?.side === "LOW" && finite(row?.price) > resolvedCurrentPrice)
  ));

  const nearestHigh = highsAbove.slice().sort((a, b) => Number(a.price) - Number(b.price))[0] ?? null;
  const nearestLow = lowsBelow.slice().sort((a, b) => Number(b.price) - Number(a.price))[0] ?? null;
  const strongestHigh = strongestResearchBoundary(highsAbove, resolvedCurrentPrice);
  const strongestLow = strongestResearchBoundary(lowsBelow, resolvedCurrentPrice);
  const within = (pct) => local.filter((row) => (priceDistancePct(row?.price, resolvedCurrentPrice) ?? Infinity) <= pct).length;
  const highPrices = highsAbove.map((row) => finite(row?.price)).filter((value) => value > 0);
  const lowPrices = lowsBelow.map((row) => finite(row?.price)).filter((value) => value > 0);
  const spreadPct = (prices) => prices.length > 1
    ? (Math.max(...prices) - Math.min(...prices)) / resolvedCurrentPrice * 100
    : 0;
  const stack = (rows) => Object.freeze(rows
    .slice()
    .sort((a, b) => (priceDistancePct(a?.price, resolvedCurrentPrice) ?? Infinity) - (priceDistancePct(b?.price, resolvedCurrentPrice) ?? Infinity))
    .map((row) => researchBoundaryRow(row, resolvedCurrentPrice))
    .filter(Boolean));

  return Object.freeze({
    state: local.length ? "LOCAL_STRUCTURE_AVAILABLE" : "EMPTY_LOCAL_WINDOW",
    currentPrice: resolvedCurrentPrice,
    currentNatrPct: round(resolvedCurrentNatrPct, 4),
    windowPct: FIVE_PERCENT,
    counts: Object.freeze({
      within1Pct: within(1),
      within2Pct: within(2),
      within5Pct: local.length,
      highsAbove: highsAbove.length,
      lowsBelow: lowsBelow.length,
      sideMismatch: sideMismatch.length,
      visible: local.filter((row) => row?.candidateState === "VISIBLE_MAP").length,
      shadow: local.filter((row) => row?.candidateState !== "VISIBLE_MAP").length,
    }),
    nearestBracket: bracketMetrics(nearestLow, nearestHigh, local, resolvedCurrentPrice, resolvedCurrentNatrPct),
    strongestBracket: bracketMetrics(strongestLow, strongestHigh, local, resolvedCurrentPrice, resolvedCurrentNatrPct),
    nearestLow: researchBoundaryRow(nearestLow, resolvedCurrentPrice),
    nearestHigh: researchBoundaryRow(nearestHigh, resolvedCurrentPrice),
    strongestLow: researchBoundaryRow(strongestLow, resolvedCurrentPrice),
    strongestHigh: researchBoundaryRow(strongestHigh, resolvedCurrentPrice),
    highStackSpreadPct: round(spreadPct(highPrices), 4),
    lowStackSpreadPct: round(spreadPct(lowPrices), 4),
    highStack: stack(highsAbove),
    lowStack: stack(lowsBelow),
    sideMismatch: stack(sideMismatch),
    researchOnly: true,
  });
}

export const LOCAL_STRUCTURE_RESEARCH_VERSION = "v6.2-relational-shadow-2026-08";
'''
text = text.replace(anchor, insert + '\n' + anchor, 1)
context_path.write_text(text)

# 2) Runtime import and diagnostics.
runtime_path = Path('signal-lab-v7-multi-timeframe-review-runtime.js')
runtime = runtime_path.read_text()
old_import = 'import { LEVEL_CONTEXT_RESEARCH_VERSION, buildLevelResearchContexts, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";'
new_import = 'import { LEVEL_CONTEXT_RESEARCH_VERSION, LOCAL_STRUCTURE_RESEARCH_VERSION, buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";'
if old_import not in runtime:
    raise SystemExit('runtime v8 import anchor not found')
runtime = runtime.replace(old_import, new_import, 1)

format_anchor = 'function formatLevelResearchContextRow(row) {\n'
format_insert = r'''function formatResearchBoundary(row) {
  if (!row) return "—";
  const map = row.candidateState === "VISIBLE_MAP" ? "VISIBLE" : "shadow";
  return `${debugNumber(row.price, row.price >= 1000 ? 1 : 6)}(Q${row.qualityScore ?? "—"}/R${row.relevanceScore ?? "—"}/${map}/d${debugNumber(row.distancePct, 2)}%)`;
}

function formatResearchBracket(label, bracket) {
  if (!bracket) return `${label} | unavailable`;
  return [
    label,
    `LOW=${formatResearchBoundary(bracket.low)}`,
    `HIGH=${formatResearchBoundary(bracket.high)}`,
    `width=${debugNumber(bracket.widthPct, 3)}%/${debugNumber(bracket.widthNatr, 2)}N`,
    `pos=${debugNumber(bracket.currentPosition === null ? null : bracket.currentPosition * 100, 1)}%`,
    `inside=${bracket.containedLevels}`,
    `map=${bracket.visibleLevels}V/${bracket.shadowLevels}S`,
  ].join(" | ");
}

function formatResearchStack(label, rows) {
  const source = Array.isArray(rows) ? rows : [];
  if (!source.length) return `${label} | none`;
  return `${label} | ${source.map(formatResearchBoundary).join(" ; ")}`;
}

function formatLocalStructureResearchContext(row) {
  if (!row || row.state === "UNKNOWN") return ["LOCAL STRUCTURE | unavailable"];
  const counts = row.counts ?? {};
  return [
    `LOCAL STRUCTURE ${LOCAL_STRUCTURE_RESEARCH_VERSION} · RESEARCH ONLY · relational, no signal score`,
    [
      "STRUCT WINDOW",
      `current=${debugNumber(row.currentPrice, row.currentPrice >= 1000 ? 1 : 6)}`,
      `natr=${debugNumber(row.currentNatrPct, 3)}%`,
      `1%=${counts.within1Pct ?? 0}`,
      `2%=${counts.within2Pct ?? 0}`,
      `5%=${counts.within5Pct ?? 0}`,
      `HIGH↑=${counts.highsAbove ?? 0}`,
      `LOW↓=${counts.lowsBelow ?? 0}`,
      `mismatch=${counts.sideMismatch ?? 0}`,
      `map=${counts.visible ?? 0}V/${counts.shadow ?? 0}S`,
      `highSpread=${debugNumber(row.highStackSpreadPct, 3)}%`,
      `lowSpread=${debugNumber(row.lowStackSpreadPct, 3)}%`,
    ].join(" | "),
    formatResearchBracket("STRUCT NEAREST", row.nearestBracket),
    formatResearchBracket("STRUCT QUALITY", row.strongestBracket),
    formatResearchStack("STACK HIGH↑", row.highStack),
    formatResearchStack("STACK LOW↓", row.lowStack),
    formatResearchStack("SIDE MISMATCH", row.sideMismatch),
  ];
}

'''
if format_anchor not in runtime:
    raise SystemExit('runtime formatter anchor not found')
runtime = runtime.replace(format_anchor, format_insert + format_anchor, 1)

old_context = '''  const levelContextRows = [...buildLevelResearchContexts(levelContextPool, {
    candlesByTimeframe: state.candlesByTimeframe,
    viewTimeframe: state.viewTimeframe,
    endAt: state.endAt,
  })];
  window.__INPULS_LEVEL_CONTEXT_CANDIDATES__ = levelContextPool;
  window.__INPULS_LEVEL_CONTEXT__ = levelContextRows;
  const candleTraceRows = [...buildCandleTraceRows(state)];
  panel.textContent = [
    `DEBUG V6 LEVEL CONTEXT · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,
    `LEVEL CONTEXT ${LEVEL_CONTEXT_RESEARCH_VERSION} · RESEARCH ONLY · pool=${levelContextPool.length} visible=${levelContextRows.filter((row) => row.candidateState === "VISIBLE_MAP").length} shadow=${levelContextRows.filter((row) => row.candidateState !== "VISIBLE_MAP").length} · Q=structural geometry · R=0-5% current relevance`,
    ...levelContextRows.map(formatLevelResearchContextRow),
'''
new_context = '''  const levelContextRows = [...buildLevelResearchContexts(levelContextPool, {
    candlesByTimeframe: state.candlesByTimeframe,
    viewTimeframe: state.viewTimeframe,
    endAt: state.endAt,
  })];
  window.__INPULS_LEVEL_CONTEXT_CANDIDATES__ = levelContextPool;
  window.__INPULS_LEVEL_CONTEXT__ = levelContextRows;
  const viewVolatility = buildStructuralVolatilityContext(state?.candlesByTimeframe?.[state.viewTimeframe] ?? []);
  const localStructureContext = buildLocalStructureResearchContext(levelContextRows, {
    currentPrice: viewVolatility.currentPrice,
    currentNatrPct: viewVolatility.currentNatrPct,
  });
  window.__INPULS_LOCAL_STRUCTURE_CONTEXT__ = localStructureContext;
  const localStructureLines = formatLocalStructureResearchContext(localStructureContext);
  const candleTraceRows = [...buildCandleTraceRows(state)];
  panel.textContent = [
    `DEBUG V6.2 LOCAL STRUCTURE · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,
    ...localStructureLines,
    `LEVEL CONTEXT ${LEVEL_CONTEXT_RESEARCH_VERSION} · RESEARCH ONLY · pool=${levelContextPool.length} visible=${levelContextRows.filter((row) => row.candidateState === "VISIBLE_MAP").length} shadow=${levelContextRows.filter((row) => row.candidateState !== "VISIBLE_MAP").length} · Q=structural geometry · R=0-5% current relevance`,
    ...levelContextRows.map(formatLevelResearchContextRow),
'''
if old_context not in runtime:
    raise SystemExit('runtime context block anchor not found')
runtime = runtime.replace(old_context, new_context, 1)
runtime_path.write_text(runtime)

# 3) Focused tests.
test_path = Path('test/signal-lab-v8-level-context.test.js')
tests = test_path.read_text()
old_test_import = 'import { buildLevelResearchContexts, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";'
new_test_import = 'import { buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";'
if old_test_import not in tests:
    raise SystemExit('test import anchor not found')
tests = tests.replace(old_test_import, new_test_import, 1)
tests += r'''

test("V6.2 separates nearest execution bracket from strongest structural bracket", () => {
  const contexts = [
    { id: "low", side: "LOW", price: 98, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 45 }, relevance: { score: 36 } },
    { id: "near-high", side: "HIGH", price: 101, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 20 }, relevance: { score: 48 } },
    { id: "strong-high", side: "HIGH", price: 104, currentPrice: 100, candidateState: "VISIBLE_MAP", quality: { score: 90 }, relevance: { score: 12 } },
  ];
  const row = buildLocalStructureResearchContext(contexts, { currentPrice: 100, currentNatrPct: 2 });
  assert.equal(row.nearestBracket.low.id, "low");
  assert.equal(row.nearestBracket.high.id, "near-high");
  assert.equal(row.strongestBracket.low.id, "low");
  assert.equal(row.strongestBracket.high.id, "strong-high");
  assert.equal(row.researchOnly, true);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "score"), false);
});

test("V6.2 reports local density and ignores levels outside the 0-5% window", () => {
  const contexts = [
    { id: "h1", side: "HIGH", price: 100.5, currentPrice: 100, candidateState: "VISIBLE_MAP", quality: { score: 50 }, relevance: { score: 50 } },
    { id: "l1", side: "LOW", price: 98.5, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 50 }, relevance: { score: 50 } },
    { id: "far", side: "HIGH", price: 108, currentPrice: 100, candidateState: "VISIBLE_MAP", quality: { score: 100 }, relevance: { score: 0 } },
  ];
  const row = buildLocalStructureResearchContext(contexts, { currentPrice: 100, currentNatrPct: 1 });
  assert.equal(row.counts.within1Pct, 1);
  assert.equal(row.counts.within2Pct, 2);
  assert.equal(row.counts.within5Pct, 2);
  assert.equal(row.counts.visible, 1);
  assert.equal(row.counts.shadow, 1);
  assert.ok(row.nearestBracket.widthPct > 0);
  assert.ok(row.nearestBracket.widthNatr > 0);
});

test("V6.2 exposes side-mismatch candidates without interpreting them as support/resistance", () => {
  const contexts = [
    { id: "low-above", side: "LOW", price: 101, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 40 }, relevance: { score: 40 } },
    { id: "high-below", side: "HIGH", price: 99, currentPrice: 100, candidateState: "SHADOW_CANDIDATE", quality: { score: 40 }, relevance: { score: 40 } },
  ];
  const row = buildLocalStructureResearchContext(contexts, { currentPrice: 100, currentNatrPct: 1 });
  assert.equal(row.counts.sideMismatch, 2);
  assert.equal(row.nearestBracket, null);
  assert.equal(row.sideMismatch.length, 2);
});
'''
test_path.write_text(tests)

# 4) Keep standalone bundle compatible with the v8 module import.
builder_path = Path('scripts/build-structural-extremes-review-bundle.py')
builder = builder_path.read_text()
read_anchor = 'levels_source = read("signal-lab-v7-multi-timeframe-levels.js")\nmulti_runtime_source = read("signal-lab-v7-multi-timeframe-review-runtime.js")'
if read_anchor not in builder:
    raise SystemExit('bundle source read anchor not found')
builder = builder.replace(
    read_anchor,
    'levels_source = read("signal-lab-v7-multi-timeframe-levels.js")\nlevel_context_source = read("signal-lab-v8-level-context.js")\nmulti_runtime_source = read("signal-lab-v7-multi-timeframe-review-runtime.js")',
    1,
)
metadata_anchor = '''multi_runtime_source = replace_import(
    multi_runtime_source,
    r'import\s+\{([\s\S]*?)\}\s+from\s+["\']\.\/signal-lab-v7-binance-market-metadata\.js[^"\']*["\'];',
    lambda match: f'import {{{match.group(1)}}} from "__METADATA_URL__";',
    "market metadata in review runtime",
)
'''
if metadata_anchor not in builder:
    raise SystemExit('bundle metadata import anchor not found')
builder = builder.replace(metadata_anchor, metadata_anchor + '''level_context_source = replace_import(
    level_context_source,
    r'import\s+\{([\s\S]*?)\}\s+from\s+["\']\.\/signal-lab-v7-multi-timeframe-levels\.js[^"\']*["\'];',
    lambda match: f'import {{{match.group(1)}}} from "__LEVELS_URL__";',
    "multi-timeframe levels in level context",
)
multi_runtime_source = replace_import(
    multi_runtime_source,
    r'import\s+\{([\s\S]*?)\}\s+from\s+["\']\.\/signal-lab-v8-level-context\.js[^"\']*["\'];',
    lambda match: f'import {{{match.group(1)}}} from "__LEVEL_CONTEXT_URL__";',
    "level context in review runtime",
)
''', 1)
loader_anchor = '''    const levelsUrl = moduleUrl(decode({json.dumps(b64(levels_source))}));
    const multiRuntimeUrl = moduleUrl(
      decode({json.dumps(b64(multi_runtime_source))})
        .replaceAll("__LEVELS_URL__", levelsUrl)
        .replaceAll("__METADATA_URL__", metadataUrl),
    );
'''
if loader_anchor not in builder:
    raise SystemExit('bundle loader anchor not found')
builder = builder.replace(loader_anchor, '''    const levelsUrl = moduleUrl(decode({json.dumps(b64(levels_source))}));
    const levelContextUrl = moduleUrl(
      decode({json.dumps(b64(level_context_source))}).replaceAll("__LEVELS_URL__", levelsUrl),
    );
    const multiRuntimeUrl = moduleUrl(
      decode({json.dumps(b64(multi_runtime_source))})
        .replaceAll("__LEVELS_URL__", levelsUrl)
        .replaceAll("__METADATA_URL__", metadataUrl)
        .replaceAll("__LEVEL_CONTEXT_URL__", levelContextUrl),
    );
''', 1)
builder_path.write_text(builder)
