from pathlib import Path
import re


def replace_once(path, old, new, label):
    source = Path(path).read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, got {count}")
    Path(path).write_text(source.replace(old, new, 1))


def regex_once(path, pattern, replacement, label, flags=0):
    source = Path(path).read_text()
    next_source, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, got {count}")
    Path(path).write_text(next_source)


# chart.js: keep the production chart engine as the single source of interaction behavior,
# while adding a passive annotation layer used only when a consumer supplies annotations.
replace_once(
    "chart.js",
    "    this.drawings = [];\n    this.storageKey = storageKey;",
    "    this.drawings = [];\n    this.annotations = [];\n    this.storageKey = storageKey;",
    "chart annotation state",
)

replace_once(
    "chart.js",
    "  setTheme(theme) {\n    this.theme = { ...this.theme, ...theme };\n    this.#requestRender();\n  }",
    "  setAnnotations(annotations = []) {\n    this.annotations = (Array.isArray(annotations) ? annotations : [])\n      .filter((item) => item && typeof item === \"object\")\n      .map((item) => typeof structuredClone === \"function\" ? structuredClone(item) : JSON.parse(JSON.stringify(item)));\n    this.#requestRender();\n  }\n\n  setTheme(theme) {\n    this.theme = { ...this.theme, ...theme };\n    this.#requestRender();\n  }",
    "chart setAnnotations",
)

replace_once(
    "chart.js",
    "    this.#drawDrawings(ctx);\n    if (this.hoverX !== null && this.hoverY !== null) this.#drawCrosshair(ctx);",
    "    this.#drawAnnotations(ctx);\n    this.#drawDrawings(ctx);\n    if (this.hoverX !== null && this.hoverY !== null) this.#drawCrosshair(ctx);",
    "chart annotation render order",
)

annotation_method = r'''
  #drawAnnotations(ctx) {
    if (!this.layout || !this.annotations.length) return;
    const { margins, plotWidth, plotHeight, priceBottom } = this.layout;
    const tones = {
      accent: "#43e1c2",
      blue: "#64b8ff",
      warning: "#f1bf62",
      danger: "#f27d86",
      success: "#5fe0a7",
      muted: "#8fa8ba",
    };
    const xForTime = (time) => {
      const index = this.#indexAtTime(Number(time));
      return margins.left + ((candleCenterSlot(index) - this.viewStart) / this.visibleCount) * plotWidth;
    };
    const yForPrice = (price) => margins.top
      + ((this.layout.maxPrice - Number(price)) / (this.layout.maxPrice - this.layout.minPrice)) * plotHeight;
    const colorFor = (annotation) => tones[annotation?.tone] ?? tones.accent;
    const label = (text, x, y, color) => {
      if (!text) return;
      ctx.save();
      ctx.font = this.#font(8, true);
      const width = Math.min(190, ctx.measureText(String(text)).width + 10);
      const left = Math.max(margins.left, Math.min(margins.left + plotWidth - width, x));
      const top = Math.max(margins.top, Math.min(priceBottom - 17, y - 16));
      ctx.fillStyle = "rgba(6, 11, 16, .88)";
      ctx.fillRect(left, top, width, 15);
      ctx.strokeStyle = `${color}99`;
      ctx.strokeRect(left + .5, top + .5, width - 1, 14);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.fillText(String(text).slice(0, 42), left + 5, top + 11);
      ctx.restore();
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(margins.left, margins.top, plotWidth, plotHeight);
    ctx.clip();

    for (const annotation of this.annotations.filter((item) => item.type === "zone")) {
      const x1 = xForTime(annotation.startAt);
      const x2 = xForTime(annotation.endAt);
      const y1 = yForPrice(annotation.high);
      const y2 = yForPrice(annotation.low);
      const color = colorFor(annotation);
      ctx.fillStyle = `${color}18`;
      ctx.strokeStyle = `${color}88`;
      ctx.setLineDash([5, 4]);
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.max(2, Math.abs(y2 - y1)));
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.max(2, Math.abs(y2 - y1)));
      ctx.setLineDash([]);
    }

    for (const annotation of this.annotations.filter((item) => item.type === "line")) {
      const y = yForPrice(annotation.price);
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xForTime(annotation.startAt), y);
      ctx.lineTo(xForTime(annotation.endAt), y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const annotation of this.annotations.filter((item) => item.type === "segment")) {
      if (!annotation.a || !annotation.b) continue;
      const a = this.#screenPoint(annotation.a);
      const b = this.#screenPoint(annotation.b);
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const annotation of this.annotations.filter((item) => item.type === "event")) {
      const x = xForTime(annotation.time);
      const color = colorFor(annotation);
      ctx.strokeStyle = color;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, margins.top);
      ctx.lineTo(x, priceBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const annotation of this.annotations.filter((item) => item.type === "point")) {
      const point = this.#screenPoint({ time: annotation.time, price: annotation.price });
      const color = colorFor(annotation);
      ctx.fillStyle = "#071018";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    for (const annotation of this.annotations) {
      const color = colorFor(annotation);
      if (annotation.type === "zone") {
        label(annotation.label, xForTime(annotation.startAt) + 4, yForPrice(annotation.high), color);
      } else if (annotation.type === "line") {
        label(annotation.label, xForTime(annotation.endAt) - 110, yForPrice(annotation.price), color);
      } else if (annotation.type === "segment" && annotation.label) {
        const a = this.#screenPoint(annotation.a);
        const b = this.#screenPoint(annotation.b);
        label(annotation.label, (a.x + b.x) / 2, (a.y + b.y) / 2, color);
      } else if (annotation.type === "event") {
        label(annotation.label, xForTime(annotation.time) + 5, margins.top + 17, color);
      } else if (annotation.type === "point") {
        const point = this.#screenPoint({ time: annotation.time, price: annotation.price });
        label(annotation.label, point.x + 6, point.y, color);
      }
    }
  }

'''
replace_once(
    "chart.js",
    "  #drawDrawings(ctx) {",
    annotation_method + "  #drawDrawings(ctx) {",
    "chart annotation painter",
)

