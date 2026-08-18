(() => {
  "use strict";

  // Runtime recovery is strictly scoped to stale PWA/runtime state. It must
  // never mutate product layout, charts, market data, timers, or workspace
  // panels. Retired Event Radar is cleaned separately without touching the
  // current scanner/activity surface.
  const APP_BUILD = "26-126-final-exchanges-v1";
  const RECOVERY_REVISION = "26-126-runtime-recovery-v5";
  const STORAGE_KEY = "inpuls-runtime-boot-build-v1";
  const REVISION_KEY = "inpuls-runtime-recovery-revision-v1";
  const SESSION_KEY = `inpuls-runtime-recovery:${RECOVERY_REVISION}`;
  const WATCHDOG_ATTEMPT_KEY = `inpuls-runtime-watchdog-attempt:${RECOVERY_REVISION}`;
  const WATCHDOG_DELAY_MS = 8_000;
  const url = new URL(window.location.href);
  const appScope = new URL("./", url);

  function read(storage, key) {
    try { return storage.getItem(key); } catch { return null; }
  }
  function write(storage, key, value) {
    try { storage.setItem(key, value); } catch {}
  }
  function remove(storage, key) {
    try { storage.removeItem(key); } catch {}
  }
  function isInPulsRegistration(registration) {
    try {
      const scope = new URL(registration.scope);
      return scope.origin === appScope.origin && scope.pathname === appScope.pathname;
    } catch { return false; }
  }

  // Event Radar is retired. Do not touch the live scanner/activity workspace.
  // This guard only removes the obsolete Event Radar nodes/module and its CSS.
  function installRetiredEventRadarCleanup() {
    const cleanup = () => {
      document.querySelector("#event-radar-beta")?.remove();
      document.querySelector("#event-radar-beta-toggle")?.remove();
      document.querySelectorAll('script[src*="event-radar-beta.js"], link[href*="event-radar-beta.css"]').forEach((node) => node.remove());
    };

    cleanup();
    if (!document.body || typeof MutationObserver !== "function") return;
    const observer = new MutationObserver(cleanup);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
  }

  function cleanRecoveryQuery() {
    if (!["_inpuls_recovery", "_inpuls_reload", "_inpuls_reason"].some((key) => url.searchParams.has(key))) return;
    ["_inpuls_recovery", "_inpuls_reload", "_inpuls_reason"].forEach((key) => url.searchParams.delete(key));
    history.replaceState(history.state, "", url);
  }
  function isRuntimeHealthy() {
    const clockText = document.querySelector("#clock")?.textContent?.trim() ?? "";
    return /^\d{2}:\d{2}:\d{2}$/.test(clockText);
  }
  function showRecoveryState(message, allowManualRetry = false) {
    const status = document.querySelector("#connection-status");
    const statusText = document.querySelector("#connection-text");
    if (!status || !statusText) return;
    status.dataset.status = "error";
    statusText.textContent = message;
    status.title = allowManualRetry ? "Нажми, чтобы повторить безопасный перезапуск InPuls" : message;
    if (!allowManualRetry || status.dataset.recoveryRetryBound === "true") return;
    status.dataset.recoveryRetryBound = "true";
    status.style.cursor = "pointer";
    status.addEventListener("click", () => {
      remove(sessionStorage, SESSION_KEY);
      remove(sessionStorage, WATCHDOG_ATTEMPT_KEY);
      performScopedRecovery("manual", true);
    }, { once: true });
  }
  async function clearScopedRuntime() {
    const unregister = "serviceWorker" in navigator
      ? navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(
          registrations.filter(isInPulsRegistration).map((registration) => registration.unregister()),
        )).catch(() => [])
      : Promise.resolve([]);
    const clearCaches = "caches" in window
      ? caches.keys()
        .then((keys) => Promise.all(keys.filter((key) => key.startsWith("inpuls-")).map((key) => caches.delete(key))))
        .catch(() => [])
      : Promise.resolve([]);
    await Promise.allSettled([unregister, clearCaches]);
  }
  function performScopedRecovery(reason, force = false) {
    const sessionState = read(sessionStorage, SESSION_KEY);
    if (sessionState === "running" || (!force && sessionState === "done")) return;
    write(sessionStorage, SESSION_KEY, "running");
    showRecoveryState("Восстанавливаю запуск…");
    clearScopedRuntime().finally(() => {
      write(localStorage, STORAGE_KEY, APP_BUILD);
      write(localStorage, REVISION_KEY, RECOVERY_REVISION);
      write(sessionStorage, SESSION_KEY, "done");
      url.searchParams.set("_inpuls_recovery", RECOVERY_REVISION);
      url.searchParams.set("_inpuls_reason", reason);
      url.searchParams.set("_inpuls_reload", String(Date.now()));
      window.location.replace(url.href);
    });
  }
  function scheduleRuntimeWatchdog() {
    window.setTimeout(() => {
      if (isRuntimeHealthy()) {
        write(localStorage, STORAGE_KEY, APP_BUILD);
        write(localStorage, REVISION_KEY, RECOVERY_REVISION);
        cleanRecoveryQuery();
        return;
      }
      if (read(sessionStorage, WATCHDOG_ATTEMPT_KEY) === "done") {
        showRecoveryState("Ошибка запуска · нажми сюда", true);
        return;
      }
      write(sessionStorage, WATCHDOG_ATTEMPT_KEY, "done");
      remove(sessionStorage, SESSION_KEY);
      performScopedRecovery("watchdog", true);
    }, WATCHDOG_DELAY_MS);
  }

  installRetiredEventRadarCleanup();

  const needsRevisionRecovery = read(localStorage, STORAGE_KEY) !== APP_BUILD
    || read(localStorage, REVISION_KEY) !== RECOVERY_REVISION;
  if (needsRevisionRecovery && read(sessionStorage, SESSION_KEY) !== "done") {
    performScopedRecovery("revision");
    return;
  }
  cleanRecoveryQuery();
  scheduleRuntimeWatchdog();
})();
