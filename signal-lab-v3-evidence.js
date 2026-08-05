import { buildTraderExplanation } from "./signal-lab-v3-explainer.js";

export const SIGNAL_LAB_V3_EVIDENCE_VERSION = "signal-lab-v3-evidence-replay-2026-08";

const DEPTH_STREAM_BASE = "wss://fstream.binance.com/market/stream";
const DEFAULT_PRE_EVENT_MS = 3 * 60_000;
const DEFAULT_POST_EVENT_MS = 5 * 60_000;
const DEFAULT_DEPTH_SAMPLE_MS = 1_000;
const DEFAULT_MAX_DEPTH_SYMBOLS = 10;

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeSymbol = (value) => {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,20}USDT$/.test(symbol) ? symbol : null;
};

const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

function compactLevels(rows, limit = 8) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, limit)
    .map((row) => [finite(row?.[0]), finite(row?.[1])])
    .filter(([price, quantity]) => price !== null && price > 0 && quantity !== null && quantity >= 0);
}

export function normalizeDepthPayload(payload, now = Date.now()) {
  const data = payload?.data ?? payload;
  const symbol = normalizeSymbol(data?.s);
  if (!symbol || !Array.isArray(data?.b) || !Array.isArray(data?.a)) return null;
  return Object.freeze({
    schemaVersion: 1,
    entity: "SignalLabDepthSnapshot",
    symbol,
    at: finite(data?.E) ?? finite(data?.T) ?? now,
    receivedAt: now,
    firstUpdateId: finite(data?.U),
    finalUpdateId: finite(data?.u),
    previousFinalUpdateId: finite(data?.pu),
    bids: Object.freeze(compactLevels(data.b)),
    asks: Object.freeze(compactLevels(data.a)),
  });
}

export class SignalLabV3DepthPool {
  constructor({
    maximumSymbols = DEFAULT_MAX_DEPTH_SYMBOLS,
    sampleIntervalMs = DEFAULT_DEPTH_SAMPLE_MS,
    preEventMs = DEFAULT_PRE_EVENT_MS,
    onStatus = () => {},
  } = {}) {
    this.maximumSymbols = Math.max(1, Math.min(20, Math.round(maximumSymbols)));
    this.sampleIntervalMs = Math.max(250, Math.round(sampleIntervalMs));
    this.preEventMs = Math.max(30_000, Math.round(preEventMs));
    this.onStatus = onStatus;
    this.symbols = [];
    this.signature = "";
    this.socket = null;
    this.generation = 0;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.manualClose = false;
    this.lastRecordedAt = new Map();
    this.buffers = new Map();
    this.state = {
      connection: "idle",
      trackedSymbols: 0,
      packets: 0,
      snapshots: 0,
      lastMessageAt: null,
      lastError: null,
    };
  }

  status() {
    return Object.freeze({ ...this.state });
  }

  setSymbols(symbols) {
    const next = [...new Set((Array.isArray(symbols) ? symbols : [])
      .map(normalizeSymbol)
      .filter(Boolean))]
      .slice(0, this.maximumSymbols);
    const signature = next.join(",");
    if (signature === this.signature) return;
    this.symbols = next;
    this.signature = signature;
    this.#connect();
  }

