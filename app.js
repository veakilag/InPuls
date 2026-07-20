import {
  DEFAULT_SETTINGS,
  SymbolState,
  filterUsdtPerpetualTicker,
  formatCompactUsd,
} from "./engine.js?v=13";
import { calculateNatr, CandlestickChart, KlineFeed, parseRestKline, pearsonCorrelation } from "./chart.js?v=13";

const STORAGE_KEYS = {
  settings: "inpuls-settings-v1",
  favorites: "inpuls-favorites-v1",
  sound: "inpuls-sound-v1",
  chart: "inpuls-chart-v2",
  timeZone: "inpuls-timezone-v1",
  volume: "inpuls-volume-v1",
  comfort: "inpuls-comfort-v1",
  workspace: "inpuls-workspace-v2",
  radarColumns: "inpuls-radar-columns-v1",
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
  volumeVisible: loadJson(STORAGE_KEYS.volume, true),
  comfort: Number(localStorage.getItem(STORAGE_KEYS.comfort) ?? 55),
  radarSearch: "",
  workspace: loadJson(STORAGE_KEYS.workspace, { primaryCols: 12, primaryRows: 2, radarCols: 4, radarRows: 2, extras: [] }),
  radarColumns: loadJson(STORAGE_KEYS.radarColumns, [1.3, 1, 1, 1, .8, .8]),
};

const els = {
  status: document.querySelector("#connection-status"),
  statusText: document.querySelector("#connection-text"),
  clock: document.querySelector("#clock"),
  comfortSlider: document.querySelector("#comfort-slider"),
  timeZoneSelect: document.querySelector("#timezone-select"),
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
  columnResizers: [...document.querySelectorAll("[data-column-index]")],
  radarResizer: document.querySelector("#radar-resizer"),
  addChartTile: document.querySelector("#add-chart-tile"),
  addChartDialog: document.querySelector("#add-chart-dialog"),
  addChartClose: document.querySelector("#add-chart-close"),
  chartPickerSearch: document.querySelector("#chart-picker-search"),
  chartPickerList: document.querySelector("#chart-picker-list"),
  metricTurnover: document.querySelector("#metric-turnover"),
  metricFunding: document.querySelector("#metric-funding"),
  metricFundingTime: document.querySelector("#metric-funding-time"),
  metricNatr1m: document.querySelector("#metric-natr-1m"),
  metricNatr5m: document.querySelector("#metric-natr-5m"),
  metricCorrelation: document.querySelector("#metric-correlation"),
  volumeToggle: document.querySelector("#volume-toggle"),
  chartResizer: document.querySelector("#chart-resizer"),
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
        if (ticker?.e === "markPriceUpdate" && ticker.s?.endsWith("USDT")) {
          getSymbol(ticker.s, Number(ticker.E) || Date.now()).updateFunding(ticker);
          continue;
        }
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
const radarHistoryLoaded = new Set();
const radarHistoryLoading = new Set();
const extraCharts = new Map();
let activeChartTheme = null;
const priceChart = new CandlestickChart(els.priceChart, els.chartTooltip);
priceChart.setTimeZone(state.timeZone === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : state.timeZone);
priceChart.setVolumeVisible(state.volumeVisible);
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
    bg: mixColor("#091513", "#050409", amount),
    panel: mixColor("#101d1a", "#0c0912", amount),
    panel2: mixColor("#162622", "#15101e", amount),
    line: mixColor("#29483f", "#30233f", amount),
    text: mixColor("#e0ece7", "#dfd7e7", amount),
    muted: mixColor("#80968e", "#897d95", amount),
    chart: mixColor("#07110f", "#050407", amount),
    bull: mixColor("#d9eee6", "#ddd6e4", amount),
    bear: mixColor("#13231f", "#15121a", amount),
    bearStroke: mixColor("#71958a", "#8e7f99", amount),
    grid: mixColor("#34564d", "#493b51", amount),
    crosshair: mixColor("#8aa89f", "#aa9bb5", amount),
    crosshairFill: mixColor("#276b5a", "#5e4968", amount),
    crosshairText: mixColor("#edf8f4", "#eee7f2", amount),
    violet: mixColor("#4fb99b", "#9b6bd6", amount),
    blue: mixColor("#6c9e90", "#80708d", amount),
    green: mixColor("#35d9a1", "#56cfaa", amount),
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
  root.style.setProperty("--violet", palette.violet);
  root.style.setProperty("--blue", palette.blue);
  root.style.setProperty("--green", palette.green);
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
    session: palette.violet,
  };
  priceChart.setTheme(activeChartTheme);
  for (const panel of extraCharts.values()) panel.chart.setTheme(activeChartTheme);
}

