from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Shared hierarchy horizons: senior TFs = 6 months, 15m and below = 1 month.
replace_once(
    "signal-lab-v7-multi-timeframe-levels.js",
    '''export const STRUCTURAL_TF_LOOKBACK_MS = Object.freeze({
  "1m": 24 * 60 * 60_000,
  "5m": 24 * 60 * 60_000,
  "15m": 365 * 24 * 60 * 60_000,
  "1h": 10 * 365 * 24 * 60 * 60_000,
  "4h": 10 * 365 * 24 * 60 * 60_000,
  "1d": 10 * 365 * 24 * 60 * 60_000,
});

export const LOCAL_STRUCTURAL_LEVEL_HORIZON_MS = 24 * 60 * 60_000;''',
    '''export const STRUCTURAL_TF_LOOKBACK_MS = Object.freeze({
  "1m": 30 * 24 * 60 * 60_000,
  "5m": 30 * 24 * 60 * 60_000,
  "15m": 30 * 24 * 60 * 60_000,
  "1h": 180 * 24 * 60 * 60_000,
  "4h": 180 * 24 * 60 * 60_000,
  "1d": 180 * 24 * 60 * 60_000,
});

export const LOCAL_STRUCTURAL_LEVEL_HORIZON_MS = 30 * 24 * 60 * 60_000;''',
)