# Store: destructive cleanup is explicit and clears all three linked stores atomically.
replace_once(
    "signal-lab-v3-store.js",
    "  #pruneMemory() {",
    r'''  async clearAll() {
    this.memoryEpisodes.clear();
    this.memoryReviews.clear();
    this.memoryEvidence.clear();
    if (this.mode !== "indexeddb" || !this.database) {
      return Object.freeze({ episodes: 0, reviews: 0, evidence: 0, mode: this.mode });
    }
    const transaction = this.database.transaction([EPISODES, REVIEWS, EVIDENCE], "readwrite");
    transaction.objectStore(EPISODES).clear();
    transaction.objectStore(REVIEWS).clear();
    transaction.objectStore(EVIDENCE).clear();
    await transactionDone(transaction);
    return Object.freeze({ episodes: 0, reviews: 0, evidence: 0, mode: this.mode });
  }

  #pruneMemory() {''',
    "store clearAll",
)

# Replay now controls the recorded book/time evidence only; the full chart owns the shared InPuls chart engine.
replay_tail = r'''export function mountEvidenceReplay(card, episode) {
  const pack = episode?.evidencePack;
  const book = card.querySelector('[data-field="book"]');
  const slider = card.querySelector('[data-field="replay-slider"]');
  const replayTime = card.querySelector('[data-field="replay-time"]');
  const play = card.querySelector('[data-field="replay-play"]');
  const coverage = card.querySelector('[data-field="coverage"]');
  const outcomes = card.querySelector('[data-field="outcomes"]');
  if (!book || !slider || !replayTime || !play) return;
  if (!pack) {
    book.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "book-empty";
    empty.textContent = "Эпизод создан до включения записи depth20. Стакан задним числом восстановить нельзя.";
    book.append(empty);
    coverage.textContent = "Исторический Evidence Pack отсутствует. Полный график может загрузить минутные свечи Binance, но секундный контекст и старый стакан не восстанавливаются.";
    replayTime.textContent = "—";
    play.disabled = true;
    slider.disabled = true;
    renderExplanation(card, null);
    card.querySelector('[data-field="explanation-headline"]').textContent = "Этот эпизод был собран старой версией лаборатории. Авторазметка доступна только при сохранённой геометрии кандидата.";
    card.querySelector('[data-field="explanation-missing"]').textContent = "Не хватает исторических price points, flow samples и depth20; они не восстанавливаются задним числом.";
    renderOutcomes(outcomes, null);
    return;
  }

  let timer = null;
  const startAt = finite(pack?.window?.startAt) ?? Date.now() - 180_000;
  const latestAt = Math.max(
    finite(pack?.pricePoints?.at?.(-1)?.at) ?? startAt,
    finite(pack?.bookSnapshots?.at?.(-1)?.at) ?? startAt,
    finite(pack?.window?.updatedAt) ?? startAt,
  );
  const durationSeconds = Math.max(1, Math.round((latestAt - startAt) / 1_000));
  slider.min = "0";
  slider.max = String(durationSeconds);
  slider.step = "1";
  slider.value = String(Math.max(0, Math.min(durationSeconds, Math.round(((finite(pack?.window?.eventAt) ?? latestAt) - startAt) / 1_000))));

  const render = () => {
    const selectedAt = startAt + Number(slider.value) * 1_000;
    renderBook(book, pack, selectedAt);
    renderExplanation(card, pack);
    renderOutcomes(outcomes, pack);
    replayTime.textContent = formatClock(selectedAt);
    coverage.textContent = `Цена: ${pack.coverage?.prePriceSeconds ?? 0}с до · стакан: ${pack.coverage?.preBookSeconds ?? 0}с до / ${pack.coverage?.bookState ?? "not-recorded"} · режим ${pack.bookMode}`;
  };

  slider.addEventListener("input", render);
  play.addEventListener("click", () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
      play.textContent = "▶ Replay";
      return;
    }
    play.textContent = "Пауза";
    timer = setInterval(() => {
      const next = Number(slider.value) + 1;
      if (next > Number(slider.max)) {
        clearInterval(timer);
        timer = null;
        play.textContent = "▶ Replay";
        return;
      }
      slider.value = String(next);
      render();
    }, 350);
  });

  render();
}'''
regex_once(
    "signal-lab-v3-replay-ui.js",
    r"export function mountEvidenceReplay\(card, episode\) \{[\s\S]*\}\s*$",
    replay_tail,
    "replay ownership split",
)

