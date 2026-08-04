import assert from "node:assert/strict";
import test from "node:test";
import { runBacktest } from "./algo-backtest.js";
import { buildResearchCandidates } from "./algo-research-strategies.js";

function syntheticCandles(count = 900) {
  const candles = [];
  let close = 100;
  for (let index = 0; index < count; index += 1) {
    const drift = Math.sin(index / 19) * 0.18 + Math.sin(index / 73) * 0.09 + 0.01;
    const open = close;
    close = Math.max(1, open + drift);
    const spread = 0.18 + Math.abs(Math.sin(index / 11)) * 0.12;
    candles.push({
      time: 1_700_000_000_000 + index * 60_000,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      volume: 1_000 + (index % 17) * 25,
    });
  }
  return candles;
}

test("research grid has stable unique candidate identities", () => {
  const candidates = buildResearchCandidates();
  assert.equal(candidates.length, 256);
  assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, candidates.length);
  assert.deepEqual(new Set(candidates.map((candidate) => candidate.family)), new Set([
    "pullback-reclaim",
    "sweep-reversal",
    "compression-breakout",
    "impulse-pullback",
    "cascade",
  ]));
});

test("every research candidate runs without future data or invalid orders", () => {
  const candles = syntheticCandles();
  for (const candidate of buildResearchCandidates()) {
    const result = runBacktest(candles, candidate.factory(), {
      initialEquity: 1_000,
      riskPerTrade: 0.0025,
      feeRate: 0.0005,
      slippageRate: 0.0002,
      maxLeverage: 3,
    });
    assert.equal(result.strategyId, candidate.factory().id);
    assert.ok(result.trades.every((trade) => trade.entryTime > trade.signalTime));
    assert.ok(result.trades.every((trade) => Number.isFinite(trade.rMultiple)));
  }
});
