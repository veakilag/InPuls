export const SIGNAL_LAB_V3_DATABASE = "inpuls-signal-lab-v3";
export const SIGNAL_LAB_V3_STORE_VERSION = 1;

const EPISODES = "episodes";
const REVIEWS = "reviews";
const MAX_EPISODES = 5_000;

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const safeText = (value, maximum = 500) => String(value ?? "").slice(0, maximum);

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function normalizeReview(episodeId, review = {}, now = Date.now()) {
  const allowedVerdicts = new Set([
    "valid",
    "weak",
    "false_positive",
    "duplicate_episode",
    "wrong_pattern",
    "insufficient_data",
    "missed_pattern",
  ]);
  const verdict = allowedVerdicts.has(review.verdict) ? review.verdict : "insufficient_data";
  return Object.freeze({
    schemaVersion: 1,
    entity: "SignalLabCandidateReview",
    episodeId: safeText(episodeId, 220),
    verdict,
    finalPatternId: safeText(review.finalPatternId, 80) || null,
    comment: safeText(review.comment, 1_000),
    referencePrice: finite(review.referencePrice),
    invalidationPrice: finite(review.invalidationPrice),
    updatedAt: finite(review.updatedAt) ?? now,
  });
}

function normalizeEpisode(episode, now = Date.now()) {
  const id = safeText(episode?.id ?? episode?.episodeId, 220);
  if (!id) throw new TypeError("Candidate episode requires an id");
  const latest = episode?.latest && typeof episode.latest === "object" ? clone(episode.latest) : null;
  return Object.freeze({
    ...clone(episode),
    schemaVersion: 1,
    entity: "SignalLabCandidateEpisode",
    id,
    episodeId: id,
    symbol: safeText(episode?.symbol, 32).toUpperCase(),
    candidateType: safeText(episode?.candidateType, 80),
    label: safeText(episode?.label, 120),
    direction: episode?.direction === "down" ? "down" : episode?.direction === "up" ? "up" : "neutral",
    stage: safeText(episode?.stage, 40) || "observed",
    firstSeenAt: finite(episode?.firstSeenAt) ?? now,
    lastSeenAt: finite(episode?.lastSeenAt) ?? now,
    completedAt: finite(episode?.completedAt),
    observations: Math.max(1, Math.round(finite(episode?.observations) ?? 1)),
    peakEvidenceScore: Math.max(0, Math.min(100, finite(episode?.peakEvidenceScore) ?? 0)),
    reviewState: safeText(episode?.reviewState, 40) || "unreviewed",
    latest,
  });
}

export class SignalLabV3Store {
  constructor({ indexedDB = globalThis.indexedDB, maximumEpisodes = MAX_EPISODES } = {}) {
    this.indexedDB = indexedDB;
    this.maximumEpisodes = maximumEpisodes;
    this.database = null;
    this.mode = "initializing";
    this.memoryEpisodes = new Map();
    this.memoryReviews = new Map();
  }

