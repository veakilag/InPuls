from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) Structural history horizons: local TFs remain 24h; senior TFs keep effectively
# all Binance Futures history while 15m is capped at one year for browser cost.
replace_once(
    "signal-lab-v7-multi-timeframe-levels.js",
    '''export const STRUCTURAL_TF_LOOKBACK_MS = Object.freeze({
  "1m": 24 * 60 * 60_000,
  "5m": 24 * 60 * 60_000,
  "15m": 30 * 24 * 60 * 60_000,
  "1h": 60 * 24 * 60 * 60_000,
  "4h": 180 * 24 * 60 * 60_000,
  "1d": 365 * 24 * 60 * 60_000,
});''',
    '''export const STRUCTURAL_TF_LOOKBACK_MS = Object.freeze({
  "1m": 24 * 60 * 60_000,
  "5m": 24 * 60 * 60_000,
  "15m": 365 * 24 * 60 * 60_000,
  "1h": 10 * 365 * 24 * 60 * 60_000,
  "4h": 10 * 365 * 24 * 60 * 60_000,
  "1d": 10 * 365 * 24 * 60 * 60_000,
});''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-levels.js",
    '''export function structuralLevelLabel(level) {
  const side = level?.side === "HIGH" ? "H" : "L";
  const sources = Array.isArray(level?.sources) && level.sources.length
    ? level.sources
    : [level?.sourceTimeframe].filter(Boolean);
  const primary = sources[0] ?? "?";
  const confluence = sources.length > 1 ? ` + ${sources.slice(1).join("+")}` : "";
  const attacks = Math.max(1, Math.round(Number(level?.attackCount) || 1));
  return `${side} ${primary}${confluence} · ×${attacks}${level?.active === false ? " · ПРОБИТ" : ""}`;
}''',
    '''export function formatStructuralLevelPrice(value) {
  const price = finite(value);
  if (!(price > 0)) return "—";
  const digits = price >= 1000 ? 2 : price >= 1 ? 4 : price >= 0.1 ? 5 : price >= 0.01 ? 6 : 8;
  return price.toFixed(digits).replace(/\\.?0+$/, "");
}

export function structuralLevelLabel(level) {
  const side = level?.side === "HIGH" ? "H" : "L";
  const sources = Array.isArray(level?.sources) && level.sources.length
    ? level.sources
    : [level?.sourceTimeframe].filter(Boolean);
  const primary = sources[0] ?? "?";
  const confluence = sources.length > 1 ? ` + ${sources.slice(1).join("+")}` : "";
  const attacks = Math.max(1, Math.round(Number(level?.attackCount) || 1));
  const price = formatStructuralLevelPrice(level?.price);
  return `${side} ${primary}${confluence} · ×${attacks} · ${price}${level?.active === false ? " · ПРОБИТ" : ""}`;
}''',
)

# 2) Multi-TF runtime: fetch the configured history for the current TF as well,
# feed it into the chart, and render active levels as pinned-right rays.
replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''function annotationForLevel(level) {
  return {
    type: "segment",
    a: { time: level.displayAt ?? level.extremeAt, price: level.price },
    b: { time: level.endAt, price: level.price },
    label: structuralLevelLabel(level),
    tone: level.side === "HIGH" ? "danger" : "success",
    state: level.status,
    hierarchical: true,
    multiTimeframe: true,
    sourceTimeframe: level.sourceTimeframe,
    sources: level.sources,
    nativeExtremeAt: level.nativeExtremeAt ?? level.extremeAt,
    refinedAt: level.displayAt ?? level.extremeAt,
    refinedThroughTimeframe: level.refinedThroughTimeframe ?? level.sourceTimeframe,
    refinementPath: level.refinementPath,
  };
}''',
    '''function annotationForLevel(level) {
  const startAt = level.displayAt ?? level.extremeAt;
  const common = {
    label: structuralLevelLabel(level),
    tone: level.side === "HIGH" ? "danger" : "success",
    state: level.status,
    hierarchical: true,
    multiTimeframe: true,
    sourceTimeframe: level.sourceTimeframe,
    sources: level.sources,
    nativeExtremeAt: level.nativeExtremeAt ?? level.extremeAt,
    refinedAt: startAt,
    refinedThroughTimeframe: level.refinedThroughTimeframe ?? level.sourceTimeframe,
    refinementPath: level.refinementPath,
  };
  if (level.active !== false) {
    return {
      ...common,
      type: "ray",
      startAt,
      price: level.price,
      pinLabelRight: true,
    };
  }
  return {
    ...common,
    type: "segment",
    a: { time: startAt, price: level.price },
    b: { time: level.endAt, price: level.price },
  };
}''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''  context.textContent = `Иерархия: ${sources} · уровней ${levelMap.length} · старший ТФ сохраняется · 1м/5м только 24ч`;''',
    '''  context.textContent = `Иерархия: ${sources} · уровней ${levelMap.length} · 1ч/4ч/1д вся доступная история · 15м 1 год · 1м/5м 24ч`;''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''async function loadHierarchicalContext({
  symbol,
  viewTimeframe,
  endAt,
  viewCandles,
  EngineClass,
  signal,
}) {''',
    '''async function loadHierarchicalContext({
  symbol,
  viewTimeframe,
  endAt,
  EngineClass,
  signal,
}) {''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''  await Promise.all(sourceTimeframes.map(async (sourceTimeframe) => {
    const lookback = STRUCTURAL_TF_LOOKBACK_MS[sourceTimeframe];
    const startAt = endAt - lookback;
    const sourceCandles = sourceTimeframe === viewTimeframe
      ? (Array.isArray(viewCandles) ? viewCandles : []).filter((row) => {
        const time = finite(row?.time);
        return time !== null && time >= startAt && time <= endAt;
      })
      : await fetchCandles(symbol, sourceTimeframe, endAt, signal);
    if (!sourceCandles.length) return;''',
    '''  await Promise.all(sourceTimeframes.map(async (sourceTimeframe) => {
    const sourceCandles = await fetchCandles(symbol, sourceTimeframe, endAt, signal);
    if (!sourceCandles.length) return;''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''        const loaded = await loadHierarchicalContext({
          symbol,
          viewTimeframe,
          endAt,
          viewCandles: candles,
          EngineClass,
          signal: abortController.signal,
        });''',
    '''        const loaded = await loadHierarchicalContext({
          symbol,
          viewTimeframe,
          endAt,
          EngineClass,
          signal: abortController.signal,
        });''',
)

