from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_KEY = "26-110-low-latency-active-tape-v1"
NEW_KEY = "26-111-header-command-bar-v1"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, content):
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# Use the supplied product mark as a repository asset.
logo_path = ROOT / "assets" / "inpuls-logo.svg"
logo_path.parent.mkdir(parents=True, exist_ok=True)
logo_path.write_text('''<svg width="282" height="348" viewBox="0 0 282 348" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M241.511 204.223H280.617L274.266 224.223H149.266L155.616 204.223H220.312L172.436 68.0273L84.5488 342.297L50.1094 224.223H1.29688L7.64844 204.223H77.2969L70.9453 224.223H70.9434L85.4463 273.95L171.56 5.22266L241.511 204.223Z" fill="#6904DE"/>
</svg>
''', encoding="utf-8")

# Rebuild the top bar. Left-to-right DOM order makes the requested right-to-left
# command order: settings, timezone, sound, download.
path = "index.html"
text = read(path)
header_start = text.index('    <header class="topbar">')
header_end = text.index('    </header>', header_start) + len('    </header>')
new_header = '''    <header class="topbar">
      <a class="brand" href="./" aria-label="InPuls — главная">
        <img class="brand-logo" src="./assets/inpuls-logo.svg" alt="" width="282" height="348" />
        <strong class="brand-name">InPuls</strong>
      </a>
      <div class="inplay-strip" aria-label="Монеты в игре сейчас">
        <div class="inplay-title"><span class="inplay-label">INPLAY</span><button id="inplay-settings" type="button" title="Настроить единые правила INPLAY">⚙</button></div>
        <div id="inplay-coins" class="inplay-coins"><span class="inplay-loading">Собираю активные монеты…</span></div>
      </div>
      <div class="topbar-actions" aria-label="Основные действия">
        <span class="clock-dock" data-clock-dock aria-label="База часов">
          <time id="clock" class="clock" tabindex="0">--:--:--</time>
        </span>
        <div id="connection-status" class="connection" data-status="connecting" role="status" aria-live="polite" aria-label="Подключение">
          <span class="connection-dot" aria-hidden="true"></span>
          <span id="connection-text" class="sr-only">Подключение…</span>
        </div>
        <button id="install-app" class="header-command-button header-download-button" type="button" title="Скачать InPuls" aria-label="Скачать InPuls">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/></svg>
          <span>Скачать</span>
        </button>
        <button id="sound-toggle" class="header-command-button header-icon-button" type="button" title="Включить звук" aria-label="Включить звук">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9v6h4l5 4V5L9 9H5Zm12.5 1a4 4 0 0 1 0 4"/></svg>
          <span class="sr-only">Звук выключен</span>
        </button>
        <button id="timezone-open" class="header-command-button header-timezone-button" type="button" title="Выбрать город и часовой пояс" aria-label="Выбрать город и часовой пояс">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/></svg>
          <strong id="timezone-city">Москва</strong>
        </button>
        <button id="settings-open" class="header-command-button header-icon-button" type="button" title="Настройки" aria-label="Настройки">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 13.4v-2.8l-2-.7a7.2 7.2 0 0 0-.7-1.7l.9-1.9-2-2-1.9.9a7.2 7.2 0 0 0-1.7-.7L10.9 2H8.1l-.7 2.5a7.2 7.2 0 0 0-1.7.7l-1.9-.9-2 2 .9 1.9a7.2 7.2 0 0 0-.7 1.7l-2 .7v2.8l2 .7a7.2 7.2 0 0 0 .7 1.7l-.9 1.9 2 2 1.9-.9a7.2 7.2 0 0 0 1.7.7l.7 2.5h2.8l.7-2.5a7.2 7.2 0 0 0 1.7-.7l1.9.9 2-2-.9-1.9a7.2 7.2 0 0 0 .7-1.7l2-.7Z" transform="translate(2.5 0) scale(.8 1)"/></svg>
        </button>
      </div>
    </header>'''
text = text[:header_start] + new_header + text[header_end:]

