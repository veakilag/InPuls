import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const runtime = fs.readFileSync(new URL("../signal-lab-v7-multi-timeframe-review-runtime.js", import.meta.url), "utf8");

test("V6.6 exposes a compact cross-asset research snapshot copy control", () => {
  assert.match(runtime, /copy-structural-research/);
  assert.match(runtime, /Копировать research/);
  assert.match(runtime, /__INPULS_RESEARCH_SNAPSHOT_TEXT__/);
  assert.match(runtime, /RESEARCH SNAPSHOT v6\.6-compact-cross-asset-2026-08/);
  assert.match(runtime, /LOCAL LEVELS 0-5%/);
  assert.match(runtime, /localResearchRows = levelContextRows\.filter/);
});

test("V6.6 compact snapshot reuses relational route and evidence output without raw debug sections", () => {
  const start = runtime.indexOf("const researchSnapshotText = [");
  const end = runtime.indexOf('].join("\\n");', start);
  assert.ok(start >= 0 && end > start);
  const block = runtime.slice(start, end);
  assert.match(block, /\.\.\.localStructureLines/);
  assert.match(block, /\.\.\.stackRouteLines/);
  assert.match(block, /\.\.\.approachEvidenceLines/);
  assert.match(block, /localResearchRows\.map\(formatLevelResearchContextRow\)/);
  assert.doesNotMatch(block, /rawNativeRows/);
  assert.doesNotMatch(block, /vShapeRows/);
  assert.doesNotMatch(block, /v5SourceRows/);
});
