import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const collector = fs.readFileSync(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
const levels = fs.readFileSync(new URL("../signal-lab-v4-levels-breakouts.js", import.meta.url), "utf8");
const cascades = fs.readFileSync(new URL("../signal-lab-v4-cascades.js", import.meta.url), "utf8");
const review = fs.readFileSync(new URL("../owner-signal-lab-structural-extremes-review.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../owner-signal-lab-structural-extremes-review.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../owner-signal-lab-structural-extremes-review.css", import.meta.url), "utf8");

test("stage 1 structural detector remains isolated from current production signals", () => {
  assert.doesNotMatch(collector, /signal-lab-v7-structural-extremes/);
  assert.doesNotMatch(levels, /signal-lab-v7-structural-extremes/);
  assert.doesNotMatch(cascades, /signal-lab-v7-structural-extremes/);
});

test("visual review page loads the isolated detector and all six hierarchical timeframe controls", () => {
  assert.match(review, /signal-lab-v7-structural-extremes\.js/);
  assert.match(review, /fetchReviewHistory/);
  assert.match(review, /REVIEW_LOOKBACK_MS/);
  assert.match(review, /value === null \|\| value === undefined \|\| value === ""/);
  for (const timeframe of ["1m", "5m", "15m"]) {
    assert.match(review, new RegExp(`\\"${timeframe}\\": 30 \\* 24 \\* 60 \\* 60_000`));
  }
  for (const timeframe of ["1h", "4h", "1d"]) {
    assert.match(review, new RegExp(`\\"${timeframe}\\": 180 \\* 24 \\* 60 \\* 60_000`));
  }
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

test("trader can mark, persist and export detector corrections directly on the chart", () => {
  for (const tool of [
    "navigate",
    "add-high",
    "add-low",
    "remove",
    "move",
    "confirm",
    "cross",
    "attacks",
    "line",
    "freehand",
  ]) {
    assert.match(review, new RegExp(`data-review-tool=\\"${tool}\\"`));
  }
  for (const correctionType of [
    "ADD_EXTREME",
    "REMOVE_EXTREME",
    "MOVE_EXTREME",
    "CONFIRM_AT",
    "CROSS_AT",
    "ATTACK_COUNT",
  ]) {
    assert.match(review, new RegExp(correctionType));
  }
  assert.match(review, /localStorage\.setItem/);
  assert.match(review, /InPulsStructuralExtremesTraderReview/);
  assert.match(review, /navigator\.clipboard\.writeText/);
  assert.match(review, /anchor\.download = `inpuls-extremes-review-/);
  assert.match(review, /elements\.canvas\.addEventListener\("pointerdown", handleStructuredReviewClick, true\)/);
  assert.match(css, /\.review-tools/);
  assert.match(css, /\.review-feedback/);
  assert.match(css, /canvas\[data-review-tool\]/);
});
