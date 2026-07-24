import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVerdict,
  estimateClockOffset,
  matchAggregateToRaw,
  normalizeTradeEvent,
  percentile,
  summarize,
} from "./trade-latency-core.js";

test("percentile and summary are deterministic", () => {
  assert.equal(percentile([1, 2, 3, 4], .5), 2.5);
  const summary = summarize([10, 20, 30]);
  assert.equal(summary.count, 3);
  assert.equal(summary.min, 10);
  assert.equal(summary.mean, 20);
  assert.equal(summary.p50, 20);
  assert.equal(summary.p95, 29);
  assert.ok(Math.abs(summary.p99 - 29.8) < 1e-9);
  assert.equal(summary.max, 30);
});

test("clock offset uses the lowest RTT samples", () => {
  const result = estimateClockOffset([
    { sentAt: 0, receivedAt: 100, serverTime: 60 },
    { sentAt: 1000, receivedAt: 1020, serverTime: 1015 },
    { sentAt: 2000, receivedAt: 2030, serverTime: 2020 },
    { sentAt: 3000, receivedAt: 3040, serverTime: 3025 },
  ]);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.offsetMs, 5);
  assert.equal(result.rttMs, 30);
});

test("raw trades match an aggregate trade by trade id range", () => {
  const rawById = new Map([
    [100, { quantity: 1, receiveAt: 1000 }],
    [101, { quantity: 2, receiveAt: 1002 }],
    [102, { quantity: 3, receiveAt: 1004 }],
  ]);
  const match = matchAggregateToRaw({ firstTradeId: 100, lastTradeId: 102, receiveAt: 1010, quantity: 6 }, rawById);
  assert.equal(match.coverage, 1);
  assert.equal(match.rawQuantity, 6);
  assert.equal(match.volumeDifferencePercent, 0);
  assert.equal(match.rawFirstLeadMs, 10);
  assert.equal(match.rawCompleteLeadMs, 6);
});

test("normalization supports trade and aggTrade payloads", () => {
  const raw = normalizeTradeEvent({ e: "trade", E: 100, T: 99, t: 7, p: "10", q: "2", m: false }, "trade", 120);
  const agg = normalizeTradeEvent({ e: "aggTrade", E: 100, T: 99, a: 8, f: 7, l: 9, p: "10", q: "6", m: true }, "aggTrade", 121);
  assert.equal(raw.id, 7);
  assert.equal(raw.side, "buy");
  assert.equal(agg.firstTradeId, 7);
  assert.equal(agg.lastTradeId, 9);
  assert.equal(agg.side, "sell");
});

test("verdict requires quality before speed", () => {
  assert.equal(buildVerdict({ matched: 10 }).title, "Недостаточно данных");
  assert.equal(buildVerdict({ matched: 40, rawEarlierRatio: .8, medianLeadMs: 8, medianCoverage: .9, medianVolumeDifferencePercent: 0, rawGapCount: 0 }).tone, "warning");
  assert.equal(buildVerdict({ matched: 40, rawEarlierRatio: .8, medianLeadMs: 8, medianCoverage: 1, medianVolumeDifferencePercent: 0, rawGapCount: 0 }).tone, "positive");
});
