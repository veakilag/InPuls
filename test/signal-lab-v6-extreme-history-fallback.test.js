import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  resolveSpotHistoryProxy,
  scaleProxyCandle,
} from "../signal-lab-v3-collector.js";

test("direct Spot history proxy preserves the symbol and tick size", () => {
  const proxy = resolveSpotHistoryProxy("BTCUSDT", new Map([["BTCUSDT", 0.01]]));
  assert.deepEqual(proxy, {
    futuresSymbol: "BTCUSDT",
    spotSymbol: "BTCUSDT",
    priceScale: 1,
    tickSize: 0.01,
    source: "BINANCE_SPOT_PROXY",
  });
});

test("multiplier Futures symbols can use scaled Spot history", () => {
  const proxy = resolveSpotHistoryProxy("1000PEPEUSDT", new Map([["PEPEUSDT", 0.00000001]]));
  assert.equal(proxy.spotSymbol, "PEPEUSDT");
  assert.equal(proxy.priceScale, 1000);
  assert.equal(proxy.tickSize, 0.00001);
  const candle = scaleProxyCandle({
    time: 1, open: 0.00001, high: 0.000012, low: 0.000009, close: 0.000011, closed: true,
  }, proxy.priceScale);
  assert.equal(candle.open, 0.01);
  assert.equal(candle.high, 0.012);
  assert.ok(Math.abs(candle.low - 0.009) < 1e-12);
  assert.equal(candle.close, 0.011);
});

test("unknown Spot proxy is rejected instead of fabricating history", () => {
  assert.equal(resolveSpotHistoryProxy("UNKNOWNUSDT", new Map()), null);
});

test("collector exposes futures-first fallback and explicit history source", () => {
  const source = fs.readFileSync(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
  assert.match(source, /BINANCE_SPOT_KLINES_ENDPOINT/);
  assert.match(source, /this\.futuresRestAvailable/);
  assert.match(source, /historySource = proxy\.source/);
  assert.match(source, /dataSource: historySource/);
  assert.match(source, /historyMode: "SPOT_PROXY"/);
});

test("owner status never presents Spot proxy history as Futures history", () => {
  const source = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
  assert.match(source, /SPOT PROXY/);
  assert.match(source, /warmupSpotProxy/);
  assert.match(source, /historyMode/);
});
