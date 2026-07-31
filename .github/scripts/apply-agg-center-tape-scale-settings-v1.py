from pathlib import Path
import re

OLD_BUILD = "26-78-agg-range-rx-v1"
NEW_BUILD = "26-79-agg-center-tape-scale-settings-v1"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str, flags=0) -> str:
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=flags)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 match, found {count}")
    return updated


# ---------------------------------------------------------------------------
# Tape: midpoint labels, stable same-timestamp slots and time-scale control.
# ---------------------------------------------------------------------------
orderbook = read("orderbook.js")
orderbook = replace_once(
    orderbook,
    '''const TAPE_MIN_FILTER_KEY = "inpuls-tape-min-filter-v3";
const DENSITY_AGE_VISIBLE_KEY = "inpuls-density-age-visible-v1";''',
    '''const TAPE_MIN_FILTER_KEY = "inpuls-tape-min-filter-v3";
const TAPE_TIME_SCALE_KEY = "inpuls-tape-time-scale-v1";
const TAPE_TIME_SCALE_MIN = 35;
const TAPE_TIME_SCALE_MAX = 300;
const TAPE_TIME_SCALE_DEFAULT = 100;
const DENSITY_AGE_VISIBLE_KEY = "inpuls-density-age-visible-v1";''',
    "tape time scale constants",
)

orderbook = regex_once(
    orderbook,
    r'''function buildContinuousTapeWindow\(width, latestTime, requestedEndTime = null\) \{[\s\S]*?\n\}\n\nfunction tapeTimeX''',
    '''export function tapeSecondsForScale(width, scalePercent = TAPE_TIME_SCALE_DEFAULT) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const baseSeconds = clampTape(
    Math.floor(safeWidth / TAPE_MIN_SECOND_WIDTH),
    TAPE_MIN_SECONDS,
    TAPE_MAX_SECONDS,
  );
  const scale = clampTape(
    Number(scalePercent) || TAPE_TIME_SCALE_DEFAULT,
    TAPE_TIME_SCALE_MIN,
    TAPE_TIME_SCALE_MAX,
  );
  return clampTape(baseSeconds * scale / 100, 4, 180);
}

function buildContinuousTapeWindow(
  width,
  latestTime,
  requestedEndTime = null,
  scalePercent = TAPE_TIME_SCALE_DEFAULT,
) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const duration = tapeSecondsForScale(safeWidth, scalePercent) * TAPE_SECOND_MS;
  const latest = Number(latestTime) || Date.now();
  const requested = Number(requestedEndTime);
  const endTime = Number.isFinite(requested)
    ? Math.max(latest + 1, requested)
    : latest + 1;
  return {
    duration,
    startTime: endTime - duration,
    endTime,
    plotRight: safeWidth,
  };
}

function tapeTimeX''',
    "scaled tape window",
    flags=re.MULTILINE,
)

orderbook = replace_once(
    orderbook,
    '''  const groups = [];
  let current = null;
  const finish = () => {
    if (!current) return;
    current.vwapPrice = current.quantity > 0''',
    '''  const groups = [];
  const ordinalByTime = new Map();
  let current = null;
  const finish = () => {
    if (!current) return;
    const timeOrdinal = ordinalByTime.get(current.eventTime) ?? 0;
    current.timeOrdinal = timeOrdinal;
    ordinalByTime.set(current.eventTime, timeOrdinal + 1);
    current.vwapPrice = current.quantity > 0''',
    "stable aggregate timestamp ordinal",
)

