import {
  createBreakoutAtrStrategy,
  runTrainTest,
} from "./algo-backtest.js";
import { fetchBinanceFuturesKlines } from "./binance-history.js";
import {
  DEFAULT_INPLAY_RULES,
  fetchCurrentInPlayUniverse,
  normalizeInPlayRules,
  selectInPlayMetrics,
} from "./inplay-universe.js";

const FIXED_SYMBOLS = Object.freeze(["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"]);
const RUN_HISTORY_KEY = "inpuls-owner-algo-lab-runs-v1";
const FORM_STATE_KEY = "inpuls-owner-algo-lab-form-v1";
const INPULS_RULES_KEY = "inpuls-inplay-v2";
const INPULS_ORDER_KEY = "inpuls-inplay-order-v1";
const MAX_HISTORY_RUNS = 12;
const MAX_CANDLES_PER_SYMBOL = 50_000;
const INTERVAL_MINUTES = Object.freeze({ "1m": 1, "3m": 3, "5m": 5, "15m": 15 });

const elements = {
  form: document.querySelector("#backtest-form"),
  interval: document.querySelector("#interval"),
  days: document.querySelector("#days"),
  inplayLimit: document.querySelector("#inplay-limit"),
  concurrency: document.querySelector("#concurrency"),
  minV24: document.querySelector("#min-v24"),
  minNatr1: document.querySelector("#min-natr1"),
  minNatr5: document.querySelector("#min-natr5"),
  minGrowth24: document.querySelector("#min-growth24"),
  loadInPulsRules: document.querySelector("#load-inpuls-rules"),
  refreshInPlay: document.querySelector("#refresh-inplay"),
  runBacktest: document.querySelector("#run-backtest"),
  cancelRun: document.querySelector("#cancel-run"),
  fixedSymbols: document.querySelector("#fixed-symbols"),
  inplaySymbols: document.querySelector("#inplay-symbols"),
  universeTime: document.querySelector("#universe-time"),
  universeCount: document.querySelector("#universe-count"),
  runTitle: document.querySelector("#run-title"),
  runStatus: document.querySelector("#run-status"),
  runProgress: document.querySelector("#run-progress"),
  progressBar: document.querySelector("#progress-bar"),
  statTrades: document.querySelector("#stat-trades"),
  statProfitable: document.querySelector("#stat-profitable"),
  statReturn: document.querySelector("#stat-return"),
  statPf: document.querySelector("#stat-pf"),
  statFailures: document.querySelector("#stat-failures"),
  resultsBody: document.querySelector("#results-body"),
  exportRun: document.querySelector("#export-run"),
  clearHistory: document.querySelector("#clear-history"),
  runHistory: document.querySelector("#run-history"),
};

const state = {
  inplay: null,
  latestRun: null,
  runId: 0,
  running: false,
};

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function finiteOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formSettings() {
  const interval = elements.interval.value;
  const days = Number(elements.days.value);
  const inplayLimit = Number(elements.inplayLimit.value);
  const concurrency = Number(elements.concurrency.value);
  const rules = normalizeInPlayRules({
    minV24: finiteOrNull(elements.minV24.value),
    minNatr1: finiteOrNull(elements.minNatr1.value),
    minNatr5: finiteOrNull(elements.minNatr5.value),
    minGrowth24: finiteOrNull(elements.minGrowth24.value),
  });

  if (!Object.hasOwn(INTERVAL_MINUTES, interval)) throw new RangeError("Неподдерживаемый таймфрейм");
  if (!Number.isInteger(days) || days < 2 || days > 365) throw new RangeError("История должна быть от 2 до 365 дней");
  if (!Number.isInteger(inplayLimit) || inplayLimit < 1 || inplayLimit > 18) throw new RangeError("INPLAY: от 1 до 18 монет");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new RangeError("Параллельных загрузок: от 1 до 4");

  const expectedCandles = Math.ceil((days * 24 * 60) / INTERVAL_MINUTES[interval]);
  if (expectedCandles > MAX_CANDLES_PER_SYMBOL) {
    const maxDays = Math.floor((MAX_CANDLES_PER_SYMBOL * INTERVAL_MINUTES[interval]) / (24 * 60));
    throw new RangeError(`Для ${interval} выбери не больше ${maxDays} дней за один запуск`);
  }

  return { interval, days, inplayLimit, concurrency, rules };
}