# Owner HTML: V3.3, a destructive clear control, and lazy full-chart workspaces.
html = Path("owner-signal-lab-v3.html").read_text()
html = html.replace("Owner Signal Lab V3.2", "Owner Signal Lab V3.3")
html = html.replace("OWNER SIGNAL LAB V3.2", "OWNER SIGNAL LAB V3.3")
html = html.replace("signal-lab-v3-four-patterns-v1", "signal-lab-v3-full-chart-review-v1")
old_actions = '''            <span id="visible-count">0 эпизодов</span>
            <button id="export-json" class="button secondary" type="button">Экспорт JSON</button>
            <button id="export-csv" class="button secondary" type="button">Экспорт CSV</button>'''
new_actions = '''            <span id="visible-count">0 эпизодов</span>
            <button id="export-json" class="button secondary" type="button">Экспорт JSON</button>
            <button id="export-csv" class="button secondary" type="button">Экспорт CSV</button>
            <button id="clear-records" class="button danger" type="button">Очистить все записи</button>'''
if html.count(old_actions) != 1:
    raise RuntimeError("owner clear button anchor not found")
html = html.replace(old_actions, new_actions)
old_chart = re.search(r'''          <div class="chart-panel">[\s\S]*?          </div>\n\n          <div class="book-panel">''', html)
if not old_chart:
    raise RuntimeError("owner chart panel block not found")
