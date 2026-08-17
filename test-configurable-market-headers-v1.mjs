import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SymbolState } from "./engine.js?v=26-124-multi-exchange-v1";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("24 hour ticker exposes the exchange trade count", () => {
  const symbol = new SymbolState("BTCUSDT", 1_000);
  symbol.updateTicker({ E: 2_000, c: "100", o: "90", h: "101", l: "89", q: "5000000", n: 14_250_000 });
  assert.equal(symbol.metrics(undefined, 2_000).trades24h, 14_250_000);
});

test("coin radar columns are selectable and shared with chart metric strips", () => {
  const html = read("./index.html");
  const app = read("./app.js");
  assert.match(html, /id="radar-columns-toggle"/);
  assert.match(html, /id="radar-columns-panel"/);
  assert.match(app, /radarVisibleMetrics: "inpuls-radar-visible-metrics-v1"/);
  assert.match(app, /function renderRadarColumns\(\)/);
  assert.match(app, /function renderMetricStrip\(container, item\)/);
  assert.match(app, /trades24h.*Сделки 24ч/);
});

test("radar favorites cycle through colors and can be sorted", () => {
  const app = read("./app.js");
  const css = read("./workspace-v2.css");
  assert.match(app, /FAVORITE_COLORS = Object\.freeze\(\["amber", "cyan", "violet", "green"\]\)/);
  assert.match(app, /function cycleFavoriteColor\(symbol\)/);
  assert.match(app, /key === "favorite"/);
  for (const color of ["amber", "cyan", "violet", "green"]) assert.match(css, new RegExp(`data-color="${color}"`));
});

test("one header control applies a timeframe to every chart", () => {
  const html = read("./index.html");
  const app = read("./app.js");
  assert.match(html, /id="global-timeframes"[\s\S]*data-global-interval="1m"[\s\S]*data-clock-dock/);
  for (const interval of ["1m", "5m", "15m", "1h", "4h", "1d"]) {
    assert.match(html, new RegExp(`data-global-interval="${interval}"`));
  }
  assert.match(app, /function selectGlobalInterval\(interval\)/);
  assert.match(app, /for \(const panel of extraCharts\.values\(\)\)/);
  assert.match(app, /panel\.feed\.select\(panel\.model\.symbol, interval, intervalRange\(interval\), panel\.model\)/);
});

test("chart metric chips show values only and explain themselves on hover", () => {
  const app = read("./app.js");
  assert.match(app, /value\.title = `\$\{metric\.name\}/);
  assert.doesNotMatch(app, /chip\.append\(label, value\)/);
  assert.match(app, /chip\.append\(value\)/);
});

test("chart chrome is compact and future sessions use extrapolated slots", () => {
  const chart = read("./chart.js");
  const css = read("./workspace-v2.css");
  assert.match(chart, /right: width < 520 \? 48 : 54/);
  assert.match(chart, /bottom: 20/);
  assert.match(chart, /const current = this\.#timeAtIndex\(index\)/);
  assert.match(chart, /candleCountdown\(current, this\.meta\?\.interval, binanceClock\.now\(\)\)/);
  assert.match(css, /chart-tools-curtain \{ top: 28px !important; \}/);
  assert.match(css, /grid-template-rows: 29px/);
});

test("logo carries a traveling signal and alert uses a bell icon", () => {
  const html = read("./index.html");
  const css = read("./workspace-v2.css");
  assert.match(html, /brand-logo-signal/);
  assert.match(css, /stroke-dasharray: 8 92/);
  assert.match(css, /@keyframes inpuls-logo-signal/);
  assert.match(html, /alert-bell-icon/);
});
