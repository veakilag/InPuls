import assert from "node:assert/strict";
import test from "node:test";

import { buildOrderBookStream } from "../exchange-market-data.js";

function subscriptions(descriptor) {
  const sent = [];
  descriptor.open({ send(value) { sent.push(JSON.parse(value)); } });
  return sent;
}

test("density depth feed supports Binance without subscribing to trades", async () => {
  const descriptor = await buildOrderBookStream({
    exchange: "binance",
    market: "futures",
    symbol: "BTCUSDT",
  }, { depthOnly: true });

  assert.equal(descriptor.url, "wss://fstream.binance.com/ws/btcusdt@depth@100ms");
  const [event] = descriptor.parse({
    e: "depthUpdate",
    E: 1_000,
    U: 10,
    u: 11,
    pu: 9,
    b: [["100", "2"]],
    a: [["101", "3"]],
  });
  assert.equal(event.kind, "book");
  assert.equal(event.requiresSnapshot, true);
  assert.deepEqual(event.bids, [[100, 2]]);
});

test("depth-only generic subscriptions omit the public trade channel", async () => {
  const source = { exchange: "bybit", market: "spot", symbol: "BTCUSDT" };
  const depth = await buildOrderBookStream(source, { depthOnly: true });
  const full = await buildOrderBookStream(source);

  assert.deepEqual(subscriptions(depth)[0].args, ["orderbook.200.BTCUSDT"]);
  assert.deepEqual(subscriptions(full)[0].args, [
    "orderbook.200.BTCUSDT",
    "publicTrade.BTCUSDT",
  ]);
});
