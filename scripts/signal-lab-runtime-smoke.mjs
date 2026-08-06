import { spawn } from "node:child_process";

const targetUrl = process.argv[2];
if (!targetUrl) {
  throw new Error("Usage: node scripts/signal-lab-runtime-smoke.mjs <url>");
}

const chromeBinary = process.env.CHROME_BIN || "google-chrome";
const port = 9600 + Math.floor(Math.random() * 300);
const profile = `/tmp/inpuls-signal-lab-chrome-${process.pid}`;
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let chromeStderr = "";
chrome.stderr.on("data", (chunk) => {
  chromeStderr += chunk.toString();
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function waitForDebugger() {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await fetchJson(`http://127.0.0.1:${port}/json/version`);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw lastError || new Error("Chrome DevTools endpoint did not start");
}

function connectCdp(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    socket.addEventListener("open", () => resolve(socket));
    socket.addEventListener("error", reject);
  });
}

let sequence = 0;
const pending = new Map();
function send(socket, method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15_000);
  });
}

const consoleMessages = [];
const exceptions = [];
const requestUrls = new Map();
const failedRequests = [];
const binanceResponses = [];

async function readState(socket) {
  const evaluation = await send(socket, "Runtime.evaluate", {
    expression: `(() => {
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
      const statusText = text('#collector-status') ?? '';
      const extremeMatch = statusText.match(/экстремумы\\s+(\\d+)\\s+активных\\s*\\/\\s*(\\d+)\\s+монет/i);
      const historyMatch = statusText.match(/история\\s+([A-Z_]+)\\s+(\\d+)/i);
      return {
        href: location.href,
        title: document.title,
        readyState: document.readyState,
        statusText,
        checks: Number(text('#checks-count') ?? 0),
        warmupLoaded: Number(text('#warmup-count') ?? 0),
        activeEpisodes: Number(text('#active-count') ?? 0),
        activeExtremes: Number(extremeMatch?.[1] ?? 0),
        extremeMaps: Number(extremeMatch?.[2] ?? 0),
        historyMode: historyMatch?.[1] ?? null,
        historyLoadedFromStatus: Number(historyMatch?.[2] ?? 0),
        candidateCards: document.querySelectorAll('.candidate-card').length,
        collectorPresent: Boolean(document.querySelector('#collector-status')),
      };
    })()`,
    returnByValue: true,
  });
  return evaluation.result?.result?.value ?? evaluation.result?.value ?? null;
}

function runtimeReady(state) {
  return Boolean(
    state?.collectorPresent
    && state?.readyState === "complete"
    && state?.statusText?.includes("LIVE")
    && Number(state?.checks || 0) > 0
    && Number(state?.warmupLoaded || 0) > 0
    && Number(state?.activeExtremes || 0) > 0
    && Number(state?.extremeMaps || 0) > 0
    && state?.historyMode !== "UNAVAILABLE"
  );
}

async function waitForRuntime(socket, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let state = null;
  const samples = [];
  while (Date.now() - startedAt < timeoutMs) {
    state = await readState(socket);
    if (!samples.length || Date.now() - samples.at(-1).at >= 5_000) {
      samples.push({
        at: Date.now(),
        checks: state?.checks ?? null,
        warmupLoaded: state?.warmupLoaded ?? null,
        activeExtremes: state?.activeExtremes ?? null,
        extremeMaps: state?.extremeMaps ?? null,
        historyMode: state?.historyMode ?? null,
        statusText: state?.statusText ?? null,
      });
    }
    if (runtimeReady(state)) {
      return { state, samples, readyAfterMs: Date.now() - startedAt };
    }
    await delay(500);
  }
  return { state, samples, readyAfterMs: null };
}

