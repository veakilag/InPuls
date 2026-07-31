import { SignalLabLocalStore } from "./signal-lab.js";
import {
  buildEvidenceExplanation,
  normalizePatternId,
  SIGNAL_LAB_V2_CATALOG_VERSION,
} from "./signal-lab-v2-catalog.js";
import { groupEventsIntoEpisodes } from "./signal-lab-v2-episodes.js";
import {
  migrateLegacyReview,
  normalizeReviewV2,
  SIGNAL_LAB_V2_REVIEW_VERSION,
} from "./signal-lab-v2-review.js";

export const SIGNAL_LAB_V2_STORE_VERSION = 1;

const DATABASE_NAME = "inpuls-signal-lab-v2";
const DATABASE_VERSION = 1;
const REVIEW_STORE = "reviews";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Signal Lab V2 IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(
      transaction.error || new Error("Signal Lab V2 IndexedDB transaction aborted"),
    );
    transaction.onerror = () => reject(
      transaction.error || new Error("Signal Lab V2 IndexedDB transaction failed"),
    );
  });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function normalizedLegacyReview(event) {
  if (!event?.review?.verdict) return null;
  try {
    return migrateLegacyReview({
      ...event.review,
      eventId: event.id,
      signalType: event.signalType,
    });
  } catch {
    return null;
  }
}

function eventForEpisode(event) {
  const patternId = normalizePatternId(event?.patternId ?? event?.signalType);
  if (!patternId) return null;
  return {
    ...event,
    patternId,
    patternState: event?.review?.reviewedState ?? event?.patternState ?? "triggered",
    referencePrice: event?.review?.referencePrice ?? event?.price,
    invalidationPrice: event?.review?.invalidationPrice ?? null,
  };
}

export function enrichSignalLabReportV2(report = {}, storedReviews = []) {
  const reviewMap = new Map(
    (Array.isArray(storedReviews) ? storedReviews : [])
      .filter((review) => review?.eventId)
      .map((review) => [review.eventId, review]),
  );

  const windows = (Array.isArray(report?.windows) ? report.windows : []).map((window) => {
    const sourceEvents = Array.isArray(window?.events) ? window.events : [];
    const episodeEvents = sourceEvents.map(eventForEpisode).filter(Boolean);
    const grouping = groupEventsIntoEpisodes(episodeEvents);
    const episodeMap = new Map(grouping.episodes.map((episode) => [episode.id, episode]));

    const events = sourceEvents.map((event) => {
      const review = reviewMap.get(event.id) ?? normalizedLegacyReview(event);
      const patternId = normalizePatternId(review?.patternId ?? event.signalType);
      const episodeId = review?.episodeId ?? grouping.eventToEpisode.get(event.id) ?? null;
      const episode = episodeId ? episodeMap.get(episodeId) ?? null : null;
      const patternState = review?.reviewedState ?? "triggered";
      const explanation = buildEvidenceExplanation({
        ...event,
        patternId,
        patternState,
      });
      return {
        ...event,
        patternId,
        patternState,
        episodeId,
        duplicateEpisode: Boolean(episode && episode.primaryEventId !== event.id),
        explanation,
        review,
      };
    });

    return {
      ...window,
      events,
      episodes: grouping.episodes,
    };
  });

  return deepFreeze({
    ...report,
    schemaVersion: 2,
    source: {
      ...(report?.source ?? {}),
      reviewStorage: "inpuls-signal-lab-v2/indexeddb",
    },
    definitions: {
      ...(report?.definitions ?? {}),
      patternCatalogVersion: SIGNAL_LAB_V2_CATALOG_VERSION,
      reviewVersion: SIGNAL_LAB_V2_REVIEW_VERSION,
      episodeDeduplication: "symbol + canonical pattern + direction + time/reference proximity",
    },
    limitations: [...new Set([
      ...(Array.isArray(report?.limitations) ? report.limitations : []),
      "team-setups-remain-hypotheses-until-labeled",
      "candidate-is-not-trade-command",
    ])],
    windows,
  });
}

export class SignalLabV2Store {
  constructor(options = {}) {
    this.indexedDBFactory = options.indexedDBFactory ?? globalThis.indexedDB ?? null;
    this.legacyStore = new SignalLabLocalStore(options);
    this.databasePromise = null;
    this.health = {
      state: this.indexedDBFactory?.open ? "idle" : "unavailable",
      migratedLegacyReviews: 0,
      lastError: null,
    };
  }

