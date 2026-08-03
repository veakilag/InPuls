import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./canvas-comfort-preview.js", import.meta.url), "utf8");

test("comfort preview remains isolated to chart and Tape canvases", () => {
  assert.match(source, /\.chart-stage canvas/);
  assert.match(source, /\.trade-flow canvas/);
  assert.doesNotMatch(source, /querySelectorAll\(["']canvas["']\)/);
  assert.match(source, /inpuls:comfort-preview/);
  assert.match(source, /inpuls:theme-change/);
  assert.match(source, /brightness\(/);
  assert.match(source, /MutationObserver/);
});

test("canvas preview does not mutate persisted comfort state", () => {
  assert.doesNotMatch(source, /localStorage\.setItem/);
  assert.doesNotMatch(source, /dataset\.comfort\s*=/);
  assert.doesNotMatch(source, /dispatchEvent\(new CustomEvent\(["']inpuls:theme-change/);
});
