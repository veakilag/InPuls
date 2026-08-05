import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  detectExpertCandidates,
  SIGNAL_LAB_V3_FORMULA_VERSION,
} from "../signal-lab-v3-candidates.js";
import {
  buildCandleCoverage,
  episodeHistoryBounds,
  EPISODE_CONTEXT_RANGES,
} from "../signal-lab-v3-full-chart.js";
import {
  normalizeRawTrade,
  SIGNAL_LAB_V4_ORDERFLOW_VERSION,
} from "../signal-lab-v4-orderflow-recorder.js";
import { mergeOrderFlowReplay } from "../signal-lab-v3-evidence.js";

function reversalMetrics(extremePrice, currentPrice, side = "down") {
  const now = 100_000;
  const origin = 100;
  const before = side === "down"
    ? [origin, 99.95, 99.9, 99.8, 99.7]
    : [origin, 100.05, 100.1, 100.2, 100.3];
  return {
    now,
    metrics: {
      symbol: "TESTUSDT",
      price: currentPrice,
      updatedAt: now,
      warmupSeconds: 300,
      quoteVolume24h: 200_000_000,
      natr5m: 1.1,
      priceHistory: [
        ...before.map((price, index) => ({ at: 40_000 + index * 8_000, price })),
        { at: 90_000, price: extremePrice },
      ],
      minuteCandles: [],
      trades: {},
      liquidation: {},
    },
  };
}

test("knife and sharpening reject exactly 1.00 percent impulse", () => {
  const down = reversalMetrics(99, 99.2, "down");
  const up = reversalMetrics(101, 100.8, "up");
  assert.equal(detectExpertCandidates(down.metrics, down.now).some((row) => row.candidateType === "down_reversal_attempt"), false);
  assert.equal(detectExpertCandidates(up.metrics, up.now).some((row) => row.candidateType === "up_reversal_attempt"), false);
});

test("knife and sharpening accept impulse strictly above 1 percent", () => {
  const down = reversalMetrics(98.99, 99.2, "down");
  const up = reversalMetrics(101.01, 100.8, "up");
  const knife = detectExpertCandidates(down.metrics, down.now).find((row) => row.candidateType === "down_reversal_attempt");
  const sharpening = detectExpertCandidates(up.metrics, up.now).find((row) => row.candidateType === "up_reversal_attempt");
  assert.ok(knife);
  assert.ok(sharpening);
  assert.equal(knife.evidence.impulseThresholdMode, "STRICT_GREATER_THAN");
  assert.equal(sharpening.evidence.requiredImpulsePercent, 1);
  assert.match(SIGNAL_LAB_V3_FORMULA_VERSION, /signal-lab-v5/);
});

test("30 day bounds end at the event candle and request the whole prior month", () => {
  const eventAt = Date.UTC(2026, 7, 5, 12, 0, 0);
  const bounds = episodeHistoryBounds(eventAt, 3_600_000, EPISODE_CONTEXT_RANGES["30d"]);
  assert.equal(bounds.startTime, eventAt - 30 * 86_400_000);
  assert.equal(bounds.coverageEndTime, eventAt);
  assert.equal(bounds.mode, "THIRTY_DAYS_BEFORE_EVENT");
});

test("candle coverage reports complete only when both ends are present", () => {
  const intervalMs = 60_000;
  const startTime = 1_020_000;
  const coverageEndTime = startTime + 10 * intervalMs;
  const completeRows = Array.from({ length: 11 }, (_, index) => ({ time: startTime + index * intervalMs }));
  const complete = buildCandleCoverage(completeRows, { startTime, endTime: coverageEndTime, coverageEndTime, intervalMs, pages: 1 });
  const partial = buildCandleCoverage(completeRows.slice(3), { startTime, endTime: coverageEndTime, coverageEndTime, intervalMs, pages: 1 });
  assert.equal(complete.complete, true);
  assert.equal(complete.ratio, 1);
  assert.equal(partial.complete, false);
  assert.ok(partial.ratio < 1);
});

test("RAW shadow trade is stored separately from AGG", () => {
  const trade = normalizeRawTrade({ e: "trade", s: "TESTUSDT", t: 7, p: "100", q: "2", T: 50, E: 49, m: true }, 55);
  assert.equal(trade.source, "RAW_SHADOW");
  assert.equal(trade.side, "sell");
  assert.equal(trade.quote, 200);
  assert.match(SIGNAL_LAB_V4_ORDERFLOW_VERSION, /v2/);
});

test("order flow merge preserves the original prebuffer and appends post-event packets", () => {
  const checkpoint = { at: 1_000, lastUpdateId: 1, bids: [[99, 1]], asks: [[101, 1]], state: "LIVE" };
  const previous = {
    requestedFrom: 1_000,
    requestedTo: 3_000,
    initialCheckpoint: checkpoint,
    checkpoints: [checkpoint],
    events: [{ at: 2_000, U: 2, u: 2, bids: [], asks: [], state: "LIVE" }],
    trades: [{ id: "a", tradeTime: 2_100 }],
    rawTrades: [{ id: "r1", tradeTime: 2_200 }],
    qualityEvents: [],
    coverage: {},
  };
  const incoming = {
    requestedFrom: 2_000,
    requestedTo: 6_000,
    initialCheckpoint: { ...checkpoint, at: 2_000, lastUpdateId: 2 },
    checkpoints: [],
    events: [{ at: 5_000, U: 3, u: 3, bids: [], asks: [], state: "LIVE" }],
    trades: [{ id: "b", tradeTime: 5_100 }],
    rawTrades: [{ id: "r2", tradeTime: 5_200 }],
    qualityEvents: [],
    coverage: {},
  };
  const merged = mergeOrderFlowReplay(previous, incoming, .01);
  assert.equal(merged.initialCheckpoint.at, 1_000);
  assert.equal(merged.events.length, 2);
  assert.equal(merged.trades.length, 2);
  assert.equal(merged.rawTrades.length, 2);
  assert.equal(merged.requestedTo, 6_000);
  assert.equal(merged.tickSize, .01);
});

test("owner page mounts one shared main-site orderbook lazily", () => {
  const page = fs.readFileSync(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
  const replay = fs.readFileSync(new URL("../signal-lab-v4-orderflow-replay.js", import.meta.url), "utf8");
  const replayUi = fs.readFileSync(new URL("../signal-lab-v3-replay-ui.js", import.meta.url), "utf8");
  assert.match(page, /styles\.css\?v=signal-lab-v5-shared-orderbook/);
  assert.match(page, /data-field="orderbook-workspace"/);
  assert.match(page, /Весь диапазон 30д/);
  assert.match(replay, /class="orderbook-card signal-lab-replay-card"/);
  assert.match(replay, /buildDepthLadder/);
  assert.match(replay, /bookScaleIndexForWheel/);
  assert.match(replay, /RAW/);
  assert.match(replayUi, /ensureOrderFlowPanel/);
  assert.match(replayUi, /после нажатия «Replay стакана»/);
});
