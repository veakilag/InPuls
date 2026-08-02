from pathlib import Path

replacements = {
    "index.html": [
        ('<script type="module" src="./app.js?v=26-97-smooth-chart-first-v1"></script>', '<script type="module" src="./app.js?v=26-98-live-comfort-preview-v1"></script>'),
    ],
    "test-orderbook-resume-v2.mjs": [
        ('app\\.js\\?v=26-97-smooth-chart-first-v1', 'app\\.js\\?v=26-98-live-comfort-preview-v1'),
    ],
    "test-orderbook-runtime-stability.mjs": [
        ('app\\.js\\?v=26-97-smooth-chart-first-v1', 'app\\.js\\?v=26-98-live-comfort-preview-v1'),
    ],
    "test-comfort-slider-smooth-v1.mjs": [
        ('assert.match(index, /install-cta\\.js\\?v=comfort-live-preview-v1/);', 'assert.match(index, /install-cta\\.js\\?v=comfort-live-preview-v1/);\n  assert.match(index, /app\\.js\\?v=26-98-live-comfort-preview-v1/);'),
    ],
}

for filename, pairs in replacements.items():
    path = Path(filename)
    source = path.read_text(encoding="utf-8")
    for old, new in pairs:
        if old not in source:
            raise SystemExit(f"Expected marker not found in {filename}: {old}")
        source = source.replace(old, new, 1)
    path.write_text(source, encoding="utf-8")
