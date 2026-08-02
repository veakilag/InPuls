(() => {
  "use strict";

  const APP_BUILD = "26-95-lite-shell-pr90-speed-v1";
  const RECOVERY_REVISION = "26-93-runtime-self-heal-v1";
  const LITE_MODE_REVISION = "26-95-lite-shell-pr90-speed-v1";
  const STORAGE_KEY = "inpuls-runtime-boot-build-v1";
  const REVISION_KEY = "inpuls-runtime-recovery-revision-v1";
  const SESSION_KEY = `inpuls-runtime-recovery:${RECOVERY_REVISION}`;
  const WATCHDOG_ATTEMPT_KEY = `inpuls-runtime-watchdog-attempt:${RECOVERY_REVISION}`;
  const SETTINGS_KEY = "inpuls-settings-v1";
  const WORKSPACE_KEY = "inpuls-workspace-v4";
  const CHART_KEY = "inpuls-chart-v2";
  const WATCHDOG_DELAY_MS = 8_000;
  const LIVE_RENDER_DELAY_MS = 500;
  const PERIODIC_RENDER_DELAY_MS = 1_500;
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

  function readJson(storage, key, fallback = {}) {
    try {
      const value = JSON.parse(storage.getItem(key));
      return value && typeof value === "object" && !Array.isArray(value) ? value : { ...fallback };
    } catch {
      return { ...fallback };
    }
  }

  function writeJson(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function isElementVisible(element) {
    return Boolean(element && !element.hidden && element.getClientRects().length);
  }

  function hasVisibleUserChart() {
    return [...document.querySelectorAll(".secondary-chart")].some(isElementVisible);
  }

  function isPrimaryChartHistoryRequest(input) {
    try {
      const requestUrl = new URL(typeof input === "string" ? input : input?.url, window.location.href);
      if (requestUrl.hostname !== "fapi.binance.com") return false;
      if (requestUrl.pathname !== "/fapi/v1/klines") return false;
      const limit = Number(requestUrl.searchParams.get("limit"));
      return !hasVisibleUserChart() && (limit === 120 || limit === 1500);
    } catch {
      return false;
    }
  }

  function installPrimaryChartNetworkGate() {
    if (typeof window.fetch !== "function") return;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function inpulsLiteFetch(input, init) {
      if (isPrimaryChartHistoryRequest(input)) {
        return Promise.resolve(new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      return nativeFetch(input, init);
    };
  }

  function installRenderPacing() {
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeSetInterval = window.setInterval.bind(window);
    let marketRenderCount = 0;

    window.setTimeout = function inpulsLiteTimeout(callback, delay, ...args) {
      let nextDelay = Number(delay) || 0;
      if (
        nextDelay === 180
        && typeof callback === "function"
        && String(callback).includes("scheduledMarketRender = null")
      ) {
        nextDelay = marketRenderCount++ === 0 ? 0 : LIVE_RENDER_DELAY_MS;
      }
      return nativeSetTimeout(callback, nextDelay, ...args);
    };

    window.setInterval = function inpulsLiteInterval(callback, delay, ...args) {
      let nextDelay = Number(delay) || 0;
      if (callback?.name === "render" && nextDelay === 1_000) {
        nextDelay = PERIODIC_RENDER_DELAY_MS;
      }
      return nativeSetInterval(callback, nextDelay, ...args);
    };
  }

  function persistLiteWorkspace() {
    const settings = readJson(localStorage, SETTINGS_KEY);
    settings.maxRows = 0;
    writeJson(localStorage, SETTINGS_KEY, settings);

    const workspace = readJson(localStorage, WORKSPACE_KEY);
    workspace.primary = {
      ...(workspace.primary && typeof workspace.primary === "object" ? workspace.primary : {}),
      id: "primary",
      type: "chart",
      hidden: true,
    };
    workspace.scanner = {
      ...(workspace.scanner && typeof workspace.scanner === "object" ? workspace.scanner : {}),
      id: "scanner",
      type: "scanner",
      hidden: true,
    };
    workspace.radar = {
      ...(workspace.radar && typeof workspace.radar === "object" ? workspace.radar : {}),
      id: "radar",
      type: "radar",
      hidden: false,
    };
    if (!Array.isArray(workspace.extras)) workspace.extras = [];
    writeJson(localStorage, WORKSPACE_KEY, workspace);

    writeJson(localStorage, CHART_KEY, { interval: "1m", range: "1h" });
  }

  function enforceLiteShellDom() {
    document.documentElement.dataset.inpulsShell = "lite";
    document.body.dataset.mobileView = "radar";

    document.querySelector("#event-radar-beta-toggle")?.remove();

    const primary = document.querySelector(".primary-chart");
    const activity = document.querySelector(".workspace-panel");
    if (primary) primary.hidden = true;
    if (activity) activity.hidden = true;

    document.querySelectorAll(
      '[data-restore-panel="primary"], [data-restore-panel="scanner"], [data-mobile-view="chart"], [data-mobile-view="activity"]',
    ).forEach((element) => element.remove());

    const radarButton = document.querySelector('[data-mobile-view="radar"]');
    radarButton?.classList.add("is-active");

    document.querySelector("#event-radar-beta")?.remove();
  }

  function installLiteShell() {
    globalThis.__INPULS_LITE_MODE__ = Object.freeze({
      revision: LITE_MODE_REVISION,
      primaryChart: false,
      activityTable: false,
      eventRadarBeta: false,
    });
    persistLiteWorkspace();
    enforceLiteShellDom();
    installPrimaryChartNetworkGate();
    installRenderPacing();

    const observer = new MutationObserver(() => {
      document.querySelector("#event-radar-beta")?.remove();
      const primary = document.querySelector(".primary-chart");
      const activity = document.querySelector(".workspace-panel");
      if (primary) primary.hidden = true;
      if (activity) activity.hidden = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("load", () => {
      enforceLiteShellDom();
      window.setTimeout(() => {
        enforceLiteShellDom();
        observer.disconnect();
      }, 1_000);
    }, { once: true });
  }

  function isInPulsRegistration(registration) {
    try {
      const scope = new URL(registration.scope);
      return scope.origin === appScope.origin && scope.pathname === appScope.pathname;
    } catch {
      return false;
    }
  }

  function cleanRecoveryQuery() {
    const hadRecovery = url.searchParams.has("_inpuls_recovery")
      || url.searchParams.has("_inpuls_reload")
      || url.searchParams.has("_inpuls_reason");
    if (!hadRecovery) return;
    url.searchParams.delete("_inpuls_recovery");
    url.searchParams.delete("_inpuls_reload");
    url.searchParams.delete("_inpuls_reason");
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
          registrations
            .filter(isInPulsRegistration)
            .map((registration) => registration.unregister()),
        ))
        .catch(() => [])
      : Promise.resolve([]);

    const clearCaches = "caches" in window
      ? caches.keys()
        .then((keys) => Promise.all(
          keys.filter((key) => key.startsWith("inpuls-")).map((key) => caches.delete(key)),
        ))
        .catch(() => [])
      : Promise.resolve([]);

    await Promise.allSettled([unregister, clearCaches]);
  }

  function performScopedRecovery(reason, force = false) {
    const sessionState = read(sessionStorage, SESSION_KEY);
    if (sessionState === "running") return;
    if (!force && sessionState === "done") return;

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

  installLiteShell();

  const needsRevisionRecovery = read(localStorage, STORAGE_KEY) !== APP_BUILD
    || read(localStorage, REVISION_KEY) !== RECOVERY_REVISION;

  if (needsRevisionRecovery && read(sessionStorage, SESSION_KEY) !== "done") {
    performScopedRecovery("revision");
    return;
  }

  cleanRecoveryQuery();
  scheduleRuntimeWatchdog();
})();
