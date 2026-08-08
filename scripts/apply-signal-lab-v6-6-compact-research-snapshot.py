from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


root = Path('.')
runtime_path = root / 'signal-lab-v7-multi-timeframe-review-runtime.js'
test_path = root / 'test/signal-lab-v7-compact-research-snapshot.test.js'

runtime = runtime_path.read_text()

button_anchor = '''    copyButton.style.color = "inherit";\n    copyButton.style.font = "inherit";\n\n    const copyStatus = document.createElement("span");'''
button_insert = '''    copyButton.style.color = "inherit";\n    copyButton.style.font = "inherit";\n\n    const researchButton = document.createElement("button");\n    researchButton.type = "button";\n    researchButton.id = "copy-structural-research";\n    researchButton.textContent = "Копировать research";\n    researchButton.style.cursor = "pointer";\n    researchButton.style.padding = "6px 10px";\n    researchButton.style.border = "1px solid rgba(255,255,255,0.20)";\n    researchButton.style.borderRadius = "7px";\n    researchButton.style.background = "rgba(255,255,255,0.08)";\n    researchButton.style.color = "inherit";\n    researchButton.style.font = "inherit";\n\n    const copyStatus = document.createElement("span");'''
runtime = replace_once(runtime, button_anchor, button_insert, 'research button creation')

event_anchor = '''    copyButton.addEventListener("click", async () => {\n      const originalLabel = copyButton.textContent;\n      copyButton.disabled = true;\n      const copied = await copyDiagnosticText(panel.textContent);\n      copyButton.textContent = copied ? "Скопировано ✓" : "Не скопировалось";\n      copyStatus.textContent = copied\n        ? "Вставь текст прямо в чат"\n        : "Выдели текст в блоке вручную";\n      window.setTimeout(() => {\n        copyButton.textContent = originalLabel;\n        copyButton.disabled = false;\n        copyStatus.textContent = "";\n      }, 2200);\n    });\n\n    toolbar.append(copyButton, copyStatus);'''
event_replacement = '''    copyButton.addEventListener("click", async () => {\n      const originalLabel = copyButton.textContent;\n      copyButton.disabled = true;\n      const copied = await copyDiagnosticText(panel.textContent);\n      copyButton.textContent = copied ? "Скопировано ✓" : "Не скопировалось";\n      copyStatus.textContent = copied\n        ? "Вставь текст прямо в чат"\n        : "Выдели текст в блоке вручную";\n      window.setTimeout(() => {\n        copyButton.textContent = originalLabel;\n        copyButton.disabled = false;\n        copyStatus.textContent = "";\n      }, 2200);\n    });\n\n    researchButton.addEventListener("click", async () => {\n      const originalLabel = researchButton.textContent;\n      researchButton.disabled = true;\n      const snapshot = String(window.__INPULS_RESEARCH_SNAPSHOT_TEXT__ ?? "");\n      const copied = await copyDiagnosticText(snapshot);\n      researchButton.textContent = copied ? "Research скопирован ✓" : "Не скопировалось";\n      copyStatus.textContent = copied\n        ? "Пришли этот короткий блок в чат"\n        : "Research snapshot ещё не готов";\n      window.setTimeout(() => {\n        researchButton.textContent = originalLabel;\n        researchButton.disabled = false;\n        copyStatus.textContent = "";\n      }, 2200);\n    });\n\n    toolbar.append(copyButton, researchButton, copyStatus);'''
runtime = replace_once(runtime, event_anchor, event_replacement, 'research button event')

snapshot_anchor = '''  const approachEvidenceContext = buildApproachEvidenceResearchContext(approachContext);\n  window.__INPULS_APPROACH_EVIDENCE__ = approachEvidenceContext;\n  const approachEvidenceLines = formatApproachEvidenceResearchContext(approachEvidenceContext);\n  const candleTraceRows = [...buildCandleTraceRows(state)];'''
snapshot_replacement = '''  const approachEvidenceContext = buildApproachEvidenceResearchContext(approachContext);\n  window.__INPULS_APPROACH_EVIDENCE__ = approachEvidenceContext;\n  const approachEvidenceLines = formatApproachEvidenceResearchContext(approachEvidenceContext);\n  const researchParams = new URL(window.location.href).searchParams;\n  const researchSymbol = String(researchParams.get("symbol") ?? "?").trim().toUpperCase() || "?";\n  const localResearchRows = levelContextRows.filter((row) => row?.relevance?.inFivePercentWindow);\n  const researchSnapshotText = [\n    `RESEARCH SNAPSHOT v6.6-compact-cross-asset-2026-08 · ${researchSymbol} · ${state.viewTimeframe} · endAt=${new Date(state.endAt).toISOString()}`,\n    ...localStructureLines,\n    ...stackRouteLines,\n    ...approachEvidenceLines,\n    `LOCAL LEVELS 0-5% · rows=${localResearchRows.length}`,\n    ...localResearchRows.map(formatLevelResearchContextRow),\n  ].join("\\n");\n  window.__INPULS_RESEARCH_SNAPSHOT_TEXT__ = researchSnapshotText;\n  const candleTraceRows = [...buildCandleTraceRows(state)];'''
runtime = replace_once(runtime, snapshot_anchor, snapshot_replacement, 'research snapshot generation')

runtime_path.write_text(runtime)

test_path.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const runtime = fs.readFileSync(new URL("../signal-lab-v7-multi-timeframe-review-runtime.js", import.meta.url), "utf8");

test("V6.6 exposes a compact cross-asset research snapshot copy control", () => {
  assert.match(runtime, /copy-structural-research/);
  assert.match(runtime, /Копировать research/);
  assert.match(runtime, /__INPULS_RESEARCH_SNAPSHOT_TEXT__/);
  assert.match(runtime, /RESEARCH SNAPSHOT v6\.6-compact-cross-asset-2026-08/);
  assert.match(runtime, /LOCAL LEVELS 0-5%/);
  assert.match(runtime, /localResearchRows = levelContextRows\.filter/);
});

test("V6.6 compact snapshot reuses relational route and evidence output without raw debug sections", () => {
  const start = runtime.indexOf("const researchSnapshotText = [");
  const end = runtime.indexOf('].join("\\n");', start);
  assert.ok(start >= 0 && end > start);
  const block = runtime.slice(start, end);
  assert.match(block, /\.\.\.localStructureLines/);
  assert.match(block, /\.\.\.stackRouteLines/);
  assert.match(block, /\.\.\.approachEvidenceLines/);
  assert.match(block, /localResearchRows\.map\(formatLevelResearchContextRow\)/);
  assert.doesNotMatch(block, /rawNativeRows/);
  assert.doesNotMatch(block, /vShapeRows/);
  assert.doesNotMatch(block, /v5SourceRows/);
});
''')

print('Applied V6.6 compact research snapshot')
