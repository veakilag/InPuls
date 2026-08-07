from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:160]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "owner-signal-lab-structural-extremes-review.js",
    '''function updateAnnotations() {\n  chart.setAnnotations(annotationRows(current?.snapshot));''',
    '''function updateAnnotations() {\n  // V4.10 diagnostics bridge: expose only the trader review corrections so the\n  // isolated multi-TF calibration overlay can compare algorithmic local levels\n  // with manual ETALON points using the same causal pre-pivot geometry.\n  window.__INPULS_STRUCTURAL_REVIEW_CORRECTIONS__ = structuredClone(reviewCorrections);\n  chart.setAnnotations(annotationRows(current?.snapshot));''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''function addDiagnosticPanel(state, levelMap) {''',
    '''function buildManualEtalonDiagnosticRows(state) {\n  const corrections = Array.isArray(window.__INPULS_STRUCTURAL_REVIEW_CORRECTIONS__)\n    ? window.__INPULS_STRUCTURAL_REVIEW_CORRECTIONS__\n    : [];\n  const timeframe = state?.viewTimeframe;\n  if (!(["1m", "5m"].includes(timeframe))) return Object.freeze([]);\n  const candles = state?.candlesByTimeframe?.[timeframe] ?? [];\n  const volatility = buildStructuralVolatilityContext(candles);\n  const rows = [];\n  for (const correction of corrections) {\n    if (correction?.type !== "ADD_EXTREME" || correction?.timeframe !== timeframe) continue;\n    if (!(["HIGH", "LOW"].includes(correction?.side))) continue;\n    const price = finite(correction?.price);\n    const extremeAt = finite(correction?.time);\n    if (!(price > 0) || extremeAt === null) continue;\n    const pseudoLevel = {\n      id: correction.id ?? `manual:${timeframe}:${correction.side}:${extremeAt}:${price}`,\n      side: correction.side,\n      price,\n      extremeAt,\n      nativeExtremeAt: extremeAt,\n      sourceTimeframe: timeframe,\n      sources: [timeframe],\n      attackCount: 1,\n      active: true,\n    };\n    const workingPivot = structuralLocalWorkingSetPivotDecision(pseudoLevel, candles, volatility);\n    const distanceBaseNatr = structuralDistanceBaseNatr(price, volatility);\n    rows.push(Object.freeze({\n      id: correction.id ?? null,\n      side: correction.side,\n      timeframe,\n      price,\n      extremeAt,\n      workingPivot,\n      distanceBaseNatr,\n      maxDistanceBaseNatr: finite(LOCAL_WORKING_SET_POLICY[timeframe]?.maxDistanceBaseNatr),\n    }));\n  }\n  return Object.freeze(rows);\n}\n\nfunction formatManualEtalonDiagnosticRow(row) {\n  const work = `${row.workingPivot?.visible === false ? "FAIL" : "PASS"}:${row.workingPivot?.reason ?? "—"}`;\n  return [\n    `ETALON ${row.side} ${row.timeframe} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)}`,\n    `work=${work}`,\n    `retr=${debugPercentRatio(row.workingPivot?.retracementRatio)} min=${debugPercentRatio(row.workingPivot?.minimumRetracementRatio)}`,\n    `prior=${debugNumber(row.workingPivot?.priorImpulseBaseNatr, 2)}N`,\n    `peak=${debugNumber(row.workingPivot?.peakPrice, row.price >= 1000 ? 1 : 6)}`,\n    `origin=${debugNumber(row.workingPivot?.originLow, row.price >= 1000 ? 1 : 6)}`,\n    `dist=${debugNumber(row.distanceBaseNatr, 2)}N/${debugNumber(row.maxDistanceBaseNatr, 1)}N`,\n  ].join(" | ");\n}\n\nfunction addDiagnosticPanel(state, levelMap) {''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''  panel.textContent = [\n    `DEBUG V4.10 · ${state.viewTimeframe} · visible local levels ${localRows.length}`,\n    ...localRows.map(formatDiagnosticRow),\n  ].join("\\n");''',
    '''  const manualEtalons = buildManualEtalonDiagnosticRows(state)\n    .sort((left, right) => (right.price ?? 0) - (left.price ?? 0));\n  panel.textContent = [\n    `DEBUG V4.10 · ${state.viewTimeframe} · visible local levels ${localRows.length}`,\n    ...localRows.map(formatDiagnosticRow),\n    `ETALON DEBUG · manual levels ${manualEtalons.length}`,\n    ...manualEtalons.map(formatManualEtalonDiagnosticRow),\n  ].join("\\n");''',
)
