import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const collectorSource = await readFile(
  new URL("../signal-lab-v3-collector.js", import.meta.url),
  "utf8",
);
const ownerHtml = await readFile(
  new URL("../owner-signal-lab-v3.html", import.meta.url),
  "utf8",
);
const ownerRuntime = await readFile(
  new URL("../owner-signal-lab-v3.js", import.meta.url),
  "utf8",
);

test("Signal Lab V3 uses the raw Binance subscription endpoint with a bounded connection watchdog", () => {
  assert.match(collectorSource, /wss:\/\/fstream\.binance\.com\/ws/);
  assert.doesNotMatch(collectorSource, /wss:\/\/fstream\.binance\.com\/market\/stream/);
  assert.match(collectorSource, /CONNECTION_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(collectorSource, /socket\.readyState\s*!==\s*WebSocket\.CONNECTING/);
  assert.match(collectorSource, /this\.socket\s*!==\s*socket/);
});

test("Signal Lab V3 stays a separate noindex owner page with its own public-market collector", () => {
  assert.match(ownerHtml, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(ownerHtml, /owner-signal-lab-v3\.js/);
  assert.match(ownerRuntime, /new SignalLabV3Collector/);
  assert.match(ownerRuntime, /candidate-not-trade-signal|Сначала собрать/);
  assert.doesNotMatch(ownerHtml, /api[_-]?key|secret|private[_-]?key/i);
});
