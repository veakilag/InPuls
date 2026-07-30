export const EVENT_RADAR_BETA_VERSION = "event-radar-beta-v1";

const STORAGE_KEY = "inpuls-event-radar-beta-v1";
const UPDATE_EVENT = "inpuls:event-radar-update";
const SELECT_EVENT = "inpuls:event-radar-select";
const FAVORITE_EVENT = "inpuls:event-radar-favorite";
const ACTIVE_GRACE_MS = 1_800;
const RESET_GAP_MS = 4_000;
const RETENTION_MS = 90_000;
const PINNED_RETENTION_MS = 10 * 60_000;

const FILTERS = Object.freeze([
  ["all", "Все"],
  ["movement", "Движение"],
  ["reversal", "Разворот"],
  ["breakout", "Пробой"],
  ["cascade", "Каскад"],
  ["algorithm", "Алгоритмы"],
  ["favorites", "★"],
]);

const GROUP_BY_TYPE = Object.freeze({
  impulse: "movement",
  knife: "reversal",
  sharpening: "reversal",
  breakout_resistance: "breakout",
  breakout_support: "breakout",
  liquidation_cascade: "cascade",
  cascade: "cascade",
  rearranger: "algorithm",
  size_supporter: "algorithm",
});

const STATUS_ORDER = Object.freeze({ new: 0, active: 1, weakening: 2, finished: 3 });

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function loadState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char]);
}

function formatPercent(value) {
  const numeric = finite(value);
  if (numeric === null) return "—";
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(Math.abs(numeric) >= 10 ? 1 : 2)}%`;
}

function formatAge(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  if (seconds < 60) return `${seconds}с`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}м` : `${Math.floor(minutes / 60)}ч`;
}

function formatFlow(entry) {
  const share = finite(entry.buyShare);
  if (share === null) return "—";
  const rounded = Math.round(share);
  return entry.direction === "down" ? `SELL ${100 - rounded}%` : `BUY ${rounded}%`;
}

function formatBoost(value) {
  const numeric = finite(value);
  return numeric === null ? "—" : `×${numeric.toFixed(1)}`;
}

function normalizeSignal(signal) {
  if (!signal || typeof signal !== "object" || !signal.type) return null;
  return {
    type: String(signal.type),
    label: String(signal.label || signal.type),
    direction: signal.direction === "down" ? "down" : "up",
    reason: String(signal.reason || "Событие обнаружено по текущей формуле"),
    priority: finite(signal.priority) ?? 0,
  };
}

export function eventRadarGroup(type) {
  return GROUP_BY_TYPE[String(type || "")] || "other";
}

export function eventRadarDataState(entry, now = Date.now()) {
  const updatedAge = now - (finite(entry?.updatedAt) ?? 0);
  if (updatedAge > 5_000) return "stale";
  const tradeAge = now - (finite(entry?.lastTradeAt) ?? 0);
  return tradeAge <= 3_000 ? "live" : "light";
}

export function eventRadarStatus(entry, now = Date.now()) {
  if (!entry || now - entry.lastSeen > ACTIVE_GRACE_MS) return "finished";
  if (now - entry.firstSeen <= 8_000) return "new";
  const scoreWeakening = finite(entry.score) !== null && finite(entry.peakScore) !== null && entry.score <= entry.peakScore - 12;
  const boostWeakening = finite(entry.volumeBoost) !== null && finite(entry.peakBoost) !== null && entry.peakBoost >= 2 && entry.volumeBoost <= entry.peakBoost * 0.6;
  return scoreWeakening || boostWeakening ? "weakening" : "active";
}

