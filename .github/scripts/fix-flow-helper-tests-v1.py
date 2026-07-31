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

test_path = Path("test/tape-runtime.test.js")
test_source = test_path.read_text(encoding="utf-8")
old = '  assert.match(source, /state\\.context\\.font = "700 7px Arial, sans-serif";/);'
new = '''  assert.match(source, /formatCompactUsd\\(cluster\\.quote\\)/);
  assert.match(source, /footprintBookVolumeTextStyle\\(state, theme\\)/);
  assert.match(source, /querySelector\\?\\.\\("\\.book-size"\\)/);'''
if test_source.count(old) != 1:
    raise RuntimeError(f"Expected one old footprint font assertion, got {test_source.count(old)}")
test_path.write_text(test_source.replace(old, new, 1), encoding="utf-8")

print("Fixed Flow helper placement and updated footprint typography contract")
