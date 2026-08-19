import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../owner-signal-lab-structural-extremes-review.js", import.meta.url), "utf8");

test("review tools hit-test visible hierarchical levels before raw snapshot", () => {
  assert.match(source, /function nearestVisibleStructuralLevel\(point\)/);
  assert.match(source, /chart\.structuralLevelMap/);
  const visible = source.indexOf("const visibleLevel = nearestVisibleStructuralLevel(point)");
  const snapshot = source.indexOf("const snapshot = current?.snapshot", visible);
  assert.ok(visible >= 0);
  assert.ok(snapshot > visible);
});
