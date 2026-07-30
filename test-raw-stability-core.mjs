import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  RAW_STABILITY_MIN_VISIBLE_MS,
  advanceSourceStallCandidate,
  buildStabilityAssessment,
  diagnoseTradePayload,
  normalizeSequenceMarker,
  normalizeSymbols,
  reconnectDelay,
  reservoirPush,
  sanitizeTradePayload,
  sequenceDelta,
  summarizeMatching,
} from "./raw-stability-core.js";
import { matchAggregateToRaw } from "./trade-latency-core.js";

test("symbol lists are normalized, deduplicated and capped", () => {
  assert.deepEqual(
    normalizeSymbols("btcusdt, ETHUSDT btcusdt / bad", 4),
    ["BTCUSDT", "ETHUSDT"],
  );
  assert.deepEqual(
    normalizeSymbols(["BTCUSDT", "ETHUSDT", "SOLUSDT"], 2),
    ["BTCUSDT", "ETHUSDT"],
  );
});

test("RAW sequence gaps are counted only after the segment anchor", () => {
  const first = sequenceDelta("trade", null, { id: 100 });
  assert.deepEqual(first, { valid: true, nextLast: 100, gapCount: 0, outOfOrder: false, overlap: false });
  const contiguous = sequenceDelta("trade", first.nextLast, { id: 101 });
  assert.equal(contiguous.gapCount, 0);
  const gap = sequenceDelta("trade", contiguous.nextLast, { id: 104 });
  assert.equal(gap.gapCount, 2);
  const old = sequenceDelta("trade", gap.nextLast, { id: 103 });
  assert.equal(old.outOfOrder, true);
  assert.equal(old.nextLast, 104);
});

test("rejected trade payloads keep a usable sequence identity and an exact reason", () => {
  const zeroQuantity = {
    e: "trade",
    E: 100,
    T: 99,
    s: "BTCUSDT",
    t: 101,
    p: "10",
    q: "0",
    m: false,
  };
  const diagnosis = diagnoseTradePayload(zeroQuantity, "trade", 120, "BTCUSDT");
  assert.equal(diagnosis.valid, false);
  assert.equal(diagnosis.reason, "non-positive-quantity");
  assert.deepEqual(diagnosis.sequenceSample, {
    id: 101,
    firstTradeId: 101,
    lastTradeId: 101,
  });

  const next = sequenceDelta("trade", diagnosis.sequenceSample.id, { id: 102 });
  assert.equal(next.gapCount, 0);
});

test("zero-price zero-quantity RAW events are accepted only as sequence markers", () => {
  const marker = {
    e: "trade",
    E: 100,
    T: 99,
    s: "BTCUSDT",
    st: 1,
    t: 101,
    p: "0",
    q: "0",
    m: false,
  };
  const diagnosis = diagnoseTradePayload(marker, "trade", 120, "BTCUSDT");
  assert.equal(diagnosis.valid, true);
  assert.equal(diagnosis.reason, null);
  assert.equal(diagnosis.sequenceMarker, true);
  assert.deepEqual(diagnosis.sequenceSample, {
    id: 101,
    firstTradeId: 101,
    lastTradeId: 101,
  });
  assert.deepEqual(normalizeSequenceMarker(marker, "trade", 120, "BTCUSDT"), {
    source: "trade",
    symbol: "BTCUSDT",
    id: 101,
    firstTradeId: 101,
    lastTradeId: 101,
    price: 0,
    quantity: 0,
    quote: 0,
    eventTime: 100,
    tradeTime: 99,
    receiveAt: 120,
    maker: false,
    side: null,
    renderAt: null,
    sequenceMarker: true,
  });

  const normalTrade = diagnoseTradePayload({ ...marker, t: 102, p: "10", q: "2" }, "trade", 121, "BTCUSDT");
  assert.equal(normalTrade.valid, true);
  assert.equal(normalTrade.sequenceMarker, false);
  assert.equal(normalizeSequenceMarker({ ...marker, t: 102, p: "10", q: "2" }, "trade", 121, "BTCUSDT"), null);

  const zeroQuantityTrade = diagnoseTradePayload({ ...marker, t: 103, p: "10" }, "trade", 122, "BTCUSDT");
  assert.equal(zeroQuantityTrade.valid, false);
  assert.equal(zeroQuantityTrade.reason, "non-positive-quantity");
});

