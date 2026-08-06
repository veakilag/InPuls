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
    <section class="signal-lab-chart-modal__window" role="dialog" aria-modal="true" aria-labelledby="signal-lab-modal-title" tabindex="-1">
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
