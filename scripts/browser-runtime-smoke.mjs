import { spawn } from "node:child_process";

const targetUrl = process.argv[2];
if (!targetUrl) throw new Error("Usage: node scripts/browser-runtime-smoke.mjs <url>");

const target = new URL(targetUrl);
const requireLiteShell = ["127.0.0.1", "localhost"].includes(target.hostname);
const chromeBinary = process.env.CHROME_BIN || "google-chrome";
const port = 9222 + Math.floor(Math.random() * 500);
const profile = `/tmp/inpuls-chrome-${process.pid}`;
const chrome = spawn(chromeBinary, [
  "--headless",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--remote-debugging-address=127.0.0.1",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let chromeStderr = "";
chrome.stderr.on("data", (chunk) => { chromeStderr += chunk.toString(); });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function waitForDebugger() {
  let lastError;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return await fetchJson(`http://127.0.0.1:${port}/json/version`);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw lastError || new Error("Chrome DevTools endpoint did not start");
}

const messages = [];
const exceptions = [];
const failedRequests = [];
let sequence = 0;
const pending = new Map();

function connectCdp(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    socket.addEventListener("open", () => resolve(socket));
    socket.addEventListener("error", reject);
  });
}

function send(socket, method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10_000);
  });
}

async function readState(socket) {
  const evaluation = await send(socket, "Runtime.evaluate", {
    expression: `(() => ({
      href: location.href,
      title: document.title,
      clock: document.querySelector('#clock')?.textContent?.trim() ?? null,
      status: document.querySelector('#connection-text')?.textContent?.trim() ?? null,
      statusState: document.querySelector('#connection-status')?.dataset?.status ?? null,
      marketRows: document.querySelectorAll('#market-body tr').length,
      topRows: document.querySelectorAll('#top-list .top-row, #top-list [data-symbol]').length,
      inplayText: document.querySelector('#inplay-coins')?.textContent?.trim() ?? null,
      appBuild: document.querySelector('meta[name="inpuls-build"]')?.content ?? null,
      serviceWorker: navigator.serviceWorker?.controller?.scriptURL ?? null,
      liteMode: globalThis.__INPULS_LITE_MODE__?.revision ?? null,
      primaryHidden: document.querySelector('.primary-chart')?.hidden ?? null,
      activityHidden: document.querySelector('.workspace-panel')?.hidden ?? null,
      eventRadarTogglePresent: Boolean(document.querySelector('#event-radar-beta-toggle')),
      eventRadarPanelPresent: Boolean(document.querySelector('#event-radar-beta')),
    }))()`,
    returnByValue: true,
  });
  return evaluation.result?.value ?? null;
}

function runtimeStarted(state) {
  const baseReady = /^\d{2}:\d{2}:\d{2}$/.test(state?.clock || "")
    && state?.statusState === "online"
    && Number(state?.topRows || 0) > 0;
  if (!baseReady || !requireLiteShell) return baseReady;
  return Boolean(state?.liteMode)
    && state?.primaryHidden === true
    && state?.activityHidden === true
    && state?.eventRadarTogglePresent === false
    && state?.eventRadarPanelPresent === false
    && Number(state?.marketRows || 0) === 0;
}

async function waitForRuntime(socket, timeoutMs) {
  const startedAt = Date.now();
  let state = null;
  while (Date.now() - startedAt < timeoutMs) {
    state = await readState(socket);
    if (runtimeStarted(state)) {
      return { state, readyAfterMs: Date.now() - startedAt };
    }
    await delay(250);
  }
  return { state, readyAfterMs: null };
}

try {
  await waitForDebugger();
  const page = await fetchJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, { method: "PUT" });
  const socket = await connectCdp(page.webSocketDebuggerUrl);

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const waiter = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) waiter.reject(new Error(`${waiter.method}: ${payload.error.message}`));
      else waiter.resolve(payload.result);
      return;
    }
    if (payload.method === "Runtime.consoleAPICalled") {
      messages.push({
        type: payload.params.type,
        text: payload.params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") || "",
      });
    }
    if (payload.method === "Runtime.exceptionThrown") {
      exceptions.push({
        text: payload.params.exceptionDetails?.text || "Exception",
        description: payload.params.exceptionDetails?.exception?.description || "",
        url: payload.params.exceptionDetails?.url || "",
        line: payload.params.exceptionDetails?.lineNumber ?? null,
        column: payload.params.exceptionDetails?.columnNumber ?? null,
      });
    }
    if (payload.method === "Network.loadingFailed") {
      failedRequests.push({
        errorText: payload.params.errorText,
        type: payload.params.type,
        canceled: payload.params.canceled === true,
        blockedReason: payload.params.blockedReason || null,
      });
    }
  });

  await Promise.all([
    send(socket, "Runtime.enable"),
    send(socket, "Page.enable"),
    send(socket, "Network.enable"),
  ]);

  const first = await waitForRuntime(socket, 15_000);

  await send(socket, "Page.reload", { ignoreCache: false });
  const reload = await waitForRuntime(socket, 12_000);

  console.log(JSON.stringify({
    targetUrl,
    requireLiteShell,
    firstState: first.state,
    firstReadyAfterMs: first.readyAfterMs,
    reloadState: reload.state,
    reloadReadyAfterMs: reload.readyAfterMs,
    exceptions,
    failedRequests,
    messages,
  }, null, 2));

  if (!runtimeStarted(first.state) || !runtimeStarted(reload.state) || exceptions.length) {
    process.exitCode = 1;
  }
  socket.close();
} catch (error) {
  console.error(error?.stack || error);
  if (chromeStderr) console.error(chromeStderr.slice(-12_000));
  process.exitCode = 1;
} finally {
  chrome.kill("SIGTERM");
}
