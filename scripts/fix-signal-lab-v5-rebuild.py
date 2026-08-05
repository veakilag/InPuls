from pathlib import Path


def replace_once(path, old, new):
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"missing pattern in {path}: {old[:160]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Binance returns the first open at or after startTime, not the previous interval.
replace_once(
    "signal-lab-v3-full-chart.js",
    "  const expectedFirstOpen = Math.floor(requestedFrom / interval) * interval;",
    "  const expectedFirstOpen = Math.ceil(requestedFrom / interval) * interval;",
)

# The >1% detector test must be sufficiently warmed to pass the independent history gate.
replace_once(
    "test/signal-lab-v5-rebuild.test.js",
    "      warmupSeconds: 60,",
    "      warmupSeconds: 300,",
)
replace_once(
    "test/signal-lab-v5-rebuild.test.js",
    "  const startTime = 1_000_000;",
    "  const startTime = 1_020_000;",
)

# Update intentional product contracts from the retired split Replay/V4 page to V5 shared workspace.
replace_once(
    "test/signal-lab-v3-evidence.test.js",
    'test("owner Signal Lab V3 exposes full chart, book replay and explanation controls", async () => {',
    'test("owner Signal Lab V5 exposes full chart, shared orderbook replay and explanation controls", async () => {',
)
replace_once(
    "test/signal-lab-v3-evidence.test.js",
    '  assert.match(html, /data-field="book"/);',
    '  assert.match(html, /data-field="orderbook-workspace"/);',
)
replace_once(
    "test/signal-lab-v3-full-chart.test.js",
    "  assert.match(html, /OWNER SIGNAL LAB V4/);",
    "  assert.match(html, /OWNER SIGNAL LAB V5/);",
)
replace_once(
    "test/signal-lab-v4-cascade-integration.test.js",
    "  assert.match(owner, /signal-lab-v4-stage3/);",
    "  assert.match(owner, /signal-lab-v5-patterns-1/);",
)
replace_once(
    "test/signal-lab-v4-integration.test.js",
    "  assert.match(chart, /candles\\.length < 50_000/);",
    "  assert.match(chart, /candles\\.length < 50_500/);\n  assert.match(chart, /buildCandleCoverage/);\n  assert.match(chart, /PARTIAL_BINANCE_COVERAGE/);",
)
replace_once(
    "test/signal-lab-v4-integration.test.js",
    '''  assert.match(html, /data-field="flow-cluster"/);
  assert.match(html, /data-field="flow-tape"/);
  assert.match(html, /СТАКАН · РУЧНОЙ СКРОЛЛ/);''',
    '''  assert.match(html, /data-field="orderbook-workspace"/);
  assert.match(html, /styles\.css\?v=signal-lab-v5-shared-orderbook/);
  assert.match(replay, /orderbook-card signal-lab-replay-card/);
  assert.match(replay, /Ctrl \+ колесо — шаг ×1…×1000/);''',
)
