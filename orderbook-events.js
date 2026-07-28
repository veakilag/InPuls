(function installInPulsOrderBookEvents(scope) {
  "use strict";

  const DEFAULT_HISTORY_CAPACITY = 4_000;
  const EVENT_TYPES = Object.freeze({
    APPEARED: "appeared",
    INCREASED: "increased",
    DECREASED: "decreased",
    REMOVED: "removed",
  });
  const SIDES = Object.freeze({
    BID: "bid",
    ASK: "ask",
  });

  function safeCapacity(value) {
    return Math.max(1, Math.floor(Number(value) || DEFAULT_HISTORY_CAPACITY));
  }

  function safeTimestamp(value, fallback = null) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
  }

  function safeUpdateId(value) {
    if (value === null || value === undefined || value === "") return null;
    const updateId = Number(value);
    return Number.isSafeInteger(updateId) && updateId >= 0 ? updateId : null;
  }

  function applySnapshotSide(levels, rows) {
    levels.clear();
    for (const row of rows ?? []) {
      const price = Number(row?.[0]);
      const quantity = Number(row?.[1]);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) continue;
      levels.set(price, quantity);
    }
  }

  function seedDepthSnapshot({ bids, asks, snapshot }) {
    if (!(bids instanceof Map) || !(asks instanceof Map)) {
      throw new TypeError("bids and asks must be Map instances");
    }
    const snapshotId = safeUpdateId(snapshot?.lastUpdateId);
    if (snapshotId === null) throw new TypeError("snapshot.lastUpdateId must be finite");
    applySnapshotSide(bids, snapshot?.bids);
    applySnapshotSide(asks, snapshot?.asks);
    return {
      snapshotId,
      bids: bids.size,
      asks: asks.size,
    };
  }

  function classifyDepthChange(previousQuantity, quantity) {
    if (quantity === previousQuantity) return null;
    if (previousQuantity <= 0 && quantity > 0) return EVENT_TYPES.APPEARED;
    if (previousQuantity > 0 && quantity === 0) return EVENT_TYPES.REMOVED;
    if (previousQuantity > 0 && quantity > previousQuantity) return EVENT_TYPES.INCREASED;
    if (previousQuantity > 0 && quantity < previousQuantity) return EVENT_TYPES.DECREASED;
    return null;
  }

  function applyDepthSide(levels, rows, side, metadata) {
    const events = [];
    let rowIndex = 0;
    for (const row of rows ?? []) {
      const price = Number(row?.[0]);
      const quantity = Number(row?.[1]);
      const currentRowIndex = rowIndex;
      rowIndex += 1;
      if (
        !Number.isFinite(price)
        || price <= 0
        || !Number.isFinite(quantity)
        || quantity < 0
      ) continue;

      const storedQuantity = Number(levels.get(price));
      const previousQuantity = Number.isFinite(storedQuantity) && storedQuantity > 0
        ? storedQuantity
        : 0;
      const type = classifyDepthChange(previousQuantity, quantity);
      if (!type) continue;

      if (quantity === 0) levels.delete(price);
      else levels.set(price, quantity);

      events.push({
        type,
        side,
        price,
        previousQuantity,
        quantity,
        deltaQuantity: quantity - previousQuantity,
        previousQuote: price * previousQuantity,
        quote: price * quantity,
        deltaQuote: price * (quantity - previousQuantity),
        eventTime: metadata.eventTime,
        transactionTime: metadata.transactionTime,
        receivedAt: metadata.receivedAt,
        firstUpdateId: metadata.firstUpdateId,
        finalUpdateId: metadata.finalUpdateId,
        previousFinalUpdateId: metadata.previousFinalUpdateId,
        bookEpoch: metadata.bookEpoch,
        continuity: metadata.continuity,
        symbol: metadata.symbol,
        venue: metadata.venue,
        source: "depth-diff",
        rowIndex: currentRowIndex,
      });
    }
    return events;
  }

  function applyDepthDiff({
    bids,
    asks,
    event,
    bookEpoch = 0,
    continuity = "live",
    receivedAt = Date.now(),
    symbol = null,
    venue = "binance-usdm",
  }) {
    if (!(bids instanceof Map) || !(asks instanceof Map)) {
      throw new TypeError("bids and asks must be Map instances");
    }
    const receivedTimestamp = safeTimestamp(receivedAt, Date.now());
    const metadata = {
      eventTime: safeTimestamp(event?.E, receivedTimestamp),
      transactionTime: safeTimestamp(event?.T, null),
      receivedAt: receivedTimestamp,
      firstUpdateId: safeUpdateId(event?.U),
      finalUpdateId: safeUpdateId(event?.u),
      previousFinalUpdateId: safeUpdateId(event?.pu),
      bookEpoch: Math.max(0, Math.floor(Number(bookEpoch) || 0)),
      continuity: continuity === "recovered" ? "recovered" : "live",
      symbol: String(symbol ?? "").toUpperCase() || null,
      venue: String(venue ?? "") || null,
    };
    return [
      ...applyDepthSide(bids, event?.b ?? event?.bids, SIDES.BID, metadata),
      ...applyDepthSide(asks, event?.a ?? event?.asks, SIDES.ASK, metadata),
    ];
  }

  class DepthEventJournal {
    constructor({
      capacity = DEFAULT_HISTORY_CAPACITY,
      symbol = null,
      venue = "binance-usdm",
    } = {}) {
      this.capacity = safeCapacity(capacity);
      this.symbol = String(symbol ?? "").toUpperCase() || null;
      this.venue = String(venue ?? "") || null;
      this.items = new Array(this.capacity);
      this.start = 0;
      this.size = 0;
      this.sequence = 0;
      this.bookEpoch = 0;
      this.state = "idle";
      this.resetReason = null;
      this.resetAt = null;
      this.snapshotId = null;
      this.snapshotAt = null;
      this.readyAt = null;
      this.lastEventAt = null;
      this.lastUpdateId = null;
      this.totalEvents = 0;
      this.totalCounts = this.#emptyCounts();
      this.epochEvents = 0;
      this.epochCounts = this.#emptyCounts();
    }

    #emptyCounts() {
      return {
        appeared: 0,
        increased: 0,
        decreased: 0,
        removed: 0,
      };
    }

    #clearHistory() {
      this.items = new Array(this.capacity);
      this.start = 0;
      this.size = 0;
    }

    #append(event) {
      if (this.size < this.capacity) {
        this.items[(this.start + this.size) % this.capacity] = event;
        this.size += 1;
        return;
      }
      this.items[this.start] = event;
      this.start = (this.start + 1) % this.capacity;
    }

    reset(reason = "reset", at = Date.now()) {
      this.bookEpoch += 1;
      this.state = "syncing";
      this.resetReason = String(reason || "reset");
      this.resetAt = safeTimestamp(at, Date.now());
      this.snapshotId = null;
      this.snapshotAt = null;
      this.readyAt = null;
      this.lastEventAt = null;
      this.lastUpdateId = null;
      this.epochEvents = 0;
      this.epochCounts = this.#emptyCounts();
      this.#clearHistory();
      return this.bookEpoch;
    }

    setSymbol(symbol) {
      this.symbol = String(symbol ?? "").toUpperCase() || null;
    }

    seedSnapshot({ bids, asks, snapshot, receivedAt = Date.now() }) {
      const baseline = seedDepthSnapshot({ bids, asks, snapshot });
      this.state = "recovering";
      this.snapshotId = baseline.snapshotId;
      this.snapshotAt = safeTimestamp(receivedAt, Date.now());
      this.lastUpdateId = baseline.snapshotId;
      return baseline;
    }

    applyDiff({
      bids,
      asks,
      event,
      continuity = this.state === "live" ? "live" : "recovered",
      receivedAt = Date.now(),
    }) {
      const normalized = applyDepthDiff({
        bids,
        asks,
        event,
        bookEpoch: this.bookEpoch,
        continuity,
        receivedAt,
        symbol: this.symbol,
        venue: this.venue,
      });
      const recorded = normalized.map((eventItem) => {
        this.sequence += 1;
        const item = Object.freeze({
          ...eventItem,
          sequence: this.sequence,
          id: `${this.bookEpoch}:${this.sequence}`,
        });
        this.#append(item);
        this.totalEvents += 1;
        this.epochEvents += 1;
        this.totalCounts[item.type] += 1;
        this.epochCounts[item.type] += 1;
        this.lastEventAt = item.receivedAt;
        return item;
      });
      const finalUpdateId = safeUpdateId(event?.u);
      if (finalUpdateId !== null) this.lastUpdateId = finalUpdateId;
      return recorded;
    }

    markReady({ at = Date.now() } = {}) {
      this.state = "live";
      this.readyAt = safeTimestamp(at, Date.now());
    }

    markUnavailable(reason = "partial-depth", at = Date.now()) {
      this.state = "partial";
      this.resetReason = String(reason || "partial-depth");
      this.resetAt = safeTimestamp(at, Date.now());
      this.snapshotId = null;
      this.snapshotAt = null;
      this.readyAt = null;
      this.lastEventAt = null;
      this.lastUpdateId = null;
      this.epochEvents = 0;
      this.epochCounts = this.#emptyCounts();
      this.#clearHistory();
    }

    recent(limit = this.size) {
      const count = Math.max(0, Math.min(this.size, Math.floor(Number(limit) || 0)));
      const skip = this.size - count;
      return Array.from(
        { length: count },
        (_, index) => this.items[(this.start + skip + index) % this.capacity],
      );
    }

    summary() {
      return {
        version: 1,
        symbol: this.symbol,
        venue: this.venue,
        state: this.state,
        bookEpoch: this.bookEpoch,
        resetReason: this.resetReason,
        resetAt: this.resetAt,
        snapshotId: this.snapshotId,
        snapshotAt: this.snapshotAt,
        readyAt: this.readyAt,
        lastEventAt: this.lastEventAt,
        lastUpdateId: this.lastUpdateId,
        retainedEvents: this.size,
        capacity: this.capacity,
        epochEvents: this.epochEvents,
        epochCounts: { ...this.epochCounts },
        totalEvents: this.totalEvents,
        totalCounts: { ...this.totalCounts },
      };
    }
  }

  scope.InPulsOrderBookEvents = Object.freeze({
    DEFAULT_HISTORY_CAPACITY,
    EVENT_TYPES,
    SIDES,
    DepthEventJournal,
    applyDepthDiff,
    classifyDepthChange,
    seedDepthSnapshot,
  });
})(typeof self !== "undefined" ? self : globalThis);
