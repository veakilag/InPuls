import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const policy = JSON.parse(fs.readFileSync(new URL("../docs/signal-lab-v4-stage4-sample-policy.json", import.meta.url), "utf8"));

test("Stage 4 sample policy requires balanced positive, negative and directional coverage", () => {
  assert.equal(policy.checkpoint.minimumReviewedEpisodes, 30);
  assert.equal(policy.checkpoint.minimumCanonicalOrWeak, 10);
  assert.equal(policy.checkpoint.minimumFalse, 10);
  assert.equal(policy.checkpoint.minimumLong, 5);
  assert.equal(policy.checkpoint.minimumShort, 5);
});

test("Stage 4 sample policy excludes unreliable evidence from threshold fitting", () => {
  assert.deepEqual(policy.thresholdFittingExclusions, [
    "GAP",
    "STALE",
    "ERROR",
    "ambiguous",
    "unavailable",
    "LOOKAHEAD_ERROR",
  ]);
});
