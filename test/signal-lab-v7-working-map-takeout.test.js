import test from "node:test";
import assert from "node:assert/strict";
import {
  structuralChildConfirmedTakeout,
  structuralLocalWorkingSetVisible,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const seniorHigh = {
  id: "senior-high",
  side: "HIGH",
  price: 100,
  extremeAt: 1_000,
  nativeExtremeAt: 1_000,
  sourceTimeframe: "1h",
  active: true,
};

test("V4.5 confirmed child extreme beyond senior HIGH retires the old frontier", () => {
  const snapshot = {
    history: [
      { id: "child-high", side: "HIGH", price: 101, extremeAt: 2_000, confirmedAt: 2_500 },
    ],
  };
  const takeout = structuralChildConfirmedTakeout(seniorHigh, snapshot, "15m", {
    tickSize: 0.01,
    toleranceTicks: 1,
  });
  assert.equal(takeout?.reason, "CHILD_STRUCTURAL_TAKEOUT");
  assert.equal(takeout?.at, 2_500);
  assert.equal(takeout?.childTimeframe, "15m");
});

test("V4.5 wick-like child point without confirmed structural extreme is not enough", () => {
  const takeout = structuralChildConfirmedTakeout(seniorHigh, { history: [] }, "15m", {
    tickSize: 0.01,
  });
  assert.equal(takeout, null);
});

test("V4.5 far single-touch local level is hidden from working map but confluence/attacks survive", () => {
  const context = { currentPrice: 100, baseNatrPct: 1 };
  const farLocal = {
    side: "LOW",
    price: 88,
    sourceTimeframe: "5m",
    active: true,
    attackCount: 1,
    confluenceCount: 1,
    sources: ["5m"],
    swingAmplitudePct: 2,
  };
  assert.equal(structuralLocalWorkingSetVisible(farLocal, context), false);
  assert.equal(structuralLocalWorkingSetVisible({ ...farLocal, attackCount: 2 }, context), true);
  assert.equal(structuralLocalWorkingSetVisible({ ...farLocal, sources: ["1h", "5m"], confluenceCount: 2 }, context), true);
  assert.equal(structuralLocalWorkingSetVisible({ ...farLocal, swingAmplitudePct: 5 }, context), true);
});
