from pathlib import Path


def replace_exact(path, old, new, expected=1):
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old[:180]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


collector = "signal-lab-v3-collector.js"
extremes = "signal-lab-v4-extremes.js"
owner = "owner-signal-lab-v3.js"
html = "owner-signal-lab-v3.html"

replace_exact(
    collector,
    'const BINANCE_KLINES_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";\nconst BINANCE_EXCHANGE_INFO_ENDPOINT = "https://fapi.binance.com/fapi/v1/exchangeInfo";',
    'const BINANCE_KLINES_ENDPOINT = "https://fapi.binance.com/fapi/v1/klines";\nconst BINANCE_EXCHANGE_INFO_ENDPOINT = "https://fapi.binance.com/fapi/v1/exchangeInfo";\nconst BINANCE_SPOT_KLINES_ENDPOINT = "https://data-api.binance.vision/api/v3/klines";\nconst BINANCE_SPOT_EXCHANGE_INFO_ENDPOINT = "https://data-api.binance.vision/api/v3/exchangeInfo";',
)

normalize_marker = '''function normalizeKline(row) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const candle = {
    time: finite(row[0]),
    open: finite(row[1]),
    high: finite(row[2]),
    low: finite(row[3]),
    close: finite(row[4]),
    volume: Math.max(0, finite(row[5]) ?? 0),
    closeTime: finite(row[6]),
    closed: finite(row[6]) === null ? true : finite(row[6]) < Date.now(),
  };
  return [candle.time, candle.open, candle.high, candle.low, candle.close]
    .every((value) => value !== null && value > 0)
    ? candle
    : null;
}
'''
helpers = normalize_marker + '''
export function resolveSpotHistoryProxy(symbol, spotTickSizes) {
  const normalized = normalizeUsdtPerpetualSymbol(symbol);
  if (!normalized || !(spotTickSizes instanceof Map)) return null;
  const directTickSize = finite(spotTickSizes.get(normalized));
  if (directTickSize > 0) {
    return Object.freeze({
      futuresSymbol: normalized,
      spotSymbol: normalized,
      priceScale: 1,
      tickSize: directTickSize,
      source: "BINANCE_SPOT_PROXY",
    });
  }
  const multiplierMatch = normalized.match(/^(\\d+)([A-Z][A-Z0-9]*USDT)$/);
  if (!multiplierMatch) return null;
  const priceScale = finite(multiplierMatch[1]);
  const spotSymbol = multiplierMatch[2];
  const spotTickSize = finite(spotTickSizes.get(spotSymbol));
  if (!(priceScale > 0) || !(spotTickSize > 0)) return null;
  return Object.freeze({
    futuresSymbol: normalized,
    spotSymbol,
    priceScale,
    tickSize: spotTickSize * priceScale,
    source: "BINANCE_SPOT_PROXY",
  });
}

export function scaleProxyCandle(candle, priceScale = 1) {
  const scale = finite(priceScale);
  if (!candle || !(scale > 0)) return null;
  const scaled = {
    ...candle,
    open: finite(candle.open) * scale,
    high: finite(candle.high) * scale,
    low: finite(candle.low) * scale,
    close: finite(candle.close) * scale,
  };
  return [scaled.open, scaled.high, scaled.low, scaled.close].every((value) => value > 0)
    ? Object.freeze(scaled)
    : null;
}
'''
replace_exact(collector, normalize_marker, helpers)

replace_exact(
    collector,
    '    this.tickSizes = new Map();\n    this.exchangeInfoPromise = null;',
    '    this.tickSizes = new Map();\n    this.spotTickSizes = new Map();\n    this.futuresRestAvailable = null;\n    this.historySourceBySymbol = new Map();\n    this.historyUnavailable = new Set();\n    this.exchangeInfoPromise = null;',
)
replace_exact(
    collector,
    '      warmupLoaded: 0,\n      warmupLoading: 0,',
    '      warmupLoaded: 0,\n      warmupLoading: 0,\n      warmupFutures: 0,\n      warmupSpotProxy: 0,\n      warmupUnavailable: 0,\n      historyMode: "PENDING",',
)

replace_exact(
    collector,
    '''          this.extremes.hydrate(metrics.symbol, timeframe, [candle], {
            tickSize,
            dataQuality,
            emitSnapshot: false,
          });''',
    '''          this.extremes.hydrate(metrics.symbol, timeframe, [candle], {
            tickSize,
            dataQuality,
            dataSource: this.historySourceBySymbol.get(metrics.symbol) ?? "BINANCE_FUTURES_LIVE",
            emitSnapshot: false,
          });''',
)

