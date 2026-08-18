import assert from "node:assert/strict";
import fs from "node:fs";

const boot = fs.readFileSync(new URL("./runtime-boot-recovery.js", import.meta.url), "utf8");

assert.ok(boot.includes('const RECOVERY_REVISION = "26-126-runtime-recovery-v2"'));
assert.ok(boot.includes("WATCHDOG_DELAY_MS"));
assert.ok(boot.includes("scheduleRuntimeWatchdog"));
assert.ok(boot.includes('document.querySelector("#clock")'));
assert.ok(boot.includes("performScopedRecovery(\"watchdog\", true)"));
assert.ok(boot.includes("WATCHDOG_ATTEMPT_KEY"));
assert.ok(boot.includes('showRecoveryState("Ошибка запуска · нажми сюда", true)'));
assert.ok(boot.includes("isInPulsRegistration"));
assert.ok(boot.includes("scope.pathname === appScope.pathname"));
assert.ok(boot.includes('key.startsWith("inpuls-")'));
assert.ok(!boot.includes("localStorage.clear"));
assert.ok(!boot.includes("sessionStorage.clear"));
assert.ok(!boot.includes("indexedDB.deleteDatabase"));
assert.ok(!boot.includes("registrations.map((registration) => registration.unregister())"));
assert.ok(!boot.includes("__INPULS_LITE_MODE__"));
assert.ok(!boot.includes("window.fetch ="));
assert.ok(!boot.includes("window.WebSocket ="));
assert.ok(!boot.includes("window.setTimeout ="));
assert.ok(!boot.includes("window.setInterval ="));

console.log("runtime self-healing contracts passed");
