import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sharedStyles = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const signalLabStyles = fs.readFileSync(new URL("../signal-lab-v5-orderbook.css", import.meta.url), "utf8");

test("Signal Lab overrides the fixed main-workspace scroll lock", () => {
  assert.match(sharedStyles, /html, body \{ height: 100%; overflow: hidden;/);
  assert.match(sharedStyles, /main \{[^}]*height: calc\(100vh - 46px\);[^}]*overflow: hidden;/s);
  assert.match(signalLabStyles, /html \{[^}]*height: auto !important;[^}]*overflow-y: auto !important;/s);
  assert.match(signalLabStyles, /body \{[^}]*height: auto !important;[^}]*overflow-y: visible !important;/s);
  assert.match(signalLabStyles, /body > main \{[^}]*height: auto !important;[^}]*overflow: visible !important;/s);
});

test("internal replay workspace remains clipped independently from page scroll", () => {
  assert.match(signalLabStyles, /\.signal-lab-orderbook-workspace \{[^}]*overflow: hidden;/s);
  assert.match(signalLabStyles, /\.signal-lab-replay-card \.orderbook-rows/);
});
