import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_WORKING_SET_POLICY,
  structuralLocalWorkingSetVisible,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const ctx = {
  currentPrice: 100,
  baseNatrPct: 0.20,
};

function level(overrides = {}) {
  return {
    sourceTimeframe: "5m",
    side: "LOW",
    price: 99.8,
    active: true,
    attackCount: 1,
    confluenceCount: 1,
    sources: ["5m"],
    swingAmplitudePct: 1.5,
    ...overrides,
  };
}

test("V4.6 hides distant local-only single-touch 5m levels even when swing was large", () => {
  assert.equal(LOCAL_WORKING_SET_POLICY["5m"].maxDistanceBaseNatr, 6);
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 98.0 }), ctx), false);
});

test("V4.6 keeps nearby, confluence, and repeated-attack local levels", () => {
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 99.2 }), ctx), true);
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 97.0, attackCount: 2 }), ctx), true);
  assert.equal(structuralLocalWorkingSetVisible(level({ price: 97.0, confluenceCount: 2, sources: ["1h", "5m"] }), ctx), true);
});
