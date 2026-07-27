(function installInPulsOrderBookNetwork(root) {
  const DEFAULT_DELAYS_MS = Object.freeze([0, 250, 650]);

  function monotonicNow() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function errorKind(error) {
    const message = String(error?.message ?? error ?? "").toLowerCase();
    if (error?.name === "AbortError" || message.includes("abort")) return "aborted";
    if (message.includes("timeout")) return "timeout";
    if (message.includes("invalid")) return "invalid";
    if (message.includes("http")) return "http";
    if (error instanceof TypeError || message.includes("fetch") || message.includes("network")) {
      return "network-or-cors";
    }
    return "unknown";
  }

  function safeNotify(callback, event) {
    try { callback?.(event); } catch {}
  }

  function firstSuccessful(targets, request, options = {}) {
    const candidates = [...(targets ?? [])];
    if (!candidates.length) return Promise.reject(new Error("no request targets"));
    if (typeof request !== "function") return Promise.reject(new TypeError("request must be a function"));

    const requestedDelays = Array.isArray(options.delaysMs)
      ? options.delaysMs
      : DEFAULT_DELAYS_MS;
    const delayFor = (index) => Math.max(
      0,
      Number(requestedDelays[index] ?? requestedDelays.at(-1) ?? 0) || 0,
    );

    return new Promise((resolve, reject) => {
      const timers = [];
      const attempts = new Map();
      let failureCount = 0;
      let settled = false;

      const failIfComplete = () => {
        if (settled || failureCount < candidates.length) return;
        settled = true;
        reject(new AggregateError(
          [...attempts.values()].map((attempt) => attempt.error).filter(Boolean),
          "all request targets failed",
        ));
      };

      const launch = (target, index) => {
        if (settled) return;
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const startedAt = monotonicNow();
        const attempt = {
          controller,
          error: null,
          index,
          startedAt,
          state: "started",
          target,
        };
        attempts.set(index, attempt);
        safeNotify(options.onAttempt, {
          index,
          state: "started",
          target,
          delayMs: delayFor(index),
        });

        Promise.resolve()
          .then(() => request(target, { index, signal: controller?.signal }))
          .then((value) => {
            if (settled) return;
            settled = true;
            attempt.state = "succeeded";
            const durationMs = monotonicNow() - startedAt;
            safeNotify(options.onAttempt, {
              index,
              state: "succeeded",
              target,
              durationMs,
            });

            for (const timer of timers) clearTimeout(timer);
            for (const [otherIndex, other] of attempts) {
              if (otherIndex === index || other.state !== "started") continue;
              other.state = "cancelled";
              safeNotify(options.onAttempt, {
                index: otherIndex,
                state: "cancelled",
                target: other.target,
                durationMs: monotonicNow() - other.startedAt,
              });
              try { other.controller?.abort(); } catch {}
            }
            resolve({ value, target, index, durationMs });
          })
          .catch((error) => {
            if (settled || attempt.state === "cancelled") return;
            attempt.state = "failed";
            attempt.error = error;
            failureCount += 1;
            safeNotify(options.onAttempt, {
              index,
              state: "failed",
              target,
              durationMs: monotonicNow() - startedAt,
              errorKind: errorKind(error),
              message: String(error?.message ?? error ?? "request failed").slice(0, 180),
            });
            failIfComplete();
          });
      };

      candidates.forEach((target, index) => {
        const delayMs = delayFor(index);
        if (delayMs === 0) launch(target, index);
        else timers.push(setTimeout(() => launch(target, index), delayMs));
      });
    });
  }

  root.InPulsOrderBookNetwork = Object.freeze({
    DEFAULT_DELAYS_MS,
    errorKind,
    firstSuccessful,
  });
})(typeof self !== "undefined" ? self : globalThis);
