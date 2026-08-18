import { DensityMapScanner } from "./density-map-scanner.js?v=density-map-v1";
import { EXCHANGES, EXCHANGE_IDS } from "./exchange-registry.js?v=26-126-final-exchanges-v1";

export const DENSITY_MAP_WIDGET_VERSION = "density-map-widget-v1";

function compactUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(number >= 10_000_000_000 ? 0 : 1)}B`;
  if (number >= 1_000_000) return `$${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M`;
  if (number >= 1_000) return `$${(number / 1_000).toFixed(number >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(number)}`;
}

function durationLabel(value) {
  const seconds = Math.max(0, Math.floor(Number(value) / 1_000));
  if (seconds < 60) return `${seconds}с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  return `${Math.floor(minutes / 60)}ч ${minutes % 60}м`;
}

function priceLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number >= 1_000) return number.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (number >= 1) return number.toLocaleString("en-US", { maximumFractionDigits: 5 });
  return number.toLocaleString("en-US", { maximumSignificantDigits: 6 });
}

function percentLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number >= 0 ? "+" : ""}${number.toFixed(Math.abs(number) < 0.1 ? 3 : 2)}%`;
}

export class DensityMapWidget {
  constructor({
    root,
    model,
    onOpen = () => {},
    onClose = () => {},
    onPersist = () => {},
    scannerOptions = {},
  } = {}) {
    if (!root) throw new Error("DensityMapWidget requires root");
    this.root = root;
    this.model = model;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.onPersist = onPersist;
    this.latest = null;
    this.paused = false;
    this.entries = new Map();
    this.lastListRenderAt = 0;
    this.root.classList.add("density-map-card");
    this.root.innerHTML = `
      <header class="density-map-heading">
        <div class="density-map-title">
          <svg class="density-map-pulse" viewBox="0 0 42 18" aria-hidden="true"><path d="M1 10h8l3-6 5 12 5-10 4 4h15"/></svg>
          <div><strong>КАРТА ПЛОТНОСТЕЙ</strong><span>ВСЕ БИРЖИ · ВСЕ USDT-РЫНКИ</span></div>
        </div>
        <span class="density-map-progress" data-density-progress>ПОДГОТОВКА</span>
        <button class="density-map-pause" data-density-pause type="button">ПАУЗА</button>
        <button class="panel-close" data-density-close type="button" title="Закрыть карту плотностей" aria-label="Закрыть карту плотностей">×</button>
      </header>
      <div class="density-map-controls">
        <label><span>ПЛОТНОСТЬ ОТ</span><div><b>$</b><input data-density-size type="number" min="1000" step="10000" inputmode="decimal" /></div></label>
        <label><span>ВРЕМЯ ЖИЗНИ ОТ</span><div><input data-density-life type="number" min="0" max="86400" step="5" inputmode="numeric" /><b>СЕК</b></div></label>
        <div class="density-map-scope"><b>${EXCHANGE_IDS.length}</b><span>БИРЖ</span><i></i><b>SPOT</b><b>FUTURES</b></div>
      </div>
      <div class="density-map-summary" aria-live="polite">
        <span><b data-density-found>0</b><small>ПОДХОДЯТ</small></span>
        <span><b data-density-watch>0</b><small>НАБЛЮДАЮ</small></span>
        <span><b data-density-live>0</b><small>LIVE СТАКАНОВ</small></span>
        <span><b data-density-cycle>0%</b><small>ТЕКУЩИЙ ОБХОД</small></span>
      </div>
      <div class="density-map-columns" aria-hidden="true"><span>Монета / биржа</span><span>Сторона</span><span>Размер</span><span>Жизнь</span><span>От цены</span><span>Цена</span></div>
      <div class="density-map-list" data-density-list><div class="density-map-empty"><strong>Собираю список рынков…</strong><span>После первого найденного крупного уровня включится LIVE-наблюдение.</span></div></div>
      <div class="density-map-foot"><span data-density-foot>Ожидаю данные бирж</span><span>ГЛУБИНА · ДО 100 УРОВНЕЙ</span></div>
      <button class="panel-resizer" type="button" aria-label="Изменить размер карты плотностей"></button>
      <button class="panel-resizer panel-resizer-nw" type="button" aria-label="Изменить размер карты плотностей из левого верхнего угла"></button>`;
    this.sizeInput = root.querySelector("[data-density-size]");
    this.lifeInput = root.querySelector("[data-density-life]");
    this.list = root.querySelector("[data-density-list]");
    this.sizeInput.value = String(Math.round(Number(model.minQuote) || 100_000));
    this.lifeInput.value = String(Math.round((Number(model.minLifetimeMs) || 0) / 1_000));
    this.scanner = new DensityMapScanner({
      minQuote: Number(this.sizeInput.value),
      minLifetimeMs: Number(this.lifeInput.value) * 1_000,
      onUpdate: (snapshot) => {
        this.latest = snapshot;
        this.render();
      },
      ...scannerOptions,
    });
    this.#bind();
    this.clock = setInterval(() => this.render(true), 1_000);
    this.scanner.start();
  }

  render(forceList = false) {
    const snapshot = this.scanner.snapshot();
    const { stats, entries } = snapshot;
    this.entries = new Map(entries.map((entry) => [entry.id, entry]));
    const progress = this.root.querySelector("[data-density-progress]");
    if (stats.phase === "paused") progress.textContent = "ПАУЗА";
    else if (stats.phase === "loading") progress.textContent = `БИРЖИ ${stats.sourceComplete}/${stats.sourceTotal}`;
    else progress.textContent = `ОБХОД ${Math.min(stats.cursor + 1, stats.universeTotal)}/${stats.universeTotal}`;
    progress.dataset.state = stats.phase;
    this.root.querySelector("[data-density-found]").textContent = String(stats.matches);
    this.root.querySelector("[data-density-watch]").textContent = String(stats.candidates);
    this.root.querySelector("[data-density-live]").textContent = String(stats.liveMarkets);
    const cyclePercent = stats.universeTotal ? Math.round((stats.cursor / stats.universeTotal) * 100) : 0;
    this.root.querySelector("[data-density-cycle]").textContent = `${cyclePercent}%`;
    const foot = this.root.querySelector("[data-density-foot]");
    foot.textContent = stats.phase === "loading"
      ? `Загружено источников: ${stats.sourceComplete}; недоступно: ${stats.sourceFailed}`
      : `Цикл ${stats.cycle + 1} · проверено ${stats.scanned.toLocaleString("ru-RU")} · ошибок ${stats.requestFailures}`;
    const now = Date.now();
    if (forceList || now - this.lastListRenderAt >= 400) {
      this.lastListRenderAt = now;
      this.#renderEntries(entries, stats);
    }
  }

  destroy() {
    clearInterval(this.clock);
    this.scanner.destroy();
  }

  #bind() {
    const applyFilters = () => {
      const minQuote = Math.max(1_000, Number(this.sizeInput.value) || 100_000);
      const minLifetimeMs = Math.max(0, Number(this.lifeInput.value) || 0) * 1_000;
      this.model.minQuote = minQuote;
      this.model.minLifetimeMs = minLifetimeMs;
      this.sizeInput.value = String(Math.round(minQuote));
      this.lifeInput.value = String(Math.round(minLifetimeMs / 1_000));
      this.scanner.setFilters({ minQuote, minLifetimeMs });
      this.onPersist();
    };
    this.sizeInput.addEventListener("change", applyFilters);
    this.lifeInput.addEventListener("change", applyFilters);
    this.root.querySelector("[data-density-pause]").addEventListener("click", (event) => {
      event.stopPropagation();
      this.paused = !this.paused;
      event.currentTarget.textContent = this.paused ? "ПРОДОЛЖИТЬ" : "ПАУЗА";
      event.currentTarget.classList.toggle("is-paused", this.paused);
      this.scanner.setPaused(this.paused);
    });
    this.root.querySelector("[data-density-close]").addEventListener("click", () => this.onClose());
    this.list.addEventListener("click", (event) => {
      const row = event.target.closest("[data-density-id]");
      const entry = this.entries.get(row?.dataset.densityId);
      if (entry) this.onOpen(entry);
    });
  }

  #renderEntries(entries, stats) {
    if (!entries.length) {
      const title = stats.phase === "loading"
        ? "Собираю список рынков…"
        : stats.candidates
          ? "Плотности ещё набирают время жизни"
          : "Под заданные условия плотностей пока нет";
      const detail = stats.phase === "loading"
        ? "Подключаю публичные рынки всех бирж."
        : `Минимум ${compactUsd(this.scanner.filters.minQuote)} · ${durationLabel(this.scanner.filters.minLifetimeMs)}.`;
      const empty = document.createElement("div");
      empty.className = "density-map-empty";
      const strong = document.createElement("strong");
      const span = document.createElement("span");
      strong.textContent = title;
      span.textContent = detail;
      empty.append(strong, span);
      this.list.replaceChildren(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of entries.slice(0, 250)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `density-map-row is-${entry.side}`;
      row.dataset.densityId = entry.id;
      row.title = `Открыть ${entry.symbol} на ${EXCHANGES[entry.exchange]?.label ?? entry.exchange.toUpperCase()}`;
      const market = entry.market === "spot" ? "SPOT" : "FUTURES";
      const exchange = EXCHANGES[entry.exchange]?.label ?? entry.exchange.toUpperCase();
      const cells = [
        ["density-map-market", entry.symbol.replace("USDT", ""), `${exchange} · ${market}`],
        ["density-map-side", entry.side === "bid" ? "BID" : "ASK", entry.side === "bid" ? "ПОКУПКА" : "ПРОДАЖА"],
        ["density-map-quote", compactUsd(entry.quote), `MAX ${compactUsd(entry.maxQuote)}`],
        ["density-map-life", durationLabel(entry.lifetimeMs), "ПОДТВЕРЖДЕНО"],
        ["density-map-distance", percentLabel(entry.distancePercent), "ОТ MID"],
        ["density-map-price", priceLabel(entry.price), ""],
      ];
      for (const [className, main, sub] of cells) {
        const cell = document.createElement("span");
        cell.className = className;
        const strong = document.createElement("strong");
        strong.textContent = main;
        cell.append(strong);
        if (sub) {
          const small = document.createElement("small");
          small.textContent = sub;
          cell.append(small);
        }
        row.append(cell);
      }
      fragment.append(row);
    }
    this.list.replaceChildren(fragment);
  }
}
