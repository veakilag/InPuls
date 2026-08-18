(() => {
  "use strict";

  // Runtime recovery is scoped to stale PWA/runtime state only. It must never
  // mutate charts, market data, timers, or workspace state.
  const APP_BUILD = "26-126-final-exchanges-v1";
  const RECOVERY_REVISION = "26-128-binance-kline-market-ws-v1";
  const STORAGE_KEY = "inpuls-runtime-boot-build-v1";
  const REVISION_KEY = "inpuls-runtime-recovery-revision-v1";
  const SESSION_KEY = `inpuls-runtime-recovery:${RECOVERY_REVISION}`;
  const WATCHDOG_ATTEMPT_KEY = `inpuls-runtime-watchdog-attempt:${RECOVERY_REVISION}`;
  const WATCHDOG_DELAY_MS = 8_000;
  const RETIRED_SURFACE_DELAY_MS = 1_200;
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

  // Binance moved regular Futures market streams (including kline and aggTrade)
  // from the legacy /ws route to /market/ws in April 2026. The legacy route can
  // still complete the WebSocket handshake but stay silent. Keep old chart/feed
  // modules working until their direct endpoint is migrated by routing only this
  // exact Futures legacy path. Public /public and already-correct /market routes
  // are intentionally untouched.
  function installBinanceFuturesMarketRoute() {
    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket !== "function" || NativeWebSocket.__inpulsMarketRoute) return;

    class InPulsWebSocket extends NativeWebSocket {
      constructor(socketUrl, protocols) {
        let routedUrl = socketUrl;
        try {
          const candidate = new URL(String(socketUrl));
          if (
            candidate.protocol === "wss:"
            && candidate.hostname === "fstream.binance.com"
            && candidate.pathname.startsWith("/ws/")
          ) {
            candidate.pathname = `/market/ws/${candidate.pathname.slice("/ws/".length)}`;
            routedUrl = candidate.toString();
          }
        } catch {}
        if (protocols === undefined) super(routedUrl);
        else super(routedUrl, protocols);
      }
    }

    Object.defineProperty(InPulsWebSocket, "__inpulsMarketRoute", { value: true });
    window.WebSocket = InPulsWebSocket;
  }

  // Retired surfaces are removed only after the main application has had time
  // to bind its legacy DOM references. This preserves the data/radar/chart
  // runtime while keeping the obsolete UI out of the workspace.
  function cleanupRetiredSurfaces(root = document) {
    root.querySelector("#event-radar-beta")?.remove();
    root.querySelector("#event-radar-beta-toggle")?.remove();
    root.querySelector('[data-mobile-view="activity"]')?.remove();

    root.querySelector('.workspace-panel[data-panel-id="scanner"]')?.remove();
    root.querySelector('[data-restore-panel="scanner"]')?.remove();
    root.querySelector("#scanner-resizer")?.remove();
    root.querySelector("#scanner-resizer-nw")?.remove();

    root.querySelectorAll(
      'script[src*="event-radar-beta.js"], link[href*="event-radar-beta.css"]',
    ).forEach((node) => node.remove());
  }

  function installRetiredSurfaceCleanup() {
    const schedule = () => {
      window.setTimeout(() => cleanupRetiredSurfaces(document), RETIRED_SURFACE_DELAY_MS);
      if (typeof MutationObserver !== "function" || !document.body) return;
      const observer = new MutationObserver(() => cleanupRetiredSurfaces(document));
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule, { once: true });
    else schedule();
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

  installBinanceFuturesMarketRoute();
  installRetiredSurfaceCleanup();

  const needsRevisionRecovery = read(localStorage, STORAGE_KEY) !== APP_BUILD
    || read(localStorage, REVISION_KEY) !== RECOVERY_REVISION;
  if (needsRevisionRecovery && read(sessionStorage, SESSION_KEY) !== "done") {
    performScopedRecovery("revision");
    return;
  }
  cleanRecoveryQuery();
  scheduleRuntimeWatchdog();
})();