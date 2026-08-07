from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ROOT / "signal-lab-v7-multi-timeframe-levels.js"
TEST = ROOT / "test/signal-lab-v7-pivot-retracement.test.js"

text = LEVELS.read_text(encoding="utf-8")
old = '''  "5m": Object.freeze({
    lookbackBars: 6,
    structureLookbackBars: 24,
    minimumIncomingBaseNatr: 0.75,
    minimumOutgoingBaseNatr: 0.60,
    minimumPriorImpulseBaseNatr: 1.25,
    minimumRetracementRatio: 0.20,
  }),'''
new = '''  "5m": Object.freeze({
    lookbackBars: 6,
    structureLookbackBars: 24,
    minimumIncomingBaseNatr: 0.75,
    minimumOutgoingBaseNatr: 0.60,
    minimumPriorImpulseBaseNatr: 1.25,
    // V4.11 visual calibration on BTC 5m: two trader-rejected pauses
    // measured 23.7% and 25.5% retracement, while reviewed structural LOWs
    // were either not applicable to this gate or measured 127% / 674%.
    // Keep the rule causal and apply it only when a valid prior impulse exists.
    minimumRetracementRatio: 0.30,
  }),'''
if text.count(old) != 1:
    raise RuntimeError(f"Expected one 5m prominence policy, found {text.count(old)}")
LEVELS.write_text(text.replace(old, new, 1), encoding="utf-8")

test_text = TEST.read_text(encoding="utf-8")
test_text = test_text.replace(
    'assert.ok(decision.retracementRatio < 0.20);',
    'assert.ok(decision.retracementRatio < 0.30);\n  assert.equal(decision.minimumRetracementRatio, 0.30);',
    1,
)
test_text = test_text.replace(
    'assert.ok(decision.retracementRatio >= 0.20);',
    'assert.ok(decision.retracementRatio >= 0.30);\n  assert.equal(decision.minimumRetracementRatio, 0.30);',
    1,
)
TEST.write_text(test_text, encoding="utf-8")
