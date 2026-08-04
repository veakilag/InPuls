import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("Owner Algo Lab is isolated from public navigation and service worker", async () => {
  const [html, index, worker] = await Promise.all([
    source("owner-algo-lab.html"),
    source("index.html"),
    source("sw.js"),
  ]);
  assert.match(html, /noindex,nofollow,noarchive,nosnippet/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'self' https:\/\/fapi\.binance\.com/);
  assert.match(html, /owner-algo-lab\.js\?v=algo-lab-v1/);
  assert.doesNotMatch(html, /<script>(?:.|\n)*<\/script>/);
  assert.doesNotMatch(index, /owner-algo-lab/);
  assert.doesNotMatch(worker, /owner-algo-lab/);
});

test("Owner Algo Lab remains backtest-only and local-data-only", async () => {
  const js = await source("owner-algo-lab.js");
  assert.match(js, /fetchCurrentInPlayUniverse/);
  assert.match(js, /fetchBinanceFuturesKlines/);
  assert.match(js, /runTrainTest/);
  assert.match(js, /localStorage/);
  assert.match(js, /inpuls-inplay-v2/);
  assert.match(js, /inpuls-inplay-order-v1/);
  assert.doesNotMatch(js, /apiKey|apiSecret|secretKey|listenKey/i);
  assert.doesNotMatch(js, /\/fapi\/v1\/(?:order|batchOrders|leverage|positionSide)/);
  assert.doesNotMatch(js, /POST|PUT|DELETE/);
  assert.doesNotMatch(js, /WebSocket\s*\(/);
});

test("Owner Algo Lab exposes the required research controls and outputs", async () => {
  const html = await source("owner-algo-lab.html");
  for (const id of [
    "backtest-form",
    "interval",
    "days",
    "inplay-limit",
    "min-v24",
    "min-natr1",
    "min-natr5",
    "min-growth24",
    "refresh-inplay",
    "run-backtest",
    "cancel-run",
    "results-body",
    "run-history",
    "export-run",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /selection bias/i);
  assert.match(html, /BACKTEST ONLY/);
});
