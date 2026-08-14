import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeOrderBookMarketKey } from "./orderbook-market-key.js";

const runtime = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");

test("market-qualified order-book keys keep market lowercase and symbol uppercase", () => {
  assert.equal(normalizeOrderBookMarketKey("FUTURES:akeusdt"), "futures:AKEUSDT");
  assert.equal(normalizeOrderBookMarketKey("spot:Ake/Usdt"), "spot:AKEUSDT");
  assert.equal(normalizeOrderBookMarketKey("akeusdt", "SPOT"), "spot:AKEUSDT");
  assert.equal(normalizeOrderBookMarketKey("AKEBTC", "futures"), null);
});

test("Tape and footprint consumers normalize the same Worker event key as their card", () => {
  assert.match(runtime, /function cardSymbol\(card\)[\s\S]*return normalizeOrderBookMarketKey\(pair, market\);/);
  assert.match(runtime, /function acceptTapeData\(event\)[\s\S]*normalizeOrderBookMarketKey\(detail\?\.symbol, detail\?\.market\);/);
  assert.match(workspace, /function cardSymbol\(card\)[\s\S]*return normalizeOrderBookMarketKey\(pair, market\);/);
  assert.match(workspace, /function acceptTape\(event\)[\s\S]*normalizeOrderBookMarketKey\(detail\?\.symbol, detail\?\.market\);/);
});

test("book-data and status consumers use the same canonical key", () => {
  assert.match(runtime, /function acceptBookData\(event\)[\s\S]*normalizeOrderBookMarketKey\(event\?\.detail\?\.symbol, event\?\.detail\?\.market\);/);
  assert.match(runtime, /function acceptBookStatus\(event\)[\s\S]*normalizeOrderBookMarketKey\(event\?\.detail\?\.symbol, event\?\.detail\?\.market\);/);
  assert.match(workspace, /function acceptBookStatus\(event\)[\s\S]*normalizeOrderBookMarketKey\(event\?\.detail\?\.symbol, event\?\.detail\?\.market\);/);
});
