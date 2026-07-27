(function installInPulsOrderBookBuffers(scope) {
  "use strict";

  function safeCapacity(value) {
    return Math.max(1, Math.floor(Number(value) || 1));
  }

  class RecentRingBuffer {
    constructor(capacity) {
      this.capacity = safeCapacity(capacity);
      this.items = new Array(this.capacity);
      this.start = 0;
      this.size = 0;
    }

    get length() {
      return this.size;
    }

    clear() {
      this.items = new Array(this.capacity);
      this.start = 0;
      this.size = 0;
    }

    prepend(value) {
      const nextStart = (this.start - 1 + this.capacity) % this.capacity;
      const evicted = this.size === this.capacity ? this.items[nextStart] : null;
      this.start = nextStart;
      this.items[this.start] = value;
      if (this.size < this.capacity) this.size += 1;
      return evicted;
    }

    append(value) {
      if (this.size === this.capacity) return value;
      this.items[(this.start + this.size) % this.capacity] = value;
      this.size += 1;
      return null;
    }

    replace(values) {
      this.clear();
      for (const value of values ?? []) {
        if (this.size === this.capacity) break;
        this.append(value);
      }
    }

    toArray(limit = this.size) {
      const count = Math.max(0, Math.min(this.size, Math.floor(Number(limit) || 0)));
      return Array.from(
        { length: count },
        (_, index) => this.items[(this.start + index) % this.capacity],
      );
    }

    [Symbol.iterator]() {
      return this.toArray()[Symbol.iterator]();
    }
  }

  class LatestBatchQueue {
    constructor(capacity) {
      this.capacity = safeCapacity(capacity);
      this.items = new Array(this.capacity);
      this.start = 0;
      this.size = 0;
      this.overwritten = 0;
    }

    get length() {
      return this.size;
    }

    clear() {
      this.start = 0;
      this.size = 0;
      this.overwritten = 0;
    }

    push(value) {
      if (this.size < this.capacity) {
        this.items[(this.start + this.size) % this.capacity] = value;
        this.size += 1;
        return null;
      }
      const evicted = this.items[this.start];
      this.items[this.start] = value;
      this.start = (this.start + 1) % this.capacity;
      this.overwritten += 1;
      return evicted;
    }

    takeLatest(limit = this.size) {
      const count = Math.max(0, Math.min(this.size, Math.floor(Number(limit) || 0)));
      const skipped = this.size - count;
      const first = (this.start + skipped) % this.capacity;
      const items = Array.from(
        { length: count },
        (_, index) => this.items[(first + index) % this.capacity],
      );
      const dropped = this.overwritten + skipped;
      this.clear();
      return { items, dropped };
    }
  }

  scope.InPulsOrderBookBuffers = { RecentRingBuffer, LatestBatchQueue };
})(typeof self !== "undefined" ? self : globalThis);