  #openDatabase() {
    if (!this.indexedDBFactory?.open) return Promise.resolve(null);
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDBFactory.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(REVIEW_STORE)) {
          database.createObjectStore(REVIEW_STORE, { keyPath: "eventId" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(
        request.error || new Error("Unable to open Signal Lab V2 IndexedDB"),
      );
      request.onblocked = () => reject(new Error("Signal Lab V2 IndexedDB upgrade blocked"));
    }).catch((error) => {
      this.databasePromise = null;
      this.health = { ...this.health, state: "error", lastError: String(error?.message || error) };
      throw error;
    });
    return this.databasePromise;
  }

  async #readReviews(database = null) {
    const target = database ?? await this.#openDatabase();
    if (!target) return [];
    const transaction = target.transaction(REVIEW_STORE, "readonly");
    const rows = await requestResult(transaction.objectStore(REVIEW_STORE).getAll());
    await transactionDone(transaction);
    return rows;
  }

  async #writeReviews(reviews, { preserveExisting = false } = {}) {
    const database = await this.#openDatabase();
    if (!database || !reviews.length) return 0;
    const existing = preserveExisting
      ? new Set((await this.#readReviews(database)).map((review) => review.eventId))
      : new Set();
    const transaction = database.transaction(REVIEW_STORE, "readwrite");
    const store = transaction.objectStore(REVIEW_STORE);
    let written = 0;
    for (const review of reviews) {
      if (preserveExisting && existing.has(review.eventId)) continue;
      store.put(review);
      written += 1;
    }
    await transactionDone(transaction);
    return written;
  }

  async initialize(options = {}) {
    const legacyStatus = await this.legacyStore.initialize(options);
    const database = await this.#openDatabase();
    if (!database) return this.status();
    let migratedLegacyReviews = 0;
    try {
      const legacyRows = await this.legacyStore.reviewExport();
      const migrated = legacyRows.flatMap((row) => {
        try {
          return [migrateLegacyReview({
            ...row.review,
            eventId: row.eventId,
            signalType: row.signalType,
          })];
        } catch {
          return [];
        }
      });
      migratedLegacyReviews = await this.#writeReviews(migrated, { preserveExisting: true });
      this.health = {
        state: "available",
        migratedLegacyReviews,
        lastError: null,
        initializedAt: Date.now(),
      };
    } catch (error) {
      this.health = { ...this.health, state: "error", lastError: String(error?.message || error) };
      throw error;
    }
    return deepFreeze({ ...legacyStatus, ...this.health });
  }

  async report(options = {}) {
    const [legacyReport, reviews] = await Promise.all([
      this.legacyStore.report(options),
      this.#readReviews(),
    ]);
    return enrichSignalLabReportV2(legacyReport, reviews);
  }

  async review(eventId, verdict, details = {}) {
    const normalizedId = String(eventId ?? "").trim().slice(0, 180);
    if (!normalizedId) throw new TypeError("eventId is required");
    const database = await this.#openDatabase();
    if (!database) return false;
    const transaction = database.transaction(REVIEW_STORE, "readwrite");
    const store = transaction.objectStore(REVIEW_STORE);
    if (!verdict) {
      store.delete(normalizedId);
    } else {
      store.put(normalizeReviewV2({
        ...details,
        eventId: normalizedId,
        verdict,
        reasonCodes: details.reasonCodes ?? details.reason ?? [],
      }));
    }
    await transactionDone(transaction);
    return true;
  }

  async reviewExport() {
    const report = await this.report();
    const unique = new Map();
    for (const window of report.windows ?? []) {
      for (const event of window.events ?? []) {
        if (!event.review?.verdict || unique.has(event.id)) continue;
        unique.set(event.id, {
          exportVersion: 2,
          eventId: event.id,
          symbol: event.symbol,
          signalType: event.signalType,
          patternId: event.patternId,
          direction: event.direction,
          triggeredAt: event.triggeredAt,
          price: event.price,
          episodeId: event.episodeId,
          formula: event.formula ?? null,
          detectorEvidence: event.detectorEvidence ?? null,
          context: event.context ?? null,
          observations: event.observation ? [event.observation] : [],
          explanation: event.explanation,
          review: event.review,
        });
      }
    }
    return deepFreeze([...unique.values()].sort((left, right) => left.triggeredAt - right.triggeredAt));
  }

  status() {
    const legacy = this.legacyStore.status();
    return deepFreeze({
      ...legacy,
      v2StoreVersion: SIGNAL_LAB_V2_STORE_VERSION,
      state: this.health.state === "error" ? "error" : legacy.state,
      reviewStorageState: this.health.state,
      migratedLegacyReviews: this.health.migratedLegacyReviews,
      lastError: this.health.lastError ?? legacy.lastError,
    });
  }
}
