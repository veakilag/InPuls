export const SIGNAL_LAB_SCHEMA_VERSION = 1;
export const SIGNAL_LAB_STORAGE_VERSION = 1;

export const SIGNAL_LAB_WINDOWS = Object.freeze([
  Object.freeze({ key: "1d", durationMs: 86_400_000 }),
  Object.freeze({ key: "3d", durationMs: 259_200_000 }),
  Object.freeze({ key: "7d", durationMs: 604_800_000 }),
  Object.freeze({ key: "30d", durationMs: 2_592_000_000 }),
]);

export const SIGNAL_LAB_EVIDENCE_LEVELS = Object.freeze({
  NONE: "none",
  INSUFFICIENT: "insufficient",
  EXPLORATORY: "exploratory",
  SUBSTANTIAL: "substantial",
});

const DATABASE_NAME = "inpuls-signal-lab-v1";
const DEFAULT_RETENTION_MS = 2_592_000_000;
const DEFAULT_MAX_EVENTS = 10_000;
const DEFAULT_FINAL_SAMPLE_MAX_DELAY_MS = 5_000;
const DEFAULT_PRUNE_INTERVAL_MS = 600_000;
const STORE_NAMES = Object.freeze({
  EVENTS: "events",
  CONTEXTS: "contexts",
  OBSERVATIONS: "observations",
});

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveTimestamp(value, fallback = Date.now()) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : fallback;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function roundedPercent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 1_000_000) / 10_000;
}

function quantile(sorted, probability) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * weight);
}

function numericSummary(values) {
  const sorted = values
    .map(finiteOrNull)
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
  if (!sorted.length) {
    return {
      count: 0,
      mean: null,
      median: null,
      p25: null,
      p75: null,
      minimum: null,
      maximum: null,
    };
  }
  return {
    count: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    minimum: sorted[0],
    maximum: sorted.at(-1),
  };
}

function evidenceLevel(sampleSize) {
  if (sampleSize <= 0) return SIGNAL_LAB_EVIDENCE_LEVELS.NONE;
  if (sampleSize < 20) return SIGNAL_LAB_EVIDENCE_LEVELS.INSUFFICIENT;
  if (sampleSize < 100) return SIGNAL_LAB_EVIDENCE_LEVELS.EXPLORATORY;
  return SIGNAL_LAB_EVIDENCE_LEVELS.SUBSTANTIAL;
}

function stableSettingsKey(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return "{}";
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(settings)
        .filter(([, value]) => Number.isFinite(Number(value)))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, Number(value)]),
    ),
  );
}

function formulaSnapshot(event) {
  return {
    name: String(event?.formula?.name || "unknown"),
    version: String(event?.formula?.version || "unknown"),
    settingsKey: stableSettingsKey(event?.formula?.settings),
  };
}

function observationHasCompleteOutcome(observation) {
  return [
    observation?.returnPercent,
    observation?.directionalReturnPercent,
    observation?.mfePercent,
    observation?.maePercent,
    observation?.effectDurationMs,
  ].every((value) => finiteOrNull(value) !== null);
}

function isLiveObservation(observation) {
  return observation?.state === "observed"
    && observation?.quality?.state === "live"
    && observationHasCompleteOutcome(observation);
}

function recordGroupKey(event, observation, symbolScoped) {
  const formula = formulaSnapshot(event);
  return [
    formula.name,
    formula.version,
    formula.settingsKey,
    String(event?.signalType || "unknown"),
    String(event?.direction || "neutral"),
    String(observation?.horizon || "unknown"),
    symbolScoped ? String(event?.symbol || "unknown") : "*",
  ].join("\u001f");
}

