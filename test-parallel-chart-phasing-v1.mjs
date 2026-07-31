import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { phasedLiveEmitDelay } from "./chart.js?v=23";

test("parallel chart phases spread canvas work across the interval", () => {
  assert.equal(phasedLiveEmitDelay(1_200, 600, 0), 0);
  assert.equal(phasedLiveEmitDelay(1_200, 600, 150), 150);
  assert.equal(phasedLiveEmitDelay(1_200, 600, 300), 300);
  assert.equal(phasedLiveEmitDelay(1_234, 0, 300), 0);
});

test("extra charts use phased updates while the primary chart remains unrestricted", () => {
  const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const chart = fs.readFileSync(new URL("./chart.js", import.meta.url), "utf8");
  assert.match(app, /liveEmitIntervalMs: 600/);
  assert.match(app, /liveEmitPhaseMs/);
  assert.match(chart, /phasedLiveEmitDelay/);
  assert.match(chart, /this\.liveEmitIntervalMs/);
});
