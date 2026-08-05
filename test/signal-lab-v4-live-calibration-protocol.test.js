import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const protocol = fs.readFileSync(new URL("../docs/signal-lab-v4-stage4-live-checklist.md", import.meta.url), "utf8");

test("live calibration protocol requires positives, false examples and both directions", () => {
  assert.match(protocol, /at least 10 canonical or weak examples/);
  assert.match(protocol, /at least 10 explicit false examples/);
  assert.match(protocol, /at least 5 long and 5 short examples/);
});

test("live calibration protocol verifies setup before trigger and rejects look-ahead", () => {
  assert.match(protocol, /without look-ahead/);
  assert.match(protocol, /Did CASCADE SETUP exist before the first level was crossed/);
  assert.match(protocol, /strict first-level crossing/);
});

test("live calibration report does not misuse win rate", () => {
  assert.match(protocol, /Do not call any of these counts a win rate/);
  assert.match(protocol, /formal entry, stop, exit and cost model/);
});