orderbook = replace_once(
    orderbook,
    '''function drawAggregatePriceRange(
  context,''',
    '''export function aggregateLabelPrice(item) {
  const minimum = Number(item?.minPrice);
  const maximum = Number(item?.maxPrice);
  if (Number.isFinite(minimum) && Number.isFinite(maximum)) return (minimum + maximum) / 2;
  const vwap = Number(item?.vwapPrice);
  if (Number.isFinite(vwap)) return vwap;
  return Number(item?.price);
}

export function aggregateStableX(baseX, ordinal, markerWidth, plotRight) {
  const right = Math.max(1, Number(plotRight) || 1);
  const width = Math.max(4, Number(markerWidth) || 4);
  const index = Math.max(0, Math.floor(Number(ordinal) || 0));
  const spacing = clampTape(width + 3, 12, 48);
  let offset = 0;
  if (index > 0) {
    if (baseX >= right * .68) offset = -index * spacing;
    else if (baseX <= right * .32) offset = index * spacing;
    else {
      const ring = Math.ceil(index / 2);
      offset = (index % 2 ? 1 : -1) * ring * spacing;
    }
  }
  return clampTape(
    Number(baseX) + offset,
    width / 2 + .5,
    Math.max(width / 2 + .5, right - width / 2 - .5),
  );
}

function aggregateLabelY(viewport, item, fallbackY) {
  const position = projectTapePrice(viewport, aggregateLabelPrice(item));
  return position ? position.y : fallbackY;
}

function drawAggregatePriceRange(
  context,''',
    "aggregate midpoint and x slots",
)

orderbook = replace_once(
    orderbook,
    '''    const savedMinimum = localStorage.getItem(TAPE_MIN_FILTER_KEY);
    state = {''',
    '''    const savedMinimum = localStorage.getItem(TAPE_MIN_FILTER_KEY);
    const savedTimeScale = localStorage.getItem(TAPE_TIME_SCALE_KEY);
    state = {''',
    "load tape time scale",
)
orderbook = replace_once(
    orderbook,
    '''      minQuote: savedMinimum === null ? 0 : Math.max(0, Number(savedMinimum) || 0),
      aggregationSource: "agg",''',
    '''      minQuote: savedMinimum === null ? 0 : Math.max(0, Number(savedMinimum) || 0),
      timeScale: clampTape(
        savedTimeScale === null ? TAPE_TIME_SCALE_DEFAULT : Number(savedTimeScale),
        TAPE_TIME_SCALE_MIN,
        TAPE_TIME_SCALE_MAX,
      ),
      aggregationSource: "agg",''',
    "state tape time scale",
)

orderbook = replace_once(
    orderbook,
    '''      <label class="inpuls-tape-filter" title="Показывать маркеры RAW/AGG не меньше указанного объёма. Линия строится по всем сделкам.">
        <span>ОТ $</span>
        <input data-inpuls-trade-min type="number" min="0" step="100" value="${state.minQuote}" aria-label="Минимальный объём отображаемой сделки или агрегата" />
      </label>
      <button data-inpuls-tape-mode class="inpuls-tape-mode" type="button"></button>`;''',
    '''      <label class="inpuls-tape-filter" title="Показывать маркеры RAW/AGG не меньше указанного объёма. Линия строится по всем сделкам.">
        <span>ОТ $</span>
        <input data-inpuls-trade-min type="number" min="0" step="100" value="${state.minQuote}" aria-label="Минимальный объём отображаемой сделки или агрегата" />
      </label>
      <label class="inpuls-tape-time-scale" title="Временной диапазон ленты. Меньше — крупнее текущий поток; больше — длиннее история.">
        <span>ВРЕМЯ</span>
        <input data-inpuls-tape-time-scale type="range" min="${TAPE_TIME_SCALE_MIN}" max="${TAPE_TIME_SCALE_MAX}" step="5" value="${state.timeScale}" aria-label="Временной масштаб ленты" />
        <output data-inpuls-tape-time-scale-value>${Math.round(state.timeScale)}%</output>
      </label>
      <button data-inpuls-tape-mode class="inpuls-tape-mode" type="button"></button>`;''',
    "tape time scale control",
)

