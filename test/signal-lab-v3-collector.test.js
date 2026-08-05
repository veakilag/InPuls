import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const collectorSource = await readFile(
  new URL("../signal-lab-v3-collector.js", import.meta.url),
  "utf8",
);
const ownerHtml = await readFile(
  new URL("../owner-signal-lab-v3.html", import.meta.url),
  "utf8",
);
const ownerRuntime = await readFile(
  new URL("../owner-signal-lab-v3.js", import.meta.url),
  "utf8",
);

test("Signal Lab V3 separates Binance market and public routes", () => {
  assert.equal(collectorSource.includes("wss://fstream.binance.com/market/ws"), true);
  assert.equal(collectorSource.includes("wss://fstream.binance.com/public/ws"), true);
  assert.equal(collectorSource.includes('const BINANCE_STREAM_ENDPOINT = "wss://fstream.binance.com/ws"'), false);
  assert.equal(collectorSource.includes('params: ["!bookTicker"]'), true);
  assert.equal(collectorSource.includes('"!miniTicker@arr"'), true);
});

test("Signal Lab V3 reports LIVE only after a real miniTicker packet", () => {
  assert.equal(collectorSource.includes('connection: "syncing"'), true);
  assert.equal(collectorSource.includes('row?.e === "24hrMiniTicker"'), true);
  assert.equal(collectorSource.includes('patch.connection = "live"'), true);
  assert.equal(collectorSource.includes("обязательный miniTicker"), true);
  assert.equal(collectorSource.includes("subscriptionErrors"), true);
  assert.equal(collectorSource.includes("miniTickerPackets"), true);
  assert.equal(collectorSource.includes("bookPackets"), true);
  assert.equal(collectorSource.includes("aggTradePackets"), true);
});

test("Signal Lab V3 owner page exposes truthful live diagnostics and evidence replay", () => {
  assert.equal(ownerHtml.includes('name="robots" content="noindex,nofollow,noarchive"'), true);
  assert.equal(ownerHtml.includes("signal-lab-v3-four-patterns-v1"), true);
  assert.equal(ownerRuntime.includes('syncing: "синхронизация"'), true);
  assert.equal(ownerRuntime.includes("miniTicker"), true);
  assert.equal(ownerRuntime.includes("aggTradePackets"), true);
  assert.equal(ownerRuntime.includes("bookPackets"), true);
  assert.equal(ownerRuntime.includes("depthState"), true);
  assert.equal(ownerHtml.includes('data-field="replay-slider"'), true);
  assert.equal(ownerHtml.includes("Почему я выбрал гипотезу"), true);
  assert.equal(/api[_-]?key|secret|private[_-]?key/i.test(ownerHtml), false);
});


test("Signal Lab V3 collector tracks trades and depth only after both market filters", () => {
  assert.match(collectorSource, /minimumQuoteVolume24h/);
  assert.match(collectorSource, /minimumNatr5Percent/);
  assert.match(collectorSource, /finite\(row\.natr5m\)/);
  assert.match(ownerHtml, /выше \$100 млн/);
  assert.match(ownerHtml, /NATR5 выше 1%/);
});
