import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const collector = fs.readFileSync(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
const levels = fs.readFileSync(new URL("../signal-lab-v4-levels-breakouts.js", import.meta.url), "utf8");
const cascades = fs.readFileSync(new URL("../signal-lab-v4-cascades.js", import.meta.url), "utf8");
const review = fs.readFileSync(new URL("../owner-signal-lab-structural-extremes-review.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../owner-signal-lab-structural-extremes-review.html", import.meta.url), "utf8");

test("stage 1 structural detector remains isolated from current production signals", () => {
  assert.doesNotMatch(collector, /signal-lab-v7-structural-extremes/);
  assert.doesNotMatch(levels, /signal-lab-v7-structural-extremes/);
  assert.doesNotMatch(cascades, /signal-lab-v7-structural-extremes/);
});

test("visual review page loads the isolated detector and all six independent timeframes", () => {
  assert.match(review, /signal-lab-v7-structural-extremes\.js/);
  assert.match(review, /fetchThirtyDays/);
  assert.match(review, /new StructuralExtremeEngine/);
  assert.match(review, /let timeframe = "1h"/);
  assert.match(review, /type: "segment"/);
  for (const timeframe of ["1m", "5m", "15m", "1h", "4h", "1d"]) {
    assert.match(html, new RegExp(`data-timeframe="${timeframe}"`));
  }
  assert.match(html, /Структурные экстремумы/);
  assert.match(html, /История снятых/);
  assert.match(html, /Candidate/);
  assert.match(html, /data-timeframe="1h" class="is-active"/);
});
