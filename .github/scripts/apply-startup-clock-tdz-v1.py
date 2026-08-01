from pathlib import Path

path = Path(__file__).resolve().parents[2] / "app.js"
text = path.read_text(encoding="utf-8")

marker = "bindEvents();\n"
declarations = 'let lastHeaderClockText = "";\nlet clockTickTimer = null;\n'
late = "setInterval(warmupRadarHistory, 5000);\n" + declarations

if text.count(marker) != 1:
    raise RuntimeError(f"expected one bindEvents marker, got {text.count(marker)}")
if text.count(late) != 1:
    raise RuntimeError(f"expected one late clock declaration block, got {text.count(late)}")
if text.find(declarations) < text.find(marker):
    raise RuntimeError("clock declarations are already initialized before bindEvents")

text = text.replace(marker, declarations + "\n" + marker, 1)
text = text.replace(late, "setInterval(warmupRadarHistory, 5000);\n", 1)

if text.find(declarations) > text.find(marker):
    raise RuntimeError("clock declarations were not moved before bindEvents")

path.write_text(text, encoding="utf-8")
