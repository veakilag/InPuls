import test from "node:test";
import assert from "node:assert/strict";
import {
  MarketwideSizeScanner,
  detectMarketwideCascade,
} from "../market-pattern-scanner.js";

function ticker({
  symbol = "TESTUSDT",
  bid = 100,
  bidQuantity = 10,
  ask = 101,
  askQuantity = 10,
  at,
}) {
  return {
    e: "bookTicker",
    E: at,
    s: symbol,
    b: String(bid),
    B: String(bidQuantity),
    a: String(ask),
    A: String(askQuantity),
  };
}

test("marketwide scanner detects a comparable strong size moving on the same side", () => {
  const scanner = new MarketwideSizeScanner({
    minimumSamples: 3,
    strongSizeMultiple: 3,
    minimumQuoteUsd: 1_000,
  });
  scanner.ingestBookTicker(ticker({ at: 1, bidQuantity: 10 }));
  scanner.ingestBookTicker(ticker({ at: 2, bidQuantity: 10 }));
  scanner.ingestBookTicker(ticker({ at: 3, bidQuantity: 10 }));
  scanner.ingestBookTicker(ticker({ at: 4, bidQuantity: 100 }));
  const signals = scanner.ingestBookTicker(ticker({
    at: 5,
    bid: 100.1,
    bidQuantity: 100,
  }));
  const rearranger = signals.find((item) => item.type === "rearranger");
  assert.equal(rearranger.direction, "up");
  assert.equal(rearranger.evidence.scope, "marketwide-best-quote");
  assert.equal(rearranger.evidence.fromPrice, 100);
  assert.equal(rearranger.evidence.toPrice, 100.1);
});

test("marketwide scanner detects repeated strong best-quote support", () => {
  const scanner = new MarketwideSizeScanner({
    minimumSamples: 3,
    strongSizeMultiple: 3,
    minimumQuoteUsd: 1_000,
    supporterMinimumTouches: 3,
  });
  for (let at = 1; at <= 3; at += 1) {
    scanner.ingestBookTicker(ticker({ at, askQuantity: 10 }));
  }
  scanner.ingestBookTicker(ticker({ at: 4, askQuantity: 100 }));
  scanner.ingestBookTicker(ticker({ at: 5, askQuantity: 100 }));
  const signals = scanner.ingestBookTicker(ticker({ at: 6, askQuantity: 100 }));
  const supporter = signals.find((item) => item.type === "size_supporter");
  assert.equal(supporter.direction, "down");
  assert.equal(supporter.evidence.touchCount, 3);
});

test("cascade detector requires three staircase highs and enters on the nearest breakout", () => {
  const candles = [
    { time: 1, high: 99, low: 96 },
    { time: 2, high: 100, low: 95 },
    { time: 3, high: 98, low: 94 },
    { time: 4, high: 102, low: 97 },
    { time: 5, high: 99, low: 96 },
    { time: 6, high: 104, low: 98 },
    { time: 7, high: 101, low: 99 },
    { time: 8, high: 105, low: 100 },
  ];
  const detected = detectMarketwideCascade({ price: 105, minuteCandles: candles });
  assert.equal(detected.type, "cascade");
  assert.equal(detected.direction, "up");
  assert.equal(detected.evidence.extremaCount, 3);
  assert.equal(detected.evidence.breakoutPrice, 104);
  assert.ok(detected.evidence.zoneWidthPercent <= 5);
});

test("cascade detector enters short below the newest staircase low", () => {
  const candles = [
    { time: 1, high: 104, low: 101 },
    { time: 2, high: 103, low: 100 },
    { time: 3, high: 102, low: 102 },
    { time: 4, high: 101, low: 98 },
    { time: 5, high: 100, low: 100 },
    { time: 6, high: 99, low: 96 },
    { time: 7, high: 98, low: 97 },
    { time: 8, high: 97, low: 95 },
  ];
  const detected = detectMarketwideCascade({ price: 95, minuteCandles: candles });
  assert.equal(detected.direction, "down");
  assert.equal(detected.evidence.breakoutPrice, 96);
});

test("cascade detector rejects extrema zones wider than five percent", () => {
  const candles = [
    { time: 1, high: 100, low: 96 },
    { time: 2, high: 108, low: 97 },
    { time: 3, high: 100, low: 98 },
    { time: 4, high: 116, low: 99 },
    { time: 5, high: 101, low: 98 },
    { time: 6, high: 117, low: 100 },
  ];
  assert.equal(detectMarketwideCascade({ price: 117, minuteCandles: candles }), null);
});

test("cascade detector rejects a staircase narrower than one percent", () => {
  const candles = [
    { time: 1, high: 100, low: 99.5 },
    { time: 2, high: 100.1, low: 99.6 },
    { time: 3, high: 99.9, low: 99.4 },
    { time: 4, high: 100.4, low: 99.8 },
    { time: 5, high: 100.1, low: 99.7 },
    { time: 6, high: 100.8, low: 100 },
    { time: 7, high: 100.4, low: 100.1 },
    { time: 8, high: 101, low: 100.2 },
  ];
  assert.equal(detectMarketwideCascade({ price: 101, minuteCandles: candles }), null);
});
