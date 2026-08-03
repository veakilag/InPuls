import "./binance-clock-core.js?v=26-101-binance-clock-sync-v1";
import "./canvas-comfort-preview.js?v=26-102-tape-edge-canvas-preview-v1";

const BINANCE_TIME_HOSTS = Object.freeze([
  "fapi.binance.com",
  "fapi1.binance.com",
  "fapi2.binance.com",
]);
const CLOCK_SYNC_INTERVAL_MS = 5 * 60_000;
const CLOCK_STALE_MS = 15 * 60_000;
const CLOCK_SAMPLE_COUNT = 5;
const CLOCK_SAMPLE_TIMEOUT_MS = 1_500;

function runtimePerformanceNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function dispatchState(target) {
  try { target.dispatchEvent(new Event("statechange")); } catch {}
}

export class BinanceClock extends EventTarget {
  constructor(options = {}) {
    super();
    this.dateNow = typeof options.dateNow === "function" ? options.dateNow : Date.now;
    this.perfNow = typeof options.perfNow === "function" ? options.perfNow : runtimePerformanceNow;
    this.fetchImpl = typeof options.fetchImpl === "function"
      ? options.fetchImpl
      : (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    this.setTimeoutFn = typeof options.setTimeoutFn === "function" ? options.setTimeoutFn : setTimeout;
    this.clearTimeoutFn = typeof options.clearTimeoutFn === "function" ? options.clearTimeoutFn : clearTimeout;
    this.setIntervalFn = typeof options.setIntervalFn === "function" ? options.setIntervalFn : setInterval;
    this.clearIntervalFn = typeof options.clearIntervalFn === "function" ? options.clearIntervalFn : clearInterval;
    this.syncIntervalMs = Math.max(30_000, Number(options.syncIntervalMs) || CLOCK_SYNC_INTERVAL_MS);
    this.staleMs = Math.max(this.syncIntervalMs, Number(options.staleMs) || CLOCK_STALE_MS);
    this.sampleCount = Math.max(3, Math.min(7, Math.floor(Number(options.sampleCount) || CLOCK_SAMPLE_COUNT)));
    this.sampleTimeoutMs = Math.max(500, Number(options.sampleTimeoutMs) || CLOCK_SAMPLE_TIMEOUT_MS);
    this.anchorExchangeMs = null;
    this.anchorPerfMs = null;
    this.lastNowMs = null;
    this.offsetMs = null;
    this.rttMs = null;
    this.syncedAt = 0;
    this.samplesUsed = 0;
    this.totalSamples = 0;
    this.syncing = false;
    this.lastError = null;
    this.syncPromise = null;
    this.intervalTimer = 0;
    this.started = false;
    this.selectedTimeZone = "Europe/Moscow";
    this.formatters = new Map();
    this.visibilityHandler = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        this.sync({ force: true }).catch(() => {});
      }
    };
    this.onlineHandler = () => this.sync({ force: true }).catch(() => {});
  }

  isCalibrated() {
    return Number.isFinite(this.anchorExchangeMs) && Number.isFinite(this.anchorPerfMs);
  }

  now(perfAt = null) {
    const hasExplicitPerf = perfAt !== null
      && perfAt !== undefined
      && Number.isFinite(Number(perfAt));
    const perf = hasExplicitPerf ? Number(perfAt) : Number(this.perfNow());
    const local = Number(this.dateNow());
    // Tape passes an explicit performance timestamp. Before Binance calibration,
    // returning the workstation clock here can seed the moving live edge several
    // seconds in the future. Display clocks may still use the local fallback.
    if (!this.isCalibrated() && hasExplicitPerf) return null;
    const candidate = this.isCalibrated() && Number.isFinite(perf)
      ? Number(this.anchorExchangeMs) + (perf - Number(this.anchorPerfMs))
      : local;
    if (!Number.isFinite(candidate)) return local;
    if (!Number.isFinite(this.lastNowMs) || candidate >= this.lastNowMs) {
      this.lastNowMs = candidate;
    }
    return Number(this.lastNowMs);
  }

  delayToNextSecond(extraMs = 10) {
    const current = this.now();
    const remainder = ((current % 1_000) + 1_000) % 1_000;
    return Math.max(20, 1_000 - remainder + Math.max(0, Number(extraMs) || 0));
  }

  setTimeZone(zone) {
    const requested = String(zone || "Europe/Moscow");
    if (requested === this.selectedTimeZone) return this.selectedTimeZone;
    try {
      new Intl.DateTimeFormat("ru-RU", { timeZone: requested }).format(0);
      this.selectedTimeZone = requested;
    } catch {
      this.selectedTimeZone = "Europe/Moscow";
    }
    return this.selectedTimeZone;
  }

  getTimeZone() {
    return this.selectedTimeZone;
  }

  formatTime(epochMs, options = {}) {
    const seconds = options.seconds !== false;
    const requestedZone = String(options.timeZone ?? this.selectedTimeZone);
    const zone = requestedZone === this.selectedTimeZone
      ? this.selectedTimeZone
      : this.setTimeZone(requestedZone);
    const key = `${zone}:${seconds ? "seconds" : "minutes"}`;
    let formatter = this.formatters.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("ru-RU", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        second: seconds ? "2-digit" : undefined,
        hour12: false,
      });
      this.formatters.set(key, formatter);
    }
    return formatter.format(new Date(Number(epochMs)));
  }

  snapshot() {
    const ageMs = this.syncedAt > 0 ? Math.max(0, Number(this.dateNow()) - this.syncedAt) : null;
    let status = "local";
    if (this.syncing) status = "syncing";
    else if (this.isCalibrated() && ageMs !== null && ageMs <= this.staleMs) status = "live";
    else if (this.isCalibrated()) status = "stale";
    else if (this.lastError) status = "error";
    return {
      status,
      calibrated: this.isCalibrated(),
      offsetMs: Number.isFinite(this.offsetMs) ? this.offsetMs : null,
      rttMs: Number.isFinite(this.rttMs) ? this.rttMs : null,
      syncedAt: this.syncedAt || null,
      ageMs,
      samplesUsed: this.samplesUsed,
      totalSamples: this.totalSamples,
      error: this.lastError,
      timeZone: this.selectedTimeZone,
    };
  }

  calibrate(estimate, localNow = this.dateNow(), perfNow = this.perfNow()) {
    const offset = Number(estimate?.offsetMs);
    const rtt = Number(estimate?.rttMs);
    const local = Number(localNow);
    const perf = Number(perfNow);
    if (![offset, local, perf].every(Number.isFinite)) return false;
    const wasCalibrated = this.isCalibrated();
    this.offsetMs = offset;
    this.rttMs = Number.isFinite(rtt) ? rtt : null;
    this.anchorExchangeMs = local + offset;
    this.anchorPerfMs = perf;
    this.syncedAt = local;
    this.samplesUsed = Math.max(0, Number(estimate?.sampleCount) || 0);
    this.totalSamples = Math.max(this.samplesUsed, Number(estimate?.totalSampleCount) || 0);
    this.lastError = null;
    if (wasCalibrated) this.now(perf);
    else this.lastNowMs = this.anchorExchangeMs;
    dispatchState(this);
    return true;
  }

  async fetchSample(sampleIndex = 0) {
    if (!this.fetchImpl) throw new Error("fetch unavailable");
    let lastError = null;
    for (let attempt = 0; attempt < BINANCE_TIME_HOSTS.length; attempt += 1) {
      const host = BINANCE_TIME_HOSTS[(sampleIndex + attempt) % BINANCE_TIME_HOSTS.length];
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const sentAt = Number(this.dateNow());
      let timer = 0;
      try {
        if (controller) {
          timer = this.setTimeoutFn(() => controller.abort(), this.sampleTimeoutMs);
        }
        const response = await this.fetchImpl(`https://${host}/fapi/v1/time`, {
          cache: "no-store",
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (!response?.ok) throw new Error(`HTTP ${response?.status ?? "ERR"}`);
        const payload = await response.json();
        const receivedAt = Number(this.dateNow());
        const serverTime = Number(payload?.serverTime);
        if (![sentAt, receivedAt, serverTime].every(Number.isFinite)) {
          throw new Error("invalid server time");
        }
        return { sentAt, receivedAt, serverTime, host };
      } catch (error) {
        lastError = error;
      } finally {
        if (timer) this.clearTimeoutFn(timer);
      }
    }
    throw lastError ?? new Error("Binance time unavailable");
  }

  async sync({ force = false } = {}) {
    const age = this.syncedAt > 0 ? Number(this.dateNow()) - this.syncedAt : Infinity;
    if (!force && this.isCalibrated() && age < this.syncIntervalMs) return this.snapshot();
    if (this.syncPromise) return this.syncPromise;
    this.syncing = true;
    dispatchState(this);
    this.syncPromise = (async () => {
      const samples = [];
      let failures = 0;
      for (let index = 0; index < this.sampleCount; index += 1) {
        try {
          samples.push(await this.fetchSample(index));
          failures = 0;
        } catch {
          failures += 1;
          if (!samples.length && failures >= 2) break;
          if (samples.length >= 3) break;
        }
      }
      const core = globalThis.InPulsBinanceClockCore;
      const estimate = core?.estimateClockOffset?.(samples, 3) ?? null;
      if (!estimate || !Number.isFinite(Number(estimate.offsetMs))) {
        throw new Error("Binance clock calibration failed");
      }
      this.calibrate(estimate, this.dateNow(), this.perfNow());
      return this.snapshot();
    })().catch((error) => {
      this.lastError = String(error?.message || error || "clock sync failed");
      dispatchState(this);
      return this.snapshot();
    }).finally(() => {
      this.syncing = false;
      this.syncPromise = null;
      dispatchState(this);
    });
    return this.syncPromise;
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.sync({ force: true }).catch(() => {});
    this.intervalTimer = this.setIntervalFn(
      () => this.sync({ force: true }).catch(() => {}),
      this.syncIntervalMs,
    );
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.visibilityHandler, { passive: true });
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onlineHandler, { passive: true });
    }
    return this;
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    if (this.intervalTimer) this.clearIntervalFn(this.intervalTimer);
    this.intervalTimer = 0;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineHandler);
    }
  }
}

export const binanceClock = new BinanceClock();
