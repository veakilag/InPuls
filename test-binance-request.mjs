import test from "node:test";
import assert from "node:assert/strict";

import {
  createBinanceRequestScheduler,
  fetchBinanceJson,
} from "./binance-request.js";

const immediateScheduler = (task) => task();

test("shared scheduler serializes requests and enforces the minimum interval", async () => {
  let now = 0;
  const sleeps = [];
  const starts = [];
  const scheduler = createBinanceRequestScheduler({
    minIntervalMs: 500,
    nowImpl: () => now,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });

  const [first, second] = await Promise.all([
    scheduler(async () => { starts.push(now); return "first"; }),
    scheduler(async () => { starts.push(now); return "second"; }),
  ]);

  assert.deepEqual([first, second], ["first", "second"]);
  assert.deepEqual(starts, [0, 500]);
  assert.deepEqual(sleeps, [500]);
});

test("429 honors Retry-After and then retries", async () => {
  const sleeps = [];
  const responses = [
    {
      ok: false,
      status: 429,
      headers: { get: (name) => name.toLowerCase() === "retry-after" ? "2" : null },
      text: async () => "rate limited",
    },
    { ok: true, status: 200, json: async () => ({ ok: true }) },
  ];

  const result = await fetchBinanceJson("https://example.test", {
    fetchImpl: async () => responses.shift(),
    requestScheduler: immediateScheduler,
    sleepImpl: async (ms) => sleeps.push(ms),
    randomImpl: () => 0.5,
    maxRetries: 1,
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(sleeps, [2_000]);
});

test("restricted-location errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(() => fetchBinanceJson("https://example.test", {
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 451, text: async () => "restricted" };
    },
    requestScheduler: immediateScheduler,
    sleepImpl: async () => assert.fail("451 must not sleep or retry"),
  }), /451.*restricted/);
  assert.equal(calls, 1);
});
