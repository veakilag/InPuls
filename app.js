import {
  DEFAULT_SETTINGS,
  SymbolState,
  filterUsdtPerpetualTicker,
  formatCompactUsd,
} from "./engine.js";

const STORAGE_KEYS = {
  settings: "inpuls-settings-v1",
  favorites: "inpuls-favorites-v1",
  sound: "inpuls-sound-v1",
};

const state = {
  symbols: new Map(),
  settings: loadJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
  favorites: new Set(loadJson(STORAGE_KEYS.favorites, [])),
  soundEnabled: loadJson(STORAGE_KEYS.sound, false),
  filter: "all",
  search: "",
  selectedSymbol: null,
  lastMetrics: [],
  alerts: [],
  connectedAt: null,
};

const els = {
  status: document.querySelector("#connection-status"),
  statusText: document.querySelector("#connection-text"),
  clock: document.querySelector("#clock"),
  soundButton: document.querySelector("#sound-toggle"),
  settingsButton: document.querySelector("#settings-open"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  settingsReset: document.querySelector("#settings-reset"),
  search: document.querySelector("#search"),
  tableBody: document.querySelector("#market-body"),
  tableWrap: document.querySelector("#table-wrap"),
  empty: document.querySelector("#empty-state"),
  marketPulse: document.querySelector("#market-pulse"),
  hotCount: document.querySelector("#hot-count"),
  alertCount: document.querySelector("#alert-count"),
  trackedCount: document.querySelector("#tracked-count"),
  warmup: document.querySelector("#warmup"),
  filterButtons: [...document.querySelectorAll("[data-filter]")],
  detail: document.querySelector("#detail-drawer"),
  detailClose: document.querySelector("#detail-close"),
  detailContent: document.querySelector("#detail-content"),
  tbodyTemplate: document.querySelector("#row-template"),
  installButton: document.querySelector("#install-app"),
};

class BinanceFeed {
  constructor() {
    this.socket = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.trackedAggTrades = new Set();
    this.requestId = 1;
    this.manualClose = false;
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    this.manualClose = false;
    setConnection("connecting", "Подключение к Binance…");
    const endpoint = this.reconnectAttempt % 2 === 0
      ? "wss://fstream.binance.com/market/stream"
      : "wss://stream.binancefuture.com/market/stream";
    this.socket = new WebSocket(endpoint);

    this.socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      state.connectedAt = Date.now();
      setConnection("online", "Онлайн");
      this.#send("SUBSCRIBE", ["!miniTicker@arr", "!forceOrder@arr"]);
      if (this.trackedAggTrades.size) {
        this.#send("SUBSCRIBE", [...this.trackedAggTrades].map((symbol) => `${symbol.toLowerCase()}@aggTrade`));
      }
    });

    this.socket.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.result === null || payload.id) return;
      const data = payload.data ?? payload;
      this.#handle(data);
    });

    this.socket.addEventListener("close", () => {
      if (this.manualClose) return;
      this.reconnectAttempt += 1;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
      setConnection("offline", `Переподключение через ${Math.round(delay / 1000)}с`);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });

    this.socket.addEventListener("error", () => {
      setConnection("offline", "Ошибка потока");
    });
  }

  updateAggTradeSubscriptions(symbols) {
    const next = new Set(symbols);
    const subscribe = [...next].filter((symbol) => !this.trackedAggTrades.has(symbol));
    const unsubscribe = [...this.trackedAggTrades].filter((symbol) => !next.has(symbol));
    this.trackedAggTrades = next;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (unsubscribe.length) this.#send("UNSUBSCRIBE", unsubscribe.map((symbol) => `${symbol.toLowerCase()}@aggTrade`));
    if (subscribe.length) this.#send("SUBSCRIBE", subscribe.map((symbol) => `${symbol.toLowerCase()}@aggTrade`));
  }

  #send(method, params) {
    if (this.socket?.readyState !== WebSocket.OPEN || !params.length) return;
    this.socket.send(JSON.stringify({ method, params, id: String(this.requestId++) }));
  }

  #handle(data) {
    if (Array.isArray(data)) {
      for (const ticker of data) {
        if (!filterUsdtPerpetualTicker(ticker)) continue;
        getSymbol(ticker.s, Number(ticker.E) || Date.now()).updateTicker(ticker);
      }
      return;
    }
    if (!data || typeof data !== "object") return;
    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data)) {
      getSymbol(data.s).updateTrade(data);
      return;
    }
    if (data.e === "forceOrder") {
      const symbol = data.o?.s;
      if (symbol?.endsWith("USDT") && (data.st === undefined || Number(data.st) === 1)) {
        getSymbol(symbol).updateLiquidation(data);
      }
    }
  }
}

