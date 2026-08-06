import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const owner = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
const modal = fs.readFileSync(new URL("../signal-lab-chart-modal.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../signal-lab-chart-modal.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");

test("Signal Lab opens one shared chart modal instead of chart instances inside every card", () => {
  assert.match(owner, /openEpisodeChartModal/);
  assert.doesNotMatch(owner, /mountEpisodeFullChart|disposeEpisodeFullCharts|isEpisodeFullChartOpen/);
  assert.match(owner, /deferEvidenceReplay/);
  assert.match(modal, /new CandlestickChart/);
  assert.equal((modal.match(/new CandlestickChart/g) ?? []).length, 1);
  assert.match(modal, /loadEpisodeCandles/);
  assert.match(modal, /data-modal-timeframe/);
  assert.match(modal, /data-modal-maximize/);
  assert.match(css, /resize:\s*both/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(html, /signal-lab-v8-smooth-modal-chart/);
});
