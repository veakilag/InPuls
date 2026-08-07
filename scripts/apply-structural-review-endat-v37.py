from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "owner-signal-lab-structural-extremes-review.js",
    '''const finite = (value) => {\n  const number = Number(value);\n  return Number.isFinite(number) ? number : null;\n};''',
    '''const finite = (value) => {\n  if (value === null || value === undefined || value === "") return null;\n  const number = Number(value);\n  return Number.isFinite(number) ? number : null;\n};''',
)

# Regression contract: a missing URL endAt must stay null so applyUrlState()
# falls back to current time instead of Unix epoch (1970-01-01).
test_path = ROOT / "test/signal-lab-v7-structural-extremes-isolation.test.js"
test_text = test_path.read_text(encoding="utf-8")
anchor = '''  assert.match(review, /REVIEW_LOOKBACK_MS/);\n'''
replacement = '''  assert.match(review, /REVIEW_LOOKBACK_MS/);\n  assert.match(review, /value === null \\|\\| value === undefined \\|\\| value === ""/);\n'''
if anchor not in test_text:
    raise RuntimeError("review regression anchor not found")
test_path.write_text(test_text.replace(anchor, replacement, 1), encoding="utf-8")

print("Applied V3.7 structural review endAt guard")
