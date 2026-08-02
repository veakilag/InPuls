from pathlib import Path

ORDERBOOK = Path("orderbook.js")
APP = Path("app.js")
INDEX = Path("index.html")
TEST = Path("test-tape-heartbeat-isolation-v1.mjs")

orderbook = ORDERBOOK.read_text(encoding="utf-8")

replacements = [
    (
        'const tapeCardStates = new WeakMap();\nlet tapeDrawFrame = 0;',
        'const tapeCardStates = new WeakMap();\nconst boundTapeCards = new Set();\nlet tapeDrawFrame = 0;',
    ),
    (
        '''function decorateDensityAges(card, state = tapeCardStates.get(card)) {
  const rows = [...card.querySelectorAll(".orderbook-rows .book-ladder-row")];
  for (const row of rows) row.querySelector(".book-size")?.removeAttribute("data-density-age");
  if (!state?.densityAgeVisible) return;
''',
        '''function decorateDensityAges(card, state = tapeCardStates.get(card)) {
  if (!state?.densityAgeVisible) {
    if (state?.densityAgeDecorated) {
      card.querySelectorAll(".orderbook-rows .book-size[data-density-age]").forEach((size) => {
        size.removeAttribute("data-density-age");
        if (size.title?.startsWith("Наблюдаемый возраст плотности")) size.removeAttribute("title");
      });
      state.densityAgeDecorated = false;
    }
    return;
  }
  const rows = [...card.querySelectorAll(".orderbook-rows .book-ladder-row")];
  for (const row of rows) row.querySelector(".book-size")?.removeAttribute("data-density-age");
  state.densityAgeDecorated = false;
''',
    ),
    (
        '''    if (size) {
      size.dataset.densityAge = formatObservedAge(age);
      size.title = `Наблюдаемый возраст плотности ${formatObservedAge(age)} · ${density.state || "active"}`;
    }
  }
}

function syncDensityAgeButton''',
        '''    if (size) {
      const ageLabel = formatObservedAge(age);
      size.dataset.densityAge = ageLabel;
      size.title = `Наблюдаемый возраст плотности ${ageLabel} · ${density.state || "active"}`;
      state.densityAgeDecorated = true;
    }
  }
}

function syncDensityAgeButton''',
    ),
    (
        '''      densityAgeVisible: localStorage.getItem(DENSITY_AGE_VISIBLE_KEY) === "1",
      minQuote:''',
        '''      densityAgeVisible: localStorage.getItem(DENSITY_AGE_VISIBLE_KEY) === "1",
      densityAgeDecorated: false,
      minQuote:''',
    ),
    (
        '''function bindTapeCard(card) {
  arrangeOrderBookChrome(card);
  ensureTapeUi(card);
  scheduleTapeDraw(true, card);
}
''',
        '''function bindTapeCard(card) {
  if (!card?.isConnected) return;
  boundTapeCards.add(card);
  arrangeOrderBookChrome(card);
  ensureTapeUi(card);
  scheduleTapeDraw(true, card);
}
''',
    ),
    (
        '''  requestAnimationFrame(() => {
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      if (cardSymbol(card) === symbol) decorateDensityAges(card);
    });
  });
}

function acceptBookStatus''',
        '''  requestAnimationFrame(function refreshVisibleDensityAgesAfterBookData() {
    for (const card of boundTapeCards) {
      if (!card?.isConnected) {
        boundTapeCards.delete(card);
        continue;
      }
      const state = tapeCardStates.get(card);
      if (!state?.densityAgeVisible || cardSymbol(card) !== symbol) continue;
      decorateDensityAges(card, state);
    }
  });
}

function acceptBookStatus''',
    ),
]

for old, new in replacements:
    if old not in orderbook:
        raise SystemExit(f"Expected orderbook marker not found:\n{old[:180]}")
    orderbook = orderbook.replace(old, new, 1)

old_timer = '''  clearInterval(tapeStateTimer);
  tapeStateTimer = setInterval(() => {
    if (tapeDocumentHidden) return;
    scanTapeCards(document);
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      const state = tapeCardStates.get(card);
      if (!state) return;
      decorateDensityAges(card, state);
      const symbol = cardSymbol(card);
      const suffix = staleTradeSuffix(symbol);
      if (suffix) setTapeState(state, `НЕТ НОВЫХ СДЕЛОК${suffix}`, "attention");
      else if (state.status?.textContent?.startsWith("НЕТ НОВЫХ СДЕЛОК")) setTapeState(state, "");
    });
  }, TAPE_STATE_REFRESH_MS);

  scheduleTapeDraw(true);
}'''
new_timer = '''  clearTimeout(tapeStateTimer);
  const refreshTapeStateHeartbeat = () => {
    for (const card of boundTapeCards) {
      if (!card?.isConnected) {
        boundTapeCards.delete(card);
        continue;
      }
      const state = tapeCardStates.get(card);
      if (!state) {
        boundTapeCards.delete(card);
        continue;
      }
      const symbol = cardSymbol(card);
      const suffix = staleTradeSuffix(symbol);
      if (suffix) setTapeState(state, `НЕТ НОВЫХ СДЕЛОК${suffix}`, "attention");
      else if (state.lastStatusText?.startsWith("НЕТ НОВЫХ СДЕЛОК")) setTapeState(state, "");
    }
  };
  const runTapeStateHeartbeat = () => {
    tapeStateTimer = 0;
    if (!tapeDocumentHidden) refreshTapeStateHeartbeat();
    tapeStateTimer = setTimeout(runTapeStateHeartbeat, TAPE_STATE_REFRESH_MS);
  };
  tapeStateTimer = setTimeout(runTapeStateHeartbeat, TAPE_STATE_REFRESH_MS);

  scheduleTapeDraw(true);
}'''
if old_timer not in orderbook:
    raise SystemExit("Expected Tape state interval block not found")