old_exchange = '''  async #loadExchangeInfo() {
    try {
      const response = await fetch(BINANCE_EXCHANGE_INFO_ENDPOINT, { cache: "no-store" });
      if (!response.ok) throw new Error(`Exchange info HTTP ${response.status}`);
      const payload = await response.json();
      for (const row of Array.isArray(payload?.symbols) ? payload.symbols : []) {
        const symbol = normalizeUsdtPerpetualSymbol(row?.symbol);
        const priceFilter = (Array.isArray(row?.filters) ? row.filters : [])
          .find((filter) => filter?.filterType === "PRICE_FILTER");
        const tickSize = finite(priceFilter?.tickSize);
        if (!symbol || !(tickSize > 0)) continue;
        this.tickSizes.set(symbol, tickSize);
        this.extremes.setTickSize(symbol, tickSize);
        this.levels.setTickSize(symbol, tickSize);
      }
      this.#publish({ tickSizes: this.tickSizes.size, lastError: null });
    } catch (error) {
      this.#publish({ lastError: `tickSize: ${String(error?.message ?? error).slice(0, 160)}` });
    }
  }

  async #warmupSymbol(symbol) {
    this.historyLoading.add(symbol);
    this.#publish({ warmupLoading: this.historyLoading.size });
    try {
      await this.exchangeInfoPromise;
      const tickSize = this.tickSizes.get(symbol);
      if (!(tickSize > 0)) throw new Error(`tickSize отсутствует для ${symbol}`);
      for (const timeframe of SIGNAL_LAB_V4_TIMEFRAMES) {
        const url = new URL(BINANCE_KLINES_ENDPOINT);
        url.searchParams.set("symbol", symbol);
        url.searchParams.set("interval", timeframe);
        url.searchParams.set("limit", String(EXTREME_WARMUP[timeframe] ?? 500));
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`${timeframe} klines HTTP ${response.status}`);
        const rows = await response.json();
        const candles = (Array.isArray(rows) ? rows : []).map(normalizeKline).filter(Boolean);
        this.extremes.hydrate(symbol, timeframe, candles, {
          tickSize,
          dataQuality: "RECOVERED",
          emitSnapshot: false,
        });
        const lastClosed = [...candles].reverse().find((candle) => candle.closed);
        if (lastClosed) this.lastClosedCandleAt.set(`${symbol}:${timeframe}`, lastClosed.time);
        if (timeframe === "1m") {
          this.#symbol(symbol)?.hydrateMinuteCandles(candles);
          if (lastClosed) this.lastTimeframeAggregationAt.set(symbol, lastClosed.time);
        }
      }
      this.historyLoaded.add(symbol);
      this.historyRetryAt.delete(symbol);
      this.#publish({
        warmupLoaded: this.historyLoaded.size,
        lastError: null,
      });
    } catch (error) {
      // Do not hammer Binance every second after 429/CORS/network failure.
      this.historyRetryAt.set(symbol, Date.now() + 60_000);
      this.#publish({ lastError: String(error?.message ?? error).slice(0, 180) });
    } finally {
      this.historyLoading.delete(symbol);
      this.#publish({ warmupLoading: this.historyLoading.size });
    }
  }
'''
new_exchange = '''  async #loadExchangeInfo() {
    let futuresError = null;
    try {
      const response = await fetch(BINANCE_EXCHANGE_INFO_ENDPOINT, { cache: "no-store" });
      if (!response.ok) throw new Error(`Futures exchangeInfo HTTP ${response.status}`);
      const payload = await response.json();
      for (const row of Array.isArray(payload?.symbols) ? payload.symbols : []) {
        const symbol = normalizeUsdtPerpetualSymbol(row?.symbol);
        const priceFilter = (Array.isArray(row?.filters) ? row.filters : [])
          .find((filter) => filter?.filterType === "PRICE_FILTER");
        const tickSize = finite(priceFilter?.tickSize);
        if (!symbol || !(tickSize > 0)) continue;
        this.tickSizes.set(symbol, tickSize);
        this.extremes.setTickSize(symbol, tickSize);
        this.levels.setTickSize(symbol, tickSize);
      }
      this.futuresRestAvailable = true;
      this.#publish({
        tickSizes: this.tickSizes.size,
        historyMode: "FUTURES",
        lastError: null,
      });
      return;
    } catch (error) {
      this.futuresRestAvailable = false;
      futuresError = String(error?.message ?? error).slice(0, 140);
    }

    try {
      const response = await fetch(BINANCE_SPOT_EXCHANGE_INFO_ENDPOINT, { cache: "no-store" });
      if (!response.ok) throw new Error(`Spot market-data exchangeInfo HTTP ${response.status}`);
      const payload = await response.json();
      for (const row of Array.isArray(payload?.symbols) ? payload.symbols : []) {
        if (row?.quoteAsset !== "USDT" || row?.status !== "TRADING") continue;
        const symbol = String(row?.symbol ?? "").toUpperCase();
        const priceFilter = (Array.isArray(row?.filters) ? row.filters : [])
          .find((filter) => filter?.filterType === "PRICE_FILTER");
        const tickSize = finite(priceFilter?.tickSize);
        if (!/^[A-Z0-9]{1,20}USDT$/.test(symbol) || !(tickSize > 0)) continue;
        this.spotTickSizes.set(symbol, tickSize);
      }
      this.#publish({
        historyMode: "SPOT_PROXY",
        lastError: null,
      });
    } catch (spotError) {
      this.#publish({
        historyMode: "UNAVAILABLE",
        lastError: `история недоступна: futures ${futuresError}; spot ${String(spotError?.message ?? spotError).slice(0, 120)}`,
      });
    }
  }

  async #fetchWarmupSet(endpoint, sourceSymbol, priceScale = 1, maximumLimit = 1_500) {
    const byTimeframe = new Map();
    for (const timeframe of SIGNAL_LAB_V4_TIMEFRAMES) {
      const url = new URL(endpoint);
      url.searchParams.set("symbol", sourceSymbol);
      url.searchParams.set("interval", timeframe);
      url.searchParams.set("limit", String(Math.min(maximumLimit, EXTREME_WARMUP[timeframe] ?? 500)));
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${timeframe} klines HTTP ${response.status}`);
      const rows = await response.json();
      const candles = (Array.isArray(rows) ? rows : [])
        .map(normalizeKline)
        .filter(Boolean)
        .map((candle) => scaleProxyCandle(candle, priceScale))
        .filter(Boolean);
      if (!candles.length) throw new Error(`${timeframe} klines пусты`);
      byTimeframe.set(timeframe, candles);
    }
    return byTimeframe;
  }

  #historyCounts() {
    const sources = [...this.historySourceBySymbol.values()];
    return {
      warmupLoaded: this.historyLoaded.size,
      warmupFutures: sources.filter((source) => source === "BINANCE_FUTURES_REST").length,
      warmupSpotProxy: sources.filter((source) => source === "BINANCE_SPOT_PROXY").length,
      warmupUnavailable: this.historyUnavailable.size,
      historyMode: sources.includes("BINANCE_SPOT_PROXY")
        ? (sources.includes("BINANCE_FUTURES_REST") ? "MIXED" : "SPOT_PROXY")
        : (sources.includes("BINANCE_FUTURES_REST") ? "FUTURES" : this.statusState.historyMode),
    };
  }

  async #warmupSymbol(symbol) {
    this.historyLoading.add(symbol);
    this.#publish({ warmupLoading: this.historyLoading.size });
    try {
      await this.exchangeInfoPromise;
      let tickSize = this.tickSizes.get(symbol) ?? null;
      let historySource = "BINANCE_FUTURES_REST";
      let byTimeframe = null;

      if (this.futuresRestAvailable && tickSize > 0) {
        try {
          byTimeframe = await this.#fetchWarmupSet(BINANCE_KLINES_ENDPOINT, symbol, 1, 1_500);
        } catch {
          byTimeframe = null;
        }
      }

      if (!byTimeframe) {
        const proxy = resolveSpotHistoryProxy(symbol, this.spotTickSizes);
        if (!proxy) throw new Error(`нет SPOT PROXY для ${symbol}`);
        tickSize = proxy.tickSize;
        historySource = proxy.source;
        byTimeframe = await this.#fetchWarmupSet(
          BINANCE_SPOT_KLINES_ENDPOINT,
          proxy.spotSymbol,
          proxy.priceScale,
          1_000,
        );
      }

      this.tickSizes.set(symbol, tickSize);
      this.extremes.setTickSize(symbol, tickSize);
      this.levels.setTickSize(symbol, tickSize);
      for (const timeframe of SIGNAL_LAB_V4_TIMEFRAMES) {
        const candles = byTimeframe.get(timeframe) ?? [];
        this.extremes.hydrate(symbol, timeframe, candles, {
          tickSize,
          dataQuality: "RECOVERED",
          dataSource: historySource,
          emitSnapshot: false,
        });
        const lastClosed = [...candles].reverse().find((candle) => candle.closed);
        if (lastClosed) this.lastClosedCandleAt.set(`${symbol}:${timeframe}`, lastClosed.time);
        if (timeframe === "1m") {
          this.#symbol(symbol)?.hydrateMinuteCandles(candles);
          if (lastClosed) this.lastTimeframeAggregationAt.set(symbol, lastClosed.time);
        }
      }
      const futuresPrice = finite(this.symbols.get(symbol)?.price);
      if (futuresPrice > 0) {
        this.extremes.observePrice(symbol, futuresPrice, Date.now(), {
          dataQuality: "LIVE",
          emitSnapshot: false,
        });
      }
      this.historyLoaded.add(symbol);
      this.historyUnavailable.delete(symbol);
      this.historySourceBySymbol.set(symbol, historySource);
      this.historyRetryAt.delete(symbol);
      this.#publish({
        ...this.#historyCounts(),
        tickSizes: this.tickSizes.size,
        lastError: null,
      });
    } catch (error) {
      this.historyUnavailable.add(symbol);
      this.historyRetryAt.set(symbol, Date.now() + 60_000);
      this.#publish({
        ...this.#historyCounts(),
        lastError: String(error?.message ?? error).slice(0, 180),
      });
    } finally {
      this.historyLoading.delete(symbol);
      this.#publish({ warmupLoading: this.historyLoading.size });
    }
  }
'''
replace_exact(collector, old_exchange, new_exchange)

