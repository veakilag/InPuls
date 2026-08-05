from pathlib import Path


def replace_exact(path, old, new, expected=1):
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old[:180]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


collector = "signal-lab-v3-collector.js"
replace_exact(
    collector,
    "    this.spotTickSizes = new Map();\n    this.futuresRestAvailable = null;",
    "    this.spotTickSizes = new Map();\n    this.spotExchangeInfoPromise = null;\n    this.futuresRestAvailable = null;",
)

old_load = '''  async #loadExchangeInfo() {
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
'''
new_load = '''  async #ensureSpotExchangeInfo() {
    if (this.spotTickSizes.size) return this.spotTickSizes;
    if (this.spotExchangeInfoPromise) return this.spotExchangeInfoPromise;
    this.spotExchangeInfoPromise = (async () => {
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
      if (!this.spotTickSizes.size) throw new Error("Spot market-data exchangeInfo не содержит USDT-символов");
      return this.spotTickSizes;
    })();
    try {
      return await this.spotExchangeInfoPromise;
    } catch (error) {
      this.spotExchangeInfoPromise = null;
      throw error;
    }
  }

  async #loadExchangeInfo() {
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
      await this.#ensureSpotExchangeInfo();
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
'''
replace_exact(collector, old_load, new_load)

replace_exact(
    collector,
    '''      if (!byTimeframe) {
        const proxy = resolveSpotHistoryProxy(symbol, this.spotTickSizes);''',
    '''      if (!byTimeframe) {
        await this.#ensureSpotExchangeInfo();
        const proxy = resolveSpotHistoryProxy(symbol, this.spotTickSizes);''',
)

# Strengthen regression coverage for lazy fallback after partial Futures availability.
test = Path("test/signal-lab-v6-extreme-history-fallback.test.js")
text = test.read_text(encoding="utf-8")
old_assertions = '''  assert.match(source, /this\\.futuresRestAvailable/);
  assert.match(source, /historySource = proxy\\.source/);'''
new_assertions = '''  assert.match(source, /this\\.futuresRestAvailable/);
  assert.match(source, /#ensureSpotExchangeInfo\\(\\)/);
  assert.match(source, /await this\\.#ensureSpotExchangeInfo\\(\\);/);
  assert.match(source, /historySource = proxy\\.source/);'''
if text.count(old_assertions) != 1:
    raise SystemExit("unexpected fallback assertion block")
test.write_text(text.replace(old_assertions, new_assertions), encoding="utf-8")

Path("scripts/apply-signal-lab-lazy-spot-fallback.py").unlink()
Path(".github/workflows/zz-signal-lab-lazy-spot-fallback.yml").unlink()
