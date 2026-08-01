import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("Footprint live handler redraws from the selected batch without an undefined variable", async () => {
  const flow = await source("orderbook-flow-workspace.js");
  const accept = flow.match(/function acceptTape\(event\)[\s\S]*?function acceptBookStatus/)?.[0] ?? "";
  assert.match(accept, /batch\.trades\.length/);
  assert.doesNotMatch(accept, /incoming\.length/);
  assert.match(accept, /ingestFootprintTrades/);
  assert.match(accept, /requestDraw\(card\)/);
});

test("market table reuses symbol rows instead of recreating every row on each ticker batch", async () => {
  const app = await source("app.js");
  assert.match(app, /const marketRowsBySymbol = new Map\(\)/);
  assert.match(app, /let row = marketRowsBySymbol\.get\(item\.symbol\)/);
  assert.match(app, /updateRow\(row, item\)/);
  assert.match(app, /function updateRow\(row, item\)/);
  assert.doesNotMatch(app, /for \(const item of filtered\) fragment\.append\(createRow\(item\)\)/);
});

test("critical market discovery has a REST bootstrap while WebSocket reconnects", async () => {
  const app = await source("app.js");
  assert.match(app, /#scheduleMarketBootstrap\(3_500\)/);
  assert.match(app, /#bootstrapMarketFromRest\(\)/);
  assert.match(app, /fapi1\.binance\.com/);
  assert.match(app, /fapi2\.binance\.com/);
  assert.match(app, /e: "24hrMiniTicker"/);
  assert.match(app, /setConnection\("online", "Онлайн"\)/);
});
