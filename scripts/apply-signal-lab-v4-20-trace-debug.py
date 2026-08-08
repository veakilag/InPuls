from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "signal-lab-v7-multi-timeframe-review-runtime.js"
text = TARGET.read_text(encoding="utf-8")

anchor = '''function ensureDiagnosticPanel(message = null) {\n'''
helper = '''function buildCandleTraceRows(state) {\n  const params = new URL(window.location.href).searchParams;\n  const traceFrom = finite(params.get("traceFrom"));\n  const traceTo = finite(params.get("traceTo"));\n  if (traceFrom === null || traceTo === null || traceTo < traceFrom) return Object.freeze([]);\n  const timeframe = state?.viewTimeframe;\n  const candles = state?.candlesByTimeframe?.[timeframe] ?? [];\n  return Object.freeze(candles\n    .filter((candle) => {\n      const at = finite(candle?.time);\n      return at !== null && at >= traceFrom && at <= traceTo;\n    })\n    .map((candle) => Object.freeze({\n      time: finite(candle?.time),\n      open: finite(candle?.open),\n      high: finite(candle?.high),\n      low: finite(candle?.low),\n      close: finite(candle?.close),\n      volume: finite(candle?.volume),\n    })));\n}\n\nfunction formatCandleTraceRow(row) {\n  const at = row.time === null ? "—" : new Date(row.time).toISOString().slice(11, 16);\n  const digits = Math.max(row.open ?? 0, row.high ?? 0, row.low ?? 0, row.close ?? 0) >= 1000 ? 1 : 6;\n  const rangePct = row.low > 0 && row.high !== null\n    ? (row.high - row.low) / row.low * 100\n    : null;\n  const closeFromLowPct = row.low > 0 && row.close !== null\n    ? (row.close - row.low) / row.low * 100\n    : null;\n  const closeFromHighPct = row.high > 0 && row.close !== null\n    ? (row.high - row.close) / row.high * 100\n    : null;\n  return [\n    `CANDLE ${at}Z`,\n    `O=${debugNumber(row.open, digits)}`,\n    `H=${debugNumber(row.high, digits)}`,\n    `L=${debugNumber(row.low, digits)}`,\n    `C=${debugNumber(row.close, digits)}`,\n    `range=${debugNumber(rangePct, 3)}%`,\n    `C-L=${debugNumber(closeFromLowPct, 3)}%`,\n    `H-C=${debugNumber(closeFromHighPct, 3)}%`,\n  ].join(" | ");\n}\n\n'''
if anchor not in text:
    raise SystemExit("diagnostic panel anchor not found")
if "function buildCandleTraceRows(state)" not in text:
    text = text.replace(anchor, helper + anchor, 1)

old = '''  const rawNativeRows = [...buildRawNativeDiagnosticRows(state)];\n  panel.textContent = [\n    `DEBUG V4.19 · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,\n    ...localRows.map(formatDiagnosticRow),\n    `RAW NATIVE DEBUG · recent ${rawNativeRows.length}`,\n    ...rawNativeRows.map(formatRawNativeDiagnosticRow),\n    `ETALON DEBUG · manual levels ${manualEtalons.length}`,\n    ...manualEtalons.map(formatManualEtalonDiagnosticRow),\n  ].join("\\n");\n'''
new = '''  const rawNativeRows = [...buildRawNativeDiagnosticRows(state)];\n  const candleTraceRows = [...buildCandleTraceRows(state)];\n  panel.textContent = [\n    `DEBUG V4.20 TRACE · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`,\n    ...localRows.map(formatDiagnosticRow),\n    `RAW NATIVE DEBUG · recent ${rawNativeRows.length}`,\n    ...rawNativeRows.map(formatRawNativeDiagnosticRow),\n    `CANDLE TRACE · rows ${candleTraceRows.length}`,\n    ...candleTraceRows.map(formatCandleTraceRow),\n    `ETALON DEBUG · manual levels ${manualEtalons.length}`,\n    ...manualEtalons.map(formatManualEtalonDiagnosticRow),\n  ].join("\\n");\n'''
if old not in text:
    raise SystemExit("diagnostic render anchor not found")
text = text.replace(old, new, 1)
text = text.replace("DEBUG V4.19 · ${viewTimeframe} · STATE=LOADING", "DEBUG V4.20 TRACE · ${viewTimeframe} · STATE=LOADING")
text = text.replace("DEBUG V4.19 · ${viewTimeframe} · STATE=ERROR", "DEBUG V4.20 TRACE · ${viewTimeframe} · STATE=ERROR")

TARGET.write_text(text, encoding="utf-8")