  disconnect() {
    this.manualClose = true;
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdogTimer);
    this.socket?.close();
    this.socket = null;
    this.#publish({ connection: "stopped" });
  }

  snapshots(symbol, since = 0) {
    const rows = this.buffers.get(normalizeSymbol(symbol)) ?? [];
    return rows.filter((row) => row.at >= since).map(clone);
  }

  latest(symbol) {
    const rows = this.buffers.get(normalizeSymbol(symbol)) ?? [];
    return rows.length ? clone(rows.at(-1)) : null;
  }

  #connect() {
    this.manualClose = false;
    this.generation += 1;
    const generation = this.generation;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.watchdogTimer);
    this.socket?.close();
    this.socket = null;
    if (!this.symbols.length) {
      this.#publish({ connection: "idle", trackedSymbols: 0 });
      return;
    }

    const streams = this.symbols.map((symbol) => `${symbol.toLowerCase()}@depth20@100ms`);
    const socket = new WebSocket(`${DEPTH_STREAM_BASE}?streams=${streams.join("/")}`);
    this.socket = socket;
    this.#publish({ connection: "connecting", trackedSymbols: this.symbols.length, lastError: null });

    this.watchdogTimer = setTimeout(() => {
      if (generation !== this.generation || this.state.lastMessageAt) return;
      this.#publish({ connection: "error", lastError: "depth20 не прислал первый пакет" });
      socket.close();
    }, 8_000);

    socket.addEventListener("open", () => {
      if (generation !== this.generation) return;
      this.reconnectAttempt = 0;
      this.#publish({ connection: "syncing" });
    });

    socket.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const now = Date.now();
      const snapshot = normalizeDepthPayload(payload, now);
      if (!snapshot) return;
      clearTimeout(this.watchdogTimer);
      this.#record(snapshot, now);
      this.#publish({
        connection: "live",
        packets: this.state.packets + 1,
        lastMessageAt: now,
        lastError: null,
      });
    });

    socket.addEventListener("close", () => {
      if (generation !== this.generation || this.manualClose || !this.symbols.length) return;
      this.reconnectAttempt += 1;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
      this.#publish({ connection: "reconnecting" });
      this.reconnectTimer = setTimeout(() => {
        if (generation === this.generation) this.#connect();
      }, delay);
    });

    socket.addEventListener("error", () => {
      if (generation !== this.generation) return;
      this.#publish({ connection: "error", lastError: "ошибка потока depth20" });
    });
  }

  #record(snapshot, now) {
    const previousAt = this.lastRecordedAt.get(snapshot.symbol) ?? 0;
    if (now - previousAt < this.sampleIntervalMs) return;
    this.lastRecordedAt.set(snapshot.symbol, now);
    if (!this.buffers.has(snapshot.symbol)) this.buffers.set(snapshot.symbol, []);
    const rows = this.buffers.get(snapshot.symbol);
    rows.push(snapshot);
    const cutoff = now - this.preEventMs - 15_000;
    while (rows.length && rows[0].at < cutoff) rows.shift();
    this.#publish({ snapshots: this.state.snapshots + 1 });
  }

  #publish(patch) {
    Object.assign(this.state, patch);
    try {
      this.onStatus(Object.freeze({ ...this.state }));
    } catch {
      // Diagnostics must never interrupt market collection.
    }
  }
}

function normalizePricePoints(metrics, from, to) {
  return (Array.isArray(metrics?.priceHistory) ? metrics.priceHistory : [])
    .map((point) => ({
      at: finite(point?.at ?? point?.t),
      price: finite(point?.price ?? point?.p),
    }))
    .filter((point) => point.at !== null && point.price !== null && point.price > 0)
    .filter((point) => point.at >= from && point.at <= to)
    .sort((left, right) => left.at - right.at);
}

function normalizeMinuteCandles(metrics) {
  return (Array.isArray(metrics?.minuteCandles) ? metrics.minuteCandles : [])
    .slice(-120)
    .map((row) => ({
      time: finite(row?.time),
      open: finite(row?.open),
      high: finite(row?.high),
      low: finite(row?.low),
      close: finite(row?.close),
    }))
    .filter((row) => [row.time, row.open, row.high, row.low, row.close]
      .every((value) => value !== null && value > 0));
}

function appendByTime(rows, row, maximum) {
  if (!row || !Number.isFinite(row.at)) return;
  const previous = rows.at(-1);
  if (previous?.at === row.at) rows[rows.length - 1] = row;
  else if (!previous || row.at > previous.at) rows.push(row);
  if (rows.length > maximum) rows.splice(0, rows.length - maximum);
}

function changePercent(price, reference) {
  if (!(price > 0) || !(reference > 0)) return null;
  return (price - reference) / reference * 100;
}

function computeOutcome(points, eventAt, referencePrice, direction, horizonMs) {
  const targetAt = eventAt + horizonMs;
  const target = points.find((point) => point.at >= targetAt);
  if (!target || !(referencePrice > 0)) return null;
  const window = points.filter((point) => point.at >= eventAt && point.at <= target.at);
  if (!window.length) return null;
  const changes = window.map((point) => changePercent(point.price, referencePrice)).filter(Number.isFinite);
  const high = Math.max(...changes);
  const low = Math.min(...changes);
  const move = changePercent(target.price, referencePrice);
  const favorable = direction === "down" ? -low : high;
  const adverse = direction === "down" ? high : -low;
  return Object.freeze({
    horizonMs,
    targetAt: target.at,
    price: target.price,
    movePercent: move,
    mfePercent: Math.max(0, favorable),
    maePercent: Math.max(0, adverse),
  });
}

