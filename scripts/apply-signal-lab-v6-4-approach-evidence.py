from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


root = Path('.')
context_path = root / 'signal-lab-v8-level-context.js'
runtime_path = root / 'signal-lab-v7-multi-timeframe-review-runtime.js'
test_path = root / 'test/signal-lab-v8-level-context.test.js'

context = context_path.read_text()
anchor = 'export const APPROACH_CONTEXT_RESEARCH_VERSION = "v6.3.1-causal-path-shadow-2026-08";'
insert = r'''
function evidenceReadiness(sampleBars, requestedLookbackBars) {
  const sample = Math.max(0, Math.round(finite(sampleBars) ?? 0));
  const requested = Math.max(2, Math.round(finite(requestedLookbackBars) ?? 12));
  if (sample < 2) return "INSUFFICIENT";
  if (sample < 3) return "EARLY_2B";
  if (sample < 6) return "EARLY_3B";
  if (sample < requested) return "OBSERVABLE_6B";
  return "FULL_WINDOW";
}

function signedEvidenceFlag(value, positive, negative, flat) {
  const number = finite(value);
  if (number === null) return null;
  if (number > 0) return positive;
  if (number < 0) return negative;
  return flat;
}

// V6.4 deliberately keeps approach evidence as a vector of observable facts.
// It does not combine them into a score, breakout probability, or trade signal.
// Magnitudes remain available beside labels so later calibration can decide
// whether tiny positive/negative changes are meaningful across a large sample.
export function buildApproachEvidenceResearchContext(approachContext) {
  if (!approachContext || approachContext.state === "UNKNOWN") {
    return Object.freeze({ state: "UNKNOWN", targets: Object.freeze([]), researchOnly: true });
  }

  const targets = (Array.isArray(approachContext.targets) ? approachContext.targets : [])
    .map((row) => {
      if (!row || !["HIGH", "LOW"].includes(row?.side)) return null;
      const facts = [];
      const push = (value) => { if (value) facts.push(value); };
      push(signedEvidenceFlag(row.towardDelta3Natr, "TOWARD_3B", "AWAY_3B", "TOWARD_3B_FLAT"));
      push(signedEvidenceFlag(row.towardDelta6Natr, "TOWARD_6B", "AWAY_6B", "TOWARD_6B_FLAT"));
      push(signedEvidenceFlag(row.towardDelta12Natr, "TOWARD_12B", "AWAY_12B", "TOWARD_12B_FLAT"));
      push(signedEvidenceFlag(
        row.medianGapCompressionNatr,
        "MEDIAN_GAP_SHRINKING",
        "MEDIAN_GAP_WIDENING",
        "MEDIAN_GAP_FLAT",
      ));
      const progressionPositive = row.progressionLabel === "HIGHER_FLOOR" ? "FLOOR_RISING" : "CEILING_FALLING";
      const progressionNegative = row.progressionLabel === "HIGHER_FLOOR" ? "FLOOR_FALLING" : "CEILING_RISING";
      push(signedEvidenceFlag(row.progressionNatr, progressionPositive, progressionNegative, "OPPOSITE_BOUNDARY_FLAT"));

      const rangeRatio = finite(row.rangeContractionRatio3v3);
      if (rangeRatio !== null) {
        facts.push(rangeRatio < 1 ? "RANGE_CONTRACTING" : rangeRatio > 1 ? "RANGE_EXPANDING" : "RANGE_FLAT");
      }
      const nearBars = finite(row.nearBarsWindow);
      if (nearBars !== null) facts.push(nearBars > 0 ? "NEAR_ZONE_SEEN" : "NO_NEAR_ZONE");
      const groups = finite(row.proximityGroups);
      if (groups !== null) {
        facts.push(groups >= 2 ? "MULTI_PROXIMITY_GROUPS" : groups === 1 ? "ONE_PROXIMITY_GROUP" : "NO_PROXIMITY_GROUP");
      }
      const closeBeyond = finite(row.closeBeyondBars);
      if (closeBeyond !== null && closeBeyond > 0) facts.push("CLOSE_BEYOND_OBSERVED_NOT_PIERCED");
      const extremeBeyond = finite(row.extremeBeyondBars);
      if (extremeBeyond !== null && extremeBeyond > 0) facts.push("EXTREME_BEYOND_OBSERVED_NOT_PIERCED");

      return Object.freeze({
        side: row.side,
        targetPrice: finite(row.targetPrice),
        roles: Object.freeze(Array.isArray(row.roles) ? [...row.roles] : []),
        candidateState: row.candidateState ?? "VISIBLE_MAP",
        readiness: evidenceReadiness(row.sampleBars, row.requestedLookbackBars),
        sampleBars: Math.max(0, Math.round(finite(row.sampleBars) ?? 0)),
        requestedLookbackBars: Math.max(2, Math.round(finite(row.requestedLookbackBars) ?? 12)),
        currentDistanceNatr: finite(row.currentDistanceNatr),
        towardDelta3Natr: finite(row.towardDelta3Natr),
        towardDelta6Natr: finite(row.towardDelta6Natr),
        towardDelta12Natr: finite(row.towardDelta12Natr),
        medianGapCompressionNatr: finite(row.medianGapCompressionNatr),
        progressionNatr: finite(row.progressionNatr),
        progressionLabel: row.progressionLabel ?? null,
        nearBarsWindow: nearBars,
        proximityGroups: groups,
        rangeContractionRatio3v3: rangeRatio,
        closeBeyondBars: closeBeyond,
        extremeBeyondBars: extremeBeyond,
        facts: Object.freeze(facts),
        researchOnly: true,
      });
    })
    .filter(Boolean);

  return Object.freeze({
    state: targets.length ? "EVIDENCE_AVAILABLE" : "NO_LOCAL_TARGETS",
    timeframe: approachContext.timeframe ?? "5m",
    targets: Object.freeze(targets),
    researchOnly: true,
  });
}

export const APPROACH_EVIDENCE_RESEARCH_VERSION = "v6.4-approach-evidence-shadow-2026-08";

'''
context = replace_once(context, anchor, insert + anchor, 'insert V6.4 evidence')
context_path.write_text(context)

