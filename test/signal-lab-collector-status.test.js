import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("owner Signal Lab explains that collection runs in the main InPuls tab", async () => {
  const [html, script, app] = await Promise.all([
    source("owner-signal-lab.html"),
    source("owner-signal-lab-v2.js"),
    source("app.js"),
  ]);

  assert.match(html, /id="collector-open"[^>]*target="_blank"/);
  assert.match(html, /Новые события записывает основной InPuls/);
  assert.match(script, /Сбор не запущен/);
  assert.match(script, /Signal Lab сам к Binance не подключается/);
  assert.match(script, /inpuls:owner-signal-lab-started/);
  assert.match(script, /dispatchEvent\(new CustomEvent/);
  assert.match(script, /inpuls-signal-lab-collector-health-v1/);
  assert.match(script, /Сбор замер/);
  assert.match(script, /Поток LIVE/);
  assert.match(app, /let hasMarketTicker = false/);
  assert.match(app, /if \(hasMarketTicker\) collectSignalMemoryFromFeed\(Date\.now\(\)\)/);
  assert.match(app, /function collectSignalMemoryFromFeed/);
  const renderStart = app.indexOf("function render() {");
  const renderEnd = app.indexOf("function renderInPlay", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.doesNotMatch(app.slice(renderStart, renderEnd), /updateSignalMemory\(/);
});

test("service worker reports whether a same-origin main collector client is open", async () => {
  const worker = await source("sw.js");

  assert.match(worker, /inpuls:signal-lab-collector-status/);
  assert.match(worker, /self\.clients\.matchAll/);
  assert.match(worker, /includeUncontrolled: true/);
  assert.match(worker, /url\.pathname === scopePath \|\| url\.pathname === indexPath/);
  assert.match(worker, /visibilityState/);
  assert.match(worker, /owner-signal-lab-v2\.js\?v=26-82-signal-lab-event-driven-collector-v1/);
});
