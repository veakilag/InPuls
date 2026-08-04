const DEFAULT_MIN_INTERVAL_MS = 500;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return value;
}

function readRetryAfterMs(response, now = Date.now()) {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

function isRetryableStatus(status) {
  return status === 418 || status === 429 || (status >= 500 && status <= 599);
}

export function createBinanceRequestScheduler({
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  sleepImpl = defaultSleep,
  nowImpl = Date.now,
} = {}) {
  requireNonNegativeInteger(minIntervalMs, "minIntervalMs");
  if (typeof sleepImpl !== "function") throw new TypeError("sleepImpl must be a function");
  if (typeof nowImpl !== "function") throw new TypeError("nowImpl must be a function");

  let tail = Promise.resolve();
  let lastStartedAt = -Infinity;

  return (task) => {
    if (typeof task !== "function") return Promise.reject(new TypeError("task must be a function"));
    const run = async () => {
      const now = Number(nowImpl());
      const elapsed = Number.isFinite(now) ? now - lastStartedAt : minIntervalMs;
      const waitMs = Math.max(0, minIntervalMs - elapsed);
      if (waitMs > 0) await sleepImpl(waitMs);
      const startedAt = Number(nowImpl());
      lastStartedAt = Number.isFinite(startedAt) ? startedAt : lastStartedAt + minIntervalMs;
      return task();
    };
    const result = tail.then(run, run);
    tail = result.catch(() => undefined);
    return result;
  };
}

export const sharedBinanceRequestScheduler = createBinanceRequestScheduler();

export async function fetchBinanceJson(url, {
  label = "Binance request",
  fetchImpl = globalThis.fetch,
  requestScheduler = sharedBinanceRequestScheduler,
  maxRetries = DEFAULT_MAX_RETRIES,
  baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  sleepImpl = defaultSleep,
  randomImpl = Math.random,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (typeof requestScheduler !== "function") throw new TypeError("requestScheduler must be a function");
  requireNonNegativeInteger(maxRetries, "maxRetries");
  requireNonNegativeInteger(baseBackoffMs, "baseBackoffMs");
  requireNonNegativeInteger(maxBackoffMs, "maxBackoffMs");
  if (maxBackoffMs < baseBackoffMs) throw new RangeError("maxBackoffMs must be >= baseBackoffMs");
  if (typeof sleepImpl !== "function") throw new TypeError("sleepImpl must be a function");
  if (typeof randomImpl !== "function") throw new TypeError("randomImpl must be a function");

  let attempt = 0;
  while (true) {
    const response = await requestScheduler(() => fetchImpl(url));
    if (response?.ok) return response.json();

    const status = Number(response?.status);
    const detail = typeof response?.text === "function" ? await response.text() : "";
    const message = `${label} failed (${Number.isFinite(status) ? status : "unknown"})${detail ? `: ${detail}` : ""}`;
    if (!Number.isFinite(status) || !isRetryableStatus(status) || attempt >= maxRetries) {
      throw new Error(message);
    }

    const retryAfterMs = readRetryAfterMs(response);
    const exponentialMs = Math.min(maxBackoffMs, baseBackoffMs * (2 ** attempt));
    const jitter = 0.9 + Math.max(0, Math.min(1, Number(randomImpl()) || 0)) * 0.2;
    const waitMs = Math.max(retryAfterMs, Math.ceil(exponentialMs * jitter));
    await sleepImpl(waitMs);
    attempt += 1;
  }
}
