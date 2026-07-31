from pathlib import Path

flow_path = Path("orderbook-flow-workspace.js")
flow = flow_path.read_text(encoding="utf-8")
helper = '''function footprintBookVolumeTextStyle(state, theme) {
  const card = state?.card ?? state?.canvas?.closest?.("[data-panel-id]") ?? null;
  const sample = card?.querySelector?.(".book-size")
    ?? (typeof document !== "undefined" ? document.querySelector(".book-size") : null);
  if (sample && typeof getComputedStyle === "function") {
    const computed = getComputedStyle(sample);
    return {
      color: computed.color || theme.text,
      font: `${computed.fontWeight || "700"} ${computed.fontSize || "7px"} ${computed.fontFamily || "Arial, sans-serif"}`,
    };
  }
  return { color: theme.text, font: "700 7px Arial, sans-serif" };
}

'''
if flow.count(helper) != 1:
    raise RuntimeError(f"Expected one footprint style helper, got {flow.count(helper)}")
flow = flow.replace(helper, "", 1)
anchor = 'import { observability } from "./observability.js?v=render-scheduler-v1";\n'
if flow.count(anchor) != 1:
    raise RuntimeError(f"Expected one observability import anchor, got {flow.count(anchor)}")
flow = flow.replace(anchor, anchor + "\n" + helper, 1)
flow_path.write_text(flow, encoding="utf-8")

test_name = "footprint uses one proportional dominance cell and interval candles"
test_files = []
for candidate in [*Path(".").rglob("*.js"), *Path(".").rglob("*.mjs")]:
    if ".git" in candidate.parts or ".github" in candidate.parts:
        continue
    source = candidate.read_text(encoding="utf-8")
    if test_name in source:
        test_files.append((candidate, source))
if len(test_files) != 1:
    raise RuntimeError(f"Expected one footprint runtime test file, got {[str(path) for path, _ in test_files]}")

test_path, test_source = test_files[0]
lines = test_source.splitlines()
target_indexes = [
    index for index, line in enumerate(lines)
    if "formatQuoteVolume\\(cluster\\.quote\\)" in line
]
if len(target_indexes) != 1:
    raise RuntimeError(f"Expected one old footprint formatter assertion in {test_path}, got {target_indexes}")
index = target_indexes[0]
lines[index:index + 1] = [
    '  assert.match(flow, /formatCompactUsd\\(cluster\\.quote\\)/);',
    '  assert.match(flow, /footprintBookVolumeTextStyle\\(state, theme\\)/);',
    '  assert.match(flow, /querySelector\\?\\.\\("\\.book-size"\\)/);',
    '  assert.match(flow, /const isColumnMaximum =/);',
]
test_path.write_text("\n".join(lines) + ("\n" if test_source.endswith("\n") else ""), encoding="utf-8")

print(f"Fixed Flow helper placement and updated formatter/typography contract in {test_path}")