new_chart = r'''          <div class="chart-panel full-chart-panel">
            <header class="evidence-panel-head">
              <div>
                <h3>Полноценный график проверки</h3>
                <p data-field="coverage">Контекст и стакан собираются…</p>
              </div>
              <button type="button" class="button primary compact" data-field="chart-toggle">Открыть полноценный график</button>
            </header>

            <div data-field="full-chart-shell" class="full-chart-shell" hidden>
              <div class="chart-primary-controls">
                <div class="timeframe-switch chart-timeframes" role="group" aria-label="Таймфрейм полного графика">
                  <button type="button" data-chart-timeframe="1s">1с</button>
                  <button type="button" data-chart-timeframe="5s">5с</button>
                  <button type="button" data-chart-timeframe="15s">15с</button>
                  <button type="button" data-chart-timeframe="1m" class="is-active">1м</button>
                  <button type="button" data-chart-timeframe="3m">3м</button>
                  <button type="button" data-chart-timeframe="5m">5м</button>
                  <button type="button" data-chart-timeframe="15m">15м</button>
                  <button type="button" data-chart-timeframe="1h">1ч</button>
                </div>
                <div class="timeframe-switch chart-ranges" role="group" aria-label="Контекст вокруг эпизода">
                  <button type="button" data-chart-range="15m">±15м</button>
                  <button type="button" data-chart-range="1h" class="is-active">±1ч</button>
                  <button type="button" data-chart-range="4h">±4ч</button>
                  <button type="button" data-chart-range="24h">±24ч</button>
                  <button type="button" data-chart-range="7d">±7д</button>
                </div>
              </div>

              <div class="chart-toolbar" aria-label="Инструменты графика">
                <button type="button" data-chart-tool="trend">Тренд</button>
                <button type="button" data-chart-tool="horizontal">Уровень</button>
                <button type="button" data-chart-tool="ruler">Линейка</button>
                <button type="button" data-chart-tool="rectangle">Зона</button>
                <button type="button" data-chart-tool="ray">Луч</button>
                <button type="button" data-chart-tool="freehand">Рисовать</button>
                <button type="button" data-chart-action="undo">Отменить</button>
                <button type="button" data-chart-action="clear">Очистить рисунки</button>
                <button type="button" data-chart-action="reset">К эпизоду</button>
                <label><input data-field="chart-annotations-toggle" type="checkbox" checked /> Авторазметка</label>
                <label><input data-field="chart-volume-toggle" type="checkbox" checked /> Объём</label>
                <label><input data-field="chart-sessions-toggle" type="checkbox" checked /> Сессии</label>
                <a data-field="open-inpuls-chart" class="button secondary compact" target="_blank" rel="noopener">Открыть в InPuls</a>
              </div>

              <div class="full-chart-stage">
                <canvas data-field="full-chart" class="full-chart-canvas" aria-label="Полноценный график эпизода InPuls"></canvas>
                <div data-field="full-chart-tooltip" class="full-chart-tooltip" hidden></div>
              </div>
              <p data-field="full-chart-status" class="full-chart-status">График загрузится после открытия.</p>
              <div class="annotation-summary">
                <span>Почему выбран паттерн — разметка на графике</span>
                <ul data-field="chart-annotation-list"></ul>
              </div>
            </div>

            <div class="replay-controls">
              <button type="button" class="button secondary compact" data-field="replay-play">▶ Replay стакана</button>
              <input data-field="replay-slider" type="range" min="0" max="1" step="1" value="0" aria-label="Время Replay стакана" />
              <strong data-field="replay-time">—</strong>
            </div>
            <div data-field="outcomes" class="outcomes"></div>
          </div>

          <div class="book-panel">'''
html = html[:old_chart.start()] + new_chart + html[old_chart.end():]
Path("owner-signal-lab-v3.html").write_text(html)

# Owner runtime: mount/destroy full charts and rebuild the collector after a confirmed clear.
owner = Path("owner-signal-lab-v3.js").read_text()
owner = owner.replace(
    'import { mountEvidenceReplay } from "./signal-lab-v3-replay-ui.js?v=signal-lab-v3-evidence-replay-v1";',
    'import { mountEvidenceReplay } from "./signal-lab-v3-replay-ui.js?v=signal-lab-v3-full-chart-review-v1";\nimport {\n  disposeEpisodeFullCharts,\n  mountEpisodeFullChart,\n  resetEpisodeFullChartState,\n} from "./signal-lab-v3-full-chart.js?v=signal-lab-v3-full-chart-review-v1";',
)
owner = owner.replace("signal-lab-v3-four-patterns-v1", "signal-lab-v3-full-chart-review-v1")
owner = owner.replace(
    '  exportCsv: document.querySelector("#export-csv"),\n  dayButtons:',
    '  exportCsv: document.querySelector("#export-csv"),\n  clearRecords: document.querySelector("#clear-records"),\n  dayButtons:',
)
owner = owner.replace(
    "    const visible = merged.slice(0, 60);\n    const cards = visible.map(renderCard);\n    elements.candidateList.replaceChildren(...cards);\n    requestAnimationFrame(() => {\n      cards.forEach((card, index) => mountEvidenceReplay(card, visible[index]));\n    });",
    "    const visible = merged.slice(0, 60);\n    const cards = visible.map(renderCard);\n    disposeEpisodeFullCharts({ preserveActive: true });\n    elements.candidateList.replaceChildren(...cards);\n    requestAnimationFrame(() => {\n      cards.forEach((card, index) => {\n        mountEvidenceReplay(card, visible[index]);\n        mountEpisodeFullChart(card, visible[index], { autoOpen: index === 0 });\n      });\n    });",
)
start = owner.find("const collector = new SignalLabV3Collector({")
end = owner.find("\n\nasync function initialize()", start)
if start < 0 or end < 0:
    raise RuntimeError("collector constructor block not found")
