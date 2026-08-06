from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_BUILD = "26-118-signal-lab-30d-history-v1"
CHART_BUILD = "26-117-chart-interaction-performance-v1"
NEW_BUILD = "26-119-signal-lab-navigable-30d-v2"


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence of {old!r}, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Full-chart data loader: keep the network window fixed at 30 days and separate it
# from the visible zoom preset. The same loaded series is then navigable on every TF.
full = ROOT / "signal-lab-v3-full-chart.js"
text = full.read_text(encoding="utf-8")
text = text.replace(
    f'import {{ CandlestickChart }} from "./chart.js?v={CHART_BUILD}";',
    f'import {{ CandlestickChart }} from "./chart.js?v={NEW_BUILD}";',
    1,
)

anchor = '''export function episodeHistoryBounds(eventAt, intervalMs, contextMs) {
'''
helper = '''export function episodeViewCandleCount(interval, viewRange, totalCandles) {
  const intervalMs = EPISODE_CHART_INTERVALS[interval];
  const contextMs = EPISODE_CONTEXT_RANGES[viewRange];
  const total = Math.max(0, Math.floor(Number(totalCandles) || 0));
  if (!intervalMs || !contextMs || !total) return 0;
  if (viewRange === "30d") return Math.min(total, 1_500);
  const symmetricSpan = contextMs * 2;
  return clamp(Math.ceil(symmetricSpan / intervalMs) + 3, Math.min(20, total), total);
}

export function episodeHistoryBounds(eventAt, intervalMs, contextMs) {
'''
if text.count(anchor) != 1:
    raise RuntimeError("signal-lab-v3-full-chart.js: episodeHistoryBounds anchor not found")
text = text.replace(anchor, helper, 1)

old_range_bind = '''    this.rangeButtons.forEach((button) => button.addEventListener("click", () => {
      this.contextRange = button.dataset.chartRange;
      this.rangeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      this.#load();
    }));'''
new_range_bind = '''    this.rangeButtons.forEach((button) => button.addEventListener("click", () => {
      this.contextRange = button.dataset.chartRange;
      this.rangeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      this.#applyViewPreset();
    }));'''
if text.count(old_range_bind) != 1:
    raise RuntimeError("signal-lab-v3-full-chart.js: embedded range handler not found")
text = text.replace(old_range_bind, new_range_bind, 1)

text = text.replace(
    'this.status.textContent = `Загружаю ${this.episode.symbol} · ${this.interval} · окно ${this.contextRange}…`;',
    'this.status.textContent = `Загружаю ${this.episode.symbol} · ${this.interval} · все 30 дней до события…`;',
    1,
)
text = text.replace(
    'const loaded = await loadEpisodeCandles(this.episode, this.interval, this.contextRange, {',
    'const loaded = await loadEpisodeCandles(this.episode, this.interval, "30d", {',
    1,
)
text = text.replace(
    'range: `episode-${this.contextRange}`,',
    'range: "episode-loaded-30d",',
    1,
)
old_focus = '''      if (this.contextRange === "30d" && candles.length <= 2_000) this.#fitRange(candles);
      else this.#focusEvent(candles);'''
new_focus = '''      this.#applyViewPreset(candles);'''
if text.count(old_focus) != 1:
    raise RuntimeError("signal-lab-v3-full-chart.js: embedded post-load focus block not found")
text = text.replace(old_focus, new_focus, 1)
text = text.replace(
    'this.status.textContent = `${coverage?.source ?? "UNKNOWN"} · ${candles.length} свечей · покрытие ${actualDays.toFixed(1)}/${requestedDays.toFixed(1)}д (${percent}%) · ${coverage?.complete ? "COMPLETE" : "PARTIAL"} · страниц ${coverage?.pages ?? 0}`;',
    'this.status.textContent = `${coverage?.source ?? "UNKNOWN"} · загружено ${candles.length} свечей за ${actualDays.toFixed(1)}/${requestedDays.toFixed(1)}д (${percent}%) · ${coverage?.complete ? "COMPLETE" : "PARTIAL"} · можно перемещаться по всему диапазону · страниц ${coverage?.pages ?? 0}`;',
    1,
)
old_fit = '''  #fitRange(candles = this.chart?.candles ?? []) {
    if (!this.chart || !candles.length) return;
    const maximumVisible = this.interval === "1m" ? Math.min(candles.length, 2_000) : candles.length;
    this.chart.visibleCount = Math.max(20, maximumVisible);'''
