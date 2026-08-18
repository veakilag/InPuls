import assert from "node:assert/strict";
import fs from "node:fs";

const boot = fs.readFileSync(new URL("./runtime-boot-recovery.js", import.meta.url), "utf8");

assert.ok(boot.includes("serviceWorker"));
assert.ok(boot.includes("caches.keys"));
assert.ok(boot.includes("isInPulsRegistration"));
assert.ok(boot.includes("isRuntimeHealthy"));

// Runtime recovery must never disable the primary chart or replace market networking.
assert.ok(!boot.includes("installLiteShell"));
assert.ok(!boot.includes("installPrimaryChartNetworkGate"));
assert.ok(!boot.includes("installPrimaryChartSocketGate"));
assert.ok(!boot.includes("installRenderPacing"));
assert.ok(!boot.includes("primaryChart: false"));
assert.ok(!boot.includes("primary.hidden = true"));
assert.ok(!boot.includes("window.fetch ="));
assert.ok(!boot.includes("window.WebSocket ="));
assert.ok(boot.includes('const APP_BUILD = "26-126-final-exchanges-v1"'));

console.log("runtime boot chart safety contract passed");
