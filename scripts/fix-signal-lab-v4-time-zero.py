from pathlib import Path


def replace_once(path, old, new, label):
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, got {count}")
    file.write_text(source.replace(old, new, 1))


replace_once(
    "signal-lab-v4-extremes.js",
    '''const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
''',
    '''const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
''',
    "extrema finite normalization",
)
replace_once(
    "signal-lab-v4-orderflow-recorder.js",
    '''const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
''',
    '''const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
''',
    "orderflow finite normalization",
)
replace_once(
    "signal-lab-v4-orderflow-replay.js",
    '''const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
''',
    '''const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
''',
    "replay finite normalization",
)
replace_once(
    "signal-lab-v4-extremes.js",
    '''  if (![time, open, high, low, close].every((value) => value !== null && value > 0)) return null;
''',
    '''  if (time === null || time < 0) return null;
  if (![open, high, low, close].every((value) => value !== null && value > 0)) return null;
''',
    "Unix timestamp zero validation",
)
replace_once(
    "test/signal-lab-v4-extremes.test.js",
    '  subject.ingestCandle(candle(1, 100, 100.4, 100.1, 100.35));\n',
    '  subject.ingestCandle(candle(1, 100.2, 100.4, 100.1, 100.35));\n',
    "valid candidate update candle",
)

print("Signal Lab V4 rejects null clocks and accepts Unix timestamp zero")
