import {
  RAW_STABILITY_MIN_VISIBLE_MS,
  RAW_STABILITY_SCHEMA_VERSION,
  advanceSourceStallCandidate,
  buildStabilityAssessment,
  diagnoseTradePayload,
  normalizeSymbols,
  reconnectDelay,
  reservoirPush,
  sanitizeTradePayload,
  sequenceDelta,
  summarizeMatching,
  summarizeReservoir,
} from "./raw-stability-core.js?v=2";
import {
  matchAggregateToRaw,
  normalizeTradeEvent,
  sourceFromTradePayload,
} from "./trade-latency-core.js?v=2.1";

const SOURCES = ["aggTrade", "trade"];
const SOURCE_LABELS = { aggTrade: "@aggTrade", trade: "@trade" };
const SAMPLE_LIMIT = 20_000;
const RAW_ID_LIMIT = 50_000;
const SEEN_ID_LIMIT = 50_000;
const EVENT_LOG_LIMIT = 2_000;
const INVALID_SAMPLE_LIMIT = 100;
const MATCH_WAIT_MS = 2_500;
const MATCH_GUARD_MS = 5_000;
const FIRST_MESSAGE_TIMEOUT_MS = 15_000;
const SOURCE_STALL_MS = 3_000;
const WATCHDOG_STALE_MS = 10_000;
const WATCHDOG_COUNTERPART_FRESH_MS = 2_000;
const UI_INTERVAL_MS = 500;

const nowEpoch = () => performance.timeOrigin + performance.now();
const otherSource = (source) => source === "trade" ? "aggTrade" : "trade";

const els = {
  count: document.querySelector("#symbol-count"),
  symbols: document.querySelector("#symbols"),
  duration: document.querySelector("#duration"),
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  restartRaw: document.querySelector("#restart-raw"),
  download: document.querySelector("#download"),
  progress: document.querySelector("#progress"),
  runTime: document.querySelector("#run-time"),
  phase: document.querySelector("#phase"),
  visibility: document.querySelector("#visibility"),
  verdict: document.querySelector("#verdict"),
  routeRaw: document.querySelector("#route-raw"),
  routeAgg: document.querySelector("#route-agg"),
  rawStatus: document.querySelector("#raw-status"),
  aggStatus: document.querySelector("#agg-status"),
  rawReconnects: document.querySelector("#raw-reconnects"),
  aggReconnects: document.querySelector("#agg-reconnects"),
  rawRecovery: document.querySelector("#raw-recovery"),
  aggRecovery: document.querySelector("#agg-recovery"),
  symbolBody: document.querySelector("#symbol-body"),
  eventBody: document.querySelector("#event-body"),
};

function createReservoir(limit = SAMPLE_LIMIT) {
  return { limit, seen: 0, values: [] };
}

function createStreamSymbolState() {
  return {
    messages: 0,
    quote: 0,
    invalidEvents: 0,
    invalidReasons: new Map(),
    rejectedSequenceIds: 0,
    gaps: 0,
    duplicates: 0,
    outOfOrder: 0,
    overlap: 0,
    unplannedStalls: 0,
    unplannedStallMs: 0,
    lastEventAt: 0,
    lastSequence: null,
    segmentId: 0,
    seenIds: new Set(),
    seenOrder: [],
    activeStall: null,
  };
}

function createMatchingState() {
  return {
    total: 0,
    complete: 0,
    rawEarlier: 0,
    abandoned: 0,
    firstLead: createReservoir(),
    completeLead: createReservoir(),
    coverage: createReservoir(),
    volumeDifference: createReservoir(),
  };
}

function createSymbolState(symbol) {
  return {
    symbol,
    streams: {
      aggTrade: createStreamSymbolState(),
      trade: createStreamSymbolState(),
    },
    readySources: new Set(),
    pairReadyAt: 0,
    rawById: new Map(),
    rawOrder: [],
    pendingAggregates: new Map(),
    matchTimers: new Map(),
    matching: createMatchingState(),
  };
}

function createConnectionState(source) {
  return {
    source,
    status: "idle",
    statusText: "Ожидание",
    transport: "—",
    socket: null,
    serial: 0,
    segmentId: 0,
    liveSegments: 0,
    attempts: 0,
    endpointIndex: 0,
    reconnectAttempt: 0,
    plannedReconnects: 0,
    unplannedReconnects: 0,
    firstMessageTimer: 0,
    reconnectTimer: 0,
    lastAnyEventAt: 0,
    validMessages: 0,
    liveSymbols: new Set(),
    invalidEvents: 0,
    invalidReasons: new Map(),
    pendingClose: null,
    recoveryPendingAt: 0,
    recoveryReason: null,
    recovery: createReservoir(2_000),
    openFailures: 0,
    disabled: false,
  };
}

