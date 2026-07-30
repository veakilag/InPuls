from pathlib import Path

OLD_BUILD = "26-75-zero-ms-live-agg-v1"
NEW_BUILD = "26-76-zero-ms-threshold-v1"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


orderbook = read("orderbook.js")

orderbook = replace_once(
    orderbook,
    'const TAPE_MODE_KEY = "inpuls-tape-mode-v2";\n',
    'const TAPE_MODE_KEY = "inpuls-tape-mode-v2";\nconst TAPE_MIN_FILTER_KEY = "inpuls-tape-min-filter-v3";\n',
    "restore threshold storage key",
)

orderbook = replace_once(
    orderbook,
    '  if (!state) {\n    state = {\n',
    '  if (!state) {\n    const savedMinimum = localStorage.getItem(TAPE_MIN_FILTER_KEY);\n    state = {\n',
    "restore saved threshold",
)
orderbook = replace_once(
    orderbook,
    '      minQuote: 0,\n',
    '      minQuote: savedMinimum === null ? 0 : Math.max(0, Number(savedMinimum) || 0),\n',
    "restore threshold state",
)

old_controls = '''  if (!state.controls?.isConnected) {
    const controls = document.createElement("div");
    controls.className = "inpuls-tape-controls";
    controls.innerHTML = '<button data-inpuls-tape-mode class="inpuls-tape-mode" type="button"></button>';
    toolbar.append(controls);
    state.controls = controls;

    const modeButton = controls.querySelector("[data-inpuls-tape-mode]");
    modeButton.addEventListener("click", () => {
      state.mode = state.mode === "agg" ? "raw" : "agg";
      localStorage.setItem(TAPE_MODE_KEY, state.mode);
      syncTapeModeButton(modeButton, state);
      scheduleTapeDraw(true, card);
    });
    syncTapeModeButton(modeButton, state);
    syncLayerButtons(card, state);
  } else {
    syncTapeModeButton(state.controls.querySelector("[data-inpuls-tape-mode]"), state);
  }
'''
new_controls = '''  if (!state.controls?.isConnected) {
    const controls = document.createElement("div");
    controls.className = "inpuls-tape-controls";
    controls.innerHTML = `
      <label class="inpuls-tape-filter" title="Показывать маркеры RAW/AGG не меньше указанного объёма. Линия строится по всем сделкам.">
        <span>ОТ $</span>
        <input data-inpuls-trade-min type="number" min="0" step="100" value="${state.minQuote}" aria-label="Минимальный объём отображаемой сделки или агрегата" />
      </label>
      <button data-inpuls-tape-mode class="inpuls-tape-mode" type="button"></button>`;
    toolbar.append(controls);
    state.controls = controls;

    const minInput = controls.querySelector("[data-inpuls-trade-min]");
    const modeButton = controls.querySelector("[data-inpuls-tape-mode]");
    const applyMinimum = () => {
      state.minQuote = Math.max(0, Number(minInput.value) || 0);
      localStorage.setItem(TAPE_MIN_FILTER_KEY, String(state.minQuote));
      scheduleTapeDraw(true, card);
    };
    minInput.addEventListener("input", applyMinimum);
    minInput.addEventListener("change", applyMinimum);
    modeButton.addEventListener("click", () => {
      state.mode = state.mode === "agg" ? "raw" : "agg";
      localStorage.setItem(TAPE_MODE_KEY, state.mode);
      syncTapeModeButton(modeButton, state);
      scheduleTapeDraw(true, card);
    });
    syncTapeModeButton(modeButton, state);
    syncLayerButtons(card, state);
  } else {
    const minInput = state.controls.querySelector("[data-inpuls-trade-min]");
    if (minInput && document.activeElement !== minInput) minInput.value = String(state.minQuote);
    syncTapeModeButton(state.controls.querySelector("[data-inpuls-tape-mode]"), state);
  }
'''
orderbook = replace_once(orderbook, old_controls, new_controls, "restore threshold UI")