new_fit = '''  #applyViewPreset(candles = this.chart?.candles ?? []) {
    if (!this.chart || !candles.length) return;
    if (this.contextRange === "30d") this.#fitRange(candles);
    else this.#focusEvent(candles, this.contextRange);
  }

  #fitRange(candles = this.chart?.candles ?? []) {
    if (!this.chart || !candles.length) return;
    const maximumVisible = episodeViewCandleCount(this.interval, "30d", candles.length);
    this.chart.visibleCount = Math.max(20, maximumVisible);'''
if text.count(old_fit) != 1:
    raise RuntimeError("signal-lab-v3-full-chart.js: embedded fitRange block not found")
text = text.replace(old_fit, new_fit, 1)
text = text.replace(
    '  #focusEvent(candles = this.chart?.candles ?? []) {',
    '  #focusEvent(candles = this.chart?.candles ?? [], viewRange = this.contextRange) {',
    1,
)
old_preferred = '''    const preferred = this.interval.endsWith("s") ? 100 : this.interval === "1m" ? 80 : 60;
    this.chart.visibleCount = clamp(Math.min(candles.length, preferred), Math.min(20, candles.length), Math.max(20, candles.length));'''
new_preferred = '''    const preferred = episodeViewCandleCount(this.interval, viewRange, candles.length);
    this.chart.visibleCount = clamp(preferred, Math.min(20, candles.length), Math.max(20, candles.length));'''
if text.count(old_preferred) != 1:
    raise RuntimeError("signal-lab-v3-full-chart.js: embedded preferred count block not found")
text = text.replace(old_preferred, new_preferred, 1)
full.write_text(text, encoding="utf-8")

# Modal: range buttons become viewport presets. Only timeframe changes reload data.
modal = ROOT / "signal-lab-chart-modal.js"
text = modal.read_text(encoding="utf-8")
text = text.replace(f'./chart.js?v={CHART_BUILD}', f'./chart.js?v={NEW_BUILD}', 1)
text = text.replace(f'./signal-lab-v3-full-chart.js?v={CHART_BUILD}', f'./signal-lab-v3-full-chart.js?v={NEW_BUILD}', 1)
text = text.replace(
    '  loadEpisodeCandles,\n  patternAnnotationSummary,',
    '  loadEpisodeCandles,\n  episodeViewCandleCount,\n  patternAnnotationSummary,',
    1,
)
text = text.replace(
    '["15m", "±15м"], ["1h", "±1ч"], ["4h", "±4ч"], ["24h", "±24ч"],\n  ["7d", "±7д"], ["30d", "30д до события"],',
    '["15m", "15м"], ["1h", "1ч"], ["4h", "4ч"], ["24h", "24ч"],\n  ["7d", "7д"], ["30d", "30д"],',
    1,
)
text = text.replace('aria-label="Контекст"', 'aria-label="Масштаб вокруг события"', 1)
old_range_handler = '''    this.rangeButtons.forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.modalRange === this.contextRange) return;
      this.contextRange = button.dataset.modalRange;
      this.#syncActiveButtons();
      this.#scheduleLoad();
    }));'''
new_range_handler = '''    this.rangeButtons.forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.modalRange === this.contextRange) return;
      this.contextRange = button.dataset.modalRange;
      this.#syncActiveButtons();
      this.#applyViewPreset();
    }));'''
if text.count(old_range_handler) != 1:
    raise RuntimeError("signal-lab-chart-modal.js: range handler not found")
