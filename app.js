import {
  DEFAULT_SETTINGS,
  SymbolState,
  filterUsdtPerpetualTicker,
  formatCompactUsd,
} from "./engine.js?v=17";
import { calculateNatr, CandlestickChart, KlineFeed, parseRestKline, pearsonCorrelation } from "./chart.js?v=17";
import { OrderBookFeed } from "./orderbook.js?v=17";

const STORAGE_KEYS = {
  settings: "inpuls-settings-v1",
  favorites: "inpuls-favorites-v1",
  sound: "inpuls-sound-v1",
  chart: "inpuls-chart-v2",
  timeZone: "inpuls-timezone-v1",
  timeZoneCity: "inpuls-timezone-city-v1",
  volume: "inpuls-volume-v1",
  sessions: "inpuls-sessions-v1",
  comfort: "inpuls-comfort-v1",
  fontScale: "inpuls-font-scale-v1",
  workspace: "inpuls-workspace-v4",
  radarColumns: "inpuls-radar-columns-v2",
  radarFilters: "inpuls-radar-filters-v2",
  inplay: "inpuls-inplay-v2",
};

const DEFAULT_INPLAY = Object.freeze({ symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "SUIUSDT"], minV24: null, minNatr1: null, minGrowth24: null });
const EMPTY_RADAR_FILTERS = Object.freeze([]);

function normalizeInPlay(value) {
  if (Array.isArray(value)) return { ...DEFAULT_INPLAY, symbols: value.map((item) => typeof item === "string" ? item : item?.symbol).filter(Boolean) };
  return { ...DEFAULT_INPLAY, ...(value && typeof value === "object" ? value : {}), symbols: Array.isArray(value?.symbols) ? value.symbols : [...DEFAULT_INPLAY.symbols] };
}

const DEFAULT_WORKSPACE = {
  primary: { id: "primary", type: "chart", x: 0, y: 0, w: 18, h: 9 },
  radar: { id: "radar", type: "radar", x: 18, y: 0, w: 6, h: 9 },
  scanner: { id: "scanner", type: "scanner", x: 0, y: 9, w: 24, h: 3 },
  extras: [],
};

const savedChart = loadJson(STORAGE_KEYS.chart, { interval: "1m", range: "1h" });

const state = {
  symbols: new Map(),
  settings: loadJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
  favorites: new Set(loadJson(STORAGE_KEYS.favorites, [])),
  soundEnabled: loadJson(STORAGE_KEYS.sound, false),
  filter: "all",
  search: "",
  selectedSymbol: null,
  selectedChartSymbol: "BTCUSDT",
  chartInterval: savedChart.interval ?? "1m",
  chartRange: savedChart.range ?? "1h",
  chartCandles: [],
  topSort: { key: "quoteVolume24h", direction: "desc" },
  lastMetrics: [],
  alerts: [],
  connectedAt: null,
  chartStats: { fundingRate: null, nextFundingTime: null, natr1m: null, natr5m: null, correlation: null },
  timeZone: localStorage.getItem(STORAGE_KEYS.timeZone) || "Europe/Moscow",
  selectedTimeZoneCity: localStorage.getItem(STORAGE_KEYS.timeZoneCity) || "Москва",
  volumeVisible: loadJson(STORAGE_KEYS.volume, true),
  sessionsVisible: loadJson(STORAGE_KEYS.sessions, true),
  comfort: Number(localStorage.getItem(STORAGE_KEYS.comfort) ?? 55),
  fontScale: Number(localStorage.getItem(STORAGE_KEYS.fontScale) ?? 100),
  radarSearch: "",
  workspace: loadJson(STORAGE_KEYS.workspace, DEFAULT_WORKSPACE),
  radarColumns: loadJson(STORAGE_KEYS.radarColumns, [1.35, 1, 1, 1, .85, .85, 1]),
  radarFilters: loadJson(STORAGE_KEYS.radarFilters, EMPTY_RADAR_FILTERS),
  inplay: normalizeInPlay(loadJson(STORAGE_KEYS.inplay, DEFAULT_INPLAY)),
};

const els = {
  status: document.querySelector("#connection-status"),
  statusText: document.querySelector("#connection-text"),
  clock: document.querySelector("#clock"),
  comfortSlider: document.querySelector("#comfort-slider"),
  timeZoneOpen: document.querySelector("#timezone-open"),
  timeZoneCity: document.querySelector("#timezone-city"),
  timeZoneDialog: document.querySelector("#timezone-dialog"),
  timeZoneClose: document.querySelector("#timezone-close"),
  timeZoneSearch: document.querySelector("#timezone-search"),
  timeZoneMap: document.querySelector("#timezone-map"),
  timeZoneMapWorld: document.querySelector("#timezone-map-world"),
  timeZoneMarkers: document.querySelector("#timezone-markers"),
  timeZoneZoneLines: document.querySelector("#timezone-zone-lines"),
  timeZoneResults: document.querySelector("#timezone-results"),
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
  marketFocus: document.querySelector("#market-focus"),
  inplayCoins: document.querySelector("#inplay-coins"),
  inplaySettings: document.querySelector("#inplay-settings"),
  inplayDialog: document.querySelector("#inplay-dialog"),
  inplayClose: document.querySelector("#inplay-close"),
  inplayCancel: document.querySelector("#inplay-cancel"),
  inplaySymbols: document.querySelector("#inplay-symbols"),
  inplayMinV24: document.querySelector("#inplay-min-v24"),
  inplayMinNatr1: document.querySelector("#inplay-min-natr1"),
  inplayMinGrowth24: document.querySelector("#inplay-min-growth24"),
  priceChart: document.querySelector("#price-chart"),
  chartTooltip: document.querySelector("#chart-tooltip"),
  chartSymbol: document.querySelector("#chart-symbol"),
  chartPrice: document.querySelector("#chart-price"),
  chartChange: document.querySelector("#chart-change"),
  chartStatus: document.querySelector("#chart-status"),
  timeframeButtons: [...document.querySelectorAll("[data-interval]")],
  rangeButtons: [...document.querySelectorAll("[data-range]")],
  moreTimeframe: document.querySelector("#more-timeframe"),
  topList: document.querySelector("#top-list"),
  topSortButtons: [...document.querySelectorAll("[data-top-sort]")],
  radarSearch: document.querySelector("#radar-search"),
  radarFilterToggle: document.querySelector("#radar-filter-toggle"),
  radarFilterPanel: document.querySelector("#radar-filter-panel"),
  radarFilterCount: document.querySelector("#radar-filter-count"),
  radarFilterMetric: document.querySelector("#radar-filter-metric"),
  radarFilterOperator: document.querySelector("#radar-filter-operator"),
  radarFilterValue: document.querySelector("#radar-filter-value"),
  radarFilterAdd: document.querySelector("#radar-filter-add"),
  radarFilterChips: document.querySelector("#radar-filter-chips"),
  radarFilterReset: document.querySelector("#radar-filter-reset"),
  columnResizers: [...document.querySelectorAll("[data-column-index]")],
  radarResizer: document.querySelector("#radar-resizer"),
  scannerResizer: document.querySelector("#scanner-resizer"),
  addChartTile: document.querySelector("#add-chart-tile"),
  addChartDialog: document.querySelector("#add-chart-dialog"),
  addChartClose: document.querySelector("#add-chart-close"),
  panelPickerTitle: document.querySelector("#panel-picker-title"),
  addPanelButtons: [...document.querySelectorAll("[data-add-panel]")],
  chartPickerSearch: document.querySelector("#chart-picker-search"),
  chartPickerList: document.querySelector("#chart-picker-list"),
  metricTurnover: document.querySelector("#metric-turnover"),
  metricFunding: document.querySelector("#metric-funding"),
  metricFundingTime: document.querySelector("#metric-funding-time"),
  metricNatr1m: document.querySelector("#metric-natr-1m"),
  metricNatr5m: document.querySelector("#metric-natr-5m"),
  metricCorrelation: document.querySelector("#metric-correlation"),
  volumeToggle: document.querySelector("#volume-toggle"),
  sessionToggle: document.querySelector("#session-toggle"),
  fontScale: document.querySelector("#font-scale"),
  fontScaleValue: document.querySelector("#font-scale-value"),
  alertToast: document.querySelector("#alert-toast"),
  chartResizer: document.querySelector("#chart-resizer"),
  mobileViewButtons: [...document.querySelectorAll("[data-mobile-view]")],
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
      this.#send("SUBSCRIBE", ["!miniTicker@arr", "!markPrice@arr@1s", "!forceOrder@arr"]);
      if (this.trackedAggTrades.size) {
        this.#send("SUBSCRIBE", [...this.trackedAggTrades].flatMap((symbol) => [`${symbol.toLowerCase()}@aggTrade`, `${symbol.toLowerCase()}@bookTicker`]));
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
    if (unsubscribe.length) this.#send("UNSUBSCRIBE", unsubscribe.flatMap((symbol) => [`${symbol.toLowerCase()}@aggTrade`, `${symbol.toLowerCase()}@bookTicker`]));
    if (subscribe.length) this.#send("SUBSCRIBE", subscribe.flatMap((symbol) => [`${symbol.toLowerCase()}@aggTrade`, `${symbol.toLowerCase()}@bookTicker`]));
  }

  #send(method, params) {
    if (this.socket?.readyState !== WebSocket.OPEN || !params.length) return;
    this.socket.send(JSON.stringify({ method, params, id: this.requestId++ }));
  }

  #handle(data) {
    if (Array.isArray(data)) {
      for (const ticker of data) {
        if (ticker?.e === "markPriceUpdate" && ticker.s?.endsWith("USDT")) {
          getSymbol(ticker.s, Number(ticker.E) || Date.now()).updateFunding(ticker);
          continue;
        }
        if (!filterUsdtPerpetualTicker(ticker)) continue;
        getSymbol(ticker.s, Number(ticker.E) || Date.now()).updateTicker(ticker);
      }
      scheduleRender();
      return;
    }
    if (!data || typeof data !== "object") return;
    if (data.e === "bookTicker" && data.s?.endsWith("USDT")) {
      getSymbol(data.s, Number(data.E) || Date.now()).updateBookTicker(data);
      scheduleRender();
      return;
    }
    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data)) {
      getSymbol(data.s).updateTrade(data);
      scheduleRender();
      return;
    }
    if (data.e === "forceOrder") {
      const symbol = data.o?.s;
      if (symbol?.endsWith("USDT") && (data.st === undefined || Number(data.st) === 1)) {
        getSymbol(symbol).updateLiquidation(data);
        scheduleRender();
      }
    }
  }
}