runtime = runtime_path.read_text()
old_import = 'import { APPROACH_CONTEXT_RESEARCH_VERSION, LEVEL_CONTEXT_RESEARCH_VERSION, LOCAL_STRUCTURE_RESEARCH_VERSION, buildApproachCompressionResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";'
new_import = 'import { APPROACH_CONTEXT_RESEARCH_VERSION, APPROACH_EVIDENCE_RESEARCH_VERSION, LEVEL_CONTEXT_RESEARCH_VERSION, LOCAL_STRUCTURE_RESEARCH_VERSION, buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "./signal-lab-v8-level-context.js";'
runtime = replace_once(runtime, old_import, new_import, 'runtime import')

formatter_anchor = 'function formatLevelResearchContextRow(row) {'
formatter = r'''
function formatApproachEvidenceResearchContext(row) {
  if (!row || row.state === "UNKNOWN") return ["APPROACH EVIDENCE | unavailable"];
  const rows = Array.isArray(row.targets) ? row.targets : [];
  return [
    `APPROACH EVIDENCE ${APPROACH_EVIDENCE_RESEARCH_VERSION} · RESEARCH ONLY · facts, no combined score`,
    ...(rows.length ? rows.map((target) => {
      const roles = Array.isArray(target.roles) ? target.roles.join("+") : "?";
      const map = target.candidateState === "VISIBLE_MAP" ? "VISIBLE" : "shadow";
      const facts = Array.isArray(target.facts) && target.facts.length ? target.facts.join(",") : "none";
      return [
        `EVIDENCE ${target.side} ${roles}`,
        `target=${debugNumber(target.targetPrice, target.targetPrice >= 1000 ? 1 : 6)}`,
        `map=${map}`,
        `ready=${target.readiness}`,
        `sample=${target.sampleBars}/${target.requestedLookbackBars}b`,
        `dist=${debugNumber(target.currentDistanceNatr, 2)}N`,
        `toward3/6/12=${debugNumber(target.towardDelta3Natr, 2)}/${debugNumber(target.towardDelta6Natr, 2)}/${debugNumber(target.towardDelta12Natr, 2)}N`,
        `${target.progressionLabel === "HIGHER_FLOOR" ? "floorRise" : "ceilingDrop"}=${debugNumber(target.progressionNatr, 2)}N`,
        `medianCompress=${debugNumber(target.medianGapCompressionNatr, 2)}N`,
        `range3v3=${debugNumber(target.rangeContractionRatio3v3, 2)}x`,
        `near=${target.nearBarsWindow ?? "—"}b/groups=${target.proximityGroups ?? "—"}`,
        `facts=${facts}`,
      ].join(" | ");
    }) : ["APPROACH EVIDENCE TARGETS | none"]),
  ];
}

'''
runtime = replace_once(runtime, formatter_anchor, formatter + formatter_anchor, 'runtime formatter')

