from pathlib import Path

runtime_path = Path('signal-lab-v7-multi-timeframe-review-runtime.js')
text = runtime_path.read_text()

old = '''function ensureDiagnosticPanel(message = null) {\n  const params = new URL(window.location.href).searchParams;\n  const debugEnabled = params.get("debug") === "1";\n  let panel = document.querySelector("#structural-level-debug");\n  if (!debugEnabled) {\n    panel?.remove();\n    return null;\n  }\n  if (!panel) {\n    const anchor = document.querySelector("#multi-tf-context-status") ?? document.querySelector("#status");\n    if (!anchor) return null;\n    panel = document.createElement("pre");\n    panel.id = "structural-level-debug";\n    panel.style.margin = "8px 0 12px";\n    panel.style.padding = "10px";\n    panel.style.border = "1px solid rgba(255,255,255,0.14)";\n    panel.style.borderRadius = "8px";\n    panel.style.background = "rgba(255,255,255,0.035)";\n    panel.style.fontSize = "11px";\n    panel.style.lineHeight = "1.45";\n    panel.style.whiteSpace = "pre-wrap";\n    panel.style.userSelect = "text";\n    anchor.insertAdjacentElement("afterend", panel);\n  }\n  if (message !== null) panel.textContent = String(message);\n  return panel;\n}\n'''

new = r'''async function copyDiagnosticText(text) {
  const value = String(text ?? "");
  if (!value) return false;

  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // raw.githack / browser permissions can block Clipboard API. Fall back
      // to a temporary textarea so one-click copy still works where possible.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

function ensureDiagnosticPanel(message = null) {
  const params = new URL(window.location.href).searchParams;
  const debugEnabled = params.get("debug") === "1";
  let wrapper = document.querySelector("#structural-level-debug-wrapper");
  let panel = document.querySelector("#structural-level-debug");
  if (!debugEnabled) {
    wrapper?.remove();
    if (!wrapper) panel?.remove();
    return null;
  }

  if (!panel) {
    const anchor = document.querySelector("#multi-tf-context-status") ?? document.querySelector("#status");
    if (!anchor) return null;

    wrapper = document.createElement("div");
    wrapper.id = "structural-level-debug-wrapper";
    wrapper.style.margin = "8px 0 12px";

    const toolbar = document.createElement("div");
    toolbar.id = "structural-level-debug-toolbar";
    toolbar.style.display = "flex";
    toolbar.style.alignItems = "center";
    toolbar.style.gap = "8px";
    toolbar.style.marginBottom = "6px";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.id = "copy-structural-debug";
    copyButton.textContent = "Копировать debug";
    copyButton.style.cursor = "pointer";
    copyButton.style.padding = "6px 10px";
    copyButton.style.border = "1px solid rgba(255,255,255,0.20)";
    copyButton.style.borderRadius = "7px";
    copyButton.style.background = "rgba(255,255,255,0.08)";
    copyButton.style.color = "inherit";
    copyButton.style.font = "inherit";

    const copyStatus = document.createElement("span");
    copyStatus.id = "copy-structural-debug-status";
    copyStatus.style.fontSize = "12px";
    copyStatus.style.opacity = "0.8";

    panel = document.createElement("pre");
    panel.id = "structural-level-debug";
    panel.style.margin = "0";
    panel.style.padding = "10px";
    panel.style.border = "1px solid rgba(255,255,255,0.14)";
    panel.style.borderRadius = "8px";
    panel.style.background = "rgba(255,255,255,0.035)";
    panel.style.fontSize = "11px";
    panel.style.lineHeight = "1.45";
    panel.style.whiteSpace = "pre-wrap";
    panel.style.userSelect = "text";

    copyButton.addEventListener("click", async () => {
      const originalLabel = copyButton.textContent;
      copyButton.disabled = true;
      const copied = await copyDiagnosticText(panel.textContent);
      copyButton.textContent = copied ? "Скопировано ✓" : "Не скопировалось";
      copyStatus.textContent = copied
        ? "Вставь текст прямо в чат"
        : "Выдели текст в блоке вручную";
      window.setTimeout(() => {
        copyButton.textContent = originalLabel;
        copyButton.disabled = false;
        copyStatus.textContent = "";
      }, 2200);
    });

    toolbar.append(copyButton, copyStatus);
    wrapper.append(toolbar, panel);
    anchor.insertAdjacentElement("afterend", wrapper);
  }

  if (message !== null) panel.textContent = String(message);
  return panel;
}
'''

if old not in text:
    raise SystemExit('ensureDiagnosticPanel block not found')
text = text.replace(old, new, 1)
runtime_path.write_text(text)
