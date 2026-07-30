import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

function block(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test("60 FPS painter does not force DOM geometry on every frame", () => {
  const painter = block("function drawTapeCard(card) {", "\nfunction drawAllTapes()");
  assert.match(painter, /const shouldSampleViewport = state\.viewportDirty/);
  assert.match(painter, /TAPE_VIEWPORT_SAMPLE_MS/);
  assert.match(painter, /state\.targetPriceViewport/);
  assert.equal((painter.match(/visibleBookRows\(card, flow\)/g) ?? []).length, 1);
});

test("render model reuses immutable nodes and skips full sorting", () => {
  const model = block("function refreshTapeRenderModel", "\nfunction visibleWaterTapeNodes");
  assert.match(model, /previousNodes\.get\(key\) \?\? Object\.freeze/);
  assert.match(model, /for \(let index = stored\.length - 1; index >= 0; index -= 1\)/);
  assert.doesNotMatch(model, /\.sort\(/);
  assert.match(model, /state\.rawNodeByKey = nextNodesByKey/);
});

test("Tape surface theme lookup is cached outside the frame hot path", () => {
  assert.match(source, /let cachedTapeSurfaceColor = null/);
  assert.match(source, /if \(cachedTapeSurfaceColor\) return cachedTapeSurfaceColor/);
  assert.match(source, /cachedTapeSurfaceColor = null;[\s\S]*scheduleTapeDraw\(true\)/);
});

test("replace packets reset only current water renderer state", () => {
  const accept = block("function acceptTapeData(event) {", "\nfunction bindTapeCard");
  assert.match(accept, /state\.clockEndTime = null/);
  assert.match(accept, /state\.targetPriceViewport = null/);
  assert.match(accept, /state\.rawNodeByKey\?\.clear/);
  assert.doesNotMatch(accept, /cameraEndTime|cameraUpdatedAt|cameraAnimating/);
});