collector_block = owner[start:end]
collector_block = collector_block.replace("const collector = new SignalLabV3Collector({", "function createCollector() {\n  return new SignalLabV3Collector({", 1)
collector_block = collector_block.rstrip()
if not collector_block.endswith("});"):
    raise RuntimeError("collector block terminator not found")
collector_block = collector_block[:-3] + "  });\n}\n\nlet collector = createCollector();"
owner = owner[:start] + collector_block + owner[end:]
clear_function = r'''
async function clearRecords() {
  const confirmed = window.confirm(
    "Удалить все записи Signal Lab на этом устройстве? Будут удалены эпизоды, ручная разметка, Evidence Pack, графики и сохранённый стакан. Действие необратимо.",
  );
  if (!confirmed) return;
  elements.clearRecords.disabled = true;
  const previousLabel = elements.clearRecords.textContent;
  try {
    const shouldRestart = state.running;
    collector.disconnect();
    resetEpisodeFullChartState();
    await store.clearAll();
    liveEpisodes.clear();
    reviewStates.clear();
    persistedAt.clear();
    state.collectorStatus = null;
    collector = createCollector();
    if (shouldRestart) collector.connect();
    elements.clearRecords.textContent = "Записи очищены";
    await render();
    setTimeout(() => {
      elements.clearRecords.textContent = previousLabel;
    }, 1_800);
  } catch (error) {
    window.alert(`Не удалось очистить Signal Lab: ${String(error?.message ?? error)}`);
  } finally {
    elements.clearRecords.disabled = false;
  }
}

'''
owner = owner.replace("async function initialize() {", clear_function + "async function initialize() {", 1)
owner = owner.replace(
    'elements.exportCsv.addEventListener("click", exportCsv);',
    'elements.exportCsv.addEventListener("click", exportCsv);\nelements.clearRecords.addEventListener("click", clearRecords);',
)
owner = owner.replace(
    'window.addEventListener("beforeunload", () => collector.disconnect());',
    'window.addEventListener("beforeunload", () => {\n  disposeEpisodeFullCharts({ preserveActive: false });\n  collector.disconnect();\n});',
)
Path("owner-signal-lab-v3.js").write_text(owner)

# CSS: destructive control and a lazy full-size chart workspace.
css = Path("owner-signal-lab-v3.css").read_text()
css = css.replace(
    ".button.secondary { color: var(--blue); }",
    ".button.secondary { color: var(--blue); }\n.button.danger { border-color: rgba(242, 125, 134, 0.42); color: var(--danger); background: rgba(242, 125, 134, 0.06); }\n.button.danger:hover { border-color: var(--danger); color: #ffd9dc; background: rgba(242, 125, 134, 0.13); }\n.button:disabled { opacity: .55; cursor: wait; }",
)
css = css.replace(
    ".topbar-actions, .section-actions { display: flex; align-items: center; gap: 10px; }",
    ".topbar-actions, .section-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }",
)
Path("owner-signal-lab-v3.css").write_text(css)

