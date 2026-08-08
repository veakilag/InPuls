from pathlib import Path

runtime_path = Path('signal-lab-v7-multi-timeframe-review-runtime.js')
text = runtime_path.read_text()

old_import = '''  structuralLocalWorkingSetPivotDecision,\n  structuralTrendLegQualificationDecision,\n  visibleSourceTimeframes,\n'''
new_import = '''  structuralLocalWorkingSetPivotDecision,\n  structuralNatrAt,\n  structuralTrendLegQualificationDecision,\n  visibleSourceTimeframes,\n'''
if old_import not in text:
    raise SystemExit('runtime import insertion point not found')
text = text.replace(old_import, new_import, 1)

anchor = '''function debugPercentRatio(value) {\n  const number = finite(value);\n  return number === null ? "—" : `${(number * 100).toFixed(1)}%`;\n}\n'''
insert = r'''

// V5.3 shadow-only diagnostics. This deliberately does NOT decide visibility.
// It measures the trader-described geometry of a meaningful 5m turn: price must
// arrive into the extremum and then separate from it. Fixed 1/3/6-bar windows
// make algorithm extrema and manual etalons comparable without using the
// detector's own confirmation threshold as the answer we are trying to learn.
export function structuralVShapeShadowMetrics({
  side,
  price,
  extremeAt,
  confirmedAt = null,
  confirmingReversalPct = null,
  candles = [],
  volatilityContext = null,
  intervalMs = 300_000,
  zoneNatr = 0.35,
} = {}) {
  if (!(side === "LOW" || side === "HIGH")) return null;
  const pivotPrice = finite(price);
  const pivotAt = finite(extremeAt);
  if (!(pivotPrice > 0) || pivotAt === null) return null;

  const rows = (Array.isArray(candles) ? candles : [])
    .filter((row) => finite(row?.time) !== null && finite(row?.high) > 0 && finite(row?.low) > 0)
    .slice()
    .sort((left, right) => Number(left.time) - Number(right.time));
  const pivotIndex = rows.findIndex((row) => finite(row?.time) === pivotAt);
  if (pivotIndex < 0) return null;

  const natrAtPivot = structuralNatrAt(volatilityContext, pivotAt);
  const baseNatrPct = finite(volatilityContext?.baseNatrPct);
  const scaleNatrPct = natrAtPivot && natrAtPivot > 0 ? natrAtPivot : baseNatrPct;
  const movePct = (reference) => {
    const value = finite(reference);
    if (!(value > 0)) return null;
    return Math.abs(value - pivotPrice) / pivotPrice * 100;
  };
  const normalize = (pct) => pct !== null && scaleNatrPct > 0 ? pct / scaleNatrPct : null;
  const reference = (window, incoming) => {
    if (!window.length) return null;
    if (side === "LOW") return Math.max(...window.map((row) => Number(row.high)));
    return Math.min(...window.map((row) => Number(row.low)));
  };

  const windows = {};
  for (const bars of [1, 3, 6]) {
    const before = rows.slice(Math.max(0, pivotIndex - bars), pivotIndex);
    const after = rows.slice(pivotIndex + 1, pivotIndex + 1 + bars);
    const incomingPct = movePct(reference(before, true));
    const outgoingPct = movePct(reference(after, false));
    const incomingNatr = normalize(incomingPct);
    const outgoingNatr = normalize(outgoingPct);
    windows[bars] = Object.freeze({
      bars,
      incomingPct,
      outgoingPct,
      incomingNatr,
      outgoingNatr,
      vBalanceNatr: incomingNatr !== null && outgoingNatr !== null
        ? Math.min(incomingNatr, outgoingNatr)
        : null,
    });
  }

  const zonePct = scaleNatrPct > 0 ? scaleNatrPct * Math.max(0, Number(zoneNatr) || 0) : null;
  const nextSix = rows.slice(pivotIndex + 1, pivotIndex + 7);
  let defenseReturns6 = null;
  if (zonePct !== null) {
    defenseReturns6 = nextSix.reduce((count, row) => {
      const touchPrice = side === "LOW" ? finite(row?.low) : finite(row?.high);
      if (!(touchPrice > 0)) return count;
      const distancePct = Math.abs(touchPrice - pivotPrice) / pivotPrice * 100;
      return count + (distancePct <= zonePct ? 1 : 0);
    }, 0);
  }

  const confirmed = finite(confirmedAt);
  const safeIntervalMs = Math.max(1, Math.round(finite(intervalMs) ?? 300_000));
  const confirmationBars = confirmed === null
    ? null
    : Math.max(0, Math.round(((confirmed + 1) - (pivotAt + safeIntervalMs)) / safeIntervalMs));
  const reversalPct = finite(confirmingReversalPct);
  const confirmingReversalNatr = normalize(reversalPct);
  const confirmingReversalNatrPerBar = confirmingReversalNatr !== null && confirmationBars !== null
    ? confirmingReversalNatr / Math.max(1, confirmationBars)
    : null;

  return Object.freeze({
    side,
    price: pivotPrice,
    extremeAt: pivotAt,
    scaleNatrPct,
    natrAtPivot,
    baseNatrPct,
    zoneNatr,
    defenseReturns6,
    confirmationBars,
    confirmingReversalPct: reversalPct,
    confirmingReversalNatr,
    confirmingReversalNatrPerBar,
    windows: Object.freeze(windows),
  });
}

function buildVShapeShadowDiagnosticRows(state, levelMap) {
  if (state?.viewTimeframe !== "5m") return Object.freeze([]);
  const timeframe = "5m";
  const candles = state?.candlesByTimeframe?.[timeframe] ?? [];
  const snapshot = state?.snapshotsByTimeframe?.[timeframe];
  if (!snapshot || !candles.length) return Object.freeze([]);
  const volatility = buildStructuralVolatilityContext(candles);
  const visibleIds = new Set();
  for (const level of Array.isArray(levelMap) ? levelMap : []) {
    if (level?.id) visibleIds.add(level.id);
    for (const id of Array.isArray(level?.memberIds) ? level.memberIds : []) visibleIds.add(id);
  }

  const rows = [];
  const raw = (Array.isArray(snapshot?.active) ? snapshot.active : [])
    .filter((extreme) => extreme && ["LOW", "HIGH"].includes(extreme.side))
    .slice()
    .sort((left, right) => (finite(left?.extremeAt) ?? Infinity) - (finite(right?.extremeAt) ?? Infinity));
  for (const extreme of raw.slice(-40)) {
    const metrics = structuralVShapeShadowMetrics({
      side: extreme.side,
      price: extreme.price,
      extremeAt: extreme.extremeAt,
      confirmedAt: extreme.confirmedAt,
      confirmingReversalPct: extreme.confirmingReversalPct,
      candles,
      volatilityContext: volatility,
      intervalMs: INTERVAL_MS[timeframe],
    });
    if (!metrics) continue;
    rows.push(Object.freeze({
      kind: "RAW",
      id: extreme.id ?? null,
      side: extreme.side,
      price: finite(extreme.price),
      extremeAt: finite(extreme.extremeAt),
      visible: visibleIds.has(extreme.id),
      metrics,
    }));
  }

  const corrections = Array.isArray(window.__INPULS_STRUCTURAL_REVIEW_CORRECTIONS__)
    ? window.__INPULS_STRUCTURAL_REVIEW_CORRECTIONS__
    : [];
  for (const correction of corrections) {
    if (correction?.type !== "ADD_EXTREME" || correction?.timeframe !== timeframe) continue;
    if (!(correction?.side === "LOW" || correction?.side === "HIGH")) continue;
    const metrics = structuralVShapeShadowMetrics({
      side: correction.side,
      price: correction.price,
      extremeAt: correction.time,
      candles,
      volatilityContext: volatility,
      intervalMs: INTERVAL_MS[timeframe],
    });
    if (!metrics) continue;
    rows.push(Object.freeze({
      kind: "ETALON",
      id: correction.id ?? null,
      side: correction.side,
      price: finite(correction.price),
      extremeAt: finite(correction.time),
      visible: null,
      metrics,
    }));
  }

  return Object.freeze(rows.sort((left, right) => (left.extremeAt ?? 0) - (right.extremeAt ?? 0)));
}

function formatVShapeShadowDiagnosticRow(row) {
  const at = row.extremeAt === null ? "—" : new Date(row.extremeAt).toISOString().slice(11, 16);
  const metric = row.metrics ?? {};
  const windowText = (bars) => {
    const value = metric.windows?.[bars] ?? {};
    return `${bars}b=${debugNumber(value.incomingNatr, 2)}/${debugNumber(value.outgoingNatr, 2)}/V${debugNumber(value.vBalanceNatr, 2)}N`;
  };
  return [
    `VSHAPE ${row.kind} ${row.side} ${debugNumber(row.price, row.price >= 1000 ? 1 : 6)}`,
    `at=${at}`,
    row.visible === null ? "visible=etalon" : `visible=${row.visible ? "YES" : "no"}`,
    `scale=${debugNumber(metric.scaleNatrPct, 3)}%`,
    windowText(1),
    windowText(3),
    windowText(6),
    `def6=${metric.defenseReturns6 ?? "—"}`,
    `conf=${metric.confirmationBars ?? "—"}b`,
    `rev=${debugNumber(metric.confirmingReversalNatr, 2)}N`,
    `revSpeed=${debugNumber(metric.confirmingReversalNatrPerBar, 2)}N/b`,
  ].join(" | ");
}
'''
if anchor not in text:
    raise SystemExit('debugPercentRatio anchor not found')
