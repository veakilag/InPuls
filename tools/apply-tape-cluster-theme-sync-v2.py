from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_BUILD = "26-103-footprint-poc-second-theme-preview-v1"
NEW_BUILD = "26-104-tape-cluster-theme-clock-sync-v2"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f"Missing patch anchor: {label}")
    return text.replace(old, new, 1)


# Tape: keep exact exchange timestamp inside the continuously moving Binance-clock window.
path = "orderbook.js"
text = read(path)
text = replace_once(text, '''export function tapeSecondSlotTime(time, window = null) {
  const value = Number(time);
  if (!Number.isFinite(value)) return null;
  const center = Math.floor(value / TAPE_SECOND_MS) * TAPE_SECOND_MS + TAPE_SECOND_MS / 2;
  if (!window) return center;
  const start = Number(window.startTime);
  const end = Number(window.endTime);
  if (![start, end].every(Number.isFinite) || end <= start) return center;
  return clampTape(center, start + 1, end - 1);
}
''', '''export function tapeSecondSlotTime(time, window = null) {
  const value = Number(time);
  if (!Number.isFinite(value)) return null;
  // Preserve exact exchange time. BinanceClock owns the live edge; executions
  // must retain their natural spacing instead of collapsing to second centers.
  if (!window) return value;
  const start = Number(window.startTime);
  const end = Number(window.endTime);
  if (![start, end].every(Number.isFinite) || end <= start) return value;
  return clampTape(value, start + 1, end - 1);
}
''', "exact Tape event time")
write(path, text)

# Footprint: shared exchange clock, immutable past projection, readable volume labels.
path = "orderbook-flow-workspace.js"
text = read(path)
text = replace_once(
    text,
    'import { observability } from "./observability.js?v=render-scheduler-v1";\n',
    'import { binanceClock } from "./binance-clock.js?v=26-102-tape-live-edge-minute-boundary-v1";\nimport { observability } from "./observability.js?v=render-scheduler-v1";\n',
    "footprint Binance clock import",
)
anchor = '''function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
'''
text = replace_once(text, anchor, anchor + '''
function footprintExchangeNow() {
  const perfNow = typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : undefined;
  const exchangeNow = binanceClock.now(perfNow);
  return Number.isFinite(Number(exchangeNow)) ? Number(exchangeNow) : Date.now();
}
''', "footprint exchange clock helper")
text = replace_once(text, '''function nearestRow(rows, price) {
  if (!rows.length) return null;
  let best = rows[0];
  let distance = Math.abs(price - best.price);
  for (let index = 1; index < rows.length; index += 1) {
    const nextDistance = Math.abs(price - rows[index].price);
    if (nextDistance < distance) {
      best = rows[index];
      distance = nextDistance;
    }
  }
  return best;
}
''', '''function nearestRow(rows, price) {
  const target = Number(price);
  if (!rows.length || !Number.isFinite(target)) return null;
  const orderedPrices = [...new Set(rows.map((row) => Number(row.price)).filter(Number.isFinite))]
    .sort((left, right) => left - right);
  if (!orderedPrices.length) return null;
  let step = Infinity;
  for (let index = 1; index < orderedPrices.length; index += 1) {
    const gap = orderedPrices[index] - orderedPrices[index - 1];
    if (gap > Number.EPSILON && gap < step) step = gap;
  }
  const tolerance = Number.isFinite(step)
    ? step * .55
    : Math.max(Number.EPSILON, Math.abs(orderedPrices.at(-1) - orderedPrices[0]) * .01);
  if (target < orderedPrices[0] - tolerance || target > orderedPrices.at(-1) + tolerance) {
    return null;
  }
  let best = rows[0];
  let distance = Math.abs(target - Number(best.price));
  for (let index = 1; index < rows.length; index += 1) {
    const nextDistance = Math.abs(target - Number(rows[index].price));
    if (nextDistance < distance) {
      best = rows[index];
      distance = nextDistance;
    }
  }
  return distance <= tolerance ? best : null;
}
''', "strict footprint row projection")
text = replace_once(text, '''    const maximumOffset = footprintHistoryOffsetLimit(
      accumulator,
      state.timeframeMs,
      Date.now(),
    );''', '''    const maximumOffset = footprintHistoryOffsetLimit(
      accumulator,
      state.timeframeMs,
      footprintExchangeNow(),
    );''', "footprint pan clock")