function selectInterval(interval) {
  state.chartInterval = interval;
  const secondRangeCaps = { "1s": "15m", "5s": "1h", "15s": "4h" };
  if (secondRangeCaps[interval]) state.chartRange = secondRangeCaps[interval];
  persistChartSettings();
  els.timeframeButtons.forEach((item) => item.classList.toggle("is-active", item.dataset.interval === interval));
  els.rangeButtons.forEach((item) => item.classList.toggle("is-active", item.dataset.range === state.chartRange));
  els.moreTimeframe.value = els.timeframeButtons.some((item) => item.dataset.interval === interval) ? "" : interval;
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
  els.moreTimeframe.value = els.timeframeButtons.some((item) => item.dataset.interval === state.chartInterval) ? "" : state.chartInterval;
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
  renderTopList(metrics);
  updateExtraChartMetrics(metrics);
  updateChartHeader(metrics);
  if (state.selectedSymbol) renderDetail(state.selectedSymbol);
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
  let candidates = metrics.filter((item) => !state.radarSearch || item.symbol.toLowerCase().includes(state.radarSearch));
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
      valueCell("correlation", toneClass(item.correlation)),
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

function formatRadarMetric(item, metric) {
  const value = item[metric];
  if (metric === "quoteVolume24h") return formatCompactUsd(value);
  if (metric === "fundingRate") return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(3)}%` : "—";
  if (metric === "correlation") return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}` : "—";
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}

function normalizeWorkspace() {
  const workspace = state.workspace && typeof state.workspace === "object" ? state.workspace : {};
  workspace.primaryCols = Math.max(4, Math.min(13, Math.round(Number(workspace.primaryCols) || 12)));
  workspace.primaryRows = workspace.primaryRows === 1 ? 1 : 2;
  workspace.radarCols = Math.max(3, Math.min(8, Math.round(Number(workspace.radarCols) || 4)));
  workspace.radarRows = workspace.radarRows === 1 ? 1 : 2;
  workspace.extras = Array.isArray(workspace.extras)
    ? workspace.extras.filter((item) => item?.id && item?.symbol?.endsWith("USDT")).map((item) => ({
        id: String(item.id),
        symbol: item.symbol,
        interval: item.interval || "1m",
        cols: Math.max(4, Math.min(12, Math.round(Number(item.cols) || 4))),
        rows: item.rows === 2 ? 2 : 1,
      }))
    : [];
  if (workspace.primaryCols + workspace.radarCols > 16) workspace.primaryCols = 16 - workspace.radarCols;
  while (workspace.primaryCols * workspace.primaryRows + workspace.radarCols * workspace.radarRows + workspace.extras.reduce((sum, item) => sum + item.cols * item.rows, 0) > 32) workspace.extras.pop();
  state.workspace = workspace;
  while (state.workspace.extras.length && !canApplyWorkspace()) state.workspace.extras.pop();
}

function persistWorkspace() {
  localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify(state.workspace));
}

function workspaceCells(overrides = {}) {
  const primaryCols = overrides.primaryCols ?? state.workspace.primaryCols;
  const primaryRows = overrides.primaryRows ?? state.workspace.primaryRows;
  const radarCols = overrides.radarCols ?? state.workspace.radarCols;
  const radarRows = overrides.radarRows ?? state.workspace.radarRows;
  const extras = overrides.extras ?? state.workspace.extras;
  return primaryCols * primaryRows + radarCols * radarRows + extras.reduce((sum, item) => sum + item.cols * item.rows, 0);
}

function canApplyWorkspace(overrides = {}) {
  const primaryCols = overrides.primaryCols ?? state.workspace.primaryCols;
  const primaryRows = overrides.primaryRows ?? state.workspace.primaryRows;
  const radarCols = overrides.radarCols ?? state.workspace.radarCols;
  const radarRows = overrides.radarRows ?? state.workspace.radarRows;
  const extras = overrides.extras ?? state.workspace.extras;
  if (primaryCols + radarCols > 16 || workspaceCells(overrides) > 32) return false;
  const grid = Array.from({ length: 2 }, () => Array(16).fill(false));
  const occupy = (start, cols, rows) => {
    for (let row = 0; row < rows; row += 1) {
      for (let col = start; col < start + cols; col += 1) {
        if (grid[row]?.[col]) return false;
        grid[row][col] = true;
      }
    }
    return true;
  };
  if (!occupy(0, primaryCols, primaryRows) || !occupy(16 - radarCols, radarCols, radarRows)) return false;
  for (const item of extras) {
    let placed = false;
    for (let row = 0; row <= 2 - item.rows && !placed; row += 1) {
      for (let col = 0; col <= 16 - item.cols && !placed; col += 1) {
        let free = true;
        for (let y = row; y < row + item.rows; y += 1) {
          for (let x = col; x < col + item.cols; x += 1) free &&= !grid[y][x];
        }
        if (!free) continue;
        for (let y = row; y < row + item.rows; y += 1) {
          for (let x = col; x < col + item.cols; x += 1) grid[y][x] = true;
        }
        placed = true;
      }
    }
    if (!placed) return false;
  }
  return true;
}

