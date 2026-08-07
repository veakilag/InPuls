from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:180]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


runtime = "signal-lab-v7-multi-timeframe-review-runtime.js"
levels = "signal-lab-v7-multi-timeframe-levels.js"

replace_once(
    runtime,
    '''const INTERVAL_MS = Object.freeze({\n  "1m": 60_000,\n  "5m": 300_000,\n  "15m": 900_000,\n  "1h": 3_600_000,\n  "4h": 14_400_000,\n  "1d": 86_400_000,\n});''',
    '''const INTERVAL_MS = Object.freeze({\n  "1m": 60_000,\n  "5m": 300_000,\n  "15m": 900_000,\n  "1h": 3_600_000,\n  "4h": 14_400_000,\n  "1d": 86_400_000,\n});\n\n// V4.4 review-only generation policy. The event detector must be recall-first:\n// it records price geometry, while hierarchical admission owns cross-asset\n// significance/noise filtering. This prevents the same ATR/NATR idea from\n// deleting a swing twice before it can even reach the visible map.\nexport const STRUCTURAL_REVIEW_GENERATION_CONFIG = Object.freeze({\n  "1m": Object.freeze({\n    minimumSwingPercent: 0.08,\n    minimumPercent: 0.06,\n    atrMultiplier: 0,\n    minimumBarsAfterCandidate: 1,\n  }),\n  "5m": Object.freeze({\n    minimumSwingPercent: 0.10,\n    minimumPercent: 0.08,\n    atrMultiplier: 0,\n    minimumBarsAfterCandidate: 1,\n  }),\n});''',
)

replace_once(
    runtime,
    '''    const engine = new EngineClass({ symbol, timeframe: sourceTimeframe, tickSize });''',
    '''    const engine = new EngineClass({\n      symbol,\n      timeframe: sourceTimeframe,\n      tickSize,\n      config: STRUCTURAL_REVIEW_GENERATION_CONFIG[sourceTimeframe] ?? {},\n    });''',
)

replace_once(
    levels,
    '''  "5m": Object.freeze({\n    fallbackMinimumSwingPercent: 0.18,''',
    '''  "5m": Object.freeze({\n    fallbackMinimumSwingPercent: 0.12,''',
)
replace_once(
    levels,
    '''  "5m": Object.freeze({ minimumSwingPercent: 0.18, reversalMultiplier: 1.00 }),''',
    '''  "5m": Object.freeze({ minimumSwingPercent: 0.12, reversalMultiplier: 1.00 }),''',
)

# Add focused regression proving the review detector can retain calm-market local
# geometry before adaptive admission filters volatile-market noise.
test_path = ROOT / "test/signal-lab-v7-review-generation.test.js"
test_path.write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { StructuralExtremeEngine } from "../signal-lab-v7-structural-extremes.js";
import { STRUCTURAL_REVIEW_GENERATION_CONFIG } from "../signal-lab-v7-multi-timeframe-review-runtime.js";
import {
  buildStructuralVolatilityContext,
  structuralChildAdmissionDecision,
} from "../signal-lab-v7-multi-timeframe-levels.js";

const STEP = 5 * 60_000;

function candle(index, { open, high, low, close }) {
  return {
    time: index * STEP,
    closeTime: (index + 1) * STEP - 1,
    open,
    high,
    low,
    close,
    closed: true,
  };
}

const calmGeometry = [
  candle(0, { open: 100.00, high: 100.02, low: 99.98, close: 100.00 }),
  candle(1, { open: 100.00, high: 100.22, low: 99.99, close: 100.20 }),
  candle(2, { open: 100.20, high: 100.20, low: 100.05, close: 100.07 }),
  candle(3, { open: 100.07, high: 100.08, low: 99.96, close: 99.98 }),
  candle(4, { open: 99.98, high: 100.08, low: 99.97, close: 100.07 }),
  candle(5, { open: 100.07, high: 100.17, low: 100.04, close: 100.15 }),
  candle(6, { open: 100.15, high: 100.16, low: 100.02, close: 100.04 }),
];

test("V4.4 review generation keeps calm 5m local swing geometry that legacy detector drops", () => {
  const legacy = new StructuralExtremeEngine({ symbol: "BTCUSDT", timeframe: "5m", tickSize: 0.01 });
  legacy.ingestCandles(calmGeometry);
  const review = new StructuralExtremeEngine({
    symbol: "BTCUSDT",
    timeframe: "5m",
    tickSize: 0.01,
    config: STRUCTURAL_REVIEW_GENERATION_CONFIG["5m"],
  });
  review.ingestCandles(calmGeometry);

  assert.equal(legacy.snapshot().history.length, 0);
  assert.ok(review.snapshot().history.filter((row) => row.side === "HIGH").length >= 2);
  assert.ok(review.snapshot().history.some((row) => row.side === "LOW"));
});

test("V4.4 keeps detector recall separate from adaptive HFT noise admission", () => {
  const review = new StructuralExtremeEngine({
    symbol: "BTCUSDT",
    timeframe: "5m",
    tickSize: 0.01,
    config: STRUCTURAL_REVIEW_GENERATION_CONFIG["5m"],
  });
  review.ingestCandles(calmGeometry);
  const high = review.snapshot().history.find((row) => row.side === "HIGH");
  assert.ok(high);

  const calmContext = buildStructuralVolatilityContext(Array.from({ length: 40 }, (_, index) => candle(index, {
    open: 100,
    high: 100.05,
    low: 99.95,
    close: 100,
  })));
  const hotContext = buildStructuralVolatilityContext(Array.from({ length: 40 }, (_, index) => candle(index, {
    open: 100,
    high: 102,
    low: 98,
    close: 100,
  })));

  const calmDecision = structuralChildAdmissionDecision(high, "5m", { volatilityContext: calmContext });
  const hotDecision = structuralChildAdmissionDecision(high, "5m", { volatilityContext: hotContext });
  assert.equal(calmDecision.admitted, true);
  assert.equal(hotDecision.admitted, false);
});
''', encoding="utf-8")
