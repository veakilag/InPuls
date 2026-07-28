(function installInPulsOrderBookDensity(scope) {
  "use strict";

  const DEFAULT_CONFIG = Object.freeze({
    sampleLevels: 200,
    minSampleLevels: 20,
    entryMedianMultiplier: 6,
    entryP90Multiplier: 1.5,
    exitThresholdRatio: 0.6,
    referenceRefreshMs: 250,
    fadeGraceMs: 1_000,
    transitionHoldMs: 1_500,
    replenishWindowMs: 5_000,
    replenishRestoreRatio: 0.8,
    maxActive: 64,
    maxClosed: 64,
    summaryLimit: 12,
    closedSummaryLimit: 6,
    closedRetentionMs: 15_000,
  });

  const DENSITY_STATES = Object.freeze({
    APPEARED: "appeared",
    STANDING: "standing",
    STRENGTHENING: "strengthening",
    WEAKENING: "weakening",
    REPLENISHED: "replenished",
    REMOVED: "removed",
    FADED: "faded",
  });

  function finitePositive(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  }

  function finiteNonNegative(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
  }

  function safeInteger(value, fallback, minimum = 0) {
    const numeric = Math.floor(Number(value));
    return Number.isFinite(numeric) && numeric >= minimum ? numeric : fallback;
  }

  function safeTimestamp(value, fallback = Date.now()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  }

  function normalizeSide(value) {
    return value === "ask" ? "ask" : value === "bid" ? "bid" : null;
  }

  function normalizeConfig(options = {}) {
    return Object.freeze({
      sampleLevels: safeInteger(options.sampleLevels, DEFAULT_CONFIG.sampleLevels, 1),
      minSampleLevels: safeInteger(options.minSampleLevels, DEFAULT_CONFIG.minSampleLevels, 1),
      entryMedianMultiplier: finitePositive(
        options.entryMedianMultiplier,
        DEFAULT_CONFIG.entryMedianMultiplier,
      ),
      entryP90Multiplier: finitePositive(
        options.entryP90Multiplier,
        DEFAULT_CONFIG.entryP90Multiplier,
      ),
      exitThresholdRatio: Math.min(
        1,
        finitePositive(options.exitThresholdRatio, DEFAULT_CONFIG.exitThresholdRatio),
      ),
      referenceRefreshMs: finiteNonNegative(
        options.referenceRefreshMs,
        DEFAULT_CONFIG.referenceRefreshMs,
      ),
      fadeGraceMs: finiteNonNegative(options.fadeGraceMs, DEFAULT_CONFIG.fadeGraceMs),
      transitionHoldMs: finiteNonNegative(
        options.transitionHoldMs,
        DEFAULT_CONFIG.transitionHoldMs,
      ),
      replenishWindowMs: finiteNonNegative(
        options.replenishWindowMs,
        DEFAULT_CONFIG.replenishWindowMs,
      ),
      replenishRestoreRatio: Math.min(
        1,
        finitePositive(options.replenishRestoreRatio, DEFAULT_CONFIG.replenishRestoreRatio),
      ),
      maxActive: safeInteger(options.maxActive, DEFAULT_CONFIG.maxActive, 1),
      maxClosed: safeInteger(options.maxClosed, DEFAULT_CONFIG.maxClosed, 1),
      summaryLimit: safeInteger(options.summaryLimit, DEFAULT_CONFIG.summaryLimit, 1),
      closedSummaryLimit: safeInteger(
        options.closedSummaryLimit,
        DEFAULT_CONFIG.closedSummaryLimit,
        0,
      ),
      closedRetentionMs: finiteNonNegative(
        options.closedRetentionMs,
        DEFAULT_CONFIG.closedRetentionMs,
      ),
    });
  }

  function percentileSorted(sorted, ratio) {
    if (!sorted.length) return null;
    const bounded = Math.max(0, Math.min(1, Number(ratio) || 0));
    const position = (sorted.length - 1) * bounded;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function orderedLevels(levels, side, limit) {
    const mapInput = levels instanceof Map;
    const rows = mapInput ? [...levels.entries()] : [...(levels ?? [])].slice(0, limit);
    const clean = [];
    for (const row of rows) {
      const price = Number(row?.[0]);
      const quantity = Number(row?.[1]);
      if (
        !Number.isFinite(price)
        || price <= 0
        || !Number.isFinite(quantity)
        || quantity <= 0
      ) continue;
      clean.push([price, quantity]);
    }
    if (mapInput) {
      clean.sort(side === "bid" ? (a, b) => b[0] - a[0] : (a, b) => a[0] - b[0]);
    }
    return clean.slice(0, limit);
  }

  function emptyReference(side, at = null) {
    return {
      side,
      available: false,
      sampledLevels: 0,
      medianQuote: null,
      p90Quote: null,
      entryQuote: null,
      exitQuote: null,
      computedAt: at,
    };
  }

  function computeSideReference(levels, side, options = {}, at = Date.now()) {
    const config = normalizeConfig(options);
    const rows = orderedLevels(levels, side, config.sampleLevels);
    const quotes = rows
      .map(([price, quantity]) => price * quantity)
      .filter((quote) => Number.isFinite(quote) && quote > 0)
      .sort((a, b) => a - b);
    if (quotes.length < config.minSampleLevels) {
      return {
        ...emptyReference(side, safeTimestamp(at)),
        sampledLevels: quotes.length,
        rows,
      };
    }
    const medianQuote = percentileSorted(quotes, 0.5);
    const p90Quote = percentileSorted(quotes, 0.9);
    const entryQuote = Math.max(
      medianQuote * config.entryMedianMultiplier,
      p90Quote * config.entryP90Multiplier,
    );
    return {
      side,
      available: true,
      sampledLevels: quotes.length,
      medianQuote,
      p90Quote,
      entryQuote,
      exitQuote: entryQuote * config.exitThresholdRatio,
      computedAt: safeTimestamp(at),
      rows,
    };
  }

  function publicReference(reference) {
    const { rows, ...summary } = reference;
    return summary;
  }

  function emptyCounts() {
    return {
      detected: 0,
      strengthened: 0,
      weakened: 0,
      replenished: 0,
      removed: 0,
      faded: 0,
      capacity: 0,
    };
  }

  class DensityLifecycleTracker {
    constructor({
      symbol = null,
      venue = "binance-usdm",
      ...options
    } = {}) {
      this.config = normalizeConfig(options);
      this.symbol = String(symbol ?? "").toUpperCase() || null;
      this.venue = String(venue ?? "") || null;
      this.state = "idle";
      this.bookEpoch = 0;
      this.resetReason = null;
      this.resetAt = null;
      this.readyAt = null;
      this.lastRefreshAt = null;
      this.references = {
        bid: emptyReference("bid"),
        ask: emptyReference("ask"),
      };
      this.active = new Map();
      this.closed = [];
      this.epochCounts = emptyCounts();
      this.totalCounts = emptyCounts();
    }

    #key(side, price) {
      return `${side}:${price}`;
    }

    #count(name) {
      if (!(name in this.epochCounts)) return;
      this.epochCounts[name] += 1;
      this.totalCounts[name] += 1;
    }

    #reference(side) {
      return this.references[side] ?? emptyReference(side);
    }

    #score(quote, side) {
      const median = Number(this.#reference(side).medianQuote);
      return Number.isFinite(median) && median > 0 ? quote / median : null;
    }

    #distanceBps(price, middlePrice) {
      return Number.isFinite(middlePrice) && middlePrice > 0
        ? Math.abs(price - middlePrice) / middlePrice * 10_000
        : null;
    }

    #open({
      side,
      price,
      quantity,
      at,
      source,
      state,
      observedBeforeDetection,
      continuity = null,
      sequence = null,
      middlePrice = null,
    }) {
      const quote = price * quantity;
      const score = this.#score(quote, side);
      const record = {
        id: `${this.bookEpoch}:${side}:${price}`,
        symbol: this.symbol,
        venue: this.venue,
        bookEpoch: this.bookEpoch,
        side,
        price,
        state,
        source,
        observedBeforeDetection: Boolean(observedBeforeDetection),
        continuity,
        firstObservedAt: at,
        firstSignificantAt: at,
        lastChangedAt: at,
        stateChangedAt: at,
        currentQuantity: quantity,
        currentQuote: quote,
        maxQuantity: quantity,
        maxQuote: quote,
        maxAt: at,
        score,
        maxScore: score,
        referenceMedianQuote: this.#reference(side).medianQuote,
        entryQuote: this.#reference(side).entryQuote,
        exitQuote: this.#reference(side).exitQuote,
        distanceBps: this.#distanceBps(price, middlePrice),
        eventCount: 0,
        increaseCount: 0,
        decreaseCount: 0,
        replenishmentCount: 0,
        lastDecreaseAt: null,
        quantityBeforeDecrease: null,
        lastReplenishedAt: null,
        lastSequence: sequence,
        belowThresholdSince: null,
        closedAt: null,
        closeReason: null,
      };
      this.active.set(this.#key(side, price), record);
      this.#count("detected");
      return record;
    }

    #close(record, reason, at) {
      const key = this.#key(record.side, record.price);
      if (!this.active.has(key)) return;
      this.active.delete(key);
      record.closedAt = at;
      record.closeReason = reason;
      record.lastChangedAt = at;
      record.stateChangedAt = at;
      if (reason === "removed") {
        record.state = DENSITY_STATES.REMOVED;
        this.#count("removed");
      } else {
        record.state = DENSITY_STATES.FADED;
        this.#count(reason === "capacity" ? "capacity" : "faded");
      }
      this.closed.unshift(record);
      if (this.closed.length > this.config.maxClosed) {
        this.closed.length = this.config.maxClosed;
      }
    }

    #pruneClosed(now) {
      const cutoff = now - this.config.closedRetentionMs;
      this.closed = this.closed
        .filter((record) => Number(record.closedAt) >= cutoff)
        .slice(0, this.config.maxClosed);
    }

    #enforceCapacity(now) {
      if (this.active.size <= this.config.maxActive) return;
      const overflow = [...this.active.values()]
        .sort((left, right) => {
          const scoreDifference = (left.score ?? 0) - (right.score ?? 0);
          return scoreDifference || left.currentQuote - right.currentQuote;
        })
        .slice(0, this.active.size - this.config.maxActive);
      for (const record of overflow) this.#close(record, "capacity", now);
    }

    #refreshRecordReference(record, middlePrice = null) {
      const reference = this.#reference(record.side);
      record.referenceMedianQuote = reference.medianQuote;
      record.entryQuote = reference.entryQuote;
      record.exitQuote = reference.exitQuote;
      record.score = this.#score(record.currentQuote, record.side);
      record.maxScore = record.maxScore === null
        ? record.score
        : Math.max(record.maxScore, record.score ?? record.maxScore);
      if (Number.isFinite(middlePrice) && middlePrice > 0) {
        record.distanceBps = this.#distanceBps(record.price, middlePrice);
      }
    }

    #maybeOpenFromRow(side, row, at, source, middlePrice) {
      const price = Number(row?.[0]);
      const quantity = Number(row?.[1]);
      if (
        !Number.isFinite(price)
        || price <= 0
        || !Number.isFinite(quantity)
        || quantity <= 0
      ) return null;
      const key = this.#key(side, price);
      const existing = this.active.get(key);
      if (existing) {
        existing.currentQuantity = quantity;
        existing.currentQuote = price * quantity;
        this.#refreshRecordReference(existing, middlePrice);
        return existing;
      }
      const reference = this.#reference(side);
      const quote = price * quantity;
      if (!reference.available || quote < reference.entryQuote) return null;
      return this.#open({
        side,
        price,
        quantity,
        at,
        source,
        state: DENSITY_STATES.STANDING,
        observedBeforeDetection: true,
        middlePrice,
      });
    }

    #middlePrice(bidRows, askRows) {
      const bestBid = Number(bidRows?.[0]?.[0]);
      const bestAsk = Number(askRows?.[0]?.[0]);
      return Number.isFinite(bestBid) && Number.isFinite(bestAsk)
        ? (bestBid + bestAsk) / 2
        : null;
    }

    setSymbol(symbol) {
      const nextSymbol = String(symbol ?? "").toUpperCase() || null;
      if (nextSymbol !== this.symbol) this.totalCounts = emptyCounts();
      this.symbol = nextSymbol;
    }

    reset({
      bookEpoch = this.bookEpoch + 1,
      reason = "reset",
      at = Date.now(),
    } = {}) {
      this.bookEpoch = Math.max(0, Math.floor(Number(bookEpoch) || 0));
      this.state = "syncing";
      this.resetReason = String(reason || "reset");
      this.resetAt = safeTimestamp(at);
      this.readyAt = null;
      this.lastRefreshAt = null;
      this.references = {
        bid: emptyReference("bid", this.resetAt),
        ask: emptyReference("ask", this.resetAt),
      };
      this.active.clear();
      this.closed = [];
      this.epochCounts = emptyCounts();
      return this.bookEpoch;
    }

    seedSnapshot({
      bids,
      asks,
      bookEpoch = this.bookEpoch,
      receivedAt = Date.now(),
    }) {
      const at = safeTimestamp(receivedAt);
      this.bookEpoch = Math.max(0, Math.floor(Number(bookEpoch) || 0));
      this.state = "recovering";
      const bidReference = computeSideReference(bids, "bid", this.config, at);
      const askReference = computeSideReference(asks, "ask", this.config, at);
      this.references = { bid: bidReference, ask: askReference };
      this.lastRefreshAt = at;
      const middlePrice = this.#middlePrice(bidReference.rows, askReference.rows);
      for (const row of bidReference.rows) {
        this.#maybeOpenFromRow("bid", row, at, "snapshot", middlePrice);
      }
      for (const row of askReference.rows) {
        this.#maybeOpenFromRow("ask", row, at, "snapshot", middlePrice);
      }
      this.#enforceCapacity(at);
      return this.summary(at);
    }

    markReady({ at = Date.now() } = {}) {
      this.state = "live";
      this.readyAt = safeTimestamp(at);
    }

    markUnavailable(reason = "partial-depth", at = Date.now()) {
      const timestamp = safeTimestamp(at);
      this.state = "partial";
      this.resetReason = String(reason || "partial-depth");
      this.resetAt = timestamp;
      this.readyAt = null;
      this.lastRefreshAt = null;
      this.references = {
        bid: emptyReference("bid", timestamp),
        ask: emptyReference("ask", timestamp),
      };
      this.active.clear();
      this.closed = [];
      this.epochCounts = emptyCounts();
    }

    ingest(events) {
      if (this.state === "partial" || this.state === "idle") return [];
      const changed = [];
      for (const event of events ?? []) {
        const side = normalizeSide(event?.side);
        const price = Number(event?.price);
        const quantity = Number(event?.quantity);
        if (
          !side
          || !Number.isFinite(price)
          || price <= 0
          || !Number.isFinite(quantity)
          || quantity < 0
          || Number(event?.bookEpoch) !== this.bookEpoch
        ) continue;
        const at = safeTimestamp(event?.receivedAt ?? event?.eventTime);
        const key = this.#key(side, price);
        let record = this.active.get(key);
        const quote = price * quantity;
        if (!record) {
          const reference = this.#reference(side);
          if (
            quantity <= 0
            || !reference.available
            || quote < reference.entryQuote
          ) continue;
          record = this.#open({
            side,
            price,
            quantity,
            at,
            source: "depth-event",
            state: event.type === "appeared"
              ? DENSITY_STATES.APPEARED
              : DENSITY_STATES.STRENGTHENING,
            observedBeforeDetection: event.type !== "appeared",
            continuity: event.continuity ?? null,
            sequence: event.sequence ?? null,
          });
          record.eventCount = 1;
          if (event.type === "increased") {
            record.increaseCount = 1;
            this.#count("strengthened");
          }
          changed.push(record);
          continue;
        }

        record.eventCount += 1;
        record.lastChangedAt = at;
        record.stateChangedAt = at;
        record.lastSequence = event.sequence ?? record.lastSequence;
        record.continuity = event.continuity ?? record.continuity;
        record.currentQuantity = quantity;
        record.currentQuote = quote;

        if (event.type === "removed" || quantity === 0) {
          changed.push(record);
          this.#close(record, "removed", at);
          continue;
        }

        if (event.type === "decreased") {
          record.state = DENSITY_STATES.WEAKENING;
          record.decreaseCount += 1;
          record.lastDecreaseAt = at;
          record.quantityBeforeDecrease = Math.max(
            Number(event.previousQuantity) || 0,
            record.quantityBeforeDecrease || 0,
          );
          this.#count("weakened");
        } else if (event.type === "increased" || event.type === "appeared") {
          record.increaseCount += 1;
          const replenished = Number.isFinite(record.lastDecreaseAt)
            && at - record.lastDecreaseAt <= this.config.replenishWindowMs
            && quantity >= (
              finitePositive(record.quantityBeforeDecrease, quantity)
              * this.config.replenishRestoreRatio
            );
          if (replenished) {
            record.state = DENSITY_STATES.REPLENISHED;
            record.replenishmentCount += 1;
            record.lastReplenishedAt = at;
            record.lastDecreaseAt = null;
            record.quantityBeforeDecrease = null;
            this.#count("replenished");
          } else {
            record.state = DENSITY_STATES.STRENGTHENING;
            this.#count("strengthened");
          }
        }

        if (quantity > record.maxQuantity) {
          record.maxQuantity = quantity;
          record.maxQuote = quote;
          record.maxAt = at;
        }
        this.#refreshRecordReference(record);
        const exitQuote = Number(record.exitQuote);
        if (Number.isFinite(exitQuote) && quote < exitQuote) {
          record.belowThresholdSince ??= at;
        } else {
          record.belowThresholdSince = null;
        }
        changed.push(record);
      }
      this.#enforceCapacity(Date.now());
      return changed;
    }

    refresh({
      bids,
      asks,
      now = Date.now(),
      force = false,
    } = {}) {
      if (this.state === "partial" || this.state === "idle" || this.state === "syncing") {
        return false;
      }
      const at = safeTimestamp(now);
      if (
        !force
        && Number.isFinite(this.lastRefreshAt)
        && at - this.lastRefreshAt < this.config.referenceRefreshMs
      ) return false;

      const bidReference = computeSideReference(bids, "bid", this.config, at);
      const askReference = computeSideReference(asks, "ask", this.config, at);
      this.references = { bid: bidReference, ask: askReference };
      this.lastRefreshAt = at;
      const middlePrice = this.#middlePrice(bidReference.rows, askReference.rows);

      for (const row of bidReference.rows) {
        this.#maybeOpenFromRow("bid", row, at, "scan", middlePrice);
      }
      for (const row of askReference.rows) {
        this.#maybeOpenFromRow("ask", row, at, "scan", middlePrice);
      }

      for (const record of [...this.active.values()]) {
        this.#refreshRecordReference(record, middlePrice);
        if (
          record.state !== DENSITY_STATES.STANDING
          && at - record.stateChangedAt >= this.config.transitionHoldMs
        ) {
          record.state = DENSITY_STATES.STANDING;
          record.stateChangedAt = at;
        }
        const exitQuote = Number(record.exitQuote);
        if (Number.isFinite(exitQuote) && record.currentQuote < exitQuote) {
          record.belowThresholdSince ??= at;
          if (at - record.belowThresholdSince >= this.config.fadeGraceMs) {
            this.#close(record, "below-threshold", at);
          }
        } else {
          record.belowThresholdSince = null;
        }
      }

      this.#pruneClosed(at);
      this.#enforceCapacity(at);
      return true;
    }

    #publicRecord(record, now) {
      return {
        id: record.id,
        side: record.side,
        price: record.price,
        state: record.state,
        currentQuantity: record.currentQuantity,
        currentQuote: record.currentQuote,
        maxQuantity: record.maxQuantity,
        maxQuote: record.maxQuote,
        score: record.score,
        maxScore: record.maxScore,
        ageMs: Math.max(0, now - record.firstObservedAt),
        significantAgeMs: Math.max(0, now - record.firstSignificantAt),
        firstObservedAt: record.firstObservedAt,
        lastChangedAt: record.lastChangedAt,
        maxAt: record.maxAt,
        distanceBps: record.distanceBps,
        source: record.source,
        observedBeforeDetection: record.observedBeforeDetection,
        continuity: record.continuity,
        eventCount: record.eventCount,
        increaseCount: record.increaseCount,
        decreaseCount: record.decreaseCount,
        replenishmentCount: record.replenishmentCount,
        lastReplenishedAt: record.lastReplenishedAt,
        closedAt: record.closedAt,
        closeReason: record.closeReason,
      };
    }

    summary(now = Date.now()) {
      const at = safeTimestamp(now);
      this.#pruneClosed(at);
      const densities = [...this.active.values()]
        .sort((left, right) => {
          const scoreDifference = (right.score ?? 0) - (left.score ?? 0);
          return scoreDifference || right.currentQuote - left.currentQuote;
        })
        .slice(0, this.config.summaryLimit)
        .map((record) => this.#publicRecord(record, at));
      const recentlyClosed = this.closed
        .slice(0, this.config.closedSummaryLimit)
        .map((record) => this.#publicRecord(record, at));
      return {
        version: 1,
        symbol: this.symbol,
        venue: this.venue,
        state: this.state,
        bookEpoch: this.bookEpoch,
        resetReason: this.resetReason,
        resetAt: this.resetAt,
        readyAt: this.readyAt,
        computedAt: at,
        activeCount: this.active.size,
        retainedClosed: this.closed.length,
        references: {
          bid: publicReference(this.references.bid),
          ask: publicReference(this.references.ask),
        },
        densities,
        recentlyClosed,
        epochCounts: { ...this.epochCounts },
        totalCounts: { ...this.totalCounts },
        quality: {
          complete: this.state === "live"
            && this.references.bid.available
            && this.references.ask.available,
          depth: this.state,
          causality: "depth-only",
          age: "observed-since-detection",
        },
      };
    }
  }

  scope.InPulsOrderBookDensity = Object.freeze({
    DEFAULT_CONFIG,
    DENSITY_STATES,
    DensityLifecycleTracker,
    computeSideReference,
    percentileSorted,
  });
})(typeof self !== "undefined" ? self : globalThis);
