(() => {
  "use strict";

  const APP_BUILD = "26-96-independent-tape-chart-lanes-v1";
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

  function hasVisibleUserChartForKlineUrl(value) {
    try {
      const socketUrl = new URL(String(value));
      const stream = decodeURIComponent(socketUrl.pathname).split("/").at(-1) || "";
      const match = stream.match(/^([a-z0-9]+)@kline_/i);
      if (!match) return false;
      const symbol = match[1].toUpperCase();
      return [...document.querySelectorAll(".secondary-chart")].some((panel) => {
        if (!isElementVisible(panel)) return false;
        const label = panel.querySelector("h2")?.textContent?.replace(/[^A-Z0-9]/gi, "").toUpperCase() || "";
        return label.startsWith(symbol);
      });
    } catch {
      return false;
    }
  }

  function installPrimaryChartSocketGate() {
    if (typeof window.WebSocket !== "function" || typeof window.EventTarget !== "function") return;
    const NativeWebSocket = window.WebSocket;

    class InPulsLiteWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(socketUrl, protocols) {
        super();
        const value = String(socketUrl);
        const isKline = value.includes("@kline_");
        if (!isKline || hasVisibleUserChartForKlineUrl(value)) {
          return protocols === undefined
            ? new NativeWebSocket(socketUrl)
            : new NativeWebSocket(socketUrl, protocols);
        }

        this.url = value;
        this.readyState = InPulsLiteWebSocket.CONNECTING;
        this.bufferedAmount = 0;
        this.extensions = "";
        this.protocol = "";
        this.binaryType = "blob";
        queueMicrotask(() => {
          if (this.readyState !== InPulsLiteWebSocket.CONNECTING) return;
          this.readyState = InPulsLiteWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        });
      }

      send() {}

      close() {
        if (this.readyState === InPulsLiteWebSocket.CLOSED) return;
        this.readyState = InPulsLiteWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close", { code: 1000, reason: "lite-shell" }));
      }
    }

    Object.defineProperty(InPulsLiteWebSocket, "name", {
      value: "WebSocket",
      configurable: true,
    });
    window.WebSocket = InPulsLiteWebSocket;
  }

  function installRenderLaneIsolation() {
    const revision = "26-96-independent-tape-chart-lanes-v1";
    if (globalThis.__INPULS_RENDER_LANES__?.revision === revision) return;
    if (typeof window.requestAnimationFrame !== "function"
      || typeof window.cancelAnimationFrame !== "function") return;

    const nativeRequestFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelFrame = window.cancelAnimationFrame.bind(window);
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeNow = () => performance.now();
    const chartQueue = [];
    const flowQueue = [];
    const tasks = new Map();
    const stats = {
      chartFrames: 0,
      chartCallbacks: 0,
      chartMaxFrameMs: 0,
      flowFrames: 0,
      flowCallbacks: 0,
      flowMaxTaskMs: 0,
      cancelled: 0,
    };
    const CHART_BUDGET_MS = 7;
    const CHART_MAX_PER_FRAME = 2;
    const FLOW_BUDGET_MS = 4;
    const FLOW_MAX_PER_TASK = 1;
    let nextVirtualHandle = -1;
    let chartFrame = 0;
    let flowFrame = 0;
    let flowTaskPending = false;
    let pendingFlowTimestamp = 0;
    let pendingFlowFlush = null;

    const channel = typeof MessageChannel === "function" ? new MessageChannel() : null;
    if (channel) {
      channel.port1.onmessage = () => {
        const flush = pendingFlowFlush;
        pendingFlowFlush = null;
        flowTaskPending = false;
        flush?.();
      };
    }

    function classifyRenderLane(callback) {
      if (typeof callback !== "function") return null;
      const name = String(callback.name || "");
      let body = "";
      try { body = Function.prototype.toString.call(callback); } catch {}

      if (
        name === "runTapeDrawFrame"
        || name === "drainTapeIngest"
        || (name === "runDrawFrame" && body.includes("dirtyCards"))
      ) return "flow";

      if (
        body.includes("this.renderFrame = null")
        && body.includes("this.render()")
      ) return "chart";

      return null;
    }

    function takeNext(queue, lane) {
      while (queue.length) {
        const handle = queue.shift();
        const task = tasks.get(handle);
        if (!task || task.lane !== lane) continue;
        tasks.delete(handle);
        return task;
      }
      return null;
    }

    function pendingIn(queue, lane) {
      return queue.some((handle) => tasks.get(handle)?.lane === lane);
    }

    function invoke(task, timestamp) {
      try {
        task.callback(timestamp);
      } catch (error) {
        nativeSetTimeout(() => { throw error; }, 0);
      }
    }

    function ensureChartFrame() {
      if (chartFrame || !pendingIn(chartQueue, "chart")) return;
      chartFrame = nativeRequestFrame((timestamp) => {
        chartFrame = 0;
        const startedAt = nativeNow();
        let processed = 0;
        while (processed < CHART_MAX_PER_FRAME) {
          const task = takeNext(chartQueue, "chart");
          if (!task) break;
          invoke(task, timestamp);
          processed += 1;
          if (nativeNow() - startedAt >= CHART_BUDGET_MS) break;
        }
        const duration = nativeNow() - startedAt;
        stats.chartFrames += 1;
        stats.chartCallbacks += processed;
        stats.chartMaxFrameMs = Math.max(stats.chartMaxFrameMs, duration);
        ensureChartFrame();
      });
    }

    function flushFlowLane(timestamp) {
      const startedAt = nativeNow();
      let processed = 0;
      while (processed < FLOW_MAX_PER_TASK) {
        const task = takeNext(flowQueue, "flow");
        if (!task) break;
        invoke(task, timestamp);
        processed += 1;
        if (nativeNow() - startedAt >= FLOW_BUDGET_MS) break;
      }
      const duration = nativeNow() - startedAt;
      stats.flowFrames += 1;
      stats.flowCallbacks += processed;
      stats.flowMaxTaskMs = Math.max(stats.flowMaxTaskMs, duration);
      ensureFlowFrame();
    }

    function queuePostPaintFlow(timestamp) {
      pendingFlowTimestamp = timestamp;
      if (flowTaskPending) return;
      flowTaskPending = true;
      const flush = () => flushFlowLane(pendingFlowTimestamp || nativeNow());
      if (channel) {
        pendingFlowFlush = flush;
        channel.port2.postMessage(0);
      } else {
        nativeSetTimeout(() => {
          flowTaskPending = false;
          flush();
        }, 0);
      }
    }

    function ensureFlowFrame() {
      if (flowFrame || flowTaskPending || !pendingIn(flowQueue, "flow")) return;
      flowFrame = nativeRequestFrame((timestamp) => {
        flowFrame = 0;
        queuePostPaintFlow(timestamp);
      });
    }

    window.requestAnimationFrame = function inpulsLaneRequestAnimationFrame(callback) {
      const lane = classifyRenderLane(callback);
      if (!lane) return nativeRequestFrame(callback);
      const handle = nextVirtualHandle--;
      tasks.set(handle, { handle, lane, callback });
      if (lane === "chart") {
        chartQueue.push(handle);
        ensureChartFrame();
      } else {
        flowQueue.push(handle);
        ensureFlowFrame();
      }
      return handle;
    };

    window.cancelAnimationFrame = function inpulsLaneCancelAnimationFrame(handle) {
      if (Number(handle) < 0 && tasks.delete(handle)) {
        stats.cancelled += 1;
        return;
      }
      nativeCancelFrame(handle);
    };

    globalThis.__INPULS_RENDER_LANES__ = {
      revision,
      chart: Object.freeze({ budgetMs: CHART_BUDGET_MS, maxPerFrame: CHART_MAX_PER_FRAME }),
      flow: Object.freeze({ budgetMs: FLOW_BUDGET_MS, maxPerTask: FLOW_MAX_PER_TASK, phase: "post-paint" }),
      stats,
      pending() {
        return {
          chart: [...tasks.values()].filter((task) => task.lane === "chart").length,
          flow: [...tasks.values()].filter((task) => task.lane === "flow").length,
        };
      },
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
    installPrimaryChartSocketGate();
    installRenderLaneIsolation();
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