text = text.replace(anchor, anchor + insert, 1)

old_panel = '''  const v5SourceRows = [...buildV5SourceQualificationDiagnosticRows(state, levelMap)];\n  const candleTraceRows = [...buildCandleTraceRows(state)];\n  panel.textContent = [\n    `DEBUG V5.1 SOURCE TRACE · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,\n    ...localRows.map(formatDiagnosticRow),\n    `V5 SOURCE DEBUG · recent ${v5SourceRows.length}`,\n    ...v5SourceRows.map(formatV5SourceQualificationDiagnosticRow),\n    `RAW NATIVE DEBUG · recent ${rawNativeRows.length}`,\n'''
new_panel = '''  const v5SourceRows = [...buildV5SourceQualificationDiagnosticRows(state, levelMap)];\n  const vShapeRows = [...buildVShapeShadowDiagnosticRows(state, levelMap)];\n  const candleTraceRows = [...buildCandleTraceRows(state)];\n  panel.textContent = [\n    `DEBUG V5.3 SHADOW METRICS · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,\n    ...localRows.map(formatDiagnosticRow),\n    `V-SHAPE SHADOW DEBUG · rows ${vShapeRows.length}`,\n    ...vShapeRows.map(formatVShapeShadowDiagnosticRow),\n    `V5 SOURCE DEBUG · recent ${v5SourceRows.length}`,\n    ...v5SourceRows.map(formatV5SourceQualificationDiagnosticRow),\n    `RAW NATIVE DEBUG · recent ${rawNativeRows.length}`,\n'''
if old_panel not in text:
    raise SystemExit('diagnostic panel insertion point not found')
