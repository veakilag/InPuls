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

test("resume is bounded and depth limits are expanded", () => {
  assert.match(worker, /MAX_RESUME_TAPE_SNAPSHOT = 420/);
  assert.match(worker, /RESUME_TAPE_WINDOW_MS = 75_000/);
  assert.match(worker, /MAX_EMITTED_LEVELS_PER_SIDE = 8_000/);
  assert.match(runtime, /TAPE_RESUME_MAX_PENDING = 500/);
});