function createRuntime() {
  return {
    generation: 0,
    phase: "idle",
    completed: false,
    symbols: [],
    durationMs: 60 * 60 * 1_000,
    startedAt: 0,
    stoppedAt: 0,
    deadlineAt: 0,
    visibleStartedAt: 0,
    visibleMs: 0,
    hiddenStartedAt: 0,
    hiddenMs: 0,
    uiTimer: 0,
    finishTimer: 0,
    watchdogTimer: 0,
    stopping: false,
    eventLog: [],
    droppedEvents: 0,
    invalidSamples: [],
    symbolStates: new Map(),
    connections: {
      aggTrade: createConnectionState("aggTrade"),
      trade: createConnectionState("trade"),
    },
  };
}

let runtime = createRuntime();

function routedEndpoints(source, symbols) {
  const streams = symbols.map((symbol) => `${symbol.toLowerCase()}@${source}`).join("/");
  const route = source === "trade" ? "public" : "market";
  return [
    {
      name: `${route} · combined query`,
      url: `wss://fstream.binance.com/${route}/stream?streams=${streams}`,
    },
    {
      name: `${route} · combined path`,
      url: `wss://fstream.binance.com/${route}/ws/${streams}`,
    },
  ];
}

function logEvent(type, details = {}) {
  const event = {
    at: nowEpoch(),
    elapsedMs: runtime.startedAt ? Math.max(0, nowEpoch() - runtime.startedAt) : 0,
    type,
    ...details,
  };
  runtime.eventLog.push(event);
  if (runtime.eventLog.length > EVENT_LOG_LIMIT) {
    const overflow = runtime.eventLog.length - EVENT_LOG_LIMIT;
    runtime.eventLog.splice(0, overflow);
    runtime.droppedEvents += overflow;
  }
}

function incrementReason(reasons, reason) {
  const key = String(reason || "unknown");
  reasons.set(key, (reasons.get(key) || 0) + 1);
}

