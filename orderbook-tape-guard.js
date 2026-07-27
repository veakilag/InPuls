(function installInPulsTapeGuard(globalScope) {
  "use strict";

  const DEFAULT_RAW_WARMUP_TRADES = 6;
  const DEFAULT_RAW_STALE_MS = 1_500;

  function finiteInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
  }

  class InPulsTapeGuard {
    constructor(options = {}) {
      this.rawWarmupTrades = Math.max(2, Math.floor(Number(options.rawWarmupTrades) || DEFAULT_RAW_WARMUP_TRADES));
      this.rawStaleMs = Math.max(250, Math.floor(Number(options.rawStaleMs) || DEFAULT_RAW_STALE_MS));
      this.reset();
    }

    reset({ lastOutputTradeId = null } = {}) {
      this.connected = false;
      this.mode = "agg";
      this.lastRawTradeId = null;
      this.lastRawAt = 0;
      this.lastAggAt = 0;
      this.rawStreak = 0;
      this.rawGapCount = 0;
      this.rawOutOfOrderCount = 0;
      this.overlapSkips = 0;
      this.duplicateSkips = 0;
      this.invalidCount = 0;
      this.switchCount = 0;
      this.lastSwitchReason = "startup";
      this.lastOutputTradeId = finiteInteger(lastOutputTradeId);
    }

    connect() {
      this.connected = true;
      this.mode = "agg";
      this.lastRawTradeId = null;
      this.lastRawAt = 0;
      this.lastAggAt = 0;
      this.rawStreak = 0;
      this.lastSwitchReason = "socket-open";
    }

    disconnect(reason = "socket-close") {
      this.connected = false;
      this.mode = "agg";
      this.lastRawTradeId = null;
      this.lastRawAt = 0;
      this.lastAggAt = 0;
      this.rawStreak = 0;
      this.lastSwitchReason = reason;
    }

    fallback(reason) {
      if (this.mode !== "agg") this.switchCount += 1;
      this.mode = "agg";
      this.rawStreak = 0;
      this.lastSwitchReason = reason;
    }

    promoteRaw(reason = "raw-warmup-complete") {
      if (this.mode !== "raw") this.switchCount += 1;
      this.mode = "raw";
      this.lastSwitchReason = reason;
    }

    ingest(trade, receivedAt = Date.now()) {
      const now = Number(receivedAt);
      const source = trade?.source === "raw" ? "raw" : trade?.source === "agg" ? "agg" : null;
      const firstTradeId = finiteInteger(trade?.firstTradeId);
      const lastTradeId = finiteInteger(trade?.lastTradeId);
      const price = Number(trade?.price);
      const quantity = Number(trade?.quantity);
      const time = Number(trade?.time);

      if (!source
        || firstTradeId === null
        || lastTradeId === null
        || lastTradeId < firstTradeId
        || !Number.isFinite(now)
        || !Number.isFinite(price)
        || !Number.isFinite(quantity)
        || !Number.isFinite(time)
        || price <= 0
        || quantity <= 0
        || time <= 0) {
        this.invalidCount += 1;
        return this.result(false, "invalid-trade");
      }

      if (source === "raw") return this.ingestRaw(trade, now, firstTradeId);
      return this.ingestAggregate(trade, now, firstTradeId, lastTradeId);
    }

    ingestRaw(trade, now, tradeId) {
      const previousRawId = this.lastRawTradeId;
      let sequenceHealthy = true;

      if (previousRawId !== null) {
        if (tradeId === previousRawId) {
          this.duplicateSkips += 1;
          return this.result(false, "raw-duplicate");
        }
        if (tradeId < previousRawId) {
          this.rawOutOfOrderCount += 1;
          sequenceHealthy = false;
          this.fallback("raw-out-of-order");
        } else if (tradeId > previousRawId + 1) {
          this.rawGapCount += tradeId - previousRawId - 1;
          sequenceHealthy = false;
          this.fallback("raw-gap");
        }
      }

      this.lastRawTradeId = previousRawId === null ? tradeId : Math.max(previousRawId, tradeId);
      this.lastRawAt = now;
      this.rawStreak = sequenceHealthy ? this.rawStreak + 1 : 1;

      if (this.mode === "agg"
        && this.rawStreak >= this.rawWarmupTrades
        && this.isStrictlyAfterBoundary(tradeId, tradeId)) {
        this.promoteRaw();
      }

      if (this.mode !== "raw") return this.result(false, "raw-warmup");
      return this.emitIfSafe(trade, tradeId, tradeId, "raw-live");
    }

    ingestAggregate(trade, now, firstTradeId, lastTradeId) {
      this.lastAggAt = now;

      if (this.mode === "raw" && this.lastRawAt > 0 && now - this.lastRawAt > this.rawStaleMs) {
        this.fallback("raw-stale");
      }

      if (this.mode !== "agg") return this.result(false, "agg-shadow");
      return this.emitIfSafe(trade, firstTradeId, lastTradeId, "agg-live");
    }

    advanceBoundary(lastTradeId) {
      const value = finiteInteger(lastTradeId);
      if (value === null) return;
      this.lastOutputTradeId = this.lastOutputTradeId === null
        ? value
        : Math.max(this.lastOutputTradeId, value);
    }

    isStrictlyAfterBoundary(firstTradeId, lastTradeId) {
      if (this.lastOutputTradeId === null) return true;
      return firstTradeId > this.lastOutputTradeId && lastTradeId > this.lastOutputTradeId;
    }

    emitIfSafe(trade, firstTradeId, lastTradeId, reason) {
      if (this.lastOutputTradeId !== null) {
        if (lastTradeId <= this.lastOutputTradeId) {
          this.duplicateSkips += 1;
          return this.result(false, `${reason}-duplicate`);
        }
        if (firstTradeId <= this.lastOutputTradeId) {
          this.overlapSkips += 1;
          return this.result(false, `${reason}-overlap`);
        }
      }

      this.lastOutputTradeId = lastTradeId;
      return this.result(true, reason, trade);
    }

    label() {
      if (!this.connected) return "TAPE RECONNECT";
      return this.mode === "raw" ? "RAW SHADOW" : "AGG LIVE";
    }

    snapshot(now = Date.now()) {
      const current = Number(now);
      return {
        connected: this.connected,
        mode: this.mode,
        label: this.label(),
        lastSwitchReason: this.lastSwitchReason,
        lastOutputTradeId: this.lastOutputTradeId,
        lastRawTradeId: this.lastRawTradeId,
        rawStreak: this.rawStreak,
        rawGapCount: this.rawGapCount,
        rawOutOfOrderCount: this.rawOutOfOrderCount,
        overlapSkips: this.overlapSkips,
        duplicateSkips: this.duplicateSkips,
        invalidCount: this.invalidCount,
        switchCount: this.switchCount,
        rawAgeMs: this.lastRawAt > 0 && Number.isFinite(current) ? Math.max(0, current - this.lastRawAt) : null,
        aggAgeMs: this.lastAggAt > 0 && Number.isFinite(current) ? Math.max(0, current - this.lastAggAt) : null,
      };
    }

    result(emit, reason, trade = null) {
      return {
        emit: Boolean(emit),
        reason,
        mode: this.mode,
        label: this.label(),
        trade,
      };
    }
  }

  globalScope.InPulsTapeGuard = InPulsTapeGuard;
})(typeof self !== "undefined" ? self : globalThis);
