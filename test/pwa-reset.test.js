import test from "node:test";
import assert from "node:assert/strict";
import { clearInPulsRuntime, isInPulsRegistration } from "../pwa-reset.js";

const pageUrl = "https://example.com/inpuls/reset-v26.html";

function registration(scope, scriptURL, result = true) {
  let calls = 0;
  return {
    active: { scriptURL },
    scope,
    async unregister() {
      calls += 1;
      return result;
    },
    get calls() {
      return calls;
    },
  };
}

test("PWA reset recognizes only the InPuls worker at its exact scope", () => {
  assert.equal(isInPulsRegistration(
    registration("https://example.com/inpuls/", "https://example.com/inpuls/sw.js?v=old"),
    pageUrl,
  ), true);
  assert.equal(isInPulsRegistration(
    registration("https://example.com/", "https://example.com/sw.js"),
    pageUrl,
  ), false);
  assert.equal(isInPulsRegistration(
    registration("https://example.com/inpuls/", "https://example.com/other/sw.js"),
    pageUrl,
  ), false);
});

test("PWA reset leaves unrelated registrations and caches untouched", async () => {
  const owned = registration("https://example.com/inpuls/", "https://example.com/inpuls/sw.js?v=old");
  const unrelated = registration("https://example.com/other/", "https://example.com/other/sw.js");
  const deleted = [];
  const result = await clearInPulsRuntime({
    pageUrl,
    navigatorObject: {
      serviceWorker: {
        async getRegistrations() {
          return [owned, unrelated];
        },
      },
    },
    cacheStorage: {
      async keys() {
        return ["inpuls-old", "another-app-cache"];
      },
      async delete(key) {
        deleted.push(key);
        return true;
      },
    },
  });
  assert.deepEqual(result, { registrationsRemoved: 1, cachesRemoved: 1 });
  assert.equal(owned.calls, 1);
  assert.equal(unrelated.calls, 0);
  assert.deepEqual(deleted, ["inpuls-old"]);
});
