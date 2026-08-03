import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");

function section(startMarker, endMarker) {
  const start = orderbook.indexOf(startMarker);
  const end = orderbook.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} section must exist`);
  return orderbook.slice(start, end);
}

test("Tape heartbeat no longer scans the document or redraws canvases every second", () => {
  const runtime = section("function installOrderBookRuntime()", "\nif (typeof document !== \"undefined\")");
  const heartbeatStart = runtime.indexOf("const refreshTapeStateHeartbeat = () => {");
  const heartbeatEnd = runtime.indexOf("\n  scheduleTapeDraw(true);", heartbeatStart);
  const heartbeat = runtime.slice(heartbeatStart, heartbeatEnd);

  assert.match(heartbeat, /for \(const card of boundTapeCards\)/);
  assert.match(heartbeat, /setTimeout\(runTapeStateHeartbeat, TAPE_STATE_REFRESH_MS\)/);
  assert.doesNotMatch(heartbeat, /setInterval/);
  assert.doesNotMatch(heartbeat, /scanTapeCards\(document\)/);
  assert.doesNotMatch(heartbeat, /querySelectorAll\("\.orderbook-card"\)/);
  assert.doesNotMatch(heartbeat, /decorateDensityAges/);
  assert.doesNotMatch(heartbeat, /scheduleTapeDraw|drawAllTapes|requestAnimationFrame/);
});

test("bound Tape cards are event-discovered and disconnected cards are pruned", () => {
  assert.match(orderbook, /const boundTapeCards = new Set\(\)/);
  const bind = section("function bindTapeCard(card) {", "\nfunction scanTapeCards");
  assert.match(bind, /boundTapeCards\.add\(card\)/);
  assert.match(orderbook, /if \(!card\?\.isConnected\) \{[\s\S]*boundTapeCards\.delete\(card\)/);
  assert.match(orderbook, /new MutationObserver\(\(mutations\) =>/);
});

test("hidden density-age mode performs no ladder-row scan", () => {
  const decorate = section("function decorateDensityAges", "\nfunction syncDensityAgeButton");
  const visibilityGuard = decorate.indexOf("if (!state?.densityAgeVisible)");
  const rowScan = decorate.indexOf('card.querySelectorAll(".orderbook-rows .book-ladder-row")');
  assert.ok(visibilityGuard >= 0 && rowScan > visibilityGuard);
  assert.match(decorate, /if \(state\?\.densityAgeDecorated\)/);
  assert.match(decorate, /state\.densityAgeDecorated = false/);
  assert.match(decorate, /state\.densityAgeDecorated = true/);
});

test("book data refreshes density ages only for visible matching cards", () => {
  const accept = section("function acceptBookData", "\nfunction acceptBookStatus");
  assert.match(accept, /for \(const card of boundTapeCards\)/);
  assert.match(accept, /!state\?\.densityAgeVisible \|\| cardSymbol\(card\) !== symbol/);
  assert.doesNotMatch(accept, /document\.querySelectorAll\("\.orderbook-card"\)/);
});

test("isolated Tape build ships through fresh module keys", () => {
  assert.match(app, /orderbook\.js\?v=26-104-tape-cluster-theme-clock-sync-v2/);
  assert.match(index, /app\.js\?v=26-104-tape-cluster-theme-clock-sync-v2/);
});
