from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "signal-lab-v7-multi-timeframe-review-runtime.js"
text = TARGET.read_text(encoding="utf-8")

anchor = '''function addDiagnosticPanel(state, levelMap) {\n'''
helper = '''function ensureDiagnosticPanel(message = null) {\n  const params = new URL(window.location.href).searchParams;\n  const debugEnabled = params.get("debug") === "1";\n  let panel = document.querySelector("#structural-level-debug");\n  if (!debugEnabled) {\n    panel?.remove();\n    return null;\n  }\n  if (!panel) {\n    const anchor = document.querySelector("#multi-tf-context-status") ?? document.querySelector("#status");\n    if (!anchor) return null;\n    panel = document.createElement("pre");\n    panel.id = "structural-level-debug";\n    panel.style.margin = "8px 0 12px";\n    panel.style.padding = "10px";\n    panel.style.border = "1px solid rgba(255,255,255,0.14)";\n    panel.style.borderRadius = "8px";\n    panel.style.background = "rgba(255,255,255,0.035)";\n    panel.style.fontSize = "11px";\n    panel.style.lineHeight = "1.45";\n    panel.style.whiteSpace = "pre-wrap";\n    panel.style.userSelect = "text";\n    anchor.insertAdjacentElement("afterend", panel);\n  }\n  if (message !== null) panel.textContent = String(message);\n  return panel;\n}\n\n'''
if anchor not in text:
    raise SystemExit("diagnostic anchor missing")
if "function ensureDiagnosticPanel" not in text:
    text = text.replace(anchor, helper + anchor, 1)

old_start = '''function addDiagnosticPanel(state, levelMap) {\n  const params = new URL(window.location.href).searchParams;\n  const debugEnabled = params.get("debug") === "1";\n  let panel = document.querySelector("#structural-level-debug");\n  if (!debugEnabled) {\n    panel?.remove();\n    return;\n  }\n  const context = document.querySelector("#multi-tf-context-status");\n  if (!context) return;\n  if (!panel) {\n    panel = document.createElement("pre");\n    panel.id = "structural-level-debug";\n    panel.style.margin = "8px 0 12px";\n    panel.style.padding = "10px";\n    panel.style.border = "1px solid rgba(255,255,255,0.14)";\n    panel.style.borderRadius = "8px";\n    panel.style.background = "rgba(255,255,255,0.035)";\n    panel.style.fontSize = "11px";\n    panel.style.lineHeight = "1.45";\n    panel.style.whiteSpace = "pre-wrap";\n    panel.style.userSelect = "text";\n    context.insertAdjacentElement("afterend", panel);\n  }\n'''
new_start = '''function addDiagnosticPanel(state, levelMap) {\n  const panel = ensureDiagnosticPanel();\n  if (!panel) return;\n'''
if old_start not in text:
    raise SystemExit("old diagnostic bootstrap block missing")
text = text.replace(old_start, new_start, 1)
text = text.replace('`DEBUG V4.18 · ${state.viewTimeframe} · visible local levels ${localRows.length}`', '`DEBUG V4.19 · ${state.viewTimeframe} · STATE=READY · visible local levels ${localRows.length}`', 1)

old_state = '''    const localGeneration = state.generation;\n    stateByChart.set(this, state);\n\n    queueMicrotask(async () => {\n'''
new_state = '''    const localGeneration = state.generation;\n    stateByChart.set(this, state);\n    ensureDiagnosticPanel(`DEBUG V4.19 · ${viewTimeframe} · STATE=LOADING\\nsymbol=${symbol} endAt=${endAt}`);\n\n    queueMicrotask(async () => {\n'''
if old_state not in text:
    raise SystemExit("setData state anchor missing")
text = text.replace(old_state, new_state, 1)

old_catch = '''      } catch (error) {\n        if (error?.name === "AbortError") return;\n        const context = document.querySelector("#multi-tf-context-status");\n        if (context) context.textContent = `Иерархия не загрузилась: ${String(error?.message ?? error)}`;\n      }\n'''
new_catch = '''      } catch (error) {\n        if (error?.name === "AbortError") return;\n        const message = String(error?.message ?? error);\n        const context = document.querySelector("#multi-tf-context-status");\n        if (context) context.textContent = `Иерархия не загрузилась: ${message}`;\n        ensureDiagnosticPanel(`DEBUG V4.19 · ${viewTimeframe} · STATE=ERROR\\nsymbol=${symbol} endAt=${endAt}\\n${message}`);\n      }\n'''
if old_catch not in text:
    raise SystemExit("catch anchor missing")
text = text.replace(old_catch, new_catch, 1)

TARGET.write_text(text, encoding="utf-8")