const feed = new BinanceFeed();
let scheduledMarketRender = null;
function scheduleRender() {
  if (scheduledMarketRender !== null) return;
  scheduledMarketRender = setTimeout(() => {
    scheduledMarketRender = null;
    render();
  }, 180);
}
const radarHistoryLoaded = new Set();
const radarHistoryLoading = new Set();
const extraCharts = new Map();
const orderBookPanels = new Map();
let panelPickerType = "chart";
let activeChartTheme = null;
const priceChart = new CandlestickChart(els.priceChart, els.chartTooltip, { onAlert: handleChartAlert });
priceChart.setTimeZone(state.timeZone === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : state.timeZone);
priceChart.setVolumeVisible(state.volumeVisible);
priceChart.setSessionsVisible(state.sessionsVisible);
applyFontScale(state.fontScale);
applyComfort(state.comfort);
const klineFeed = new KlineFeed({
  onData(candles, meta) {
    state.chartCandles = candles;
    priceChart.setData(candles, meta);
    updateChartHeader();
  },
  onStatus({ state: status, text }) {
    if (!els.chartStatus) return;
    els.chartStatus.dataset.status = status;
    els.chartStatus.replaceChildren(document.createElement("i"), document.createTextNode(text));
  },
});

function persistChartSettings() {
  localStorage.setItem(STORAGE_KEYS.chart, JSON.stringify({ interval: state.chartInterval, range: state.chartRange }));
}

function mixColor(left, right, amount) {
  const read = (color) => color.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16));
  const a = read(left);
  const b = read(right);
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function applyComfort(rawValue) {
  const value = Math.max(0, Math.min(100, Number(rawValue) || 0));
  const amount = value / 100;
  const palette = {
    bg: mixColor("#0b0f12", "#050606", amount),
    panel: mixColor("#11161b", "#0a0b0d", amount),
    panel2: mixColor("#171d23", "#0f1013", amount),
    line: mixColor("#2a353c", "#24212c", amount),
    text: mixColor("#d6dde2", "#c9c5bc", amount),
    muted: mixColor("#87919b", "#807b72", amount),
    chart: mixColor("#080b0d", "#040505", amount),
    bull: mixColor("#d7dde0", "#d0cbc1", amount),
    bear: mixColor("#101417", "#0b0b0c", amount),
    bearStroke: mixColor("#7d8790", "#77716a", amount),
    grid: mixColor("#56616a", "#4b4743", amount),
    crosshair: mixColor("#929aa1", "#918a80", amount),
    crosshairFill: mixColor("#355f56", "#594464", amount),
    crosshairText: mixColor("#eef1f2", "#e6dfd4", amount),
    accent: amount <= .5
      ? mixColor("#39dba2", "#35cbd4", amount * 2)
      : mixColor("#35cbd4", "#9567c5", (amount - .5) * 2),
  };
  const root = document.documentElement;
  root.style.setProperty("--bg", palette.bg);
  root.style.setProperty("--panel", palette.panel);
  root.style.setProperty("--panel-2", palette.panel2);
  root.style.setProperty("--line", palette.line);
  root.style.setProperty("--line-soft", `${palette.line}55`);
  root.style.setProperty("--text", palette.text);
  root.style.setProperty("--muted", palette.muted);
  root.style.setProperty("--chart-bg", palette.chart);
  root.style.setProperty("--accent", palette.accent);
  root.style.setProperty("--violet", palette.accent);
  root.style.setProperty("--green", "#39dba2");
  root.style.setProperty("--blue", "#7198b4");
  root.style.setProperty("--theme-level", String(amount));
  root.style.colorScheme = "dark";
  root.dataset.comfort = String(Math.round(value));
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = palette.bg;
  activeChartTheme = {
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
    session: palette.accent,
  };
  priceChart.setTheme(activeChartTheme);
  for (const panel of extraCharts.values()) panel.chart.setTheme(activeChartTheme);
}

function applyFontScale(rawValue) {
  const value = Math.max(80, Math.min(130, Number(rawValue) || 100));
  state.fontScale = value;
  document.documentElement.style.setProperty("--font-scale", `${value / 100}px`);
  if (els.fontScale) els.fontScale.value = String(value);
  if (els.fontScaleValue) els.fontScaleValue.textContent = `${value}%`;
  priceChart?.setFontScale(value / 100);
  for (const panel of extraCharts.values()) panel.chart.setFontScale(value / 100);
}

let titleBlinkTimer = null;
let toastTimer = null;
function showToast(message, isAlert = false) {
  if (!els.alertToast) return;
  clearTimeout(toastTimer);
  els.alertToast.hidden = false;
  els.alertToast.classList.remove("is-price-alert");
  if (isAlert) {
    void els.alertToast.offsetWidth;
    els.alertToast.classList.add("is-price-alert");
  }
  els.alertToast.textContent = message;
  toastTimer = setTimeout(() => { els.alertToast.hidden = true; }, isAlert ? 7000 : 1800);
}

function handleChartAlert({ symbol, price }) {
  const pair = symbol || state.selectedChartSymbol;
  const message = `ALERT · ${pair} · ${formatPrice(price)}`;
  if (state.soundEnabled) playAlert("up", 100);
  showToast(message, true);
  if (globalThis.Notification?.permission === "granted") new Notification(`InPuls · ${pair}`, { body: `Цена коснулась ${formatPrice(price)}` });
  clearInterval(titleBlinkTimer);
  let flashes = 0;
  titleBlinkTimer = setInterval(() => {
    document.title = flashes % 2 ? "InPuls — в ритме рынка" : `ALERT · ${pair}`;
    if (++flashes >= 10) {
      clearInterval(titleBlinkTimer);
      document.title = "InPuls — в ритме рынка";
    }
  }, 650);
}

async function copyTicker(symbol) {
  const clean = String(symbol || "").replace("/", "");
  if (!clean) return;
  try { await navigator.clipboard.writeText(clean); }
  catch {
    const area = document.createElement("textarea");
    area.value = clean;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  showToast(`Скопировано: ${clean}`);
}

function selectInterval(interval) {
  state.chartInterval = interval;
  const secondRangeCaps = { "1s": "15m", "5s": "1h", "15s": "4h" };
  if (secondRangeCaps[interval]) state.chartRange = secondRangeCaps[interval];
  persistChartSettings();
  els.timeframeButtons.forEach((item) => item.classList.toggle("is-active", item.dataset.interval === interval));
  els.rangeButtons.forEach((item) => item.classList.toggle("is-active", item.dataset.range === state.chartRange));
  els.moreTimeframe.value = interval;
  klineFeed.select(state.selectedChartSymbol, interval, state.chartRange);
}

function selectRange(range) {
  state.chartRange = range;
  const sensibleInterval = { "15m": "1s", "1h": "5s", "4h": "15s", "1d": "1m", "7d": "15m", "30d": "1h", "90d": "4h", "365d": "1d" };
  const allowedSecondRanges = { "1s": ["15m"], "5s": ["15m", "1h"], "15s": ["15m", "1h", "4h"] };
  if (allowedSecondRanges[state.chartInterval] && !allowedSecondRanges[state.chartInterval].includes(range)) state.chartInterval = sensibleInterval[range];
  persistChartSettings();
  els.rangeButtons.forEach((item) => item.classList.toggle("is-active", item.dataset.range === range));
  els.timeframeButtons.forEach((item) => item.classList.toggle("is-active", item.dataset.interval === state.chartInterval));
  els.moreTimeframe.value = state.chartInterval;
  klineFeed.select(state.selectedChartSymbol, state.chartInterval, range);
}

function getSymbol(symbol, now) {
  if (!state.symbols.has(symbol)) state.symbols.set(symbol, new SymbolState(symbol, now));
  return state.symbols.get(symbol);
}

function getMetrics(now = Date.now()) {
  const metrics = [...state.symbols.values()]
    .filter((item) => item.quoteVolume24h >= state.settings.minTurnover24h)
    .map((item) => item.metrics(state.settings, now));
  const bitcoinReturns = metrics.find((item) => item.symbol === "BTCUSDT")?.minuteReturns ?? [];
  return metrics
    .map((item) => ({
      ...item,
      correlation: item.symbol === "BTCUSDT" ? 1 : pearsonCorrelation(item.minuteReturns, bitcoinReturns),
    }))
    .sort((a, b) => {
      const favoriteDiff = Number(state.favorites.has(b.symbol)) - Number(state.favorites.has(a.symbol));
      return favoriteDiff || b.score - a.score || (b.turnoverPerMinute || 0) - (a.turnoverPerMinute || 0);
    });
}

async function warmupRadarHistory() {
  const ranked = state.lastMetrics.slice().sort((left, right) => right.quoteVolume24h - left.quoteVolume24h);
  const symbols = [...new Set(["BTCUSDT", ...ranked.map((item) => item.symbol)])]
    .filter((symbol) => state.symbols.has(symbol) && !radarHistoryLoaded.has(symbol) && !radarHistoryLoading.has(symbol))
    .slice(0, 6);
  if (!symbols.length) return;
  await Promise.all(symbols.map(async (symbol) => {
    radarHistoryLoading.add(symbol);
    try {
      const query = new URLSearchParams({ symbol, interval: "1m", limit: "90" });
      const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      getSymbol(symbol).hydrateMinuteCandles(rows.map(parseRestKline));
      radarHistoryLoaded.add(symbol);
    } catch {
      // Retry later without blocking the live market feed.
    } finally {
      radarHistoryLoading.delete(symbol);
    }
  }));
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
  renderInPlay(metrics);
  renderTopList(metrics);
  updateExtraChartMetrics(metrics);
  updateChartHeader(metrics);
  if (state.selectedSymbol) renderDetail(state.selectedSymbol);
}

function renderInPlay(metrics) {
  if (!els.inplayCoins) return;
  if (!Array.isArray(state.inplay.symbols) || !state.inplay.symbols.length) state.inplay = { ...DEFAULT_INPLAY, symbols: [...DEFAULT_INPLAY.symbols] };
  const fragment = document.createDocumentFragment();
  for (const symbol of state.inplay.symbols.slice(0, 18)) {
    const item = metrics.find((candidate) => candidate.symbol === symbol);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inplay-chip";
    button.draggable = true;
    const hasValue = (value) => value !== null && value !== "" && Number.isFinite(Number(value));
    const checks = [
      hasValue(state.inplay.minV24) ? (item?.quoteVolume24h ?? -Infinity) >= Number(state.inplay.minV24) * 1_000_000 : null,
      hasValue(state.inplay.minNatr1) ? (item?.natr1m ?? -Infinity) >= Number(state.inplay.minNatr1) : null,
      hasValue(state.inplay.minGrowth24) ? (item?.change24h ?? -Infinity) >= Number(state.inplay.minGrowth24) : null,
    ].filter((value) => value !== null);
    button.classList.toggle("is-triggered", checks.length > 0 && checks.every(Boolean));
    button.title = `${symbol} · V24 ${formatCompactUsd(item?.quoteVolume24h)}`;
    const change = item?.change24h;
    button.innerHTML = `<strong>${escapeHtml(symbol.replace("USDT", ""))}</strong><span class="${Number.isFinite(change) ? toneClass(change) : "tone-neutral"}">${formatChange(change)}</span>`;
    button.addEventListener("click", () => selectChartSymbol(symbol));
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/inpuls-symbol", symbol);
      event.dataTransfer.setData("text/plain", symbol);
    });
    fragment.append(button);
  }
  els.inplayCoins.replaceChildren(fragment);
}