# Preserve the historical source inside every extreme and snapshot.
replace_exact(
    extremes,
    '    this.dataQuality = EXTREME_DATA_QUALITY.LIVE;\n  }\n\n  ingestCandles(rows, { dataQuality = this.dataQuality, emitSnapshot = true } = {}) {',
    '    this.dataQuality = EXTREME_DATA_QUALITY.LIVE;\n    this.dataSource = "BINANCE_FUTURES_REST";\n  }\n\n  ingestCandles(rows, {\n    dataQuality = this.dataQuality,\n    dataSource = this.dataSource,\n    emitSnapshot = true,\n  } = {}) {',
)
replace_exact(
    extremes,
    '      this.ingestCandle(row, { dataQuality, emitSnapshot: false });',
    '      this.ingestCandle(row, { dataQuality, dataSource, emitSnapshot: false });',
)
replace_exact(
    extremes,
    '''  ingestCandle(raw, {
    dataQuality = this.dataQuality,
    availableAt = null,
    emitSnapshot = true,
  } = {}) {''',
    '''  ingestCandle(raw, {
    dataQuality = this.dataQuality,
    dataSource = this.dataSource,
    availableAt = null,
    emitSnapshot = true,
  } = {}) {''',
)
replace_exact(
    extremes,
    '    this.dataQuality = normalizeQuality(dataQuality);\n    this.barIndex += 1;',
    '    this.dataQuality = normalizeQuality(dataQuality);\n    this.dataSource = String(dataSource || this.dataSource);\n    this.barIndex += 1;',
)
replace_exact(
    extremes,
    '      dataQuality: this.dataQuality,\n      formulaVersion: SIGNAL_LAB_V4_EXTREME_FORMULA_VERSION,',
    '      dataQuality: this.dataQuality,\n      dataSource: this.dataSource,\n      formulaVersion: SIGNAL_LAB_V4_EXTREME_FORMULA_VERSION,',
)
replace_exact(
    extremes,
    '      dataQuality: this.dataQuality,\n      mode: this.mode,',
    '      dataQuality: this.dataQuality,\n      dataSource: this.dataSource,\n      mode: this.mode,',
)

