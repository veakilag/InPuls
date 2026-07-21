import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("all browser entry points identify the build as v21", async () => {
  const [html, app, worker, refresh, version] = await Promise.all([
    source("index.html"), source("app.js"), source("sw.js"), source("refresh.html"), source("VERSION.txt"),
  ]);
  for (const text of [html, app, worker, refresh, version]) assert.doesNotMatch(text, /(?:v|build=|\?v=)20\b/);
  assert.match(html, /inpuls-build" content="21"/);
  assert.match(worker, /inpuls-v21/);
  assert.match(version, /^InPuls v21/m);
});

test("v21 DOM exposes wheel scaling, center lock, trade filter, splitter and clusters", async () => {
  const app = await source("app.js");
  assert.match(app, /data-book-center/);
  assert.match(app, /data-trade-min/);
  assert.match(app, /data-book-clusters/);
  assert.match(app, /book-splitter/);
  assert.match(app, /event\.ctrlKey \|\| event\.metaKey/);
  assert.doesNotMatch(app, /data-book-depth/);
});

test("small panels keep compact menus and smaller resize corners", async () => {
  const css = await source("styles.css");
  assert.match(css, /\.chart-resizer, \.panel-resizer \{ width: 12px; height: 12px; \}/);
  assert.match(css, /\.chart-toolbox\.opens-sideways/);
  assert.match(css, /@container \(max-width: 360px\)/);
});