function renderInPlayEditor() {
  const value = (next) => next !== null && Number.isFinite(Number(next)) ? String(next) : "";
  els.inplaySymbols.value = state.inplay.symbols.map((symbol) => symbol.replace("USDT", "")).join(", ");
  els.inplayMinV24.value = value(state.inplay.minV24);
  els.inplayMinNatr1.value = value(state.inplay.minNatr1);
  els.inplayMinGrowth24.value = value(state.inplay.minGrowth24);
}

function collectInPlayRules() {
  const symbols = [...new Set(els.inplaySymbols.value.split(/[\s,;]+/).map((value) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean).map((value) => value.endsWith("USDT") ? value : `${value}USDT`))].slice(0, 18);
  const read = (input) => input.value.trim() === "" ? null : Number(input.value);
  state.inplay = { symbols: symbols.length ? symbols : [...DEFAULT_INPLAY.symbols], minV24: read(els.inplayMinV24), minNatr1: read(els.inplayMinNatr1), minGrowth24: read(els.inplayMinGrowth24) };
  localStorage.setItem(STORAGE_KEYS.inplay, JSON.stringify(state.inplay));
  updateTrackedSymbols();
}

function createRow(item) {
  const row = els.tbodyTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.symbol = item.symbol;
  row.classList.toggle("has-signal", Boolean(item.primarySignal));
  row.classList.toggle("is-hot", item.score >= state.settings.alertScore);
  row.classList.toggle("is-selected", item.symbol === state.selectedChartSymbol);

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
  row.addEventListener("click", () => selectChartSymbol(item.symbol, true));
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
  if (els.marketPulse) {
    els.marketPulse.textContent = pulse === null ? "—" : `${pulse}%`;
    els.marketPulse.dataset.tone = pulse === null ? "neutral" : pulse >= 55 ? "up" : pulse <= 45 ? "down" : "neutral";
  }
  if (els.hotCount) els.hotCount.textContent = metrics.filter((item) => item.score >= state.settings.alertScore).length;
  if (els.alertCount) els.alertCount.textContent = state.alerts.filter((item) => item.time >= now - 60_000).length;
  if (els.trackedCount) els.trackedCount.textContent = state.symbols.size;

  const oldest = metrics.reduce((min, item) => Math.max(min, item.warmupSeconds), 0);
  els.warmup.hidden = oldest >= 300;
  if (oldest < 300) els.warmup.querySelector("span").textContent = `История: ${Math.min(100, Math.round((oldest / 300) * 100))}%`;
}

function renderTopList(metrics) {
  let candidates = metrics.filter((item) => {
    if (state.radarSearch && !item.symbol.toLowerCase().includes(state.radarSearch)) return false;
    return (Array.isArray(state.radarFilters) ? state.radarFilters : []).every((rule) => {
      let value = Number(item[rule.metric]);
      if (rule.metric === "quoteVolume24h") value /= 1_000_000;
      if (rule.metric === "fundingRate") value *= 100;
      if (!Number.isFinite(value)) return false;
      const target = Number(rule.value);
      return rule.operator === "lte" ? value <= target : rule.operator === "lt" ? value < target : rule.operator === "gt" ? value > target : value >= target;
    });
  });
  const { key, direction } = state.topSort;
  const multiplier = direction === "asc" ? 1 : -1;
  candidates.sort((left, right) => {
    if (key === "symbol") return left.symbol.localeCompare(right.symbol) * multiplier;
    const a = Number(left[key]);
    const b = Number(right[key]);
    if (!Number.isFinite(a) && !Number.isFinite(b)) return left.symbol.localeCompare(right.symbol);
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    return (a - b) * multiplier || left.symbol.localeCompare(right.symbol);
  });
  for (const button of els.topSortButtons) {
    const active = button.dataset.topSort === key;
    button.classList.toggle("is-active", active);
    button.dataset.direction = active ? direction : "";
    button.querySelector("i").textContent = active ? (direction === "asc" ? "↑" : "↓") : "↕";
    button.setAttribute("aria-sort", active ? (direction === "asc" ? "ascending" : "descending") : "none");
  }
  candidates = candidates.slice(0, 100);

  if (!candidates.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "top-placeholder";
    placeholder.textContent = state.lastMetrics.length ? "По этому фильтру пока нет монет" : "Собираю лидеров рынка…";
    els.topList.replaceChildren(placeholder);
    return;
  }

  const fragment = document.createDocumentFragment();
  candidates.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "top-item";
    button.draggable = true;
    button.dataset.symbol = item.symbol;
    button.classList.toggle("is-selected", item.symbol === state.selectedChartSymbol);
    button.setAttribute("aria-label", `Открыть график ${item.symbol}`);

    const identity = document.createElement("span");
    identity.className = "top-identity";
    const pair = document.createElement("strong");
    pair.textContent = item.symbol.replace("USDT", "");
    identity.append(pair);
    const valueCell = (metric, className = "top-turnover") => {
      const cell = document.createElement("strong");
      cell.textContent = formatRadarMetric(item, metric);
      cell.className = className;
      return cell;
    };
    button.append(
      identity,
      valueCell("quoteVolume24h"),
      valueCell("natr1m"),
      valueCell("natr5m"),
      valueCell("fundingRate", toneClass(item.fundingRate)),
      valueCell("correlation", "tone-neutral correlation-value"),
      valueCell("change24h", toneClass(item.change24h)),
    );
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/inpuls-symbol", item.symbol);
      event.dataTransfer.setData("text/plain", item.symbol);
    });
    button.addEventListener("click", () => selectChartSymbol(item.symbol));
    fragment.append(button);
  });
  els.topList.replaceChildren(fragment);
  updateExtraChartMetrics(metrics);
}

function syncRadarFilterUi() {
  if (!Array.isArray(state.radarFilters)) state.radarFilters = [];
  const labels = { quoteVolume24h: "V24 $M", natr1m: "NATR 1", natr5m: "NATR 5", fundingRate: "F %", correlation: "C", change24h: "Рост 24ч" };
  const operators = { gte: "≥", lte: "≤", gt: ">", lt: "<" };
  const fragment = document.createDocumentFragment();
  state.radarFilters.forEach((rule, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "radar-filter-chip";
    chip.title = "Удалить условие";
    chip.textContent = `${labels[rule.metric] ?? rule.metric} ${operators[rule.operator] ?? "≥"} ${rule.value} ×`;
    chip.addEventListener("click", () => {
      state.radarFilters.splice(index, 1);
      localStorage.setItem(STORAGE_KEYS.radarFilters, JSON.stringify(state.radarFilters));
      syncRadarFilterUi();
      renderTopList(state.lastMetrics);
    });
    fragment.append(chip);
  });
  els.radarFilterChips.replaceChildren(fragment);
  els.radarFilterCount.textContent = String(state.radarFilters.length);
}

function formatRadarMetric(item, metric) {
  const value = item[metric];
  if (metric === "quoteVolume24h") return formatCompactUsd(value);
  if (metric === "fundingRate") return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(3)}%` : "—";
  if (metric === "correlation") return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}` : "—";
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}

const WORKSPACE_COLS = 24;
const WORKSPACE_ROWS = 12;

function clampPanel(model, fallback, minimum = { w: 5, h: 3 }) {
  const next = { ...fallback, ...(model && typeof model === "object" ? model : {}) };
  next.id = String(next.id || fallback.id);
  next.type = next.type || fallback.type;
  next.w = Math.max(minimum.w, Math.min(WORKSPACE_COLS, Math.round(Number(next.w) || fallback.w)));
  next.h = Math.max(minimum.h, Math.min(WORKSPACE_ROWS, Math.round(Number(next.h) || fallback.h)));
  next.x = Math.max(0, Math.min(WORKSPACE_COLS - next.w, Math.round(Number(next.x) || 0)));
  next.y = Math.max(0, Math.min(WORKSPACE_ROWS - next.h, Math.round(Number(next.y) || 0)));
  return next;
}

