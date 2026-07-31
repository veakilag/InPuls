from pathlib import Path
import re

OLD_BUILD = "26-85-live-footprint-source-v1"
NEW_BUILD = "26-86-global-connection-radar-cleanup-v1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, got {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, got {count}")
    return updated


# 1. Repair the global Binance market socket and prevent an endless CONNECTING state.
app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")
app = replace_once(
    app,
    '''    this.requestId = 1;
    this.manualClose = false;
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    this.manualClose = false;
    setConnection("connecting", "Подключение к Binance…");
    const endpoint = "wss://fstream.binance.com/market/stream";
    this.socket = new WebSocket(endpoint);

    this.socket.addEventListener("open", () => {''',
    '''    this.requestId = 1;
    this.manualClose = false;
    this.connectionTimer = null;
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimer);
    this.manualClose = false;
    setConnection("connecting", "Подключение к Binance…");
    const endpoint = "wss://fstream.binance.com/ws";
    const socket = new WebSocket(endpoint);
    this.socket = socket;
    this.connectionTimer = setTimeout(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.CONNECTING) return;
      setConnection("offline", "Binance не отвечает");
      socket.close();
    }, 10_000);

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectionTimer);''',
    "global Binance websocket endpoint and watchdog",
)
app = app.replace('this.socket.addEventListener("message",', 'socket.addEventListener("message",', 1)
app = replace_once(
    app,
    '''    this.socket.addEventListener("close", () => {
      if (this.manualClose) return;
      this.reconnectAttempt += 1;''',
    '''    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.manualClose) return;
      clearTimeout(this.connectionTimer);
      this.reconnectAttempt += 1;''',
    "global socket close guard",
)
app = replace_once(
    app,
    '''    this.socket.addEventListener("error", () => {
      setConnection("offline", "Ошибка потока");
    });''',
    '''    socket.addEventListener("error", () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectionTimer);
      setConnection("offline", "Ошибка потока");
    });''',
    "global socket error guard",
)

# 2. Remove the dedicated Event Radar data fan-out and its UI-only event handlers.
app = regex_once(
    app,
    r'''\n  const eventRadarMetrics = metrics\.map\(\(item\) => \{.*?\n  window\.dispatchEvent\(new CustomEvent\("inpuls:event-radar-update", \{.*?\n  \}\)\);''',
    "",
    "event radar update dispatch",
)
app = regex_once(
    app,
    r'''\n  window\.addEventListener\("inpuls:event-radar-select", \(event\) => \{.*?\n  \}\);\n  window\.addEventListener\("inpuls:event-radar-favorite", \(event\) => \{.*?\n  \}\);''',
    "",
    "event radar interaction handlers",
)
app_path.write_text(app, encoding="utf-8")

# 3. Remove Event Radar assets and controls from the browser shell.
index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
for old, label in [
    ('    <link rel="stylesheet" href="./event-radar-beta.css?v=event-radar-beta-v1" />\n', "event radar stylesheet"),
    ('        <button id="event-radar-beta-toggle" type="button" aria-pressed="true" title="Открыть событийный радар BETA">РАДАР BETA</button>\n', "event radar button"),
    ('    <script type="module" src="./event-radar-beta.js?v=event-radar-beta-v1"></script>\n', "event radar script"),
]:
    index = replace_once(index, old, "", label)
index_path.write_text(index, encoding="utf-8")

# 4. Remove Event Radar from the atomic PWA shell.
sw_path = Path("sw.js")
sw = sw_path.read_text(encoding="utf-8")
for old, label in [
    ('  ["/event-radar-beta.js", "./event-radar-beta.js?v=event-radar-beta-v1"],\n', "event radar forced js"),
    ('  ["/event-radar-beta.css", "./event-radar-beta.css?v=event-radar-beta-v1"],\n', "event radar forced css"),
    ('  "./event-radar-beta.js?v=event-radar-beta-v1",\n', "event radar shell js"),
    ('  "./event-radar-beta.css?v=event-radar-beta-v1",\n', "event radar shell css"),
]:
    sw = replace_once(sw, old, "", label)
sw_path.write_text(sw, encoding="utf-8")

