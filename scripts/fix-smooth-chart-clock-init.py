from pathlib import Path

path = Path("app.js")
source = path.read_text(encoding="utf-8")
old = '''let lastHeaderClockText = "";
let clockTickTimer = null;
function updateClock(date = new Date()) {
  const zone = state.timeZone === "local"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : state.timeZone;
  const nextText = timeZoneClock(zone, date, true);
  if (nextText !== lastHeaderClockText) {
    lastHeaderClockText = nextText;
    els.clock.textContent = nextText;
  }
  updateTimeZoneClocks(date);
}
function scheduleClockTick() {
  clearTimeout(clockTickTimer);
  const delay = Math.max(40, 1_000 - (Date.now() % 1_000) + 12);
  clockTickTimer = setTimeout(() => {
    requestAnimationFrame(() => {
      updateClock(new Date());
      scheduleClockTick();
    });
  }, delay);
}
'''
new = '''function updateClock(date = new Date()) {
  const zone = state.timeZone === "local"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : state.timeZone;
  const nextText = timeZoneClock(zone, date, true);
  if (nextText !== updateClock.lastText) {
    updateClock.lastText = nextText;
    els.clock.textContent = nextText;
  }
  updateTimeZoneClocks(date);
}
function scheduleClockTick() {
  clearTimeout(scheduleClockTick.timer);
  const delay = Math.max(40, 1_000 - (Date.now() % 1_000) + 12);
  scheduleClockTick.timer = setTimeout(() => {
    requestAnimationFrame(() => {
      updateClock(new Date());
      scheduleClockTick();
    });
  }, delay);
}
'''
if old not in source:
    raise SystemExit("Clock block not found")
path.write_text(source.replace(old, new, 1), encoding="utf-8")

check = Path("test-smooth-chart-first-v1.mjs")
test_source = check.read_text(encoding="utf-8")
old_test = '''  assert.doesNotMatch(app, /setInterval\\(updateClock,\\s*1000\\)/);
  assert.match(html, /app\\.js\\?v=26-97-smooth-chart-first-v1/);
'''
new_test = '''  assert.doesNotMatch(app, /setInterval\\(updateClock,\\s*1000\\)/);
  assert.doesNotMatch(app, /let lastHeaderClockText|let clockTickTimer/);
  assert.match(app, /updateClock\\.lastText/);
  assert.match(app, /scheduleClockTick\\.timer/);
  assert.match(html, /app\\.js\\?v=26-97-smooth-chart-first-v1/);
'''
if old_test not in test_source:
    raise SystemExit("Clock test block not found")
check.write_text(test_source.replace(old_test, new_test, 1), encoding="utf-8")