export class SignalLabV3EvidenceRecorder {
  constructor({
    preEventMs = DEFAULT_PRE_EVENT_MS,
    postEventMs = DEFAULT_POST_EVENT_MS,
    maximumDepthSymbols = DEFAULT_MAX_DEPTH_SYMBOLS,
    maximumPricePoints = 600,
    maximumFlowSamples = 600,
    maximumBookSnapshots = 520,
    emitEveryMs = 5_000,
    depthPool = null,
  } = {}) {
    this.preEventMs = preEventMs;
    this.postEventMs = postEventMs;
    this.maximumDepthSymbols = maximumDepthSymbols;
    this.maximumPricePoints = maximumPricePoints;
    this.maximumFlowSamples = maximumFlowSamples;
    this.maximumBookSnapshots = maximumBookSnapshots;
    this.emitEveryMs = emitEveryMs;
    this.depthPool = depthPool ?? new SignalLabV3DepthPool({
      maximumSymbols: maximumDepthSymbols,
      preEventMs,
    });
    this.sessions = new Map();
    this.baseWatchSymbols = [];
    this.pinnedUntil = new Map();
  }

  status() {
    return Object.freeze({
      evidencePacks: this.sessions.size,
      depth: this.depthPool.status(),
    });
  }

  disconnect() {
    this.depthPool.disconnect();
  }

  setWatchSymbols(symbols, now = Date.now()) {
    this.baseWatchSymbols = [...new Set((Array.isArray(symbols) ? symbols : [])
      .map(normalizeSymbol)
      .filter(Boolean))];
    this.#refreshWatchSymbols(now);
  }

