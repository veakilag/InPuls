import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const chart = fs.readFileSync(new URL("../chart.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("chart buckets annotations once instead of filtering the whole set per layer", () => {
  assert.match(chart, /this\.annotationBuckets = buckets/);
  const start = chart.indexOf("#drawAnnotations(ctx, showLabels = true)");
  const end = chart.indexOf("#drawDrawings(ctx)", start);
  const body = chart.slice(start, end);
  assert.doesNotMatch(body, /this\.annotations\.filter/);
  assert.match(body, /visibleRays/);
  assert.match(body, /if \(!showLabels\) return/);
});

test("drag and wheel use lightweight rendering and restore detail", () => {
  assert.match(chart, /const interactionLite = Boolean/);
  assert.match(chart, /this\.wheelActive = true/);
  assert.match(chart, /this\.#drawAnnotations\(ctx, !interactionLite\)/);
  assert.match(chart, /this\.#scheduleViewportPersist\(\)/);
  assert.match(chart, /this\.drag = null;\n    this\.canvas\.style\.cursor = "crosshair";\n    this\.#requestRender\(\);/);
});

test("release pages request the optimized chart build", () => {
  assert.match(app, /chart\.js\?v=26-121-indigo-market-workspace-v1/);
  assert.match(index, /app\.js\?v=26-121-indigo-market-workspace-v1/);
});