text = replace_once(text, '''  const accumulator = footprintBySymbol.get(symbol) ?? createFootprintAccumulator();
  state.historyOffset = Math.min(
    state.historyOffset,
    footprintHistoryOffsetLimit(accumulator, state.timeframeMs, Date.now()),
  );''', '''  const accumulator = footprintBySymbol.get(symbol) ?? createFootprintAccumulator();
  const exchangeNow = footprintExchangeNow();
  state.historyOffset = Math.min(
    state.historyOffset,
    footprintHistoryOffsetLimit(accumulator, state.timeframeMs, exchangeNow),
  );''', "footprint render clock")
text = replace_once(text, '''    accumulator,
    state.timeframeMs,
    Date.now(),
    visibleColumnLimit,''', '''    accumulator,
    state.timeframeMs,
    exchangeNow,
    visibleColumnLimit,''', "footprint history clock")
text = replace_once(
    text,
    'state.context.font = "850 6.7px Inter, system-ui, sans-serif";',
    'state.context.font = "850 8px Inter, system-ui, sans-serif";',
    "footprint volume font",
)
write(path, text)

# Slider preview: update the complete palette and every chart on each preview frame.
path = "app.js"
text = read(path)
text = replace_once(text, '''function applyComfortPreview(rawValue) {
  const theme = buildComfortTheme(rawValue);
  const { value, palette } = theme;
  const root = document.documentElement;
  root.style.setProperty("--bg", palette.bg);
  root.style.setProperty("--panel", palette.panel);
  root.style.setProperty("--panel-2", palette.panel2);
  root.style.setProperty("--line", palette.line);
  root.style.setProperty("--line-soft", `${palette.line}55`);
  root.dataset.comfortPreview = String(Math.round(value));
  return theme;
}
''', '''function applyComfortPreview(rawValue) {
  const theme = buildComfortTheme(rawValue);
  const { value, amount, turquoise, cyan, blue, violet, red, palette } = theme;
  const root = document.documentElement;
  root.style.setProperty("--bg", palette.bg);
  root.style.setProperty("--panel", palette.panel);
  root.style.setProperty("--panel-2", palette.panel2);
  root.style.setProperty("--line", palette.line);
  root.style.setProperty("--line-soft", `${palette.line}55`);
  root.style.setProperty("--text", palette.text);
  root.style.setProperty("--muted", palette.muted);
  root.style.setProperty("--chart-bg", palette.chart);
  root.style.setProperty("--accent", cyan);
  root.style.setProperty("--cyan", cyan);
  root.style.setProperty("--violet", violet);
  root.style.setProperty("--green", turquoise);
  root.style.setProperty("--blue", blue);
  root.style.setProperty("--red", red);
  root.style.setProperty("--chart-bull-fill", palette.bull);
  root.style.setProperty("--chart-bull-stroke", palette.bull);
  root.style.setProperty("--chart-bear-fill", palette.bear);
  root.style.setProperty("--chart-bear-stroke", palette.bearStroke);
  root.style.setProperty("--theme-level", String(amount));
  root.style.setProperty("--comfort-position", `${value}%`);
  const moonProgress = Math.max(0, Math.min(1, (amount - .2) / .7));
  root.style.setProperty("--comfort-sun-opacity", String(1 - moonProgress));
  root.style.setProperty("--comfort-moon-opacity", String(moonProgress));
  root.style.setProperty("--comfort-sun-rotate", `${moonProgress * 38}deg`);
  root.style.setProperty("--comfort-moon-rotate", `${(1 - moonProgress) * -24}deg`);
  root.dataset.comfortPreview = String(Math.round(value));
  const previewChartTheme = {
    background: palette.chart,
    bullFill: palette.bull,
    bullStroke: palette.bull,
    bearFill: palette.bear,
    bearStroke: palette.bearStroke,
    grid: palette.grid,
    text: palette.muted,
    crosshair: palette.crosshair,
    crosshairFill: palette.crosshairFill,
    crosshairText: palette.crosshairText,
    session: violet,
  };
  priceChart.setTheme(previewChartTheme);
  for (const panel of extraCharts.values()) panel.chart.setTheme(previewChartTheme);
  globalThis.dispatchEvent(new CustomEvent("inpuls:theme-change", {
    detail: { preview: true, value },
  }));
  return theme;
}
''', "full comfort preview")
write(path, text)

