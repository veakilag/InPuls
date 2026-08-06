from pathlib import Path
import textwrap


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one occurrence, found {count}: {old[:160]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


modal_js = r'''
import { CandlestickChart } from "./chart.js?v=signal-lab-modal-chart-v1";
import {
  buildPatternAnnotations,
  loadEpisodeCandles,
  patternAnnotationSummary,
} from "./signal-lab-v3-full-chart.js?v=signal-lab-modal-chart-v1";

const TIMEFRAMES = Object.freeze([
  ["1s", "1с"], ["5s", "5с"], ["15s", "15с"], ["1m", "1м"], ["3m", "3м"],
  ["5m", "5м"], ["15m", "15м"], ["1h", "1ч"], ["4h", "4ч"], ["1d", "1д"],
]);
const RANGES = Object.freeze([
  ["15m", "±15м"], ["1h", "±1ч"], ["4h", "±4ч"], ["24h", "±24ч"],
  ["7d", "±7д"], ["30d", "30д до события"],
]);
const STORAGE_KEY = "inpuls-signal-lab-modal-chart-v1";
const GEOMETRY_KEY = "inpuls-signal-lab-modal-geometry-v1";

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function ensureStyles() {
  if (document.querySelector('link[data-signal-lab-modal-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./signal-lab-chart-modal.css?v=signal-lab-modal-chart-v1";
  link.dataset.signalLabModalStyle = "true";
  document.head.append(link);
}

function buttonGroup(rows, attribute, activeValue) {
  return rows.map(([value, label]) => (
    `<button type="button" ${attribute}="${value}" class="${value === activeValue ? "is-active" : ""}">${label}</button>`
  )).join("");
}

function modalMarkup() {
  return `
    <div class="signal-lab-chart-modal__backdrop" data-modal-close></div>
    <section class="signal-lab-chart-modal__window" role="dialog" aria-modal="true" aria-labelledby="signal-lab-modal-title">
      <header class="signal-lab-chart-modal__header" data-modal-drag>
        <div class="signal-lab-chart-modal__identity">
          <span class="signal-lab-chart-modal__eyebrow">SIGNAL LAB · ПОЛНЫЙ ГРАФИК</span>
          <div class="signal-lab-chart-modal__title-row">
            <strong id="signal-lab-modal-title" data-modal-symbol>—</strong>
            <span data-modal-label>—</span>
            <span data-modal-stage class="signal-lab-chart-modal__badge">—</span>
          </div>
          <small data-modal-meta>—</small>
        </div>
        <div class="signal-lab-chart-modal__window-actions">
          <button type="button" data-modal-maximize title="Развернуть на весь экран">Развернуть</button>
          <button type="button" data-modal-close title="Закрыть график">Закрыть</button>
        </div>
      </header>

      <div class="signal-lab-chart-modal__controls">
        <div class="signal-lab-chart-modal__switch" aria-label="Таймфрейм">
          ${buttonGroup(TIMEFRAMES, "data-modal-timeframe", "1m")}
        </div>
        <div class="signal-lab-chart-modal__switch signal-lab-chart-modal__ranges" aria-label="Контекст">
          ${buttonGroup(RANGES, "data-modal-range", "1h")}
        </div>
      </div>

      <div class="signal-lab-chart-modal__toolbar" aria-label="Инструменты графика">
        <button type="button" data-modal-tool="trend">Тренд</button>
        <button type="button" data-modal-tool="horizontal">Уровень</button>
        <button type="button" data-modal-tool="ruler">Линейка</button>
        <button type="button" data-modal-tool="rectangle">Зона</button>
        <button type="button" data-modal-tool="ray">Луч</button>
        <button type="button" data-modal-tool="freehand">Рисовать</button>
        <button type="button" data-modal-action="undo">Отменить</button>
        <button type="button" data-modal-action="clear">Очистить рисунки</button>
        <button type="button" data-modal-action="event">К событию</button>
        <button type="button" data-modal-action="fit">Весь диапазон</button>
        <label><input type="checkbox" data-modal-annotations checked /> Авторазметка</label>
        <label><input type="checkbox" data-modal-volume checked /> Объём</label>
        <label><input type="checkbox" data-modal-sessions checked /> Сессии</label>
        <a data-modal-open-inpuls target="_blank" rel="noopener">Открыть в InPuls</a>
      </div>

      <div class="signal-lab-chart-modal__stage">
        <canvas data-modal-canvas aria-label="График эпизода Signal Lab"></canvas>
        <div data-modal-tooltip class="signal-lab-chart-modal__tooltip" hidden></div>
      </div>

      <footer class="signal-lab-chart-modal__footer">
        <p data-modal-status>График готовится…</p>
        <details>
          <summary>Почему отмечен этот паттерн</summary>
          <ul data-modal-annotations-list></ul>
        </details>
      </footer>
    </section>
  `;
}

function formatTime(timestamp) {
  const value = finite(timestamp);
  if (value === null) return "время неизвестно";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

class SignalLabChartModal {
  constructor() {
    ensureStyles();
    this.root = document.createElement("div");
    this.root.className = "signal-lab-chart-modal";
    this.root.hidden = true;
    this.root.setAttribute("aria-hidden", "true");
    this.root.innerHTML = modalMarkup();
    document.body.append(this.root);

    this.panel = this.root.querySelector(".signal-lab-chart-modal__window");
    this.header = this.root.querySelector("[data-modal-drag]");
    this.canvas = this.root.querySelector("[data-modal-canvas]");
    this.tooltip = this.root.querySelector("[data-modal-tooltip]");
    this.status = this.root.querySelector("[data-modal-status]");
    this.annotationList = this.root.querySelector("[data-modal-annotations-list]");
    this.annotationToggle = this.root.querySelector("[data-modal-annotations]");
    this.volumeToggle = this.root.querySelector("[data-modal-volume]");
    this.sessionsToggle = this.root.querySelector("[data-modal-sessions]");
    this.timeframeButtons = [...this.root.querySelectorAll("[data-modal-timeframe]")];
    this.rangeButtons = [...this.root.querySelectorAll("[data-modal-range]")];
    this.toolButtons = [...this.root.querySelectorAll("[data-modal-tool]")];
    this.maximizeButton = this.root.querySelector("[data-modal-maximize]");
    this.openInPuls = this.root.querySelector("[data-modal-open-inpuls]");

    this.episode = null;
    this.chart = null;
    this.annotations = [];
    this.interval = "1m";
    this.contextRange = "1h";
    this.abortController = null;
    this.loadTimer = null;
    this.generation = 0;
    this.dragState = null;
    this.dragFrame = null;
    this.restoreGeometry = null;
    this.previousFocus = null;
    this.geometrySaveTimer = null;

    this.#bind();
    this.#restoreSavedGeometry();
    this.panelResizeObserver = new ResizeObserver(() => this.#queueGeometrySave());
    this.panelResizeObserver.observe(this.panel);
  }

  #bind() {
    this.root.querySelectorAll("[data-modal-close]").forEach((element) => {
      element.addEventListener("click", () => this.close());
    });
    this.maximizeButton.addEventListener("click", () => this.toggleMaximize());
    this.timeframeButtons.forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.modalTimeframe === this.interval) return;
      this.interval = button.dataset.modalTimeframe;
      this.#syncActiveButtons();
      this.#scheduleLoad();
    }));
    this.rangeButtons.forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.modalRange === this.contextRange) return;
      this.contextRange = button.dataset.modalRange;
      this.#syncActiveButtons();
      this.#scheduleLoad();
    }));
    this.toolButtons.forEach((button) => button.addEventListener("click", () => {
      this.chart?.setTool(button.dataset.modalTool);
    }));
    this.root.querySelector('[data-modal-action="undo"]').addEventListener("click", () => this.chart?.undoDrawing());
    this.root.querySelector('[data-modal-action="clear"]').addEventListener("click", () => this.chart?.clearDrawings());
    this.root.querySelector('[data-modal-action="event"]').addEventListener("click", () => this.#focusEvent());
    this.root.querySelector('[data-modal-action="fit"]').addEventListener("click", () => this.#fitRange());
    this.annotationToggle.addEventListener("change", () => {
      this.chart?.setAnnotations(this.annotationToggle.checked ? this.annotations : []);
    });
    this.volumeToggle.addEventListener("change", () => this.chart?.setVolumeVisible(this.volumeToggle.checked));
    this.sessionsToggle.addEventListener("change", () => this.chart?.setSessionsVisible(this.sessionsToggle.checked));

    this.header.addEventListener("pointerdown", (event) => this.#startDrag(event));
    this.header.addEventListener("pointermove", (event) => this.#moveDrag(event));
    this.header.addEventListener("pointerup", (event) => this.#endDrag(event));
    this.header.addEventListener("pointercancel", (event) => this.#endDrag(event));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isOpen()) this.close();
    });
  }

  #syncActiveButtons() {
    this.timeframeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.modalTimeframe === this.interval);
    });
    this.rangeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.modalRange === this.contextRange);
    });
  }

  #scheduleLoad(delay = 90) {
    clearTimeout(this.loadTimer);
    this.abortController?.abort();
    this.loadTimer = setTimeout(() => this.#load(), delay);
  }

  #ensureChart() {
    if (this.chart) return;
    this.chart = new CandlestickChart(this.canvas, this.tooltip, { storageKey: STORAGE_KEY });
    this.chart.setVolumeVisible(this.volumeToggle.checked);
    this.chart.setSessionsVisible(this.sessionsToggle.checked);
    this.chart.onToolChange = (tool) => {
      this.toolButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.modalTool === tool);
      });
    };
  }

  async open(episode) {
    if (!episode?.id) return;
    this.previousFocus = document.activeElement;
    this.episode = episode;
    this.annotations = buildPatternAnnotations(episode);
    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    document.body.classList.add("signal-lab-chart-modal-open");
    this.#syncActiveButtons();
    this.root.querySelector("[data-modal-symbol]").textContent = episode.symbol ?? "—";
    this.root.querySelector("[data-modal-label]").textContent = episode.label ?? episode.candidateType ?? "Эпизод";
    this.root.querySelector("[data-modal-stage]").textContent = episode.stage ?? "—";
    this.root.querySelector("[data-modal-meta]").textContent = `${formatTime(episode.firstSeenAt)} · ${episode.observations ?? 0} наблюдений · score ${Math.round(Number(episode.peakEvidenceScore) || 0)}/100`;
    this.openInPuls.href = `./?symbol=${encodeURIComponent(episode.symbol ?? "")}`;
    this.annotationList.replaceChildren(...(patternAnnotationSummary(this.annotations).length
      ? patternAnnotationSummary(this.annotations)
      : ["Авторазметка для эпизода пока не сформирована."]
    ).map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
    this.#ensureChart();
    this.panel.focus?.({ preventScroll: true });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await this.#load();
  }

  close() {
    if (!this.isOpen()) return;
    clearTimeout(this.loadTimer);
    this.abortController?.abort();
    this.abortController = null;
    this.generation += 1;
    this.chart?.destroy();
    this.chart = null;
    this.episode = null;
    this.root.hidden = true;
    this.root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("signal-lab-chart-modal-open");
    if (this.previousFocus?.isConnected) this.previousFocus.focus?.({ preventScroll: true });
    this.previousFocus = null;
  }

  destroy() {
    this.close();
    this.panelResizeObserver?.disconnect();
    clearTimeout(this.geometrySaveTimer);
    this.root.remove();
  }

  isOpen() {
    return !this.root.hidden && this.root.getAttribute("aria-hidden") === "false";
  }

  async #load() {
    if (!this.episode || !this.chart || !this.isOpen()) return;
    this.generation += 1;
    const generation = this.generation;
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.status.dataset.state = "loading";
    this.status.textContent = `Загружаю ${this.episode.symbol} · ${this.interval} · ${this.contextRange}…`;
    try {
      const loaded = await loadEpisodeCandles(this.episode, this.interval, this.contextRange, {
        signal: this.abortController.signal,
      });
      if (generation !== this.generation || !this.chart || !this.isOpen()) return;
      const candles = loaded.candles;
      const coverage = loaded.coverage;
      this.chart.setData(candles, {
        symbol: this.episode.symbol,
        interval: this.interval,
        range: `signal-lab-modal-${this.contextRange}`,
        targetCandles: candles.length,
      });
      this.chart.setAnnotations(this.annotationToggle.checked ? this.annotations : []);
      if (this.contextRange === "30d" && candles.length <= 2_000) this.#fitRange(candles);
      else this.#focusEvent(candles);
      const percent = Math.round((coverage?.ratio ?? 0) * 100);
      this.status.dataset.state = coverage?.complete ? "complete" : "partial";
      this.status.textContent = `${this.episode.symbol} · ${this.interval} · ${candles.length} свечей · ${coverage?.source ?? "UNKNOWN"} · покрытие ${percent}% · ${coverage?.complete ? "COMPLETE" : "PARTIAL"}`;
    } catch (error) {
      if (error?.name === "AbortError") return;
      this.status.dataset.state = "error";
      this.status.textContent = `График недоступен: ${String(error?.message ?? error)}`;
    }
  }

  #fitRange(candles = this.chart?.candles ?? []) {
    if (!this.chart || !candles.length) return;
    const maximumVisible = this.interval === "1m" ? Math.min(candles.length, 2_000) : candles.length;
    this.chart.visibleCount = Math.max(20, maximumVisible);
    this.chart.followLatest = false;
    this.chart.centerLatest = false;
    this.chart.priceScale = 1;
    this.chart.pricePan = 0;
    this.chart.fixedPriceDomain = null;
    this.chart.viewStart = Math.max(0, candles.length - maximumVisible);
    this.chart.render();
  }

  #focusEvent(candles = this.chart?.candles ?? []) {
    if (!this.chart || !candles.length || !this.episode) return;
    const eventAt = finite(this.episode?.evidencePack?.window?.eventAt) ?? finite(this.episode?.firstSeenAt);
    let eventIndex = candles.length - 1;
    if (eventAt !== null) {
      eventIndex = candles.reduce((bestIndex, candle, index) => (
        Math.abs(candle.time - eventAt) < Math.abs(candles[bestIndex].time - eventAt) ? index : bestIndex
      ), 0);
    }
    const preferred = this.interval.endsWith("s") ? 120 : this.interval === "1m" ? 100 : 70;
    this.chart.visibleCount = clamp(Math.min(candles.length, preferred), Math.min(20, candles.length), Math.max(20, candles.length));
    this.chart.followLatest = false;
    this.chart.centerLatest = false;
    this.chart.priceScale = 1;
    this.chart.pricePan = 0;
    this.chart.fixedPriceDomain = null;
    this.chart.viewStart = Math.max(0, eventIndex - this.chart.visibleCount * 0.52);
    this.chart.render();
  }

  toggleMaximize() {
    const maximizing = !this.panel.classList.contains("is-maximized");
    if (maximizing) {
      const rect = this.panel.getBoundingClientRect();
      this.restoreGeometry = {
        left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
      };
      this.panel.classList.add("is-maximized");
      this.panel.style.removeProperty("left");
      this.panel.style.removeProperty("top");
      this.panel.style.removeProperty("width");
      this.panel.style.removeProperty("height");
      this.panel.style.removeProperty("transform");
      this.maximizeButton.textContent = "Восстановить";
    } else {
      this.panel.classList.remove("is-maximized");
      Object.assign(this.panel.style, this.restoreGeometry ?? {});
      this.panel.style.transform = "none";
      this.maximizeButton.textContent = "Развернуть";
      this.#queueGeometrySave();
    }
  }

  #startDrag(event) {
    if (event.button !== 0 || this.panel.classList.contains("is-maximized")) return;
    if (event.target.closest("button, a, input, label, select")) return;
    const rect = this.panel.getBoundingClientRect();
    this.panel.style.left = `${rect.left}px`;
    this.panel.style.top = `${rect.top}px`;
    this.panel.style.width = `${rect.width}px`;
    this.panel.style.height = `${rect.height}px`;
    this.panel.style.transform = "none";
    this.dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    this.header.setPointerCapture?.(event.pointerId);
    this.panel.classList.add("is-dragging");
    event.preventDefault();
  }

  #moveDrag(event) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;
    this.dragState.clientX = event.clientX;
    this.dragState.clientY = event.clientY;
    if (this.dragFrame !== null) return;
    this.dragFrame = requestAnimationFrame(() => {
      this.dragFrame = null;
      if (!this.dragState) return;
      const rect = this.panel.getBoundingClientRect();
      const left = clamp(this.dragState.clientX - this.dragState.offsetX, 0, Math.max(0, innerWidth - Math.min(260, rect.width)));
      const top = clamp(this.dragState.clientY - this.dragState.offsetY, 0, Math.max(0, innerHeight - 56));
      this.panel.style.left = `${left}px`;
      this.panel.style.top = `${top}px`;
    });
  }

  #endDrag(event) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;
    this.header.releasePointerCapture?.(event.pointerId);
    this.dragState = null;
    this.panel.classList.remove("is-dragging");
    this.#queueGeometrySave();
  }

  #queueGeometrySave() {
    if (!this.isOpen() || this.panel.classList.contains("is-maximized")) return;
    clearTimeout(this.geometrySaveTimer);
    this.geometrySaveTimer = setTimeout(() => {
      const rect = this.panel.getBoundingClientRect();
      try {
        localStorage.setItem(GEOMETRY_KEY, JSON.stringify({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }));
      } catch {}
    }, 180);
  }

  #restoreSavedGeometry() {
    try {
      const saved = JSON.parse(localStorage.getItem(GEOMETRY_KEY) || "null");
      if (!saved || ![saved.left, saved.top, saved.width, saved.height].every(Number.isFinite)) return;
      const width = clamp(saved.width, 720, Math.max(720, innerWidth - 24));
      const height = clamp(saved.height, 480, Math.max(480, innerHeight - 24));
      const left = clamp(saved.left, 0, Math.max(0, innerWidth - 260));
      const top = clamp(saved.top, 0, Math.max(0, innerHeight - 56));
      Object.assign(this.panel.style, {
        left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, transform: "none",
      });
    } catch {}
  }
}

let singleton = null;
function getModal() {
  if (!singleton) singleton = new SignalLabChartModal();
  return singleton;
}

export function openEpisodeChartModal(episode) {
  return getModal().open(episode);
}

export function closeEpisodeChartModal() {
  singleton?.close();
}

export function isEpisodeChartModalOpen() {
  return singleton?.isOpen() ?? false;
}

export function resetEpisodeChartModal() {
  singleton?.destroy();
  singleton = null;
}
'''.lstrip()

modal_css = r'''
.signal-lab-chart-modal[hidden] { display: none !important; }
body.signal-lab-chart-modal-open { overflow: hidden; }

.signal-lab-chart-modal {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.signal-lab-chart-modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgb(2 7 12 / 78%);
  backdrop-filter: blur(4px);
  pointer-events: auto;
}

.signal-lab-chart-modal__window {
  position: fixed;
  left: 50%;
  top: 50%;
  width: min(1500px, 94vw);
  height: min(900px, 92vh);
  min-width: 720px;
  min-height: 480px;
  transform: translate(-50%, -50%);
  display: grid;
  grid-template-rows: auto auto auto minmax(280px, 1fr) auto;
  overflow: hidden;
  resize: both;
  border: 1px solid #243849;
  border-radius: 14px;
  background: #081018;
  box-shadow: 0 28px 100px rgb(0 0 0 / 62%);
  color: #eaf2f8;
  pointer-events: auto;
  contain: layout paint style;
}

.signal-lab-chart-modal__window.is-maximized {
  inset: 8px;
  width: auto;
  height: auto;
  min-width: 0;
  min-height: 0;
  transform: none;
  resize: none;
  border-radius: 10px;
}

.signal-lab-chart-modal__window.is-dragging {
  user-select: none;
  cursor: grabbing;
}

.signal-lab-chart-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 68px;
  padding: 10px 14px;
  border-bottom: 1px solid #1b2b39;
  background: linear-gradient(180deg, #101c26, #0b141c);
  cursor: grab;
  touch-action: none;
}

.signal-lab-chart-modal__identity { min-width: 0; }
.signal-lab-chart-modal__eyebrow {
  display: block;
  margin-bottom: 3px;
  color: #5ce0b3;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .12em;
}
.signal-lab-chart-modal__title-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.signal-lab-chart-modal__title-row strong { font-size: 18px; }
.signal-lab-chart-modal__title-row span:not(.signal-lab-chart-modal__badge) {
  overflow: hidden;
  color: #c6d3dd;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.signal-lab-chart-modal__identity small { color: #718596; }
.signal-lab-chart-modal__badge {
  padding: 3px 7px;
  border: 1px solid #28526d;
  border-radius: 999px;
  color: #7dc8f8;
  font-size: 10px;
  text-transform: uppercase;
}

.signal-lab-chart-modal button,
.signal-lab-chart-modal a {
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid #29465d;
  border-radius: 6px;
  background: #0c1822;
  color: #b8dfff;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}
.signal-lab-chart-modal button:hover,
.signal-lab-chart-modal a:hover,
.signal-lab-chart-modal button.is-active {
  border-color: #36a9e1;
  background: #11283a;
  color: #eef9ff;
}

.signal-lab-chart-modal__window-actions,
.signal-lab-chart-modal__controls,
.signal-lab-chart-modal__toolbar,
.signal-lab-chart-modal__switch {
  display: flex;
  align-items: center;
  gap: 6px;
}
.signal-lab-chart-modal__window-actions { flex: 0 0 auto; }
.signal-lab-chart-modal__controls {
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  overflow-x: auto;
  border-bottom: 1px solid #182836;
  background: #09131b;
}
.signal-lab-chart-modal__switch { flex: 0 0 auto; }
.signal-lab-chart-modal__ranges { margin-left: auto; }
.signal-lab-chart-modal__toolbar {
  flex-wrap: wrap;
  padding: 7px 10px;
  border-bottom: 1px solid #182836;
  background: #0a151e;
}
.signal-lab-chart-modal__toolbar label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 0 4px;
  color: #93a8b8;
  font-size: 11px;
  white-space: nowrap;
}
.signal-lab-chart-modal__toolbar input { accent-color: #42d5a2; }
.signal-lab-chart-modal__toolbar a { margin-left: auto; }

.signal-lab-chart-modal__stage {
  position: relative;
  min-height: 280px;
  overflow: hidden;
  background: #060c12;
}
.signal-lab-chart-modal__stage canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}
.signal-lab-chart-modal__tooltip {
  position: absolute;
  z-index: 5;
  max-width: 300px;
  padding: 7px 9px;
  border: 1px solid #31485a;
  border-radius: 7px;
  background: rgb(7 15 22 / 94%);
  color: #e9f3f8;
  font-size: 11px;
  pointer-events: none;
  white-space: pre-line;
}

.signal-lab-chart-modal__footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 42px;
  padding: 7px 11px;
  border-top: 1px solid #1a2b39;
  background: #0a141c;
  color: #8195a5;
  font-size: 11px;
}
.signal-lab-chart-modal__footer p { margin: 0; }
.signal-lab-chart-modal__footer p[data-state="complete"] { color: #56d6a6; }
.signal-lab-chart-modal__footer p[data-state="partial"] { color: #e5b45d; }
.signal-lab-chart-modal__footer p[data-state="error"] { color: #ff7f7f; }
.signal-lab-chart-modal__footer details { max-width: min(520px, 42vw); }
.signal-lab-chart-modal__footer summary { color: #9fc7e0; cursor: pointer; }
.signal-lab-chart-modal__footer ul {
  max-height: 150px;
  margin: 8px 0 0;
  padding-left: 18px;
  overflow: auto;
}

.candidate-card {
  content-visibility: auto;
  contain: layout paint style;
  contain-intrinsic-size: 1100px;
}
.candidate-card [data-field="full-chart-shell"] { display: none !important; }

@media (max-width: 820px) {
  .signal-lab-chart-modal__window,
  .signal-lab-chart-modal__window.is-maximized {
    inset: 0;
    width: 100vw;
    height: 100dvh;
    min-width: 0;
    min-height: 0;
    transform: none;
    resize: none;
    border: 0;
    border-radius: 0;
  }
  .signal-lab-chart-modal__header { min-height: 60px; }
  .signal-lab-chart-modal__controls { display: block; }
  .signal-lab-chart-modal__switch { margin-bottom: 6px; overflow-x: auto; }
  .signal-lab-chart-modal__ranges { margin-left: 0; }
  .signal-lab-chart-modal__toolbar { max-height: 86px; overflow-y: auto; }
  .signal-lab-chart-modal__footer { grid-template-columns: 1fr; }
  .signal-lab-chart-modal__footer details { max-width: none; }
}
'''.lstrip()

modal_test = r'''
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const owner = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
const modal = fs.readFileSync(new URL("../signal-lab-chart-modal.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../signal-lab-chart-modal.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");

test("Signal Lab opens one shared chart modal instead of chart instances inside every card", () => {
  assert.match(owner, /openEpisodeChartModal/);
  assert.doesNotMatch(owner, /mountEpisodeFullChart|disposeEpisodeFullCharts|isEpisodeFullChartOpen/);
  assert.match(owner, /deferEvidenceReplay/);
  assert.match(modal, /new CandlestickChart/);
  assert.equal((modal.match(/new CandlestickChart/g) ?? []).length, 1);
  assert.match(modal, /loadEpisodeCandles/);
  assert.match(modal, /data-modal-timeframe/);
  assert.match(modal, /data-modal-maximize/);
  assert.match(css, /resize:\s*both/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(html, /signal-lab-v8-smooth-modal-chart/);
});
'''.lstrip()

Path("signal-lab-chart-modal.js").write_text(modal_js, encoding="utf-8")
Path("signal-lab-chart-modal.css").write_text(modal_css, encoding="utf-8")
Path("test/signal-lab-modal-chart.test.js").write_text(modal_test, encoding="utf-8")

replace_once(
    "owner-signal-lab-v3.js",
    '''import {
  disposeEpisodeFullCharts,
  isEpisodeFullChartOpen,
  mountEpisodeFullChart,
  resetEpisodeFullChartState,
} from "./signal-lab-v3-full-chart.js?v=signal-lab-v6-canonical-annotations";''',
    '''import {
  openEpisodeChartModal,
  resetEpisodeChartModal,
} from "./signal-lab-chart-modal.js?v=signal-lab-v8-smooth-modal-chart";''',
)

replace_once(
    "owner-signal-lab-v3.js",
    '''function scheduleRender(delay = 900) {
  if (isEpisodeFullChartOpen()) {
    state.pendingRender = true;
    return;
  }
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(() => render(), delay);
}''',
    '''function scheduleRender(delay = 900) {
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(() => render(), delay);
}''',
)

replace_once(
    "owner-signal-lab-v3.js",
    '''const state = {
  days: 7,
  running: true,
  collectorStatus: null,
  renderTimer: null,
  rendering: false,
  pendingRender: false,
};''',
    '''const state = {
  days: 7,
  running: true,
  collectorStatus: null,
  renderTimer: null,
  rendering: false,
  pendingRender: false,
};

const replayObservers = new Set();
const replayIdleJobs = new Set();

function cancelDeferredReplayMounts() {
  replayObservers.forEach((observer) => observer.disconnect());
  replayObservers.clear();
  replayIdleJobs.forEach((job) => {
    if (job.kind === "idle") cancelIdleCallback(job.id);
    else clearTimeout(job.id);
  });
  replayIdleJobs.clear();
}

function queueReplayMount(callback) {
  const job = typeof requestIdleCallback === "function"
    ? { kind: "idle", id: requestIdleCallback(callback, { timeout: 900 }) }
    : { kind: "timeout", id: setTimeout(callback, 80) };
  replayIdleJobs.add(job);
  return job;
}

function deferEvidenceReplay(card, episode) {
  const mount = () => {
    if (!card.isConnected || card.dataset.replayMounted === "true") return;
    card.dataset.replayMounted = "true";
    mountEvidenceReplay(card, episode);
  };
  if (typeof IntersectionObserver !== "function") {
    queueReplayMount(mount);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    replayObservers.delete(observer);
    queueReplayMount(mount);
  }, { rootMargin: "500px 0px" });
  replayObservers.add(observer);
  observer.observe(card);
}''',
)

replace_once(
    "owner-signal-lab-v3.js",
    '''  card.querySelectorAll("[data-verdict]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.verdict === episode.reviewState);
    button.addEventListener("click", () => saveReview(episode, card, button.dataset.verdict));
  });
  return card;''',
    '''  card.querySelectorAll("[data-verdict]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.verdict === episode.reviewState);
    button.addEventListener("click", () => saveReview(episode, card, button.dataset.verdict));
  });
  const chartButton = card.querySelector('[data-field="chart-toggle"]');
  if (chartButton) {
    chartButton.textContent = "Показать график";
    chartButton.addEventListener("click", () => openEpisodeChartModal(episode));
  }
  return card;''',
)

replace_once(
    "owner-signal-lab-v3.js",
    '''async function render() {
  if (isEpisodeFullChartOpen()) {
    state.pendingRender = true;
    return;
  }
  if (state.rendering) return;''',
    '''async function render() {
  if (state.rendering) return;''',
)

replace_once(
    "owner-signal-lab-v3.js",
    '''    const cards = visible.map(renderCard);
    disposeEpisodeFullCharts({ preserveActive: true });
    elements.candidateList.replaceChildren(...cards);
    requestAnimationFrame(() => {
      cards.forEach((card, index) => {
        mountEvidenceReplay(card, visible[index]);
        mountEpisodeFullChart(card, visible[index], { autoOpen: false });
      });
    });''',
    '''    const cards = visible.map(renderCard);
    cancelDeferredReplayMounts();
    elements.candidateList.replaceChildren(...cards);
    requestAnimationFrame(() => {
      cards.forEach((card, index) => deferEvidenceReplay(card, visible[index]));
    });''',
)

replace_once(
    "owner-signal-lab-v3.js",
    "    resetEpisodeFullChartState();",
    "    resetEpisodeChartModal();\n    cancelDeferredReplayMounts();",
)

replace_once(
    "owner-signal-lab-v3.js",
    '''window.addEventListener("inpuls:signal-lab-chart-closed", () => {
  if (!state.pendingRender) return;
  state.pendingRender = false;
  scheduleRender(0);
});
window.addEventListener("beforeunload", () => {
  disposeEpisodeFullCharts({ preserveActive: false });
  collector.disconnect();
});''',
    '''window.addEventListener("beforeunload", () => {
  resetEpisodeChartModal();
  cancelDeferredReplayMounts();
  collector.disconnect();
});''',
)

replace_once(
    "owner-signal-lab-v3.html",
    '<script type="module" src="./owner-signal-lab-v3.js?v=signal-lab-v6-extreme-history-fallback"></script>',
    '<script type="module" src="./owner-signal-lab-v3.js?v=signal-lab-v8-smooth-modal-chart"></script>',
)

runtime_path = Path("scripts/signal-lab-runtime-smoke.mjs")
runtime = runtime_path.read_text(encoding="utf-8")
probe_function = r'''
async function probeChartModal(socket) {
  const evaluation = await send(socket, "Runtime.evaluate", {
    expression: `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let button = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        button = document.querySelector('[data-field="chart-toggle"]');
        if (button) break;
        await wait(250);
      }
      if (!button) return { ok: false, reason: 'NO_CHART_BUTTON' };
      button.click();
      let root = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        root = document.querySelector('.signal-lab-chart-modal');
        if (root && !root.hidden && root.getAttribute('aria-hidden') === 'false') break;
        await wait(100);
      }
      const panel = root?.querySelector('.signal-lab-chart-modal__window');
      const canvas = root?.querySelector('[data-modal-canvas]');
      if (!root || !panel || !canvas || root.hidden) return { ok: false, reason: 'MODAL_DID_NOT_OPEN' };
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const before = panel.getBoundingClientRect();
      panel.style.width = '70vw';
      panel.style.height = '70vh';
      panel.style.transform = 'none';
      panel.style.left = '40px';
      panel.style.top = '40px';
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = panel.getBoundingClientRect();
      const timeframe = root.querySelector('[data-modal-timeframe="5m"]');
      timeframe?.click();
      await wait(120);
      const timeframeActive = timeframe?.classList.contains('is-active') === true;
      root.querySelector('[data-modal-close]')?.click();
      await wait(50);
      const closed = root.hidden && root.getAttribute('aria-hidden') === 'true';
      const resized = Math.abs(after.width - before.width) > 20 || Math.abs(after.height - before.height) > 20;
      const canvasReady = canvas.getBoundingClientRect().width > 100 && canvas.getBoundingClientRect().height > 100;
      return {
        ok: Boolean(timeframeActive && resized && canvasReady && closed),
        timeframeActive,
        resized,
        canvasReady,
        closed,
        before: { width: Math.round(before.width), height: Math.round(before.height) },
        after: { width: Math.round(after.width), height: Math.round(after.height) },
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  return evaluation.result?.result?.value ?? evaluation.result?.value ?? { ok: false, reason: "NO_RESULT" };
}

'''
needle = "try {\n  await waitForDebugger();"
if needle not in runtime:
    raise SystemExit("runtime smoke insertion point not found")
runtime = runtime.replace(needle, probe_function + needle, 1)
runtime = runtime.replace(
    '''  const runtime = await waitForRuntime(socket);
  const probes = runtimeReady(runtime.state) ? [] : await runEndpointProbes(socket);

  console.log(JSON.stringify({''',
    '''  const runtime = await waitForRuntime(socket);
  const probes = runtimeReady(runtime.state) ? [] : await runEndpointProbes(socket);
  const modalProbe = runtimeReady(runtime.state)
    ? await probeChartModal(socket)
    : { ok: false, skipped: true, reason: "RUNTIME_NOT_READY" };

  console.log(JSON.stringify({''',
    1,
)
runtime = runtime.replace(
    '''    samples: runtime.samples,
    probes,''',
    '''    samples: runtime.samples,
    modalProbe,
    probes,''',
    1,
)
runtime = runtime.replace(
    '''  if (!runtimeReady(runtime.state) || exceptions.length) {
    process.exitCode = 1;
  }''',
    '''  if (!runtimeReady(runtime.state) || !modalProbe.ok || exceptions.length) {
    process.exitCode = 1;
  }''',
    1,
)
runtime_path.write_text(runtime, encoding="utf-8")

# The temporary patcher and workflow delete themselves in the applying job.
print("Signal Lab smooth modal chart patch prepared")
