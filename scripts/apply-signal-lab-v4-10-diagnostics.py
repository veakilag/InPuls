from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "signal-lab-v7-multi-timeframe-review-runtime.js"
text = RUNTIME.read_text(encoding="utf-8")

old_import = '''import {\n  STRUCTURAL_TF_LOOKBACK_MS,\n  buildHierarchicalStructuralLevelMap,\n  structuralLevelLabel,\n  visibleSourceTimeframes,\n} from "./signal-lab-v7-multi-timeframe-levels.js";'''
new_import = '''import {\n  LOCAL_WORKING_SET_POLICY,\n  STRUCTURAL_TF_LOOKBACK_MS,\n  buildHierarchicalStructuralLevelMap,\n  buildStructuralVolatilityContext,\n  structuralChildAdmissionDecision,\n  structuralDistanceBaseNatr,\n  structuralLevelLabel,\n  structuralLocalPivotProminenceDecision,\n  structuralLocalWorkingSetPivotDecision,\n  visibleSourceTimeframes,\n} from "./signal-lab-v7-multi-timeframe-levels.js";'''
if text.count(old_import) != 1:
    raise RuntimeError("runtime import block not found exactly once")
text = text.replace(old_import, new_import, 1)

anchor = '''function addContextStatus(state, levelMap) {\n  const status = document.querySelector("#status");\n  if (!status) return;\n  let context = document.querySelector("#multi-tf-context-status");\n  if (!context) {\n    context = document.createElement("div");\n    context.id = "multi-tf-context-status";\n    context.style.marginTop = "6px";\n    context.style.fontSize = "12px";\n    context.style.opacity = "0.8";\n    status.insertAdjacentElement("afterend", context);\n  }\n  const sources = visibleSourceTimeframes(state.viewTimeframe).slice().reverse().join(" → ");\n  context.textContent = `Иерархия: ${sources} · уровней ${levelMap.length} · 1д/4ч/1ч: 6 мес · 15м/5м/1м: 1 мес`;\n}\n'''
if text.count(anchor) != 1:
    raise RuntimeError("addContextStatus block not found exactly once")