export function mergeEventRadarEntries(store, metrics, now = Date.now()) {
  const entries = store instanceof Map ? store : new Map();
  const seen = new Set();
  for (const metric of Array.isArray(metrics) ? metrics : []) {
    const symbol = String(metric?.symbol || "").toUpperCase();
    if (!symbol) continue;
    const uniqueSignals = new Map();
    for (const rawSignal of Array.isArray(metric?.signals) ? metric.signals : []) {
      const signal = normalizeSignal(rawSignal);
      if (!signal) continue;
      uniqueSignals.set(`${signal.type}:${signal.direction}`, signal);
    }
    for (const signal of uniqueSignals.values()) {
      const key = `${symbol}:${signal.type}:${signal.direction}`;
      const previous = entries.get(key);
      const restarted = previous && now - previous.lastSeen > RESET_GAP_MS;
      const score = finite(metric.score) ?? signal.priority;
      const boost = finite(metric.volumeBoost);
      const entry = previous && !restarted ? previous : {
        key,
        symbol,
        type: signal.type,
        group: eventRadarGroup(signal.type),
        direction: signal.direction,
        firstSeen: now,
        lastSeen: now,
        peakScore: score,
        peakBoost: boost,
      };
      Object.assign(entry, {
        label: signal.label,
        reason: signal.reason,
        direction: signal.direction,
        group: eventRadarGroup(signal.type),
        lastSeen: now,
        updatedAt: finite(metric.updatedAt),
        lastTradeAt: finite(metric.lastTradeAt),
        change15s: finite(metric.change15s),
        change1m: finite(metric.change1m),
        volumeBoost: boost,
        tps: finite(metric?.trades?.tps),
        buyShare: finite(metric?.trades?.buyShare),
        score,
      });
      entry.peakScore = Math.max(finite(entry.peakScore) ?? score, score);
      if (boost !== null) entry.peakBoost = Math.max(finite(entry.peakBoost) ?? boost, boost);
      entries.set(key, entry);
      seen.add(key);
    }
  }
  return { entries, seen };
}

class EventRadarBetaWidget {
  constructor() {
    this.saved = loadState();
    this.entries = new Map();
    this.favorites = new Set();
    this.pinned = new Set(Array.isArray(this.saved.pinned) ? this.saved.pinned : []);
    this.filter = typeof this.saved.filter === "string" ? this.saved.filter : "all";
    this.frozen = false;
    this.frozenKeys = null;
    this.unseenWhileFrozen = new Set();
    this.now = Date.now();
    this.panel = null;
    this.list = null;
    this.toggle = null;
    this.newCounter = null;
    this.resizeObserver = null;
    this.mount();
  }

  mount() {
    this.toggle = document.querySelector("#event-radar-beta-toggle");
    if (!this.toggle) return;
    const panel = document.createElement("section");
    panel.id = "event-radar-beta";
    panel.className = "event-radar-beta";
    panel.setAttribute("aria-label", "Событийный радар BETA");
    panel.innerHTML = `
      <header class="event-radar-beta__heading">
        <span class="event-radar-beta__grip" aria-hidden="true">⠿</span>
        <div><strong>СОБЫТИЙНЫЙ РАДАР</strong><small>BETA · старые блоки не заменяет</small></div>
        <span class="event-radar-beta__new" hidden></span>
        <button data-event-freeze type="button" title="Заморозить список">ПАУЗА</button>
        <button data-event-close type="button" title="Закрыть" aria-label="Закрыть">×</button>
      </header>
      <div class="event-radar-beta__filters" role="group" aria-label="Фильтр событий">
        ${FILTERS.map(([value, label]) => `<button data-event-filter="${value}" type="button">${label}</button>`).join("")}
      </div>
      <div class="event-radar-beta__columns" aria-hidden="true"><span>Событие</span><span>15с / 1м</span><span>Поток</span><span>Приоритет</span></div>
      <div class="event-radar-beta__list" aria-live="polite"></div>
      <footer>Нажатие: график + стакан · это наблюдение, не команда на вход</footer>`;
    document.body.append(panel);
    this.panel = panel;
    this.list = panel.querySelector(".event-radar-beta__list");
    this.newCounter = panel.querySelector(".event-radar-beta__new");
    this.applyGeometry();
    this.setVisible(this.saved.visible !== false, false);
    this.syncFilters();
    this.bindDrag(panel.querySelector(".event-radar-beta__heading"));
    panel.querySelector("[data-event-close]").addEventListener("click", () => this.setVisible(false));
    panel.querySelector("[data-event-freeze]").addEventListener("click", () => this.toggleFreeze());
    panel.querySelectorAll("[data-event-filter]").forEach((button) => button.addEventListener("click", () => {
      this.filter = button.dataset.eventFilter;
      this.persist();
      this.syncFilters();
      this.render();
    }));
    this.toggle.addEventListener("click", () => this.setVisible(this.panel.hidden));
    window.addEventListener(UPDATE_EVENT, (event) => this.ingest(event.detail));
    window.addEventListener("resize", () => this.clampGeometry());
    this.resizeObserver = new ResizeObserver(() => this.persistGeometry());
    this.resizeObserver.observe(panel);
  }