function normalizeWorkspace() {
  const raw = state.workspace && typeof state.workspace === "object" ? state.workspace : {};
  const workspace = {
    primary: clampPanel(raw.primary, DEFAULT_WORKSPACE.primary, { w: 3, h: 2 }),
    radar: clampPanel(raw.radar, DEFAULT_WORKSPACE.radar, { w: 3, h: 2 }),
    scanner: clampPanel(raw.scanner, DEFAULT_WORKSPACE.scanner, { w: 5, h: 2 }),
    extras: [],
  };
  const sourceExtras = Array.isArray(raw.extras) ? raw.extras : [];
  for (const source of sourceExtras) {
    if (!source?.id || !source?.symbol?.endsWith("USDT")) continue;
    const type = source.type === "orderbook" ? "orderbook" : "chart";
    const fallback = { id: String(source.id), type, symbol: source.symbol, interval: source.interval || "1m", x: 0, y: 0, w: type === "orderbook" ? 6 : 8, h: 6 };
    const item = clampPanel(source, fallback, { w: 3, h: 2 });
    item.symbol = source.symbol;
    item.interval = source.interval || "1m";
    if (canPlacePanel(item, workspace)) workspace.extras.push(item);
  }
  state.workspace = workspace;
  if (!canPlacePanel(workspace.scanner, workspace, "scanner")) workspace.scanner = { ...DEFAULT_WORKSPACE.scanner };
  if (!canPlacePanel(workspace.radar, workspace, "radar")) workspace.radar = { ...DEFAULT_WORKSPACE.radar };
  if (!canPlacePanel(workspace.primary, workspace, "primary")) workspace.primary = { ...DEFAULT_WORKSPACE.primary };
}

function persistWorkspace() {
  localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify(state.workspace));
}

function workspacePanels(workspace = state.workspace) {
  return [workspace.primary, workspace.radar, workspace.scanner, ...(workspace.extras ?? [])].filter(Boolean);
}

function panelsOverlap(left, right) {
  return left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
}

function canPlacePanel(candidate, workspace = state.workspace, ignoreId = candidate.id) {
  if (!candidate || candidate.x < 0 || candidate.y < 0 || candidate.w < 1 || candidate.h < 1) return false;
  if (candidate.x + candidate.w > WORKSPACE_COLS || candidate.y + candidate.h > WORKSPACE_ROWS) return false;
  return workspacePanels(workspace).every((panel) => panel.id === ignoreId || !panelsOverlap(candidate, panel));
}

function findFreeSlot(width = 6, height = 4) {
  const w = Math.min(WORKSPACE_COLS, width);
  const h = Math.min(WORKSPACE_ROWS, height);
  for (let y = 0; y <= WORKSPACE_ROWS - h; y += 1) {
    for (let x = 0; x <= WORKSPACE_COLS - w; x += 1) {
      const slot = { id: "free-slot", x, y, w, h };
      if (canPlacePanel(slot, state.workspace, "free-slot")) return slot;
    }
  }
  return null;
}

function findLargestFreeSlot() {
  const occupied = Array.from({ length: WORKSPACE_ROWS }, () => Array(WORKSPACE_COLS).fill(false));
  for (const panel of workspacePanels()) {
    for (let y = panel.y; y < panel.y + panel.h; y += 1) {
      for (let x = panel.x; x < panel.x + panel.w; x += 1) occupied[y][x] = true;
    }
  }
  let best = null;
  for (let startY = 0; startY < WORKSPACE_ROWS; startY += 1) {
    for (let startX = 0; startX < WORKSPACE_COLS; startX += 1) {
      if (occupied[startY][startX]) continue;
      let width = WORKSPACE_COLS - startX;
      for (let endY = startY; endY < WORKSPACE_ROWS; endY += 1) {
        let rowWidth = 0;
        while (startX + rowWidth < WORKSPACE_COLS && !occupied[endY][startX + rowWidth]) rowWidth += 1;
        width = Math.min(width, rowWidth);
        if (!width) break;
        const height = endY - startY + 1;
        const area = width * height;
        if (!best || area > best.w * best.h || (area === best.w * best.h && width > best.w)) best = { id: "free-slot", x: startX, y: startY, w: width, h: height };
      }
    }
  }
  return best;
}

function findNearestFreePosition(model, targetX, targetY) {
  const clampedX = Math.max(0, Math.min(WORKSPACE_COLS - model.w, targetX));
  const clampedY = Math.max(0, Math.min(WORKSPACE_ROWS - model.h, targetY));
  for (let radius = 0; radius <= WORKSPACE_COLS + WORKSPACE_ROWS; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const dx = radius - Math.abs(dy);
      for (const sign of dx === 0 ? [0] : [-1, 1]) {
        const candidate = { ...model, x: clampedX + dx * sign, y: clampedY + dy };
        candidate.x = Math.max(0, Math.min(WORKSPACE_COLS - candidate.w, candidate.x));
        candidate.y = Math.max(0, Math.min(WORKSPACE_ROWS - candidate.h, candidate.y));
        if (canPlacePanel(candidate)) return { x: candidate.x, y: candidate.y };
      }
    }
  }
  return null;
}

function applyRadarColumns() {
  if (!Array.isArray(state.radarColumns) || state.radarColumns.length !== 7) state.radarColumns = [1.35, 1, 1, 1, .85, .85, 1];
  state.radarColumns.forEach((value, index) => els.marketFocus.style.setProperty(`--radar-col-${index + 1}`, `${Math.max(.45, Number(value) || 1)}fr`));
}

function applyWorkspaceLayout() {
  const primary = document.querySelector(".primary-chart");
  const radar = document.querySelector(".top-card");
  const scanner = document.querySelector(".workspace-panel");
  const place = (element, model) => {
    element.style.gridColumn = `${model.x + 1} / span ${model.w}`;
    element.style.gridRow = `${model.y + 1} / span ${model.h}`;
  };
  place(primary, state.workspace.primary);
  place(radar, state.workspace.radar);
  place(scanner, state.workspace.scanner);
  for (const panel of [...extraCharts.values(), ...orderBookPanels.values()]) {
    place(panel.element, panel.model);
  }
  const addSlot = findLargestFreeSlot();
  els.addChartTile.hidden = !addSlot;
  if (addSlot) {
    place(els.addChartTile, addSlot);
    els.addChartTile.classList.toggle("is-compact", addSlot.w < 5 || addSlot.h < 3);
  }
  requestAnimationFrame(() => {
    priceChart.render();
    for (const panel of extraCharts.values()) panel.chart.render();
  });
}

function bindGridResizer(handle, model, chart) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    const rect = els.marketFocus.getBoundingClientRect();
    const columnUnit = Math.max(10, (rect.width + 3) / WORKSPACE_COLS);
    const rowHeight = Math.max(12, (rect.height + 3) / WORKSPACE_ROWS);
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = model.w;
    const startHeight = model.h;
    const move = (moveEvent) => {
      const minimum = model.type === "scanner" ? { w: 5, h: 2 } : { w: 3, h: 2 };
      const candidate = {
        ...model,
        w: Math.max(minimum.w, Math.min(WORKSPACE_COLS - model.x, startWidth + Math.round((moveEvent.clientX - startX) / columnUnit))),
        h: Math.max(minimum.h, Math.min(WORKSPACE_ROWS - model.y, startHeight + Math.round((moveEvent.clientY - startY) / rowHeight))),
      };
      if (!canPlacePanel(candidate)) return;
      model.w = candidate.w;
      model.h = candidate.h;
      applyWorkspaceLayout();
      chart?.render();
    };
    const stop = () => {
      persistWorkspace();
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });
}

function bindPanelDrag(grip, model) {
  if (!grip) return;
  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    grip.setPointerCapture(event.pointerId);
    els.marketFocus.classList.add("is-dragging-panel");
    const rect = els.marketFocus.getBoundingClientRect();
    const columnUnit = Math.max(10, (rect.width + 3) / WORKSPACE_COLS);
    const rowUnit = Math.max(12, (rect.height + 3) / WORKSPACE_ROWS);
    const start = { x: model.x, y: model.y, pointerX: event.clientX, pointerY: event.clientY };
    const move = (moveEvent) => {
      const targetX = start.x + Math.round((moveEvent.clientX - start.pointerX) / columnUnit);
      const targetY = start.y + Math.round((moveEvent.clientY - start.pointerY) / rowUnit);
      const position = findNearestFreePosition(model, targetX, targetY);
      if (!position || (position.x === model.x && position.y === model.y)) return;
      model.x = position.x;
      model.y = position.y;
      applyWorkspaceLayout();
    };
    const stop = () => {
      els.marketFocus.classList.remove("is-dragging-panel");
      persistWorkspace();
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", stop);
      grip.removeEventListener("pointercancel", stop);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", stop);
    grip.addEventListener("pointercancel", stop);
  });
}

function intervalRange(interval) {
  return { "1s": "15m", "5s": "1h", "15s": "4h" }[interval] || "1h";
}

function bindChartToolbox(root, chart, persistSessions = false) {
  const toggle = root.querySelector(".drawing-tools-toggle");
  const menu = root.querySelector(".drawing-tools-menu");
  if (!toggle || !menu) return;
  const drawingButtons = [...menu.querySelectorAll("[data-drawing-tool]")];
  const sessionButton = menu.querySelector("[data-session-toggle]");
  const clearButton = root.querySelector(".drawing-clear-button");
  menu.hidden = false;
  const setOpen = (open) => {
    root.querySelector(".chart-toolbox")?.classList.toggle("is-open", open);
    menu.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  const sync = () => {
    toggle.classList.toggle("is-active", Boolean(chart.activeTool));
    drawingButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.drawingTool === chart.activeTool));
    sessionButton?.classList.toggle("is-off", !chart.sessionsVisible);
    if (sessionButton) sessionButton.textContent = chart.sessionsVisible ? "◫ Сессии: вкл" : "◫ Сессии: выкл";
  };
  chart.onToolChange = () => sync();
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(!menu.classList.contains("is-open"));
  });
  drawingButtons.forEach((button) => button.addEventListener("click", () => {
    chart.setTool(chart.activeTool === button.dataset.drawingTool ? null : button.dataset.drawingTool);
    if (button.dataset.drawingTool === "alert" && globalThis.Notification?.permission === "default") Notification.requestPermission().catch(() => {});
    setOpen(false);
    sync();
  }));
  clearButton?.addEventListener("click", () => chart.clearDrawings());
  sessionButton?.addEventListener("click", () => {
    chart.setSessionsVisible(!chart.sessionsVisible);
    if (persistSessions) {
      state.sessionsVisible = chart.sessionsVisible;
      localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(state.sessionsVisible));
    }
    sync();
  });
  sync();
}