function applyRulesToForm(rules) {
  const normalized = normalizeInPlayRules(rules);
  elements.minV24.value = normalized.minV24 ?? "";
  elements.minNatr1.value = normalized.minNatr1 ?? "";
  elements.minNatr5.value = normalized.minNatr5 ?? "";
  elements.minGrowth24.value = normalized.minGrowth24 ?? "";
}

function loadFormState() {
  const saved = readJson(FORM_STATE_KEY, null);
  if (!saved) return;
  if (Object.hasOwn(INTERVAL_MINUTES, saved.interval)) elements.interval.value = saved.interval;
  if (Number.isInteger(saved.days)) elements.days.value = saved.days;
  if (Number.isInteger(saved.inplayLimit)) elements.inplayLimit.value = saved.inplayLimit;
  if (Number.isInteger(saved.concurrency)) elements.concurrency.value = saved.concurrency;
  applyRulesToForm(saved.rules ?? DEFAULT_INPLAY_RULES);
}

function createChip(symbol, detail = "", className = "") {
  const chip = document.createElement("span");
  chip.className = `chip ${className}`.trim();
  const strong = document.createElement("strong");
  strong.textContent = symbol.replace("USDT", "");
  chip.append(strong);
  if (detail) {
    const span = document.createElement("span");
    span.textContent = detail;
    chip.append(span);
  }
  return chip;
}

function renderFixedSymbols() {
  elements.fixedSymbols.replaceChildren(...FIXED_SYMBOLS.map((symbol) => createChip(symbol, "BASE")));
}

function formatPercent(value, digits = 2) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%` : "—";
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatMoney(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} USDT` : "—";
}

function renderInPlay(snapshot) {
  if (!snapshot?.matches?.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "По текущим правилам монеты не найдены";
    elements.inplaySymbols.replaceChildren(empty);
    elements.universeCount.textContent = `${FIXED_SYMBOLS.length} монеты`;
    return;
  }
  const chips = snapshot.matches.map((item) => {
    const details = [
      Number.isFinite(item.change24h) ? formatPercent(item.change24h, 1) : null,
      Number.isFinite(item.natr1m) ? `N1 ${item.natr1m.toFixed(2)}` : null,
    ].filter(Boolean).join(" · ");
    return createChip(item.symbol, details, "inplay");
  });
  elements.inplaySymbols.replaceChildren(...chips);
  const combined = new Set([...FIXED_SYMBOLS, ...snapshot.matches.map((item) => item.symbol)]);
  elements.universeCount.textContent = `${combined.size} монет`;
  elements.universeTime.textContent = `Снимок: ${new Date(snapshot.capturedAt).toLocaleString("ru-RU")}`;
}

function setRunUi({ title, status, completed = 0, total = 0, running = state.running } = {}) {
  if (title !== undefined) elements.runTitle.textContent = title;
  if (status !== undefined) elements.runStatus.textContent = status;
  elements.runProgress.textContent = `${completed} / ${total}`;
  elements.progressBar.style.width = total ? `${Math.min(100, (completed / total) * 100)}%` : "0%";
  elements.cancelRun.disabled = !running;
  elements.runBacktest.disabled = running;
  elements.refreshInPlay.disabled = running;
}

function setError(message) {
  setRunUi({ title: "Ошибка", status: message, completed: 0, total: 0, running: false });
}

async function refreshCurrentInPlay(settings = formSettings()) {
  writeJson(FORM_STATE_KEY, settings);
  setRunUi({ title: "Обновляю INPLAY", status: "Получаю текущий рынок Binance…", completed: 0, total: 0 });
  const previousOrder = readJson(INPULS_ORDER_KEY, []);
  const raw = await fetchCurrentInPlayUniverse({
    rules: settings.rules,
    limit: 100,
    now: Date.now(),
    concurrency: Math.min(6, settings.concurrency + 2),
  });
  const selected = selectInPlayMetrics(raw.matches, {
    rules: settings.rules,
    previousOrder,
    limit: settings.inplayLimit,
  });
  state.inplay = { ...raw, order: selected.order, matches: selected.matches };
  renderInPlay(state.inplay);
  setRunUi({
    title: "INPLAY обновлён",
    status: `Просканировано: ${raw.scanned}; ошибок метрик: ${raw.failed.length}`,
    completed: 0,
    total: 0,
  });
  return state.inplay;
}

