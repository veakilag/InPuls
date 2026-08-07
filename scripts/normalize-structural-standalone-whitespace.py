from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "structural-extremes-review-standalone.html"
text = path.read_text(encoding="utf-8")
normalized = "\n".join(line.rstrip() for line in text.splitlines()) + "\n"
path.write_text(normalized, encoding="utf-8")
print("Normalized structural-extremes-review-standalone.html")