function mountExtraChart(model) {
  if (extraCharts.has(model.id)) return;
  const article = document.createElement("article");
  article.className = "chart-card secondary-chart";
  article.dataset.panel = "chart";
  article.dataset.panelId = model.id;
  article.innerHTML = `
    <header class="chart-heading">
      <span class="panel-grip" title="Дополнительный график">⠿</span>
      <div class="chart-quote"><h2>${escapeHtml(model.symbol.replace("USDT", ""))}/USDT</h2><strong data-mini-price>—</strong></div>
      <div class="chart-controls"><div class="timeframes">
        ${["1s", "15s", "1m", "5m", "15m", "1h"].map((interval) => `<button class="timeframe-button${interval === model.interval ? " is-active" : ""}" data-mini-interval="${interval}" type="button">${interval.replace("s", "с").replace("m", "м").replace("h", "ч")}</button>`).join("")}
        <select class="compact-tf-select" data-mini-timeframe-select aria-label="Выбрать таймфрейм">
          ${["1s", "5s", "15s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "12h", "1d", "3d", "1w", "1M"].map((interval) => `<option value="${interval}"${interval === model.interval ? " selected" : ""}>${interval.replace("s", "с").replace("m", "м").replace("h", "ч").replace("d", "д").replace("w", "н")}</option>`).join("")}
        </select>
      </div></div>
      <button class="mini-chart-close" type="button" title="Закрыть график">×</button>
    </header>
    <div class="chart-stage">
      <div class="chart-metrics"><span><b>V24</b><strong data-mini-metric="quoteVolume24h">—</strong></span><span><b>NATR 1</b><strong data-mini-metric="natr1m">—</strong></span><span><b>NATR 5</b><strong data-mini-metric="natr5m">—</strong></span><span><b>F</b><strong data-mini-metric="fundingRate">—</strong></span><span><b>C</b><strong data-mini-metric="correlation">—</strong></span></div>
      <div class="chart-toolbox"><button class="drawing-tools-toggle" type="button" title="Инструменты рисования" aria-expanded="false">✎</button><div class="drawing-tools-menu">
        <button data-drawing-tool="trend" type="button">╱ Отрезок</button><button data-drawing-tool="horizontal" type="button">— Горизонталь</button><button data-drawing-tool="ruler" type="button">↕ Линейка</button><button data-drawing-tool="rectangle" type="button">▭ Прямоугольник</button><button data-drawing-tool="ray" type="button">→ Луч</button><button data-drawing-tool="freehand" type="button">∿ Рисование</button><button data-drawing-tool="alert" type="button">◉ Alert</button><button data-session-toggle type="button">◫ Сессии</button>
      </div><button class="drawing-clear-button" type="button">⌫ Очистить</button></div>
      <canvas aria-label="Дополнительный свечной график"></canvas><div class="chart-tooltip" hidden></div>
      <button class="chart-resizer" type="button" aria-label="Изменить размер графика"></button>
    </div>`;
  els.marketFocus.insertBefore(article, els.addChartTile);
  const chart = new CandlestickChart(article.querySelector("canvas"), article.querySelector(".chart-tooltip"), { onAlert: handleChartAlert });
  chart.setTimeZone(state.timeZone === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : state.timeZone);
  chart.setVolumeVisible(false);
  chart.setSessionsVisible(state.sessionsVisible);
  chart.setFontScale(state.fontScale / 100);
  if (activeChartTheme) chart.setTheme(activeChartTheme);
  const panel = { model, element: article, chart, feed: null };
  panel.feed = new KlineFeed({ onData: (candles, meta) => chart.setData(candles, meta), onStatus() {} });
  extraCharts.set(model.id, panel);
  bindChartToolbox(article, chart);
  article.querySelector(".chart-quote h2").title = "Нажми, чтобы скопировать тикер";
  article.querySelector(".chart-quote h2").addEventListener("click", (event) => {
    event.stopPropagation();
    copyTicker(model.symbol);
  });
  article.querySelectorAll("[data-mini-interval]").forEach((button) => button.addEventListener("click", () => {
    model.interval = button.dataset.miniInterval;
    article.querySelectorAll("[data-mini-interval]").forEach((item) => item.classList.toggle("is-active", item === button));
    article.querySelector("[data-mini-timeframe-select]").value = model.interval;
    persistWorkspace();
    panel.feed.select(model.symbol, model.interval, intervalRange(model.interval));
  }));
  article.querySelector("[data-mini-timeframe-select]").addEventListener("change", (event) => {
    model.interval = event.target.value;
    article.querySelectorAll("[data-mini-interval]").forEach((item) => item.classList.toggle("is-active", item.dataset.miniInterval === model.interval));
    persistWorkspace();
    panel.feed.select(model.symbol, model.interval, intervalRange(model.interval));
  });
  article.querySelector(".mini-chart-close").addEventListener("click", () => removeExtraChart(model.id));
  bindGridResizer(article.querySelector(".chart-resizer"), model, chart);
  bindPanelDrag(article.querySelector(".panel-grip"), model);
  article.addEventListener("dragover", (event) => {
    if (event.dataTransfer.types.includes("text/inpuls-symbol")) event.preventDefault();
  });
  article.addEventListener("drop", (event) => {
    const symbol = event.dataTransfer.getData("text/inpuls-symbol");
    if (!symbol?.endsWith("USDT")) return;
    event.preventDefault();
    model.symbol = symbol;
    article.querySelector("h2").textContent = `${symbol.replace("USDT", "")}/USDT`;
    persistWorkspace();
    panel.feed.select(symbol, model.interval, intervalRange(model.interval));
  });
  panel.feed.select(model.symbol, model.interval, intervalRange(model.interval));
}

function createExtraPanel(symbol, type = "chart") {
  if (!symbol?.endsWith("USDT")) return false;
  const slot = findFreeSlot(type === "orderbook" ? 6 : 8, 6) ?? findFreeSlot(4, 3) ?? findFreeSlot(3, 2);
  if (!slot) return false;
  const model = {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    symbol,
    interval: "1m",
    x: slot.x,
    y: slot.y,
    w: slot.w,
    h: slot.h,
  };
  state.workspace.extras.push(model);
  persistWorkspace();
  if (type === "orderbook") mountOrderBook(model);
  else mountExtraChart(model);
  applyWorkspaceLayout();
  return true;
}

function createExtraChart(symbol) {
  return createExtraPanel(symbol, "chart");
}

function removeExtraChart(id) {
  const panel = extraCharts.get(id);
  if (!panel) return;
  panel.feed.destroy();
  panel.chart.destroy();
  panel.element.remove();
  extraCharts.delete(id);
  state.workspace.extras = state.workspace.extras.filter((item) => item.id !== id);
  persistWorkspace();
  applyWorkspaceLayout();
}

function mountOrderBook(model) {
  if (orderBookPanels.has(model.id)) return;
  const article = document.createElement("article");
  article.className = "orderbook-card";
  article.dataset.panel = "orderbook";
  article.dataset.panelId = model.id;
  article.innerHTML = `
    <header class="orderbook-heading">
      <span class="panel-grip" title="Переместить стакан">⠿</span>
      <h2>${escapeHtml(model.symbol.replace("USDT", ""))}/USDT · Стакан</h2>
      <span class="book-status">Синхронизация</span>
      <button class="panel-close" type="button" title="Закрыть стакан">×</button>
    </header>
    <div class="orderbook-stage">
      <div class="orderbook-columns"><span>Сумма</span><span>Цена</span><span>Объём</span></div>
      <div class="orderbook-rows"><div class="orderbook-empty">Загружаю глубину Binance…</div></div>
      <button class="panel-resizer" type="button" aria-label="Изменить размер стакана"></button>
    </div>`;
  els.marketFocus.insertBefore(article, els.addChartTile);
  const panel = { model, element: article, feed: null, latest: null, frame: null };
  const draw = () => {
    panel.frame = null;
    if (panel.latest) renderOrderBook(panel, panel.latest);
  };
  panel.feed = new OrderBookFeed({
    onData(data) {
      panel.latest = data;
      if (!panel.frame) panel.frame = requestAnimationFrame(draw);
    },
    onStatus({ state: status, text }) {
      const label = article.querySelector(".book-status");
      label.textContent = text;
      label.classList.toggle("is-live", status === "online");
    },
  });
  orderBookPanels.set(model.id, panel);
  article.querySelector(".panel-close").addEventListener("click", () => removeOrderBook(model.id));
  bindGridResizer(article.querySelector(".panel-resizer"), model);
  bindPanelDrag(article.querySelector(".panel-grip"), model);
  article.addEventListener("dragover", (event) => {
    if (event.dataTransfer.types.includes("text/inpuls-symbol")) event.preventDefault();
  });
  article.addEventListener("drop", (event) => {
    const symbol = event.dataTransfer.getData("text/inpuls-symbol");
    if (!symbol?.endsWith("USDT")) return;
    event.preventDefault();
    model.symbol = symbol;
    article.querySelector("h2").textContent = `${symbol.replace("USDT", "")}/USDT · Стакан`;
    persistWorkspace();
    panel.feed.select(symbol);
  });
  panel.feed.select(model.symbol);
}

function renderOrderBook(panel, data) {
  const body = panel.element.querySelector(".orderbook-rows");
  const available = Math.max(1, Math.floor((body.getBoundingClientRect().height - 24) / 36));
  const bids = data.bids.slice(0, available);
  const asks = data.asks.slice(0, available).reverse();
  const total = (levels) => levels.reduce((sum, [, quantity]) => sum + quantity, 0);
  const maxDepth = Math.max(total(bids), total(asks), 1);
  const rows = [];
  let askDepth = 0;
  for (const [price, quantity] of asks) {
    askDepth += quantity;
    rows.push(bookRow("ask", price, quantity, askDepth, maxDepth));
  }
  const bestBid = data.bids[0]?.[0];
  const bestAsk = data.asks[0]?.[0];
  const spread = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? bestAsk - bestBid : null;
  const spreadPercent = Number.isFinite(spread) && bestBid ? (spread / bestBid) * 100 : null;
  rows.push(`<div class="book-spread"><span>${Number.isFinite(spread) ? formatPrice(spread) : "—"}</span><small>${Number.isFinite(spreadPercent) ? `${spreadPercent.toFixed(3)}%` : "спред"}</small></div>`);
  let bidDepth = 0;
  for (const [price, quantity] of bids) {
    bidDepth += quantity;
    rows.push(bookRow("bid", price, quantity, bidDepth, maxDepth));
  }
  body.innerHTML = rows.join("");
}

