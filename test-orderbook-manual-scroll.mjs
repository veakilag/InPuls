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

test("Ctrl+wheel still changes only the selected price step", () => {
  assert.match(
    appSource,
    /if \(event\.ctrlKey \|\| event\.metaKey\) \{[\s\S]*?model\.bookScaleIndex = Math\.max\(/,
    "Ctrl+wheel price-step control must remain present",
  );
  assert.match(
    appSource,
    /panel\.autoScaleIndex = model\.bookScaleIndex;/,
    "selected price step must remain the active scale",
  );
});