function reasonsSummary(reasons) {
  return Object.fromEntries([...reasons.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function recordInvalidPayload(source, event, receiveAt, diagnosis) {
  const connection = runtime.connections[source];
  const state = runtime.symbolStates.get(diagnosis.symbol);
  connection.invalidEvents += 1;
  incrementReason(connection.invalidReasons, diagnosis.reason);

  let sequenceObserved = false;
  if (state) {
    const stream = state.streams[source];
    stream.invalidEvents += 1;
    incrementReason(stream.invalidReasons, diagnosis.reason);
    const sample = diagnosis.sequenceSample;
    if (sample && recordSeen(stream, sample.id)) {
      const delta = sequenceDelta(source, stream.lastSequence, sample);
      if (delta.valid) {
        stream.lastSequence = delta.nextLast;
        stream.gaps += delta.gapCount;
        if (delta.outOfOrder) stream.outOfOrder += 1;
        if (delta.overlap && !delta.outOfOrder) stream.overlap += 1;
        stream.rejectedSequenceIds += 1;
        sequenceObserved = true;
      }
    }
  }

  const details = {
    source,
    symbol: diagnosis.symbol,
    reason: diagnosis.reason,
    sequenceObserved,
  };
  logEvent("invalid-event", details);
  if (runtime.invalidSamples.length < INVALID_SAMPLE_LIMIT) {
    runtime.invalidSamples.push({
      at: receiveAt,
      ...details,
      payload: sanitizeTradePayload(event),
    });
  }
}

function parsePayload(raw) {
  let payload;
  try { payload = JSON.parse(raw); } catch { return null; }
  if (payload?.result === null || Number.isFinite(Number(payload?.id))) return null;
  return { stream: String(payload?.stream ?? "").toLowerCase(), data: payload?.data ?? payload };
}

function closeMatchTimers(state) {
  for (const timer of state.matchTimers.values()) clearTimeout(timer);
  state.matchTimers.clear();
}

function resetPairWindow(state, source) {
  state.matching.abandoned += state.pendingAggregates.size;
  closeMatchTimers(state);
  state.pendingAggregates.clear();
  state.rawById.clear();
  state.rawOrder = [];
  state.readySources.delete(source);
  state.pairReadyAt = 0;
}

function beginSourceSegment(source, segmentId) {
  for (const state of runtime.symbolStates.values()) {
    const stream = state.streams[source];
    stream.segmentId = segmentId;
    stream.lastSequence = null;
    stream.seenIds.clear();
    stream.seenOrder = [];
    finishStall(state, source, nowEpoch(), "segment-reset", false);
    resetPairWindow(state, source);
  }
}

function clearConnectionTimers(connection) {
  clearTimeout(connection.firstMessageTimer);
  clearTimeout(connection.reconnectTimer);
  connection.firstMessageTimer = 0;
  connection.reconnectTimer = 0;
}

function sourceStreamNames(source) {
  return runtime.symbols.map((symbol) => `${symbol.toLowerCase()}@${source}`);
}

function connectSource(source, reason = "initial") {
  const connection = runtime.connections[source];
  if (runtime.stopping || connection.disabled || runtime.phase !== "running") return;
  clearConnectionTimers(connection);
  const endpoints = routedEndpoints(source, runtime.symbols);
  const endpoint = endpoints[connection.endpointIndex] ?? endpoints[0];
  connection.attempts += 1;
  connection.serial += 1;
  connection.segmentId += 1;
  connection.status = "connecting";
  connection.statusText = "CONNECTING";
  connection.transport = endpoint.name;
  connection.liveSymbols.clear();
  connection.validMessages = 0;
  connection.lastAnyEventAt = 0;
  beginSourceSegment(source, connection.segmentId);
  const serial = connection.serial;
  logEvent("connect-attempt", { source, reason, endpoint: endpoint.name, attempt: connection.attempts, segmentId: connection.segmentId });

  let socket;
  try {
    socket = new WebSocket(endpoint.url);
  } catch (error) {
    connection.openFailures += 1;
    logEvent("connect-constructor-error", { source, message: String(error?.message ?? error) });
    scheduleReconnect(source, "constructor-error", false);
    return;
  }
  connection.socket = socket;

  connection.firstMessageTimer = setTimeout(() => {
    if (connection.socket !== socket || connection.validMessages > 0 || runtime.phase !== "running") return;
    connection.pendingClose = { reason: "first-message-timeout", planned: false, requestedAt: nowEpoch() };
    try { socket.close(4002, "first-message-timeout"); } catch {}
  }, FIRST_MESSAGE_TIMEOUT_MS);

  socket.addEventListener("open", () => {
    if (connection.socket !== socket || connection.serial !== serial) return;
    connection.status = "open";
    connection.statusText = "OPEN · ЖДУ ДАННЫЕ";
    logEvent("socket-open", { source, endpoint: endpoint.name, segmentId: connection.segmentId });
  });

  socket.addEventListener("message", (message) => {
    if (connection.socket !== socket || connection.serial !== serial || runtime.phase !== "running") return;
    const payload = parsePayload(message.data);
    if (!payload) return;
    const payloadSource = sourceFromTradePayload(payload);
    if (payloadSource !== source) return;
    const receiveAt = nowEpoch();
    const sample = normalizeTradeEvent(payload.data, source, receiveAt);
    if (!sample || !runtime.symbolStates.has(sample.symbol)) {
      const initialDiagnosis = diagnoseTradePayload(payload.data, source, receiveAt);
      const diagnosis = initialDiagnosis.valid
        ? { ...initialDiagnosis, valid: false, reason: "unexpected-symbol" }
        : initialDiagnosis;
      recordInvalidPayload(source, payload.data, receiveAt, diagnosis);
      return;
    }

    if (connection.validMessages === 0) {
      clearTimeout(connection.firstMessageTimer);
      connection.firstMessageTimer = 0;
      connection.liveSegments += 1;
      connection.reconnectAttempt = 0;
      connection.status = "live";
      connection.statusText = "LIVE";
      if (connection.recoveryPendingAt) {
        const recoveryMs = receiveAt - connection.recoveryPendingAt;
        reservoirPush(connection.recovery, recoveryMs);
        logEvent("source-recovered", { source, reason: connection.recoveryReason, recoveryMs, segmentId: connection.segmentId });
        connection.recoveryPendingAt = 0;
        connection.recoveryReason = null;
      }
    }
    connection.validMessages += 1;
    connection.lastAnyEventAt = receiveAt;
    connection.liveSymbols.add(sample.symbol);
    onSample(sample);
  });

  socket.addEventListener("close", (event) => {
    if (connection.socket !== socket || connection.serial !== serial) return;
    clearTimeout(connection.firstMessageTimer);
    connection.firstMessageTimer = 0;
    connection.socket = null;
    if (runtime.stopping || connection.disabled || runtime.phase !== "running") return;

    const pending = connection.pendingClose;
    connection.pendingClose = null;
    const planned = Boolean(pending?.planned);
    const closeReason = pending?.reason || event.reason || `close-${event.code}`;
    if (planned) connection.plannedReconnects += 1;
    else connection.unplannedReconnects += 1;
    connection.status = "reconnecting";
    connection.statusText = "RECONNECT";
    if (!connection.recoveryPendingAt) {
      connection.recoveryPendingAt = nowEpoch();
      connection.recoveryReason = closeReason;
    }
    logEvent("socket-close", {
      source,
      planned,
      reason: closeReason,
      code: event.code,
      clean: event.wasClean,
      endpoint: endpoint.name,
      segmentId: connection.segmentId,
    });

    if (connection.validMessages === 0 && connection.endpointIndex + 1 < endpoints.length) {
      connection.endpointIndex += 1;
      connection.openFailures += 1;
      scheduleReconnect(source, "endpoint-fallback", planned, 250);
      return;
    }
    connection.endpointIndex = 0;
    scheduleReconnect(source, closeReason, planned);
  });

  socket.addEventListener("error", () => {
    if (connection.socket !== socket || connection.serial !== serial) return;
    logEvent("socket-error", { source, endpoint: endpoint.name, segmentId: connection.segmentId });
    try { socket.close(); } catch {}
  });
}

function scheduleReconnect(source, reason, planned, explicitDelay = null) {
  const connection = runtime.connections[source];
  if (runtime.stopping || connection.disabled || runtime.phase !== "running") return;
  clearTimeout(connection.reconnectTimer);
  const delay = explicitDelay ?? reconnectDelay(connection.reconnectAttempt++);
  connection.reconnectTimer = setTimeout(() => connectSource(source, reason), delay);
  logEvent("reconnect-scheduled", { source, reason, planned, delayMs: delay });
}

function restartSource(source, reason, planned = true) {
  if (runtime.phase !== "running") return;
  const connection = runtime.connections[source];
  connection.recoveryPendingAt = nowEpoch();
  connection.recoveryReason = reason;
  connection.pendingClose = { reason, planned, requestedAt: connection.recoveryPendingAt };
  logEvent("restart-requested", { source, reason, planned });
  if (connection.socket) {
    try { connection.socket.close(4001, reason.slice(0, 120)); } catch {}
  } else {
    connection.pendingClose = null;
    if (planned) connection.plannedReconnects += 1;
    else connection.unplannedReconnects += 1;
    clearConnectionTimers(connection);
    scheduleReconnect(source, reason, planned, 0);
  }
}

function recordSeen(stream, id) {
  const key = Number(id);
  if (stream.seenIds.has(key)) {
    stream.duplicates += 1;
    return false;
  }
  stream.seenIds.add(key);
  stream.seenOrder.push(key);
  if (stream.seenOrder.length > SEEN_ID_LIMIT) {
    const overflow = stream.seenOrder.length - SEEN_ID_LIMIT;
    for (const old of stream.seenOrder.splice(0, overflow)) stream.seenIds.delete(old);
  }
  return true;
}

function onSample(sample) {
  const state = runtime.symbolStates.get(sample.symbol);
  const stream = state.streams[sample.source];
  const connection = runtime.connections[sample.source];
  if (stream.segmentId !== connection.segmentId) beginSourceSegment(sample.source, connection.segmentId);
  if (!recordSeen(stream, sample.id)) return;

  const delta = sequenceDelta(sample.source, stream.lastSequence, sample);
  if (!delta.valid) {
    stream.invalidEvents += 1;
    return;
  }
  stream.lastSequence = delta.nextLast;
  stream.gaps += delta.gapCount;
  if (delta.outOfOrder) stream.outOfOrder += 1;
  if (delta.overlap && !delta.outOfOrder) stream.overlap += 1;
  stream.messages += 1;
  stream.quote += sample.quote;
  stream.lastEventAt = sample.receiveAt;

  finishStall(state, sample.source, sample.receiveAt, "source-returned", true);
  maybeStartCounterpartStall(state, sample.source, sample.receiveAt);

  if (!state.readySources.has(sample.source)) {
    state.readySources.add(sample.source);
    if (state.readySources.size === SOURCES.length) state.pairReadyAt = sample.receiveAt;
  }

  if (sample.source === "trade") {
    state.rawById.set(sample.id, sample);
    state.rawOrder.push(sample.id);
    if (state.rawOrder.length > RAW_ID_LIMIT) {
      const overflow = state.rawOrder.length - RAW_ID_LIMIT;
      for (const id of state.rawOrder.splice(0, overflow)) state.rawById.delete(id);
    }
    retryPendingMatches(state, sample.id);
    return;
  }

  if (state.readySources.size < SOURCES.length || sample.receiveAt - state.pairReadyAt < MATCH_GUARD_MS) return;
  state.pendingAggregates.set(sample.id, sample);
  tryFinalizeMatch(state, sample.id, false);
  const timer = setTimeout(() => tryFinalizeMatch(state, sample.id, true), MATCH_WAIT_MS);
  state.matchTimers.set(sample.id, timer);
}

function retryPendingMatches(state, rawId) {
  for (const aggregate of [...state.pendingAggregates.values()].slice(-300)) {
    if (rawId >= aggregate.firstTradeId && rawId <= aggregate.lastTradeId) {
      tryFinalizeMatch(state, aggregate.id, false);
    }
  }
}

function tryFinalizeMatch(state, aggregateId, force) {
  const aggregate = state.pendingAggregates.get(aggregateId);
  if (!aggregate) return;
  const match = matchAggregateToRaw(aggregate, state.rawById);
  if (!match) return;
  if (!force && match.coverage < 1) return;
  state.pendingAggregates.delete(aggregateId);
  clearTimeout(state.matchTimers.get(aggregateId));
  state.matchTimers.delete(aggregateId);

  const matching = state.matching;
  matching.total += 1;
  if (match.coverage >= .9999) matching.complete += 1;
  reservoirPush(matching.coverage, match.coverage);
  reservoirPush(matching.volumeDifference, match.volumeDifferencePercent);
  if (Number.isFinite(match.rawFirstLeadMs)) {
    reservoirPush(matching.firstLead, match.rawFirstLeadMs);
    if (match.rawFirstLeadMs > 0) matching.rawEarlier += 1;
  }
  reservoirPush(matching.completeLead, match.rawCompleteLeadMs);
}

function maybeStartCounterpartStall(state, activeSource, receiveAt) {
  if (document.hidden) return;
  const stalledSource = otherSource(activeSource);
  const connection = runtime.connections[stalledSource];
  if (connection.status !== "live") return;
  const stalled = state.streams[stalledSource];
  if (!stalled.lastEventAt || receiveAt <= stalled.lastEventAt) return;
  const observation = advanceSourceStallCandidate(
    stalled.activeStall,
    receiveAt,
    SOURCE_STALL_MS,
    WATCHDOG_COUNTERPART_FRESH_MS,
  );
  stalled.activeStall = observation.candidate;
  if (!observation.confirmedNow) return;
  logEvent("source-only-stall", {
    source: stalledSource,
    symbol: state.symbol,
    detectedAfterMs: receiveAt - stalled.activeStall.startedAt,
  });
}

function finishStall(state, source, endedAt, reason, countFailure) {
  const stream = state.streams[source];
  const stall = stream.activeStall;
  if (!stall) return;
  const durationMs = Math.max(0, Number(endedAt) - stall.startedAt);
  if (countFailure && stall.reason === "source-only" && stall.confirmed) {
    stream.unplannedStalls += 1;
    stream.unplannedStallMs += durationMs;
  }
  if (stall.confirmed) {
    logEvent("stall-ended", {
      source,
      symbol: state.symbol,
      reason,
      durationMs,
      counted: Boolean(countFailure),
    });
  }
  stream.activeStall = null;
}

function watchdogTick() {
  if (runtime.phase !== "running" || document.hidden) return;
  const now = nowEpoch();
  for (const source of SOURCES) {
    const connection = runtime.connections[source];
    const counterpart = runtime.connections[otherSource(source)];
    if (
      connection.status === "live"
      && connection.lastAnyEventAt
      && now - connection.lastAnyEventAt > WATCHDOG_STALE_MS
      && counterpart.lastAnyEventAt
      && now - counterpart.lastAnyEventAt <= WATCHDOG_COUNTERPART_FRESH_MS
    ) {
      restartSource(source, "watchdog-source-stale", false);
    }
  }
  if (runtime.deadlineAt && now >= runtime.deadlineAt) finishRun(true);
}

function startRun() {
  const count = Number(els.count.value) || 1;
  const symbols = normalizeSymbols(els.symbols.value, count);
  if (symbols.length !== count) {
    els.symbols.setCustomValidity(`Нужно ${count} уникальных тикера Binance без слеша`);
    els.symbols.reportValidity();
    return;
  }
  els.symbols.setCustomValidity("");
  stopRuntimeResources();
  runtime = createRuntime();
  runtime.generation += 1;
  runtime.phase = "running";
  runtime.symbols = symbols;
  runtime.durationMs = Math.max(60_000, Number(els.duration.value) * 1_000 || 3_600_000);
  runtime.startedAt = nowEpoch();
  runtime.deadlineAt = runtime.startedAt + runtime.durationMs;
  if (document.hidden) runtime.hiddenStartedAt = runtime.startedAt;
  else runtime.visibleStartedAt = runtime.startedAt;
  for (const symbol of symbols) runtime.symbolStates.set(symbol, createSymbolState(symbol));
  logEvent("run-start", { symbols, durationMs: runtime.durationMs });
  for (const source of SOURCES) connectSource(source, "initial");
  runtime.uiTimer = setInterval(updateUI, UI_INTERVAL_MS);
  runtime.watchdogTimer = setInterval(watchdogTick, 1_000);
  runtime.finishTimer = setTimeout(() => finishRun(true), runtime.durationMs);
  lockControls(true);
  updateUrl();
  updateUI();
}

function finishRun(completed) {
  if (runtime.phase !== "running") return;
  const stoppedAt = nowEpoch();
  runtime.completed = Boolean(completed && stoppedAt >= runtime.deadlineAt - 1_000);
  runtime.stoppedAt = stoppedAt;
  if (runtime.visibleStartedAt) {
    runtime.visibleMs += Math.max(0, stoppedAt - runtime.visibleStartedAt);
    runtime.visibleStartedAt = 0;
  }
  if (runtime.hiddenStartedAt) {
    runtime.hiddenMs += Math.max(0, stoppedAt - runtime.hiddenStartedAt);
    runtime.hiddenStartedAt = 0;
  }
  for (const state of runtime.symbolStates.values()) {
    for (const source of SOURCES) finishStall(state, source, stoppedAt, "run-finished", true);
    for (const aggregateId of [...state.pendingAggregates.keys()]) tryFinalizeMatch(state, aggregateId, true);
    closeMatchTimers(state);
  }
  runtime.phase = completed ? "finished" : "stopped";
  logEvent(completed ? "run-finished" : "run-stopped", { completed: runtime.completed });
  stopRuntimeResources();
  lockControls(false);
  updateUI();
}

function stopRuntimeResources() {
  clearInterval(runtime.uiTimer);
  clearInterval(runtime.watchdogTimer);
  clearTimeout(runtime.finishTimer);
  runtime.uiTimer = 0;
  runtime.watchdogTimer = 0;
  runtime.finishTimer = 0;
  runtime.stopping = true;
  for (const source of SOURCES) {
    const connection = runtime.connections[source];
    connection.disabled = true;
    clearConnectionTimers(connection);
    if (connection.socket) {
      try { connection.socket.close(1000, "lab-stop"); } catch {}
      connection.socket = null;
    }
  }
  runtime.stopping = false;
}

function lockControls(running) {
  els.count.disabled = running;
  els.symbols.disabled = running;
  els.duration.disabled = running;
  els.start.disabled = running;
  els.stop.disabled = !running;
  els.restartRaw.disabled = !running;
  els.download.disabled = running || !["finished", "stopped"].includes(runtime.phase);
}

function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set("count", String(runtime.symbols.length));
  url.searchParams.set("symbols", runtime.symbols.join(","));
  url.searchParams.set("duration", String(Math.round(runtime.durationMs / 1_000)));
  history.replaceState(null, "", url);
}

function visibilitySnapshot(at = nowEpoch()) {
  return {
    visibleMs: runtime.visibleMs + (runtime.visibleStartedAt ? Math.max(0, at - runtime.visibleStartedAt) : 0),
    hiddenMs: runtime.hiddenMs + (runtime.hiddenStartedAt ? Math.max(0, at - runtime.hiddenStartedAt) : 0),
  };
}

function connectionSummary(source) {
  const connection = runtime.connections[source];
  return {
    source,
    status: connection.status,
    statusText: connection.statusText,
    transport: connection.transport,
    streamNames: sourceStreamNames(source),
    attempts: connection.attempts,
    liveSegments: connection.liveSegments,
    plannedReconnects: connection.plannedReconnects,
    unplannedReconnects: connection.unplannedReconnects,
    openFailures: connection.openFailures,
    invalidEvents: connection.invalidEvents,
    invalidReasons: reasonsSummary(connection.invalidReasons),
    recoveryPending: Boolean(connection.recoveryPendingAt),
    lastAnyEventAt: connection.lastAnyEventAt || null,
    recovery: summarizeReservoir(connection.recovery),
  };
}

function streamSummary(stream) {
  return {
    messages: stream.messages,
    quote: stream.quote,
    invalidEvents: stream.invalidEvents,
    invalidReasons: reasonsSummary(stream.invalidReasons),
    rejectedSequenceIds: stream.rejectedSequenceIds,
    gaps: stream.gaps,
    duplicates: stream.duplicates,
    outOfOrder: stream.outOfOrder,
    overlap: stream.overlap,
    unplannedStalls: stream.unplannedStalls,
    unplannedStallMs: stream.unplannedStallMs,
    lastEventAt: stream.lastEventAt || null,
  };
}

function symbolSummary(state) {
  return {
    symbol: state.symbol,
    streams: {
      aggTrade: streamSummary(state.streams.aggTrade),
      trade: streamSummary(state.streams.trade),
    },
    matching: summarizeMatching(state.matching),
  };
}

function buildSnapshot() {
  const at = runtime.stoppedAt || nowEpoch();
  const visibility = visibilitySnapshot(at);
  const symbols = [...runtime.symbolStates.values()].map(symbolSummary);
  const assessment = buildStabilityAssessment({
    phase: runtime.phase,
    completed: runtime.completed,
    visibleMs: visibility.visibleMs,
    minimumVisibleMs: RAW_STABILITY_MIN_VISIBLE_MS,
    connections: {
      aggTrade: connectionSummary("aggTrade"),
      trade: connectionSummary("trade"),
    },
    symbols,
  });
  return {
    schemaVersion: RAW_STABILITY_SCHEMA_VERSION,
    labVersion: "raw-stability-v2",
    generatedAt: new Date(at).toISOString(),
    config: {
      symbols: runtime.symbols,
      symbolCount: runtime.symbols.length,
      durationMs: runtime.durationMs,
      routes: {
        trade: "/public",
        aggTrade: "/market",
      },
      thresholds: {
        minimumVisibleMs: RAW_STABILITY_MIN_VISIBLE_MS,
        sourceStallMs: SOURCE_STALL_MS,
        watchdogStaleMs: WATCHDOG_STALE_MS,
        matchWaitMs: MATCH_WAIT_MS,
      },
    },
    run: {
      phase: runtime.phase,
      completed: runtime.completed,
      startedAt: runtime.startedAt ? new Date(runtime.startedAt).toISOString() : null,
      stoppedAt: runtime.stoppedAt ? new Date(runtime.stoppedAt).toISOString() : null,
      elapsedMs: runtime.startedAt ? Math.max(0, at - runtime.startedAt) : 0,
      visibleMs: visibility.visibleMs,
      hiddenMs: visibility.hiddenMs,
    },
    connections: {
      aggTrade: connectionSummary("aggTrade"),
      trade: connectionSummary("trade"),
    },
    symbols,
    assessment,
    events: runtime.eventLog,
    droppedEvents: runtime.droppedEvents,
    invalidSamples: runtime.invalidSamples,
    limitations: [
      "Browser background throttling is part of the observation and is separated from visible time.",
      "@trade is undocumented in the current Binance USDⓈ-M routed stream table.",
      "A clean run does not promote RAW by itself; the 1 / 2 / 4-symbol campaign and background/reconnect scenarios must all pass.",
      "Production TAPE remains @aggTrade in this PR.",
    ],
  };
}

function downloadSnapshot() {
  const snapshot = buildSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `inpuls-raw-stability-${runtime.symbols.length || 0}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function updateUI() {
  const at = runtime.stoppedAt || nowEpoch();
  const elapsed = runtime.startedAt ? Math.max(0, at - runtime.startedAt) : 0;
  const progress = runtime.durationMs ? Math.min(1, elapsed / runtime.durationMs) : 0;
  const visibility = visibilitySnapshot(at);
  els.progress.style.width = `${progress * 100}%`;
  els.runTime.textContent = `${formatDuration(elapsed)} / ${formatDuration(runtime.durationMs)}`;
  els.phase.dataset.state = runtime.phase === "running" ? "live" : (runtime.phase === "stopped" ? "error" : "idle");
  els.phase.textContent = phaseLabel(runtime.phase);
  els.visibility.textContent = `видимо ${formatDuration(visibility.visibleMs)} · фон ${formatDuration(visibility.hiddenMs)}`;

  updateConnectionUI("trade");
  updateConnectionUI("aggTrade");
  updateSymbolTable();
  updateEventTable();

  const snapshot = buildSnapshot();
  els.verdict.dataset.tone = snapshot.assessment.tone;
  els.verdict.querySelector("strong").textContent = snapshot.assessment.title;
  els.verdict.querySelector("p").textContent = snapshot.assessment.text;
}

function updateConnectionUI(source) {
  const connection = runtime.connections[source];
  const summary = summarizeReservoir(connection.recovery);
  const status = source === "trade" ? els.rawStatus : els.aggStatus;
  const reconnects = source === "trade" ? els.rawReconnects : els.aggReconnects;
  const recovery = source === "trade" ? els.rawRecovery : els.aggRecovery;
  const route = source === "trade" ? els.routeRaw : els.routeAgg;
  status.textContent = `${connection.statusText} · ${connection.liveSymbols.size}/${runtime.symbols.length || 0}`;
  reconnects.textContent = `${connection.plannedReconnects} план · ${connection.unplannedReconnects} аварий`;
  recovery.textContent = summary.count ? `P50 ${formatMs(summary.p50)} · P95 ${formatMs(summary.p95)}` : "—";
  route.textContent = connection.transport;
}

function updateSymbolTable() {
  const states = [...runtime.symbolStates.values()];
  if (!states.length) {
    els.symbolBody.innerHTML = '<tr><td colspan="12" class="empty">Запусти лабораторию</td></tr>';
    return;
  }
  els.symbolBody.innerHTML = states.map((state) => {
    const raw = state.streams.trade;
    const aggregate = state.streams.aggTrade;
    const matching = summarizeMatching(state.matching);
    return `<tr>
      <td><strong>${state.symbol}</strong></td>
      <td>${raw.messages.toLocaleString("ru-RU")}</td>
      <td>${aggregate.messages.toLocaleString("ru-RU")}</td>
      <td class="${raw.gaps ? "negative" : "positive"}">${raw.gaps}</td>
      <td class="${raw.duplicates ? "negative" : ""}">${raw.duplicates}</td>
      <td class="${raw.outOfOrder ? "negative" : ""}">${raw.outOfOrder}</td>
      <td class="${raw.unplannedStalls ? "negative" : ""}">${raw.unplannedStalls} · ${formatDuration(raw.unplannedStallMs)}</td>
      <td>${matching.total.toLocaleString("ru-RU")}</td>
      <td>${matching.total ? formatPercent(matching.fullCoverageRatio * 100, 4) : "—"}</td>
      <td>${matching.rawEarlierRatio === null ? "—" : formatPercent(matching.rawEarlierRatio * 100, 1)}</td>
      <td>${signedMs(matching.firstLead.p50)} / ${signedMs(matching.firstLead.p95)}</td>
      <td>${Number.isFinite(matching.volumeDifferenceP99) ? formatPercent(matching.volumeDifferenceP99, 4) : "—"}</td>
    </tr>`;
  }).join("");
}

function updateEventTable() {
  const events = runtime.eventLog.slice(-80).reverse();
  if (!events.length) {
    els.eventBody.innerHTML = '<tr><td colspan="5" class="empty">Событий пока нет</td></tr>';
    return;
  }
  els.eventBody.innerHTML = events.map((event) => `<tr>
    <td>${formatClock(event.at)}</td>
    <td>${event.type}</td>
    <td>${event.source ? SOURCE_LABELS[event.source] : "—"}</td>
    <td>${event.symbol ?? "—"}</td>
    <td>${escapeHtml(event.reason ?? event.endpoint ?? (Number.isFinite(event.recoveryMs) ? `${event.recoveryMs.toFixed(1)} ms` : "—"))}</td>
  </tr>`).join("");
}

function phaseLabel(phase) {
  return ({
    idle: "Готов",
    running: "LIVE LAB",
    finished: "Завершён",
    stopped: "Остановлен",
  })[phase] ?? phase;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatMs(value) { return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} мс` : "—"; }
function signedMs(value) { return Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)} мс` : "—"; }
function formatPercent(value, digits) { return Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}%` : "—"; }
const CLOCK_FORMATTER = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
function formatClock(value) { return CLOCK_FORMATTER.format(new Date(value)); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

els.count.addEventListener("change", () => {
  const presets = {
    1: ["BTCUSDT"],
    2: ["BTCUSDT", "ETHUSDT"],
    4: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"],
  };
  els.symbols.value = presets[Number(els.count.value)]?.join(", ") ?? els.symbols.value;
});
els.symbols.addEventListener("input", () => els.symbols.setCustomValidity(""));
els.start.addEventListener("click", startRun);
els.stop.addEventListener("click", () => finishRun(false));
els.restartRaw.addEventListener("click", () => restartSource("trade", "manual-raw-restart", true));
els.download.addEventListener("click", downloadSnapshot);

document.addEventListener("visibilitychange", () => {
  if (runtime.phase !== "running") return;
  const at = nowEpoch();
  if (document.hidden) {
    if (runtime.visibleStartedAt) {
      runtime.visibleMs += Math.max(0, at - runtime.visibleStartedAt);
      runtime.visibleStartedAt = 0;
    }
    runtime.hiddenStartedAt = at;
    for (const state of runtime.symbolStates.values()) {
      for (const source of SOURCES) finishStall(state, source, at, "background", false);
    }
    logEvent("visibility-hidden");
    return;
  }

  if (runtime.hiddenStartedAt) {
    runtime.hiddenMs += Math.max(0, at - runtime.hiddenStartedAt);
    runtime.hiddenStartedAt = 0;
  }
  runtime.visibleStartedAt = at;
  logEvent("visibility-visible");
  if (runtime.deadlineAt && at >= runtime.deadlineAt) {
    finishRun(true);
    return;
  }
  for (const source of SOURCES) restartSource(source, "background-resume-clean-restart", true);
});

window.addEventListener("beforeunload", stopRuntimeResources);
window.__INPULS_RAW_LAB__ = {
  snapshot: buildSnapshot,
  download: downloadSnapshot,
  restartRaw: () => restartSource("trade", "console-raw-restart", true),
  restartAll: () => SOURCES.forEach((source) => restartSource(source, "console-all-restart", true)),
};

const params = new URL(location.href).searchParams;
const initialCount = [1, 2, 4].includes(Number(params.get("count"))) ? Number(params.get("count")) : 4;
els.count.value = String(initialCount);
const initialSymbols = normalizeSymbols(params.get("symbols") || "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT", initialCount);
if (initialSymbols.length === initialCount) els.symbols.value = initialSymbols.join(", ");
const initialDuration = Number(params.get("duration"));
if ([300, 900, 1800, 3600, 14400, 28800].includes(initialDuration)) els.duration.value = String(initialDuration);
lockControls(false);
updateUI();
