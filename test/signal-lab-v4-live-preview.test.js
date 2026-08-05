import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const stackblitz = JSON.parse(fs.readFileSync(new URL("../.stackblitzrc", import.meta.url), "utf8"));

test("Signal Lab V4 preview starts the existing static server without installing packages", () => {
  assert.equal(stackblitz.installDependencies, false);
  assert.equal(stackblitz.startCommand, "npm start");
  assert.equal(stackblitz.env.HOST, "0.0.0.0");
  assert.equal(stackblitz.env.PORT, "4173");
  assert.equal(stackblitz.env.INPULS_SIGNAL_LAB_PREVIEW, "1");
});

test("preview embedding is opt-in and production keeps DENY by default", () => {
  assert.match(server, /process\.env\.INPULS_SIGNAL_LAB_PREVIEW === "1"/);
  assert.match(server, /frame-ancestors https:\/\/stackblitz\.com https:\/\/\*\.stackblitz\.io https:\/\/\*\.webcontainer\.io/);
  assert.match(server, /: "frame-ancestors 'none'"/);
  assert.match(server, /SIGNAL_LAB_PREVIEW \? \{\} : \{ "x-frame-options": "DENY" \}/);
});

test("preview host binding is explicit while local default remains loopback", () => {
  assert.match(server, /process\.env\.HOST/);
  assert.match(server, /\|\| "127\.0\.0\.1"/);
  assert.match(server, /createStaticServer\(\)\.listen\(port, host/);
});
