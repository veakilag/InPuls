from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "signal-lab-v7-multi-timeframe-review-runtime.js"
text = TARGET.read_text(encoding="utf-8")

anchor = '''function buildManualEtalonDiagnosticRows(state) {'''
helper = r'''function buildRawNativeDiagnosticRows(state) {
  const timeframe = state?.viewTimeframe;
  if (!(["1m", "5m"].includes(timeframe))) return Object.freeze([]);
  const snapshot = state?.snapshotsByTimeframe?.[timeframe];
  if (!snapshot) return Object.freeze([]);
  const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
  const volatility = buildStructuralVolatilityContext(candles);

  const rows = [];
  const push = (extreme, bucket) => {
    if (!extreme || !(["HIGH", "LOW"].includes(extreme?.side))) return;
    const pseudoLevel = {
      ...extreme,
      id: extreme?.id ?? `raw:${bucket}:${timeframe}:${extreme?.side}:${extreme?.extremeAt}:${extreme?.price}`,
      sourceTimeframe: timeframe,
      nativeExtremeAt: extreme?.extremeAt,
      sources: [timeframe],
      confluenceCount: 1,
      attackCount: Math.max(1, Number(extreme?.attackCount) || Number(extreme?.touchCount) || 1),
      active: extreme?.active !== false,
    };
    const significance = structuralChildAdmissionDecision(extreme, timeframe, { volatilityContext: volatility });
    const prominence = structuralLocalPivotProminenceDecision(extreme, timeframe, candles, volatility);
    const workingPivot = structuralLocalWorkingSetPivotDecision(pseudoLevel, candles, volatility);
    rows.push(Object.freeze({
      bucket,
      side: extreme?.side ?? null,
      price: finite(extreme?.price),
      extremeAt: finite(extreme?.extremeAt),
      confirmedAt: finite(extreme?.confirmedAt),
      status: extreme?.status ?? null,
      swingPct: finite(extreme?.swingAmplitudePct),
      reversalPct: finite(extreme?.confirmingReversalPct),
      significance,
      prominence,
      workingPivot,
      distanceBaseNatr: structuralDistanceBaseNatr(extreme?.price, volatility),
    }));
  };

  push(snapshot?.candidate, "candidate");
  push(snapshot?.oppositeCandidate, "opposite");
  for (const extreme of Array.isArray(snapshot?.active) ? snapshot.active : []) push(extreme, "active");
  for (const extreme of Array.isArray(snapshot?.history) ? snapshot.history : []) push(extreme, "history");

  return Object.freeze(rows
    .sort((left, right) => (right.extremeAt ?? -Infinity) - (left.extremeAt ?? -Infinity))
    .slice(0, 30));
}

function formatRawNativeDiagnosticRow(row) {
  const sig = `${row.significance?.admitted === false ? "FAIL" : row.significance?.admitted === true ? "PASS" : "?"}:${row.significance?.reason ?? "—"}`;
  const prom = `${row.prominence?.admitted === false ? "FAIL" : row.prominence?.admitted === true ? "PASS" : "?"}:${row.prominence?.reason ?? "—"}`;
  const work = `${row.workingPivot?.visible === false ? "FAIL" : "PASS"}:${row.workingPivot?.reason ?? "—"}`;
  const at = row.extremeAt === null ? "—" : new Date(row.extremeAt).toISOString().slice(11, 16);
  const confirmed = row.confirmedAt === null ? "—" : new Date(row.confirmedAt).toISOString().slice(11, 16);
  return [
    `${row.bucket.toUpperCase()} ${row.side} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)}`,
    `at=${at} conf=${confirmed}`,
    `status=${row.status ?? "—"}`,
    `swing=${debugNumber(row.swingPct, 3)}% rev=${debugNumber(row.reversalPct, 3)}%`,
    `sig=${sig}`,
    `prom=${prom}`,
    `work=${work}`,
    `dist=${debugNumber(row.distanceBaseNatr, 2)}N`,
  ].join(" | ");
}

'''
if anchor not in text:
    raise SystemExit("manual diagnostic anchor not found")
if "function buildRawNativeDiagnosticRows" not in text:
    text = text.replace(anchor, helper + anchor, 1)

old = '''  const manualEtalons = [...buildManualEtalonDiagnosticRows(state)]
    .sort((left, right) => (right.price ?? 0) - (left.price ?? 0));
  panel.textContent = [
    `DEBUG V4.10 · ${state.viewTimeframe} · visible local levels ${localRows.length}`,
    ...localRows.map(formatDiagnosticRow),
    `ETALON DEBUG · manual levels ${manualEtalons.length}`,
    ...manualEtalons.map(formatManualEtalonDiagnosticRow),
  ].join("\\n");'''
new = '''  const manualEtalons = [...buildManualEtalonDiagnosticRows(state)]
    .sort((left, right) => (right.price ?? 0) - (left.price ?? 0));
  const rawNativeRows = [...buildRawNativeDiagnosticRows(state)];
  panel.textContent = [
    `DEBUG V4.18 · ${state.viewTimeframe} · visible local levels ${localRows.length}`,
    ...localRows.map(formatDiagnosticRow),
    `RAW NATIVE DEBUG · recent ${rawNativeRows.length}`,
    ...rawNativeRows.map(formatRawNativeDiagnosticRow),
    `ETALON DEBUG · manual levels ${manualEtalons.length}`,
    ...manualEtalons.map(formatManualEtalonDiagnosticRow),
  ].join("\\n");'''
if old not in text:
    raise SystemExit("diagnostic panel anchor not found")
text = text.replace(old, new, 1)
TARGET.write_text(text, encoding="utf-8")
