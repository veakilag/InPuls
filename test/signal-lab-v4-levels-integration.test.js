import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const collector = fs.readFileSync(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
const evidence = fs.readFileSync(new URL("../signal-lab-v3-evidence.js", import.meta.url), "utf8");
const fullChart = fs.readFileSync(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");

test("collector feeds level zones from extrema, closed candles and aggTrade", () => {
  assert.match(collector, /SignalLabV4LevelBreakoutRegistry/);
  assert.match(collector, /this\.levels\.ingestPrice/);
  assert.match(collector, /this\.levels\.ingestCandle/);
  assert.match(collector, /this\.levels\.sync/);
  assert.match(collector, /levelMap/);
});

test("evidence pack preserves initial and latest level maps", () => {
  assert.match(evidence, /levelMap:/);
  assert.match(evidence, /levelMapLatest:/);
  assert.match(evidence, /activeLevelZones/);
  assert.match(evidence, /activeBreakoutEvents/);
});

test("full chart explains zones, strict crossing, acceptance and reclaim", () => {
  assert.match(fullChart, /addLevelMapAnnotations/);
  assert.match(fullChart, /ПРОХОД/);
  assert.match(fullChart, /ПРИНЯТИЕ/);
  assert.match(fullChart, /ПРОКОЛ И ВОЗВРАТ/);
  assert.match(fullChart, /РЕТЕСТ/);
});

test("owner page describes calibrated levels before cascade", () => {
  assert.match(page, /зоны ×N/);
  assert.match(page, /проход, принятие, ретест/);
  assert.match(page, /signal-lab-v4-stage2/);
});
