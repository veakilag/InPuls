import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createStaticServer } from "../server.js";

async function withServer(run) {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    await run(port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function rawRequest(port, path, method = "GET") {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, method, path }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: response.headers,
        status: response.statusCode,
      }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

test("static server rejects malformed URLs without terminating", async () => {
  await withServer(async (port) => {
    const malformed = await rawRequest(port, "/%E0%A4%A");
    assert.equal(malformed.status, 400);
    const healthy = await rawRequest(port, "/");
    assert.equal(healthy.status, 200);
    assert.match(healthy.body, /<!doctype html>/i);
  });
});

test("static server blocks private files and missing scripts", async () => {
  await withServer(async (port) => {
    assert.equal((await rawRequest(port, "/.git/config")).status, 404);
    assert.equal((await rawRequest(port, "/server.js")).status, 404);
    assert.equal((await rawRequest(port, "/test/ui.test.js")).status, 404);
    assert.equal((await rawRequest(port, "/missing.js")).status, 404);
    assert.equal((await rawRequest(port, "/workspace-route")).status, 200);
  });
});

test("static server sends browser security headers and limits methods", async () => {
  await withServer(async (port) => {
    const page = await rawRequest(port, "/");
    assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    assert.equal(page.headers["x-frame-options"], "DENY");
    assert.equal(page.headers["referrer-policy"], "no-referrer");
    const post = await rawRequest(port, "/", "POST");
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, "GET, HEAD");
  });
});

test("owner Signal Lab is served as a protected same-origin page", async () => {
  await withServer(async (port) => {
    const page = await rawRequest(port, "/owner-signal-lab.html");
    const guard = await rawRequest(port, "/owner-signal-lab-guard.js");
    const script = await rawRequest(port, "/owner-signal-lab.js");
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\/html/);
    assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.match(page.body, /noindex,nofollow,noarchive/);
    assert.match(page.body, /OWNER SIGNAL LAB/);
    assert.equal(guard.status, 200);
    assert.match(guard.headers["content-type"], /(?:text|application)\/javascript/);
    assert.match(guard.body, /owner-signal-lab-module-did-not-settle/);
    assert.equal(script.status, 200);
    assert.match(script.headers["content-type"], /(?:text|application)\/javascript/);
    assert.match(script.body, /SignalLabLocalStore/);
  });
});
