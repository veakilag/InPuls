import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("global market feed uses combined streams with a raw fallback", async () => {
  const app = await source("app.js");
  assert.match(app, /fstream\.binance\.com\/stream\?streams=/);
  assert.match(app, /wss:\/\/fstream\.binance\.com\/ws/);
  assert.doesNotMatch(app, /fstream\.binance\.com\/market\/stream/);
  assert.match(app, /marketPacketReceived/);
  assert.match(app, /Нет рыночных данных · резервный поток/);
  assert.match(app, /setConnection\("online", "Онлайн"\)/);
  assert.match(app, /clearTimeout\(this\.connectionTimer\)/);
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