const feed = new BinanceFeed();

function getSymbol(symbol, now) {
  if (!state.symbols.has(symbol)) state.symbols.set(symbol, new SymbolState(symbol, now));
  return state.symbols.get(symbol);
}

function getMetrics(now = Date.now()) {
  return [...state.symbols.values()]
    .filter((item) => item.quoteVolume24h >= state.settings.minTurnover24h)
    .map((item) => item.metrics(state.settings, now))
    .sort((a, b) => {
      const favoriteDiff = Number(state.favorites.has(b.symbol)) - Number(state.favorites.has(a.symbol));
      return favoriteDiff || b.score - a.score || (b.turnoverPerMinute || 0) - (a.turnoverPerMinute || 0);
    });
}

function render() {
  const now = Date.now();
  const metrics = getMetrics(now);
  state.lastMetrics = metrics;
  updateAlerts(metrics, now);

  const filtered = metrics.filter((item) => {
    const queryMatch = !state.search || item.symbol.toLowerCase().includes(state.search);
    if (!queryMatch) return false;
    if (state.filter === "favorites") return state.favorites.has(item.symbol);
    if (state.filter === "signals") return Boolean(item.primarySignal);
    if (state.filter !== "all") return item.signals.some((signal) => signal.type === state.filter);
    return true;
  }).slice(0, state.settings.maxRows);

  const fragment = document.createDocumentFragment();
  for (const item of filtered) fragment.append(createRow(item));
  els.tableBody.replaceChildren(fragment);
  els.empty.hidden = filtered.length > 0;
  els.tableWrap.classList.toggle("is-empty", filtered.length === 0);

  renderSummary(metrics, now);
  if (state.selectedSymbol) renderDetail(state.selectedSymbol);
}

function createRow(item) {
  const row = els.tbodyTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.symbol = item.symbol;
  row.classList.toggle("has-signal", Boolean(item.primarySignal));
  row.classList.toggle("is-hot", item.score >= state.settings.alertScore);

  const favorite = row.querySelector(".favorite-button");
  favorite.classList.toggle("is-active", state.favorites.has(item.symbol));
  favorite.setAttribute("aria-label", `${state.favorites.has(item.symbol) ? "Убрать" : "Добавить"} ${item.symbol} ${state.favorites.has(item.symbol) ? "из" : "в"} избранное`);
  favorite.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(item.symbol);
  });

  row.querySelector(".pair-name").textContent = item.symbol.replace("USDT", "");
  row.querySelector(".pair-quote").textContent = "/USDT";
  row.querySelector(".price").textContent = formatPrice(item.price);
  setChange(row.querySelector(".change-15s"), item.change15s);
  setChange(row.querySelector(".change-1m"), item.change1m);
  setChange(row.querySelector(".change-5m"), item.change5m);
  row.querySelector(".turnover").textContent = formatCompactUsd(item.turnoverPerMinute);
  row.querySelector(".volume-boost").textContent = item.volumeBoost === null ? "разогрев" : `×${item.volumeBoost.toFixed(1)}`;
  row.querySelector(".tps").textContent = item.trades.tps > 0 ? Math.round(item.trades.tps).toLocaleString("ru-RU") : "—";
  renderFlow(row.querySelector(".flow"), item.trades.buyShare);
  renderSignal(row.querySelector(".signal-cell"), item);
  row.querySelector(".score-value").textContent = item.score;
  row.querySelector(".score-ring").style.setProperty("--score", `${item.score * 3.6}deg`);
  row.addEventListener("click", () => openDetail(item.symbol));
  return row;
}

function renderSignal(container, item) {
  if (!item.primarySignal) {
    container.innerHTML = `<span class="signal-muted">${item.warmupSeconds < 60 ? "Сбор истории" : "Наблюдение"}</span>`;
    return;
  }
  const signal = item.primarySignal;
  container.innerHTML = "";
  const badge = document.createElement("span");
  badge.className = `signal-badge signal-${signal.type} direction-${signal.direction}`;
  badge.textContent = signal.label;
  const reason = document.createElement("span");
  reason.className = "signal-reason";
  reason.textContent = signal.reason;
  container.append(badge, reason);
}

function renderFlow(container, buyShare) {
  if (buyShare === null) {
    container.innerHTML = '<span class="muted">—</span>';
    return;
  }
  const rounded = Math.round(buyShare);
  container.innerHTML = `
    <div class="flow-values"><span class="buy">${rounded}%</span><span class="sell">${100 - rounded}%</span></div>
    <div class="flow-bar"><span style="width:${rounded}%"></span></div>
  `;
}