  applyGeometry() {
    const width = Math.max(520, finite(this.saved.width) ?? 720);
    const height = Math.max(320, finite(this.saved.height) ?? 520);
    const left = finite(this.saved.left) ?? Math.max(12, window.innerWidth - width - 12);
    const top = finite(this.saved.top) ?? 58;
    Object.assign(this.panel.style, {
      width: `${Math.min(width, window.innerWidth - 8)}px`,
      height: `${Math.min(height, window.innerHeight - 56)}px`,
      left: `${left}px`,
      top: `${top}px`,
    });
    this.clampGeometry();
  }

  clampGeometry() {
    if (!this.panel || matchMedia("(max-width: 760px)").matches) return;
    const rect = this.panel.getBoundingClientRect();
    const left = Math.max(4, Math.min(window.innerWidth - Math.min(rect.width, window.innerWidth - 8) - 4, rect.left));
    const top = Math.max(50, Math.min(window.innerHeight - Math.min(rect.height, window.innerHeight - 54) - 4, rect.top));
    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${top}px`;
    this.persistGeometry();
  }

  bindDrag(handle) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      if (matchMedia("(max-width: 760px)").matches) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const rect = this.panel.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      const move = (moveEvent) => {
        this.panel.style.left = `${start.left + moveEvent.clientX - start.x}px`;
        this.panel.style.top = `${start.top + moveEvent.clientY - start.y}px`;
      };
      const stop = () => {
        this.clampGeometry();
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
  }

  ingest(detail = {}) {
    this.now = finite(detail.now) ?? Date.now();
    this.favorites = new Set(Array.isArray(detail.favorites) ? detail.favorites : []);
    const before = new Set(this.entries.keys());
    const merged = mergeEventRadarEntries(this.entries, detail.metrics, this.now);
    this.entries = merged.entries;
    if (this.frozen && this.frozenKeys) {
      for (const key of merged.seen) {
        if (!this.frozenKeys.includes(key) && !before.has(key)) this.unseenWhileFrozen.add(key);
      }
    }
    for (const [key, entry] of this.entries) {
      const retention = this.pinned.has(key) ? PINNED_RETENTION_MS : RETENTION_MS;
      if (this.now - entry.lastSeen > retention) {
        this.entries.delete(key);
        this.pinned.delete(key);
      }
    }
    this.render();
  }

  toggleFreeze() {
    this.frozen = !this.frozen;
    const button = this.panel.querySelector("[data-event-freeze]");
    if (this.frozen) {
      this.frozenKeys = this.sortedEntries().map((entry) => entry.key);
      this.unseenWhileFrozen.clear();
    } else {
      this.frozenKeys = null;
      this.unseenWhileFrozen.clear();
    }
    button.classList.toggle("is-active", this.frozen);
    button.textContent = this.frozen ? "ПРОДОЛЖИТЬ" : "ПАУЗА";
    this.syncNewCounter();
    this.render();
  }

  setVisible(visible, persist = true) {
    if (!this.panel) return;
    this.panel.hidden = !visible;
    this.toggle.classList.toggle("is-active", visible);
    this.toggle.setAttribute("aria-pressed", String(visible));
    if (persist) this.persist();
  }

  persistGeometry() {
    if (!this.panel || matchMedia("(max-width: 760px)").matches) return;
    const rect = this.panel.getBoundingClientRect();
    this.saved.left = Math.round(rect.left);
    this.saved.top = Math.round(rect.top);
    this.saved.width = Math.round(rect.width);
    this.saved.height = Math.round(rect.height);
    this.persist();
  }

  persist() {
    if (!this.panel) return;
    this.saved.visible = !this.panel.hidden;
    this.saved.filter = this.filter;
    this.saved.pinned = [...this.pinned];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved));
  }

  syncFilters() {
    this.panel.querySelectorAll("[data-event-filter]").forEach((button) => button.classList.toggle("is-active", button.dataset.eventFilter === this.filter));
  }

  syncNewCounter() {
    const count = this.unseenWhileFrozen.size;
    this.newCounter.hidden = !count;
    this.newCounter.textContent = count ? `+${count} новых` : "";
  }

  sortedEntries() {
    const source = this.frozen && this.frozenKeys
      ? this.frozenKeys.map((key) => this.entries.get(key)).filter(Boolean)
      : [...this.entries.values()];
    return source
      .filter((entry) => {
        if (this.filter === "favorites") return this.favorites.has(entry.symbol);
        return this.filter === "all" || entry.group === this.filter;
      })
      .sort((left, right) => {
        const pinned = Number(this.pinned.has(right.key)) - Number(this.pinned.has(left.key));
        if (pinned) return pinned;
        const status = STATUS_ORDER[eventRadarStatus(left, this.now)] - STATUS_ORDER[eventRadarStatus(right, this.now)];
        return status || right.firstSeen - left.firstSeen || right.score - left.score;
      });
  }

  render() {
    if (!this.list) return;
    this.syncNewCounter();
    const entries = this.sortedEntries().slice(0, 80);
    if (!entries.length) {
      this.list.innerHTML = `<div class="event-radar-beta__empty"><strong>Свежих событий пока нет</strong><span>Радар получает только реальные сигналы текущего main.</span></div>`;
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of entries) fragment.append(this.createRow(entry));
    this.list.replaceChildren(fragment);
  }

  createRow(entry) {
    const status = eventRadarStatus(entry, this.now);
    const dataState = eventRadarDataState(entry, this.now);
    const row = document.createElement("article");
    row.className = `event-radar-beta__row direction-${entry.direction} status-${status}`;
    row.dataset.symbol = entry.symbol;
    row.tabIndex = 0;
    row.innerHTML = `
      <div class="event-radar-beta__event">
        <span class="event-radar-beta__ticker">${escapeHtml(entry.symbol.replace("USDT", ""))}<small>/USDT</small></span>
        <span class="event-radar-beta__signal">${entry.direction === "down" ? "↓" : "↑"} ${escapeHtml(entry.label)}</span>
        <span class="event-radar-beta__meta"><b class="status-${status}">${status === "new" ? "НОВОЕ" : status === "active" ? "АКТИВНО" : status === "weakening" ? "ОСЛАБЕВАЕТ" : "ЗАВЕРШЕНО"}</b><time>${formatAge(this.now - entry.firstSeen)}</time><i class="data-${dataState}">${dataState.toUpperCase()}</i></span>
      </div>
      <div class="event-radar-beta__moves"><strong class="${entry.change15s > 0 ? "tone-up" : entry.change15s < 0 ? "tone-down" : "tone-neutral"}">${formatPercent(entry.change15s)}</strong><span>${formatPercent(entry.change1m)}</span></div>
      <div class="event-radar-beta__flow"><strong>${formatBoost(entry.volumeBoost)}</strong><span>${finite(entry.tps) === null ? "—" : `${Math.round(entry.tps)} сд/с`}</span><small>${formatFlow(entry)}</small></div>
      <div class="event-radar-beta__score"><strong>${Math.round(entry.score)}</strong><span>приоритет</span></div>
      <p>${escapeHtml(entry.reason)}</p>
      <div class="event-radar-beta__actions">
        <button data-event-pin type="button" class="${this.pinned.has(entry.key) ? "is-active" : ""}" title="Закрепить">⌖</button>
        <button data-event-favorite type="button" class="${this.favorites.has(entry.symbol) ? "is-active" : ""}" title="Избранное">★</button>
      </div>`;
    const select = () => window.dispatchEvent(new CustomEvent(SELECT_EVENT, { detail: { symbol: entry.symbol, openOrderBook: true } }));
    row.addEventListener("click", select);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    row.querySelector("[data-event-pin]").addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.pinned.has(entry.key)) this.pinned.delete(entry.key);
      else this.pinned.add(entry.key);
      this.persist();
      this.render();
    });
    row.querySelector("[data-event-favorite]").addEventListener("click", (event) => {
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent(FAVORITE_EVENT, { detail: { symbol: entry.symbol } }));
    });
    return row;
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  new EventRadarBetaWidget();
}
