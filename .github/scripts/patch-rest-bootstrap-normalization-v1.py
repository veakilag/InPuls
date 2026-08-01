from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding="utf-8")
    if source.count(old) != 1:
        raise SystemExit(f"Expected exactly one anchor in {path}, found {source.count(old)}")
    file_path.write_text(source.replace(old, new, 1), encoding="utf-8")


replace_once(
    "binance-stream-routing.js",
    '''export function isBinanceSubscriptionError(payload) {
  return Boolean(payload && typeof payload === "object" && Number.isFinite(Number(payload.code)));
}

export function isCoreMiniTickerPacket(data) {''',
    '''export function isBinanceSubscriptionError(payload) {
  return Boolean(payload && typeof payload === "object" && Number.isFinite(Number(payload.code)));
}

export function normalizeBinanceRestMiniTicker(ticker, now = Date.now()) {
  if (!ticker || typeof ticker !== "object") return null;
  const normalized = {
    e: "24hrMiniTicker",
    E: Number(ticker.closeTime) || Number(ticker.E) || Number(now) || Date.now(),
    s: String(ticker.symbol ?? ticker.s ?? "").trim().toUpperCase(),
    c: ticker.lastPrice ?? ticker.c,
    o: ticker.openPrice ?? ticker.o,
    h: ticker.highPrice ?? ticker.h,
    l: ticker.lowPrice ?? ticker.l,
    v: ticker.volume ?? ticker.v,
    q: ticker.quoteVolume ?? ticker.q,
  };
  return isCoreMiniTickerPacket([normalized]) ? normalized : null;
}

export function isCoreMiniTickerPacket(data) {''',
)

replace_once(
    "app.js",
    '''import { buildBinanceChannelStreams, buildBinanceChannelTransports, isBinanceSubscriptionError, isCoreMiniTickerPacket, nextBinanceTransportIndex } from "./binance-stream-routing.js?v=26-89-core-feed-footprint-runtime-v1";''',
    '''import { buildBinanceChannelStreams, buildBinanceChannelTransports, isBinanceSubscriptionError, isCoreMiniTickerPacket, nextBinanceTransportIndex, normalizeBinanceRestMiniTicker } from "./binance-stream-routing.js?v=26-89-core-feed-footprint-runtime-v1";''',
)

replace_once(
    "app.js",
    '''    const now = Date.now();
    const normalized = rows.map((ticker) => ({
      ...ticker,
      e: "24hrMiniTicker",
      E: Number(ticker?.E) || now,
    }));
    this.#handle(normalized);''',
    '''    const now = Date.now();
    const normalized = rows
      .map((ticker) => normalizeBinanceRestMiniTicker(ticker, now))
      .filter(Boolean);
    if (!normalized.length) {
      this.#scheduleMarketBootstrap(10_000);
      return;
    }
    this.#handle(normalized);''',
)

replace_once(
    "test-core-feed-footprint-runtime-v1.mjs",
    '''import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");''',
    '''import { readFile } from "node:fs/promises";
import { normalizeBinanceRestMiniTicker } from "./binance-stream-routing.js";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");''',
)

replace_once(
    "test-core-feed-footprint-runtime-v1.mjs",
    '''  assert.match(app, /e: "24hrMiniTicker"/);
  assert.match(app, /setConnection\\("online", "Онлайн"\\)/);
});''',
    '''  assert.match(app, /normalizeBinanceRestMiniTicker\\(ticker, now\\)/);
  assert.match(app, /setConnection\\("online", "Онлайн"\\)/);
});

test("REST 24h ticker fields are converted to the miniTicker contract used by SymbolState", () => {
  const normalized = normalizeBinanceRestMiniTicker({
    symbol: "BTCUSDT",
    closeTime: 1_725_000_000_000,
    lastPrice: "64000.5",
    openPrice: "62500.0",
    highPrice: "64500.0",
    lowPrice: "62000.0",
    volume: "123.45",
    quoteVolume: "7890000.25",
  }, 99);
  assert.deepEqual(normalized, {
    e: "24hrMiniTicker",
    E: 1_725_000_000_000,
    s: "BTCUSDT",
    c: "64000.5",
    o: "62500.0",
    h: "64500.0",
    l: "62000.0",
    v: "123.45",
    q: "7890000.25",
  });
  assert.equal(normalizeBinanceRestMiniTicker({ symbol: "BROKEN", lastPrice: "0" }, 99), null);
});''',
)