# Concurrency-limited hierarchy fetch and truthful status text.
replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''async function fetchTickSize(symbol, signal) {
  const key = `tick:${symbol}`;''',
    '''async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(items.length, concurrency)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function fetchTickSize(symbol, signal) {
  const key = `tick:${symbol}`;''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''  const pages = await Promise.all(windows.map(async (window) => {
    const url = new URL(KLINES_ENDPOINT);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", timeframe);
    url.searchParams.set("startTime", String(window.startTime));
    url.searchParams.set("endTime", String(window.endTime));
    url.searchParams.set("limit", String(pageSize));
    const payload = await fetchJson(url, signal);
    return (Array.isArray(payload) ? payload : [])
      .map((row) => parseKline(row, endAt))
      .filter(Boolean);
  }));''',
    '''  const pages = await mapWithConcurrency(windows, timeframe === "1m" ? 4 : 3, async (window) => {
    const url = new URL(KLINES_ENDPOINT);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", timeframe);
    url.searchParams.set("startTime", String(window.startTime));
    url.searchParams.set("endTime", String(window.endTime));
    url.searchParams.set("limit", String(pageSize));
    const payload = await fetchJson(url, signal);
    return (Array.isArray(payload) ? payload : [])
      .map((row) => parseKline(row, endAt))
      .filter(Boolean);
  });''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''  context.textContent = `Иерархия: ${sources} · уровней ${levelMap.length} · 1ч/4ч/1д вся доступная история · 15м 1 год · 1м/5м 24ч`;''',
    '''  context.textContent = `Иерархия: ${sources} · уровней ${levelMap.length} · 1д/4ч/1ч: 6 мес · 15м/5м/1м: 1 мес`;''',
)

# The selected chart must load the same horizon as the hierarchy so manual
# calibration works on old visible levels as well.
replace_once(
    "owner-signal-lab-structural-extremes-review.js",
    '''const THIRTY_DAYS_MS = 30 * 24 * 60 * 60_000;
const REVIEW_STORAGE_PREFIX = "inpuls-structural-extremes-review-v3";
const INTERVAL_MS = Object.freeze({''',
    '''const REVIEW_STORAGE_PREFIX = "inpuls-structural-extremes-review-v3";
const INTERVAL_MS = Object.freeze({''',
)

replace_once(
    "owner-signal-lab-structural-extremes-review.js",
    '''const INTERVAL_MS = Object.freeze({
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
});''',
    '''const INTERVAL_MS = Object.freeze({
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
});
const REVIEW_LOOKBACK_MS = Object.freeze({
  "1m": 30 * 24 * 60 * 60_000,
  "5m": 30 * 24 * 60 * 60_000,
  "15m": 30 * 24 * 60 * 60_000,
  "1h": 180 * 24 * 60 * 60_000,
  "4h": 180 * 24 * 60 * 60_000,
  "1d": 180 * 24 * 60 * 60_000,
});
const REVIEW_LOOKBACK_LABEL = Object.freeze({
  "1m": "1 месяц",
  "5m": "1 месяц",
  "15m": "1 месяц",
  "1h": "6 месяцев",
  "4h": "6 месяцев",
  "1d": "6 месяцев",
});''',
)

replace_once(
    "owner-signal-lab-structural-extremes-review.js",
    '''async function fetchThirtyDays(symbol, selectedTimeframe, endAt, signal, onProgress = null) {
  const intervalMs = INTERVAL_MS[selectedTimeframe];
  const startAt = endAt - THIRTY_DAYS_MS;''',
    '''async function fetchReviewHistory(symbol, selectedTimeframe, endAt, signal, onProgress = null) {
  const intervalMs = INTERVAL_MS[selectedTimeframe];
  const lookbackMs = REVIEW_LOOKBACK_MS[selectedTimeframe];
  const startAt = endAt - lookbackMs;''',
)

replace_once(
    "owner-signal-lab-structural-extremes-review.js",
    '''      fetchThirtyDays(
        symbol,
        timeframe,''',
    '''      fetchReviewHistory(
        symbol,
        timeframe,''',
)

replace_once(
    "owner-signal-lab-structural-extremes-review.js",
    '''  elements.status.textContent = `Загружаю ${symbol} · ${timeframe} · 30 дней закрытых свечей…`;''',
    '''  elements.status.textContent = `Загружаю ${symbol} · ${timeframe} · ${REVIEW_LOOKBACK_LABEL[timeframe]} закрытых свечей…`;''',
)

# Static button text.
replace_once(
    "owner-signal-lab-structural-extremes-review.html",
    '''<button id="load" type="button">Загрузить 30 дней</button>''',
    '''<button id="load" type="button">Загрузить историю</button>''',
)

# Tests: exact requested horizons.
test_path = ROOT / "test/signal-lab-v7-multi-timeframe-levels.test.js"
test_text = test_path.read_text(encoding="utf-8")
old_test = '''test("senior structural history reaches the full Binance Futures lifetime", async () => {
  const { STRUCTURAL_TF_LOOKBACK_MS } = await import("../signal-lab-v7-multi-timeframe-levels.js");
  const day = 24 * 60 * 60_000;
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["1m"], day);
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["5m"], day);
  assert.ok(STRUCTURAL_TF_LOOKBACK_MS["15m"] >= 365 * day);
  assert.ok(STRUCTURAL_TF_LOOKBACK_MS["1h"] >= 7 * 365 * day);
  assert.ok(STRUCTURAL_TF_LOOKBACK_MS["4h"] >= 7 * 365 * day);
  assert.ok(STRUCTURAL_TF_LOOKBACK_MS["1d"] >= 7 * 365 * day);
});

test("1m and 5m levels expire from the map after 24 hours", () => {'''
new_test = '''test("review history uses six months for senior TFs and one month for 15m and below", async () => {
  const { STRUCTURAL_TF_LOOKBACK_MS } = await import("../signal-lab-v7-multi-timeframe-levels.js");
  const day = 24 * 60 * 60_000;
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["1m"], 30 * day);
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["5m"], 30 * day);
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["15m"], 30 * day);
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["1h"], 180 * day);
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["4h"], 180 * day);
  assert.equal(STRUCTURAL_TF_LOOKBACK_MS["1d"], 180 * day);
});

test("1m and 5m levels expire from the map after 30 days", () => {'''
if old_test not in test_text:
    raise RuntimeError("multi-TF horizon test block not found")
test_path.write_text(test_text.replace(old_test, new_test, 1), encoding="utf-8")

# Update calibration note to the latest agreed horizon policy.
doc = ROOT / "docs/signal-lab-v7-structural-extremes-trader-calibration-v2.md"
doc_text = doc.read_text(encoding="utf-8")
doc_text = doc_text.replace(
    '''For browser-review introduced horizons:\n\n- 1m: 24 hours;\n- 5m: 24 hours;\n- 15m: 1 year;\n- 1h: 10 years;\n- 4h: 10 years;\n- 1d: 10 years.''',
    '''For browser-review introduced horizons:\n\n- 1m: 1 month;\n- 5m: 1 month;\n- 15m: 1 month;\n- 1h: 6 months;\n- 4h: 6 months;\n- 1d: 6 months.''',
)
# Russian text is canonical in this file; replace the actual block if present.
doc_text = doc_text.replace(
    '''Для browser-review введены горизонты:\n\n- 1m: 24 часа;\n- 5m: 24 часа;\n- 15m: 1 год;\n- 1h: 10 лет;\n- 4h: 10 лет;\n- 1d: 10 лет.\n\nДля Binance Futures горизонт 10 лет фактически покрывает всю доступную историю старших TF на текущую дату. 15m ограничен одним годом из-за стоимости сотен тысяч браузерных свечей; полный многолетний архив 15m относится к будущему backend-хранилищу.''',
    '''Для browser-review введены горизонты:\n\n- 1m: 1 месяц;\n- 5m: 1 месяц;\n- 15m: 1 месяц;\n- 1h: 6 месяцев;\n- 4h: 6 месяцев;\n- 1d: 6 месяцев.\n\nЭто осознанное окно визуальной калибровки: старшие уровни получают достаточно контекста, а младшие ТФ не перегружают браузер избыточным архивом.''',
)
doc.write_text(doc_text, encoding="utf-8")

# Normalize the already generated standalone file so diff --check can run before rebuild.
standalone = ROOT / "structural-extremes-review-standalone.html"
if standalone.exists():
    text = standalone.read_text(encoding="utf-8")
    standalone.write_text("\n".join(line.rstrip() for line in text.splitlines()) + "\n", encoding="utf-8")

print("Applied V3.6 review horizon policy")