async function runEndpointProbes(socket) {
  const evaluation = await send(socket, "Runtime.evaluate", {
    expression: `(async () => {
      const probes = [
        ['futuresExchangeInfo', 'https://fapi.binance.com/fapi/v1/exchangeInfo'],
        ['spotExchangeInfo', 'https://data-api.binance.vision/api/v3/exchangeInfo'],
        ['spotBtc1m', 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=10'],
      ];
      const rows = [];
      for (const [name, url] of probes) {
        const startedAt = performance.now();
        try {
          const response = await fetch(url, { cache: 'no-store' });
          rows.push({
            name,
            url,
            ok: response.ok,
            status: response.status,
            type: response.type,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        } catch (error) {
          rows.push({
            name,
            url,
            ok: false,
            status: null,
            type: null,
            elapsedMs: Math.round(performance.now() - startedAt),
            error: String(error?.message ?? error),
          });
        }
      }
      return rows;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  return evaluation.result?.result?.value ?? evaluation.result?.value ?? [];
}


async function probeChartModal(socket) {
  const evaluation = await send(socket, "Runtime.evaluate", {
    expression: `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let button = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        button = document.querySelector('[data-field="chart-toggle"]');
        if (button) break;
        await wait(250);
      }
      if (!button) return { ok: false, reason: 'NO_CHART_BUTTON' };
      button.click();
      let root = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        root = document.querySelector('.signal-lab-chart-modal');
        if (root && !root.hidden && root.getAttribute('aria-hidden') === 'false') break;
        await wait(100);
      }
      const panel = root?.querySelector('.signal-lab-chart-modal__window');
      const canvas = root?.querySelector('[data-modal-canvas]');
      if (!root || !panel || !canvas || root.hidden) return { ok: false, reason: 'MODAL_DID_NOT_OPEN' };
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const before = panel.getBoundingClientRect();
      panel.style.width = '70vw';
      panel.style.height = '70vh';
      panel.style.transform = 'none';
      panel.style.left = '40px';
      panel.style.top = '40px';
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = panel.getBoundingClientRect();
      const timeframe = root.querySelector('[data-modal-timeframe="5m"]');
      timeframe?.click();
      await wait(120);
      const timeframeActive = timeframe?.classList.contains('is-active') === true;
      root.querySelector('[data-modal-close]')?.click();
      await wait(50);
      const closed = root.hidden && root.getAttribute('aria-hidden') === 'true';
      const resized = Math.abs(after.width - before.width) > 20 || Math.abs(after.height - before.height) > 20;
      const canvasReady = canvas.getBoundingClientRect().width > 100 && canvas.getBoundingClientRect().height > 100;
      return {
        ok: Boolean(timeframeActive && resized && canvasReady && closed),
        timeframeActive,
        resized,
        canvasReady,
        closed,
        before: { width: Math.round(before.width), height: Math.round(before.height) },
        after: { width: Math.round(after.width), height: Math.round(after.height) },
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  return evaluation.result?.result?.value ?? evaluation.result?.value ?? { ok: false, reason: "NO_RESULT" };
}

try {
  await waitForDebugger();
  const page = await fetchJson(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
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
      consoleMessages.push({
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
    if (payload.method === "Network.requestWillBeSent") {
      requestUrls.set(payload.params.requestId, payload.params.request?.url ?? null);
    }
    if (payload.method === "Network.responseReceived") {
      const response = payload.params.response;
      if (/binance\.(com|vision)/i.test(response?.url || "")) {
        binanceResponses.push({
          url: response.url,
          status: response.status,
          statusText: response.statusText,
          mimeType: response.mimeType,
          fromDiskCache: response.fromDiskCache === true,
          fromServiceWorker: response.fromServiceWorker === true,
        });
      }
    }
    if (payload.method === "Network.loadingFailed") {
      failedRequests.push({
        url: requestUrls.get(payload.params.requestId) ?? null,
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
  await send(socket, "Page.navigate", { url: targetUrl });

  const runtime = await waitForRuntime(socket);
  const probes = runtimeReady(runtime.state) ? [] : await runEndpointProbes(socket);
  const modalProbe = runtimeReady(runtime.state)
    ? await probeChartModal(socket)
    : { ok: false, skipped: true, reason: "RUNTIME_NOT_READY" };

  console.log(JSON.stringify({
    targetUrl,
    ready: runtimeReady(runtime.state),
    readyAfterMs: runtime.readyAfterMs,
    finalState: runtime.state,
    samples: runtime.samples,
    modalProbe,
    probes,
    binanceResponses: binanceResponses.slice(-80),
    failedRequests: failedRequests.slice(-80),
    exceptions,
    consoleMessages: consoleMessages.slice(-80),
  }, null, 2));

  if (!runtimeReady(runtime.state) || !modalProbe.ok || exceptions.length) {
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