# 5. Replace the old UI contract with an explicit removal regression.
ui_path = Path("test/ui.test.js")
ui = ui_path.read_text(encoding="utf-8")
ui = regex_once(
    ui,
    r'''\n\ntest\("event radar beta is isolated from the three existing discovery blocks", async \(\) => \{.*?\n\}\);\s*$''',
    '''\n\ntest("Event Radar Beta is fully absent while core discovery blocks remain", async () => {
  const [html, app, worker] = await Promise.all([
    source("index.html"), source("app.js"), source("sw.js"),
  ]);
  for (const text of [html, app, worker]) {
    assert.doesNotMatch(text, /event-radar-beta/);
    assert.doesNotMatch(text, /inpuls:event-radar-/);
  }
  assert.doesNotMatch(html, /РАДАР BETA/);
  assert.match(html, /class="inplay-strip"/);
  assert.match(html, /data-panel="radar"/);
  assert.match(html, /data-panel="scanner"/);
  assert.match(app, /updateSignalMemory/);
});
''',
    "event radar UI regression",
)
ui_path.write_text(ui, encoding="utf-8")

# 6. Delete the discontinued widget and its dedicated tests.
for filename in [
    "event-radar-beta.js",
    "event-radar-beta.css",
    "test-event-radar-beta-v1.mjs",
]:
    path = Path(filename)
    if not path.exists():
        raise RuntimeError(f"missing expected Event Radar file: {filename}")
    path.unlink()

# 7. Add a focused regression for the supported live-subscription endpoint and watchdog.
Path("test-global-connection-radar-cleanup-v1.mjs").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("global market feed uses the supported raw subscription endpoint", async () => {
  const app = await source("app.js");
  assert.match(app, /wss:\/\/fstream\.binance\.com\/ws/);
  assert.doesNotMatch(app, /fstream\.binance\.com\/market\/stream/);
  assert.match(app, /socket\.readyState !== WebSocket\.CONNECTING/);
  assert.match(app, /Binance не отвечает/);
  assert.match(app, /clearTimeout\(this\.connectionTimer\)/);
});

test("Event Radar Beta assets are removed from runtime and PWA cache", async () => {
  const [html, app, worker] = await Promise.all([
    source("index.html"), source("app.js"), source("sw.js"),
  ]);
  for (const text of [html, app, worker]) {
    assert.doesNotMatch(text, /event-radar-beta/);
    assert.doesNotMatch(text, /inpuls:event-radar-/);
  }
});
''', encoding="utf-8")

# 8. Remove retired feature flags while preserving the complete release manifest.
version_path = Path("VERSION.txt")
version_lines = version_path.read_text(encoding="utf-8").splitlines()
removed_features = {
    "event-radar-beta-v1",
    "event-age-lifecycle-v1",
    "event-list-freeze-v1",
    "event-data-state-v1",
}
updated_lines = []
for line in version_lines:
    if line.startswith("Features:"):
        features = [item.strip() for item in line[len("Features:"):].split(",") if item.strip()]
        features = [item for item in features if item not in removed_features]
        if "global-market-stream-v1" not in features:
            features.append("global-market-stream-v1")
        line = "Features: " + ", ".join(features)
    updated_lines.append(line)
version_path.write_text("\n".join(updated_lines) + "\n", encoding="utf-8")

# 9. Bump cache/build references atomically across the remaining runtime and tests.
for candidate in Path(".").rglob("*"):
    if not candidate.is_file():
        continue
    if any(part in {".git", "node_modules"} for part in candidate.parts):
        continue
    if candidate == Path(__file__):
        continue
    if candidate.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".json"}:
        continue
    text = candidate.read_text(encoding="utf-8")
    if OLD_BUILD not in text:
        continue
    candidate.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

# Final runtime invariants.
for runtime_name in ["index.html", "app.js", "sw.js"]:
    runtime = Path(runtime_name).read_text(encoding="utf-8")
    if "event-radar-beta" in runtime or "inpuls:event-radar-" in runtime:
        raise RuntimeError(f"Event Radar reference remains in {runtime_name}")
if "wss://fstream.binance.com/market/stream" in Path("app.js").read_text(encoding="utf-8"):
    raise RuntimeError("unsupported global websocket endpoint remains")

print(f"Applied {NEW_BUILD}")
