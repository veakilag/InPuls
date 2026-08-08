from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


levels_path = Path("signal-lab-v7-multi-timeframe-levels.js")
test_path = Path("test/signal-lab-v7-multi-timeframe-levels.test.js")

levels = levels_path.read_text()
levels = replace_once(
    levels,
    "    extremeAt,\n    nativeExtremeAt: extremeAt,",
    "    extremeAt,\n    confirmedAt: finite(extreme.confirmedAt),\n    nativeExtremeAt: extremeAt,",
    "normalize confirmedAt",
)
levels_path.write_text(levels)

tests = test_path.read_text()
marker = 'test("normalized structural level preserves confirmedAt for causal downstream research", () => {'
if marker in tests:
    raise SystemExit("confirmedAt regression test already present")
insert_after = '''test("1m and 5m levels expire from the map after 30 days", () => {
  const recent = normalizeStructuralLevel(extreme({
    id: "recent",
    price: 100,
    extremeAt: END - LOCAL_STRUCTURAL_LEVEL_HORIZON_MS + 1,
  }), "1m", END);
  const old = normalizeStructuralLevel(extreme({
    id: "old",
    price: 100,
    extremeAt: END - LOCAL_STRUCTURAL_LEVEL_HORIZON_MS - 1,
  }), "1m", END);
  assert.ok(recent);
  assert.equal(old, null);

  const oldFourHour = normalizeStructuralLevel(extreme({
    id: "4h-old",
    price: 100,
    extremeAt: END - 40 * 24 * 60 * 60_000,
  }), "4h", END);
  assert.ok(oldFourHour);
});
'''
addition = insert_after + '''

test("normalized structural level preserves confirmedAt for causal downstream research", () => {
  const extremeAt = END - 20_000;
  const confirmedAt = END - 11_000;
  const level = normalizeStructuralLevel(extreme({
    id: "confirmed-time",
    side: "HIGH",
    price: 101,
    extremeAt,
    confirmedAt,
  }), "5m", END);

  assert.ok(level);
  assert.equal(level.extremeAt, extremeAt);
  assert.equal(level.nativeExtremeAt, extremeAt);
  assert.equal(level.confirmedAt, confirmedAt);
});
'''
tests = replace_once(tests, insert_after, addition, "insert confirmedAt regression")
test_path.write_text(tests)

print("Applied V6.3.2 confirmedAt propagation patch")
