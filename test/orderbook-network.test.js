import test from "node:test";
import assert from "node:assert/strict";

await import("../orderbook-network.js?network-tests");

const { errorKind, firstSuccessful } = globalThis.InPulsOrderBookNetwork;

test("a fast primary REST host prevents backup requests from starting", async () => {
  const launched = [];
  const events = [];
  const result = await firstSuccessful(
    ["primary", "backup-1", "backup-2"],
    async (host) => {
      launched.push(host);
      return { host };
    },
    {
      delaysMs: [0, 50, 100],
      onAttempt: (event) => events.push(event),
    },
  );

  assert.equal(result.target, "primary");
  assert.deepEqual(launched, ["primary"]);
  assert.deepEqual(
    events.map(({ target, state }) => `${target}:${state}`),
    ["primary:started", "primary:succeeded"],
  );
});

test("a failed primary starts a delayed backup and preserves failure diagnostics", async () => {
  const launched = [];
  const events = [];
  const result = await firstSuccessful(
    ["primary", "backup-1", "backup-2"],
    async (host) => {
      launched.push(host);
      if (host === "primary") throw new TypeError("Failed to fetch");
      return { host };
    },
    {
      delaysMs: [0, 5, 50],
      onAttempt: (event) => events.push(event),
    },
  );

  assert.equal(result.target, "backup-1");
  assert.deepEqual(launched, ["primary", "backup-1"]);
  assert.equal(events.find((event) => event.target === "primary" && event.state === "failed")?.errorKind, "network-or-cors");
  assert.equal(events.some((event) => event.target === "backup-2" && event.state === "started"), false);
});

test("the winning REST response aborts requests that are still in flight", async () => {
  let primaryAborted = false;
  const result = await firstSuccessful(
    ["primary", "backup"],
    (host, { signal }) => {
      if (host === "backup") return Promise.resolve("ok");
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          primaryAborted = true;
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    { delaysMs: [0, 1] },
  );

  assert.equal(result.target, "backup");
  assert.equal(primaryAborted, true);
});

test("network errors are classified without claiming that CORS is proven", () => {
  assert.equal(errorKind(new Error("timeout")), "timeout");
  assert.equal(errorKind(new Error("HTTP 429")), "http");
  assert.equal(errorKind(new TypeError("Failed to fetch")), "network-or-cors");
  assert.equal(errorKind(new Error("invalid snapshot")), "invalid");
});
