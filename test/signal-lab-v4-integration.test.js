import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const collector = await readFile(new URL("../signal-lab-v3-collector.js", import.meta.url), "utf8");
const evidence = await readFile(new URL("../signal-lab-v3-evidence.js", import.meta.url), "utf8");
const chart = await readFile(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");
const replay = await readFile(new URL("../signal-lab-v3-replay-ui.js", import.meta.url), "utf8");
const html = await readFile(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
const runtime = await readFile(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
const store = await readFile(new URL("../signal-lab-v3-store.js", import.meta.url), "utf8");

test("V4 collector uses exchange tick sizes, multi-TF extrema and full order-flow recorder", () => {
  assert.match(collector, /SignalLabV4ExtremeRegistry/);
  assert.match(collector, /SignalLabV4OrderFlowRecorder/);
  assert.match(collector, /fapi\/v1\/exchangeInfo/);
  assert.match(collector, /SIGNAL_LAB_V4_TIMEFRAMES/);
  assert.match(collector, /orderFlow\.ingestTrade/);
  assert.match(collector, /extremes\.watchScore/);
});

test("evidence pack preserves two minutes of snapshot diff trades and the extrema map", () => {
  assert.match(evidence, /DEFAULT_PRE_EVENT_MS = 2 \* 60_000/);
  assert.match(evidence, /orderFlowReplay/);
  assert.match(evidence, /snapshot\+diff@100ms\+aggTrade/);
  assert.match(evidence, /extremeMapLatest/);
  assert.match(evidence, /orderFlowPreSeconds/);
});

test("episode chart supports native 4h 1d and paginated 30 day history", () => {
  assert.match(chart, /"4h": 14_400_000/);
  assert.match(chart, /"1d": 86_400_000/);
  assert.match(chart, /"30d": 30 \* 24/);
  assert.match(chart, /candles\.length < 50_000/);
  assert.match(chart, /addExtremeMapAnnotations/);
  assert.match(html, /data-chart-range="30d"/);
  assert.match(html, /data-chart-timeframe="1d"/);
});

test("owner replay exposes cluster tape scrollable local book and explicit data states", () => {
  assert.match(replay, /mountSignalLabV4OrderFlowPanel/);
  assert.match(html, /data-field="flow-cluster"/);
  assert.match(html, /data-field="flow-tape"/);
  assert.match(html, /СТАКАН · РУЧНОЙ СКРОЛЛ/);
  assert.match(html, /snapshot \+ diff/);
  assert.match(runtime, /order flow/);
});

test("manual calibration stores the requested detector error labels", () => {
  for (const label of [
    "MISSED_EXTREME", "EXTRA_EXTREME", "CONFIRMED_TOO_EARLY", "CONFIRMED_TOO_LATE",
    "WRONG_PRICE", "SHOULD_BE_ACTIVE", "SHOULD_BE_BROKEN", "WRONG_TOUCH_COUNT",
    "WRONG_LEVEL_MERGE", "MISSED_COMPRESSION", "FALSE_COMPRESSION", "MISSED_BREAKOUT",
    "FALSE_BREAKOUT", "MISSED_CASCADE", "FALSE_CASCADE", "DUPLICATE_EVENT", "LOOKAHEAD_ERROR",
  ]) assert.match(html, new RegExp(label));
  assert.match(runtime, /errorLabels/);
  assert.match(store, /errorLabels/);
});
