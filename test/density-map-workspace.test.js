import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("workspace exposes density map as a resizable persistent widget", () => {
  const index = read("index.html");
  const app = read("app.js");
  const css = read("density-map.css");

  assert.match(index, /data-add-panel="density-map"/);
  assert.match(index, /density-map\.css\?v=26-127-density-map-v1/);
  assert.match(app, /source\?\.type === "density-map"/);
  assert.match(app, /new DensityMapWidget/);
  assert.match(app, /installPanelEdgeResizers\(article, model\)/);
  assert.match(app, /selectChartSymbolFromSource\(entry\.symbol, source, true\)/);
  assert.match(app, /openOrderBookForSymbol\(entry\.symbol, source\)/);
  assert.match(css, /container-type: inline-size/);
  assert.match(css, /@container \(max-width: 560px\)/);
});

test("density map has exactly the two requested filters and uses depth-only live feeds", () => {
  const widget = read("density-map-widget.js");
  const scanner = read("density-map-scanner.js");

  assert.match(widget, /ПЛОТНОСТЬ ОТ/);
  assert.match(widget, /ВРЕМЯ ЖИЗНИ ОТ/);
  assert.match(scanner, /EXCHANGE_IDS\.flatMap/);
  assert.match(scanner, /depthOnly: true/);
  assert.match(scanner, /fetchExchangeOrderBook/);
  assert.match(scanner, /ExchangeOrderBookFeed/);
});