text = text.replace(old_range_handler, new_range_handler, 1)
text = text.replace(
    'this.status.textContent = `Загружаю ${this.episode.symbol} · ${this.interval} · ${this.contextRange}…`;',
    'this.status.textContent = `Загружаю ${this.episode.symbol} · ${this.interval} · все 30 дней до события…`;',
    1,
)
text = text.replace(
    'const loaded = await loadEpisodeCandles(this.episode, this.interval, this.contextRange, {',
    'const loaded = await loadEpisodeCandles(this.episode, this.interval, "30d", {',
    1,
)
text = text.replace(
    'range: `signal-lab-modal-${this.contextRange}`,',
    'range: "signal-lab-modal-loaded-30d",',
    1,
)
old_modal_focus = '''      if (this.contextRange === "30d" && candles.length <= 2_000) this.#fitRange(candles);
      else this.#focusEvent(candles);'''
if text.count(old_modal_focus) != 1:
    raise RuntimeError("signal-lab-chart-modal.js: post-load focus block not found")
text = text.replace(old_modal_focus, '      this.#applyViewPreset(candles);', 1)
text = text.replace(
    'this.status.textContent = `${this.episode.symbol} · ${this.interval} · ${candles.length} свечей · ${coverage?.source ?? "UNKNOWN"} · покрытие ${percent}% · ${coverage?.complete ? "COMPLETE" : "PARTIAL"}`;',
    'this.status.textContent = `${this.episode.symbol} · ${this.interval} · загружено ${candles.length} свечей за 30 дней · ${coverage?.source ?? "UNKNOWN"} · покрытие ${percent}% · ${coverage?.complete ? "COMPLETE" : "PARTIAL"} · весь диапазон доступен для перемещения`;',
    1,
)
old_modal_fit = '''  #fitRange(candles = this.chart?.candles ?? []) {
    if (!this.chart || !candles.length) return;
    const maximumVisible = this.interval === "1m" ? Math.min(candles.length, 2_000) : candles.length;
    this.chart.visibleCount = Math.max(20, maximumVisible);'''
new_modal_fit = '''  #applyViewPreset(candles = this.chart?.candles ?? []) {
    if (!this.chart || !candles.length) return;
    if (this.contextRange === "30d") this.#fitRange(candles);
    else this.#focusEvent(candles, this.contextRange);
  }

  #fitRange(candles = this.chart?.candles ?? []) {
    if (!this.chart || !candles.length) return;
    const maximumVisible = episodeViewCandleCount(this.interval, "30d", candles.length);
    this.chart.visibleCount = Math.max(20, maximumVisible);'''
if text.count(old_modal_fit) != 1:
    raise RuntimeError("signal-lab-chart-modal.js: fitRange block not found")
text = text.replace(old_modal_fit, new_modal_fit, 1)
text = text.replace(
    '  #focusEvent(candles = this.chart?.candles ?? []) {',
    '  #focusEvent(candles = this.chart?.candles ?? [], viewRange = this.contextRange) {',
    1,
)
old_modal_preferred = '''    const preferred = this.interval.endsWith("s") ? 120 : this.interval === "1m" ? 100 : 70;
    this.chart.visibleCount = clamp(Math.min(candles.length, preferred), Math.min(20, candles.length), Math.max(20, candles.length));'''
new_modal_preferred = '''    const preferred = episodeViewCandleCount(this.interval, viewRange, candles.length);
    this.chart.visibleCount = clamp(preferred, Math.min(20, candles.length), Math.max(20, candles.length));'''
if text.count(old_modal_preferred) != 1:
    raise RuntimeError("signal-lab-chart-modal.js: preferred count block not found")
text = text.replace(old_modal_preferred, new_modal_preferred, 1)
modal.write_text(text, encoding="utf-8")