orderbook = replace_once(
    orderbook,
    '''    const minInput = controls.querySelector("[data-inpuls-trade-min]");
    const modeButton = controls.querySelector("[data-inpuls-tape-mode]");
    const applyMinimum = () => {''',
    '''    const minInput = controls.querySelector("[data-inpuls-trade-min]");
    const timeScaleInput = controls.querySelector("[data-inpuls-tape-time-scale]");
    const timeScaleValue = controls.querySelector("[data-inpuls-tape-time-scale-value]");
    const modeButton = controls.querySelector("[data-inpuls-tape-mode]");
    const syncTimeScale = () => {
      state.timeScale = clampTape(
        Number(timeScaleInput.value) || TAPE_TIME_SCALE_DEFAULT,
        TAPE_TIME_SCALE_MIN,
        TAPE_TIME_SCALE_MAX,
      );
      timeScaleInput.value = String(state.timeScale);
      timeScaleValue.textContent = `${Math.round(state.timeScale)}%`;
      localStorage.setItem(TAPE_TIME_SCALE_KEY, String(state.timeScale));
      scheduleTapeDraw(true, card);
    };
    const applyMinimum = () => {''',
    "time scale listeners setup",
)
orderbook = replace_once(
    orderbook,
    '''    minInput.addEventListener("input", applyMinimum);
    minInput.addEventListener("change", applyMinimum);
    modeButton.addEventListener("click", () => {''',
    '''    minInput.addEventListener("input", applyMinimum);
    minInput.addEventListener("change", applyMinimum);
    timeScaleInput.addEventListener("input", syncTimeScale);
    timeScaleInput.addEventListener("change", syncTimeScale);
    modeButton.addEventListener("click", () => {''',
    "bind tape time scale",
)
orderbook = replace_once(
    orderbook,
    '''  } else {
    const minInput = state.controls.querySelector("[data-inpuls-trade-min]");
    if (minInput && document.activeElement !== minInput) minInput.value = String(state.minQuote);
    syncTapeModeButton(state.controls.querySelector("[data-inpuls-tape-mode]"), state);
  }

  const heading = card.querySelector(".orderbook-heading");''',
    '''  } else {
    const minInput = state.controls.querySelector("[data-inpuls-trade-min]");
    const timeScaleInput = state.controls.querySelector("[data-inpuls-tape-time-scale]");
    const timeScaleValue = state.controls.querySelector("[data-inpuls-tape-time-scale-value]");
    if (minInput && document.activeElement !== minInput) minInput.value = String(state.minQuote);
    if (timeScaleInput && document.activeElement !== timeScaleInput) timeScaleInput.value = String(state.timeScale);
    if (timeScaleValue) timeScaleValue.textContent = `${Math.round(state.timeScale)}%`;
    syncTapeModeButton(state.controls.querySelector("[data-inpuls-tape-mode]"), state);
  }

  if (flow.dataset.inpulsTapeShiftWheel !== "1") {
    flow.dataset.inpulsTapeShiftWheel = "1";
    flow.addEventListener("wheel", (event) => {
      if (!event.shiftKey || !Number.isFinite(Number(event.deltaY)) || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const activeState = tapeCardStates.get(card);
      if (!activeState) return;
      activeState.timeScale = clampTape(
        activeState.timeScale + (event.deltaY < 0 ? -10 : 10),
        TAPE_TIME_SCALE_MIN,
        TAPE_TIME_SCALE_MAX,
      );
      localStorage.setItem(TAPE_TIME_SCALE_KEY, String(activeState.timeScale));
      const input = activeState.controls?.querySelector("[data-inpuls-tape-time-scale]");
      const output = activeState.controls?.querySelector("[data-inpuls-tape-time-scale-value]");
      if (input) input.value = String(activeState.timeScale);
      if (output) output.textContent = `${Math.round(activeState.timeScale)}%`;
      scheduleTapeDraw(true, card);
    }, { passive: false });
  }

  const heading = card.querySelector(".orderbook-heading");''',
    "shift wheel tape time scale",
)

orderbook = replace_once(
    orderbook,
    '''  const window = buildContinuousTapeWindow(rect.width, latestTime, endTime);''',
    '''  const window = buildContinuousTapeWindow(rect.width, latestTime, endTime, state.timeScale);''',
    "use tape time scale",
)

