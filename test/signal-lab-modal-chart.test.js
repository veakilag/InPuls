import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const owner = fs.readFileSync(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
const modal = fs.readFileSync(new URL("../signal-lab-chart-modal.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../signal-lab-chart-modal.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
const smoke = fs.readFileSync(new URL("../scripts/signal-lab-runtime-smoke.mjs", import.meta.url), "utf8");

test("Signal Lab opens one shared chart modal instead of chart instances inside every card", () => {
  assert.match(owner, /openEpisodeChartModal/);
  assert.doesNotMatch(owner, /mountEpisodeFullChart|disposeEpisodeFullCharts|isEpisodeFullChartOpen/);
  assert.match(owner, /deferEvidenceReplay/);
  assert.match(modal, /new CandlestickChart/);
  assert.equal((modal.match(/new CandlestickChart/g) ?? []).length, 1);
  assert.match(modal, /loadEpisodeCandles/);
  assert.match(modal, /data-modal-timeframe/);
  assert.match(modal, /data-modal-maximize/);
  assert.match(modal, /buttonGroup\(TIMEFRAMES, "data-modal-timeframe", "1h"\)/);
  assert.match(modal, /buttonGroup\(RANGES, "data-modal-range", "30d"\)/);
  assert.match(modal, /this\.interval = "1h";[\s\S]*this\.contextRange = "30d";/);
  assert.match(modal, /Every episode opens with the full pre-event market context/);
  assert.match(css, /resize:\s*both/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(html, /26-118-signal-lab-30d-history-v1/);
  assert.match(smoke, /SYNTHETIC_EPISODE/);
  assert.match(smoke, /openEpisodeChartModal/);
  assert.match(smoke, /rayAnnotationReady/);
  assert.match(smoke, /const canvasRect = canvas\.getBoundingClientRect\(\)/);
  assert.ok(
    smoke.indexOf("const canvasRect = canvas.getBoundingClientRect()")
      < smoke.indexOf("root.querySelector('[data-modal-close]')?.click()"),
    "runtime smoke must measure the visible canvas before closing the modal",
  );
});
