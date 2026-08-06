import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  EPISODE_CONTEXT_RANGES,
  EPISODE_CHART_INTERVALS,
  episodeHistoryBounds,
  episodeViewCandleCount,
} from "../signal-lab-v3-full-chart.js";

const modal = fs.readFileSync(new URL("../signal-lab-chart-modal.js", import.meta.url), "utf8");
const full = fs.readFileSync(new URL("../signal-lab-v3-full-chart.js", import.meta.url), "utf8");

const EVENT_AT = Date.UTC(2026, 7, 6, 12, 0, 0);

test("30-day data bounds are independent from the visible zoom preset", () => {
  const bounds = episodeHistoryBounds(EVENT_AT, EPISODE_CHART_INTERVALS["1m"], EPISODE_CONTEXT_RANGES["30d"]);
  assert.equal(bounds.coverageEndTime, EVENT_AT);
  assert.equal(bounds.startTime, EVENT_AT - 30 * 86_400_000);
  assert.equal(bounds.mode, "THIRTY_DAYS_BEFORE_EVENT");
});

test("every candle timeframe requests the same 30-day history in both chart entry points", () => {
  assert.match(modal, /loadEpisodeCandles\(this\.episode, this\.interval, "30d"/);
  assert.match(full, /loadEpisodeCandles\(this\.episode, this\.interval, "30d"/);
  assert.match(modal, /range: "signal-lab-modal-loaded-30d"/);
  assert.match(full, /range: "episode-loaded-30d"/);
});

test("zoom presets change only the viewport and do not reload or discard history", () => {
  assert.match(modal, /this\.#applyViewPreset\(\);/);
  assert.match(full, /this\.#applyViewPreset\(\);/);
  assert.doesNotMatch(modal, /button\.dataset\.modalRange[\s\S]{0,260}#scheduleLoad\(\)/);
  assert.doesNotMatch(full, /button\.dataset\.chartRange[\s\S]{0,260}#load\(\)/);
});

test("view candle counts are calculated from the chosen timeframe while keeping all loaded candles", () => {
  assert.equal(episodeViewCandleCount("1m", "1h", 43_200), 123);
  assert.equal(episodeViewCandleCount("5m", "24h", 8_640), 579);
  assert.equal(episodeViewCandleCount("1h", "30d", 720), 720);
  assert.equal(episodeViewCandleCount("1m", "30d", 43_200), 1_500);
});
