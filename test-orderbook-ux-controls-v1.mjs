import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  aggregateLabelPrice,
  aggregateStableX,
  aggregateTapeZeroMs,
  tapeSecondsForScale,
} from "./orderbook.js";

const buy = (id, time, price, quote) => ({ id, time, price, quote, quantity: quote / price, side: "buy" });
const sell = (id, time, price, quote) => ({ id, time, price, quote, quantity: quote / price, side: "sell" });

test("AGG label uses the price-range midpoint", () => {
  assert.equal(aggregateLabelPrice({ minPrice: 100, maxPrice: 108, firstPrice: 100 }), 104);
});

test("same-millisecond AGG groups receive stable non-overlapping ordinals", () => {
  const groups = aggregateTapeZeroMs([
    buy(1, 1000, 100, 1000),
    sell(2, 1000, 101, 1200),
    buy(3, 1000, 102, 1400),
  ]);
  assert.deepEqual(groups.map((item) => item.timeOrdinal), [0, 1, 2]);
  const xs = groups.map((item) => aggregateStableX(900, item.timeOrdinal, 30, 1000));
  assert.equal(new Set(xs).size, 3);
  assert.ok(xs[1] < xs[0] && xs[2] < xs[1]);
});

test("tape time scale supports close flow and long history", () => {
  const close = tapeSecondsForScale(660, 35);
  const normal = tapeSecondsForScale(660, 100);
  const history = tapeSecondsForScale(660, 300);
  assert.ok(close < normal);
  assert.ok(history > normal);
});

test("settings expose 80-200 font scale and verified shortcut sections only", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(html, /id="font-scale" type="range" min="80" max="200"/);
  assert.match(html, /<h3>Стакан<\/h3>/);
  assert.match(html, /<h3>Лента<\/h3>/);
  assert.match(html, /Shift<\/kbd> \+ колесо/);
  assert.doesNotMatch(html, /class="settings-grid"/);
  assert.match(app, /Math\.min\(200, Number\(rawValue\)/);
});

test("clusters use the brighter dominance fill", () => {
  const flow = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
  assert.match(flow, /const alpha = \.58 \+ clusterStrength \* \.4/);
});
