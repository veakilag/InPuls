import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { BinanceClock } from "./binance-clock.js";
import { advanceWaterTapeClock } from "./orderbook.js";

const core = globalThis.InPulsBinanceClockCore;

function read(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Binance clock estimator uses the fastest midpoint-compensated samples", () => {
  const estimate = core.estimateClockOffset([
    { sentAt: 1_000, receivedAt: 1_020, serverTime: 1_510, host: "a" },
    { sentAt: 2_000, receivedAt: 2_030, serverTime: 2_515, host: "b" },
    { sentAt: 3_000, receivedAt: 3_040, serverTime: 3_520, host: "c" },
    { sentAt: 4_000, receivedAt: 4_900, serverTime: 5_500, host: "slow" },
  ], 3);

  assert.equal(estimate.offsetMs, 500);
  assert.equal(estimate.rttMs, 30);
  assert.equal(estimate.sampleCount, 3);
  assert.equal(estimate.totalSampleCount, 4);
  assert.deepEqual(estimate.hosts, ["a", "b", "c"]);
});

test("first calibration replaces an inaccurate local fallback with Binance time", () => {
  let localNow = 20_000;
  let perfNow = 100;
  const clock = new BinanceClock({
    dateNow: () => localNow,
    perfNow: () => perfNow,
    fetchImpl: null,
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
  });

  assert.equal(clock.now(), 20_000, "the pre-sync fallback may follow an inaccurate device clock");
  assert.equal(clock.calibrate({ offsetMs: -10_000, rttMs: 20, sampleCount: 3 }, localNow, perfNow), true);
  assert.equal(clock.now(), 10_000, "the first valid Binance sample must become the real live edge immediately");
});

test("calibrated Binance time advances from a monotonic performance anchor", () => {
  let localNow = 10_000;
  let perfNow = 500;
  const clock = new BinanceClock({
    dateNow: () => localNow,
    perfNow: () => perfNow,
    fetchImpl: null,
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
  });

  assert.equal(clock.now(perfNow), null, "Tape must not seed its live edge from workstation time before calibration");
  assert.equal(clock.now(), localNow, "the visible clock may use local fallback during calibration");

  assert.equal(clock.calibrate({ offsetMs: 250, rttMs: 20, sampleCount: 3 }, localNow, perfNow), true);
  assert.equal(clock.now(), 10_250);

  perfNow += 750;
  localNow += 750;
  assert.equal(clock.now(), 11_000);

  clock.calibrate({ offsetMs: 100, rttMs: 18, sampleCount: 3 }, localNow, perfNow);
  assert.equal(clock.now(), 11_000, "a correction must never move exchange time backward");

  perfNow += 200;
  localNow += 200;
  assert.equal(clock.now(), 11_050, "the calibrated source catches up without a backward step");
});

test("Tape live edge follows the shared Binance time instead of the last packet alone", () => {
  const end = advanceWaterTapeClock(
    null,
    null,
    10_000,
    500,
    1_000,
    false,
    11_000,
  );
  assert.equal(end, 11_000);
});

test("browser clock, flow window and Tape use one shared calibrated source", () => {
  const app = read("./app.js");
  const orderbook = read("./orderbook.js");
  const worker = read("./orderbook-worker.js");
  const clock = read("./binance-clock.js");
  const canvasPreview = read("./canvas-comfort-preview.js");
  const index = read("./index.html");
  const sw = read("./sw.js");

  assert.match(app, /import \{ binanceClock \} from "\.\/binance-clock\.js\?v=26-102-tape-live-edge-minute-boundary-v1"/);
  assert.match(app, /tradeTimeWindow\(binanceClock\.now\(\)/);
  assert.match(app, /binanceClock\.delayToNextSecond\(12\)/);
  assert.match(app, /updateClock\(new Date\(binanceClock\.now\(\)\)\)/);
  assert.match(orderbook, /binanceClock\.now\(perfNow\)/);
  assert.match(orderbook, /formatTapeClock\(time\)[\s\S]*binanceClock\.formatTime/);
  assert.match(worker, /setInterval\(\(\) => syncServerClock\(true\)/);
  assert.doesNotMatch(clock, /canvas-comfort-preview\.js/, "clock must not load UI preview as a side effect");
  assert.match(index, /canvas-comfort-preview\.js\?v=26-107-tape-clock-contracts-v1/);
  assert.match(clock, /if \(wasCalibrated\) this\.now\(perf\);[\s\S]*else this\.lastNowMs = this\.anchorExchangeMs/);
  assert.match(canvasPreview, /\.chart-stage canvas/);
  assert.match(canvasPreview, /\.trade-flow canvas/);
  assert.match(canvasPreview, /inpuls:comfort-preview/);
  assert.match(canvasPreview, /inpuls:theme-change/);
  assert.match(index, /app\.js\?v=26-107-tape-clock-contracts-v1/);
  assert.match(sw, /binance-clock\.js\?v=26-102-tape-live-edge-minute-boundary-v1/);
});