orderbook = replace_once(
    orderbook,
    '''    const item = projected.source;
    const y = projected.position.y;
    const buy = item.buyQuote >= item.sellQuote;''',
    '''    const item = projected.source;
    const projectedY = projected.position.y;
    const y = state.mode === "agg"
      ? aggregateLabelY(state.priceViewport, item, projectedY)
      : projectedY;
    const buy = item.buyQuote >= item.sellQuote;''',
    "aggregate midpoint y",
)

# Replace only the AGG circle x block (the RAW block uses the same text but occurs first).
pattern = r'''    if \(!showLabel\) \{\n      const x = clampTape\(\n        baseX,\n        diameter / 2 \+ \.5,\n        Math\.max\(diameter / 2 \+ \.5, window\.plotRight - diameter / 2 - \.5\),\n      \);'''
replacement = '''    if (!showLabel) {
      const x = aggregateStableX(
        baseX,
        item.timeOrdinal,
        diameter,
        window.plotRight,
      );'''
orderbook = regex_once(orderbook, pattern, replacement, "stable aggregate circle x", flags=re.MULTILINE)

orderbook = replace_once(
    orderbook,
    '''    const x = clampTape(
      baseX,
      width / 2 + .5,
      Math.max(width / 2 + .5, window.plotRight - width / 2 - .5),
    );
    drawAggregatePriceRange(
      context,
      state.priceViewport,
      item,''',
    '''    const x = aggregateStableX(
      baseX,
      item.timeOrdinal,
      width,
      window.plotRight,
    );
    drawAggregatePriceRange(
      context,
      state.priceViewport,
      item,''',
    "stable aggregate label x",
)

orderbook = replace_once(
    orderbook,
    '''    .orderbook-card .inpuls-tape-mode {
      margin-left: auto;''',
    '''    .orderbook-card .inpuls-tape-time-scale {
      min-width: 116px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 4px;
      border: 1px solid var(--line-soft);
      border-radius: 4px;
      background: color-mix(in srgb, var(--panel-2) 90%, transparent);
      color: var(--muted);
      font: 800 7px/1 Inter, system-ui, sans-serif;
    }
    .orderbook-card .inpuls-tape-time-scale input {
      width: 54px;
      min-width: 42px;
      accent-color: var(--accent);
      cursor: ew-resize;
    }
    .orderbook-card .inpuls-tape-time-scale output {
      width: 29px;
      color: var(--text);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .orderbook-card .inpuls-tape-mode {
      margin-left: auto;''',
    "tape scale styles",
)

write("orderbook.js", orderbook)

# ---------------------------------------------------------------------------
# Footprint clusters: stronger visible fill while preserving side proportion.
# ---------------------------------------------------------------------------
flow = read("orderbook-flow-workspace.js")
flow = replace_once(
    flow,
    "        const alpha = .38 + clusterStrength * .5;",
    "        const alpha = .58 + clusterStrength * .4;",
    "brighter footprint fill",
)
flow = replace_once(
    flow,
    "        state.context.lineWidth = 1;",
    "        state.context.lineWidth = 1.15;",
    "brighter footprint border",
)
write("orderbook-flow-workspace.js", flow)

# ---------------------------------------------------------------------------
# Settings: interface-only panel, 80-200% font and documented shortcuts.
# ---------------------------------------------------------------------------
index = read("index.html")
settings_markup = '''    <dialog id="settings-dialog" class="settings-dialog">
      <form id="settings-form" method="dialog">
        <div class="dialog-heading"><div><span class="eyebrow">Твоя система</span><h2>Интерфейс и управление</h2></div><button id="settings-close" class="detail-close" type="button" aria-label="Закрыть">×</button></div>
        <p class="dialog-intro">Здесь только отображение и управление. Фильтры отбора монет и формулы сигналов убраны из этого окна.</p>
        <label class="font-scale-control"><span>Шрифт всего сайта</span><input id="font-scale" type="range" min="80" max="200" step="5" value="100" /><strong id="font-scale-value">100%</strong></label>
        <div class="hotkeys-grid" aria-label="Горячие клавиши InPuls">
          <section class="hotkeys-section">
            <h3>Стакан</h3>
            <dl>
              <div><dt><kbd>Ctrl</kbd> + колесо</dt><dd>Удерживать Ctrl и вращать колесо над стаканом — изменить шаг цены.</dd></div>
              <div><dt>Колесо</dt><dd>Прокрутить стакан вручную вверх или вниз без автоцентрирования.</dd></div>
            </dl>
          </section>
          <section class="hotkeys-section">
            <h3>Лента</h3>
            <dl>
              <div><dt><kbd>Shift</kbd> + колесо</dt><dd>Удерживать Shift над лентой: вверх — укрупнить текущий поток, вниз — показать более длинную историю.</dd></div>
              <div><dt>Ползунок «ВРЕМЯ»</dt><dd>Тот же масштаб без клавиатуры. Значение сохраняется между перезапусками.</dd></div>
            </dl>
          </section>
        </div>
        <div class="dialog-actions"><button id="settings-reset" class="button" type="button">Шрифт 100%</button><button class="button button-primary" type="submit">Готово</button></div>
      </form>
    </dialog>'''
