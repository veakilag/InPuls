import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildRunValidity,
  buildVerdict,
  estimateClockOffset,
  matchAggregateToRaw,
  normalizeTradeEvent,
  percentile,
  sourceFromTradePayload,
  summarize,
} from "./trade-latency-core.js";

test("percentile and summary are deterministic", () => {
  assert.equal(percentile([1, 2, 3, 4], .5), 2.5);
  const summary = summarize([10, 20, 30]);
  assert.equal(summary.count, 3);
  assert.equal(summary.mean, 20);
  assert.equal(summary.p95, 29);
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

test("combined payload source is classified exactly", () => {
  assert.equal(sourceFromTradePayload({ stream: "btcusdt@trade", data: { e: "trade" } }), "trade");
  assert.equal(sourceFromTradePayload({ stream: "btcusdt@aggTrade", data: { e: "aggTrade" } }), "aggTrade");
  assert.equal(sourceFromTradePayload({ stream: "btcusdt@bookTicker", data: { e: "bookTicker" } }), null);
});

test("normalization rejects zero values and wrong symbols", () => {
  assert.equal(normalizeTradeEvent({ e: "trade", s: "BTCUSDT", E: 100, T: 99, t: 7, p: "0", q: "2" }, "trade", 120, "BTCUSDT"), null);
  assert.equal(normalizeTradeEvent({ e: "trade", s: "ETHUSDT", E: 100, T: 99, t: 7, p: "10", q: "2" }, "trade", 120, "BTCUSDT"), null);
  assert.equal(normalizeTradeEvent({ e: "aggTrade", s: "BTCUSDT", E: 100, T: 99, a: 8, f: 9, l: 7, p: "10", q: "2" }, "aggTrade", 120, "BTCUSDT"), null);
});

test("normalization supports valid trade and aggTrade payloads", () => {
  const raw = normalizeTradeEvent({ e: "trade", s: "BTCUSDT", E: 100, T: 99, t: 7, p: "10", q: "2", m: false }, "trade", 120, "BTCUSDT");
  const agg = normalizeTradeEvent({ e: "aggTrade", s: "BTCUSDT", E: 100, T: 99, a: 8, f: 7, l: 9, p: "10", q: "6", m: true }, "aggTrade", 121, "BTCUSDT");
  assert.equal(raw.id, 7);
  assert.equal(raw.side, "buy");
  assert.equal(agg.firstTradeId, 7);
  assert.equal(agg.lastTradeId, 9);
});

test("raw trades match aggregate by receive and render times", () => {
  const rawById = new Map([
    [100, { quantity: 1, receiveAt: 1000, renderAt: 1020 }],
    [101, { quantity: 2, receiveAt: 1002, renderAt: 1022 }],
    [102, { quantity: 3, receiveAt: 1004, renderAt: 1024 }],
  ]);
  const match = matchAggregateToRaw({ firstTradeId: 100, lastTradeId: 102, receiveAt: 1010, renderAt: 1030, quantity: 6 }, rawById);
  assert.equal(match.coverage, 1);
  assert.equal(match.renderCoverage, 1);
  assert.equal(match.rawFirstLeadMs, 10);
  assert.equal(match.rawCompleteLeadMs, 6);
  assert.equal(match.rawFirstPaintLeadMs, 10);
  assert.equal(match.rawCompletePaintLeadMs, 6);
  assert.equal(match.volumeDifferencePercent, 0);
});

test("null render timestamps are not treated as painted", () => {
  const rawById = new Map([
    [100, { quantity: 1, receiveAt: 1000, renderAt: null }],
    [101, { quantity: 2, receiveAt: 1002, renderAt: 1022 }],
  ]);
  const beforeAggregatePaint = matchAggregateToRaw(
    { firstTradeId: 100, lastTradeId: 101, receiveAt: 1010, renderAt: null, quantity: 3 },
    rawById,
  );
  assert.equal(beforeAggregatePaint.renderCoverage, .5);
  assert.equal(beforeAggregatePaint.rawFirstPaintLeadMs, null);
  assert.equal(beforeAggregatePaint.rawCompletePaintLeadMs, null);

  const afterAggregatePaint = matchAggregateToRaw(
    { firstTradeId: 100, lastTradeId: 101, receiveAt: 1010, renderAt: 1030, quantity: 3 },
    rawById,
  );
  assert.equal(afterAggregatePaint.renderCoverage, .5);
  assert.equal(afterAggregatePaint.rawFirstPaintLeadMs, 8);
  assert.equal(afterAggregatePaint.rawCompletePaintLeadMs, 8);
});

test("run validity fails on reconnect, invalid payload or hidden tab", () => {
  assert.equal(buildRunValidity({ phase: "measuring" }).valid, null);
  assert.equal(buildRunValidity({ phase: "finished" }).valid, true);
  const invalid = buildRunValidity({ phase: "invalid", reconnects: 1, invalidEvents: 2, hiddenDuringMeasurement: true });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reasons.length, 3);
});

test("verdict requires valid run, quality and material visual lead", () => {
  assert.equal(buildVerdict({ runValid: false, invalidReasons: ["reconnect"] }).title, "Тест невалиден");
  assert.equal(buildVerdict({ runValid: true, matchedComplete: 10 }).title, "Недостаточно данных");
  assert.equal(buildVerdict({ runValid: true, matchedComplete: 40, rawEarlierRatio: .8, medianLeadMs: 60, medianCompleteLeadMs: 30, medianPaintLeadMs: 50, medianCoverage: .9, medianVolumeDifferencePercent: 0, rawGapCount: 0 }).tone, "warning");
  assert.equal(buildVerdict({ runValid: true, matchedComplete: 40, rawEarlierRatio: .8, medianLeadMs: 60, medianCompleteLeadMs: 30, medianPaintLeadMs: 50, medianCoverage: 1, medianVolumeDifferencePercent: 0, rawGapCount: 0 }).tone, "positive");
});


test("v2 browser lab keeps both streams on one socket with warmup and invalidation", () => {
  const source = readFileSync(new URL("./trade-latency-lab.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("./trade-latency-lab.html", import.meta.url), "utf8");
  assert.match(source, /const WARMUP_MS = 5_000;/);
  assert.match(source, /const streams = \[`\$\{name\}@trade`, `\$\{name\}@aggTrade`\];/);
  assert.equal((source.match(/new WebSocket\(/g) ?? []).length, 1);
  assert.match(source, /fstream\.binance\.com\/market\/stream\?streams=/);
  assert.doesNotMatch(source, /stream\.binancefuture\.com/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /runtime\.sharedReconnects \+= 1;/);
  assert.match(html, /id="validity-state"/);
  assert.match(html, /trade-latency-lab\.js\?v=2\.2/);
});