# Clarified regression behavior.
path = "test-footprint-poc-second-preview-v1.mjs"
text = read(path)
text = replace_once(text, '''test("Tape places executions into the matching exchange-second slot", () => {
  const tradeTime = 1_700_000_031_123;
  assert.equal(tapeSecondSlotTime(tradeTime), 1_700_000_031_500);

  const window = {
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_031_200,
    duration: 31_200,
    plotRight: 1_000,
  };
  assert.equal(tapeSecondSlotTime(tradeTime, window), window.endTime - 1);
});''', '''test("Tape preserves exact execution time while the shared clock owns the live edge", () => {
  const tradeTime = 1_700_000_031_123;
  assert.equal(tapeSecondSlotTime(tradeTime), tradeTime);

  const window = {
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_031_200,
    duration: 31_200,
    plotRight: 1_000,
  };
  assert.equal(tapeSecondSlotTime(tradeTime, window), tradeTime);
  assert.equal(tapeSecondSlotTime(window.endTime + 400, window), window.endTime - 1);
});''', "Tape regression")
text = text.replace(
    'test("comfort preview listens before the drag guard and includes Footprint Canvas", () => {',
    'test("comfort preview covers the full palette and all live Canvas surfaces", () => {',
    1,
)
text = replace_once(text, '''  assert.match(preview, /\.inpuls-footprint-canvas/);
});''', '''  assert.match(preview, /\.inpuls-footprint-canvas/);
  const app = read("./app.js");
  const start = app.indexOf("function applyComfortPreview(rawValue) {");
  const end = app.indexOf("\\n\\nfunction applyComfort(rawValue)", start);
  const block = app.slice(start, end);
  assert.match(block, /--text/);
  assert.match(block, /--muted/);
  assert.match(block, /--chart-bg/);
  assert.match(block, /priceChart\\.setTheme\\(previewChartTheme\\)/);
  assert.match(block, /inpuls:theme-change/);
});''', "full preview regression")
write(path, text)

path = "test-comfort-slider-smooth-v1.mjs"
text = read(path)
text = text.replace(
    'test("drag preview updates only surface colors and never Canvas theme", () => {',
    'test("drag preview updates the complete site palette and Canvas theme", () => {',
    1,
)
text = replace_once(text, '''  assert.match(preview, /--bg/);
  assert.match(preview, /--panel/);
  assert.match(preview, /--panel-2/);
  assert.match(preview, /--line/);
  assert.doesNotMatch(preview, /--text|--muted|--chart-bg|--chart-bear-fill/);
  assert.doesNotMatch(preview, /setTheme|inpuls:theme-change|localStorage/);''', '''  assert.match(preview, /--bg/);
  assert.match(preview, /--panel/);
  assert.match(preview, /--panel-2/);
  assert.match(preview, /--line/);
  assert.match(preview, /--text/);
  assert.match(preview, /--muted/);
  assert.match(preview, /--chart-bg/);
  assert.match(preview, /--chart-bear-fill/);
  assert.match(preview, /priceChart\\.setTheme\\(previewChartTheme\\)/);
  assert.match(preview, /inpuls:theme-change/);
  assert.doesNotMatch(preview, /localStorage/);''', "comfort preview assertions")
write(path, text)

# Bump every runtime reference and matching release assertion together.
for candidate in ROOT.rglob("*"):
    if not candidate.is_file() or candidate.suffix.lower() not in {".js", ".mjs", ".html", ".md"}:
        continue
    source = candidate.read_text(encoding="utf-8")
    if OLD_BUILD in source:
        candidate.write_text(source.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

print("Applied Tape/Footprint/theme/clock sync v2")
