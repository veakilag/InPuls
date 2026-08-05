from pathlib import Path

REPLACEMENTS = {
    "owner-signal-lab-v3.html": [
        ("owner-signal-lab-v3.js?v=signal-lab-v4-stage4", "owner-signal-lab-v3.js?v=signal-lab-v4-performance-1"),
    ],
    "owner-signal-lab-v3.js": [
        ("signal-lab-v3-collector.js?v=signal-lab-v4-stage3", "signal-lab-v3-collector.js?v=signal-lab-v4-performance-1"),
    ],
    "signal-lab-v3-collector.js": [
        ("signal-lab-v4-extremes.js?v=signal-lab-v4-stage1", "signal-lab-v4-extremes.js?v=signal-lab-v4-performance-1"),
    ],
}

for filename, pairs in REPLACEMENTS.items():
    path = Path(filename)
    text = path.read_text(encoding="utf-8")
    for old, new in pairs:
        if old not in text:
            raise RuntimeError(f"missing cache key in {filename}: {old}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
