const MAX_SAMPLES = 2_000;
const STORAGE_KEY = "inpuls-observability-v1";

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function enabledFromEnvironment() {
  if (typeof location !== "undefined" && new URLSearchParams(location.search).get("obs") === "1") return true;
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

class InPulsObservability {
  constructor() {
    this.enabled = enabledFromEnvironment();
    this.startedAt = Date.now();
    this.samples = new Map();
    this.counters = new Map();
    this.frames = [];
    this.latestWorkerBySymbol = new Map();
    this.frameHandle = 0;
    this.longTaskObserver = null;
    if (this.enabled) this.start();
  }

  start() {
    if (this.frameHandle || typeof requestAnimationFrame !== "function") return;
    let previous = performance.now();
    const frame = (now) => {
      this.frames.push(now - previous);
      if (this.frames.length > MAX_SAMPLES) this.frames.shift();
      previous = now;
      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
    if (typeof PerformanceObserver === "function") {
      try {
        this.longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) this.record("runtime.long-task", entry.duration);
        });
        this.longTaskObserver.observe({ type: "longtask", buffered: true });
      } catch {}
    }
  }

  record(name, value, tags = null) {
    if (!this.enabled || !Number.isFinite(Number(value))) return;
    const rows = this.samples.get(name) ?? [];
    rows.push({ value: Number(value), at: Date.now(), tags });
    if (rows.length > MAX_SAMPLES) rows.splice(0, rows.length - MAX_SAMPLES);
    this.samples.set(name, rows);
  }

  increment(name, amount = 1) {
    if (!this.enabled) return;
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  measure(name, callback, tags = null) {
    if (!this.enabled) return callback();
    const startedAt = performance.now();
    try { return callback(); } finally { this.record(name, performance.now() - startedAt, tags); }
  }

  workerMessage(message, receivedAt = performance.now()) {
    if (!this.enabled || !message?.__obs) return;
    const tags = { type: message.type, symbol: message.symbol ?? null };
    if (tags.symbol) {
      this.latestWorkerBySymbol.set(tags.symbol, {
        receivedAt,
        exchangeEventTime: message.__obs.exchangeEventTime,
      });
    }
    this.record("worker.post-to-main", receivedAt - message.__obs.sentAt, tags);
    this.record("worker.process", message.__obs.processMs, tags);
    this.record("worker.observer-overhead", message.__obs.observerOverheadMs, tags);
    this.record("worker.payload-bytes", message.__obs.payloadBytes, tags);
    if (Number.isFinite(message.__obs.exchangeEventTime)) {
      this.record("exchange-to-main", Date.now() - message.__obs.exchangeEventTime, tags);
    }
  }

  rendered(symbol, layer, renderedAt = performance.now()) {
    if (!this.enabled) return;
    const latest = this.latestWorkerBySymbol.get(symbol);
    if (!latest) return;
    const tags = { symbol, layer };
    this.record("main-to-render", renderedAt - latest.receivedAt, tags);
    if (Number.isFinite(latest.exchangeEventTime)) {
      this.record("exchange-to-render", Date.now() - latest.exchangeEventTime, tags);
    }
  }

  snapshot() {
    const metrics = {};
    for (const [name, rows] of this.samples) {
      const values = rows.map((row) => row.value).sort((a, b) => a - b);
      metrics[name] = {
        count: values.length,
        p50: percentile(values, .5),
        p95: percentile(values, .95),
        p99: percentile(values, .99),
        max: values.at(-1) ?? null,
      };
    }
    const frames = this.frames.slice().sort((a, b) => a - b);
    return {
      enabled: this.enabled,
      startedAt: this.startedAt,
      metrics,
      counters: Object.fromEntries(this.counters),
      frames: {
        count: frames.length,
        p50Ms: percentile(frames, .5),
        p95Ms: percentile(frames, .95),
        p99Ms: percentile(frames, .99),
        droppedOver50ms: frames.filter((value) => value > 50).length,
      },
      memory: performance?.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      } : null,
    };
  }

  reset() {
    this.samples.clear();
    this.counters.clear();
    this.frames.length = 0;
    this.latestWorkerBySymbol.clear();
    this.startedAt = Date.now();
  }
}

export const observability = new InPulsObservability();

if (typeof window !== "undefined") {
  window.__INPULS_OBS__ = Object.freeze({
    enabled: observability.enabled,
    snapshot: () => observability.snapshot(),
    reset: () => observability.reset(),
    download: () => {
      const blob = new Blob([JSON.stringify(observability.snapshot(), null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `inpuls-observability-${new Date().toISOString().replaceAll(":", "-")}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 0);
    },
  });
}
