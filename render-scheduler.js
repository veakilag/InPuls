export class LatestFrameScheduler {
  constructor({
    render,
    budgetMs = 8,
    maxPerFrame = 2,
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (handle) => cancelAnimationFrame(handle),
    now = () => performance.now(),
    onFrame = null,
    onError = null,
  } = {}) {
    if (typeof render !== "function") throw new TypeError("render callback is required");
    this.render = render;
    this.budgetMs = Math.max(1, Number(budgetMs) || 8);
    this.maxPerFrame = Math.max(1, Math.floor(Number(maxPerFrame) || 2));
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.now = now;
    this.onFrame = onFrame;
    this.onError = onError;
    this.queue = [];
    this.queued = new Set();
    this.metadata = new Map();
    this.frame = 0;
    this.coalesced = 0;
    this.destroyed = false;
  }

  get pending() {
    return this.queued.size;
  }

  schedule(item, { urgent = false } = {}) {
    if (this.destroyed || item === null || item === undefined) return false;
    const existing = this.metadata.get(item);
    if (this.queued.has(item)) {
      this.coalesced += 1;
      if (urgent && !existing?.urgent) {
        this.metadata.set(item, { ...(existing ?? {}), urgent: true });
        this.queue.unshift(item);
      }
      this.ensureFrame();
      return false;
    }

    this.queued.add(item);
    this.metadata.set(item, { queuedAt: this.now(), urgent });
    if (urgent) this.queue.unshift(item);
    else this.queue.push(item);
    this.ensureFrame();
    return true;
  }

  remove(item) {
    const removed = this.queued.delete(item);
    this.metadata.delete(item);
    return removed;
  }

  ensureFrame() {
    if (this.destroyed || this.frame || !this.queued.size) return;
    this.frame = this.requestFrame((timestamp) => this.flush(timestamp));
  }

  flush(timestamp = this.now()) {
    if (this.destroyed) return;
    this.frame = 0;
    const startedAt = this.now();
    let processed = 0;
    let skipped = 0;

    while (this.queue.length && processed < this.maxPerFrame) {
      const item = this.queue.shift();
      if (!this.queued.delete(item)) {
        skipped += 1;
        continue;
      }
      const metadata = this.metadata.get(item) ?? {};
      this.metadata.delete(item);
      const queuedAt = Number(metadata.queuedAt);
      try {
        this.render(item, {
          ...metadata,
          frameTimestamp: timestamp,
          waitMs: Math.max(0, startedAt - (Number.isFinite(queuedAt) ? queuedAt : startedAt)),
        });
      } catch (error) {
        if (typeof this.onError === "function") this.onError(error, item);
        else setTimeout(() => { throw error; }, 0);
      }
      processed += 1;
      if (this.now() - startedAt >= this.budgetMs) break;
    }

    const durationMs = Math.max(0, this.now() - startedAt);
    const yielded = this.queued.size > 0;
    if (typeof this.onFrame === "function") {
      this.onFrame({
        processed,
        skipped,
        pending: this.queued.size,
        yielded,
        durationMs,
        coalesced: this.coalesced,
      });
    }
    this.coalesced = 0;
    if (yielded) this.ensureFrame();
  }

  destroy() {
    this.destroyed = true;
    if (this.frame) this.cancelFrame(this.frame);
    this.frame = 0;
    this.queue.length = 0;
    this.queued.clear();
    this.metadata.clear();
  }
}