orderbook = replace_once(
    orderbook,
    '    current.showLabel = true;\n',
    '',
    "remove forced aggregate label",
)
orderbook = replace_once(
    orderbook,
    '      output.push(Object.freeze({ ...group, status: "open", showLabel: true }));\n',
    '      output.push(Object.freeze({\n        ...group,\n        status: "open",\n        showLabel: stableTapeQuoteStrength(group.quote) >= .62,\n      }));\n',
    "open aggregate label policy",
)
orderbook = replace_once(
    orderbook,
    '        showLabel: true,\n',
    '        showLabel: stableTapeQuoteStrength(group.quote) >= .62,\n',
    "sealed aggregate label policy",
)
orderbook = replace_once(
    orderbook,
    '    const showLabel = Boolean(item.showLabel);\n',
    '    const showLabel = minQuote > 0 || Boolean(item.showLabel);\n',
    "threshold forces exact volume label",
)

write("orderbook.js", orderbook)

sealed = read("test-sealed-agg-round-levels-v1.mjs")
sealed = replace_once(
    sealed,
    'test("Tape UI has RAW/AGG only and no period, level or volume-filter controls", () => {\n',
    'test("Tape UI keeps zero-ms RAW/AGG and restores the marker threshold", () => {\n',
    "rename UI contract test",
)
sealed = replace_once(
    sealed,
    '  assert.doesNotMatch(orderbook, /data-inpuls-trade-min|TAPE_MIN_FILTER_KEY/);\n',
    '  assert.match(orderbook, /data-inpuls-trade-min|TAPE_MIN_FILTER_KEY/);\n',
    "threshold contract",
)
write("test-sealed-agg-round-levels-v1.mjs", sealed)

new_test = '''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

function tapePainter() {
  const start = orderbook.indexOf("function drawTapeCard(card) {");
  const end = orderbook.indexOf("\\nfunction drawAllTapes()", start);
  assert.ok(start >= 0 && end > start);
  return orderbook.slice(start, end);
}

test("Tape threshold is restored without restoring aggregation levels", () => {
  assert.match(orderbook, /const TAPE_MIN_FILTER_KEY = "inpuls-tape-min-filter-v3"/);
  assert.match(orderbook, /data-inpuls-trade-min/);
  assert.match(orderbook, /localStorage\.setItem\(TAPE_MIN_FILTER_KEY/);
  assert.doesNotMatch(orderbook, /TAPE_AGGREGATION_LEVELS|data-inpuls-agg-step|AGG ×/);
  assert.match(orderbook, /export const TAPE_AGGREGATION_PERIOD_MS = 0/);
});

test("threshold filters markers while the path still uses every RAW trade", () => {
  const painter = tapePainter();
  assert.match(painter, /const pathItems = projectWaterTapeNodes\([\s\S]*recentRaw/);
  assert.match(painter, /filterWaterTapeCandidates\([\s\S]*sourceItems,[\s\S]*minQuote/);
  assert.match(painter, /const showLabel = minQuote > 0 \|\| Boolean\(item\.showLabel\)/);
});

test("zero threshold no longer writes a label on every aggregate", () => {
  assert.doesNotMatch(orderbook, /current\.showLabel = true/);
  assert.match(orderbook, /showLabel: stableTapeQuoteStrength\(group\.quote\) >= \.62/);
});
'''
write("test-tape-threshold-agg-visual-v1.mjs", new_test)

paths = [
    Path("VERSION.txt"), Path("app.js"), Path("index.html"), Path("orderbook.js"),
    Path("refresh.html"), Path("refresh.js"), Path("reset-v26.html"), Path("reset.js"),
    Path("sw.js"),
]
paths += list(Path(".").glob("test*.mjs"))
paths += list(Path("test").rglob("*.js"))
seen = set()
for path in paths:
    if path in seen or not path.exists():
        continue
    seen.add(path)
    text = path.read_text(encoding="utf-8")
    if OLD_BUILD in text:
        path.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

version = read("VERSION.txt")
if NEW_BUILD not in version:
    raise AssertionError("VERSION.txt was not bumped")

final = read("orderbook.js")
assert 'data-inpuls-trade-min' in final
assert 'TAPE_MIN_FILTER_KEY' in final
assert 'TAPE_AGGREGATION_LEVELS' not in final
assert 'data-inpuls-agg-step' not in final
assert 'TAPE_AGG_EVENT_GRACE_MS' not in final
assert 'TAPE_AGG_WALL_CLOCK_GRACE_MS' not in final
assert 'export const TAPE_AGGREGATION_PERIOD_MS = 0;' in final
assert 'const showLabel = minQuote > 0 || Boolean(item.showLabel);' in final