function renderSummary(metrics, now) {
  const validMoves = metrics.map((item) => item.change1m).filter(Number.isFinite);
  const advancers = validMoves.filter((value) => value > 0).length;
  const pulse = validMoves.length ? Math.round((advancers / validMoves.length) * 100) : null;
  els.marketPulse.textContent = pulse === null ? "—" : `${pulse}%`;
  els.marketPulse.dataset.tone = pulse === null ? "neutral" : pulse >= 55 ? "up" : pulse <= 45 ? "down" : "neutral";
  els.hotCount.textContent = metrics.filter((item) => item.score >= state.settings.alertScore).length;
  els.alertCount.textContent = state.alerts.filter((item) => item.time >= now - 60_000).length;
  els.trackedCount.textContent = state.symbols.size;

  const oldest = metrics.reduce((min, item) => Math.max(min, item.warmupSeconds), 0);
  els.warmup.hidden = oldest >= 300;
  if (oldest < 300) els.warmup.querySelector("span").textContent = `История: ${Math.min(100, Math.round((oldest / 300) * 100))}%`;
}

function updateAlerts(metrics, now) {
  for (const metricsItem of metrics) {
    if (!metricsItem.primarySignal || metricsItem.score < state.settings.alertScore) continue;
    const symbol = state.symbols.get(metricsItem.symbol);
    if (!symbol || now - symbol.lastAlertAt < 45_000) continue;
    symbol.lastAlertAt = now;
    state.alerts.push({ time: now, symbol: metricsItem.symbol, type: metricsItem.primarySignal.type });
    if (state.soundEnabled) playAlert(metricsItem.primarySignal.direction, metricsItem.score);
  }
  state.alerts = state.alerts.filter((item) => item.time >= now - 10 * 60_000);
}

function renderDetail(symbol) {
  const item = state.lastMetrics.find((candidate) => candidate.symbol === symbol);
  if (!item) return;
  const chart = sparklineSvg(item.sparkline, item.change1m >= 0);
  const flow = item.trades.buyShare === null ? "Нет данных" : `${Math.round(item.trades.buyShare)}% покупок / ${Math.round(100 - item.trades.buyShare)}% продаж`;
  const signals = item.signals.length
    ? item.signals.map((signal) => `<li><span class="signal-badge signal-${signal.type}">${signal.label}</span><span>${escapeHtml(signal.reason)}</span></li>`).join("")
    : "<li><span>Условия сигналов пока не выполнены</span></li>";

  els.detailContent.innerHTML = `
    <div class="detail-heading">
      <div><span class="eyebrow">Binance Futures</span><h2>${item.symbol}</h2></div>
      <div class="detail-price">${formatPrice(item.price)} <span class="${toneClass(item.change1m)}">${formatChange(item.change1m)}</span></div>
    </div>
    <div class="detail-chart">${chart}</div>
    <div class="detail-grid">
      <div><span>15 секунд</span><strong class="${toneClass(item.change15s)}">${formatChange(item.change15s)}</strong></div>
      <div><span>1 минута</span><strong class="${toneClass(item.change1m)}">${formatChange(item.change1m)}</strong></div>
      <div><span>5 минут</span><strong class="${toneClass(item.change5m)}">${formatChange(item.change5m)}</strong></div>
      <div><span>Оборот/мин</span><strong>${formatCompactUsd(item.turnoverPerMinute)}</strong></div>
      <div><span>Ускорение</span><strong>${item.volumeBoost === null ? "Разогрев" : `×${item.volumeBoost.toFixed(1)}`}</strong></div>
      <div><span>Сделок/сек</span><strong>${item.trades.tps > 0 ? Math.round(item.trades.tps) : "—"}</strong></div>
      <div><span>Агрессия</span><strong>${flow}</strong></div>
      <div><span>Ликвидации 60с</span><strong>${formatCompactUsd(item.liquidation.total)}</strong></div>
    </div>
    <div class="detail-signals"><h3>Почему монета здесь</h3><ul>${signals}</ul></div>
    <div class="detail-actions">
      <a class="button button-primary" href="https://www.tradingview.com/chart/?symbol=BINANCE:${item.symbol}.P" target="_blank" rel="noopener">TradingView</a>
      <a class="button" href="https://www.binance.com/en/futures/${item.symbol}" target="_blank" rel="noopener">Binance</a>
    </div>
  `;
}

