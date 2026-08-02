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
const reset = readFileSync(new URL("./reset-v26.html", import.meta.url), "utf8");

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

test("long background keeps a frozen Tape frame", () => {
  assert.match(orderbook, /const ORDERBOOK_WORKER_STATUS_EVENT = "inpuls:book-status";/);
  assert.match(orderbook, /function tapeRecoveryFrozen\(symbol\)/);
  assert.match(orderbook, /if \(frozen && state\.hasFrame\) \{/);
  assert.match(orderbook, /ПОСЛЕДНИЙ КАДР · ждём свежий поток/);
  assert.doesNotMatch(orderbook, /tapePendingBySymbol\.clear\(\);/);
});

test("Tape clock advances continuously while the live stream is healthy", () => {
  assert.match(orderbook, /export function advanceWaterTapeClock\(/);
  assert.match(orderbook, /const packetAge = Number\.isFinite\(packet\)/);
  assert.match(orderbook, /const base = previous \+ elapsed/);
  assert.match(orderbook, /function activeTapeCards\(\)/);
});

test("footprint preserves its canvas while the feed recovers", () => {
  assert.match(flow, /const statusBySymbol = new Map\(\);/);
  assert.match(flow, /function flowRecoveryFrozen\(symbol\)/);
  assert.match(flow, /if \(frozen && state\.hasFrame\) \{[\s\S]*skip\("recovery-frozen"\);[\s\S]*return;[\s\S]*\}/);
  assert.match(flow, /globalThis\.addEventListener\("inpuls:book-status", acceptBookStatus\)/);
});

test("a delayed feed retries independently", () => {
  assert.match(worker, /const RECOVERY_TIMEOUT_MS = 8_000;/);
  assert.match(
    worker,
    /const recoveryDelayed = this\.syncing[\s\S]*now - this\.lastRestartAt > RECOVERY_TIMEOUT_MS/,
  );
  assert.match(worker, /this\.restartAfterBackground\(true\);/);
});

test("Resume v2 ships one consistent runtime", () => {
  assert.match(index, /app\.js\?v=26-100-tape-heartbeat-isolation-v1/);
  assert.match(app, /orderbook\.js\?v=26-100-tape-heartbeat-isolation-v1/);
  assert.match(app, /render-scheduler\.js\?v=render-scheduler-v1/);
  assert.match(orderbook, /orderbook-worker\.js\?v=26-91-runtime-boot-cache-feed-v1/);
  assert.match(orderbook, /orderbook-flow-workspace\.js\?v=26-91-runtime-boot-cache-feed-v1/);
  assert.match(worker, /orderbook-tape-latency\.js\?v=worker-bp-v1/);
  assert.match(sw, /inpuls-26-91-runtime-boot-cache-feed-v1/);
  assert.match(reset, /Resume v2/);
});

test("manager hard restart preserves frozen symbol frames", () => {
  const notifyStart = orderbook.indexOf("  #notifyAll(status) {");
  const notifyEnd = orderbook.indexOf("\n  available()", notifyStart);
  const notifyBlock = orderbook.slice(notifyStart, notifyEnd);
  assert.ok(notifyStart >= 0 && notifyEnd > notifyStart);
  assert.match(notifyBlock, /for \(const \[symbol, ids\] of this\.clientsBySymbol\)/);
  assert.match(notifyBlock, /this\.lastStatusBySymbol\.set\(symbol, status\)/);
  assert.match(
    notifyBlock,
    /new CustomEvent\(ORDERBOOK_WORKER_STATUS_EVENT,[\s\S]*detail: \{ symbol, status \}/,
  );
  assert.match(notifyBlock, /this\.clients\.get\(id\)\?\._receiveStatus\(status\)/);
  assert.match(
    orderbook,
    /this\.#notifyAll\(\{ state: "stale", text: "СИНХРОНИЗАЦИЯ · последний кадр" \}\)/,
  );
});
