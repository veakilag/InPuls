from pathlib import Path

path = Path("signal-lab-v4-extremes.js")
source = path.read_text()
old = '''  if (![time, open, high, low, close].every((value) => value !== null && value > 0)) return null;
'''
new = '''  if (time === null || time < 0) return null;
  if (![open, high, low, close].every((value) => value !== null && value > 0)) return null;
'''
if source.count(old) != 1:
    raise RuntimeError(f"time validation: expected 1 match, got {source.count(old)}")
path.write_text(source.replace(old, new, 1))
print("Signal Lab V4 accepts Unix timestamp zero in deterministic replay")