function hasChartSlot() {
  return canApplyWorkspace({ extras: [...state.workspace.extras, { id: "slot", cols: 4, rows: 1 }] });
}

function applyRadarColumns() {
  if (!Array.isArray(state.radarColumns) || state.radarColumns.length !== 6) state.radarColumns = [1.3, 1, 1, 1, .8, .8];
  state.radarColumns.forEach((value, index) => els.marketFocus.style.setProperty(`--radar-col-${index + 1}`, `${Math.max(.45, Number(value) || 1)}fr`));
}

function applyWorkspaceLayout() {
  const primary = document.querySelector(".primary-chart");
  primary.style.gridColumn = `1 / span ${state.workspace.primaryCols}`;
  primary.style.gridRow = `1 / span ${state.workspace.primaryRows}`;
  const radarStart = 17 - state.workspace.radarCols;
  document.querySelector(".top-card").style.gridColumn = `${radarStart} / 17`;
  document.querySelector(".top-card").style.gridRow = `1 / span ${state.workspace.radarRows}`;
  for (const panel of extraCharts.values()) {
    panel.element.style.gridColumn = `span ${panel.model.cols}`;
    panel.element.style.gridRow = `span ${panel.model.rows}`;
  }
  els.addChartTile.hidden = !hasChartSlot();
  requestAnimationFrame(() => {
    priceChart.render();
    for (const panel of extraCharts.values()) panel.chart.render();
  });
}