orderbook = orderbook.replace(old_timer, new_timer, 1)
ORDERBOOK.write_text(orderbook, encoding="utf-8")

app = APP.read_text(encoding="utf-8")
old_orderbook_import = './orderbook.js?v=26-91-runtime-boot-cache-feed-v1'
new_orderbook_import = './orderbook.js?v=26-100-tape-heartbeat-isolation-v1'
if old_orderbook_import not in app:
    raise SystemExit("Expected orderbook import cache key not found")
app = app.replace(old_orderbook_import, new_orderbook_import, 1)
APP.write_text(app, encoding="utf-8")

index = INDEX.read_text(encoding="utf-8")
old_app_script = './app.js?v=26-99-tape-priority-comfort-v1'
new_app_script = './app.js?v=26-100-tape-heartbeat-isolation-v1'
if old_app_script not in index:
    raise SystemExit("Expected app cache key not found")
index = index.replace(old_app_script, new_app_script, 1)
INDEX.write_text(index, encoding="utf-8")

for filename in [
    "test-comfort-slider-smooth-v1.mjs",
    "test-orderbook-resume-v2.mjs",
    "test-orderbook-runtime-stability.mjs",
    "test-smooth-chart-first-v1.mjs",
]:
    path = Path(filename)
    source = path.read_text(encoding="utf-8")
    source = source.replace(
        'app\\.js\\?v=26-99-tape-priority-comfort-v1',
        'app\\.js\\?v=26-100-tape-heartbeat-isolation-v1',
    )
    source = source.replace(
        'orderbook\\.js\\?v=26-91-runtime-boot-cache-feed-v1',
        'orderbook\\.js\\?v=26-100-tape-heartbeat-isolation-v1',
    )
    path.write_text(source, encoding="utf-8")

TEST.write_text(r'''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");

function section(startMarker, endMarker) {
  const start = orderbook.indexOf(startMarker);
  const end = orderbook.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} section must exist`);
  return orderbook.slice(start, end);
}

test("Tape heartbeat no longer scans the document or redraws canvases every second", () => {
  const runtime = section("function installOrderBookRuntime()", "\nif (typeof document !== \"undefined\")");
  const heartbeatStart = runtime.indexOf("const refreshTapeStateHeartbeat = () => {");
  const heartbeatEnd = runtime.indexOf("\n  scheduleTapeDraw(true);", heartbeatStart);
  const heartbeat = runtime.slice(heartbeatStart, heartbeatEnd);

  assert.match(heartbeat, /for \(const card of boundTapeCards\)/);
  assert.match(heartbeat, /setTimeout\(runTapeStateHeartbeat, TAPE_STATE_REFRESH_MS\)/);
  assert.doesNotMatch(heartbeat, /setInterval/);
  assert.doesNotMatch(heartbeat, /scanTapeCards\(document\)/);
  assert.doesNotMatch(heartbeat, /querySelectorAll\("\.orderbook-card"\)/);
  assert.doesNotMatch(heartbeat, /decorateDensityAges/);
  assert.doesNotMatch(heartbeat, /scheduleTapeDraw|drawAllTapes|requestAnimationFrame/);
});

test("bound Tape cards are event-discovered and disconnected cards are pruned", () => {
  assert.match(orderbook, /const boundTapeCards = new Set\(\)/);
  const bind = section("function bindTapeCard(card) {", "\nfunction scanTapeCards");
  assert.match(bind, /boundTapeCards\.add\(card\)/);
  assert.match(orderbook, /if \(!card\?\.isConnected\) \{[\s\S]*boundTapeCards\.delete\(card\)/);
  assert.match(orderbook, /new MutationObserver\(\(mutations\) =>/);
});

test("hidden density-age mode performs no ladder-row scan", () => {
  const decorate = section("function decorateDensityAges", "\nfunction syncDensityAgeButton");
  const visibilityGuard = decorate.indexOf("if (!state?.densityAgeVisible)");
  const rowScan = decorate.indexOf('card.querySelectorAll(".orderbook-rows .book-ladder-row")');
  assert.ok(visibilityGuard >= 0 && rowScan > visibilityGuard);
  assert.match(decorate, /if \(state\?\.densityAgeDecorated\)/);
  assert.match(decorate, /state\.densityAgeDecorated = false/);
  assert.match(decorate, /state\.densityAgeDecorated = true/);
});

test("book data refreshes density ages only for visible matching cards", () => {
  const accept = section("function acceptBookData", "\nfunction acceptBookStatus");
  assert.match(accept, /for \(const card of boundTapeCards\)/);
  assert.match(accept, /!state\?\.densityAgeVisible \|\| cardSymbol\(card\) !== symbol/);
  assert.doesNotMatch(accept, /document\.querySelectorAll\("\.orderbook-card"\)/);
});

test("isolated Tape build ships through fresh module keys", () => {
  assert.match(app, /orderbook\.js\?v=26-100-tape-heartbeat-isolation-v1/);
  assert.match(index, /app\.js\?v=26-100-tape-heartbeat-isolation-v1/);
});
''', encoding="utf-8")
