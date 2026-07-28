import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("manual orderbook scroll remains authoritative", () => {
  assert.match(
    appSource,
    /else if \(model\.bookCentered === false && Number\.isFinite\(panel\.viewCenter\) && Number\.isFinite\(panel\.priceStep\)\)/,
    "manual DOM scroll branch must remain enabled",
  );
  assert.match(
    appSource,
    /panel\.viewCenter -= Math\.sign\(event\.deltaY\) \* panel\.priceStep \* 3;/,
    "normal wheel must move the saved view center",
  );
  assert.match(
    appSource,
    /Manual scroll is authoritative: market movement must never recenter the DOM\./,
    "the manual-scroll contract must be explicit in app.js",
  );

  assert.doesNotMatch(
    appSource,
    /panel\.autoCentering\s*=\s*true/,
    "market movement must never enable automatic recentering",
  );
  assert.doesNotMatch(
    appSource,
    /panel\.viewCenter\s*\+=\s*difference/,
    "the view center must not ease back toward the market",
  );
  assert.doesNotMatch(
    appSource,
    /panel\.centerFrame\s*=\s*requestAnimationFrame/,
    "manual DOM position must not schedule recenter animation frames",
  );
});

test("Ctrl+wheel changes the comparable percent depth preset", () => {
  assert.match(
    appSource,
    /if \(event\.ctrlKey \|\| event\.metaKey\) \{[\s\S]*?BOOK_DEPTH_PERCENT_PRESETS/,
    "Ctrl+wheel comparable-depth control must remain present",
  );
  assert.match(
    appSource,
    /model\.bookDepthPercent = BOOK_DEPTH_PERCENT_PRESETS\[nextIndex\];/,
    "the selected percent depth must be persisted",
  );
  assert.doesNotMatch(appSource, /model\.bookScaleIndex = Math\.max\(/);
});