function groupRecords(records, symbolScoped) {
  const groups = new Map();
  for (const record of records) {
    const key = recordGroupKey(record.event, record.observation, symbolScoped);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return groups;
}

function summarizeGroup(records, symbolScoped, now) {
  const first = records[0];
  const formula = formulaSnapshot(first.event);
  const observations = records.map((record) => record.observation);
  const observed = observations.filter((observation) => observation?.state === "observed");
  const usable = observations.filter(isLiveObservation);
  const partial = observed.filter((observation) => !isLiveObservation(observation));
  const unavailable = observations.filter((observation) => observation?.state === "unavailable");
  const pending = observations.filter((observation) => observation?.state === "pending");
  const overduePending = pending.filter(
    (observation) => finiteOrNull(observation?.dueAt) !== null && observation.dueAt < now,
  );
  const awaiting = pending.length - overduePending.length;
  const dueCount = observed.length + unavailable.length + overduePending.length;
  const contexts = records.map((record) => record.context).filter(Boolean);
  const completeContexts = contexts.filter((context) => context?.quality?.complete === true);
  const observedBooks = contexts.filter((context) => context?.liquidity?.observed === true);
  const interactedBooks = contexts.filter(
    (context) => Array.isArray(context?.liquidity?.episodes)
      && context.liquidity.episodes.length > 0,
  );
  const directional = usable.map((observation) => observation.directionalReturnPercent);
  const continued = directional.filter((value) => value > 0).length;
  const flat = directional.filter((value) => value === 0).length;
  const adverse = directional.filter((value) => value < 0).length;
  const limitations = [];
  if (usable.length < 20) limitations.push("sample-below-20");
  if (partial.length) limitations.push("partial-price-paths-excluded");
  if (unavailable.length) limitations.push("unavailable-horizons");
  if (overduePending.length) limitations.push("overdue-pending-horizons");
  if (completeContexts.length < contexts.length) limitations.push("partial-signal-context");
  if (observedBooks.length < contexts.length) limitations.push("order-book-not-always-observed");

  return {
    key: recordGroupKey(first.event, first.observation, symbolScoped),
    symbol: symbolScoped ? first.event.symbol : null,
    signalType: first.event.signalType,
    direction: first.event.direction,
    horizon: first.observation.horizon,
    horizonMs: finiteOrNull(first.observation.horizonMs),
    formula,
    sample: {
      events: new Set(records.map((record) => record.event.id)).size,
      observations: observations.length,
      due: dueCount,
      observed: observed.length,
      usableLive: usable.length,
      observedPartial: partial.length,
      unavailable: unavailable.length,
      pending: pending.length,
      awaiting,
      overduePending: overduePending.length,
      observedCoveragePercent: roundedPercent(observed.length, dueCount),
      usableCoveragePercent: roundedPercent(usable.length, dueCount),
      livePathSharePercent: roundedPercent(usable.length, observed.length),
    },
    continuation: {
      definition: "directionalReturnPercent > 0",
      continued,
      flat,
      adverse,
      ratePercent: roundedPercent(continued, usable.length),
    },
    outcome: {
      marketReturnPercent: numericSummary(
        usable.map((observation) => observation.returnPercent),
      ),
      directionalReturnPercent: numericSummary(directional),
      mfePercent: numericSummary(usable.map((observation) => observation.mfePercent)),
      maePercent: numericSummary(usable.map((observation) => observation.maePercent)),
      effectDurationMs: numericSummary(
        usable.map((observation) => observation.effectDurationMs),
      ),
    },
    context: {
      captured: contexts.length,
      complete: completeContexts.length,
      orderBookObserved: observedBooks.length,
      densityInteractionObserved: interactedBooks.length,
      densityImportance: "unrated",
    },
    evidence: {
      level: evidenceLevel(usable.length),
      interpretation: "descriptive-history-not-price-forecast",
      limitations,
    },
  };
}

function sortGroups(left, right) {
  return right.sample.usableLive - left.sample.usableLive
    || right.sample.observed - left.sample.observed
    || String(left.signalType).localeCompare(String(right.signalType))
    || String(left.horizon).localeCompare(String(right.horizon))
    || String(left.symbol || "").localeCompare(String(right.symbol || ""));
}

function windowCounts(records, now) {
  const observations = records.map((record) => record.observation);
  const observed = observations.filter((observation) => observation?.state === "observed");
  const unavailable = observations.filter((observation) => observation?.state === "unavailable");
  const pending = observations.filter((observation) => observation?.state === "pending");
  return {
    events: new Set(records.map((record) => record.event.id)).size,
    observations: observations.length,
    observed: observed.length,
    usableLive: observations.filter(isLiveObservation).length,
    observedPartial: observed.filter((observation) => !isLiveObservation(observation)).length,
    unavailable: unavailable.length,
    pending: pending.length,
    overduePending: pending.filter(
      (observation) => finiteOrNull(observation?.dueAt) !== null && observation.dueAt < now,
    ).length,
  };
}

function normalizeWindows(windows) {
  const normalized = (Array.isArray(windows) ? windows : SIGNAL_LAB_WINDOWS)
    .map((window) => ({
      key: String(window?.key || ""),
      durationMs: finiteOrNull(window?.durationMs),
    }))
    .filter((window) => window.key && window.durationMs !== null && window.durationMs > 0);
  return normalized.length ? normalized : [...SIGNAL_LAB_WINDOWS];
}

export function buildSignalLabReport(snapshot = {}, {
  now = Date.now(),
  windows = SIGNAL_LAB_WINDOWS,
  storageState = "available",
} = {}) {
  const generatedAt = positiveTimestamp(now);
  const events = new Map(
    (Array.isArray(snapshot?.events) ? snapshot.events : [])
      .filter((event) => event?.entity === "SignalEvent" && event?.id)
      .map((event) => [event.id, event]),
  );
  const contexts = new Map(
    (Array.isArray(snapshot?.contexts) ? snapshot.contexts : [])
      .filter((context) => context?.entity === "SignalContext" && context?.eventId)
      .map((context) => [context.eventId, context]),
  );
  const observations = new Map(
    (Array.isArray(snapshot?.observations) ? snapshot.observations : [])
      .filter((observation) => observation?.entity === "SignalObservation" && observation?.id)
      .map((observation) => [observation.id, observation]),
  );
  const normalizedWindows = normalizeWindows(windows);
  const reports = normalizedWindows.map((window) => {
    const sinceAt = generatedAt - window.durationMs;
    const records = [];
    for (const observation of observations.values()) {
      const event = events.get(observation.eventId);
      if (!event) continue;
      const triggeredAt = finiteOrNull(event.triggeredAt);
      if (triggeredAt === null || triggeredAt < sinceAt || triggeredAt > generatedAt) continue;
      records.push({
        event,
        context: contexts.get(event.id) ?? null,
        observation,
      });
    }
    const signalGroups = [...groupRecords(records, false).values()]
      .map((group) => summarizeGroup(group, false, generatedAt))
      .sort(sortGroups);
    const symbolGroups = [...groupRecords(records, true).values()]
      .map((group) => summarizeGroup(group, true, generatedAt))
      .sort(sortGroups);
    return {
      key: window.key,
      durationMs: window.durationMs,
      sinceAt,
      untilAt: generatedAt,
      counts: windowCounts(records, generatedAt),
      signalGroups,
      symbolGroups,
    };
  });
  const linkedObservationCount = [...observations.values()]
    .filter((observation) => events.has(observation.eventId))
    .length;

  return deepFreeze({
    schemaVersion: SIGNAL_LAB_SCHEMA_VERSION,
    entity: "SignalLabReport",
    generatedAt,
    source: {
      scope: "local-browser-profile",
      storage: "indexeddb",
      storageState,
      eventCount: events.size,
      contextCount: contexts.size,
      observationCount: observations.size,
      orphanObservationCount: observations.size - linkedObservationCount,
    },
    definitions: {
      primarySample: "state=observed AND quality.state=live AND complete outcome",
      continuation: "directionalReturnPercent > 0",
      marketReturn: "(finalPrice-baselinePrice)/baselinePrice*100",
      directionalReturn: "marketReturn*signalDirection",
      mfe: "maximum favorable directional excursion",
      mae: "maximum adverse directional excursion",
      effectDuration: "elapsed time from signal to MFE",
      evidenceLevels: {
        none: "0 usable observations",
        insufficient: "1-19 usable observations",
        exploratory: "20-99 usable observations",
        substantial: "100+ usable observations; still descriptive, not predictive proof",
      },
    },
    limitations: [
      "local-browser-not-24-7",
      "single-browser-profile-history",
      "page-reloads-can-split-continuous-signal-episodes",
      "market-regime-unclassified-v1",
      "coin-groups-unavailable-v1",
      "density-size-is-not-importance",
      "not-profitability-or-price-forecast",
    ],
    windows: reports,
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(
      transaction.error || new Error("IndexedDB transaction aborted"),
    );
    transaction.onerror = () => reject(
      transaction.error || new Error("IndexedDB transaction failed"),
    );
  });
}

function unavailableAfterSession(observation, now) {
  const previousQuality = observation?.quality && typeof observation.quality === "object"
    ? observation.quality
    : {};
  return {
    ...observation,
    state: "unavailable",
    observedAt: now,
    quality: {
      ...previousQuality,
      state: "unavailable",
      reason: "browser-session-ended-before-horizon",
      finalSampleDelayMs: null,
      limitations: [
        ...new Set([
          ...(Array.isArray(previousQuality.limitations) ? previousQuality.limitations : []),
          "horizon-price-unavailable",
          "browser-session-ended",
        ]),
      ],
    },
  };
}

function entityRows(batch, key, entity) {
  return (Array.isArray(batch?.[key]) ? batch[key] : [])
    .filter((row) => row?.entity === entity && row?.id);
}

export class SignalLabLocalStore {
  constructor({
    indexedDBFactory = globalThis.indexedDB ?? null,
    retentionMs = DEFAULT_RETENTION_MS,
    maxEvents = DEFAULT_MAX_EVENTS,
    finalSampleMaxDelayMs = DEFAULT_FINAL_SAMPLE_MAX_DELAY_MS,
    pruneIntervalMs = DEFAULT_PRUNE_INTERVAL_MS,
  } = {}) {
    this.indexedDBFactory = indexedDBFactory;
    this.retentionMs = Math.max(86_400_000, Number(retentionMs) || DEFAULT_RETENTION_MS);
    this.maxEvents = Math.max(100, Math.floor(Number(maxEvents) || DEFAULT_MAX_EVENTS));
    this.finalSampleMaxDelayMs = Math.max(
      250,
      Number(finalSampleMaxDelayMs) || DEFAULT_FINAL_SAMPLE_MAX_DELAY_MS,
    );
    this.pruneIntervalMs = Math.max(
      60_000,
      Number(pruneIntervalMs) || DEFAULT_PRUNE_INTERVAL_MS,
    );
    this.databasePromise = null;
    this.queue = Promise.resolve();
    this.lastPrunedAt = null;
    this.health = {
      state: this.indexedDBFactory?.open ? "idle" : "unavailable",
      initializedAt: null,
      lastWriteAt: null,
      lastError: this.indexedDBFactory?.open ? null : "indexeddb-unavailable",
    };
  }

  #enqueue(task) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  #setError(error) {
    this.health = {
      ...this.health,
      state: "error",
      lastError: String(error?.message || error || "unknown-indexeddb-error").slice(0, 240),
    };
  }

  #openDatabase() {
    if (!this.indexedDBFactory?.open) return Promise.resolve(null);
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDBFactory.open(DATABASE_NAME, SIGNAL_LAB_STORAGE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAMES.EVENTS)) {
          const events = database.createObjectStore(STORE_NAMES.EVENTS, { keyPath: "id" });
          events.createIndex("triggeredAt", "triggeredAt", { unique: false });
        }
        if (!database.objectStoreNames.contains(STORE_NAMES.CONTEXTS)) {
          database.createObjectStore(STORE_NAMES.CONTEXTS, { keyPath: "eventId" });
        }
        if (!database.objectStoreNames.contains(STORE_NAMES.OBSERVATIONS)) {
          const observations = database.createObjectStore(
            STORE_NAMES.OBSERVATIONS,
            { keyPath: "id" },
          );
          observations.createIndex("eventId", "eventId", { unique: false });
          observations.createIndex("dueAt", "dueAt", { unique: false });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(
        request.error || new Error("Unable to open Signal Lab IndexedDB"),
      );
      request.onblocked = () => reject(new Error("Signal Lab IndexedDB upgrade blocked"));
    }).catch((error) => {
      this.databasePromise = null;
      this.#setError(error);
      throw error;
    });
    return this.databasePromise;
  }

  async #readAll(database) {
    const transaction = database.transaction(
      [STORE_NAMES.EVENTS, STORE_NAMES.CONTEXTS, STORE_NAMES.OBSERVATIONS],
      "readonly",
    );
    const results = await Promise.all([
      requestResult(transaction.objectStore(STORE_NAMES.EVENTS).getAll()),
      requestResult(transaction.objectStore(STORE_NAMES.CONTEXTS).getAll()),
      requestResult(transaction.objectStore(STORE_NAMES.OBSERVATIONS).getAll()),
      transactionDone(transaction),
    ]);
    return {
      events: results[0],
      contexts: results[1],
      observations: results[2],
    };
  }

  async #recoverExpired(database, now) {
    const readTransaction = database.transaction(STORE_NAMES.OBSERVATIONS, "readonly");
    const observations = await requestResult(
      readTransaction.objectStore(STORE_NAMES.OBSERVATIONS).getAll(),
    );
    await transactionDone(readTransaction);
    const expired = observations.filter((observation) => (
      observation?.state === "pending"
      && finiteOrNull(observation?.dueAt) !== null
      && observation.dueAt + this.finalSampleMaxDelayMs < now
    ));
    if (!expired.length) return 0;
    const writeTransaction = database.transaction(STORE_NAMES.OBSERVATIONS, "readwrite");
    const store = writeTransaction.objectStore(STORE_NAMES.OBSERVATIONS);
    for (const observation of expired) {
      store.put(unavailableAfterSession(observation, now));
    }
    await transactionDone(writeTransaction);
    return expired.length;
  }

  async #prune(database, now, force = false) {
    if (
      !force
      && this.lastPrunedAt !== null
      && now - this.lastPrunedAt < this.pruneIntervalMs
    ) return 0;
    const snapshot = await this.#readAll(database);
    const orderedEvents = [...snapshot.events].sort(
      (left, right) => (finiteOrNull(left.triggeredAt) ?? 0) - (finiteOrNull(right.triggeredAt) ?? 0),
    );
    const cutoff = now - this.retentionMs;
    const removedIds = new Set(
      orderedEvents
        .filter((event, index) => (
          (finiteOrNull(event.triggeredAt) ?? 0) < cutoff
          || index < orderedEvents.length - this.maxEvents
        ))
        .map((event) => event.id),
    );
    this.lastPrunedAt = now;
    if (!removedIds.size) return 0;
    const transaction = database.transaction(
      [STORE_NAMES.EVENTS, STORE_NAMES.CONTEXTS, STORE_NAMES.OBSERVATIONS],
      "readwrite",
    );
    const eventStore = transaction.objectStore(STORE_NAMES.EVENTS);
    const contextStore = transaction.objectStore(STORE_NAMES.CONTEXTS);
    const observationStore = transaction.objectStore(STORE_NAMES.OBSERVATIONS);
    for (const eventId of removedIds) {
      eventStore.delete(eventId);
      contextStore.delete(eventId);
    }
    for (const observation of snapshot.observations) {
      if (removedIds.has(observation.eventId)) observationStore.delete(observation.id);
    }
    await transactionDone(transaction);
    return removedIds.size;
  }

  initialize({ now = Date.now() } = {}) {
    return this.#enqueue(async () => {
      const initializedAt = positiveTimestamp(now);
      const database = await this.#openDatabase();
      if (!database) return this.status();
      try {
        const recovered = await this.#recoverExpired(database, initializedAt);
        const pruned = await this.#prune(database, initializedAt, true);
        this.health = {
          ...this.health,
          state: "available",
          initializedAt,
          lastError: null,
          recoveredObservations: recovered,
          prunedEvents: pruned,
        };
        return this.status();
      } catch (error) {
        this.#setError(error);
        throw error;
      }
    });
  }

  persist(batch, { now = Date.now() } = {}) {
    const events = entityRows(batch, "events", "SignalEvent");
    const contexts = entityRows(batch, "contexts", "SignalContext");
    const observations = [
      ...entityRows(batch, "observations", "SignalObservation"),
      ...entityRows(batch, "resolvedObservations", "SignalObservation"),
    ];
    if (!events.length && !contexts.length && !observations.length) {
      return Promise.resolve(false);
    }
    return this.#enqueue(async () => {
      const writtenAt = positiveTimestamp(now);
      const database = await this.#openDatabase();
      if (!database) return false;
      try {
        const transaction = database.transaction(
          [STORE_NAMES.EVENTS, STORE_NAMES.CONTEXTS, STORE_NAMES.OBSERVATIONS],
          "readwrite",
        );
        const eventStore = transaction.objectStore(STORE_NAMES.EVENTS);
        const contextStore = transaction.objectStore(STORE_NAMES.CONTEXTS);
        const observationStore = transaction.objectStore(STORE_NAMES.OBSERVATIONS);
        for (const event of events) eventStore.put(event);
        for (const context of contexts) contextStore.put(context);
        for (const observation of observations) observationStore.put(observation);
        await transactionDone(transaction);
        await this.#prune(database, writtenAt);
        this.health = {
          ...this.health,
          state: "available",
          lastWriteAt: writtenAt,
          lastError: null,
        };
        return true;
      } catch (error) {
        this.#setError(error);
        throw error;
      }
    });
  }

  async snapshot({
    sinceAt = 0,
    untilAt = Date.now(),
  } = {}) {
    await this.queue;
    const lower = positiveTimestamp(sinceAt, 0);
    const upper = positiveTimestamp(untilAt);
    const database = await this.#openDatabase();
    if (!database) {
      return deepFreeze({
        schemaVersion: SIGNAL_LAB_SCHEMA_VERSION,
        events: [],
        contexts: [],
        observations: [],
      });
    }
    try {
      const stored = await this.#readAll(database);
      const events = stored.events
        .filter((event) => {
          const triggeredAt = finiteOrNull(event?.triggeredAt);
          return triggeredAt !== null && triggeredAt >= lower && triggeredAt <= upper;
        })
        .sort((left, right) => left.triggeredAt - right.triggeredAt);
      const eventIds = new Set(events.map((event) => event.id));
      return deepFreeze({
        schemaVersion: SIGNAL_LAB_SCHEMA_VERSION,
        events,
        contexts: stored.contexts.filter((context) => eventIds.has(context.eventId)),
        observations: stored.observations.filter(
          (observation) => eventIds.has(observation.eventId),
        ),
      });
    } catch (error) {
      this.#setError(error);
      throw error;
    }
  }

  async report(options = {}) {
    const now = positiveTimestamp(options.now);
    const windows = normalizeWindows(options.windows);
    const longestWindowMs = Math.max(...windows.map((window) => window.durationMs));
    await this.#enqueue(async () => {
      const database = await this.#openDatabase();
      if (!database) return;
      try {
        const recovered = await this.#recoverExpired(database, now);
        if (recovered) {
          this.health = {
            ...this.health,
            state: "available",
            recoveredObservations: (
              Number(this.health.recoveredObservations) || 0
            ) + recovered,
            lastError: null,
          };
        }
      } catch (error) {
        this.#setError(error);
        throw error;
      }
    });
    const snapshot = await this.snapshot({
      sinceAt: now - longestWindowMs,
      untilAt: now,
    });
    return buildSignalLabReport(snapshot, {
      ...options,
      now,
      windows,
      storageState: this.health.state,
    });
  }

  status() {
    return deepFreeze({
      schemaVersion: SIGNAL_LAB_SCHEMA_VERSION,
      ...this.health,
      retentionMs: this.retentionMs,
      maxEvents: this.maxEvents,
    });
  }
}
