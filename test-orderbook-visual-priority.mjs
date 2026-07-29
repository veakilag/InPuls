import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const flow = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");

test("narrow books give unused price space back to sizes and mark the full current level", () => {
  assert.match(orderbook, /grid-template-columns: minmax\(0, 1fr\) var\(--book-price-width, 8\.25ch\)/);
  assert.doesNotMatch(orderbook, /minmax\(76px, var\(--book-price-width/);
  assert.match(orderbook, /range\.selectNodeContents\(element\)/);
  assert.match(orderbook, /Math\.ceil\(maximumTextPixels \+ 10\)/);
  assert.match(orderbook, /--book-price-width", `\$\{width\}px`/);
  assert.doesNotMatch(orderbook, /inpulsPriceWidthChars/);
  assert.match(orderbook, /\.book-ladder-row\.is-market \{[\s\S]*inset 4px 0 var\(--green\)/);
  assert.match(orderbook, /\.book-ladder-row\.is-market strong \{[\s\S]*background: transparent !important/);
  assert.doesNotMatch(orderbook, /border-right: 3px solid #66e4ff/);
  assert.match(orderbook, /justify-content: flex-end/);
});

test("ordinary sizes are neutral and full-book anomalies have three tiers", () => {
  assert.match(orderbook, /rgba\(232, 237, 240, \.88\)/);
  assert.match(orderbook, /export function bookQuoteScale\(bids, asks, sampleLimit = 2_048\)/);
  assert.match(app, /sessionBookAnomalyThreshold\(/);
  assert.match(app, /const orderBookAutoThresholds = new Map\(\)/);
  assert.match(app, /bid: automaticThreshold/);
  assert.match(app, /ask: automaticThreshold/);
  assert.match(app, /bookDisplayedQuote\(source, automatic\)/);
  assert.match(app, /const automaticHighlight = panel\.model\.highlightMode !== "manual"/);
  assert.match(app, /rows\.map\(\(row\) => Math\.max\(0, Number\(row\.quote\) \|\| 0\)\)/);
  assert.match(app, /function anomalyTierForQuote\(quote, threshold\)/);
  assert.match(app, /is-anomaly-tier-\$\{anomalyTier\}/);
  assert.match(orderbook, /is-anomaly-tier-1/);
  assert.match(orderbook, /is-anomaly-tier-2/);
  assert.match(orderbook, /is-anomaly-tier-3/);
  assert.match(orderbook, /width: var\(--size\) !important/);
  assert.match(orderbook, /max-width: 100% !important/);
  assert.doesNotMatch(orderbook, /book-size-label-space/);
  assert.match(orderbook, /column-gap: 4px !important/);
  assert.match(orderbook, /\.book-ladder-row \.book-size \{[\s\S]*border-right: 1px solid/);
  assert.match(orderbook, /\.book-ladder-row strong \{[\s\S]*border-left: 0 !important/);
  assert.match(orderbook, /\.book-ladder-row\.is-anomaly:not\(\.is-market\) \{[\s\S]*background: transparent !important;[\s\S]*box-shadow: none !important/);
  assert.doesNotMatch(orderbook, /is-anomaly strong,\s*[\s\S]*is-market strong/);
});

test("size labels stay readable and hover shows distance from current price", () => {
  assert.match(orderbook, /\.book-ladder-row\.is-anomaly \.book-size \{[\s\S]*color: #f4f8fa !important/);
  assert.match(orderbook, /\.book-ladder-row:not\(\.is-anomaly\) \.book-size \{[\s\S]*color: #e5edf1 !important/);
  assert.match(app, /<span class="book-hover-percent" hidden aria-hidden="true"><\/span>/);
  assert.match(app, /bookDistancePercentLabel\(price, panel\.lastMiddle\)/);
  assert.match(app, /ladderRows\.addEventListener\("pointerleave", hideHoverPercent\)/);
  assert.match(orderbook, /\.book-hover-percent\.is-bid/);
  assert.match(orderbook, /\.book-hover-percent\.is-ask/);
});

test("footprint uses one proportional dominance cell and interval candles", () => {
  assert.match(flow, /export function footprintCellIntensity/);
  assert.match(flow, /const sellWidth = cellWidth \* sellShare/);
  assert.match(flow, /const buyWidth = Math\.max\(0, cellWidth - sellWidth\)/);
  assert.match(flow, /formatQuoteVolume\(cluster\.quote\)/);
  assert.doesNotMatch(flow, /\$\{dominantSide\} \$\{Math\.round\(dominantShare \* 100\)\}%/);
  assert.doesNotMatch(flow, /columnWidth \* \.25|columnWidth \* \.75|halfWidth/);
  assert.match(flow, /const highRow = nearestRow\(rows, interval\.highPrice\)/);
  assert.match(flow, /const lowRow = nearestRow\(rows, interval\.lowPrice\)/);
  assert.match(flow, /const rising = Number\(interval\.closePrice\) >= Number\(interval\.openPrice\)/);
  assert.match(flow, /rising[\s\S]*theme\.bullStroke[\s\S]*theme\.bearStroke/);
  assert.match(flow, /rising[\s\S]*theme\.bullFill[\s\S]*theme\.bearFill/);
  assert.match(flow, /const bodyWidth = Math\.max\(2, Math\.min\(8, columnWidth \* \.16\)\)/);
  assert.match(flow, /const columnsLeft = Math\.max\(0, width - columns\.length \* columnWidth\)/);
  assert.doesNotMatch(flow, /moveTo\(centerX, 0\)/);
});

test("cluster history is compact, pannable and follows the brightness palette", () => {
  assert.match(flow, /export function footprintColumnWidthForWheel/);
  assert.match(flow, /export function footprintHistoryOffsetLimit/);
  assert.match(flow, /state\.historyOffset = clamp\(startOffset \+ columns/);
  assert.match(flow, /color-mix\(in srgb, var\(--panel\) 78%, var\(--panel-2\)\)/);
  assert.match(orderbook, /\.orderbook-card \.orderbook-tape,[\s\S]*background: var\(--panel\) !important/);
  assert.doesNotMatch(flow, /rgba\(71, 210, 39/);
  assert.doesNotMatch(flow, /rgba\(226, 58, 78/);
});

test("Tape paints the active panel theme instead of a black canvas", () => {
  assert.match(app, /dispatchEvent\(new CustomEvent\("inpuls:theme-change"\)\)/);
  assert.match(orderbook, /function paintTapeSurface\(context, rect\)/);
  assert.match(orderbook, /getPropertyValue\("--panel"\)/);
  assert.match(orderbook, /globalThis\.addEventListener\("inpuls:theme-change"/);
  assert.match(flow, /globalThis\.addEventListener\("inpuls:theme-change"/);
});

test("round prices affect only text and the liquidity meter stays readable", () => {
  assert.match(orderbook, /\.book-ladder-row\.is-price-round:not\(\.is-market\) \{[\s\S]*background: transparent !important/);
  assert.match(orderbook, /\.book-ladder-row\.is-price-half:not\(\.is-market\) strong/);
  assert.match(orderbook, /\.book-ladder-row\.is-price-round:not\(\.is-market\) strong/);
  assert.match(orderbook, /font-size: calc\(7\.4 \* var\(--font-scale\)\) !important/);
  assert.match(orderbook, /font-size: calc\(8\.2 \* var\(--font-scale\)\) !important/);
  assert.match(orderbook, /\.inpuls-liquidity-meter \{[\s\S]*height: 18px/);
  assert.match(orderbook, /font: 850 9px\/1 Inter/);
  assert.match(orderbook, /\.orderbook-rows \{[\s\S]*padding-top: 19px/);
});

test("live trades invalidate the current footprint frame immediately", () => {
  assert.match(flow, /incoming\.length && state\.historyOffset === 0/);
  assert.match(flow, /state\.hasFrame = false/);
});

test("trade count is not shown above Tape", () => {
  assert.doesNotMatch(flow, /inpuls-flow-count|flowCount|flowCountText|0 trades/);
});

test("visual priority ships one consistent runtime", () => {
  assert.match(index, /26-53-owner-signal-lab-v1/);
  assert.match(app, /orderbook\.js\?v=26-53-owner-signal-lab-v1/);
  assert.match(orderbook, /orderbook-flow-workspace\.js\?v=26-53-owner-signal-lab-v1/);
  assert.match(sw, /26-53-owner-signal-lab-v1/);
});
