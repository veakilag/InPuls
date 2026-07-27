(function installTapeLatency(scope) {
  function normalizeTiming(event, receivedAt = null, clockOffsetMs = null) {
    const tradeTime = Number(event?.T ?? event?.E);
    const eventTime = Number(event?.E ?? event?.T);
    const received = receivedAt === null || receivedAt === undefined ? null : Number(receivedAt);
    const offset = clockOffsetMs === null || clockOffsetMs === undefined ? null : Number(clockOffsetMs);
    const calibrated = Number.isFinite(offset);
    const rawLatency = calibrated && Number.isFinite(received) && Number.isFinite(eventTime)
      ? received + offset - eventTime
      : null;
    const validLatency = Number.isFinite(rawLatency) && rawLatency >= -100 && rawLatency <= 10_000
      ? Math.max(0, rawLatency)
      : null;
    return {
      tradeTime,
      eventTime,
      receivedAt: Number.isFinite(received) ? received : null,
      rxLatencyMs: validLatency,
    };
  }

  class RollingLatency {
    constructor(options = {}) {
      this.windowMs = Math.max(250, Number(options.windowMs) || 2_000);
      this.maxSamples = Math.max(16, Math.floor(Number(options.maxSamples) || 400));
      this.updateMs = Math.max(50, Number(options.updateMs) || 250);
      this.samples = [];
      this.head = 0;
      this.display = null;
      this.lastUpdateAt = 0;
    }

    reset() {
      this.samples = [];
      this.head = 0;
      this.display = null;
      this.lastUpdateAt = 0;
    }

    record(value, at = Date.now()) {
      const latency = Number(value);
      const now = Number(at);
      if (!Number.isFinite(latency) || latency < 0 || latency > 10_000 || !Number.isFinite(now)) {
        return this.display;
      }
      this.samples.push({ at: now, value: latency });
      const cutoff = now - this.windowMs;
      while (this.head < this.samples.length && this.samples[this.head].at < cutoff) {
        this.head += 1;
      }
      if (this.samples.length - this.head > this.maxSamples) {
        this.head = this.samples.length - this.maxSamples;
      }
      if (this.head >= this.maxSamples && this.head >= this.samples.length / 2) {
        this.samples = this.samples.slice(this.head);
        this.head = 0;
      }
      if (this.display !== null && now - this.lastUpdateAt < this.updateMs) return this.display;
      const sorted = this.samples
        .slice(this.head)
        .map((sample) => sample.value)
        .sort((left, right) => left - right);
      if (!sorted.length) return this.display;
      const middle = Math.floor(sorted.length / 2);
      this.display = sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
      this.lastUpdateAt = now;
      return this.display;
    }

    current() {
      return Number.isFinite(this.display) ? this.display : null;
    }
  }

  scope.InPulsTapeLatency = { normalizeTiming, RollingLatency };
})(typeof self !== "undefined" ? self : globalThis);
