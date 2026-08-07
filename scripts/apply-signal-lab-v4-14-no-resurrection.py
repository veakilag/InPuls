from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "signal-lab-v7-multi-timeframe-levels.js"
text = TARGET.read_text(encoding="utf-8")

old = '''  const sources = Array.isArray(level?.sources) ? level.sources : [sourceTimeframe].filter(Boolean);\n  if (sources.length > 1 || Number(level?.confluenceCount) > 1) return true;\n  if ((Number(level?.attackCount) || 1) > 1) return true;\n\n  // V4.13: post-cluster local-only pivot guard. LOW keeps the V4.11\n'''
new = '''  const sources = Array.isArray(level?.sources) ? level.sources : [sourceTimeframe].filter(Boolean);\n\n  // V4.14: child confluence must never resurrect a local primary that already\n  // fails its own source-TF working-pivot gate. After clustering the strongest\n  // member is primary, so a genuine senior confluence (15m/1h/4h/1d) already\n  // has a non-local sourceTimeframe and bypasses this function via the policy\n  // check above. A 5m+1m cluster, however, remains a 5m primary and must still\n  // pass the calibrated 5m gate. Repeated attacks remain an independent reason\n  // to keep the level visible.\n  if ((Number(level?.attackCount) || 1) > 1) return true;\n\n  // V4.13: post-cluster local-only pivot guard. LOW keeps the V4.11\n'''

if text.count(old) != 1:
    raise RuntimeError(f"expected one visibility bypass block, found {text.count(old)}")
TARGET.write_text(text.replace(old, new, 1), encoding="utf-8")

TEST = ROOT / "test/signal-lab-v7-no-resurrection.test.js"
TEST.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { structuralLocalWorkingSetVisible } from "../signal-lab-v7-multi-timeframe-levels.js";

const STEP = 5 * 60_000;
const candles = [
  { time: 0 * STEP, high: 99.82, low: 99.75, close: 99.80 },
  { time: 1 * STEP, high: 99.86, low: 99.79, close: 99.84 },
  { time: 2 * STEP, high: 99.89, low: 99.82, close: 99.87 },
  { time: 3 * STEP, high: 99.92, low: 99.85, close: 99.90 },
  { time: 4 * STEP, high: 99.95, low: 99.88, close: 99.93 },
  { time: 5 * STEP, high: 99.98, low: 99.91, close: 99.96 },
  { time: 6 * STEP, high: 100.00, low: 99.94, close: 99.97 },
];

const volatilityContext = {
  currentPrice: 99.97,
  currentNatrPct: 0.10,
  baseNatrPct: 0.10,
};

test("V4.14 1m confluence cannot resurrect a weak 5m HIGH", () => {
  const weakFiveMinutePrimary = {
    side: "HIGH",
    price: 100.00,
    sourceTimeframe: "5m",
    nativeExtremeAt: 6 * STEP,
    extremeAt: 6 * STEP,
    active: true,
    attackCount: 1,
    sources: ["5m", "1m"],
    confluenceCount: 2,
  };

  assert.equal(
    structuralLocalWorkingSetVisible(weakFiveMinutePrimary, volatilityContext, candles),
    false,
  );
});

test("V4.14 real senior primary still bypasses local working-pivot policy", () => {
  const seniorPrimary = {
    side: "HIGH",
    price: 100.00,
    sourceTimeframe: "15m",
    nativeExtremeAt: 6 * STEP,
    extremeAt: 6 * STEP,
    active: true,
    attackCount: 1,
    sources: ["15m", "5m", "1m"],
    confluenceCount: 3,
  };

  assert.equal(
    structuralLocalWorkingSetVisible(seniorPrimary, volatilityContext, candles),
    true,
  );
});
''', encoding="utf-8")