diagnostics = r'''
function debugNumber(value, digits = 2) {
  const number = finite(value);
  return number === null ? "—" : number.toFixed(digits);
}

function debugPercentRatio(value) {
  const number = finite(value);
  return number === null ? "—" : `${(number * 100).toFixed(1)}%`;
}

function findNativeExtreme(state, level) {
  const snapshot = state.snapshotsByTimeframe?.[level?.sourceTimeframe];
  const rows = [
    ...(Array.isArray(snapshot?.active) ? snapshot.active : []),
    ...(Array.isArray(snapshot?.history) ? snapshot.history : []),
  ];
  const byId = rows.find((row) => row?.id && row.id === level?.id);
  if (byId) return byId;
  const targetAt = finite(level?.nativeExtremeAt ?? level?.extremeAt);
  const targetPrice = finite(level?.price);
  return rows.find((row) => {
    if (row?.side !== level?.side) return false;
    const rowAt = finite(row?.extremeAt);
    const rowPrice = finite(row?.price);
    return rowAt === targetAt && rowPrice !== null && targetPrice !== null
      && Math.abs(rowPrice - targetPrice) <= Math.max(1e-9, Math.abs(targetPrice) * 1e-8);
  }) ?? null;
}

export function buildStructuralReviewDiagnosticRows(state, levelMap) {
  const rows = [];
  for (const level of Array.isArray(levelMap) ? levelMap : []) {
    const timeframe = level?.sourceTimeframe;
    if (!(["1m", "5m"].includes(timeframe)) || level?.active === false) continue;
    const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
    const volatility = buildStructuralVolatilityContext(candles);
    const extreme = findNativeExtreme(state, level);
    const significance = extreme
      ? structuralChildAdmissionDecision(extreme, timeframe, { volatilityContext: volatility })
      : { admitted: null, reason: "DEBUG_NATIVE_EXTREME_NOT_FOUND" };
    const prominence = structuralLocalPivotProminenceDecision(
      extreme ?? level,
      timeframe,
      candles,
      volatility,
    );
    const workingPivot = structuralLocalWorkingSetPivotDecision(level, candles, volatility);
    const distanceBaseNatr = structuralDistanceBaseNatr(level?.price, volatility);
    const maxDistanceBaseNatr = finite(LOCAL_WORKING_SET_POLICY[timeframe]?.maxDistanceBaseNatr);
    const sources = Array.isArray(level?.sources) ? level.sources : [timeframe].filter(Boolean);
    const confluenceBypass = sources.length > 1 || Number(level?.confluenceCount) > 1;
    const attackBypass = (Number(level?.attackCount) || 1) > 1;
    rows.push(Object.freeze({
      id: level?.id ?? null,
      side: level?.side ?? null,
      timeframe,
      price: finite(level?.price),
      attackCount: Math.max(1, Number(level?.attackCount) || 1),
      sources: Object.freeze([...sources]),
      confluenceBypass,
      attackBypass,
      significance,
      prominence,
      workingPivot,
      distanceBaseNatr,
      maxDistanceBaseNatr,
      nativeExtremeFound: Boolean(extreme),
      nativeExtremeAt: finite(extreme?.extremeAt),
      levelExtremeAt: finite(level?.nativeExtremeAt ?? level?.extremeAt),
    }));
  }
  return Object.freeze(rows);
}

function formatDiagnosticRow(row) {
  const bypass = row.confluenceBypass
    ? "CONFLUENCE"
    : row.attackBypass ? "ATTACK_XN" : "none";
  const sig = `${row.significance?.admitted === false ? "FAIL" : row.significance?.admitted === true ? "PASS" : "?"}:${row.significance?.reason ?? "—"}`;
  const prom = `${row.prominence?.admitted === false ? "FAIL" : row.prominence?.admitted === true ? "PASS" : "?"}:${row.prominence?.reason ?? "—"}`;
  const work = `${row.workingPivot?.visible === false ? "FAIL" : "PASS"}:${row.workingPivot?.reason ?? "—"}`;
  return [
    `${row.side} ${row.timeframe} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)} ×${row.attackCount}`,
    `native=${row.nativeExtremeFound ? "yes" : "NO"}`,
    `bypass=${bypass}`,
    `sig=${sig}`,
    `swing=${debugNumber(row.significance?.swingPct, 3)}%/req=${debugNumber(row.significance?.requiredSwingPct, 3)}%`,
    `prom=${prom}`,
    `in=${debugNumber(row.prominence?.incomingBaseNatr, 2)}N out=${debugNumber(row.prominence?.outgoingBaseNatr, 2)}N`,
    `retr=${debugPercentRatio(row.prominence?.retracementRatio)} min=${debugPercentRatio(row.prominence?.minimumRetracementRatio)}`,
    `prior=${debugNumber(row.prominence?.priorImpulseBaseNatr, 2)}N`,
    `work=${work}`,
    `workRetr=${debugPercentRatio(row.workingPivot?.retracementRatio)} min=${debugPercentRatio(row.workingPivot?.minimumRetracementRatio)}`,
    `dist=${debugNumber(row.distanceBaseNatr, 2)}N/${debugNumber(row.maxDistanceBaseNatr, 1)}N`,
  ].join(" | ");
}

function addDiagnosticPanel(state, levelMap) {
  const params = new URL(window.location.href).searchParams;
  const debugEnabled = params.get("debug") === "1";
  let panel = document.querySelector("#structural-level-debug");
  if (!debugEnabled) {
    panel?.remove();
    return;
  }
  const context = document.querySelector("#multi-tf-context-status");
  if (!context) return;
  if (!panel) {
    panel = document.createElement("pre");
    panel.id = "structural-level-debug";
    panel.style.margin = "8px 0 12px";
    panel.style.padding = "10px";
    panel.style.border = "1px solid rgba(255,255,255,0.14)";
    panel.style.borderRadius = "8px";
    panel.style.background = "rgba(255,255,255,0.035)";
    panel.style.fontSize = "11px";
    panel.style.lineHeight = "1.45";
    panel.style.whiteSpace = "pre-wrap";
    panel.style.userSelect = "text";
    context.insertAdjacentElement("afterend", panel);
  }
  const diagnostics = buildStructuralReviewDiagnosticRows(state, levelMap);
  window.__INPULS_STRUCTURAL_DEBUG__ = diagnostics;
  const localRows = diagnostics
    .filter((row) => row.timeframe === state.viewTimeframe)
    .sort((left, right) => (right.price ?? 0) - (left.price ?? 0));
  panel.textContent = [
    `DEBUG V4.10 · ${state.viewTimeframe} · visible local levels ${localRows.length}`,
    ...localRows.map(formatDiagnosticRow),
  ].join("\n");
}
'''
text = text.replace(anchor, anchor + diagnostics, 1)

old_call = '''  state.levelMap = levelMap;\n  addContextStatus(state, levelMap);\n  return [...keptBase, ...overlays];'''
new_call = '''  state.levelMap = levelMap;\n  addContextStatus(state, levelMap);\n  addDiagnosticPanel(state, levelMap);\n  return [...keptBase, ...overlays];'''
if text.count(old_call) != 1:
    raise RuntimeError("combineAnnotations status call not found exactly once")
text = text.replace(old_call, new_call, 1)

RUNTIME.write_text(text, encoding="utf-8")
