import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { SymbolState } from "./engine.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const ticker = (quoteVolume, time, price = 1) => ({
  c: String(price), q: String(quoteVolume), E: time,
  o: String(price), h: String(price), l: String(price),
});

test("radar volume velocity measures signed rolling quote-volume deltas", () => {
  const symbol = new SymbolState("TESTUSDT", 0);
  symbol.updateTicker(ticker(10_000_000, 0), 0);
  symbol.updateTicker(ticker(10_250_000, 60_000), 60_000);
  let metrics = symbol.metrics(undefined, 60_000);
  assert.equal(metrics.volumeDelta1m, 250_000);
  assert.equal(metrics.volumeDelta5m, null);

  symbol.updateTicker(ticker(9_500_000, 300_000), 300_000);
  metrics = symbol.metrics(undefined, 300_000);
  assert.equal(metrics.volumeDelta5m, -500_000);
});

test("radar filters compare raw metrics in one unit system", () => {
  const app = read("./app.js");
  assert.match(app, /metric === "quoteVolume24h" \|\| metric === "volumeVelocity"/);
  assert.doesNotMatch(app, /if \(rule\.metric === "quoteVolume24h"\) value \/= 1_000_000/);
  assert.doesNotMatch(app, /if \(rule\.metric === "fundingRate"\) value \*= 100/);
});

test("compact widgets drop grips and chart prices without losing header drag", () => {
  const html = read("./index.html");
  const app = read("./app.js");
  const css = read("./workspace-v2.css");
  assert.doesNotMatch(html, /panel-grip|id="chart-price"/);
  assert.doesNotMatch(app, /data-mini-price|panel-grip/);
  assert.match(app, /bindPanelDrag\(document\.querySelector\("\.primary-chart \.chart-heading"\)/);
  assert.match(app, /bindPanelDrag\(document\.querySelector\("\.top-card \.radar-command-bar"\)/);
  assert.match(css, /@container \(max-width: 620px\)[\s\S]*grid-template-rows: 25px 23px/);
  assert.match(css, /\.panel-grip,[\s\S]*display: none !important/);
  assert.match(css, /\.clock-dock\.is-clock-away::after[\s\S]*content: "↩"/);
});

test("drawing curtain stays open and OHLC magnet uses an icon", () => {
  const html = read("./index.html");
  const app = read("./app.js");
  assert.match(app, /drawingButtons\.forEach[\s\S]*?setOpen\(true\)/);
  assert.match(html, /class="drawing-tool-icon magnet-icon"/);
  assert.doesNotMatch(html, /aria-label="Магнит к OHLC"[^>]*>⌁/);
});

test("scanner thresholds no longer emit continuous market sounds", () => {
  const app = read("./app.js");
  const alerts = app.match(/function updateAlerts\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(alerts, /playAlert\(/);
  assert.match(app, /if \(state\.soundEnabled\) playAttentionAlert\(\)/);
});

test("orderbook and install surfaces use the new neutral accent system", () => {
  const app = read("./app.js");
  const css = read("./workspace-v2.css");
  const install = read("./install-cta.js");
  assert.match(css, /\.orderbook-card \.orderbook-heading[\s\S]*var\(--accent\)/);
  assert.match(css, /\.book-market-badge/);
  assert.doesNotMatch(app, /\/USDT · \$\{marketLabel\}/);
  assert.match(install, /rgba\(124,131,255/);
  assert.doesNotMatch(install, /rgba\(79,255,176/);
});