function sparklineSvg(values, positive) {
  if (!values || values.length < 2) return '<div class="chart-placeholder">График появится после накопления данных</div>';
  const width = 560;
  const height = 150;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 16) - 8;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const color = positive ? "#50e3a4" : "#ff6b7a";
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Движение цены"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>`;
}

function openDetail(symbol) {
  state.selectedSymbol = symbol;
  renderDetail(symbol);
  els.detail.classList.add("is-open");
  els.detail.setAttribute("aria-hidden", "false");
}

function closeDetail() {
  state.selectedSymbol = null;
  els.detail.classList.remove("is-open");
  els.detail.setAttribute("aria-hidden", "true");
}

function updateTrackedSymbols() {
  const candidates = [...state.symbols.values()]
    .filter((item) => item.quoteVolume24h >= state.settings.minTurnover24h)
    .map((item) => item.metrics(state.settings))
    .sort((a, b) => {
      const favoriteDiff = Number(state.favorites.has(b.symbol)) - Number(state.favorites.has(a.symbol));
      return favoriteDiff || b.score - a.score || b.turnoverPerMinute - a.turnoverPerMinute;
    })
    .slice(0, state.settings.trackedTrades)
    .map((item) => item.symbol);
  feed.updateAggTradeSubscriptions(candidates);
}

function toggleFavorite(symbol) {
  if (state.favorites.has(symbol)) state.favorites.delete(symbol);
  else state.favorites.add(symbol);
  localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify([...state.favorites]));
  render();
}

function setConnection(status, text) {
  els.status.dataset.status = status;
  els.statusText.textContent = text;
}

function setChange(element, value) {
  element.textContent = formatChange(value);
  element.classList.remove("tone-up", "tone-down", "tone-neutral");
  element.classList.add(toneClass(value));
}

function formatChange(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}%`;
}

function toneClass(value) {
  if (!Number.isFinite(value) || value === 0) return "tone-neutral";
  return value > 0 ? "tone-up" : "tone-down";
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (value >= 0.01) return value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  return value.toPrecision(5);
}

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (value === null) return structuredClone(fallback);
    if (Array.isArray(fallback)) return Array.isArray(value) ? value : structuredClone(fallback);
    if (typeof fallback === "boolean") return typeof value === "boolean" ? value : fallback;
    if (typeof fallback === "object") return { ...structuredClone(fallback), ...value };
    return value;
  } catch {
    return structuredClone(fallback);
  }
}

let audioContext;
function playAlert(direction, score) {
  audioContext ||= new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(direction === "up" ? 720 : 420, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(direction === "up" ? 1050 : 260, audioContext.currentTime + 0.12);
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(Math.min(0.16, score / 600), audioContext.currentTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.18);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.2);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function bindEvents() {
  els.soundButton.classList.toggle("is-active", state.soundEnabled);
  els.soundButton.querySelector("span").textContent = state.soundEnabled ? "Звук включён" : "Звук выключен";
  els.soundButton.addEventListener("click", async () => {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem(STORAGE_KEYS.sound, JSON.stringify(state.soundEnabled));
    els.soundButton.classList.toggle("is-active", state.soundEnabled);
    els.soundButton.querySelector("span").textContent = state.soundEnabled ? "Звук включён" : "Звук выключен";
    if (state.soundEnabled) playAlert("up", 55);
  });

  els.search.addEventListener("input", () => {
    state.search = els.search.value.trim().toLowerCase();
    render();
  });

  for (const button of els.filterButtons) {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      els.filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      render();
    });
  }

  els.settingsButton.addEventListener("click", () => {
    for (const [key, value] of Object.entries(state.settings)) {
      const input = els.settingsForm.elements.namedItem(key);
      if (input) input.value = value;
    }
    els.settingsDialog.showModal();
  });
  els.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(els.settingsForm);
    const next = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(next)) next[key] = Number(formData.get(key));
    state.settings = next;
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
    els.settingsDialog.close();
    updateTrackedSymbols();
    render();
  });
  els.settingsReset.addEventListener("click", () => {
    state.settings = { ...DEFAULT_SETTINGS };
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
    els.settingsDialog.close();
    render();
  });
  document.querySelector("#settings-close").addEventListener("click", () => els.settingsDialog.close());
  els.detailClose.addEventListener("click", closeDetail);
  document.querySelector("#detail-backdrop").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selectedSymbol) closeDetail();
  });
}

let deferredInstallPrompt;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  els.installButton.hidden = false;
});
els.installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installButton.hidden = true;
});

bindEvents();
feed.connect();
setInterval(render, 1000);
setInterval(updateTrackedSymbols, 15_000);
setInterval(() => {
  els.clock.textContent = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}, 1000);
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
