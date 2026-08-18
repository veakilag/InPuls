import assert from "node:assert/strict";
import test from "node:test";

import { DensityMapScanner } from "../density-map-scanner.js";

class FakeOrderBookFeed {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
  }

  select(symbol) {
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.options.onData({
        symbol,
        bids: [[100, 2_000]],
        asks: [[101, 10]],
      });
    });
  }

  destroy() {
    this.destroyed = true;
  }
}

test("scanner discovers a market and promotes it to live lifetime tracking", async () => {
  let scanner;
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("scanner did not produce a match")), 1_000);
    scanner = new DensityMapScanner({
      minQuote: 100_000,
      minLifetimeMs: 0,
      scanDelayMs: 80,
      sources: [{ exchange: "binance", market: "futures" }],
      fetchTickers: async () => [{ s: "BTCUSDT", q: 1_000_000 }],
      fetchOrderBook: async () => ({ bids: [[100, 2_000]], asks: [[101, 10]] }),
      OrderBookFeedClass: FakeOrderBookFeed,
      onUpdate(snapshot) {
        if (!snapshot.entries.length) return;
        clearTimeout(timeout);
        resolve(snapshot);
      },
    });
  });

  scanner.start();
  const snapshot = await completed;
  assert.equal(snapshot.entries[0].symbol, "BTCUSDT");
  assert.equal(snapshot.stats.liveMarkets, 1);
  assert.equal(snapshot.stats.universeTotal, 1);
  scanner.destroy();
});
