import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("global market feed uses the supported raw subscription endpoint", async () => {
  const app = await source("app.js");
  assert.match(app, /wss:\/\/fstream\.binance\.com\/ws/);
  assert.doesNotMatch(app, /fstream\.binance\.com\/market\/stream/);
  assert.match(app, /socket\.readyState !== WebSocket\.CONNECTING/);
  assert.match(app, /Binance не отвечает/);
  assert.match(app, /clearTimeout\(this\.connectionTimer\)/);
  assert.match(app, /socket\.addEventListener\("open",/);
  assert.match(app, /setConnection\("online", "Онлайн"\)/);
  assert.match(app, /this\.#send\("SUBSCRIBE", \["!miniTicker@arr"/);
});

test("Event Radar Beta assets are removed from runtime and PWA cache", async () => {
  const [html, app, worker] = await Promise.all([
    source("index.html"), source("app.js"), source("sw.js"),
  ]);
  for (const text of [html, app, worker]) {
    assert.doesNotMatch(text, /event-radar-beta/);
    assert.doesNotMatch(text, /inpuls:event-radar-/);
  }
});
