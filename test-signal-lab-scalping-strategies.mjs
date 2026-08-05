import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateSignalLabScalp,
  SIGNAL_LAB_SCALPING_STRATEGIES,
} from "./signal-lab-scalping-strategies.js";

const NOW = 1_800_000_000_000;

const liveContext = (overrides = {}) => ({
  inplay: true,
  pathQuality: "live",
  spreadBps: 3,
  latencyMs: 120,
  confirmations: [],
  ...overrides,
});

test("catalog exposes only Signal Lab scalping families", () => {
  assert.deepEqual(Object.keys(SIGNAL_LAB_SCALPING_STRATEGIES), [
    "cascade_acceptance",
    "level_breakout_retest",
    "false_breakout_reclaim",
    "impulse_reversal",
    "compression_expansion",
    "liquidity_hold_reaction",
  ]);
});

test("accepts a fresh confirmed cascade with live execution context", () => {
  const result = evaluateSignalLabScalp({
    symbol: "solusdt",
    patternId: "cascade_breakout",
    state: "confirmed",
    direction: "up",
    confirmedAt: NOW - 10_000,
    lastPrice: 100,
    invalidationPrice: 99.5,
  }, liveContext({
    confirmations: ["trade_acceleration", "price_acceptance"],
  }), { now: NOW });

  assert.equal(result.accepted, true);
  assert.equal(result.strategyId, "cascade_acceptance");
  assert.equal(result.symbol, "SOLUSDT");
  assert.equal(result.stopPrice, 99.5);
  assert.equal(result.partialPrice, 100.6);
  assert.equal(result.targetPrice, 101.25);
  assert.equal(result.maximumHoldMs, 300_000);
});

test("rejects stale, non-INPLAY and partial-path signals", () => {
  const result = evaluateSignalLabScalp({
    symbol: "ETHUSDT",
    patternId: "level_breakout",
    state: "confirmed",
    direction: "up",
    confirmedAt: NOW - 180_000,
    lastPrice: 200,
    invalidationPrice: 199,
  }, liveContext({
    inplay: false,
    pathQuality: "partial",
    confirmations: ["trade_acceleration", "price_acceptance"],
  }), { now: NOW });

  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes("signal-stale"));
  assert.ok(result.reasons.includes("not-inplay"));
  assert.ok(result.reasons.includes("market-path-not-live"));
});

test("requires pattern-specific confirmations", () => {
  const result = evaluateSignalLabScalp({
    symbol: "XRPUSDT",
    patternId: "false_breakout",
    state: "confirmed",
    direction: "down",
    confirmedAt: NOW - 5_000,
    lastPrice: 1,
    invalidationPrice: 1.005,
  }, liveContext({ confirmations: ["price_rejection"] }), { now: NOW });

  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes("missing:trade_acceleration"));
});

test("knife and sharpening allow triggered state but require one flow confirmation", () => {
  const rejected = evaluateSignalLabScalp({
    symbol: "DOGEUSDT",
    patternId: "knife_reclaim",
    state: "triggered",
    direction: "up",
    triggeredAt: NOW - 4_000,
    lastPrice: 0.1,
    invalidationPrice: 0.0995,
  }, liveContext({ confirmations: ["price_rejection"] }), { now: NOW });

  assert.equal(rejected.accepted, false);
  assert.ok(rejected.reasons.some((reason) => reason.startsWith("missing-any:")));

  const accepted = evaluateSignalLabScalp({
    symbol: "DOGEUSDT",
    patternId: "knife_reclaim",
    state: "triggered",
    direction: "up",
    triggeredAt: NOW - 4_000,
    lastPrice: 0.1,
    invalidationPrice: 0.0995,
  }, liveContext({
    confirmations: ["price_rejection", "aggressor_dominance"],
  }), { now: NOW });

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.strategyId, "impulse_reversal");
});

test("liquidity rearrangement and liquidation cascade are not direct entries in v1", () => {
  for (const patternId of ["liquidity_rearrangement", "liquidation_cascade"]) {
    const result = evaluateSignalLabScalp({
      symbol: "BTCUSDT",
      patternId,
      state: "confirmed",
      direction: "up",
      confirmedAt: NOW,
      lastPrice: 100,
      invalidationPrice: 99.5,
    }, liveContext(), { now: NOW });

    assert.equal(result.accepted, false);
    assert.ok(result.reasons.includes("pattern-not-scalping-enabled"));
  }
});

test("rejects stops wider than 1.5 percent for a scalp", () => {
  const result = evaluateSignalLabScalp({
    symbol: "SOLUSDT",
    patternId: "compression_breakout",
    state: "confirmed",
    direction: "up",
    confirmedAt: NOW,
    lastPrice: 100,
    invalidationPrice: 98,
  }, liveContext({
    confirmations: ["volume_expansion", "trade_acceleration"],
  }), { now: NOW });

  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasons, ["stop-too-wide-for-scalp"]);
});