old_context = '''  window.__INPULS_APPROACH_CONTEXT__ = approachContext;\n  const approachLines = formatApproachResearchContext(approachContext);\n  const candleTraceRows = [...buildCandleTraceRows(state)];'''
new_context = '''  window.__INPULS_APPROACH_CONTEXT__ = approachContext;\n  const approachLines = formatApproachResearchContext(approachContext);\n  const approachEvidenceContext = buildApproachEvidenceResearchContext(approachContext);\n  window.__INPULS_APPROACH_EVIDENCE__ = approachEvidenceContext;\n  const approachEvidenceLines = formatApproachEvidenceResearchContext(approachEvidenceContext);\n  const candleTraceRows = [...buildCandleTraceRows(state)];'''
runtime = replace_once(runtime, old_context, new_context, 'runtime evidence context')
runtime = replace_once(runtime, '    ...approachLines,\n    `LEVEL CONTEXT', '    ...approachLines,\n    ...approachEvidenceLines,\n    `LEVEL CONTEXT', 'runtime debug lines')
runtime_path.write_text(runtime)

tests = test_path.read_text()
old_test_import = 'import { buildApproachCompressionResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";'
new_test_import = 'import { buildApproachCompressionResearchContext, buildApproachEvidenceResearchContext, buildLevelResearchContexts, buildLocalStructureResearchContext, mergeLevelResearchCandidatePool } from "../signal-lab-v8-level-context.js";'
tests = replace_once(tests, old_test_import, new_test_import, 'test import')
if 'test("V6.4 evidence vector reports observable facts without a combined score"' in tests:
    raise SystemExit('V6.4 tests already present')
tests += r'''


test("V6.4 evidence vector reports observable facts without a combined score", () => {
  const context = buildApproachEvidenceResearchContext({
    state: "PATH_CONTEXT_AVAILABLE",
    timeframe: "5m",
    targets: [{
      side: "HIGH",
      targetPrice: 105,
      roles: ["QUALITY"],
      candidateState: "VISIBLE_MAP",
      sampleBars: 6,
      requestedLookbackBars: 12,
      currentDistanceNatr: 1.08,
      towardDelta3Natr: 0.26,
      towardDelta6Natr: 0.15,
      towardDelta12Natr: null,
      medianGapCompressionNatr: 0.05,
      progressionNatr: 0.10,
      progressionLabel: "HIGHER_FLOOR",
      nearBarsWindow: 0,
      proximityGroups: 0,
      closeBeyondBars: 0,
      extremeBeyondBars: 0,
      rangeContractionRatio3v3: 0.90,
    }],
  });
  assert.equal(context.state, "EVIDENCE_AVAILABLE");
  const row = context.targets[0];
  assert.equal(row.readiness, "OBSERVABLE_6B");
  assert.ok(row.facts.includes("TOWARD_3B"));
  assert.ok(row.facts.includes("TOWARD_6B"));
  assert.ok(row.facts.includes("MEDIAN_GAP_SHRINKING"));
  assert.ok(row.facts.includes("FLOOR_RISING"));
  assert.ok(row.facts.includes("RANGE_CONTRACTING"));
  assert.ok(row.facts.includes("NO_NEAR_ZONE"));
  assert.equal(Object.prototype.hasOwnProperty.call(row, "score"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(row, "breakoutProbability"), false);
  assert.equal(row.researchOnly, true);
});

test("V6.4 keeps early samples explicitly early and does not invent unavailable facts", () => {
  const context = buildApproachEvidenceResearchContext({
    state: "PATH_CONTEXT_AVAILABLE",
    timeframe: "5m",
    targets: [{
      side: "LOW",
      targetPrice: 95,
      roles: ["NEAREST"],
      candidateState: "SOURCE_QUALIFIED_HIDDEN",
      sampleBars: 1,
      requestedLookbackBars: 12,
      currentDistanceNatr: 0.8,
      towardDelta3Natr: null,
      towardDelta6Natr: null,
      towardDelta12Natr: null,
      medianGapCompressionNatr: null,
      progressionNatr: null,
      progressionLabel: "LOWER_CEILING",
      nearBarsWindow: null,
      proximityGroups: null,
      closeBeyondBars: null,
      extremeBeyondBars: null,
      rangeContractionRatio3v3: null,
    }],
  });
  const row = context.targets[0];
  assert.equal(row.readiness, "INSUFFICIENT");
  assert.deepEqual(row.facts, []);
  assert.equal(row.researchOnly, true);
});
'''
test_path.write_text(tests)

print('Applied V6.4 approach evidence shadow layer')