index = regex_once(
    index,
    r'''    <dialog id="settings-dialog" class="settings-dialog">[\s\S]*?    </dialog>''',
    settings_markup,
    "settings dialog",
    flags=re.MULTILINE,
)
write("index.html", index)

app = read("app.js")
app = replace_once(
    app,
    "  const value = Math.max(80, Math.min(130, Number(rawValue) || 100));",
    "  const value = Math.max(80, Math.min(200, Number(rawValue) || 100));",
    "font scale max 200",
)
app = replace_once(
    app,
    '''    const formData = new FormData(els.settingsForm);
    const next = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(next)) next[key] = Number(formData.get(key));
    state.settings = next;''',
    '''    const formData = new FormData(els.settingsForm);
    const next = { ...state.settings };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const rawValue = formData.get(key);
      if (rawValue !== null && rawValue !== "") next[key] = Number(rawValue);
    }
    state.settings = next;''',
    "preserve hidden scanner settings",
)
app = regex_once(
    app,
    r'''  els\.settingsReset\.addEventListener\("click", \(\) => \{[\s\S]*?\n  \}\);''',
    '''  els.settingsReset?.addEventListener("click", () => {
    applyFontScale(100);
    localStorage.setItem(STORAGE_KEYS.fontScale, "100");
    requestAnimationFrame(() => {
      priceChart.render();
      for (const panel of extraCharts.values()) panel.chart.render();
    });
  });''',
    "settings reset font only",
    flags=re.MULTILINE,
)
write("app.js", app)

styles = read("styles.css")
styles += '''

/* Settings: interface and verified hotkeys only. */
.settings-dialog form { max-height: 90vh; overflow-y: auto; }
.font-scale-control { display: grid; grid-template-columns: minmax(130px, auto) minmax(180px, 1fr) 52px; align-items: center; gap: 12px; padding: 13px 14px; border: 1px solid var(--line-soft); border-radius: 10px; background: color-mix(in srgb, var(--panel-2) 82%, transparent); }
.font-scale-control > span { color: var(--muted); font-size: calc(10 * var(--font-scale)); }
.font-scale-control input { width: 100%; accent-color: var(--accent); }
.font-scale-control strong { text-align: right; font-size: calc(11 * var(--font-scale)); font-variant-numeric: tabular-nums; }
.hotkeys-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
.hotkeys-section { padding: 14px; border: 1px solid var(--line-soft); border-radius: 10px; background: color-mix(in srgb, var(--panel-2) 74%, transparent); }
.hotkeys-section h3 { margin: 0 0 9px; color: var(--accent); font-size: calc(11 * var(--font-scale)); }
.hotkeys-section dl { display: grid; gap: 9px; margin: 0; }
.hotkeys-section dl > div { display: grid; gap: 4px; padding-top: 9px; border-top: 1px solid var(--line-soft); }
.hotkeys-section dl > div:first-child { padding-top: 0; border-top: 0; }
.hotkeys-section dt { font-size: calc(10 * var(--font-scale)); font-weight: 800; }
.hotkeys-section dd { margin: 0; color: var(--muted); font-size: calc(9 * var(--font-scale)); line-height: 1.45; }
.hotkeys-section kbd { display: inline-grid; min-width: 30px; min-height: 21px; place-items: center; padding: 0 6px; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; background: var(--panel); color: var(--text); font: 800 calc(8 * var(--font-scale))/1 system-ui, sans-serif; }
@media (max-width: 620px) {
  .hotkeys-grid { grid-template-columns: 1fr; }
  .font-scale-control { grid-template-columns: 1fr 52px; }
  .font-scale-control > span { grid-column: 1 / -1; }
}
'''
write("styles.css", styles)