replace_once(
    "signal-lab-v7-multi-timeframe-review-runtime.js",
    '''        latest.tickSize = loaded.tickSize;
        latest.snapshotsByTimeframe = loaded.snapshotsByTimeframe;
        latest.candlesByTimeframe = loaded.candlesByTimeframe;
        originalSetAnnotations.call(this, combineAnnotations(latest));
        this.render?.();''',
    '''        latest.tickSize = loaded.tickSize;
        latest.snapshotsByTimeframe = loaded.snapshotsByTimeframe;
        latest.candlesByTimeframe = loaded.candlesByTimeframe;
        const extendedViewCandles = loaded.candlesByTimeframe?.[viewTimeframe];
        if (Array.isArray(extendedViewCandles) && extendedViewCandles.length > candles.length) {
          originalSetData.call(this, extendedViewCandles, meta);
        }
        originalSetAnnotations.call(this, combineAnnotations(latest));
        this.render?.();''',
)

# 3) Chart renderer: pinned ray labels follow the right edge as time advances.
replace_once(
    "chart.js",
    '''    for (const annotation of visibleRays) {
      const originX = xForTime(annotation.startAt);
      label(annotation.label, Math.max(margins.left + 4, originX + 6), yForPrice(annotation.price), colorFor(annotation));
    }''',
    '''    for (const annotation of visibleRays) {
      const originX = xForTime(annotation.startAt);
      const labelX = annotation.pinLabelRight
        ? margins.left + plotWidth - 184
        : Math.max(margins.left + 4, originX + 6);
      label(annotation.label, labelX, yForPrice(annotation.price), colorFor(annotation));
    }''',
)

# 4) Tests: labels include price and senior history spans the exchange lifetime.
test_path = ROOT / "test/signal-lab-v7-multi-timeframe-levels.test.js"
test_text = test_path.read_text(encoding="utf-8")
test_text = test_text.replace('"H 4h + 5m · ×2"', '"H 4h + 5m · ×2 · 100"')
test_text = test_text.replace('"H 4h · ×2"', '"H 4h · ×2 · 110"')
insert_marker = '''test("1m and 5m levels expire from the map after 24 hours", () => {'''
insert = '''test("senior structural history reaches the full Binance Futures lifetime", async () => {
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
if insert_marker not in test_text:
    raise RuntimeError("multi-TF test insertion marker missing")
test_text = test_text.replace(insert_marker, insert, 1)
test_path.write_text(test_text, encoding="utf-8")

print("Applied V3.5 hierarchical history and right-pinned rays")