test("sequence markers complete aggregate ID coverage without adding executed volume", () => {
  const rawById = new Map([
    [100, { id: 100, quantity: 1, receiveAt: 90 }],
    [101, { id: 101, quantity: 0, receiveAt: 91, sequenceMarker: true }],
    [102, { id: 102, quantity: 2, receiveAt: 92 }],
  ]);
  const match = matchAggregateToRaw({
    firstTradeId: 100,
    lastTradeId: 102,
    quantity: 3,
    receiveAt: 100,
  }, rawById);
  assert.equal(match.coverage, 1);
  assert.equal(match.availableCount, 3);
  assert.equal(match.rawQuantity, 3);
  assert.equal(match.volumeDifferencePercent, 0);
});

test("invalid payload diagnostics are bounded to public market fields", () => {
  const payload = {
    e: "trade",
    s: "BTCUSDT",
    t: 7,
    p: "10",
    q: "0",
    secret: "must-not-export",
    nested: { ignored: true },
  };
  const sample = sanitizeTradePayload(payload);
  assert.deepEqual(sample.keys, ["e", "nested", "p", "q", "s", "secret", "t"]);
  assert.equal(sample.fields.s, "BTCUSDT");
  assert.equal(sample.fields.q, "0");
  assert.equal("secret" in sample.fields, false);
  assert.equal("nested" in sample.fields, false);
});

test("source-only stalls require continued counterpart activity after market silence", () => {
  const first = advanceSourceStallCandidate(null, 10_000, 3_000);
  assert.equal(first.candidate.startedAt, 10_000);
  assert.equal(first.confirmedNow, false);

  const normalPairArrival = advanceSourceStallCandidate(first.candidate, 10_120, 3_000);
  assert.equal(normalPairArrival.confirmedNow, false);
  assert.equal(normalPairArrival.candidate.confirmed, false);

  const quietMarketReset = advanceSourceStallCandidate(normalPairArrival.candidate, 13_100, 3_000);
  assert.equal(quietMarketReset.confirmedNow, false);
  assert.equal(quietMarketReset.candidate.startedAt, 13_100);

  const second = advanceSourceStallCandidate(quietMarketReset.candidate, 14_600, 3_000);
  const continuedActivity = advanceSourceStallCandidate(second.candidate, 16_200, 3_000);
  assert.equal(continuedActivity.confirmedNow, true);
  assert.equal(continuedActivity.candidate.confirmed, true);
});

test("aggregate sequence uses the complete f-l coverage range", () => {
  const first = sequenceDelta("aggTrade", null, { firstTradeId: 10, lastTradeId: 12 });
  const contiguous = sequenceDelta("aggTrade", first.nextLast, { firstTradeId: 13, lastTradeId: 16 });
  assert.equal(contiguous.gapCount, 0);
  const gap = sequenceDelta("aggTrade", contiguous.nextLast, { firstTradeId: 20, lastTradeId: 21 });
  assert.equal(gap.gapCount, 3);
  const overlap = sequenceDelta("aggTrade", gap.nextLast, { firstTradeId: 21, lastTradeId: 23 });
  assert.equal(overlap.overlap, true);
  assert.equal(overlap.nextLast, 23);
});

test("reconnect backoff is bounded and includes controlled jitter", () => {
  assert.equal(reconnectDelay(0, 0), 500);
  assert.equal(reconnectDelay(1, 1), 1_250);
  assert.equal(reconnectDelay(99, 1), 10_000);
});

test("reservoir keeps exact seen count while bounding retained values", () => {
  const state = { limit: 2, seen: 0, values: [] };
  reservoirPush(state, 10, 0);
  reservoirPush(state, 20, 0);
  reservoirPush(state, 30, .99);
  reservoirPush(state, 40, 0);
  assert.equal(state.seen, 4);
  assert.equal(state.values.length, 2);
  assert.deepEqual(state.values, [40, 20]);
});

function cleanSymbol(overrides = {}) {
  return {
    symbol: "BTCUSDT",
    streams: {
      trade: {
        messages: 10_000,
        invalidEvents: 0,
        gaps: 0,
        duplicates: 0,
        outOfOrder: 0,
        unplannedStalls: 0,
        ...overrides.raw,
      },
      aggTrade: { messages: 2_000, ...overrides.aggregate },
    },
    matching: {
      total: 2_000,
      fullCoverageRatio: 1,
      volumeDifferenceP99: 0,
      ...overrides.matching,
    },
  };
}

test("assessment never promotes an incomplete or short run", () => {
  assert.equal(buildStabilityAssessment({
    phase: "running",
    completed: false,
    visibleMs: RAW_STABILITY_MIN_VISIBLE_MS,
    symbols: [cleanSymbol()],
  }).title, "Прогон не завершён");

  const short = buildStabilityAssessment({
    phase: "finished",
    completed: true,
    visibleMs: RAW_STABILITY_MIN_VISIBLE_MS - 1,
    symbols: [cleanSymbol()],
  });
  assert.equal(short.tone, "negative");
  assert.match(short.text, /видимое время/);
});

