import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

// The header contract deliberately separates four commands from status and time.
test("header exposes exactly four command buttons in requested order", () => {
  const html = read("./index.html");
  const header = html.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.equal((header.match(/header-command-button/g) ?? []).length, 4);
  const ids = ["install-app", "sound-toggle", "timezone-open", "settings-open"];
  const positions = ids.map((id) => header.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(header, /class="connection-dot"/);
  assert.match(header, /data-clock-dock/);
});

test("supplied logo and compact brand are used", () => {
  const html = read("./index.html");
  const logo = read("./assets/inpuls-logo.svg");
  assert.match(html, /src="\.\/assets\/inpuls-logo\.svg"/);
  assert.match(html, /class="brand-name">InPuls</);
  assert.match(logo, /fill="#6904DE"/);
});

test("clock can float and magnetically return to its dock", () => {
  const app = read("./app.js");
  assert.match(app, /clockDock: document\.querySelector/);
  assert.match(app, /const inSnapZone =/);
  assert.match(app, /dock\.append\(clock\)/);
  assert.match(app, /if \(snap\) dockClock\(\)/);
  assert.match(app, /document\.body\.append\(clock\)/);
});

test("brightness sits between Download and Sound while radar stays in settings", () => {
  const html = read("./index.html");
  const header = html.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0] ?? "";
  const settings = html.match(/<dialog id="settings-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? "";
  const download = header.indexOf('id="install-app"');
  const brightness = header.indexOf('id="comfort-slider"');
  const sound = header.indexOf('id="sound-toggle"');
  assert.ok(download >= 0 && brightness > download && sound > brightness);
  assert.doesNotMatch(header, /event-radar-beta-toggle/);
  assert.doesNotMatch(settings, /comfort-slider/);
  assert.match(settings, /event-radar-beta-toggle/);
});

test("release inventory includes the product logo", () => {
  const serviceWorker = read("./sw.js");
  assert.match(serviceWorker, /assets\/inpuls-logo\.svg/);
});
