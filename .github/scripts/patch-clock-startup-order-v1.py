from pathlib import Path


def require_once(source: str, needle: str, label: str) -> None:
    count = source.count(needle)
    if count != 1:
        raise SystemExit(f"Expected exactly one {label}, found {count}")


app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")
startup_anchor = "bindEvents();\n"
clock_declarations = 'let lastHeaderClockText = "";\nlet clockTickTimer = null;\n'
require_once(app, startup_anchor, "bindEvents startup anchor")
require_once(app, clock_declarations, "clock cache declaration block")

startup_index = app.index(startup_anchor)
declaration_index = app.index(clock_declarations)
if declaration_index < startup_index:
    raise SystemExit("Clock cache is already initialized before startup; patch is not applicable")

app = app.replace(clock_declarations, "", 1)
app = app.replace(
    startup_anchor,
    "// Clock state must exist before bindTimeZonePicker can synchronously call updateClock.\n"
    + clock_declarations
    + "\n"
    + startup_anchor,
    1,
)
app_path.write_text(app, encoding="utf-8")


test_path = Path("test-core-feed-footprint-runtime-v1.mjs")
test_source = test_path.read_text(encoding="utf-8")
test_anchor = 'test("critical market discovery has a REST bootstrap while WebSocket reconnects", async () => {'
require_once(test_source, test_anchor, "core-feed test insertion anchor")
regression = '''test("clock cache is initialized before lifecycle bindings can synchronously update the header", async () => {
  const app = await source("app.js");
  const startupIndex = app.indexOf("bindEvents();");
  const clockIndex = app.indexOf('let lastHeaderClockText = "";');
  const timerIndex = app.indexOf("let clockTickTimer = null;");
  assert.ok(startupIndex >= 0, "bindEvents startup call is missing");
  assert.ok(clockIndex >= 0 && clockIndex < startupIndex, "clock text cache must exist before bindEvents");
  assert.ok(timerIndex >= 0 && timerIndex < startupIndex, "clock timer state must exist before bindEvents");
  assert.equal((app.match(/let lastHeaderClockText = "";/g) || []).length, 1);
  assert.equal((app.match(/let clockTickTimer = null;/g) || []).length, 1);
});

'''
if regression in test_source:
    raise SystemExit("Clock startup regression is already present; patch is not applicable")
test_source = test_source.replace(test_anchor, regression + test_anchor, 1)
test_path.write_text(test_source, encoding="utf-8")
