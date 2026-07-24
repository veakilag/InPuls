import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("./orderbook-worker.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("./orderbook.js", import.meta.url), "utf8");
const sw = await readFile(new URL("./sw.js", import.meta.url), "utf8");
const reset = await readFile(new URL("./reset-v26.html", import.meta.url), "utf8");

test("files keep correct identities", () => {
  assert.match(worker, /^const MAX_BOOK_LEVELS_PER_SIDE/);
  assert.match(runtime, /^export function applyDepthUpdates/);
  assert.match(sw, /^const CACHE/);
  assert.match(reset, /^<!doctype html>/);
});

test("long background sleep forces a clean staggered Worker restart", () => {
  assert.match(worker, /MAX_RESUME_TAPE_SNAPSHOT = 80/);
  assert.match(worker, /MAX_EMITTED_LEVELS_PER_SIDE = 4_000/);
  assert.match(runtime, /ORDERBOOK_BACKGROUND_HARD_RESTART_MS = 15_000/);
  assert.match(runtime, /this\.#restart\(`Возврат из фона/);
  assert.match(runtime, /index \* ORDERBOOK_RESUBSCRIBE_STAGGER_MS/);
});