function bindGridResizer(handle, model, type, chart) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    const rect = els.marketFocus.getBoundingClientRect();
    const columnUnit = Math.max(28, (rect.width - 15) / 16);
    const rowHeight = Math.max(80, (rect.height - 5) / 2);
    const startX = event.clientX;
    const startY = event.clientY;
    const startCols = model.cols ?? (type === "primary" ? state.workspace.primaryCols : state.workspace.radarCols);
    const startRows = model.rows ?? (type === "primary" ? state.workspace.primaryRows : state.workspace.radarRows);
    const move = (moveEvent) => {
      const direction = type === "radar" ? -1 : 1;
      const minimum = type === "radar" ? 3 : 4;
      const maximum = type === "primary" ? 13 : type === "radar" ? 8 : 12;
      const cols = Math.max(minimum, Math.min(maximum, startCols + Math.round(((moveEvent.clientX - startX) * direction) / columnUnit)));
      const rows = Math.max(1, Math.min(2, startRows + Math.round((moveEvent.clientY - startY) / rowHeight)));
      if (type === "primary") {
        if (!canApplyWorkspace({ primaryCols: cols, primaryRows: rows })) return;
        state.workspace.primaryCols = cols;
        state.workspace.primaryRows = rows;
      } else if (type === "radar") {
        if (!canApplyWorkspace({ radarCols: cols, radarRows: rows })) return;
        state.workspace.radarCols = cols;
        state.workspace.radarRows = rows;
      } else {
        const extras = state.workspace.extras.map((item) => item.id === model.id ? { ...item, cols, rows } : item);
        if (!canApplyWorkspace({ extras })) return;
        model.cols = cols;
        model.rows = rows;
        const stored = state.workspace.extras.find((item) => item.id === model.id);
        if (stored && stored !== model) Object.assign(stored, { cols, rows });
      }
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

function intervalRange(interval) {
  return { "1s": "15m", "5s": "1h", "15s": "4h" }[interval] || "1h";
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
      </div></div>
      <button class="mini-chart-close" type="button" title="Закрыть график">×</button>
    </header>
    <div class="chart-stage">
      <div class="chart-metrics"><span><b>V24</b><strong data-mini-metric="quoteVolume24h">—</strong></span><span><b>NATR 1</b><strong data-mini-metric="natr1m">—</strong></span><span><b>NATR 5</b><strong data-mini-metric="natr5m">—</strong></span><span><b>F</b><strong data-mini-metric="fundingRate">—</strong></span><span><b>C</b><strong data-mini-metric="correlation">—</strong></span></div>
      <canvas aria-label="Дополнительный свечной график"></canvas><div class="chart-tooltip" hidden></div>
      <button class="chart-resizer" type="button" aria-label="Изменить размер графика"></button>
    </div>`;
  els.marketFocus.insertBefore(article, els.addChartTile);
  const chart = new CandlestickChart(article.querySelector("canvas"), article.querySelector(".chart-tooltip"));
  chart.setTimeZone(state.timeZone === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : state.timeZone);
  chart.setVolumeVisible(false);
  if (activeChartTheme) chart.setTheme(activeChartTheme);
  const panel = { model, element: article, chart, feed: null };
  panel.feed = new KlineFeed({ onData: (candles, meta) => chart.setData(candles, meta), onStatus() {} });
  extraCharts.set(model.id, panel);
  article.querySelectorAll("[data-mini-interval]").forEach((button) => button.addEventListener("click", () => {
    model.interval = button.dataset.miniInterval;
    article.querySelectorAll("[data-mini-interval]").forEach((item) => item.classList.toggle("is-active", item === button));
    persistWorkspace();
    panel.feed.select(model.symbol, model.interval, intervalRange(model.interval));
  }));
  article.querySelector(".mini-chart-close").addEventListener("click", () => removeExtraChart(model.id));
  bindGridResizer(article.querySelector(".chart-resizer"), model, "extra", chart);
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

function createExtraChart(symbol) {
  if (!symbol?.endsWith("USDT") || !hasChartSlot()) return false;
  const model = { id: `chart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, symbol, interval: "1m", cols: 4, rows: 1 };
  state.workspace.extras.push(model);
  persistWorkspace();
  mountExtraChart(model);
  applyWorkspaceLayout();
  return true;
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
  const candidates = state.lastMetrics.filter((item) => !query || item.symbol.toLowerCase().includes(query)).sort((left, right) => right.quoteVolume24h - left.quoteVolume24h).slice(0, 120);
  const fragment = document.createDocumentFragment();
  for (const item of candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.symbol.replace("USDT", "");
    button.addEventListener("click", () => {
      if (createExtraChart(item.symbol)) els.addChartDialog.close();
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
  els.metricCorrelation.className = Number.isFinite(stats.correlation) ? toneClass(stats.correlation) : "";
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
  normalizeWorkspace();
  persistWorkspace();
  applyRadarColumns();
  for (const model of state.workspace.extras) mountExtraChart(model);
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
  bindGridResizer(els.chartResizer, state.workspace, "primary", priceChart);
  bindGridResizer(els.radarResizer, state.workspace, "radar");
  els.addChartTile.addEventListener("click", () => {
    els.chartPickerSearch.value = "";
    renderChartPicker();
    els.addChartDialog.showModal();
  });
  els.addChartTile.addEventListener("dragover", (event) => {
    if (!event.dataTransfer.types.includes("text/inpuls-symbol")) return;
    event.preventDefault();
    els.addChartTile.classList.add("is-drop-target");
  });
  els.addChartTile.addEventListener("dragleave", () => els.addChartTile.classList.remove("is-drop-target"));
  els.addChartTile.addEventListener("drop", (event) => {
    event.preventDefault();
    els.addChartTile.classList.remove("is-drop-target");
    createExtraChart(event.dataTransfer.getData("text/inpuls-symbol"));
  });
  els.addChartClose.addEventListener("click", () => els.addChartDialog.close());
  els.chartPickerSearch.addEventListener("input", renderChartPicker);
  els.timeZoneSelect.value = state.timeZone;
  els.timeZoneSelect.addEventListener("change", () => {
    state.timeZone = els.timeZoneSelect.value;
    localStorage.setItem(STORAGE_KEYS.timeZone, state.timeZone);
    const zone = state.timeZone === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : state.timeZone;
    priceChart.setTimeZone(zone);
    for (const panel of extraCharts.values()) panel.chart.setTimeZone(zone);
    updateClock();
  });

  els.volumeToggle.classList.toggle("is-collapsed", !state.volumeVisible);
  els.volumeToggle.addEventListener("click", () => {
    state.volumeVisible = !state.volumeVisible;
    localStorage.setItem(STORAGE_KEYS.volume, JSON.stringify(state.volumeVisible));
    els.volumeToggle.classList.toggle("is-collapsed", !state.volumeVisible);
    priceChart.setVolumeVisible(state.volumeVisible);
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
els.timeframeButtons.forEach((item) => item.classList.toggle("is-active", item.dataset.interval === state.chartInterval));
els.rangeButtons.forEach((item) => item.classList.toggle("is-active", item.dataset.range === state.chartRange));
els.moreTimeframe.value = els.timeframeButtons.some((item) => item.dataset.interval === state.chartInterval) ? "" : state.chartInterval;
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