# Make the source visible and cache-bust the fixed collector.
replace_exact(
    owner,
    'import { SignalLabV3Collector } from "./signal-lab-v3-collector.js?v=signal-lab-v6-extreme-runtime";',
    'import { SignalLabV3Collector } from "./signal-lab-v3-collector.js?v=signal-lab-v6-extreme-history-fallback";',
)
replace_exact(
    owner,
    '  const error = status.lastError ? ` · ошибка: ${status.lastError}` : "";\n  return `${connection} · проверки ${status.checks} · эпизоды ${status.createdEpisodes} · экстремумы ${status.activeExtremes ?? 0} активных / ${status.extremeMaps ?? 0} монет · зоны ${status.levelMaps ?? 0}/${status.breakoutEvents ?? 0} · каскады ${status.cascadeSetups ?? 0}/${status.cascadeTriggered ?? 0}/${status.cascadeConfirmed ?? 0} · miniTicker ${status.miniTickerPackets ?? 0} · aggTrade ${status.aggTradePackets ?? 0}/${status.trackedTrades} · book ${status.bookPackets ?? 0} · ${depth} · пакеты ${status.evidencePacks ?? 0} · история ${status.warmupLoaded} · пакет ${age}${error}`;',
    '  const error = status.lastError ? ` · ошибка: ${status.lastError}` : "";\n  const history = `${status.historyMode ?? "PENDING"} ${status.warmupLoaded ?? 0} (F ${status.warmupFutures ?? 0} / SPOT PROXY ${status.warmupSpotProxy ?? 0} / нет ${status.warmupUnavailable ?? 0})`;\n  return `${connection} · проверки ${status.checks} · эпизоды ${status.createdEpisodes} · экстремумы ${status.activeExtremes ?? 0} активных / ${status.extremeMaps ?? 0} монет · зоны ${status.levelMaps ?? 0}/${status.breakoutEvents ?? 0} · каскады ${status.cascadeSetups ?? 0}/${status.cascadeTriggered ?? 0}/${status.cascadeConfirmed ?? 0} · miniTicker ${status.miniTickerPackets ?? 0} · aggTrade ${status.aggTradePackets ?? 0}/${status.trackedTrades} · book ${status.bookPackets ?? 0} · ${depth} · пакеты ${status.evidencePacks ?? 0} · история ${history} · пакет ${age}${error}`;',
)
replace_exact(
    html,
    '<script type="module" src="./owner-signal-lab-v3.js?v=signal-lab-v6-extreme-runtime"></script>',
    '<script type="module" src="./owner-signal-lab-v3.js?v=signal-lab-v6-extreme-history-fallback"></script>',
)

