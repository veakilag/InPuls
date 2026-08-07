from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "signal-lab-v7-multi-timeframe-review-runtime.js"
text = path.read_text(encoding="utf-8")
old = '''  const manualEtalons = buildManualEtalonDiagnosticRows(state)\n    .sort((left, right) => (right.price ?? 0) - (left.price ?? 0));'''
new = '''  const manualEtalons = [...buildManualEtalonDiagnosticRows(state)]\n    .sort((left, right) => (right.price ?? 0) - (left.price ?? 0));'''
if text.count(old) != 1:
    raise RuntimeError(f"expected one frozen manualEtalons sort pattern, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
