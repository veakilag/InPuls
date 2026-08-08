import test from "node:test";
import assert from "node:assert/strict";

import { filterLocalSameSideShadow } from "../signal-lab-v7-multi-timeframe-levels.js";

const minute = 60_000;
const level = (id, side, price, minuteIndex, extra = {}) => ({
  id,
  side,
  price,
  extremeAt: minuteIndex * minute,
  nativeExtremeAt: minuteIndex * minute,
  sourceTimeframe: "1m",
  sources: ["1m"],
  active: true,
  attackCount: 1,
  ...extra,
});

test("V4.22 hides a weaker same-side 1m shadow within two bars", () => {
  const result = filterLocalSameSideShadow([
    level("high-0258", "HIGH", 0.0258, 3),
    level("low-01813", "LOW", 0.01813, 8),
    level("low-023", "LOW", 0.023, 10),
  ], "1m");
  assert.deepEqual(result.map((row) => row.id), ["high-0258", "low-01813"]);
});

test("V4.22 keeps a later pivot when a visible opposite pivot separates swings", () => {
  const result = filterLocalSameSideShadow([
    level("low-a", "LOW", 0.018, 8),
    level("high-between", "HIGH", 0.025, 9),
    level("low-b", "LOW", 0.023, 10),
  ], "1m");
  assert.deepEqual(result.map((row) => row.id), ["low-a", "high-between", "low-b"]);
});

test("V4.22 never hides x2 or confluence levels as shadows", () => {
  const result = filterLocalSameSideShadow([
    level("low-a", "LOW", 0.018, 8),
    level("low-x2", "LOW", 0.023, 10, { attackCount: 2 }),
    level("low-confluence", "LOW", 0.024, 10, { sources: ["1m", "5m"] }),
  ], "1m");
  assert.deepEqual(result.map((row) => row.id), ["low-a", "low-x2", "low-confluence"]);
});


test("V4.23 uses the view-time refinement of a senior-owned confluence as the prior native pivot", () => {
  const levels = [
    {
      ...level("senior-low", "LOW", 0.01813, 0),
      sourceTimeframe: "15m",
      sources: ["15m", "1m"],
      refinementPath: [
        { timeframe: "15m", time: 0 },
        { timeframe: "1m", time: 8 * minute },
      ],
      refinedThroughTimeframe: "1m",
      displayAt: 8 * minute,
    },
    level("shadow-low", "LOW", 0.023, 10),
  ];
  const result = filterLocalSameSideShadow(levels, "1m");
  assert.deepEqual(result.map((row) => row.id), ["senior-low"]);
});
