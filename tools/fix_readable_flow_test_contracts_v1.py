from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, got {count}")
    return text.replace(old, new, 1)


focused = Path("test-readable-flow-smooth-charts-v1.mjs")
text = focused.read_text(encoding="utf-8")
text = replace_once(
    text,
    'assert.equal(tapeDisplayLabel(series, "sweep"), "Σ14K");',
    'assert.equal(tapeDisplayLabel(series, "sweep"), "Σ14.0K");',
    "Series formatted sum",
)
focused.write_text(text, encoding="utf-8")

legacy = Path("test-sweep-tape-clock-v1.mjs")
text = legacy.read_text(encoding="utf-8")
text = replace_once(
    text,
    '  assert.match(source, /const maximumLabels = Math\\.max\\(3, Math\\.min\\(10, Math\\.floor\\(right \\/ 72\\)\\)\\)/);',
    '  assert.match(source, /function selectTapeLabelKeys\\(/);\n  assert.match(source, /const maximumLabels = sweepMode/);',
    "Shared label selector contract",
)
text = replace_once(
    text,
    '  assert.match(source, /const showLabel = sweepMode\\s*\\? Boolean\\(sweepLabelKeys\\?\\.has\\(item\\.key\\)\\)/);',
    '  assert.match(source, /const showLabel = sweepMode\\s*\\? Boolean\\(sweepLabelKeys\\?\\.has\\(item\\.key\\)\\)\\s*:\\s*Boolean\\(aggLabelKeys\\?\\.has\\(item\\.key\\)\\)/);',
    "Shared AGG and Series visibility contract",
)
legacy.write_text(text, encoding="utf-8")

stability = Path("test-tape-stability-followup-v1.mjs")
text = stability.read_text(encoding="utf-8")
text = replace_once(
    text,
    '  assert.match(painter, /const strength = stableTapeQuoteStrength\\(item\\.quote\\)/);',
    '  assert.match(painter, /const strength = stableTapeQuoteStrength\\(tapeVisualSizeQuote\\(item, state\\.mode\\)\\)/);',
    "Unified visual size contract",
)
stability.write_text(text, encoding="utf-8")

threshold = Path("test-tape-threshold-agg-visual-v1.mjs")
text = threshold.read_text(encoding="utf-8")
text = replace_once(
    text,
    '  assert.match(painter, /const showLabel = sweepMode[\\s\\S]*\\? Boolean\\(sweepLabelKeys\\?\\.has\\(item\\.key\\)\\)[\\s\\S]*: minQuote > 0 \\|\\| Boolean\\(item\\.showLabel\\)/);',
    '  assert.match(painter, /const aggLabelKeys = state\\.mode === "agg"[\\s\\S]*forceLabels: minQuote > 0/);\n  assert.match(painter, /const showLabel = sweepMode[\\s\\S]*Boolean\\(aggLabelKeys\\?\\.has\\(item\\.key\\)\\)/);',
    "Threshold marker and adaptive label contract",
)
threshold.write_text(text, encoding="utf-8")

print("Updated readable flow test contracts")