# ---------------------------------------------------------------------------
# Regression coverage for the agreed contracts.
# ---------------------------------------------------------------------------
test = '''import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  aggregateLabelPrice,
  aggregateStableX,
  aggregateTapeZeroMs,
  tapeSecondsForScale,
} from "./orderbook.js";

const buy = (id, time, price, quote) => ({ id, time, price, quote, quantity: quote / price, side: "buy" });
const sell = (id, time, price, quote) => ({ id, time, price, quote, quantity: quote / price, side: "sell" });

test("AGG label uses the price-range midpoint", () => {
  assert.equal(aggregateLabelPrice({ minPrice: 100, maxPrice: 108, firstPrice: 100 }), 104);
});

test("same-millisecond AGG groups receive stable non-overlapping ordinals", () => {
  const groups = aggregateTapeZeroMs([
    buy(1, 1000, 100, 1000),
    sell(2, 1000, 101, 1200),
    buy(3, 1000, 102, 1400),
  ]);
  assert.deepEqual(groups.map((item) => item.timeOrdinal), [0, 1, 2]);
  const xs = groups.map((item) => aggregateStableX(900, item.timeOrdinal, 30, 1000));
  assert.equal(new Set(xs).size, 3);
  assert.ok(xs[1] < xs[0] && xs[2] < xs[1]);
});

test("tape time scale supports close flow and long history", () => {
  const close = tapeSecondsForScale(660, 35);
  const normal = tapeSecondsForScale(660, 100);
  const history = tapeSecondsForScale(660, 300);
  assert.ok(close < normal);
  assert.ok(history > normal);
});

test("settings expose 80-200 font scale and verified shortcut sections only", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(html, /id="font-scale" type="range" min="80" max="200"/);
  assert.match(html, /<h3>Стакан<\/h3>/);
  assert.match(html, /<h3>Лента<\/h3>/);
  assert.match(html, /Shift<\/kbd> \+ колесо/);
  assert.doesNotMatch(html, /class="settings-grid"/);
  assert.match(app, /Math\.min\(200, Number\(rawValue\)/);
});

test("clusters use the brighter dominance fill", () => {
  const flow = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
  assert.match(flow, /const alpha = \.58 \+ clusterStrength \* \.4/);
});
'''
write("test-orderbook-ux-controls-v1.mjs", test)

# Core cache/build identifiers are kept synchronized across runtime and tests.
for path in Path(".").rglob("*"):
    if not path.is_file() or ".git" in path.parts:
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".css", ".txt", ".json", ".webmanifest"}:
        continue
    content = path.read_text(encoding="utf-8")
    if OLD_BUILD in content:
        path.write_text(content.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

# Postconditions: fail before committing if any critical contract is absent.
final_orderbook = read("orderbook.js")
final_index = read("index.html")
final_app = read("app.js")
final_flow = read("orderbook-flow-workspace.js")
assert "aggregateLabelY(state.priceViewport, item, projectedY)" in final_orderbook
assert "aggregateStableX(" in final_orderbook
assert 'data-inpuls-tape-time-scale' in final_orderbook
assert 'event.shiftKey' in final_orderbook
assert 'max="200"' in final_index
assert 'class="settings-grid"' not in final_index
assert "Math.min(200" in final_app
assert "const alpha = .58 + clusterStrength * .4;" in final_flow
assert NEW_BUILD in read("VERSION.txt")
