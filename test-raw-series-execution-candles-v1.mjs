import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// SERIES is a raw execution contract; AGG remains an independent display mode.
import {
  createFootprintAccumulator,
  footprintIntervalHistory,
  ingestFootprintTrades,
  normalizeFlowTrade,
} from "./orderbook-flow-workspace.js?v=26-117-chart-interaction-performance-v1";
import { aggregateTapeSeries } from "./orderbook.js?v=26-117-chart-interaction-performance-v1";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("SERIES breaks on the first opposite raw aggressor", () => {
  const trade = (id, side, time, price, quote = 100) => ({
    id, source: "raw", side, time, tradeTime: time, eventTime: time, displayTime: time,
    price, quote, quantity: quote / price,
  });
  const groups = aggregateTapeSeries([
    trade(1, "buy", 1_000, 100),
    trade(2, "buy", 1_010, 101),
    trade(3, "sell", 1_011, 100.5, 1),
    trade(4, "buy", 1_012, 101.5),
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => [group.side, group.count]), [
    ["buy", 2], ["sell", 1], ["buy", 1],
  ]);
});

test("footprint OHLC uses execution time rather than receive/display time", () => {
  const executionTime = Date.UTC(2026, 7, 4, 16, 59, 59, 950);
  const displayTime = executionTime + 200;
  const normalized = normalizeFlowTrade({
    id: 1, side: "buy", price: 100, quantity: 1, quote: 100,
    time: executionTime, tradeTime: executionTime, eventTime: executionTime,
    receivedAt: displayTime, displayTime,
  });
  assert.equal(normalized.executionTime, executionTime);
  const accumulator = ingestFootprintTrades(createFootprintAccumulator(), [{
    id: 1, side: "buy", price: 100, quantity: 1, quote: 100,
    time: executionTime, tradeTime: executionTime, eventTime: executionTime,
    receivedAt: displayTime, displayTime,
  }]);
  const history = footprintIntervalHistory(accumulator, "1m", executionTime + 60_000, 3);
  const candle = history.find((item) => item.startTime === Math.floor(executionTime / 60_000) * 60_000);
  assert.equal(candle?.openPrice, 100);
  assert.equal(candle?.closePrice, 100);
});

test("worker and main keep SERIES on a dedicated raw-only channel", () => {
  const worker = read("./orderbook-worker.js");
  const main = read("./orderbook.js");
  assert.match(worker, /ingestSeriesRawTrade\(trade\)/);
  assert.match(worker, /trade\?\.source !== "raw"/);
  assert.match(worker, /this\.seriesRawHealthy = false/);
  assert.match(worker, /this\.seriesReplacePending = true/);
  assert.match(worker, /this\.seriesOutOfOrderCount = 0/);
  assert.doesNotMatch(worker, /this\.seriesReady = false/);
  assert.match(worker, /seriesReplace/);
  assert.match(worker, /seriesSource: this\.seriesRawHealthy \? "raw" : "warming"/);
  assert.match(main, /const tapeSeriesTradesBySymbol = new Map\(\)/);
  assert.match(main, /const seriesRawReady = state\.seriesSource === "raw" && Boolean\(seriesStored\?\.length\)/);
  assert.match(main, /const seriesInput = seriesRawReady \? seriesStored : aggregationInput/);
  assert.match(main, /state\.seriesRenderSource = seriesRenderSource/);
  assert.match(main, /state\.seriesSourceBuckets = aggregateTapeSeries\(seriesInput\)/);
});

test("SERIES ladder is visually stronger than aggregate paths", () => {
  const main = read("./orderbook.js");
  assert.match(main, /context\.lineWidth = openSeries \? 3\.2 : 2\.35/);
  assert.match(main, /context\.shadowBlur = openSeries \? 7 : 4/);
  assert.match(main, /context\.font = "900 9px Inter/);
});