evidence_css = Path("owner-signal-lab-v3-evidence.css").read_text()
evidence_css += r'''

.full-chart-panel { min-width: 0; }
.full-chart-shell[hidden] { display: none; }
.full-chart-shell {
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: #070c11;
}
.chart-primary-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  overflow-x: auto;
}
.chart-timeframes,
.chart-ranges { flex: 0 0 auto; }
.chart-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.chart-toolbar > button,
.chart-toolbar > label {
  min-height: 30px;
  padding: 5px 8px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  color: var(--muted);
  background: #0a1118;
  font-size: 10px;
  font-weight: 800;
}
.chart-toolbar > button { cursor: pointer; }
.chart-toolbar > button:hover,
.chart-toolbar > button.is-active {
  color: var(--accent);
  border-color: rgba(67, 225, 194, .38);
  background: var(--accent-soft);
}
.chart-toolbar > label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}
.chart-toolbar input { width: auto; min-height: auto; padding: 0; accent-color: var(--accent); }
.full-chart-stage {
  position: relative;
  width: 100%;
  height: clamp(360px, 50vh, 620px);
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  background: #070605;
  touch-action: none;
}
.full-chart-canvas { width: 100%; height: 100%; display: block; cursor: crosshair; }
.full-chart-tooltip {
  position: absolute;
  z-index: 4;
  max-width: 230px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  background: rgba(7, 12, 17, .94);
  box-shadow: 0 8px 24px rgba(0,0,0,.32);
  pointer-events: none;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: pre-line;
}
.full-chart-status { margin: 8px 0 0; color: var(--muted); font-size: 11px; }
.annotation-summary {
  margin-top: 9px;
  padding: 9px 10px;
  border: 1px solid rgba(241, 191, 98, .2);
  border-radius: 9px;
  background: rgba(241, 191, 98, .04);
}
.annotation-summary > span {
  color: var(--warning);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.annotation-summary ul {
  margin: 7px 0 0;
  padding-left: 18px;
  color: #bfd0da;
  font-size: 11px;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .chart-primary-controls { align-items: flex-start; flex-direction: column; }
  .full-chart-stage { height: 420px; }
}

@media (max-width: 620px) {
  .full-chart-stage { height: 340px; }
  .chart-toolbar { overflow-x: auto; flex-wrap: nowrap; }
  .chart-toolbar > * { flex: 0 0 auto; }
}
'''
Path("owner-signal-lab-v3-evidence.css").write_text(evidence_css)

# Documentation version strings and a compact release note.
Path("docs/signal-lab-v3-full-chart-review.md").write_text(r'''# Signal Lab V3.3 — Full Chart Review

## Задача

Каждая новая карточка должна позволять владельцу самостоятельно проверить, верно ли лаборатория выбрала каскад, пробой, нож или заточку. Источник истины по взаимодействию — существующий `CandlestickChart` из `chart.js`, а не отдельный упрощённый мини-график.

## Реализация

- график создаётся лениво при раскрытии карточки;
- одновременно активен один полный график;
- доступны TF `1с / 5с / 15с / 1м / 3м / 5м / 15м / 1ч`;
- секундные TF используют сохранённый Evidence Pack;
- минутные и старшие TF загружают исторические Binance Futures klines вокруг времени эпизода;
- доступны масштабирование, drag, crosshair, объём, сессии и ручные инструменты графика InPuls;
- авторазметка отделена от пользовательских рисунков и может быть скрыта.

## Авторазметка

- пробой: зона уровня, количество и точки касаний;
- каскад: `H1…Hn` или `L1…Ln`, соединение ступеней, зона и ближайшая ступень;
- нож/заточка: импульсная нога, экстремум, обратная реакция, исходный уровень или каскад при наличии;
- вертикальная линия `КАНДИДАТ` фиксирует время первичного обнаружения.

Разметка является объяснением формулы-кандидата, а не доказательством будущего движения.

## Очистка

Кнопка `Очистить все записи` после явного подтверждения атомарно удаляет локальные эпизоды, ручные вердикты и Evidence Pack. Активный сборщик пересоздаётся, чтобы удалённые внутренние сессии не появились повторно.

## Ограничения

- старый секундный контекст и стакан не восстанавливаются задним числом;
- Binance klines позволяют восстановить свечной контекст старых карточек, но не историческую ленту и depth20;
- sampled depth20 остаётся учебным срезом, а не полной event-first локальной книгой.
''')

print("Signal Lab V3.3 full chart patch applied")