settings_anchor = '''        <p class="dialog-intro">Здесь только отображение и управление. Фильтры отбора монет и формулы сигналов убраны из этого окна.</p>
        <label class="font-scale-control"><span>Шрифт всего сайта</span><input id="font-scale" type="range" min="80" max="200" step="5" value="100" /><strong id="font-scale-value">100%</strong></label>'''
settings_replacement = '''        <p class="dialog-intro">Здесь только отображение и управление. Фильтры отбора монет и формулы сигналов убраны из этого окна.</p>
        <div class="settings-display-controls">
          <label class="comfort-control settings-comfort-control" title="Яркость интерфейса">
            <span class="settings-control-label">Яркость интерфейса</span>
            <span class="comfort-track" aria-hidden="true">
              <span class="comfort-thumb-icon">
                <svg class="comfort-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/></svg>
                <svg class="comfort-moon" viewBox="0 0 24 24"><path d="M19.4 15.2A8 8 0 0 1 8.8 4.6 8.1 8.1 0 1 0 19.4 15.2Z"/></svg>
              </span>
            </span>
            <input id="comfort-slider" type="range" min="0" max="100" value="55" aria-label="Яркость интерфейса: слева светлее, справа темнее" />
          </label>
          <button id="event-radar-beta-toggle" class="settings-radar-toggle" type="button" aria-pressed="true" title="Открыть событийный радар BETA"><span>Событийный радар</span><strong>BETA</strong></button>
        </div>
        <label class="font-scale-control"><span>Шрифт всего сайта</span><input id="font-scale" type="range" min="80" max="200" step="5" value="100" /><strong id="font-scale-value">100%</strong></label>'''
text = replace_once(text, settings_anchor, settings_replacement, "move display controls into settings")
text = text.replace('href="./styles.css?v=26-99-tape-priority-comfort-v1"', f'href="./styles.css?v={NEW_KEY}"')
write(path, text)

# Add the dock reference and make the visible online dot carry the textual state
# through aria/title without adding another header label.
path = "app.js"
text = read(path)
text = replace_once(
    text,
    '  clock: document.querySelector("#clock"),\n',
    '  clock: document.querySelector("#clock"),\n  clockDock: document.querySelector("[data-clock-dock]"),\n',
    "clock dock element",
)
text = replace_once(
    text,
    '''function setConnection(status, text) {
  els.status.dataset.status = status;
  els.statusText.textContent = text;
}''',
    '''function setConnection(status, text) {
  els.status.dataset.status = status;
  els.statusText.textContent = text;
  els.status.title = text;
  els.status.setAttribute("aria-label", text);
}''',
    "accessible connection state",
)
start = text.index("function enableClockDrag() {")
end = text.index("\nbinanceClock.setTimeZone", start)
new_drag = '''function enableClockDrag() {
  const clock = els.clock;
  const dock = els.clockDock;
  if (!clock || !dock) return;
  let floating = false;
  let lastPosition = null;

  const clearFloatingStyles = () => {
    for (const property of [
      "position",
      "left",
      "top",
      "zIndex",
      "padding",
      "borderRadius",
      "background",
      "boxShadow",
    ]) clock.style[property] = "";
    delete clock.dataset.floating;
  };

  const dockClock = (persist = true) => {
    floating = false;
    lastPosition = null;
    clearFloatingStyles();
    dock.append(clock);
    dock.classList.remove("is-snap-target", "is-clock-away");
    if (persist) localStorage.removeItem(STORAGE_KEYS.clockPosition);
  };

  const applyFloating = (position, persist = true) => {
    const rect = clock.getBoundingClientRect();
    const next = clampClockPosition(
      position?.left,
      position?.top,
      rect.width || 84,
      rect.height || 22,
    );
    floating = true;
    lastPosition = next;
    if (clock.parentElement !== document.body) document.body.append(clock);
    dock.classList.add("is-clock-away");
    clock.dataset.floating = "true";
    clock.style.position = "fixed";
    clock.style.left = `${next.left}px`;
    clock.style.top = `${next.top}px`;
    clock.style.zIndex = "1200";
    clock.style.padding = "5px 9px";
    clock.style.borderRadius = "8px";
    clock.style.background = "color-mix(in srgb, var(--panel) 94%, transparent)";
    clock.style.boxShadow = "0 6px 22px rgba(0, 0, 0, .32), 0 0 0 1px var(--line-soft)";
    if (persist) localStorage.setItem(STORAGE_KEYS.clockPosition, JSON.stringify(next));
  };

  const inSnapZone = (clientX, clientY) => {
    const rect = dock.getBoundingClientRect();
    const margin = 28;
    return clientX >= rect.left - margin
      && clientX <= rect.right + margin
      && clientY >= rect.top - margin
      && clientY <= rect.bottom + margin;
  };

  clock.style.touchAction = "none";
  clock.style.cursor = "grab";
  clock.title = `${clock.title || "Время Binance Futures"} · перетащи, двойной клик — вернуть в шапку`;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.clockPosition) || "null");
    if (saved && typeof saved === "object") applyFloating(saved, false);
  } catch {}

  clock.addEventListener("dblclick", () => dockClock());
  clock.addEventListener("keydown", (event) => {
    if (event.key === "Home" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      dockClock();
    }
  });
  clock.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = clock.getBoundingClientRect();
    const originLeft = rect.left;
    const originTop = rect.top;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let snap = false;
    lastPosition = { left: originLeft, top: originTop };
    clock.setPointerCapture?.(event.pointerId);
    clock.style.cursor = "grabbing";
    document.documentElement.dataset.clockDragging = "true";

    const move = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!moved && Math.hypot(deltaX, deltaY) < 3) return;
      moved = true;
      applyFloating({ left: originLeft + deltaX, top: originTop + deltaY }, false);
      snap = inSnapZone(moveEvent.clientX, moveEvent.clientY);
      dock.classList.toggle("is-snap-target", snap);
    };
    const stop = () => {
      clock.style.cursor = "grab";
      delete document.documentElement.dataset.clockDragging;
      dock.classList.remove("is-snap-target");
      clock.releasePointerCapture?.(event.pointerId);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
      if (!moved) return;
      if (snap) dockClock();
      else applyFloating(lastPosition, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
  });

  window.addEventListener("resize", () => {
    if (!floating) return;
    const rect = clock.getBoundingClientRect();
    applyFloating({ left: rect.left, top: rect.top });
  });
}
'''
text = text[:start] + new_drag + text[end:]
write(path, text)

