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

test("cascade detector accepts same-side extrema in a zero-to-five-percent zone", () => {
  const candles = [
    { time: 1, high: 100, low: 96 },
    { time: 2, high: 102, low: 97 },
    { time: 3, high: 100.5, low: 98 },
    { time: 4, high: 103, low: 99 },
    { time: 5, high: 101, low: 98 },
    { time: 6, high: 104, low: 100 },
  ];
  const detected = detectMarketwideCascade({ price: 104, minuteCandles: candles });
  assert.equal(detected.type, "cascade");
  assert.equal(detected.direction, "up");
  assert.equal(detected.evidence.extremaCount, 2);
  assert.ok(detected.evidence.zoneWidthPercent <= 5);
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

