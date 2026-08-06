from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = "26-118-signal-lab-30d-history-v1"
OLD_BUILD = "26-117-chart-interaction-performance-v1"


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one occurrence of {old!r}, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


modal = ROOT / "signal-lab-chart-modal.js"
modal_text = modal.read_text(encoding="utf-8")
replacements = [
    ('buttonGroup(TIMEFRAMES, "data-modal-timeframe", "1m")', 'buttonGroup(TIMEFRAMES, "data-modal-timeframe", "1h")'),
    ('buttonGroup(RANGES, "data-modal-range", "1h")', 'buttonGroup(RANGES, "data-modal-range", "30d")'),
    ('    this.interval = "1m";\n    this.contextRange = "1h";', '    this.interval = "1h";\n    this.contextRange = "30d";'),
    ('    this.episode = episode;\n    this.annotations = buildPatternAnnotations(episode);', '    this.episode = episode;\n    // Every episode opens with the full pre-event market context. The user may\n    // switch timeframe or range afterwards, but a fresh open always starts from\n    // 30 days before the event instead of the previous short-window selection.\n    this.interval = "1h";\n    this.contextRange = "30d";\n    this.annotations = buildPatternAnnotations(episode);'),
]
for old, new in replacements:
    count = modal_text.count(old)
    if count != 1:
        raise RuntimeError(f"signal-lab-chart-modal.js: expected exactly one occurrence of {old!r}, found {count}")
    modal_text = modal_text.replace(old, new, 1)
modal.write_text(modal_text, encoding="utf-8")

replace_once(
    "owner-signal-lab-v3.js",
    f'./signal-lab-chart-modal.js?v={OLD_BUILD}',
    f'./signal-lab-chart-modal.js?v={BUILD}',
)
replace_once(
    "owner-signal-lab-v3.html",
    f'./owner-signal-lab-v3.js?v={OLD_BUILD}',
    f'./owner-signal-lab-v3.js?v={BUILD}',
)

smoke = ROOT / "scripts/signal-lab-runtime-smoke.mjs"
smoke_text = smoke.read_text(encoding="utf-8")
for module in ("signal-lab-v3-full-chart.js", "signal-lab-chart-modal.js"):
    old = f"./{module}?v={OLD_BUILD}"
    new = f"./{module}?v={BUILD}"
    if old not in smoke_text:
        raise RuntimeError(f"scripts/signal-lab-runtime-smoke.mjs: missing {old}")
    smoke_text = smoke_text.replace(old, new)
smoke.write_text(smoke_text, encoding="utf-8")

test_file = ROOT / "test/signal-lab-modal-chart.test.js"
test_text = test_file.read_text(encoding="utf-8")
if OLD_BUILD not in test_text:
    raise RuntimeError("test/signal-lab-modal-chart.test.js: old cache key not found")
test_text = test_text.replace(OLD_BUILD, BUILD)
needle = '  assert.match(modal, /data-modal-maximize/);\n'
addition = (
    '  assert.match(modal, /data-modal-maximize/);\n'
    '  assert.match(modal, /buttonGroup\\(TIMEFRAMES, "data-modal-timeframe", "1h"\\)/);\n'
    '  assert.match(modal, /buttonGroup\\(RANGES, "data-modal-range", "30d"\\)/);\n'
    '  assert.match(modal, /this\\.interval = "1h";[\\s\\S]*this\\.contextRange = "30d";/);\n'
    '  assert.match(modal, /Every episode opens with the full pre-event market context/);\n'
)
if needle not in test_text:
    raise RuntimeError("test/signal-lab-modal-chart.test.js: insertion point not found")
test_text = test_text.replace(needle, addition, 1)
test_file.write_text(test_text, encoding="utf-8")

replace_once(
    "test/signal-lab-v3-full-chart.test.js",
    'buttonGroup\\(TIMEFRAMES, "data-modal-timeframe", "1m"\\)',
    'buttonGroup\\(TIMEFRAMES, "data-modal-timeframe", "1h"\\)',
)

print("Signal Lab 30-day default history patch applied")