  ingest({ metricsRows = [], result = {}, now = Date.now() } = {}) {
    const metricsBySymbol = new Map((Array.isArray(metricsRows) ? metricsRows : [])
      .map((metrics) => [normalizeSymbol(metrics?.symbol), metrics])
      .filter(([symbol]) => symbol));
    const created = [];
    const updated = [];
    const expired = [];
    const evidenceUpdated = [];
    const touched = new Set();

    for (const episode of result.created ?? []) {
      const metrics = metricsBySymbol.get(episode.symbol);
      const session = this.#start(episode, metrics, now);
      this.#observe(session, metrics, now);
      touched.add(episode.id);
      created.push(this.#enrich(episode, session, now));
    }

    for (const episode of result.updated ?? []) {
      const metrics = metricsBySymbol.get(episode.symbol);
      const session = this.sessions.get(episode.id) ?? this.#start(episode, metrics, now);
      session.episode = episode;
      this.#observe(session, metrics, now);
      touched.add(episode.id);
      updated.push(this.#enrich(episode, session, now));
    }

    for (const episode of result.expired ?? []) {
      const metrics = metricsBySymbol.get(episode.symbol);
      const session = this.sessions.get(episode.id) ?? this.#start(episode, metrics, now);
      session.episode = episode;
      session.completedAt = finite(episode.completedAt) ?? now;
      session.followupUntil = session.completedAt + this.postEventMs;
      session.pack.markers.completedAt = session.completedAt;
      this.#observe(session, metrics, now);
      touched.add(episode.id);
      expired.push(this.#enrich(episode, session, now));
    }

    for (const [id, session] of this.sessions) {
      if (touched.has(id)) continue;
      const metrics = metricsBySymbol.get(session.episode.symbol);
      this.#observe(session, metrics, now);
      const followupActive = session.followupUntil === null || now <= session.followupUntil;
      if (followupActive && now - session.lastEmitAt >= this.emitEveryMs) {
        session.lastEmitAt = now;
        evidenceUpdated.push(this.#enrich(session.episode, session, now));
      }
      if (session.followupUntil !== null && now > session.followupUntil + 10_000) {
        this.sessions.delete(id);
      }
    }

    this.#refreshWatchSymbols(now);
    return Object.freeze({ created, updated, expired, evidenceUpdated });
  }

  #start(episode, metrics, now) {
    const eventAt = finite(episode.firstSeenAt) ?? now;
    const windowStartAt = eventAt - this.preEventMs;
    const currentPrice = finite(metrics?.price) ?? finite(episode?.latest?.price);
    const pricePoints = normalizePricePoints(metrics, windowStartAt, now);
    if (currentPrice !== null) appendByTime(pricePoints, { at: now, price: currentPrice }, this.maximumPricePoints);
    const bookSnapshots = this.depthPool.snapshots(episode.symbol, windowStartAt)
      .slice(-this.maximumBookSnapshots);
    const pack = {
      schemaVersion: 1,
      entity: "SignalLabEvidencePack",
      evidenceVersion: SIGNAL_LAB_V3_EVIDENCE_VERSION,
      episodeId: episode.id,
      symbol: episode.symbol,
      window: {
        startAt: windowStartAt,
        eventAt,
        plannedEndAt: eventAt + this.postEventMs,
        updatedAt: now,
      },
      markers: {
        detectedAt: eventAt,
        completedAt: null,
      },
      pricePoints,
      minuteCandles: normalizeMinuteCandles(metrics),
      flowSamples: [],
      bookSnapshots,
      bookMode: "sampled-depth20-top8@1s",
      outcomes: {},
      coverage: {},
      traderExplanation: null,
    };
    const session = {
      episode,
      pack,
      completedAt: null,
      followupUntil: null,
      lastBookAt: bookSnapshots.at(-1)?.at ?? 0,
      lastEmitAt: now,
    };
    this.sessions.set(episode.id, session);
    this.pinnedUntil.set(episode.symbol, eventAt + this.postEventMs + 60_000);
    return session;
  }

  #observe(session, metrics, now) {
    if (!session || !metrics) return;
    const pack = session.pack;
    const price = finite(metrics.price);
    if (price !== null && price > 0) {
      appendByTime(pack.pricePoints, { at: now, price }, this.maximumPricePoints);
    }
    appendByTime(pack.flowSamples, {
      at: now,
      tps: finite(metrics?.trades?.tps),
      buyShare: finite(metrics?.trades?.buyShare),
      volumeBoost: finite(metrics?.volumeBoost),
      liquidationTotal: finite(metrics?.liquidation?.total),
    }, this.maximumFlowSamples);

    const minuteCandles = normalizeMinuteCandles(metrics);
    if (minuteCandles.length) pack.minuteCandles = minuteCandles;

    for (const snapshot of this.depthPool.snapshots(session.episode.symbol, session.lastBookAt + 1)) {
      appendByTime(pack.bookSnapshots, snapshot, this.maximumBookSnapshots);
      session.lastBookAt = Math.max(session.lastBookAt, snapshot.at);
    }

    pack.window.updatedAt = now;
    this.#updatePack(session, now);
  }

  #updatePack(session, now) {
    const pack = session.pack;
    const eventAt = pack.window.eventAt;
    const reference = pack.pricePoints.find((point) => point.at >= eventAt)?.price
      ?? pack.pricePoints.at(-1)?.price
      ?? finite(session.episode?.latest?.price);
    const direction = session.episode.direction;
    const outcomes = {};
    for (const horizonMs of [15_000, 60_000, 180_000, 300_000]) {
      const outcome = computeOutcome(pack.pricePoints, eventAt, reference, direction, horizonMs);
      if (outcome) outcomes[String(horizonMs)] = outcome;
    }
    pack.outcomes = outcomes;

    const earliestPriceAt = pack.pricePoints[0]?.at ?? null;
    const earliestBookAt = pack.bookSnapshots[0]?.at ?? null;
    const latestBookAt = pack.bookSnapshots.at(-1)?.at ?? null;
    pack.coverage = {
      pricePoints: pack.pricePoints.length,
      bookSnapshots: pack.bookSnapshots.length,
      flowSamples: pack.flowSamples.length,
      prePriceSeconds: earliestPriceAt === null ? 0 : Math.max(0, Math.round((eventAt - earliestPriceAt) / 1_000)),
      preBookSeconds: earliestBookAt === null ? 0 : Math.max(0, Math.round((eventAt - earliestBookAt) / 1_000)),
      bookState: latestBookAt === null ? "not-recorded" : now - latestBookAt <= 3_000 ? "live" : "stale",
      depthStatus: this.depthPool.status().connection,
    };
    pack.traderExplanation = buildTraderExplanation(session.episode.latest, pack, now);
  }

  #enrich(episode, session, now) {
    session.lastEmitAt = now;
    this.#updatePack(session, now);
    return Object.freeze({
      ...episode,
      schemaVersion: 2,
      evidencePack: clone(session.pack),
    });
  }

  #refreshWatchSymbols(now) {
    for (const [symbol, until] of this.pinnedUntil) {
      if (until < now) this.pinnedUntil.delete(symbol);
    }
    const pinned = [...this.pinnedUntil.keys()];
    const next = [...new Set([...pinned, ...this.baseWatchSymbols])]
      .slice(0, this.maximumDepthSymbols);
    this.depthPool.setSymbols(next);
  }
}