# Final visual layer deliberately comes last so it supersedes legacy header and
# mobile rules without disturbing the rest of the trading workspace.
path = "styles.css"
text = read(path)
css = r'''

/* v26.111 compact command header */
.sr-only { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
.topbar { display: flex; justify-content: flex-start; gap: 10px; }
.brand { order: 1; flex: 0 0 auto; margin-left: 0; gap: 8px; min-width: max-content; }
.brand-logo { width: 24px; height: 30px; display: block; object-fit: contain; filter: drop-shadow(0 0 8px rgba(105, 4, 222, .28)); }
.brand-name { font: 800 calc(16 * var(--font-scale))/1 Arial, Helvetica, sans-serif; letter-spacing: -.035em; text-transform: none; }
.inplay-strip { order: 2; }
.topbar-actions { order: 3; flex: 0 0 auto; margin-left: auto; display: flex; align-items: center; gap: 6px; }
.header-command-button { min-height: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; color: var(--muted); background: color-mix(in srgb, var(--panel-2) 90%, transparent); cursor: pointer; transition: color .16s ease, border-color .16s ease, background-color .16s ease, transform .12s ease; }
.header-command-button:hover { color: var(--text); border-color: color-mix(in srgb, var(--violet) 55%, var(--line)); background: var(--panel-2); }
.header-command-button:active { transform: translateY(1px); }
.header-command-button:focus-visible { outline: 2px solid color-mix(in srgb, var(--violet) 72%, transparent); outline-offset: 2px; }
.header-command-button svg { width: 17px; height: 17px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.header-icon-button { width: 32px; padding: 0; }
.header-download-button { color: color-mix(in srgb, var(--green) 82%, var(--text)); border-color: color-mix(in srgb, var(--green) 42%, var(--line)); font-size: calc(10 * var(--font-scale)); font-weight: 800; }
.header-timezone-button { min-width: 92px; max-width: 142px; }
.header-timezone-button strong { max-width: 92px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: calc(9 * var(--font-scale)); }
#sound-toggle.is-active { color: var(--green); border-color: color-mix(in srgb, var(--green) 42%, var(--line)); background: color-mix(in srgb, var(--green) 8%, var(--panel-2)); }
.connection { min-width: 24px; width: 24px; height: 32px; display: grid; place-items: center; gap: 0; }
.connection-dot { width: 12px; height: 12px; border: 1px solid color-mix(in srgb, var(--amber) 74%, #fff); box-shadow: 0 0 0 4px rgba(255, 196, 95, .08), 0 0 12px rgba(255, 196, 95, .24); }
.connection[data-status="online"] .connection-dot { box-shadow: 0 0 0 4px rgba(80, 227, 164, .1), 0 0 15px rgba(80, 227, 164, .68); }
.connection[data-status="offline"] .connection-dot { box-shadow: 0 0 0 4px rgba(255, 113, 129, .1), 0 0 13px rgba(255, 113, 129, .52); }
.clock-dock { position: relative; width: 86px; height: 32px; flex: 0 0 86px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 8px; transition: border-color .14s ease, background-color .14s ease, box-shadow .14s ease; }
.clock-dock.is-clock-away { border-style: dashed; border-color: color-mix(in srgb, var(--line) 78%, transparent); }
.clock-dock.is-clock-away::after { content: "ВРЕМЯ"; color: var(--muted); opacity: .55; font-size: calc(7 * var(--font-scale)); font-weight: 800; letter-spacing: .12em; }
.clock-dock.is-snap-target { border-color: var(--violet); background: color-mix(in srgb, var(--violet) 12%, transparent); box-shadow: 0 0 18px color-mix(in srgb, var(--violet) 24%, transparent); }
.clock { min-width: 76px; color: var(--text); font-size: calc(13 * var(--font-scale)); font-weight: 760; text-align: center; user-select: none; }
.clock[data-floating="true"] { border: 1px solid color-mix(in srgb, var(--violet) 45%, var(--line)); }
html[data-clock-dragging="true"] .clock-dock { border-color: color-mix(in srgb, var(--violet) 45%, var(--line)); }
.settings-display-controls { display: grid; grid-template-columns: minmax(240px, 1fr) auto; align-items: center; gap: 10px; margin: -8px 0 14px; }
.settings-display-controls .comfort-control { width: 100%; height: 40px; display: grid; grid-template-columns: minmax(112px, auto) 1fr; place-items: center stretch; gap: 12px; padding: 0 12px; }
.settings-display-controls .comfort-track { width: 100%; }
.settings-display-controls .comfort-control input { inset: 0 12px 0 auto; width: calc(100% - 148px); }
.settings-control-label { color: var(--muted); font-size: calc(9 * var(--font-scale)); font-weight: 700; }
.settings-radar-toggle { min-height: 40px; display: inline-flex; align-items: center; gap: 7px; padding: 0 12px; border: 1px solid var(--line); border-radius: 7px; color: var(--text); background: var(--panel-2); cursor: pointer; }
.settings-radar-toggle strong { color: var(--violet); font-size: calc(8 * var(--font-scale)); letter-spacing: .08em; }
.settings-radar-toggle[aria-pressed="true"] { border-color: color-mix(in srgb, var(--violet) 48%, var(--line)); }

@media (max-width: 1180px) {
  .header-timezone-button { min-width: 34px; width: 34px; padding: 0; }
  .header-timezone-button strong { display: none; }
  .header-download-button { width: 34px; padding: 0; }
  .header-download-button > span { display: none; }
}
@media (max-width: 720px) {
  .topbar { height: 44px; gap: 5px; padding: 0 6px; }
  .brand { order: 1; margin-left: 0; gap: 5px; }
  .brand-logo { width: 19px; height: 25px; }
  .brand-name { font-size: calc(13 * var(--font-scale)); }
  .inplay-strip { display: none; }
  .topbar-actions { order: 3; margin-left: auto; gap: 3px; }
  .header-command-button, #sound-toggle, #install-app { display: inline-flex !important; width: 30px; min-width: 30px; height: 30px; min-height: 30px; padding: 0; }
  .connection { display: grid !important; width: 21px; min-width: 21px; height: 30px; }
  .connection-dot { width: 10px; height: 10px; }
  .clock-dock { display: grid; width: 72px; flex-basis: 72px; height: 30px; }
  .clock { display: block; min-width: 68px; font-size: calc(11 * var(--font-scale)); }
  .settings-display-controls { grid-template-columns: 1fr; }
  .settings-display-controls .comfort-control { display: grid; }
}
@media (max-width: 470px) {
  .brand-name { display: none; }
  .clock-dock { width: 66px; flex-basis: 66px; }
  .clock { min-width: 62px; font-size: calc(10 * var(--font-scale)); }
}
'''
if "/* v26.111 compact command header */" in text:
    raise SystemExit("header CSS already applied")