test("assessment blocks RAW gaps, stalls and incomplete group coverage", () => {
  const result = buildStabilityAssessment({
    phase: "finished",
    completed: true,
    visibleMs: RAW_STABILITY_MIN_VISIBLE_MS,
    symbols: [cleanSymbol({
      raw: { gaps: 2, unplannedStalls: 1 },
      matching: { fullCoverageRatio: .99 },
    })],
  });
  assert.equal(result.tone, "negative");
  assert.match(result.text, /RAW gap/);
  assert.match(result.text, /source-only stall/);
  assert.match(result.text, /99,99%/);
});

test("assessment blocks fast unplanned reconnects and unfinished recovery", () => {
  const result = buildStabilityAssessment({
    phase: "finished",
    completed: true,
    visibleMs: RAW_STABILITY_MIN_VISIBLE_MS,
    connections: {
      trade: { invalidEvents: 1, unplannedReconnects: 1, recoveryPending: true, recovery: { p95: 120 } },
      aggTrade: { recovery: { p95: 11_000 } },
    },
    symbols: [cleanSymbol()],
  });
  assert.equal(result.tone, "negative");
  assert.match(result.text, /RAW: отклонённый payload/);
  assert.match(result.text, /RAW: аварийный reconnect/);
  assert.match(result.text, /RAW: recovery не завершён/);
  assert.match(result.text, /AGG: recovery P95 больше 10 секунд/);
});

test("clean assessment is explicitly one-run evidence, not production promotion", () => {
  const result = buildStabilityAssessment({
    phase: "finished",
    completed: true,
    visibleMs: RAW_STABILITY_MIN_VISIBLE_MS,
    symbols: [cleanSymbol()],
  });
  assert.equal(result.tone, "positive");
  assert.equal(result.blockers.length, 0);
  assert.match(result.text, /один прогон/);
  assert.match(result.text, /1 \/ 2 \/ 4/);
});

test("matching summary keeps exact totals and sampled distributions", () => {
  const matching = {
    total: 4,
    complete: 3,
    rawEarlier: 2,
    firstLead: { limit: 10, seen: 3, values: [10, 20, -5] },
    completeLead: { limit: 10, seen: 3, values: [1, 2, 3] },
    coverage: { limit: 10, seen: 4, values: [1, 1, 1, .5] },
    volumeDifference: { limit: 10, seen: 3, values: [0, .01, .02] },
  };
  const summary = summarizeMatching(matching);
  assert.equal(summary.fullCoverageRatio, .75);
  assert.equal(summary.rawEarlierRatio, 2 / 3);
  assert.equal(summary.firstLead.p50, 10);
  assert.ok(Math.abs(summary.volumeDifferenceP99 - .0198) < 1e-12);
});

test("browser lab keeps RAW isolated from production and uses routed multi-stream URLs", () => {
  const source = readFileSync(new URL("./raw-stability-lab.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("./raw-stability-lab.html", import.meta.url), "utf8");
  const worker = readFileSync(new URL("./orderbook-worker.js", import.meta.url), "utf8");
  const serviceWorker = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
  assert.match(source, /fstream\.binance\.com\/\$\{route\}\/stream\?streams=\$\{streams\}/);
  assert.match(source, /fstream\.binance\.com\/\$\{route\}\/ws\/\$\{streams\}/);
  assert.match(source, /background-resume-clean-restart/);
  assert.match(source, /manual-raw-restart/);
  assert.match(source, /source-only-stall/);
  assert.match(source, /window\.__INPULS_RAW_LAB__/);
  assert.match(html, /Production TAPE эта страница не переключает/);
  assert.match(source, /MATCH_GUARD_MS = 5_000/);
  assert.match(source, /sequenceObserved/);
  assert.match(source, /sequenceMarkers/);
  assert.match(source, /sequenceMarkerSamples/);
  assert.match(source, /invalidSamples/);
  assert.match(html, /raw-stability-lab\.js\?v=3/);
  assert.match(worker, /return \[`\$\{name\}@aggTrade`\];/);
  assert.doesNotMatch(worker, /return \[`\$\{name\}@trade`\];/);
  assert.match(serviceWorker, /inpuls-26-74-sealed-agg-round-levels-v1/);
  assert.match(serviceWorker, /raw-stability-lab\.html/);
  assert.match(serviceWorker, /raw-stability-lab\.js\?v=3/);
  assert.match(serviceWorker, /raw-stability-core\.js\?v=3/);
});
