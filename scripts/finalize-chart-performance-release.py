from pathlib import Path

OLD_RUNTIME_BUILD = "26-116-spot-tape-routing-v2"
NEW_RUNTIME_BUILD = "26-117-chart-interaction-performance-v1"
OLD_SIGNAL_LAB_BUILD = "signal-lab-v9-extreme-rays"
OLD_CHART_BUILD = "26-102-tape-live-edge-minute-boundary-v1"

TEXT_SUFFIXES = {
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".mjs",
    ".webmanifest",
    ".yaml",
    ".yml",
}
SKIP_PATHS = {
    Path("scripts/apply-chart-interaction-performance.py"),
    Path("scripts/finalize-chart-performance-release.py"),
    Path("action-test-output.txt"),
}

for path in Path(".").rglob("*"):
    if not path.is_file() or path.suffix not in TEXT_SUFFIXES or path in SKIP_PATHS:
        continue
    if ".git" in path.parts or "node_modules" in path.parts:
        continue
    source = path.read_text(encoding="utf-8")
    updated = source.replace(OLD_RUNTIME_BUILD, NEW_RUNTIME_BUILD)
    updated = updated.replace(OLD_SIGNAL_LAB_BUILD, NEW_RUNTIME_BUILD)
    if updated != source:
        path.write_text(updated, encoding="utf-8")

full_chart_test_path = Path("test/signal-lab-v3-full-chart.test.js")
full_chart_test = full_chart_test_path.read_text(encoding="utf-8")
replacements = {
    '  assert.match(source, /#drawAnnotations\\(ctx\\)/);':
        '  assert.match(source, /#drawAnnotations\\(ctx, showLabels = true\\)/);',
    '  assert.match(source, /annotation\\.type === "zone"/);':
        '  assert.match(source, /this\\.annotationBuckets\\.zone/);',
    '  assert.match(source, /annotation\\.type === "point"/);':
        '  assert.match(source, /this\\.annotationBuckets\\.point/);',
    '  assert.match(source, /annotations\\.filter\\(\\(item\\) => item\\.type === "ray"\\)/);':
        '  assert.match(source, /this\\.annotationBuckets\\.ray/);',
}
for old, new in replacements.items():
    count = full_chart_test.count(old)
    if count != 1:
        raise SystemExit(f"Signal Lab annotation assertion mismatch for {old!r}: {count}")
    full_chart_test = full_chart_test.replace(old, new, 1)
full_chart_test_path.write_text(full_chart_test, encoding="utf-8")

smooth_test_path = Path("test-smooth-chart-first-v1.mjs")
smooth_test = smooth_test_path.read_text(encoding="utf-8")
old_smooth_assertion = '  assert.match(app, /chart\\.js\\?v=26-102-tape-live-edge-minute-boundary-v1/);'
new_smooth_assertion = '  assert.match(app, /chart\\.js\\?v=26-117-chart-interaction-performance-v1/);'
if smooth_test.count(old_smooth_assertion) != 1:
    raise SystemExit("smooth chart cache assertion mismatch")
smooth_test_path.write_text(smooth_test.replace(old_smooth_assertion, new_smooth_assertion, 1), encoding="utf-8")

boundary_test_path = Path("test-tape-live-edge-minute-boundary-v1.mjs")
boundary_test = boundary_test_path.read_text(encoding="utf-8")
old_chart_constant = f'const CHART_BUILD = "{OLD_CHART_BUILD}";'
new_chart_constant = f'const CHART_BUILD = "{NEW_RUNTIME_BUILD}";'
if boundary_test.count(old_chart_constant) != 1:
    raise SystemExit("boundary chart build assertion mismatch")
boundary_test_path.write_text(boundary_test.replace(old_chart_constant, new_chart_constant, 1), encoding="utf-8")