  async initialize() {
    if (!this.indexedDB) {
      this.mode = "memory";
      return this.status();
    }
    try {
      const request = this.indexedDB.open(SIGNAL_LAB_V3_DATABASE, SIGNAL_LAB_V3_STORE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(EPISODES)) {
          const episodes = database.createObjectStore(EPISODES, { keyPath: "id" });
          episodes.createIndex("firstSeenAt", "firstSeenAt", { unique: false });
          episodes.createIndex("lastSeenAt", "lastSeenAt", { unique: false });
          episodes.createIndex("symbol", "symbol", { unique: false });
          episodes.createIndex("candidateType", "candidateType", { unique: false });
          episodes.createIndex("reviewState", "reviewState", { unique: false });
        }
        if (!database.objectStoreNames.contains(REVIEWS)) {
          const reviews = database.createObjectStore(REVIEWS, { keyPath: "episodeId" });
          reviews.createIndex("updatedAt", "updatedAt", { unique: false });
          reviews.createIndex("verdict", "verdict", { unique: false });
        }
      };
      this.database = await requestResult(request);
      this.database.onversionchange = () => this.database?.close();
      this.mode = "indexeddb";
      return this.status();
    } catch (error) {
      this.mode = "memory";
      return Object.freeze({ ...this.status(), error: safeText(error?.message ?? error, 200) });
    }
  }

  status() {
    return Object.freeze({
      schemaVersion: SIGNAL_LAB_V3_STORE_VERSION,
      database: SIGNAL_LAB_V3_DATABASE,
      mode: this.mode,
      available: this.mode === "indexeddb" || this.mode === "memory",
    });
  }

  async upsertEpisodes(rows, now = Date.now()) {
    const episodes = (Array.isArray(rows) ? rows : []).map((row) => normalizeEpisode(row, now));
    if (!episodes.length) return 0;
    if (this.mode !== "indexeddb" || !this.database) {
      for (const episode of episodes) this.memoryEpisodes.set(episode.id, episode);
      this.#pruneMemory();
      return episodes.length;
    }
    const transaction = this.database.transaction(EPISODES, "readwrite");
    const store = transaction.objectStore(EPISODES);
    for (const episode of episodes) store.put(episode);
    await transactionDone(transaction);
    await this.#pruneIndexedDb();
    return episodes.length;
  }

  async saveReview(episodeId, review, now = Date.now()) {
    const normalized = normalizeReview(episodeId, review, now);
    if (this.mode !== "indexeddb" || !this.database) {
      this.memoryReviews.set(normalized.episodeId, normalized);
      const episode = this.memoryEpisodes.get(normalized.episodeId);
      if (episode) {
        this.memoryEpisodes.set(normalized.episodeId, Object.freeze({
          ...episode,
          reviewState: normalized.verdict,
        }));
      }
      return normalized;
    }
    const transaction = this.database.transaction([EPISODES, REVIEWS], "readwrite");
    const reviewStore = transaction.objectStore(REVIEWS);
    const episodeStore = transaction.objectStore(EPISODES);
    reviewStore.put(normalized);
    const episode = await requestResult(episodeStore.get(normalized.episodeId));
    if (episode) episodeStore.put({ ...episode, reviewState: normalized.verdict });
    await transactionDone(transaction);
    return normalized;
  }

  async list({
    from = 0,
    to = Number.MAX_SAFE_INTEGER,
    symbol = "",
    candidateType = "",
    reviewState = "",
    limit = 1_000,
  } = {}) {
    const start = finite(from) ?? 0;
    const end = finite(to) ?? Number.MAX_SAFE_INTEGER;
    const normalizedSymbol = safeText(symbol, 32).trim().toUpperCase();
    const normalizedType = safeText(candidateType, 80).trim();
    const normalizedReview = safeText(reviewState, 40).trim();
    const maximum = Math.max(1, Math.min(5_000, Math.round(limit)));

    let episodes;
    let reviews;
    if (this.mode !== "indexeddb" || !this.database) {
      episodes = [...this.memoryEpisodes.values()];
      reviews = new Map(this.memoryReviews);
    } else {
      const transaction = this.database.transaction([EPISODES, REVIEWS], "readonly");
      episodes = await requestResult(transaction.objectStore(EPISODES).getAll());
      const reviewRows = await requestResult(transaction.objectStore(REVIEWS).getAll());
      reviews = new Map(reviewRows.map((review) => [review.episodeId, review]));
      await transactionDone(transaction);
    }

    return episodes
      .filter((episode) => episode.firstSeenAt >= start && episode.firstSeenAt <= end)
      .filter((episode) => !normalizedSymbol || episode.symbol.includes(normalizedSymbol))
      .filter((episode) => !normalizedType || episode.candidateType === normalizedType)
      .filter((episode) => !normalizedReview || episode.reviewState === normalizedReview)
      .sort((left, right) => right.firstSeenAt - left.firstSeenAt)
      .slice(0, maximum)
      .map((episode) => Object.freeze({
        ...clone(episode),
        review: reviews.get(episode.id) ? clone(reviews.get(episode.id)) : null,
      }));
  }

  async summary(options = {}) {
    const rows = await this.list({ ...options, limit: 5_000 });
    const reviewed = rows.filter((row) => row.reviewState !== "unreviewed").length;
    const byType = {};
    const byVerdict = {};
    for (const row of rows) {
      byType[row.candidateType] = (byType[row.candidateType] ?? 0) + 1;
      byVerdict[row.reviewState] = (byVerdict[row.reviewState] ?? 0) + 1;
    }
    return Object.freeze({
      episodes: rows.length,
      reviewed,
      unreviewed: rows.length - reviewed,
      byType: Object.freeze(byType),
      byVerdict: Object.freeze(byVerdict),
    });
  }

  async exportRows(options = {}) {
    const rows = await this.list({ ...options, limit: 5_000 });
    return rows.map((row) => ({
      episodeId: row.id,
      symbol: row.symbol,
      candidateType: row.candidateType,
      label: row.label,
      direction: row.direction,
      stage: row.stage,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      observations: row.observations,
      peakEvidenceScore: row.peakEvidenceScore,
      reviewState: row.reviewState,
      finalPatternId: row.review?.finalPatternId ?? "",
      comment: row.review?.comment ?? "",
      facts: Array.isArray(row.latest?.facts) ? row.latest.facts.join(" | ") : "",
      patternHypotheses: Array.isArray(row.latest?.patternHypotheses)
        ? row.latest.patternHypotheses.join(" | ")
        : "",
      formulaVersion: row.latest?.formulaVersion ?? "",
      dataState: row.latest?.quality?.state ?? "unknown",
      limitations: Array.isArray(row.latest?.quality?.limitations)
        ? row.latest.quality.limitations.join(" | ")
        : "",
    }));
  }

  #pruneMemory() {
    if (this.memoryEpisodes.size <= this.maximumEpisodes) return;
    const oldest = [...this.memoryEpisodes.values()]
      .sort((left, right) => left.firstSeenAt - right.firstSeenAt)
      .slice(0, this.memoryEpisodes.size - this.maximumEpisodes);
    for (const episode of oldest) {
      this.memoryEpisodes.delete(episode.id);
      this.memoryReviews.delete(episode.id);
    }
  }

  async #pruneIndexedDb() {
    if (!this.database) return;
    const countTransaction = this.database.transaction(EPISODES, "readonly");
    const count = await requestResult(countTransaction.objectStore(EPISODES).count());
    await transactionDone(countTransaction);
    const excess = count - this.maximumEpisodes;
    if (excess <= 0) return;

    const transaction = this.database.transaction([EPISODES, REVIEWS], "readwrite");
    const episodeStore = transaction.objectStore(EPISODES);
    const reviewStore = transaction.objectStore(REVIEWS);
    const index = episodeStore.index("firstSeenAt");
    let removed = 0;
    await new Promise((resolve, reject) => {
      const request = index.openCursor();
      request.onerror = () => reject(request.error ?? new Error("Cursor failed"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || removed >= excess) {
          resolve();
          return;
        }
        reviewStore.delete(cursor.primaryKey);
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
    });
    await transactionDone(transaction);
  }
}

export function rowsToCsv(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return "";
  const headers = Object.keys(list[0]);
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(";"),
    ...list.map((row) => headers.map((header) => escape(row[header])).join(";")),
  ].join("\n");
}
