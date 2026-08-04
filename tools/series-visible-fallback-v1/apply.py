from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OLD_KEY = "26-114-raw-series-execution-candles-v1"
NEW_KEY = "26-115-series-visible-fallback-v1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


orderbook_path = ROOT / "orderbook.js"
orderbook = orderbook_path.read_text(encoding="utf-8")

orderbook = replace_once(
    orderbook,
    '  const seriesReady = state.seriesSource === "raw";\n',
    '  const seriesReady = state.seriesRenderSource === "raw";\n',
    "series button source",
)
orderbook = replace_once(
    orderbook,
    '  button.dataset.seriesSource = seriesReady ? "raw" : "warming";\n',
    '  button.dataset.seriesSource = seriesReady ? "raw" : "agg";\n',
    "series button dataset",
)
orderbook = replace_once(
    orderbook,
    '      : "СЕРИЯ проверяет непрерывность отдельного @trade RAW. Во время warm-up, gap или reconnect серия не строится из aggTrade.";\n',
    '      : `СЕРИЯ AGG ≤${TAPE_SERIES_MAX_GAP_MS} мс: стабильный fallback по taker-агрессору. При подтверждённом непрерывном @trade источник автоматически переключается на RAW.`;\n',
    "series fallback title",
)
orderbook = replace_once(
    orderbook,
    '      seriesSource: "warming",\n      seriesHealth: null,\n',
    '      seriesSource: "warming",\n      seriesRenderSource: "agg",\n      seriesHealth: null,\n',
    "series state default",
)

old_model_head = '''function refreshTapeRenderModel(state, symbol, stored, aggregationStored = stored, seriesStored = []) {
  const version = Number(tapeDataVersionBySymbol.get(symbol)) || 0;
  const modelKey = [symbol, version, state.seriesSource, "zero-ms-raw-series-500"].join(":");
  if (state.renderModelKey === modelKey) return;
  state.renderModelKey = modelKey;
'''
new_model_head = '''function refreshTapeRenderModel(state, symbol, stored, aggregationStored = stored, seriesStored = []) {
  const version = Number(tapeDataVersionBySymbol.get(symbol)) || 0;
  const aggregationInput = aggregationStored?.length ? aggregationStored : stored;
  const seriesRawReady = state.seriesSource === "raw" && Boolean(seriesStored?.length);
  const seriesRenderSource = seriesRawReady ? "raw" : "agg";
  const seriesInput = seriesRawReady ? seriesStored : aggregationInput;
  const modelKey = [symbol, version, seriesRenderSource, "zero-ms-series-fallback-500"].join(":");
  state.seriesRenderSource = seriesRenderSource;
  if (state.renderModelKey === modelKey) return;
  state.renderModelKey = modelKey;
'''
orderbook = replace_once(orderbook, old_model_head, new_model_head, "render model head")

old_model_tail = '''  const aggregationInput = aggregationStored?.length ? aggregationStored : stored;
  state.aggSourceBuckets = aggregateTapeZeroMs(aggregationInput);
  state.seriesSourceBuckets = state.seriesSource === "raw"
    ? aggregateTapeSeries(seriesStored)
    : [];
'''
new_model_tail = '''  state.aggSourceBuckets = aggregateTapeZeroMs(aggregationInput);
  state.seriesSourceBuckets = aggregateTapeSeries(seriesInput);
'''
orderbook = replace_once(orderbook, old_model_tail, new_model_tail, "render model fallback")

orderbook = replace_once(
    orderbook,
    '  state.seriesHealth = meta.seriesHealth ?? null;\n  syncTapeModeButton(state.controls?.querySelector("[data-inpuls-tape-mode]"), state);\n  const exchangeNow = binanceClock.now(perfNow);\n',
    '  state.seriesHealth = meta.seriesHealth ?? null;\n  const exchangeNow = binanceClock.now(perfNow);\n',
    "defer series button sync",
)
orderbook = replace_once(
    orderbook,
    '  refreshTapeRenderModel(state, symbol, stored, aggregationStored, seriesStored);\n\n  const recentRaw = visibleWaterTapeNodes(\n',
    '  refreshTapeRenderModel(state, symbol, stored, aggregationStored, seriesStored);\n  syncTapeModeButton(state.controls?.querySelector("[data-inpuls-tape-mode]"), state);\n\n  const recentRaw = visibleWaterTapeNodes(\n',
    "sync series button after model",
)
orderbook = replace_once(
    orderbook,
    '          ? (state.seriesSource === "raw"\n            ? "Жду агрессивную серию…"\n            : "СЕРИЯ · проверяем непрерывный @trade RAW…")\n',
    '          ? (state.seriesRenderSource === "raw"\n            ? "Жду агрессивную серию RAW…"\n            : "Жду агрессивную серию · источник AGG…")\n',
    "series waiting state",
)

orderbook_path.write_text(orderbook, encoding="utf-8")

test_path = ROOT / "test-raw-series-execution-candles-v1.mjs"
test = test_path.read_text(encoding="utf-8")
old_contract = '''  assert.match(main, /state\\.seriesSource === "raw"[\\s\\S]*aggregateTapeSeries\\(seriesStored\\)/);
  assert.doesNotMatch(main, /state\\.seriesSourceBuckets = aggregateTapeSeries\\(aggregationInput\\)/);
'''
new_contract = '''  assert.match(main, /const seriesRawReady = state\\.seriesSource === "raw" && Boolean\\(seriesStored\\?\\.length\\)/);
  assert.match(main, /const seriesInput = seriesRawReady \\? seriesStored : aggregationInput/);
  assert.match(main, /state\\.seriesRenderSource = seriesRenderSource/);
  assert.match(main, /state\\.seriesSourceBuckets = aggregateTapeSeries\\(seriesInput\\)/);
'''
test = replace_once(test, old_contract, new_contract, "series fallback test contract")
test_path.write_text(test, encoding="utf-8")

for path in ROOT.rglob("*"):
    if not path.is_file() or ".git" in path.parts:
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".css", ".txt"}:
        continue
    text = path.read_text(encoding="utf-8")
    if OLD_KEY in text:
        path.write_text(text.replace(OLD_KEY, NEW_KEY), encoding="utf-8")

print("SERIES AGG fallback patch applied")