write(path, text + css)

# Keep release inventory and all source contracts on one cache-busting key.
for candidate in (
    list(ROOT.glob("*.js"))
    + list(ROOT.glob("*.mjs"))
    + list(ROOT.glob("*.html"))
    + list((ROOT / "test").glob("*.js"))
):
    content = candidate.read_text(encoding="utf-8")
    if OLD_KEY in content:
        candidate.write_text(content.replace(OLD_KEY, NEW_KEY), encoding="utf-8")

path = "sw.js"
text = read(path)
text = text.replace('"./styles.css?v=26-91-runtime-boot-cache-feed-v1",', f'"./styles.css?v={NEW_KEY}",')
text = replace_once(
    text,
    '  "./assets/inpuls-world-map-v17.png",\n',
    '  "./assets/inpuls-logo.svg",\n  "./assets/inpuls-world-map-v17.png",\n',
    "logo release asset",
)
write(path, text)

# A deterministic source contract prevents the header from accumulating buttons
# again and protects the magnetic clock behavior.
test = ROOT / "test-header-command-bar-v1.mjs"
test.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");\n\ntest("header exposes exactly four command buttons in requested order", () => {\n  const html = read("./index.html");\n  const header = html.match(/<header class="topbar">[\\s\\S]*?<\\/header>/)?.[0] ?? "";\n  assert.equal((header.match(/header-command-button/g) ?? []).length, 4);\n  const ids = ["install-app", "sound-toggle", "timezone-open", "settings-open"];\n  const positions = ids.map((id) => header.indexOf(`id="${id}"`));\n  assert.ok(positions.every((position) => position >= 0));\n  assert.deepEqual([...positions].sort((a, b) => a - b), positions);\n  assert.match(header, /class="connection-dot"/);\n  assert.match(header, /data-clock-dock/);\n});\n\ntest("supplied logo and compact brand are used", () => {\n  const html = read("./index.html");\n  const logo = read("./assets/inpuls-logo.svg");\n  assert.match(html, /src="\\.\\/assets\\/inpuls-logo\\.svg"/);\n  assert.match(html, /class="brand-name">InPuls</);\n  assert.match(logo, /fill="#6904DE"/);\n});\n\ntest("clock can float and magnetically return to its dock", () => {\n  const app = read("./app.js");\n  assert.match(app, /clockDock: document\\.querySelector/);\n  assert.match(app, /const inSnapZone =/);\n  assert.match(app, /dock\\.append\\(clock\\)/);\n  assert.match(app, /if \\(snap\\) dockClock\\(\\)/);\n  assert.match(app, /document\\.body\\.append\\(clock\\)/);\n});\n\ntest("brightness and radar controls live in settings, not the header", () => {\n  const html = read("./index.html");\n  const header = html.match(/<header class="topbar">[\\s\\S]*?<\\/header>/)?.[0] ?? "";\n  const settings = html.match(/<dialog id="settings-dialog"[\\s\\S]*?<\\/dialog>/)?.[0] ?? "";\n  assert.doesNotMatch(header, /comfort-slider|event-radar-beta-toggle/);\n  assert.match(settings, /comfort-slider/);\n  assert.match(settings, /event-radar-beta-toggle/);\n});\n\ntest("release inventory includes the product logo", () => {\n  const serviceWorker = read("./sw.js");\n  assert.match(serviceWorker, /assets\\/inpuls-logo\\.svg/);\n});\n''', encoding="utf-8")