function createPool(limit) {
  let active = 0;
  const queue = [];
  const advance = () => {
    while (active < limit && queue.length) {
      active += 1;
      const item = queue.shift();
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          advance();
        });
    }
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    advance();
  });
}

function printableMetrics(metrics) {
  return {
    trades: metrics.trades,
    winRatePercent: metrics.winRate * 100,
    profitFactor: metrics.profitFactor,
    netPnl: metrics.netPnl,
    returnPercent: metrics.returnPercent,
    maxDrawdownPercent: metrics.maxDrawdownPercent * 100,
    averageR: metrics.averageR,
    totalFees: metrics.totalFees,
  };
}

async function backtestSymbol({ symbol, source, settings, endTime, runId }) {
  if (runId !== state.runId) throw new DOMException("Запуск остановлен", "AbortError");
  const candles = await fetchBinanceFuturesKlines({
    symbol,
    interval: settings.interval,
    startTime: endTime - settings.days * 24 * 60 * 60_000,
    endTime,
    maxCandles: MAX_CANDLES_PER_SYMBOL,
  });
  if (runId !== state.runId) throw new DOMException("Запуск остановлен", "AbortError");
  const strategyFactory = () => createBreakoutAtrStrategy({
    lookback: 20,
    atrPeriod: 14,
    stopAtr: 1,
    rewardRisk: 1.5,
    minVolumeRatio: 1.2,
  });
  const result = runTrainTest({
    candles,
    strategyFactory,
    trainRatio: 0.7,
    contextBars: 100,
    config: {
      initialEquity: 1_000,
      riskPerTrade: 0.0025,
      feeRate: 0.0005,
      slippageRate: 0.0002,
      maxLeverage: 1,
    },
  });
  return {
    symbol,
    source,
    candles: candles.length,
    splitTime: result.splitTime,
    train: printableMetrics(result.train.metrics),
    test: printableMetrics(result.test.metrics),
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(results, failures) {
  const returns = results.map((item) => item.test.returnPercent).filter(Number.isFinite);
  const finitePf = results.map((item) => item.test.profitFactor).filter(Number.isFinite);
  return {
    completedSymbols: results.length,
    failedSymbols: failures.length,
    profitableOutOfSample: results.filter((item) => item.test.netPnl > 0).length,
    totalOutOfSampleTrades: results.reduce((sum, item) => sum + item.test.trades, 0),
    medianOutOfSampleReturnPercent: median(returns),
    averageFiniteOutOfSampleProfitFactor: finitePf.length
      ? finitePf.reduce((sum, value) => sum + value, 0) / finitePf.length
      : null,
  };
}

function assessment(metrics) {
  if (!metrics.trades) return { text: "Нет выборки", className: "" };
  if (metrics.netPnl > 0 && metrics.profitFactor >= 1.2 && metrics.maxDrawdownPercent < 10 && metrics.trades >= 30) {
    return { text: "Кандидат", className: "good" };
  }
  if (metrics.netPnl > 0) return { text: "Слабый плюс", className: "" };
  return { text: "Убыточно", className: "bad" };
}

function toneClass(value) {
  if (!Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "tone-good" : "tone-bad";
}

function appendCell(row, text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  row.append(cell);
}

function renderResults(run) {
  elements.resultsBody.replaceChildren();
  if (!run.results.length && !run.failures.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.className = "empty-cell";
    cell.textContent = "Нет результатов";
    row.append(cell);
    elements.resultsBody.append(row);
  }

  for (const item of run.results) {
    const row = document.createElement("tr");
    const verdict = assessment(item.test);
    appendCell(row, item.symbol.replace("USDT", ""));
    appendCell(row, item.source);
    appendCell(row, String(item.test.trades));
    appendCell(row, formatPercent(item.test.winRatePercent));
    appendCell(row, Number.isFinite(item.test.profitFactor) ? formatNumber(item.test.profitFactor, 2) : "∞");
    appendCell(row, formatPercent(item.test.returnPercent), toneClass(item.test.returnPercent));
    appendCell(row, formatPercent(-Math.abs(item.test.maxDrawdownPercent)), "tone-bad");
    appendCell(row, formatMoney(item.test.totalFees));
    const assessmentCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge ${verdict.className}`.trim();
    badge.textContent = verdict.text;
    assessmentCell.append(badge);
    row.append(assessmentCell);
    elements.resultsBody.append(row);
  }

  for (const failure of run.failures) {
    const row = document.createElement("tr");
    appendCell(row, failure.symbol.replace("USDT", ""));
    appendCell(row, failure.source);
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "tone-bad";
    cell.textContent = failure.error;
    row.append(cell);
    elements.resultsBody.append(row);
  }

  elements.statTrades.textContent = run.summary.totalOutOfSampleTrades.toLocaleString("ru-RU");
  elements.statProfitable.textContent = `${run.summary.profitableOutOfSample} / ${run.summary.completedSymbols}`;
  elements.statReturn.textContent = formatPercent(run.summary.medianOutOfSampleReturnPercent);
  elements.statPf.textContent = formatNumber(run.summary.averageFiniteOutOfSampleProfitFactor, 2);
  elements.statFailures.textContent = String(run.summary.failedSymbols);
  elements.exportRun.disabled = false;
}

function readHistory() {
  const history = readJson(RUN_HISTORY_KEY, []);
  return Array.isArray(history) ? history : [];
}

function saveRun(run) {
  const history = [run, ...readHistory().filter((item) => item.id !== run.id)].slice(0, MAX_HISTORY_RUNS);
  writeJson(RUN_HISTORY_KEY, history);
}

function renderHistory() {
  const history = readHistory();
  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "empty-cell";
    empty.textContent = "История пока пустая";
    elements.runHistory.replaceChildren(empty);
    return;
  }
  const nodes = history.map((run) => {
    const item = document.createElement("article");
    item.className = "history-item";
    const identity = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${run.settings.interval} · ${run.settings.days} дней · ${run.selection.combinedSymbols.length} монет`;
    const time = document.createElement("small");
    time.textContent = new Date(run.createdAt).toLocaleString("ru-RU");
    identity.append(title, time);
    const metric = (label, value, className = "") => {
      const box = document.createElement("div");
      const caption = document.createElement("small");
      caption.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = value;
      if (className) strong.className = className;
      box.append(caption, strong);
      return box;
    };
    item.append(
      identity,
      metric("Сделок", run.summary.totalOutOfSampleTrades.toLocaleString("ru-RU")),
      metric("Прибыльных", `${run.summary.profitableOutOfSample}/${run.summary.completedSymbols}`),
      metric("Медиана", formatPercent(run.summary.medianOutOfSampleReturnPercent), toneClass(run.summary.medianOutOfSampleReturnPercent)),
      metric("Средний PF", formatNumber(run.summary.averageFiniteOutOfSampleProfitFactor, 2)),
    );
    return item;
  });
  elements.runHistory.replaceChildren(...nodes);
}

async function runBacktest(event) {
  event.preventDefault();
  if (state.running) return;
  try {
    const settings = formSettings();
    writeJson(FORM_STATE_KEY, settings);
    state.running = true;
    state.runId += 1;
    const runId = state.runId;
    const endTime = Date.now();

    const inplay = await refreshCurrentInPlay(settings);
    if (runId !== state.runId) return;
    const inplaySymbols = inplay.matches.map((item) => item.symbol);
    const combinedSymbols = [...new Set([...FIXED_SYMBOLS, ...inplaySymbols])];
    const fixedSet = new Set(FIXED_SYMBOLS);
    const inplaySet = new Set(inplaySymbols);
    const sourceFor = (symbol) => fixedSet.has(symbol) && inplaySet.has(symbol)
      ? "base + INPLAY"
      : inplaySet.has(symbol) ? "INPLAY" : "base";

    let completed = 0;
    setRunUi({
      title: `Тестирую ${combinedSymbols.length} монет`,
      status: "Загружаю свечи и считаю сделки…",
      completed,
      total: combinedSymbols.length,
      running: true,
    });

    const runPool = createPool(settings.concurrency);
    const settled = await Promise.all(combinedSymbols.map((symbol) => runPool(async () => {
      try {
        const result = await backtestSymbol({ symbol, source: sourceFor(symbol), settings, endTime, runId });
        return result;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        return { symbol, source: sourceFor(symbol), error: error.message };
      } finally {
        completed += 1;
        if (runId === state.runId) {
          setRunUi({
            title: `Тестирую ${combinedSymbols.length} монет`,
            status: `Обработан ${symbol}`,
            completed,
            total: combinedSymbols.length,
            running: true,
          });
        }
      }
    })));

    if (runId !== state.runId) return;
    const failures = settled.filter((item) => item.error);
    const results = settled
      .filter((item) => !item.error)
      .sort((left, right) => right.test.returnPercent - left.test.returnPercent);
    const run = {
      id: `${endTime}-${settings.interval}-${settings.days}`,
      createdAt: endTime,
      settings,
      strategy: {
        name: "ATR breakout baseline",
        lookback: 20,
        stopAtr: 1,
        rewardRisk: 1.5,
        minVolumeRatio: 1.2,
        riskPerTrade: 0.0025,
        feeRate: 0.0005,
        slippageRate: 0.0002,
        maxLeverage: 1,
      },
      selection: {
        capturedAt: inplay.capturedAt,
        fixedSymbols: FIXED_SYMBOLS,
        currentInPlaySymbols: inplaySymbols,
        combinedSymbols,
        rules: settings.rules,
        selectionBiasWarning: "Current INPLAY is a present-time snapshot and does not replace point-in-time reconstruction.",
      },
      summary: summarize(results, failures),
      results,
      failures,
    };
    state.latestRun = run;
    saveRun(run);
    renderResults(run);
    renderHistory();
    setRunUi({
      title: "Тест завершён",
      status: `Готово: ${results.length}; ошибок: ${failures.length}`,
      completed: combinedSymbols.length,
      total: combinedSymbols.length,
      running: false,
    });
  } catch (error) {
    if (error?.name !== "AbortError") setError(error.message);
  } finally {
    state.running = false;
    elements.cancelRun.disabled = true;
    elements.runBacktest.disabled = false;
    elements.refreshInPlay.disabled = false;
  }
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function bindEvents() {
  elements.form.addEventListener("submit", runBacktest);
  elements.refreshInPlay.addEventListener("click", async () => {
    try {
      await refreshCurrentInPlay();
    } catch (error) {
      setError(error.message);
    }
  });
  elements.loadInPulsRules.addEventListener("click", () => {
    const rules = readJson(INPULS_RULES_KEY, DEFAULT_INPLAY_RULES);
    applyRulesToForm(rules);
    setRunUi({ title: "Правила загружены", status: "Взяты текущие настройки INPLAY из основного InPuls", completed: 0, total: 0 });
  });
  elements.cancelRun.addEventListener("click", () => {
    state.runId += 1;
    state.running = false;
    setRunUi({ title: "Запуск остановлен", status: "Новые расчёты отменены; уже загруженные ответы могли завершиться", completed: 0, total: 0, running: false });
  });
  elements.exportRun.addEventListener("click", () => {
    if (!state.latestRun) return;
    const stamp = new Date(state.latestRun.createdAt).toISOString().replaceAll(":", "-");
    downloadJson(state.latestRun, `inpuls-algo-backtest-${stamp}.json`);
  });
  elements.clearHistory.addEventListener("click", () => {
    localStorage.removeItem(RUN_HISTORY_KEY);
    state.latestRun = null;
    elements.exportRun.disabled = true;
    renderHistory();
  });
}

renderFixedSymbols();
loadFormState();
renderHistory();
bindEvents();
