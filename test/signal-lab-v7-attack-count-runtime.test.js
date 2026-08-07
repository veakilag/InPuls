import test from "node:test";
import assert from "node:assert/strict";
import { StructuralExtremeEngine } from "../signal-lab-v7-structural-extremes.js";
import {
  installStructuralAttackCountRuntime,
  structuralAttackCountFromRetests,
} from "../signal-lab-v7-attack-count-runtime.js";

const BASE = Date.UTC(2026, 7, 1, 0, 0, 0);
const STEP = 60_000;

function candle(index, open, high, low, close) {
  return {
    time: BASE + index * STEP,
    closeTime: BASE + (index + 1) * STEP - 1,
    open,
    high,
    low,
    close,
    volume: 1_000,
    closed: true,
  };
}

test("formation itself is attack one", () => {
  assert.equal(structuralAttackCountFromRetests(0), 1);
  assert.equal(structuralAttackCountFromRetests(1), 2);
  assert.equal(structuralAttackCountFromRetests(2), 3);
});

test("public review snapshot shows retest one as attack two", () => {
  installStructuralAttackCountRuntime(StructuralExtremeEngine);
  const engine = new StructuralExtremeEngine({
    symbol: "TESTUSDT",
    timeframe: "1m",
    tickSize: 0.1,
    config: {
      minimumPercent: 1,
      maximumPercent: 1,
      atrMultiplier: 0,
      minimumSwingPercent: 1,
      minimumBarsAfterCandidate: 1,
      rearmDistanceFactor: 0.5,
    },
  });
  const rows = [
    candle(0, 100, 100, 100, 100),
    candle(1, 100, 104, 100, 103.5),
    candle(2, 103.5, 105, 103, 104.5),
    candle(3, 104.5, 104.8, 101.5, 102),
    candle(4, 102, 103, 101, 102),
    candle(5, 102, 104.9, 101.8, 104.7),
  ];
  const snapshot = engine.ingestCandles(rows);
  const high = snapshot.history.find((row) => row.side === "HIGH");
  assert.ok(high);
  assert.equal(high.retestCount, 1);
  assert.equal(high.attackCount, 2);
  assert.equal(high.touchCount, 2);
  assert.equal(snapshot.attackCountSemantics, "FORMATION_IS_ATTACK_1");
});