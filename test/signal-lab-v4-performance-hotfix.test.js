import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const collector = fs.readFileSync(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
const extremes = fs.readFileSync(new URL("../signal-lab-v4-extremes.js", import.meta.url), "utf8");
const owner = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");

test("extreme warmup and trades avoid repeated full snapshots", () => {
  assert.match(extremes, /emitSnapshot: false/);
  assert.match(extremes, /return emitSnapshot \? this\.snapshot\(\) : null/);
  assert.match(extremes, /return emitSnapshot \? this\.snapshot\(normalized\) : null/);
});

test("collector throttles status, checks and structure trade processing", () => {
  assert.match(collector, /STATUS_NOTIFY_INTERVAL_MS = 350/);
  assert.match(collector, /CHECK_INTERVAL_MS = 1_000/);
  assert.match(collector, /STRUCTURE_TRADE_INTERVAL_MS = 200/);
  assert.match(collector, /#scheduleCheck\(now\)/);
  assert.match(collector, /structureReady/);
  assert.match(collector, /emitSnapshot: false/);
});

test("owner UI renders a bounded collapsed card window", () => {
  assert.match(owner, /limit: 250/);
  assert.match(owner, /merged\.slice\(0, 12\)/);
  assert.match(owner, /autoOpen: false/);
  assert.doesNotMatch(owner, /merged\.slice\(0, 60\)/);
});
