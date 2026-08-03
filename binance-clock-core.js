(function installBinanceClockCore(scope) {
  "use strict";

  function median(values) {
    const clean = (values ?? [])
      .map(Number)
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    if (!clean.length) return null;
    const middle = Math.floor(clean.length / 2);
    return clean.length % 2
      ? clean[middle]
      : (clean[middle - 1] + clean[middle]) / 2;
  }

  function normalizeSample(sample) {
    const sentAt = Number(sample?.sentAt);
    const receivedAt = Number(sample?.receivedAt);
    const serverTime = Number(sample?.serverTime);
    const rttMs = receivedAt - sentAt;
    const offsetMs = serverTime - (sentAt + receivedAt) / 2;
    if (
      ![sentAt, receivedAt, serverTime, rttMs, offsetMs].every(Number.isFinite)
      || rttMs < 0
      || rttMs > 10_000
    ) return null;
    return {
      sentAt,
      receivedAt,
      serverTime,
      rttMs,
      offsetMs,
      host: String(sample?.host ?? ""),
    };
  }

  function estimateClockOffset(samples, fastestCount = 3) {
    const clean = (samples ?? [])
      .map(normalizeSample)
      .filter(Boolean)
      .sort((left, right) => left.rttMs - right.rttMs);
    if (!clean.length) {
      return {
        offsetMs: null,
        rttMs: null,
        sampleCount: 0,
        totalSampleCount: 0,
        hosts: [],
      };
    }
    const count = Math.max(1, Math.min(clean.length, Math.floor(Number(fastestCount) || 3)));
    const selected = clean.slice(0, count);
    return {
      offsetMs: median(selected.map((sample) => sample.offsetMs)),
      rttMs: median(selected.map((sample) => sample.rttMs)),
      sampleCount: selected.length,
      totalSampleCount: clean.length,
      hosts: [...new Set(selected.map((sample) => sample.host).filter(Boolean))],
    };
  }

  scope.InPulsBinanceClockCore = Object.freeze({
    median,
    normalizeSample,
    estimateClockOffset,
  });
})(typeof self !== "undefined" ? self : globalThis);
