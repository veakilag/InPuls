import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildBinanceChannelStreams,
  buildBinanceChannelTransports,
  isCoreMiniTickerPacket,
  nextBinanceTransportIndex,
  normalizeBinanceRestMiniTicker,
} from "./binance-stream-routing.js";

const APP_BUILD = "26-99-tape-priority-comfort-v1";
const STABLE_SW_BUILD = "26-124-multi-exchange-v1";
const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("./sw.js", import.meta.url), "utf8");
const boot = fs.readFileSync(new URL("./runtime-boot-recovery.js", import.meta.url), "utf8");

assert.ok(app.includes("./binance-stream-routing.js"));
assert.ok(app.includes('this.#connectChannel("core")'));
assert.ok(app.includes('this.#connectChannel("auxiliary")'));
assert.ok(app.includes('this.#connectChannel("public")'));
assert.ok(index.indexOf("runtime-boot-recovery.js") < index.indexOf("app.js?v="));
assert.ok(index.includes(APP_BUILD));
assert.ok(sw.includes(STABLE_SW_BUILD));
assert.ok(sw.includes('key.startsWith("inpuls-")'));
assert.ok(sw.includes('fetch(event.request, { cache: "no-store" })'));
assert.ok(sw.includes("SIGNAL_LAB_COLLECTOR_STATUS_MESSAGE"));
assert.ok(!sw.includes("caches.open("));
assert.ok(!sw.includes("cache.addAll("));
assert.ok(!sw.includes("cache.put("));
assert.ok(!sw.includes("caches.match("));
assert.ok(boot.includes("serviceWorker"));
assert.ok(boot.includes("caches.keys"));
assert.ok(boot.includes("isInPulsRegistration"));
assert.ok(boot.includes("scope.pathname === appScope.pathname"));
assert.ok(boot.includes('url.searchParams.delete("_inpuls_reload")'));
assert.ok(!boot.includes("localStorage.clear"));
assert.ok(!boot.includes("indexedDB.deleteDatabase"));
assert.ok(!boot.includes("registrations.map((registration) => registration.unregister())"));

assert.deepEqual(buildBinanceChannelStreams("core"), ["!miniTicker@arr"]);
assert.deepEqual(buildBinanceChannelStreams("public"), ["!bookTicker"]);
assert.ok(buildBinanceChannelStreams("auxiliary", ["BTCUSDT"]).includes("btcusdt@aggTrade"));

const core = buildBinanceChannelTransports("core", ["!miniTicker@arr"]);
assert.equal(core[0].url, "wss://fstream.binance.com/market/stream?streams=!miniTicker@arr");
assert.equal(core[1].url, "wss://fstream.binance.com/market/ws/!miniTicker@arr");

const publicFeed = buildBinanceChannelTransports("public", ["!bookTicker"]);
assert.equal(publicFeed[0].url, "wss://fstream.binance.com/public/stream?streams=!bookTicker");
assert.equal(publicFeed[1].url, "wss://fstream.binance.com/public/ws/!bookTicker");

assert.equal(nextBinanceTransportIndex(0, 2, false), 1);
assert.equal(nextBinanceTransportIndex(1, 2, false), 0);
assert.equal(nextBinanceTransportIndex(1, 2, true), 1);

const restTicker = normalizeBinanceRestMiniTicker({
  symbol: "BTCUSDT",
  lastPrice: "64000",
  openPrice: "63000",
  highPrice: "65000",
  lowPrice: "62000",
  volume: "100",
  quoteVolume: "6400000",
  count: 2_345_678,
  closeTime: 123456,
});
assert.equal(restTicker?.e, "24hrMiniTicker");
assert.equal(restTicker?.n, 2_345_678);
assert.ok(isCoreMiniTickerPacket([restTicker]));

console.log("runtime boot/network-only-sw/feed contracts passed");