function bookRow(side, price, quantity, cumulative, maxDepth) {
  const quote = price * quantity;
  return `<div class="book-row is-${side}" style="--depth:${Math.min(100, (cumulative / maxDepth) * 100).toFixed(1)}%"><span>${formatCompactUsd(quote)}</span><span>${formatPrice(price)}</span><span>${formatBookQuantity(quantity)}</span></div>`;
}

function formatBookQuantity(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString("en-US", { maximumFractionDigits: value >= 10 ? 2 : 4 });
}

function removeOrderBook(id) {
  const panel = orderBookPanels.get(id);
  if (!panel) return;
  panel.feed.destroy();
  if (panel.frame) cancelAnimationFrame(panel.frame);
  panel.element.remove();
  orderBookPanels.delete(id);
  state.workspace.extras = state.workspace.extras.filter((item) => item.id !== id);
  persistWorkspace();
  applyWorkspaceLayout();
}

function updateExtraChartMetrics(metrics) {
  for (const panel of extraCharts.values()) {
    const item = metrics.find((candidate) => candidate.symbol === panel.model.symbol);
    panel.element.querySelector("[data-mini-price]").textContent = formatPrice(item?.price);
    panel.element.querySelectorAll("[data-mini-metric]").forEach((cell) => {
      cell.textContent = item ? formatRadarMetric(item, cell.dataset.miniMetric) : "—";
    });
  }
}

function renderChartPicker() {
  const query = els.chartPickerSearch.value.trim().toLowerCase();
  const universe = [...state.symbols.values()].map((item) => item.metrics(state.settings));
  const candidates = universe.filter((item) => !query || item.symbol.toLowerCase().includes(query)).sort((left, right) => right.quoteVolume24h - left.quoteVolume24h).slice(0, 180);
  const fragment = document.createDocumentFragment();
  for (const item of candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.symbol.replace("USDT", "");
    button.addEventListener("click", () => {
      if (createExtraPanel(item.symbol, panelPickerType)) els.addChartDialog.close();
    });
    fragment.append(button);
  }
  els.chartPickerList.replaceChildren(fragment);
}

function updateChartHeader(metrics = state.lastMetrics) {
  const item = metrics.find((candidate) => candidate.symbol === state.selectedChartSymbol);
  const lastCandle = state.chartCandles.at(-1);
  const price = item?.price ?? lastCandle?.close;
  const change = Number.isFinite(item?.change1m)
    ? item.change1m
    : lastCandle?.open
      ? ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100
      : null;
  els.chartSymbol.textContent = `${state.selectedChartSymbol.replace("USDT", "")}/USDT`;
  els.chartPrice.textContent = formatPrice(price);
  els.chartChange.textContent = formatChange(change);
  els.chartChange.className = toneClass(change);
  renderChartMetrics();
}

function selectChartSymbol(symbol, scrollToChart = false) {
  if (!symbol?.endsWith("USDT")) return;
  const changed = symbol !== state.selectedChartSymbol;
  state.selectedChartSymbol = symbol;
  updateChartHeader();
  renderTopList(state.lastMetrics);
  els.tableBody.querySelectorAll("tr").forEach((row) => row.classList.toggle("is-selected", row.dataset.symbol === symbol));
  if (changed || !state.chartCandles.length) klineFeed.select(symbol, state.chartInterval, state.chartRange);
  if (changed) loadChartStats(symbol);
  if (scrollToChart) els.marketFocus.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadChartStats(symbol) {
  const requestedSymbol = symbol;
  state.chartStats = { fundingRate: null, nextFundingTime: null, natr1m: null, natr5m: null, correlation: null };
  renderChartMetrics();
  try {
    const klineQuery = (pair, interval) => `https://fapi.binance.com/fapi/v1/klines?symbol=${pair}&interval=${interval}&limit=120`;
    const [premiumResponse, minuteResponse, fiveMinuteResponse, bitcoinResponse] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, { cache: "no-store" }),
      fetch(klineQuery(symbol, "1m"), { cache: "no-store" }),
      fetch(klineQuery(symbol, "5m"), { cache: "no-store" }),
      symbol === "BTCUSDT" ? Promise.resolve(null) : fetch(klineQuery("BTCUSDT", "1m"), { cache: "no-store" }),
    ]);
    if (![premiumResponse, minuteResponse, fiveMinuteResponse].every((response) => response?.ok) || (bitcoinResponse && !bitcoinResponse.ok)) throw new Error("Market metrics unavailable");
    const [premium, minuteRows, fiveMinuteRows, bitcoinRows] = await Promise.all([
      premiumResponse.json(), minuteResponse.json(), fiveMinuteResponse.json(), bitcoinResponse ? bitcoinResponse.json() : Promise.resolve(null),
    ]);
    const minuteCandles = minuteRows.map(parseRestKline);
    const fiveMinuteCandles = fiveMinuteRows.map(parseRestKline);
    getSymbol(symbol).hydrateMinuteCandles(minuteCandles);
    radarHistoryLoaded.add(symbol);
    if (bitcoinRows) {
      getSymbol("BTCUSDT").hydrateMinuteCandles(bitcoinRows.map(parseRestKline));
      radarHistoryLoaded.add("BTCUSDT");
    }
    if (state.selectedChartSymbol !== requestedSymbol) return;
    const returns = (candles) => candles.slice(1).map((candle, index) => (candle.close - candles[index].close) / candles[index].close);
    state.chartStats = {
      fundingRate: Number(premium.lastFundingRate),
      nextFundingTime: Number(premium.nextFundingTime),
      natr1m: calculateNatr(minuteCandles),
      natr5m: calculateNatr(fiveMinuteCandles),
      correlation: symbol === "BTCUSDT" ? 1 : pearsonCorrelation(returns(minuteCandles), returns(bitcoinRows.map(parseRestKline))),
    };
  } catch {
    // Keep the chart usable if one auxiliary public endpoint is unavailable.
  }
  renderChartMetrics();
}

