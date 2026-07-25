import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("./orderbook-worker.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("./orderbook.js", import.meta.url), "utf8");
const sw = await readFile(new URL("./sw.js", import.meta.url), "utf8");
const reset = await readFile(new URL("./reset-v26.html", import.meta.url), "utf8");

test("files keep correct identities", () => {
  assert.match(worker, /const MAX_BOOK_LEVELS_PER_SIDE = 20_000/);
  assert.match(runtime, /^export function applyDepthUpdates/);
  assert.match(sw, /^const CACHE/);
  assert.match(reset, /^<!doctype html>/);
});

test("background return reuses Worker with guarded staggered recovery", () => {
  assert.match(worker, /MAX_RESUME_TAPE_SNAPSHOT = 80/);
  assert.match(worker, /MAX_EMITTED_LEVELS_PER_SIDE = 4_000/);
  assert.doesNotMatch(runtime, /ORDERBOOK_BACKGROUND_HARD_RESTART_MS/);
  assert.match(runtime, /ORDERBOOK_RESUME_PROBE_MS = 3_500/);
  assert.match(runtime, /Worker не проснулся после фона/);
  assert.match(runtime, /this\.worker\.postMessage\(this\.#visibilityPayload\(true\)\)/);
  assert.match(runtime, /index \* ORDERBOOK_RESUBSCRIBE_STAGGER_MS/);
});
