from pathlib import Path

path = Path('signal-lab-v7-multi-timeframe-review-runtime.js')
text = path.read_text()

old_import = '''  structuralLocalWorkingSetPivotDecision,\n  visibleSourceTimeframes,\n} from "./signal-lab-v7-multi-timeframe-levels.js";'''
new_import = '''  structuralLocalWorkingSetPivotDecision,\n  structuralTrendLegQualificationDecision,\n  visibleSourceTimeframes,\n} from "./signal-lab-v7-multi-timeframe-levels.js";'''
if old_import not in text:
    raise SystemExit('import anchor not found')
text = text.replace(old_import, new_import, 1)

anchor = '''function buildManualEtalonDiagnosticRows(state) {'''
insert = r'''function buildV5SourceQualificationDiagnosticRows(state, levelMap) {
  const timeframe = state?.viewTimeframe;
  if (!(timeframe === "1m" || timeframe === "5m")) return Object.freeze([]);
  const snapshot = state?.snapshotsByTimeframe?.[timeframe];
  if (!snapshot) return Object.freeze([]);
  const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
  const volatility = buildStructuralVolatilityContext(candles);
  const visibleMemberIds = new Set();
  for (const level of Array.isArray(levelMap) ? levelMap : []) {
    if (level?.id) visibleMemberIds.add(level.id);
    for (const id of Array.isArray(level?.memberIds) ? level.memberIds : []) visibleMemberIds.add(id);
  }

  const active = (Array.isArray(snapshot?.active) ? snapshot.active : [])
    .filter((extreme) => extreme && ["HIGH", "LOW"].includes(extreme.side))
    .slice()
    .sort((left, right) => (finite(left?.extremeAt) ?? Infinity) - (finite(right?.extremeAt) ?? Infinity));

  const lastQualifiedBySide = new Map();
  const rows = [];
  for (const extreme of active) {
    const pseudoLevel = {
      ...extreme,
      id: extreme?.id ?? `v5debug:${timeframe}:${extreme?.side}:${extreme?.extremeAt}:${extreme?.price}`,
      sourceTimeframe: timeframe,
      nativeExtremeAt: extreme?.extremeAt,
      displayAt: extreme?.extremeAt,
      refinedThroughTimeframe: timeframe,
      refinementPath: [{ timeframe, time: extreme?.extremeAt }],
      sources: [timeframe],
      confluenceCount: 1,
      attackCount: Math.max(1, Number(extreme?.attackCount) || Number(extreme?.touchCount) || 1),
      active: extreme?.active !== false,
    };
    const significance = structuralChildAdmissionDecision(extreme, timeframe, { volatilityContext: volatility });
    const prominence = structuralLocalPivotProminenceDecision(extreme, timeframe, candles, volatility);
    const sourceQualityPassed = significance?.admitted !== false && prominence?.admitted !== false;
    const previous = lastQualifiedBySide.get(extreme.side) ?? null;
    const decision = sourceQualityPassed
      ? structuralTrendLegQualificationDecision(pseudoLevel, previous, timeframe, candles)
      : Object.freeze({ qualified: false, reason: "SOURCE_QUALITY_FILTERED_BEFORE_V5" });
    if (sourceQualityPassed && decision.qualified) lastQualifiedBySide.set(extreme.side, pseudoLevel);
    rows.push(Object.freeze({
      side: extreme.side,
      price: finite(extreme.price),
      extremeAt: finite(extreme.extremeAt),
      attackCount: pseudoLevel.attackCount,
      sourceQualityPassed,
      significance,
      prominence,
      previousPrice: finite(previous?.price),
      previousAt: finite(previous?.extremeAt),
      decision,
      visibleAfterHierarchy: visibleMemberIds.has(pseudoLevel.id),
    }));
  }

  return Object.freeze(rows.slice(-30));
}

function formatV5SourceQualificationDiagnosticRow(row) {
  const at = row.extremeAt === null ? "—" : new Date(row.extremeAt).toISOString().slice(11, 16);
  const prevAt = row.previousAt === null ? "—" : new Date(row.previousAt).toISOString().slice(11, 16);
  const verdict = `${row.decision?.qualified ? "PASS" : "FAIL"}:${row.decision?.reason ?? "—"}`;
  return [
    `V5SRC ${row.side} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)} ×${row.attackCount}`,
    `at=${at}`,
    `visible=${row.visibleAfterHierarchy ? "YES" : "no"}`,
    `quality=${row.sourceQualityPassed ? "PASS" : "FAIL"}`,
    `prev=${debugNumber(row.previousPrice, row.price >= 1000 ? 1 : 6)}@${prevAt}`,
    `v5=${verdict}`,
    `leg=${debugNumber(row.decision?.legExtreme, row.price >= 1000 ? 1 : 6)}`,
    `reset=${debugPercentRatio(row.decision?.resetRatio)} min=${debugPercentRatio(row.decision?.minimumLegResetRatio)}`,
    `bars=${debugNumber(row.decision?.anchorBars, 1)}`,
    `in=${debugNumber(row.prominence?.incomingBaseNatr, 2)}N out=${debugNumber(row.prominence?.outgoingBaseNatr, 2)}N`,
    `retr=${debugPercentRatio(row.prominence?.retracementRatio)}`,
  ].join(" | ");
}

'''
if anchor not in text:
    raise SystemExit('manual diagnostic anchor not found')
text = text.replace(anchor, insert + anchor, 1)

old_panel = '''  const rawNativeRows = [...buildRawNativeDiagnosticRows(state)];\n  const candleTraceRows = [...buildCandleTraceRows(state)];\n  panel.textContent = [\n    `DEBUG V4.20 TRACE · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,\n    ...localRows.map(formatDiagnosticRow),\n    `RAW NATIVE DEBUG · recent ${rawNativeRows.length}`,\n    ...rawNativeRows.map(formatRawNativeDiagnosticRow),'''
new_panel = '''  const rawNativeRows = [...buildRawNativeDiagnosticRows(state)];\n  const v5SourceRows = [...buildV5SourceQualificationDiagnosticRows(state, levelMap)];\n  const candleTraceRows = [...buildCandleTraceRows(state)];\n  panel.textContent = [\n    `DEBUG V5.1 SOURCE TRACE · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,\n    ...localRows.map(formatDiagnosticRow),\n    `V5 SOURCE DEBUG · recent ${v5SourceRows.length}`,\n    ...v5SourceRows.map(formatV5SourceQualificationDiagnosticRow),\n    `RAW NATIVE DEBUG · recent ${rawNativeRows.length}`,\n    ...rawNativeRows.map(formatRawNativeDiagnosticRow),'''
if old_panel not in text:
    raise SystemExit('panel anchor not found')
text = text.replace(old_panel, new_panel, 1)

path.write_text(text)
