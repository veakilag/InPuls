import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resizeTiledWorkspace, WORKSPACE_COLS, WORKSPACE_ROWS } from "./workspace-layout.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const minimum = (panel) => panel.type === "scanner" ? { w: 10, h: 4 } : { w: 6, h: 4 };

test("workspace grid has double precision and moves a shared vertical seam", () => {
  assert.equal(WORKSPACE_COLS, 48);
  assert.equal(WORKSPACE_ROWS, 24);
  const panels = [
    { id: "primary", type: "chart", x: 0, y: 0, w: 36, h: 18 },
    { id: "radar", type: "radar", x: 36, y: 0, w: 12, h: 18 },
  ];
  const next = resizeTiledWorkspace(panels, "primary", "e", 3, minimum);
  assert.deepEqual(next, [
    { id: "primary", type: "chart", x: 0, y: 0, w: 39, h: 18 },
    { id: "radar", type: "radar", x: 39, y: 0, w: 9, h: 18 },
  ]);
});

test("one horizontal seam can resize a window against multiple tiled neighbours", () => {
  const panels = [
    { id: "scanner", type: "scanner", x: 0, y: 18, w: 48, h: 6 },
    { id: "primary", type: "chart", x: 0, y: 0, w: 36, h: 18 },
    { id: "radar", type: "radar", x: 36, y: 0, w: 12, h: 18 },
  ];
  const next = resizeTiledWorkspace(panels, "scanner", "n", -2, minimum);
  assert.deepEqual(next.map(({ id, y, h }) => ({ id, y, h })), [
    { id: "scanner", y: 16, h: 8 },
    { id: "primary", y: 0, h: 16 },
    { id: "radar", y: 0, h: 16 },
  ]);
});

test("shared seam refuses to shrink a neighbour below its minimum", () => {
  const panels = [
    { id: "left", type: "chart", x: 0, y: 0, w: 42, h: 10 },
    { id: "right", type: "radar", x: 42, y: 0, w: 6, h: 10 },
  ];
  assert.equal(resizeTiledWorkspace(panels, "left", "e", 1, minimum), null);
});

test("chart cockpit lives in the header and drops a tool curtain", () => {
  const html = read("./index.html");
  const app = read("./app.js");
  const css = read("./workspace-v2.css");
  const chart = read("./chart.js");
  assert.match(html, /<header class="chart-heading">[\s\S]*?<div class="chart-metrics"[\s\S]*?<\/header>\s*<div class="chart-tools-curtain">/);
  assert.match(html, /data-timeframe-visibility/);
  assert.match(html, /class="drawing-tool-icon ruler-icon"/);
  assert.match(app, /bindTimeframeVisibility\(/);
  assert.match(app, /installPanelEdgeResizers/);
  assert.match(app, /loadJson\("inpuls-workspace-v4", null\)/);
  assert.match(css, /repeat\(48,/);
  assert.match(css, /repeat\(24,/);
  assert.match(css, /--accent: #7c83ff/);
  assert.match(chart, /if \(this\.activeTool\) this\.magnetEnabled = true/);
  assert.match(chart, /const priceBottom = height - margins\.bottom;/);
  assert.doesNotMatch(chart, /priceBottom \+ 14/);
});
