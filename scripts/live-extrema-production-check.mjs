import { spawn } from "node:child_process";

const targetUrl = process.argv[2];
if (!targetUrl) throw new Error("Usage: node scripts/live-extrema-production-check.mjs <url>");

const chromeBinary = process.env.CHROME_BIN || "google-chrome";
const port = 9600 + Math.floor(Math.random() * 300);
const profile = `/tmp/inpuls-extrema-${process.pid}`;
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
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

let sequence = 0;
const pending = new Map();
function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
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
    }, 15_000);
  });
}

const exceptions = [];
const failedRequests = [];
const consoleMessages = [];

async function readState(socket) {
  const result = await send(socket, "Runtime.evaluate", {
    expression: `(() => {
      const text = document.querySelector('#collector-status')?.textContent?.trim() ?? '';
      const active = Number(text.match(/экстремумы\\s+(\\d+)\\s+активных/)?.[1] ?? 0);
      const warmed = Number(text.match(/история\\s+\\S+\\s+(\\d+)/)?.[1] ?? 0);
      const proxy = Number(text.match(/SPOT PROXY\\s+(\\d+)/)?.[1] ?? 0);
      return {
        href: location.href,
        title: document.title,
        text,
        active,
        warmed,
        proxy,
        checks: document.querySelector('#checks-count')?.textContent?.trim() ?? null,
        warmup: document.querySelector('#warmup-count')?.textContent?.trim() ?? null,
      };
    })()`,
    returnByValue: true,
  });
  return result.result?.value ?? null;
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
    if (payload.method === "Runtime.exceptionThrown") {
      exceptions.push({
        text: payload.params.exceptionDetails?.text || "Exception",
        description: payload.params.exceptionDetails?.exception?.description || "",
        url: payload.params.exceptionDetails?.url || "",
      });
    }
    if (payload.method === "Network.loadingFailed") {
      failedRequests.push({
        url: payload.params.requestId,
        errorText: payload.params.errorText,
        type: payload.params.type,
        blockedReason: payload.params.blockedReason || null,
      });
    }
    if (payload.method === "Runtime.consoleAPICalled") {
      consoleMessages.push({
        type: payload.params.type,
        text: payload.params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") || "",
      });
    }
  });
  await Promise.all([
    send(socket, "Runtime.enable"),
    send(socket, "Page.enable"),
    send(socket, "Network.enable"),
  ]);

  const startedAt = Date.now();
  let state = null;
  while (Date.now() - startedAt < 150_000) {
    state = await readState(socket);
    console.log(`[${Math.round((Date.now() - startedAt) / 1000)}s] ${state?.text || "NO_STATUS"}`);
    if (state?.active > 0 && state?.warmed > 0) break;
    await delay(2_000);
  }

  const result = {
    targetUrl,
    elapsedMs: Date.now() - startedAt,
    state,
    exceptions,
    failedRequests,
    consoleMessages,
  };
  console.log("FINAL_RESULT=" + JSON.stringify(result));
  if (!(state?.active > 0) || !(state?.warmed > 0) || exceptions.length) process.exitCode = 1;
  socket.close();
} catch (error) {
  console.error(error?.stack || error);
  if (chromeStderr) console.error(chromeStderr.slice(-12_000));
  process.exitCode = 1;
} finally {
  chrome.kill("SIGTERM");
}