# Add regression tests around source selection and transparent status.
test = Path("test/signal-lab-v6-extreme-history-fallback.test.js")
test.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\nimport {\n  resolveSpotHistoryProxy,\n  scaleProxyCandle,\n} from "../signal-lab-v3-collector.js";\n\ntest("direct Spot history proxy preserves the symbol and tick size", () => {\n  const proxy = resolveSpotHistoryProxy("BTCUSDT", new Map([["BTCUSDT", 0.01]]));\n  assert.deepEqual(proxy, {\n    futuresSymbol: "BTCUSDT",\n    spotSymbol: "BTCUSDT",\n    priceScale: 1,\n    tickSize: 0.01,\n    source: "BINANCE_SPOT_PROXY",\n  });\n});\n\ntest("multiplier Futures symbols can use scaled Spot history", () => {\n  const proxy = resolveSpotHistoryProxy("1000PEPEUSDT", new Map([["PEPEUSDT", 0.00000001]]));\n  assert.equal(proxy.spotSymbol, "PEPEUSDT");\n  assert.equal(proxy.priceScale, 1000);\n  assert.equal(proxy.tickSize, 0.00001);\n  const candle = scaleProxyCandle({\n    time: 1, open: 0.00001, high: 0.000012, low: 0.000009, close: 0.000011, closed: true,\n  }, proxy.priceScale);\n  assert.equal(candle.open, 0.01);\n  assert.equal(candle.high, 0.012);\n  assert.equal(candle.low, 0.009);\n  assert.equal(candle.close, 0.011);\n});\n\ntest("unknown Spot proxy is rejected instead of fabricating history", () => {\n  assert.equal(resolveSpotHistoryProxy("UNKNOWNUSDT", new Map()), null);\n});\n\ntest("collector exposes futures-first fallback and explicit history source", () => {\n  const source = fs.readFileSync(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");\n  assert.match(source, /BINANCE_SPOT_KLINES_ENDPOINT/);\n  assert.match(source, /this\\.futuresRestAvailable/);\n  assert.match(source, /historySource = proxy\\.source/);\n  assert.match(source, /dataSource: historySource/);\n  assert.match(source, /historyMode: "SPOT_PROXY"/);\n});\n\ntest("owner status never presents Spot proxy history as Futures history", () => {\n  const source = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");\n  assert.match(source, /SPOT PROXY/);\n  assert.match(source, /warmupSpotProxy/);\n  assert.match(source, /historyMode/);\n});\n''', encoding="utf-8")

Path("scripts/apply-signal-lab-extreme-451-fallback.py").unlink()
Path(".github/workflows/zz-signal-lab-extreme-451-fallback.yml").unlink()