text = text.replace(old_panel, new_panel, 1)
runtime_path.write_text(text)

# Add a small pure regression for the new shadow metric. It must remain a
# diagnostic function: no visibility/qualification behavior is changed here.
test_path = Path('test/signal-lab-v7-vshape-shadow-metrics.test.js')
test_path.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";

import { structuralVShapeShadowMetrics } from "../signal-lab-v7-multi-timeframe-review-runtime.js";

const STEP = 300_000;
const candle = (index, high, low, close = (high + low) / 2) => ({
  time: index * STEP,
  closeTime: (index + 1) * STEP - 1,
  open: close,
  high,
  low,
  close,
  volume: 1,
  closed: true,
});

const volatilityContext = {
  baseNatrPct: 2,
  times: [0, STEP, 2 * STEP, 3 * STEP, 4 * STEP],
  natrs: [2, 2, 2, 2, 2],
};

test("V-shape shadow metric measures LOW arrival and separation symmetrically in NATR", () => {
  const candles = [
    candle(0, 100, 96),
    candle(1, 96, 90, 92),
    candle(2, 98, 91),
    candle(3, 99, 94),
    candle(4, 100, 95),
  ];
  const metric = structuralVShapeShadowMetrics({
    side: "LOW",
    price: 90,
    extremeAt: STEP,
    confirmedAt: 3 * STEP - 1,
    confirmingReversalPct: 4,
    candles,
    volatilityContext,
    intervalMs: STEP,
  });
  assert.ok(metric);
  assert.equal(metric.scaleNatrPct, 2);
  assert.ok(metric.windows[1].incomingNatr > 5);
  assert.ok(metric.windows[1].outgoingNatr > 4);
  assert.equal(metric.confirmationBars, 1);
  assert.equal(metric.confirmingReversalNatr, 2);
});

test("V-shape shadow metric mirrors HIGH geometry", () => {
  const candles = [
    candle(0, 104, 100),
    candle(1, 110, 104, 108),
    candle(2, 109, 102),
    candle(3, 106, 100),
    candle(4, 105, 99),
  ];
  const metric = structuralVShapeShadowMetrics({
    side: "HIGH",
    price: 110,
    extremeAt: STEP,
    candles,
    volatilityContext,
    intervalMs: STEP,
  });
  assert.ok(metric);
  assert.ok(metric.windows[1].incomingNatr > 4);
  assert.ok(metric.windows[1].outgoingNatr > 3);
});
''')