function renderChartMetrics() {
  const item = state.lastMetrics.find((candidate) => candidate.symbol === state.selectedChartSymbol);
  const stats = state.chartStats;
  els.metricTurnover.textContent = formatCompactUsd(item?.quoteVolume24h);
  els.metricFunding.textContent = Number.isFinite(stats.fundingRate) ? `${stats.fundingRate >= 0 ? "+" : ""}${(stats.fundingRate * 100).toFixed(4)}%` : "—";
  els.metricFunding.className = Number.isFinite(stats.fundingRate) ? toneClass(stats.fundingRate) : "";
  const remaining = Number.isFinite(stats.nextFundingTime) ? Math.max(0, stats.nextFundingTime - Date.now()) : null;
  els.metricFundingTime.textContent = remaining === null ? "—" : `${String(Math.floor(remaining / 3_600_000)).padStart(2, "0")}:${String(Math.floor((remaining % 3_600_000) / 60_000)).padStart(2, "0")}`;
  els.metricNatr1m.textContent = Number.isFinite(stats.natr1m) ? `${stats.natr1m.toFixed(2)}%` : "—";
  els.metricNatr5m.textContent = Number.isFinite(stats.natr5m) ? `${stats.natr5m.toFixed(2)}%` : "—";
  els.metricCorrelation.textContent = Number.isFinite(stats.correlation) ? `${stats.correlation >= 0 ? "+" : ""}${stats.correlation.toFixed(2)}` : "—";
  els.metricCorrelation.className = "tone-neutral correlation-value";
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
  const ranked = [...state.symbols.values()]
    .filter((item) => item.quoteVolume24h >= state.settings.minTurnover24h)
    .map((item) => item.metrics(state.settings))
    .sort((a, b) => {
      const favoriteDiff = Number(state.favorites.has(b.symbol)) - Number(state.favorites.has(a.symbol));
      return favoriteDiff || b.score - a.score || b.turnoverPerMinute - a.turnoverPerMinute;
    })
    .map((item) => item.symbol);
  const pinned = state.inplay.symbols;
  feed.updateAggTradeSubscriptions([...new Set([...pinned, ...ranked])].slice(0, state.settings.trackedTrades));
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

const TIME_ZONE_CITIES = [
  { city: "Москва", zone: "Europe/Moscow", lat: 55.8, lon: 37.6, aliases: "moscow москва" },
  { city: "Санкт-Петербург", zone: "Europe/Moscow", lat: 59.9, lon: 30.3, aliases: "petersburg питер" },
  { city: "Амстердам", zone: "Europe/Amsterdam", lat: 52.4, lon: 4.9, aliases: "amsterdam нидерланды" },
  { city: "Лондон", zone: "Europe/London", lat: 51.5, lon: -.1, aliases: "london" },
  { city: "Париж", zone: "Europe/Paris", lat: 48.9, lon: 2.3, aliases: "paris" },
  { city: "Берлин", zone: "Europe/Berlin", lat: 52.5, lon: 13.4, aliases: "berlin" },
  { city: "Рим", zone: "Europe/Rome", lat: 41.9, lon: 12.5, aliases: "rome roma рим italy italia италия италии" },
  { city: "Милан", zone: "Europe/Rome", lat: 45.5, lon: 9.2, aliases: "milan milano милан italy italia италия италии" },
  { city: "Мадрид", zone: "Europe/Madrid", lat: 40.4, lon: -3.7, aliases: "madrid мадрид spain испания" },
  { city: "Лиссабон", zone: "Europe/Lisbon", lat: 38.7, lon: -9.1, aliases: "lisbon lisboa лиссабон portugal португалия" },
  { city: "Стамбул", zone: "Europe/Istanbul", lat: 41, lon: 29, aliases: "istanbul" },
  { city: "Дубай", zone: "Asia/Dubai", lat: 25.2, lon: 55.3, aliases: "dubai" },
  { city: "Тбилиси", zone: "Asia/Tbilisi", lat: 41.7, lon: 44.8, aliases: "tbilisi" },
  { city: "Алматы", zone: "Asia/Almaty", lat: 43.2, lon: 76.9, aliases: "almaty" },
  { city: "Дели", zone: "Asia/Kolkata", lat: 28.6, lon: 77.2, aliases: "delhi india индия" },
  { city: "Бангкок", zone: "Asia/Bangkok", lat: 13.8, lon: 100.5, aliases: "bangkok" },
  { city: "Сингапур", zone: "Asia/Singapore", lat: 1.3, lon: 103.8, aliases: "singapore" },
  { city: "Гонконг", zone: "Asia/Hong_Kong", lat: 22.3, lon: 114.2, aliases: "hong kong" },
  { city: "Пекин", zone: "Asia/Shanghai", lat: 39.9, lon: 116.4, aliases: "beijing china китай" },
  { city: "Сеул", zone: "Asia/Seoul", lat: 37.6, lon: 127, aliases: "seoul корея" },
  { city: "Токио", zone: "Asia/Tokyo", lat: 35.7, lon: 139.7, aliases: "tokyo япония" },
  { city: "Сидней", zone: "Australia/Sydney", lat: -33.9, lon: 151.2, aliases: "sydney" },
  { city: "Нью-Йорк", zone: "America/New_York", lat: 40.7, lon: -74, aliases: "new york nyc" },
  { city: "Чикаго", zone: "America/Chicago", lat: 41.9, lon: -87.6, aliases: "chicago" },
  { city: "Денвер", zone: "America/Denver", lat: 39.7, lon: -105, aliases: "denver" },
  { city: "Лос-Анджелес", zone: "America/Los_Angeles", lat: 34.1, lon: -118.2, aliases: "los angeles la" },
  { city: "Торонто", zone: "America/Toronto", lat: 43.7, lon: -79.4, aliases: "toronto" },
  { city: "Мехико", zone: "America/Mexico_City", lat: 19.4, lon: -99.1, aliases: "mexico city" },
  { city: "Сан-Паулу", zone: "America/Sao_Paulo", lat: -23.6, lon: -46.6, aliases: "sao paulo" },
];

const SUPPORTED_TIME_ZONES = (() => {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : TIME_ZONE_CITIES.map((item) => item.zone);
  return [...new Set(["UTC", ...zones])];
})();
const mapView = { scale: 1, x: 0, y: 0 };

function cityForZone(zone) {
  return TIME_ZONE_CITIES.find((item) => item.zone === zone)?.city ?? zone.split("/").at(-1).replaceAll("_", " ");
}

function timeZoneOffset(zone) {
  try {
    return new Intl.DateTimeFormat("ru-RU", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value.replace("GMT", "UTC") ?? "";
  } catch { return ""; }
}

function timeZoneClock(zone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat("ru-RU", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  } catch { return "--:--"; }
}

function applySelectedTimeZone(zone, city = null) {
  if (zone === "local") zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try { new Intl.DateTimeFormat("ru-RU", { timeZone: zone }).format(); } catch { zone = "Europe/Moscow"; }
  state.timeZone = zone;
  state.selectedTimeZoneCity = city || state.selectedTimeZoneCity || cityForZone(zone);
  if (!TIME_ZONE_CITIES.some((item) => item.city === state.selectedTimeZoneCity && item.zone === zone)) state.selectedTimeZoneCity = cityForZone(zone);
  localStorage.setItem(STORAGE_KEYS.timeZone, zone);
  localStorage.setItem(STORAGE_KEYS.timeZoneCity, state.selectedTimeZoneCity);
  els.timeZoneCity.textContent = state.selectedTimeZoneCity;
  els.timeZoneCity.title = `${zone} · ${timeZoneOffset(zone)}`;
  priceChart.setTimeZone(zone);
  for (const panel of extraCharts.values()) panel.chart.setTimeZone(zone);
  els.timeZoneMarkers.querySelectorAll(".timezone-marker").forEach((marker) => marker.classList.toggle("is-active", marker.dataset.zone === zone && marker.getAttribute("aria-label")?.startsWith(state.selectedTimeZoneCity)));
  updateClock();
}

function renderTimeZoneMarkers() {
  const fragment = document.createDocumentFragment();
  for (const item of TIME_ZONE_CITIES) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "timezone-marker";
    marker.classList.toggle("is-active", item.zone === state.timeZone && item.city === state.selectedTimeZoneCity);
    marker.dataset.zone = item.zone;
    marker.dataset.city = `${item.city} · ${timeZoneClock(item.zone)}`;
    marker.style.left = `${((item.lon + 180) / 360) * 100 - .35}%`;
    marker.style.top = `${((90 - item.lat) / 180) * 100 + 2.25}%`;
    marker.setAttribute("aria-label", `${item.city}, ${item.zone}`);
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      applySelectedTimeZone(item.zone, item.city);
      els.timeZoneDialog.close();
    });
    fragment.append(marker);
  }
  els.timeZoneMarkers.replaceChildren(fragment);
}

function renderTimeZoneResults() {
  const query = els.timeZoneSearch.value.trim().toLocaleLowerCase("ru");
  let candidates;
  if (!query) candidates = TIME_ZONE_CITIES.map((item) => ({ city: item.city, zone: item.zone, aliases: item.aliases }));
  else {
    const curated = TIME_ZONE_CITIES.filter((item) => `${item.city} ${item.zone} ${item.aliases}`.toLocaleLowerCase("ru").includes(query));
    const extra = SUPPORTED_TIME_ZONES.filter((zone) => `${zone} ${zone.replaceAll("_", " ")}`.toLocaleLowerCase("ru").includes(query)).map((zone) => ({ city: cityForZone(zone), zone }));
    candidates = [...curated, ...extra];
  }
  const unique = [...new Map(candidates.map((item) => [`${item.city}:${item.zone}`, item])).values()].slice(0, 48);
  const fragment = document.createDocumentFragment();
  for (const item of unique) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("is-active", item.zone === state.timeZone && item.city === state.selectedTimeZoneCity);
    button.textContent = `${item.city} · ${timeZoneClock(item.zone)} · ${timeZoneOffset(item.zone)}`;
    button.title = item.zone;
    button.addEventListener("click", () => {
      applySelectedTimeZone(item.zone, item.city);
      els.timeZoneDialog.close();
    });
    fragment.append(button);
  }
  els.timeZoneResults.replaceChildren(fragment);
}

function renderTimeZoneLines() {
  if (!els.timeZoneZoneLines) return;
  const fragment = document.createDocumentFragment();
  for (let offset = -12; offset <= 14; offset += .5) {
    const line = document.createElement("span");
    const isInteger = Number.isInteger(offset);
    const isMajor = isInteger && Math.abs(offset) % 3 === 0;
    line.className = `timezone-zone-line${offset === 0 ? " is-zero" : ""}${isMajor ? " is-major" : isInteger ? " is-minor" : " is-half"}`;
    line.style.left = `${((offset * 15 + 180) / 360) * 100}%`;
    line.dataset.offset = String(offset);
    const label = document.createElement("span");
    label.textContent = isInteger ? `UTC${offset >= 0 ? "+" : ""}${offset}` : "";
    line.append(label);
    fragment.append(line);
  }
  els.timeZoneZoneLines.replaceChildren(fragment);
}

function updateTimeZoneClocks() {
  for (const marker of els.timeZoneMarkers?.querySelectorAll(".timezone-marker") ?? []) {
    const item = TIME_ZONE_CITIES.find((city) => city.zone === marker.dataset.zone && marker.getAttribute("aria-label")?.startsWith(city.city));
    if (item) marker.dataset.city = `${item.city} · ${timeZoneClock(item.zone)}`;
  }
  if (els.timeZoneDialog?.open) renderTimeZoneResults();
}

function applyMapTransform() {
  els.timeZoneMapWorld.style.transform = `translate(${mapView.x}px, ${mapView.y}px) scale(${mapView.scale})`;
  els.timeZoneMap.dataset.zoom = mapView.scale >= 1.85 ? "fine" : mapView.scale >= 1.3 ? "medium" : "wide";
}

function bindTimeZonePicker() {
  applySelectedTimeZone(state.timeZone, state.selectedTimeZoneCity);
  renderTimeZoneLines();
  renderTimeZoneMarkers();
  applyMapTransform();
  els.timeZoneOpen.addEventListener("click", () => {
    els.timeZoneSearch.value = "";
    renderTimeZoneResults();
    els.timeZoneDialog.showModal();
  });
  els.timeZoneClose.addEventListener("click", () => els.timeZoneDialog.close());
  els.timeZoneSearch.addEventListener("input", renderTimeZoneResults);
  els.timeZoneMap.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = els.timeZoneMap.getBoundingClientRect();
    const previousScale = mapView.scale;
    const nextScale = Math.max(1, Math.min(2.3, previousScale * (event.deltaY < 0 ? 1.18 : .86)));
    const pointerX = event.clientX - rect.left - rect.width / 2;
    const pointerY = event.clientY - rect.top - rect.height / 2;
    const ratio = nextScale / previousScale;
    mapView.x = pointerX - (pointerX - mapView.x) * ratio;
    mapView.y = pointerY - (pointerY - mapView.y) * ratio;
    mapView.scale = nextScale;
    const limitX = rect.width * (nextScale - 1) / 2;
    const limitY = rect.height * (nextScale - 1) / 2;
    mapView.x = Math.max(-limitX, Math.min(limitX, mapView.x));
    mapView.y = Math.max(-limitY, Math.min(limitY, mapView.y));
    if (nextScale === 1) mapView.x = mapView.y = 0;
    applyMapTransform();
  }, { passive: false });
  els.timeZoneMap.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".timezone-marker")) return;
    els.timeZoneMap.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, mapX: mapView.x, mapY: mapView.y };
    const move = (moveEvent) => {
      const rect = els.timeZoneMap.getBoundingClientRect();
      const limitX = rect.width * (mapView.scale - 1) / 2;
      const limitY = rect.height * (mapView.scale - 1) / 2;
      mapView.x = Math.max(-limitX, Math.min(limitX, start.mapX + moveEvent.clientX - start.x));
      mapView.y = Math.max(-limitY, Math.min(limitY, start.mapY + moveEvent.clientY - start.y));
      applyMapTransform();
    };
    const stop = () => {
      els.timeZoneMap.removeEventListener("pointermove", move);
      els.timeZoneMap.removeEventListener("pointerup", stop);
      els.timeZoneMap.removeEventListener("pointercancel", stop);
    };
    els.timeZoneMap.addEventListener("pointermove", move);
    els.timeZoneMap.addEventListener("pointerup", stop);
    els.timeZoneMap.addEventListener("pointercancel", stop);
  });
}

