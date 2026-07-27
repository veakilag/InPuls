const MAX_SAMPLES = 12_000;
const MAX_EVENTS = 4_000;
const INTERVAL_MS = 5_000;
const STORAGE_KEY = "inpuls-observability-v1";

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function summarizeValues(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50: percentile(sorted, .5),
    p95: percentile(sorted, .95),
    p99: percentile(sorted, .99),
    max: sorted.at(-1) ?? null,
  };
}

function stableTagsKey(tags) {
  if (!tags || typeof tags !== "object") return "";
  return JSON.stringify(Object.fromEntries(
    Object.entries(tags).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

function enabledFromEnvironment() {
  if (typeof location !== "undefined" && new URLSearchParams(location.search).get("obs") === "1") return true;
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

function currentVisibility() {
  if (typeof document === "undefined") return "unknown";
  return document.hidden ? "hidden" : "visible";
}

function calibratedSourceLatency(localEpochMs, sourceEventTimeMs, sourceClockOffsetMs) {
  const local = Number(localEpochMs);
  const source = Number(sourceEventTimeMs);
  const offset = Number(sourceClockOffsetMs);
  if (![local, source, offset].every(Number.isFinite)) return null;
  const latency = local + offset - source;
  if (latency < -100 || latency > 10_000) return null;
  return Math.max(0, latency);
}

class InPulsObservability {
  constructor() {
    this.enabled = enabledFromEnvironment();
    this.startedAt = Date.now();
    this.samples = new Map();
    this.counters = new Map();
    this.frames = [];
    this.latestWorkerByChannel = new Map();
    this.lastRenderedByLayer = new Map();
    this.events = [];
    this.renderSkips = new Map();
    this.visibilityTransitions = [{ at: this.startedAt, state: currentVisibility() }];
    this.frameHandle = 0;
    this.longTaskObserver = null;
    this.visibilityHandler = null;
    if (this.enabled) this.start();
  }

  start() {
    if (!this.frameHandle && typeof requestAnimationFrame === "function") {
      let previous = performance.now();
      const frame = (now) => {
        this.frames.push({ value: now - previous, at: Date.now() });
        if (this.frames.length > MAX_SAMPLES) this.frames.shift();
        previous = now;
        this.frameHandle = requestAnimationFrame(frame);
      };
      this.frameHandle = requestAnimationFrame(frame);
    }
    if (!this.longTaskObserver && typeof PerformanceObserver === "function") {
      try {
        this.longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) this.record("runtime.long-task", entry.duration);
        });
        this.longTaskObserver.observe({ type: "longtask", buffered: true });
      } catch {}
    }
    if (!this.visibilityHandler && typeof document !== "undefined") {
      this.visibilityHandler = () => {
        const state = currentVisibility();
        const last = this.visibilityTransitions.at(-1);
        if (last?.state === state) return;
        this.visibilityTransitions.push({ at: Date.now(), state });
        this.event("runtime", "visibility", { state });
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  record(name, value, tags = null) {
    if (!this.enabled || value === null || value === undefined || !Number.isFinite(Number(value))) return;
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

  event(category, name, details = {}, at = Date.now()) {
    if (!this.enabled) return;
    this.events.push({
      at: Number.isFinite(Number(at)) ? Number(at) : Date.now(),
      category,
      name,
      details,
    });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  skipRender(layer, reason, tags = null) {
    if (!this.enabled) return;
    const key = stableTagsKey({ layer, reason, ...(tags ?? {}) });
    const previous = this.renderSkips.get(key);
    const now = Date.now();
    this.renderSkips.set(key, {
      layer,
      reason,
      tags,
      count: (previous?.count ?? 0) + 1,
      firstAt: previous?.firstAt ?? now,
      lastAt: now,
    });
  }

  workerMessage(
    message,
    receivedAtMonotonic = performance.now(),
    receivedAtEpoch = Date.now(),
  ) {
    if (!this.enabled || !message?.__obs) return;
    const tags = {
      type: message.type,
      symbol: message.symbol || null,
      source: message.__obs.sourceKind || null,
    };
    if (tags.symbol && (message.type === "data" || message.type === "tape")) {
      this.latestWorkerByChannel.set(`${tags.symbol}:${message.type}`, {
        receivedAtMonotonic,
        receivedAtEpoch,
        sourceClockOffsetMs: message.__obs.sourceClockOffsetMs,
        sourceEventTimeMs: message.__obs.sourceEventTimeMs,
        sourceKind: message.__obs.sourceKind,
        type: message.type,
      });
    }
    if (Number.isFinite(message.__obs.sentAtEpochMs)) {
      this.record("worker.post-to-main", Math.max(0, receivedAtEpoch - message.__obs.sentAtEpochMs), tags);
    }
    this.record("worker.process", message.__obs.processMs, tags);
    this.record("worker.observer-overhead", message.__obs.observerOverheadMs, tags);
    this.record("worker.payload-bytes", message.__obs.payloadBytes, tags);
    if (message.type === "tape" && message.backpressure) {
      this.record("worker.tape-dropped", message.backpressure.dropped, tags);
      this.record("worker.tape-pending", message.backpressure.pending, tags);
    }
    if (
      String(message.__obs.sourceKind ?? "").startsWith("live-")
      && Number.isFinite(message.__obs.sourceEventTimeMs)
    ) {
      this.record("source-to-main", calibratedSourceLatency(
        receivedAtEpoch,
        message.__obs.sourceEventTimeMs,
        message.__obs.sourceClockOffsetMs,
      ), {
        ...tags,
        clock: Number.isFinite(message.__obs.sourceClockOffsetMs) ? "calibrated" : "uncalibrated",
      });
    }

    if (message.type === "diagnostic" && message.diagnostic) {
      const diagnostic = message.diagnostic;
      this.event(
        "connection",
        diagnostic.phase || "unknown",
        {
          symbol: tags.symbol,
          ...diagnostic,
        },
        diagnostic.atEpochMs,
      );
      this.record("connection.phase-duration", diagnostic.durationMs, {
        symbol: tags.symbol,
        phase: diagnostic.phase || "unknown",
        state: diagnostic.state || null,
        host: diagnostic.host || null,
      });
      if (diagnostic.phase === "worker.flow") {
        const flowTags = { symbol: tags.symbol };
        this.record("worker.depth-events-per-second", diagnostic.depthEventsPerSecond, flowTags);
        this.record("worker.trade-events-per-second", diagnostic.tradeEventsPerSecond, flowTags);
        this.record("worker.depth-process-mean", diagnostic.depthProcessMeanMs, flowTags);
        this.record("worker.depth-process-max", diagnostic.depthProcessMaxMs, flowTags);
        this.record("worker.trade-process-mean", diagnostic.tradeProcessMeanMs, flowTags);
        this.record("worker.trade-process-max", diagnostic.tradeProcessMaxMs, flowTags);
        this.record("worker.tape-queue", diagnostic.tapeQueue, flowTags);
        this.record("worker.depth-source-lag", diagnostic.depthSourceLagMs, flowTags);
        this.record("worker.trade-source-lag", diagnostic.tradeSourceLagMs, flowTags);
      }
    } else if (message.type === "status") {
      this.event("connection", "status", {
        symbol: tags.symbol,
        state: message.state,
        text: message.text,
      });
    }
  }

  rendered(symbol, layer, renderedAt = performance.now()) {
    if (!this.enabled) return;
    const channel = layer === "ladder" || layer === "orderbook" ? "data" : "tape";
    const latest = this.latestWorkerByChannel.get(`${symbol}:${channel}`);
    if (!latest) return;
    const renderKey = `${symbol}:${layer}`;
    if (this.lastRenderedByLayer.get(renderKey) === latest.receivedAtMonotonic) return;
    this.lastRenderedByLayer.set(renderKey, latest.receivedAtMonotonic);
    const tags = { symbol, layer, type: latest.type, source: latest.sourceKind || null };
    this.record("main-to-render", Math.max(0, renderedAt - latest.receivedAtMonotonic), tags);
    if (
      String(latest.sourceKind ?? "").startsWith("live-")
      && Number.isFinite(latest.sourceEventTimeMs)
    ) {
      this.record("source-to-render", calibratedSourceLatency(
        Date.now(),
        latest.sourceEventTimeMs,
        latest.sourceClockOffsetMs,
      ), {
        ...tags,
        clock: Number.isFinite(latest.sourceClockOffsetMs) ? "calibrated" : "uncalibrated",
      });
    }
  }

  metricBreakdown() {
    const result = {};
    for (const [name, rows] of this.samples) {
      const groups = new Map();
      for (const row of rows) {
        const key = stableTagsKey(row.tags);
        if (!key) continue;
        const group = groups.get(key) ?? { tags: row.tags, values: [] };
        group.values.push(row.value);
        groups.set(key, group);
      }
      if (groups.size) {
        result[name] = [...groups.values()].map((group) => ({
          tags: group.tags,
          ...summarizeValues(group.values),
        }));
      }
    }
    return result;
  }

  intervalSnapshot(now) {
    const buckets = new Map();
    const add = (name, row) => {
      const index = Math.max(0, Math.floor((row.at - this.startedAt) / INTERVAL_MS));
      const bucket = buckets.get(index) ?? { index, metrics: new Map() };
      const values = bucket.metrics.get(name) ?? [];
      values.push(row.value);
      bucket.metrics.set(name, values);
      buckets.set(index, bucket);
    };
    for (const [name, rows] of this.samples) for (const row of rows) add(name, row);
    for (const row of this.frames) add("runtime.frame", row);

    const lastIndex = Math.max(0, Math.floor((now - this.startedAt) / INTERVAL_MS));
    const intervals = [];
    for (let index = 0; index <= lastIndex; index += 1) {
      const bucket = buckets.get(index);
      const metrics = {};
      for (const [name, values] of bucket?.metrics ?? []) {
        metrics[name] = summarizeValues(values);
      }
      intervals.push({
        startMs: index * INTERVAL_MS,
        endMs: Math.min(now - this.startedAt, (index + 1) * INTERVAL_MS),
        metrics,
      });
    }
    return intervals;
  }

  visibilitySnapshot(now) {
    const durationsMs = {};
    const transitions = this.visibilityTransitions.map((transition, index) => {
      const end = this.visibilityTransitions[index + 1]?.at ?? now;
      durationsMs[transition.state] = (durationsMs[transition.state] ?? 0)
        + Math.max(0, end - transition.at);
      return {
        atMs: Math.max(0, transition.at - this.startedAt),
        state: transition.state,
      };
    });
    return {
      current: currentVisibility(),
      durationsMs,
      transitions,
    };
  }

  snapshot() {
    const now = Date.now();
    const metrics = {};
    for (const [name, rows] of this.samples) {
      metrics[name] = summarizeValues(rows.map((row) => row.value));
    }
    const frameValues = this.frames.map((row) => row.value);
    const frameSummary = summarizeValues(frameValues);
    return {
      version: 2,
      enabled: this.enabled,
      startedAt: this.startedAt,
      capture: {
        startedAt: this.startedAt,
        endedAt: now,
        durationMs: Math.max(0, now - this.startedAt),
      },
      metrics,
      metricsByTags: this.metricBreakdown(),
      counters: Object.fromEntries(this.counters),
      frames: {
        count: frameSummary.count,
        p50Ms: frameSummary.p50,
        p95Ms: frameSummary.p95,
        p99Ms: frameSummary.p99,
        maxMs: frameSummary.max,
        droppedOver50ms: frameValues.filter((value) => value > 50).length,
      },
      intervals: this.intervalSnapshot(now),
      visibility: this.visibilitySnapshot(now),
      connectionEvents: this.events
        .filter((event) => event.category === "connection")
        .map((event) => ({ ...event, atMs: Math.max(0, event.at - this.startedAt) })),
      renderSkips: [...this.renderSkips.values()].map((row) => ({
        ...row,
        firstAtMs: Math.max(0, row.firstAt - this.startedAt),
        lastAtMs: Math.max(0, row.lastAt - this.startedAt),
      })),
      memory: typeof performance !== "undefined" && performance.memory ? {
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
    this.latestWorkerByChannel.clear();
    this.lastRenderedByLayer.clear();
    this.events.length = 0;
    this.renderSkips.clear();
    this.startedAt = Date.now();
    this.visibilityTransitions = [{ at: this.startedAt, state: currentVisibility() }];
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
