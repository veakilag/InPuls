import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPaperPrice,
  createPaperPosition,
  SignalLabPaperEngine,
  summarizePaperTrades,
} from "./signal-lab-paper-trading.js";

const plan = (overrides = {}) => ({
  accepted: true,
  strategyId: "cascade_acceptance",
  strategyLabel: "Каскад с принятием",
  patternId: "cascade_breakout",
  symbol: "TESTUSDT",
  direction: "up",
  entryPrice: 100,
  stopPrice: 99,
  partialPrice: 101.2,
  targetPrice: 102.5,
  maximumHoldMs: 300_000,
  confirmations: ["trade_acceleration", "price_acceptance"],
  ...overrides,
});

const zeroCost = {
  feeBpsPerSide: 0,
  slippageBpsPerSide: 0,
  riskPerTradePercent: 1,
  partialFraction: 0.5,
};

test("paper stop realizes approximately minus one R when costs are disabled", () => {
  const opened = createPaperPosition(plan(), {
    episodeId: "stop-case",
    openedAt: 1_000,
    equity: 1_000,
    config: zeroCost,
  });
  const closed = applyPaperPrice(opened, { price: 98.9, at: 2_000 }, zeroCost);
  assert.equal(closed.status, "closed");
  assert.equal(closed.closeReason, "stop");
  assert.ok(Math.abs(closed.netR + 1) < 1e-9);
});

test("paper target executes partial and runner in one directional move", () => {
  const opened = createPaperPosition(plan(), {
    episodeId: "target-case",
    openedAt: 1_000,
    equity: 1_000,
    config: zeroCost,
  });
  const closed = applyPaperPrice(opened, { price: 102.6, at: 2_000 }, zeroCost);
  assert.equal(closed.status, "closed");
  assert.equal(closed.closeReason, "target");
  assert.equal(closed.partialFilled, true);
  assert.deepEqual(closed.fills.map((fill) => fill.kind), ["entry", "partial", "target"]);
  assert.ok(closed.netR > 1.8);
});

test("paper partial moves the structural stop to entry", () => {
  const opened = createPaperPosition(plan(), {
    episodeId: "breakeven-case",
    openedAt: 1_000,
    equity: 1_000,
    config: zeroCost,
  });
  const partial = applyPaperPrice(opened, { price: 101.3, at: 2_000 }, zeroCost);
  assert.equal(partial.status, "open");
  assert.equal(partial.partialFilled, true);
  assert.equal(partial.activeStopPrice, 100);

  const closed = applyPaperPrice(partial, { price: 99.9, at: 3_000 }, zeroCost);
  assert.equal(closed.status, "closed");
  assert.equal(closed.closeReason, "breakeven-stop");
  assert.ok(closed.netR > 0.5 && closed.netR < 0.7);
});

test("paper time stop closes at the latest observed market price", () => {
  const opened = createPaperPosition(plan({ maximumHoldMs: 10_000 }), {
    episodeId: "time-case",
    openedAt: 1_000,
    equity: 1_000,
    config: zeroCost,
  });
  const closed = applyPaperPrice(opened, { price: 100.4, at: 11_000 }, zeroCost);
  assert.equal(closed.status, "closed");
  assert.equal(closed.closeReason, "time-stop");
  assert.ok(closed.netR > 0.39 && closed.netR < 0.41);
});

test("fees and adverse slippage make a stopped trade no better than minus one R", () => {
  const config = {
    feeBpsPerSide: 5,
    slippageBpsPerSide: 2,
    riskPerTradePercent: 0.25,
  };
  const opened = createPaperPosition(plan(), {
    episodeId: "cost-case",
    openedAt: 1_000,
    equity: 1_000,
    config,
  });
  const closed = applyPaperPrice(opened, { price: 98.9, at: 2_000 }, config);
  assert.ok(Math.abs(closed.netR + 1) < 1e-9);
  assert.ok(closed.entryFillPrice > opened.entrySignalPrice);
  assert.ok(closed.fills.at(-1).fillPrice < opened.stopPrice);
});

test("engine deduplicates one Signal Lab episode", () => {
  const engine = new SignalLabPaperEngine({ config: zeroCost, startedAt: 1_000 });
  const first = engine.consider(plan(), {
    episodeId: "episode-1",
    eventId: "event-1",
    openedAt: 2_000,
  });
  const duplicate = engine.consider(plan(), {
    episodeId: "episode-1",
    eventId: "event-1",
    openedAt: 2_100,
  });
  assert.equal(first.opened, true);
  assert.equal(duplicate.opened, false);
  assert.equal(duplicate.reason, "episode-already-processed");
});

test("engine updates equity and strategy statistics after close", () => {
  const engine = new SignalLabPaperEngine({ config: zeroCost, startedAt: 1_000 });
  engine.consider(plan(), {
    episodeId: "episode-2",
    eventId: "event-2",
    openedAt: 2_000,
  });
  const result = engine.updatePrice({ symbol: "TESTUSDT", price: 102.6, at: 3_000 });
  assert.equal(result.closed.length, 1);
  const report = engine.report();
  assert.equal(report.openPositions.length, 0);
  assert.equal(report.trades.length, 1);
  assert.ok(report.equity > report.initialEquity);
  assert.equal(report.summary.overall.winRatePercent, 100);
  assert.ok(report.summary.overall.expectancyR > 1);
});

test("summary calculates PF, win rate and expectancy from closed paper trades", () => {
  const win = {
    status: "closed",
    strategyId: "x",
    strategyLabel: "X",
    netPnl: 20,
    netR: 2,
    closedAt: 2,
  };
  const loss = {
    status: "closed",
    strategyId: "x",
    strategyLabel: "X",
    netPnl: -10,
    netR: -1,
    closedAt: 3,
  };
  const summary = summarizePaperTrades([win, loss]);
  assert.equal(summary.overall.trades, 2);
  assert.equal(summary.overall.winRatePercent, 50);
  assert.equal(summary.overall.profitFactor, 2);
  assert.equal(summary.overall.expectancyR, 0.5);
});