function bindEvents() {
  normalizeWorkspace();
  persistWorkspace();
  applyRadarColumns();
  for (const model of state.workspace.extras) {
    if (model.type === "orderbook") mountOrderBook(model);
    else mountExtraChart(model);
  }
  applyWorkspaceLayout();
  els.comfortSlider.value = String(state.comfort);
  els.comfortSlider.addEventListener("input", () => {
    state.comfort = Number(els.comfortSlider.value);
    localStorage.setItem(STORAGE_KEYS.comfort, String(state.comfort));
    applyComfort(state.comfort);
  });

  els.radarSearch.addEventListener("input", () => {
    state.radarSearch = els.radarSearch.value.trim().toLowerCase();
    renderTopList(state.lastMetrics);
  });
  syncRadarFilterUi();
  els.radarFilterToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    els.radarFilterPanel.hidden = !els.radarFilterPanel.hidden;
    els.radarFilterToggle.setAttribute("aria-expanded", String(!els.radarFilterPanel.hidden));
  });
  els.radarFilterAdd.addEventListener("click", () => {
    const value = Number(els.radarFilterValue.value);
    if (!Number.isFinite(value)) {
      els.radarFilterValue.focus();
      return;
    }
    state.radarFilters.push({ metric: els.radarFilterMetric.value, operator: els.radarFilterOperator.value, value });
    localStorage.setItem(STORAGE_KEYS.radarFilters, JSON.stringify(state.radarFilters));
    els.radarFilterValue.value = "";
    syncRadarFilterUi();
    renderTopList(state.lastMetrics);
  });
  els.radarFilterValue.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.radarFilterAdd.click();
    }
  });
  els.radarFilterReset.addEventListener("click", () => {
    state.radarFilters = [];
    localStorage.setItem(STORAGE_KEYS.radarFilters, "[]");
    syncRadarFilterUi();
    renderTopList(state.lastMetrics);
  });
  for (const handle of els.columnResizers) {
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      const index = Number(handle.dataset.columnIndex);
      const nextIndex = index + 1;
      const startX = event.clientX;
      const start = state.radarColumns.slice();
      const total = start.reduce((sum, value) => sum + value, 0);
      const width = Math.max(200, document.querySelector(".top-card").getBoundingClientRect().width);
      const move = (moveEvent) => {
        const delta = ((moveEvent.clientX - startX) / width) * total;
        const safeDelta = Math.max(.45 - start[index], Math.min(start[nextIndex] - .45, delta));
        state.radarColumns[index] = start[index] + safeDelta;
        state.radarColumns[nextIndex] = start[nextIndex] - safeDelta;
        applyRadarColumns();
      };
      const stop = () => {
        localStorage.setItem(STORAGE_KEYS.radarColumns, JSON.stringify(state.radarColumns));
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
  }
  bindGridResizer(els.chartResizer, state.workspace.primary, priceChart);
  bindGridResizer(els.radarResizer, state.workspace.radar);
  bindGridResizer(els.scannerResizer, state.workspace.scanner);
  bindPanelDrag(document.querySelector(".primary-chart .panel-grip"), state.workspace.primary);
  bindPanelDrag(document.querySelector(".top-card .panel-grip"), state.workspace.radar);
  bindPanelDrag(document.querySelector(".workspace-panel .scanner-grip"), state.workspace.scanner);
  for (const button of els.addPanelButtons) {
    button.addEventListener("click", () => {
      panelPickerType = button.dataset.addPanel;
      els.panelPickerTitle.textContent = panelPickerType === "orderbook" ? "Добавить стакан" : "Добавить график";
      els.chartPickerSearch.value = "";
      renderChartPicker();
      els.addChartDialog.showModal();
    });
    button.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes("text/inpuls-symbol")) return;
      event.preventDefault();
      button.classList.add("is-drop-target");
    });
    button.addEventListener("dragleave", () => button.classList.remove("is-drop-target"));
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      button.classList.remove("is-drop-target");
      createExtraPanel(event.dataTransfer.getData("text/inpuls-symbol"), button.dataset.addPanel);
    });
  }
  els.addChartClose.addEventListener("click", () => els.addChartDialog.close());
  els.chartPickerSearch.addEventListener("input", renderChartPicker);
  bindTimeZonePicker();
  bindChartToolbox(document.querySelector(".primary-chart"), priceChart, true);
  els.chartSymbol.title = "Нажми, чтобы скопировать тикер";
  els.chartSymbol.addEventListener("click", () => copyTicker(state.selectedChartSymbol));

  let inplayEditorBackup = null;
  const cancelInplayEditor = () => {
    if (inplayEditorBackup) state.inplay = inplayEditorBackup;
    inplayEditorBackup = null;
    els.inplayDialog.close();
    renderInPlay(state.lastMetrics);
  };
  els.inplaySettings.addEventListener("click", () => {
    inplayEditorBackup = structuredClone(state.inplay);
    renderInPlayEditor();
    els.inplayDialog.showModal();
  });
  els.inplayClose.addEventListener("click", cancelInplayEditor);
  els.inplayCancel.addEventListener("click", cancelInplayEditor);
  els.inplayDialog.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    collectInPlayRules();
    inplayEditorBackup = null;
    els.inplayDialog.close();
    renderInPlay(state.lastMetrics);
  });

  document.body.dataset.mobileView = "chart";
  els.mobileViewButtons.forEach((button) => button.addEventListener("click", () => {
    document.body.dataset.mobileView = button.dataset.mobileView;
    els.mobileViewButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    requestAnimationFrame(() => {
      applyWorkspaceLayout();
      priceChart.render();
    });
  }));

  els.volumeToggle.classList.toggle("is-collapsed", !state.volumeVisible);
  els.volumeToggle.setAttribute("aria-pressed", String(state.volumeVisible));
  els.volumeToggle.textContent = state.volumeVisible ? "ОБЪЁМ ▾" : "ОБЪЁМ ▸";
  els.volumeToggle.addEventListener("click", () => {
    state.volumeVisible = !state.volumeVisible;
    localStorage.setItem(STORAGE_KEYS.volume, JSON.stringify(state.volumeVisible));
    els.volumeToggle.classList.toggle("is-collapsed", !state.volumeVisible);
    els.volumeToggle.setAttribute("aria-pressed", String(state.volumeVisible));
    els.volumeToggle.textContent = state.volumeVisible ? "ОБЪЁМ ▾" : "ОБЪЁМ ▸";
    priceChart.setVolumeVisible(state.volumeVisible);
  });

  const syncSessionButton = () => {
    els.sessionToggle.classList.toggle("is-collapsed", !state.sessionsVisible);
    els.sessionToggle.setAttribute("aria-pressed", String(state.sessionsVisible));
    els.sessionToggle.textContent = state.sessionsVisible ? "СЕССИИ ON" : "СЕССИИ OFF";
  };
  syncSessionButton();
  els.sessionToggle.addEventListener("click", () => {
    state.sessionsVisible = !state.sessionsVisible;
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(state.sessionsVisible));
    priceChart.setSessionsVisible(state.sessionsVisible);
    for (const panel of extraCharts.values()) panel.chart.setSessionsVisible(state.sessionsVisible);
    syncSessionButton();
  });

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

  for (const button of els.topSortButtons) {
    button.addEventListener("click", () => {
      const key = button.dataset.topSort;
      state.topSort = {
        key,
        direction: state.topSort.key === key && state.topSort.direction === "desc" ? "asc" : "desc",
      };
      renderTopList(state.lastMetrics);
    });
  }
  for (const button of els.timeframeButtons) {
    button.addEventListener("click", () => {
      selectInterval(button.dataset.interval);
    });
  }
  els.moreTimeframe.addEventListener("change", () => {
    if (els.moreTimeframe.value) selectInterval(els.moreTimeframe.value);
  });
  for (const button of els.rangeButtons) button.addEventListener("click", () => selectRange(button.dataset.range));

  els.settingsButton?.addEventListener("click", () => {
    for (const [key, value] of Object.entries(state.settings)) {
      const input = els.settingsForm.elements.namedItem(key);
      if (input) input.value = value;
    }
    els.settingsDialog.showModal();
  });
  els.fontScale?.addEventListener("input", () => {
    applyFontScale(els.fontScale.value);
    localStorage.setItem(STORAGE_KEYS.fontScale, String(state.fontScale));
    requestAnimationFrame(() => {
      priceChart.render();
      for (const panel of extraCharts.values()) panel.chart.render();
    });
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
  document.querySelector("#settings-close")?.addEventListener("click", () => els.settingsDialog.close());
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
els.timeframeButtons.forEach((item) => item.classList.toggle("is-active", item.dataset.interval === state.chartInterval));
els.rangeButtons.forEach((item) => item.classList.toggle("is-active", item.dataset.range === state.chartRange));
els.moreTimeframe.value = state.chartInterval;
klineFeed.select(state.selectedChartSymbol, state.chartInterval, state.chartRange);
loadChartStats(state.selectedChartSymbol);
setInterval(render, 1000);
setInterval(updateTrackedSymbols, 15_000);
setTimeout(warmupRadarHistory, 1500);
setInterval(warmupRadarHistory, 5000);
function updateClock() {
  els.clock.textContent = new Intl.DateTimeFormat("ru-RU", {
    ...(state.timeZone === "local" ? {} : { timeZone: state.timeZone }),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
  updateTimeZoneClocks();
}
setInterval(updateClock, 1000);
updateClock();
render();

// During active development always prefer the current GitHub Pages build.
// Offline PWA caching will return after the interface stabilizes.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("inpuls-")).map((key) => caches.delete(key)));
    }
  });
}
