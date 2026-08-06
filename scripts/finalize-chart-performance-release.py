from pathlib import Path

OLD_RUNTIME_BUILD = "26-116-spot-tape-routing-v2"
NEW_RUNTIME_BUILD = "26-117-chart-interaction-performance-v1"
OLD_SIGNAL_LAB_BUILD = "signal-lab-v9-extreme-rays"

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
