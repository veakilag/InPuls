from pathlib import Path


def replace_once(path, old, new):
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"missing pattern in {path}: {old!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "test/signal-lab-v4-levels-integration.test.js",
    '  assert.match(page, /signal-lab-v4-stage3/);',
    '  assert.match(page, /signal-lab-v4-stage4/);',
)

replace_once(
    "owner-signal-lab-v3.html",
    '<option value="">Все каскады</option>',
    '<option value="">Не фильтровать</option>',
)
