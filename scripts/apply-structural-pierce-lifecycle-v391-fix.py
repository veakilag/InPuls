from pathlib import Path

ATTACK_TEST = Path('test/signal-lab-v7-attack-count-runtime.test.js')
CORE_TEST = Path('test/signal-lab-v7-structural-extremes.test.js')


def replace_once(path: Path, old: str, new: str):
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Expected block not found in {path}: {old[:120]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


# Exact-price semantics: 104.9 is a near miss of the 105.0 level, not an attack.
replace_once(
    ATTACK_TEST,
    '    candle(5, 102, 104.9, 101.8, 104.7),',
    '    candle(5, 102, 105, 101.8, 104.7),',
)

# The accepted HIGH may disappear while another independently confirmed level remains active.
# Assert lifecycle of the target HIGH by id rather than requiring the entire active set to be empty.
old = '''test("accepted break removes active high only after acceptance beyond the level", () => {\n  const subject = engine();\n  subject.ingestCandles(risingToConfirmedHigh());\n  subject.ingestCandle(candle(7, 104.3, 104.5, 103.0, 103.5));\n  let snapshot = subject.ingestCandle(candle(8, 103.5, 105.2, 103.4, 105.1));\n  assert.equal(snapshot.active.length, 1);\n  assert.equal(snapshot.history[0].status, STRUCTURAL_EXTREME_STATUSES.PIERCED);\n  const accepted = candle(9, 105.1, 105.4, 105.0, 105.2);\n  snapshot = subject.ingestCandle(accepted);\n  assert.equal(snapshot.active.length, 0);\n  assert.equal(snapshot.history[0].status, STRUCTURAL_EXTREME_STATUSES.ACCEPTED);\n  assert.equal(snapshot.history[0].crossedAt, accepted.closeTime);\n});'''
new = '''test("accepted break removes target high only after acceptance beyond the level", () => {\n  const subject = engine();\n  subject.ingestCandles(risingToConfirmedHigh());\n  subject.ingestCandle(candle(7, 104.3, 104.5, 103.0, 103.5));\n  let snapshot = subject.ingestCandle(candle(8, 103.5, 105.2, 103.4, 105.1));\n  const highId = snapshot.history.find((row) => row.side === "HIGH").id;\n  let high = snapshot.history.find((row) => row.id === highId);\n  assert.equal(high.active, true);\n  assert.equal(high.status, STRUCTURAL_EXTREME_STATUSES.PIERCED);\n  const accepted = candle(9, 105.1, 105.4, 105.0, 105.2);\n  snapshot = subject.ingestCandle(accepted);\n  high = snapshot.history.find((row) => row.id === highId);\n  assert.equal(high.active, false);\n  assert.equal(high.status, STRUCTURAL_EXTREME_STATUSES.ACCEPTED);\n  assert.equal(high.crossedAt, accepted.closeTime);\n  assert.ok(snapshot.active.every((row) => row.id !== highId));\n});'''
replace_once(CORE_TEST, old, new)