replace_once(
    "owner-signal-lab-v3.js",
    f'./signal-lab-chart-modal.js?v={OLD_BUILD}',
    f'./signal-lab-chart-modal.js?v={NEW_BUILD}',
)
replace_once(
    "owner-signal-lab-v3.html",
    f'./owner-signal-lab-v3.js?v={OLD_BUILD}',
    f'./owner-signal-lab-v3.js?v={NEW_BUILD}',
)

# Keep smoke imports aligned with the browser module graph.
smoke = ROOT / "scripts/signal-lab-runtime-smoke.mjs"
smoke_text = smoke.read_text(encoding="utf-8")
smoke_text = smoke_text.replace(CHART_BUILD, NEW_BUILD)
smoke.write_text(smoke_text, encoding="utf-8")

modal_test = ROOT / "test/signal-lab-modal-chart.test.js"
test_text = modal_test.read_text(encoding="utf-8")
test_text = test_text.replace(OLD_BUILD, NEW_BUILD)
test_text = test_text.replace(
    '  assert.match(modal, /Every episode opens with the full pre-event market context/);',
    '  assert.match(modal, /Every episode opens with the full pre-event market context/);\n'
    '  assert.match(modal, /loadEpisodeCandles\\(this\\.episode, this\\.interval, "30d"/);\n'
    '  assert.match(modal, /this\\.#applyViewPreset\\(\\);/);\n'
    '  assert.doesNotMatch(modal, /button\\.dataset\\.modalRange[\\s\\S]{0,260}#scheduleLoad\\(\\)/);',
    1,
)
modal_test.write_text(test_text, encoding="utf-8")

navigation_test = ROOT / "test/signal-lab-30d-navigation.test.js"
navigation_test.write_text('''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  EPISODE_CONTEXT_RANGES,
  EPISODE_CHART_INTERVALS,
  episodeHistoryBounds,
  episodeViewCandleCount,
} from "../signal-lab-v3-full-chart.js";

const modal = fs.readFileSync(new URL("../signal-lab-chart-modal.js", import.meta.url), "utf8");
const full = fs.readFileSync(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");

const EVENT_AT = Date.UTC(2026, 7, 6, 12, 0, 0);

test("30-day data bounds are independent from the visible zoom preset", () => {
  const bounds = episodeHistoryBounds(EVENT_AT, EPISODE_CHART_INTERVALS["1m"], EPISODE_CONTEXT_RANGES["30d"]);
  assert.equal(bounds.coverageEndTime, EVENT_AT);
  assert.equal(bounds.startTime, EVENT_AT - 30 * 86_400_000);
  assert.equal(bounds.mode, "THIRTY_DAYS_BEFORE_EVENT");
});

test("every candle timeframe requests the same 30-day history in both chart entry points", () => {
  assert.match(modal, /loadEpisodeCandles\\(this\\.episode, this\\.interval, "30d"/);
  assert.match(full, /loadEpisodeCandles\\(this\\.episode, this\\.interval, "30d"/);
  assert.match(modal, /range: "signal-lab-modal-loaded-30d"/);
  assert.match(full, /range: "episode-loaded-30d"/);
});

test("zoom presets change only the viewport and do not reload or discard history", () => {
  assert.match(modal, /this\\.#applyViewPreset\\(\\);/);
  assert.match(full, /this\\.#applyViewPreset\\(\\);/);
  assert.doesNotMatch(modal, /button\\.dataset\\.modalRange[\\s\\S]{0,260}#scheduleLoad\\(\\)/);
  assert.doesNotMatch(full, /button\\.dataset\\.chartRange[\\s\\S]{0,260}#load\\(\\)/);
});

test("view candle counts are calculated from the chosen timeframe while keeping all loaded candles", () => {
  assert.equal(episodeViewCandleCount("1m", "1h", 43_200), 123);
  assert.equal(episodeViewCandleCount("5m", "24h", 8_640), 579);
  assert.equal(episodeViewCandleCount("1h", "30d", 720), 720);
  assert.equal(episodeViewCandleCount("1m", "30d", 43_200), 1_500);
});
''', encoding="utf-8")

print("Applied true 30-day navigable history patch")
