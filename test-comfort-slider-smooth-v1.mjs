import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const installCta = readFileSync(new URL("./install-cta.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("comfort drag updates only its thumb until pointer release", () => {
  assert.match(installCta, /let pointerDragging = false;/);
  assert.match(installCta, /slider\.addEventListener\("pointerdown"/);
  assert.match(
    installCta,
    /slider\.addEventListener\("input", \(event\) => \{[\s\S]*if \(committingTheme \|\| !pointerDragging\) return;[\s\S]*event\.stopImmediatePropagation\(\);[\s\S]*scheduleThumbPosition\(\);/,
  );
  assert.match(
    installCta,
    /root\.style\.setProperty\("--comfort-position", `\$\{pendingValue\}%`\);/,
  );
  assert.doesNotMatch(
    installCta.slice(0, installCta.indexOf("\n\n(() => {", 1)),
    /localStorage|render\(|applyComfort/,
  );
});

test("theme palette is committed once after drag", () => {
  assert.match(installCta, /function commitThemeOnce\(\)/);
  assert.match(installCta, /committingTheme = true;/);
  assert.match(installCta, /slider\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\);/);
  assert.match(installCta, /slider\.addEventListener\("pointerup", finishPointerDrag\);/);
  assert.match(installCta, /slider\.addEventListener\("pointercancel", finishPointerDrag\);/);
  assert.match(installCta, /slider\.addEventListener\("lostpointercapture", finishPointerDrag\);/);
});

test("existing app owns the single persisted palette update", () => {
  const handler = app.match(
    /els\.comfortSlider\.addEventListener\("input", \(\) => \{([\s\S]*?)\n  \}\);/,
  )?.[1] ?? "";
  assert.match(handler, /state\.comfort = Number\(els\.comfortSlider\.value\);/);
  assert.match(handler, /localStorage\.setItem\(STORAGE_KEYS\.comfort/);
  assert.match(handler, /applyComfort\(state\.comfort\);/);
  assert.doesNotMatch(handler, /render\(/);
});
