import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const orderbook = readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("./orderbook-worker.js", import.meta.url), "utf8");
const flow = readFileSync(new URL("./orderbook-flow-workspace.js", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const sw = readFileSync(new URL("./sw.js", import.meta.url), "utf8");

test("short background switches use a grace period", () => {
  assert.match(worker, /const BACKGROUND_GRACE_MS = 2_000;/);
  assert.match(worker, /scheduleBackgroundPause\(epoch\)/);
  assert.match(worker, /cancelBackgroundPause\(\)/);
  assert.doesNotMatch(
    worker,
    /if \(!tabVisible\) \{[\s\S]{0,220}for \(const feed of feeds\.values\(\)\) feed\.pauseForBackground\(\);/,
  );
});

test("healthy sockets resume without REST backfill", () => {
  assert.match(
    worker,
    /if \(!this\.backgroundPaused && socketOpen && depthFresh\) \{[\s\S]*post\("tape"[\s\S]*this\.emit\(now, MAX_RESUME_LEVELS_PER_SIDE, true\);[\s\S]*return;/,
  );
  const fastPath = worker.match(
    /if \(!this\.backgroundPaused && socketOpen && depthFresh\) \{([\s\S]*?)\n      \}/,
  )?.[1] ?? "";
  assert.doesNotMatch(fastPath, /loadRecentTrades/);
  assert.match(fastPath, /replace: true,[\s\S]*liveOnly: true,[\s\S]*trades: \[\]/);
});
