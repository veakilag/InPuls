import {
  buildRunValidity,
  buildVerdict,
  estimateClockOffset,
  matchAggregateToRaw,
  normalizeTradeEvent,
  percentile,
  sourceFromTradePayload,
  summarize,
} from "./trade-latency-core.js?v=2.1";

const SOURCES = ["aggTrade", "trade"];
const MAX_SAMPLES = 30_000;
const MAX_LATENCY_SAMPLES = 10_000;
const MAX_RAW_IDS = 100_000;
const MAX_MATCHES = 5_000;
const MAX_PAINT_QUEUE = 5_000;
const PAINT_BATCH = 120;
const MATCH_WAIT_MS = 2_000;
const MATCH_START_GUARD_MS = 500;
const FIRST_BOTH_STREAMS_TIMEOUT_MS = 10_000;
const WARMUP_MS = 5_000;

const epochNow = () => performance.timeOrigin + performance.now();

const els = {
  symbol: document.querySelector("#symbol"),
  duration: document.querySelector("#duration"),
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  marker: document.querySelector("#marker"),
  export: document.querySelector("#export"),
  progress: document.querySelector("#progress"),
  runTime: document.querySelector("#run-time"),
  validityState: document.querySelector("#validity-state"),
  clockState: document.querySelector("#clock-state"),
  clockNote: document.querySelector("#clock-note"),
  verdict: document.querySelector("#verdict"),
  matchedStatus: document.querySelector("#matched-status"),
  matchedCount: document.querySelector("#matched-count"),
  matchedComplete: document.querySelector("#matched-complete"),
  rawEarlier: document.querySelector("#raw-earlier"),
  leadP50: document.querySelector("#lead-p50"),
  leadP95: document.querySelector("#lead-p95"),
  completeLeadP50: document.querySelector("#complete-lead-p50"),
  completeLeadP95: document.querySelector("#complete-lead-p95"),
  paintLeadP50: document.querySelector("#paint-lead-p50"),
  paintLeadP95: document.querySelector("#paint-lead-p95"),
  coverageP50: document.querySelector("#coverage-p50"),
  volumeDiffP50: document.querySelector("#volume-diff-p50"),
  matchBody: document.querySelector("#match-body"),
  lastMarker: document.querySelector("#last-marker"),
  markerFlash: document.querySelector("#marker-flash"),
  streams: {
    aggTrade: {
      status: document.querySelector("#agg-status"),
      reconnects: document.querySelector("#agg-reconnects"),
      transport: document.querySelector("#agg-transport"),
      count: document.querySelector("#agg-count"),
      rate: document.querySelector("#agg-rate"),
      receiveP50: document.querySelector("#agg-receive-p50"),
      receiveP95: document.querySelector("#agg-receive-p95"),
      paintP50: document.querySelector("#agg-paint-p50"),
      paintP95: document.querySelector("#agg-paint-p95"),
      visualP50: document.querySelector("#agg-visual-p50"),
      visualP95: document.querySelector("#agg-visual-p95"),
      volume: document.querySelector("#agg-volume"),
      gaps: document.querySelector("#agg-gaps"),
      duplicates: document.querySelector("#agg-duplicates"),
      queue: document.querySelector("#agg-queue"),
      drops: document.querySelector("#agg-drops"),
      tape: document.querySelector("#agg-tape"),
    },
    trade: {
      status: document.querySelector("#raw-status"),
      reconnects: document.querySelector("#raw-reconnects"),
      transport: document.querySelector("#raw-transport"),
      count: document.querySelector("#raw-count"),
      rate: document.querySelector("#raw-rate"),
      receiveP50: document.querySelector("#raw-receive-p50"),
      receiveP95: document.querySelector("#raw-receive-p95"),
      paintP50: document.querySelector("#raw-paint-p50"),
      paintP95: document.querySelector("#raw-paint-p95"),
      visualP50: document.querySelector("#raw-visual-p50"),
      visualP95: document.querySelector("#raw-visual-p95"),
      volume: document.querySelector("#raw-volume"),
      gaps: document.querySelector("#raw-gaps"),
      duplicates: document.querySelector("#raw-duplicates"),
      queue: document.querySelector("#raw-queue"),
      drops: document.querySelector("#raw-drops"),
      tape: document.querySelector("#raw-tape"),
    },
  },
};

function createStreamState(source) {
  return {
    source,
    status: "idle",
    statusText: "Ожидание",
    transport: "—",
    samples: [],
    totalMessages: 0,
    receiveLatency: [],
    paintLatency: [],
    visualLatency: [],
    quote: 0,
    gaps: 0,
    duplicates: 0,
    invalidEvents: 0,
    outOfOrder: 0,
    lastSequenceId: null,
    lastCoveredTradeId: null,
    seenIds: new Set(),
    paintQueue: [],
    paintDrops: 0,
    paintScheduled: false,
  };
}

const runtime = {
  generation: 0,
  phase: "idle",
  symbol: "BTCUSDT",
  durationMs: 180_000,
  warmupStartedAt: 0,
  startedAt: 0,
  stoppedAt: 0,
  clockOffsetMs: 0,
  clockRttMs: null,
  clockSynced: false,
  timer: 0,
  warmupTimer: 0,
  uiTimer: 0,
  probe: null,
  endpoint: "—",
  endpointAttempts: 0,
  sharedReconnects: 0,
  socketClosedDuringMeasurement: false,
  hiddenDuringMeasurement: false,
  missingStreams: false,
  invalidReasons: new Set(),
  streams: {
    aggTrade: createStreamState("aggTrade"),
    trade: createStreamState("trade"),
  },
  rawById: new Map(),
  rawIdOrder: [],
  pendingAggregates: new Map(),
  matchTimers: new Map(),
  matches: [],
  matchedIds: new Set(),
  markers: [],
};

const SHARED_ENDPOINTS = [
  {
    name: "standard · combined · 1 socket",
    url: (streams) => `wss://fstream.binance.com/stream?streams=${streams.join("/")}`,
  },
  {
    name: "market · combined · 1 socket",
    url: (streams) => `wss://fstream.binance.com/market/stream?streams=${streams.join("/")}`,
  },
  {
    name: "alt · combined · 1 socket",
    url: (streams) => `wss://stream.binancefuture.com/stream?streams=${streams.join("/")}`,
  },
];

function parsePayload(raw) {
  let payload;
  try { payload = JSON.parse(raw); } catch { return null; }
  if (payload?.result === null || payload?.id) return null;
  return { stream: String(payload?.stream ?? "").toLowerCase(), data: payload?.data ?? payload };
}

class SharedStreamProbe {
  constructor(symbol, generation, handlers) {
    this.symbol = symbol;
    this.generation = generation;
    this.handlers = handlers;
    this.socket = null;
    this.endpointIndex = 0;
    this.firstBothTimer = 0;
    this.stopped = false;
    this.ready = false;
    this.seenSources = new Set();
  }

  start() { this.connect(); }

  stop() {
    this.stopped = true;
    clearTimeout(this.firstBothTimer);
    try { this.socket?.close(); } catch {}
    this.socket = null;
  }

  connect() {
    if (this.stopped || this.generation !== runtime.generation || runtime.phase === "idle") return;
    clearTimeout(this.firstBothTimer);
    this.ready = false;
    this.seenSources.clear();
    const endpoint = SHARED_ENDPOINTS[this.endpointIndex];
    if (!endpoint) {
      this.handlers.onUnavailable();
      return;
    }

    const name = this.symbol.toLowerCase();
    const streams = [`${name}@trade`, `${name}@aggTrade`];
    const url = endpoint.url(streams);
    this.handlers.onEndpoint(endpoint.name, this.endpointIndex + 1);

    let socket;
    try { socket = new WebSocket(url); }
    catch {
      this.tryNextEndpoint();
      return;
    }
    this.socket = socket;

    this.firstBothTimer = setTimeout(() => {
      if (!this.ready && socket === this.socket) {
        try { socket.close(); } catch {}
      }
    }, FIRST_BOTH_STREAMS_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (this.stopped || socket !== this.socket) return;
      this.handlers.onConnecting(endpoint.name, "Жду оба потока");
    });

    socket.addEventListener("message", (message) => {
      if (this.stopped || socket !== this.socket) return;
      const payload = parsePayload(message.data);
      if (!payload) return;
      const source = sourceFromTradePayload(payload);
      if (!source) return;
      const receiveAt = epochNow();
      const sample = normalizeTradeEvent(payload.data, source, receiveAt, this.symbol);
      if (!sample) {
        this.handlers.onInvalid(source);
        return;
      }
      this.seenSources.add(source);
      this.handlers.onSourceLive(source, endpoint.name);
      this.handlers.onSample(sample, endpoint.name);

      if (!this.ready && this.seenSources.size === SOURCES.length) {
        this.ready = true;
        clearTimeout(this.firstBothTimer);
        this.firstBothTimer = 0;
        this.handlers.onReady(endpoint.name);
      }
    });

    socket.addEventListener("close", () => {
      if (this.stopped || socket !== this.socket) return;
      clearTimeout(this.firstBothTimer);
      this.firstBothTimer = 0;
      this.socket = null;
      if (this.ready) {
        this.handlers.onDisconnect(endpoint.name);
        return;
      }
      this.tryNextEndpoint();
    });

    socket.addEventListener("error", () => {
      if (!this.stopped && socket === this.socket) {
        try { socket.close(); } catch {}
      }
    });
  }

  tryNextEndpoint() {
    if (this.stopped) return;
    this.endpointIndex += 1;
    if (this.endpointIndex >= SHARED_ENDPOINTS.length) {
      this.handlers.onUnavailable();
      return;
    }
    setTimeout(() => this.connect(), 250);
  }
}

function clearTimers() {
  clearTimeout(runtime.timer);
  clearTimeout(runtime.warmupTimer);
  clearInterval(runtime.uiTimer);
  runtime.timer = 0;
  runtime.warmupTimer = 0;
  runtime.uiTimer = 0;
}

function emptyTape(source) {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = "Нет данных";
  els.streams[source].tape.replaceChildren(empty);
}

function clearMatchTimers() {
  for (const timer of runtime.matchTimers.values()) clearTimeout(timer);
  runtime.matchTimers.clear();
}

function clearMatchingData() {
  clearMatchTimers();
  runtime.rawById.clear();
  runtime.rawIdOrder = [];
  runtime.pendingAggregates.clear();
  runtime.matches = [];
  runtime.matchedIds.clear();
}

function clearMeasurementData() {
  clearMatchingData();
  for (const source of SOURCES) {
    const previous = runtime.streams[source];
    runtime.streams[source] = {
      ...createStreamState(source),
      status: "live",
      statusText: "LIVE · ИЗМЕРЕНИЕ",
      transport: previous.transport || runtime.endpoint,
    };
    emptyTape(source);
  }
}

function resetRuntimeData() {
  clearTimers();
  runtime.probe?.stop();
  runtime.probe = null;
  runtime.phase = "idle";
  runtime.warmupStartedAt = 0;
  runtime.startedAt = 0;
  runtime.stoppedAt = 0;
  runtime.clockOffsetMs = 0;
  runtime.clockRttMs = null;
  runtime.clockSynced = false;
  runtime.endpoint = "—";
  runtime.endpointAttempts = 0;
  runtime.sharedReconnects = 0;
  runtime.socketClosedDuringMeasurement = false;
  runtime.hiddenDuringMeasurement = false;
  runtime.missingStreams = false;
  runtime.invalidReasons.clear();
  runtime.markers = [];
  clearMatchingData();
  for (const source of SOURCES) {
    runtime.streams[source] = createStreamState(source);
    emptyTape(source);
  }
  els.lastMarker.textContent = "Метка видео: —";
}

async function synchronizeClock(generation) {
  els.clockState.dataset.state = "loading";
  els.clockState.textContent = "Синхронизация часов";
  const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    if (generation !== runtime.generation || runtime.phase === "idle") return;
    const sentAt = epochNow();
    try {
      const response = await fetch(`https://${hosts[index % hosts.length]}/fapi/v1/time`, { cache: "no-store" });
      const data = await response.json();
      const receivedAt = epochNow();
      if (response.ok && Number.isFinite(Number(data?.serverTime))) {
        samples.push({ sentAt, receivedAt, serverTime: Number(data.serverTime) });
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 70));
  }
  if (generation !== runtime.generation || runtime.phase === "idle") return;
  const estimate = estimateClockOffset(samples);
  runtime.clockOffsetMs = estimate.offsetMs;
  runtime.clockRttMs = estimate.rttMs;
  runtime.clockSynced = estimate.sampleCount > 0;
  els.clockState.dataset.state = runtime.clockSynced ? "live" : "error";
  els.clockState.textContent = runtime.clockSynced
    ? `Часы ±${formatMs(Math.abs(runtime.clockOffsetMs))} · RTT ${formatMs(runtime.clockRttMs)}`
    : "Часы Binance не синхронизированы";
  els.clockNote.textContent = runtime.clockSynced
    ? `Поправка часов ${runtime.clockOffsetMs >= 0 ? "+" : ""}${runtime.clockOffsetMs.toFixed(1)} мс, RTT ${runtime.clockRttMs?.toFixed(1) ?? "—"} мс. Сравнительный lead считается внутри одного WebSocket и не зависит от поправки часов.`
    : "Абсолютный Server → receive может быть смещён часами компьютера. Сравнительный lead остаётся корректным: оба потока идут через один WebSocket и один таймер.";
}

function pushCapped(list, value, limit = MAX_SAMPLES) {
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function recordSequence(stream, sample) {
  if (stream.seenIds.has(sample.id)) {
    stream.duplicates += 1;
    return false;
  }
  stream.seenIds.add(sample.id);
  if (stream.seenIds.size > MAX_SAMPLES * 1.2) {
    stream.seenIds = new Set(stream.samples.slice(-MAX_SAMPLES / 2).map((item) => item.id));
  }

  if (sample.source === "trade") {
    const id = sample.id;
    if (Number.isFinite(stream.lastSequenceId)) {
      if (id > stream.lastSequenceId + 1) stream.gaps += id - stream.lastSequenceId - 1;
      else if (id < stream.lastSequenceId) stream.outOfOrder += 1;
    }
    stream.lastSequenceId = Math.max(Number(stream.lastSequenceId) || id, id);
  } else {
    const first = sample.firstTradeId;
    const last = sample.lastTradeId;
    if (Number.isFinite(stream.lastCoveredTradeId)) {
      if (first > stream.lastCoveredTradeId + 1) stream.gaps += first - stream.lastCoveredTradeId - 1;
      else if (last < stream.lastCoveredTradeId) stream.outOfOrder += 1;
    }
    stream.lastCoveredTradeId = Math.max(Number(stream.lastCoveredTradeId) || last, last);
  }
  return true;
}

function onEndpoint(endpoint, attempt) {
  runtime.endpoint = endpoint;
  runtime.endpointAttempts = attempt;
  for (const source of SOURCES) {
    runtime.streams[source].transport = endpoint;
    runtime.streams[source].status = "loading";
    runtime.streams[source].statusText = `Endpoint ${attempt}`;
  }
}

function onSourceLive(source, endpoint) {
  const stream = runtime.streams[source];
  stream.transport = endpoint;
  stream.status = "live";
  stream.statusText = runtime.phase === "warming" ? "LIVE · ПРОГРЕВ" : "LIVE";
}

function onInvalidEvent(source) {
  runtime.streams[source].invalidEvents += 1;
  if (["warming", "measuring"].includes(runtime.phase)) {
    invalidateRun(`Некорректное событие ${source}: цена, объём, ID или символ не прошли проверку`);
  }
}

function onBothStreamsReady(endpoint) {
  if (runtime.phase !== "connecting") return;
  runtime.endpoint = endpoint;
  runtime.phase = "warming";
  runtime.warmupStartedAt = epochNow();
  for (const source of SOURCES) {
    runtime.streams[source].status = "live";
    runtime.streams[source].statusText = "LIVE · ПРОГРЕВ";
  }
  runtime.warmupTimer = setTimeout(beginMeasurement, WARMUP_MS);
  updateUI();
}

function beginMeasurement() {
  if (runtime.phase !== "warming") return;
  clearMeasurementData();
  runtime.phase = "measuring";
  runtime.startedAt = epochNow();
  runtime.stoppedAt = 0;
  runtime.timer = setTimeout(finishMeasurement, runtime.durationMs);
  updateUI();
}

function onSharedSample(sample, endpoint) {
  if (runtime.phase !== "measuring") return;
  const stream = runtime.streams[sample.source];
  if (!recordSequence(stream, sample)) return;
  sample.transport = endpoint;
  sample.receiveLatencyMs = runtime.clockSynced
    ? sample.receiveAt + runtime.clockOffsetMs - sample.eventTime
    : sample.receiveAt - sample.eventTime;
  stream.totalMessages += 1;
  pushCapped(stream.samples, sample);
  pushCapped(stream.receiveLatency, sample.receiveLatencyMs, MAX_LATENCY_SAMPLES);
  stream.quote += sample.quote;
  queueForPaint(stream, sample);

  if (sample.source === "trade") {
    runtime.rawById.set(sample.id, sample);
    runtime.rawIdOrder.push(sample.id);
    while (runtime.rawIdOrder.length > MAX_RAW_IDS) {
      runtime.rawById.delete(runtime.rawIdOrder.shift());
    }
    retryMatchesForRaw(sample.id);
  } else {
    if (sample.receiveAt - runtime.startedAt < MATCH_START_GUARD_MS) return;
    runtime.pendingAggregates.set(sample.id, sample);
    tryFinalizeMatch(sample.id, false);
    const timer = setTimeout(() => tryFinalizeMatch(sample.id, true), MATCH_WAIT_MS);
    runtime.matchTimers.set(sample.id, timer);
  }
}

function retryMatchesForRaw(rawId) {
  for (const aggregate of [...runtime.pendingAggregates.values()].slice(-200)) {
    if (rawId >= aggregate.firstTradeId && rawId <= aggregate.lastTradeId) {
      tryFinalizeMatch(aggregate.id, false);
    }
  }
}

function tryFinalizeMatch(aggregateId, force) {
  if (runtime.matchedIds.has(aggregateId)) return;
  const aggregate = runtime.pendingAggregates.get(aggregateId);
  if (!aggregate) return;
  const match = matchAggregateToRaw(aggregate, runtime.rawById);
  if (!match) return;
  const fullyReady = match.coverage >= 1 && match.renderCoverage >= 1 && Number.isFinite(aggregate.renderAt);
  if (!force && !fullyReady) return;

  runtime.matchedIds.add(aggregateId);
  runtime.pendingAggregates.delete(aggregateId);
  clearTimeout(runtime.matchTimers.get(aggregateId));
  runtime.matchTimers.delete(aggregateId);
  const row = {
    ...match,
    aggregateId,
    firstTradeId: aggregate.firstTradeId,
    lastTradeId: aggregate.lastTradeId,
    aggregateQuantity: aggregate.quantity,
    aggregateReceiveAt: aggregate.receiveAt,
    aggregateRenderAt: aggregate.renderAt,
    aggregateEventTime: aggregate.eventTime,
    time: aggregate.tradeTime,
    symbol: runtime.symbol,
    endpoint: runtime.endpoint,
  };
  runtime.matches.push(row);
  if (runtime.matches.length > MAX_MATCHES) runtime.matches.splice(0, runtime.matches.length - MAX_MATCHES);
}

function queueForPaint(stream, sample) {
  stream.paintQueue.push(sample);
  if (stream.paintQueue.length > MAX_PAINT_QUEUE) {
    const overflow = stream.paintQueue.length - MAX_PAINT_QUEUE;
    stream.paintQueue.splice(0, overflow);
    stream.paintDrops += overflow;
    invalidateRun("Очередь отрисовки переполнена");
    return;
  }
  if (stream.paintScheduled) return;
  stream.paintScheduled = true;
  requestAnimationFrame(() => flushPaint(stream));
}

function createTapeRow(sample) {
  const row = document.createElement("div");
  row.className = `tape-row ${sample.side}`;
  const time = document.createElement("span");
  time.textContent = formatTime(sample.tradeTime);
  const price = document.createElement("strong");
  price.textContent = formatPrice(sample.price);
  const quote = document.createElement("span");
  quote.textContent = `$${formatCompact(sample.quote)}`;
  const id = document.createElement("em");
  id.textContent = sample.source === "trade" ? `t ${sample.id}` : `a ${sample.id}`;
  row.append(time, price, quote, id);
  return row;
}

function flushPaint(stream) {
  stream.paintScheduled = false;
  const batch = stream.paintQueue.splice(0, PAINT_BATCH);
  if (!batch.length || runtime.phase !== "measuring") return;
  const target = els.streams[stream.source].tape;
  target.querySelector(".empty")?.remove();
  const fragment = document.createDocumentFragment();
  for (const sample of [...batch].reverse()) fragment.append(createTapeRow(sample));
  target.prepend(fragment);
  while (target.children.length > 80) target.lastElementChild?.remove();

  requestAnimationFrame((timestamp) => {
    if (runtime.phase !== "measuring") return;
    const renderAt = performance.timeOrigin + timestamp;
    for (const sample of batch) {
      sample.renderAt = renderAt;
      sample.paintLatencyMs = renderAt - sample.receiveAt;
      sample.visualLatencyMs = runtime.clockSynced
        ? renderAt + runtime.clockOffsetMs - sample.eventTime
        : renderAt - sample.eventTime;
      pushCapped(stream.paintLatency, sample.paintLatencyMs, MAX_LATENCY_SAMPLES);
      pushCapped(stream.visualLatency, sample.visualLatencyMs, MAX_LATENCY_SAMPLES);
      if (sample.source === "aggTrade") tryFinalizeMatch(sample.id, false);
      else retryMatchesForRaw(sample.id);
    }
  });

  if (stream.paintQueue.length) {
    stream.paintScheduled = true;
    requestAnimationFrame(() => flushPaint(stream));
  }
}

function startTest() {
  const symbol = String(els.symbol.value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    els.symbol.focus();
    els.symbol.setCustomValidity("Введи тикер без слеша, например BTCUSDT");
    els.symbol.reportValidity();
    return;
  }
  els.symbol.setCustomValidity("");
  resetRuntimeData();
  runtime.generation += 1;
  runtime.phase = "connecting";
  runtime.symbol = symbol;
  runtime.durationMs = Math.max(30_000, Number(els.duration.value) * 1_000 || 180_000);
  const generation = runtime.generation;

  els.start.disabled = true;
  els.stop.disabled = false;
  els.export.disabled = true;
  els.symbol.disabled = true;
  els.duration.disabled = true;

  runtime.probe = new SharedStreamProbe(symbol, generation, {
    onEndpoint,
    onConnecting: (endpoint, text) => {
      for (const source of SOURCES) {
        runtime.streams[source].transport = endpoint;
        runtime.streams[source].status = "loading";
        runtime.streams[source].statusText = text;
      }
    },
    onSourceLive,
    onSample: onSharedSample,
    onInvalid: onInvalidEvent,
    onReady: onBothStreamsReady,
    onDisconnect: () => {
      runtime.sharedReconnects += 1;
      runtime.socketClosedDuringMeasurement = ["warming", "measuring"].includes(runtime.phase);
      invalidateRun("Единый WebSocket закрылся после выхода обоих потоков в LIVE");
    },
    onUnavailable: () => {
      runtime.missingStreams = true;
      invalidateRun("Не найден endpoint, одновременно отдающий @trade и @aggTrade");
    },
  });
  runtime.probe.start();
  synchronizeClock(generation).catch(() => {});
  runtime.uiTimer = setInterval(updateUI, 250);
  updateUI();

  const url = new URL(location.href);
  url.searchParams.set("symbol", symbol);
  history.replaceState(null, "", url);
}

function finishMeasurement() {
  if (runtime.phase !== "measuring") return;
  runtime.stoppedAt = epochNow();
  clearTimeout(runtime.timer);
  runtime.timer = 0;
  runtime.probe?.stop();
  runtime.probe = null;

  // Даём двум requestAnimationFrame завершить фактическую отрисовку,
  // затем принудительно фиксируем оставшиеся сопоставления.
  runtime.timer = setTimeout(() => {
    if (runtime.phase !== "measuring") return;
    for (const aggregateId of [...runtime.pendingAggregates.keys()]) tryFinalizeMatch(aggregateId, true);
    clearMatchTimers();
    runtime.phase = "finished";
    clearTimers();
    unlockControls();
    updateUI();
  }, 120);
}

function invalidateRun(reason) {
  if (["idle", "finished", "invalid"].includes(runtime.phase)) return;
  if (reason) runtime.invalidReasons.add(reason);
  runtime.stoppedAt = epochNow();
  runtime.phase = "invalid";
  clearTimers();
  clearMatchTimers();
  runtime.probe?.stop();
  runtime.probe = null;
  for (const source of SOURCES) {
    runtime.streams[source].status = "error";
    runtime.streams[source].statusText = "ТЕСТ НЕВАЛИДЕН";
  }
  unlockControls();
  updateUI();
}

function stopTest() {
  if (runtime.phase === "idle") return;
  if (["connecting", "warming", "measuring"].includes(runtime.phase)) {
    invalidateRun("Тест остановлен вручную до завершения");
    return;
  }
  resetRuntimeData();
  unlockControls();
  updateUI();
}

function unlockControls() {
  els.start.disabled = false;
  els.stop.disabled = true;
  els.symbol.disabled = false;
  els.duration.disabled = false;
  els.export.disabled = !["finished", "invalid"].includes(runtime.phase) && runtime.markers.length === 0;
}

function addVideoMarker() {
  const now = epochNow();
  const marker = {
    time: now,
    elapsedMs: runtime.startedAt ? Math.max(0, now - runtime.startedAt) : 0,
    symbol: runtime.symbol,
    phase: runtime.phase,
  };
  runtime.markers.push(marker);
  els.lastMarker.textContent = `Метка видео: ${formatTime(marker.time)} · #${runtime.markers.length}`;
  els.markerFlash.classList.remove("active");
  void els.markerFlash.offsetWidth;
  els.markerFlash.classList.add("active");
  els.export.disabled = false;
}

function currentValidity() {
  const invalidEvents = SOURCES.reduce((sum, source) => sum + runtime.streams[source].invalidEvents, 0);
  const paintDrops = SOURCES.reduce((sum, source) => sum + runtime.streams[source].paintDrops, 0);
  const base = buildRunValidity({
    phase: runtime.phase,
    reconnects: runtime.sharedReconnects,
    invalidEvents,
    paintDrops,
    hiddenDuringMeasurement: runtime.hiddenDuringMeasurement,
    socketClosedDuringMeasurement: runtime.socketClosedDuringMeasurement,
    missingStreams: runtime.missingStreams,
  });
  const reasons = [...new Set([...base.reasons, ...runtime.invalidReasons])];
  return {
    valid: base.valid === null ? null : reasons.length === 0,
    title: base.valid === null ? base.title : (reasons.length ? "Тест невалиден" : "Тест валиден"),
    reasons,
  };
}

function updateValidityUI() {
  const validity = currentValidity();
  let state = "loading";
  let text = "Ожидание";
  if (runtime.phase === "idle") { state = "idle"; text = "Готов"; }
  if (runtime.phase === "connecting") text = `Подключение · endpoint ${runtime.endpointAttempts || 1}`;
  if (runtime.phase === "warming") text = `Прогрев · ${Math.max(0, Math.ceil((WARMUP_MS - (epochNow() - runtime.warmupStartedAt)) / 1_000))}с`;
  if (runtime.phase === "measuring") { state = "live"; text = "Измерение · 1 WebSocket"; }
  if (runtime.phase === "finished") { state = validity.valid ? "live" : "error"; text = validity.title; }
  if (runtime.phase === "invalid") { state = "error"; text = "Тест невалиден"; }
  els.validityState.dataset.state = state;
  els.validityState.textContent = text;
}

function updateUI() {
  const now = epochNow();
  const end = runtime.stoppedAt || now;
  const elapsed = runtime.startedAt ? Math.max(0, end - runtime.startedAt) : 0;
  const progress = runtime.phase === "measuring" && runtime.durationMs ? Math.min(1, elapsed / runtime.durationMs) : (runtime.phase === "finished" ? 1 : 0);
  els.progress.style.width = `${progress * 100}%`;
  if (runtime.phase === "warming") {
    const remaining = Math.max(0, WARMUP_MS - (now - runtime.warmupStartedAt));
    els.runTime.textContent = `Прогрев ${Math.ceil(remaining / 1_000)}с · затем ${formatDuration(runtime.durationMs)}`;
  } else {
    els.runTime.textContent = `${formatDuration(elapsed)} / ${formatDuration(runtime.durationMs)}`;
  }

  updateValidityUI();
  for (const source of SOURCES) updateStreamUI(source, elapsed);
  updateComparisonUI();
  updateMatchTable();
  els.export.disabled = !["finished", "invalid"].includes(runtime.phase) && runtime.markers.length === 0;
}

function updateStreamUI(source, elapsed) {
  const stream = runtime.streams[source];
  const target = els.streams[source];
  const receive = summarize(stream.receiveLatency);
  const paint = summarize(stream.paintLatency);
  const visual = summarize(stream.visualLatency);
  target.status.textContent = stream.statusText;
  target.status.className = stream.status === "live" ? "positive" : (stream.status === "error" ? "negative" : "");
  target.reconnects.textContent = `${runtime.sharedReconnects} reconnect · ${stream.outOfOrder} out-of-order`;
  target.transport.textContent = stream.transport;
  target.transport.title = stream.transport;
  target.count.textContent = stream.totalMessages.toLocaleString("ru-RU");
  target.rate.textContent = `${elapsed > 0 ? (stream.totalMessages / (elapsed / 1_000)).toFixed(1) : "0.0"} /с`;
  target.receiveP50.textContent = metricMs(receive.p50);
  target.receiveP95.textContent = `P95 ${metricMs(receive.p95)}`;
  target.paintP50.textContent = metricMs(paint.p50);
  target.paintP95.textContent = `P95 ${metricMs(paint.p95)}`;
  target.visualP50.textContent = metricMs(visual.p50);
  target.visualP95.textContent = `P95 ${metricMs(visual.p95)}`;
  target.volume.textContent = `$${formatCompact(stream.quote)}`;
  target.gaps.textContent = stream.gaps.toLocaleString("ru-RU");
  target.duplicates.textContent = `${stream.duplicates} дублей · ${stream.invalidEvents} отбраковано`;
  target.queue.textContent = stream.paintQueue.length.toLocaleString("ru-RU");
  target.drops.textContent = `${stream.paintDrops} отброшено`;
}

function comparisonStats() {
  const complete = runtime.matches.filter((match) => match.coverage >= .999 && match.renderCoverage >= .999);
  const firstReceive = complete.map((match) => match.rawFirstLeadMs).filter(Number.isFinite);
  const completeReceive = complete.map((match) => match.rawCompleteLeadMs).filter(Number.isFinite);
  const firstPaint = complete.map((match) => match.rawFirstPaintLeadMs).filter(Number.isFinite);
  const coverage = runtime.matches.map((match) => match.coverage).filter(Number.isFinite);
  const volumeDiff = complete.map((match) => match.volumeDifferencePercent).filter(Number.isFinite);
  const rawEarlierRatio = firstReceive.length
    ? firstReceive.filter((value) => value > 0).length / firstReceive.length
    : null;
  return {
    complete,
    firstReceive: summarize(firstReceive),
    completeReceive: summarize(completeReceive),
    firstPaint: summarize(firstPaint),
    rawEarlierRatio,
    medianCoverage: percentile(coverage, .5),
    medianVolumeDiff: percentile(volumeDiff, .5),
  };
}

function updateComparisonUI() {
  const stats = comparisonStats();
  const validity = currentValidity();
  const verdict = buildVerdict({
    runValid: validity.valid,
    invalidReasons: validity.reasons,
    matchedComplete: stats.complete.length,
    rawEarlierRatio: stats.rawEarlierRatio,
    medianLeadMs: stats.firstReceive.p50,
    medianCompleteLeadMs: stats.completeReceive.p50,
    medianPaintLeadMs: stats.firstPaint.p50,
    medianCoverage: stats.medianCoverage,
    medianVolumeDifferencePercent: stats.medianVolumeDiff,
    rawGapCount: runtime.streams.trade.gaps,
  });

  els.verdict.dataset.tone = verdict.tone;
  els.verdict.querySelector("strong").textContent = verdict.title;
  els.verdict.querySelector("p").textContent = verdict.text;
  els.matchedCount.textContent = runtime.matches.length.toLocaleString("ru-RU");
  els.matchedComplete.textContent = `${stats.complete.length.toLocaleString("ru-RU")} полных`;
  els.rawEarlier.textContent = stats.rawEarlierRatio === null ? "—" : `${(stats.rawEarlierRatio * 100).toFixed(1)}%`;
  els.leadP50.textContent = signedMs(stats.firstReceive.p50);
  els.leadP95.textContent = `P95 ${signedMs(stats.firstReceive.p95)}`;
  els.completeLeadP50.textContent = signedMs(stats.completeReceive.p50);
  els.completeLeadP95.textContent = `P95 ${signedMs(stats.completeReceive.p95)}`;
  els.paintLeadP50.textContent = signedMs(stats.firstPaint.p50);
  els.paintLeadP95.textContent = `P95 ${signedMs(stats.firstPaint.p95)}`;
  els.coverageP50.textContent = stats.medianCoverage === null ? "—" : `${(stats.medianCoverage * 100).toFixed(2)}%`;
  els.volumeDiffP50.textContent = stats.medianVolumeDiff === null ? "—" : `${stats.medianVolumeDiff.toFixed(4)}%`;
  els.matchedStatus.textContent = `${runtime.endpoint} · pending ${runtime.pendingAggregates.size}`;
}

function updateMatchTable() {
  if (!runtime.matches.length) {
    els.matchBody.innerHTML = '<tr><td colspan="8" class="empty">Совпадения появятся после начала измерения</td></tr>';
    return;
  }
  els.matchBody.innerHTML = runtime.matches.slice(-40).reverse().map((match) => {
    const leadClass = Number(match.rawFirstLeadMs) > 0 ? "positive" : "negative";
    const paintClass = Number(match.rawFirstPaintLeadMs) > 0 ? "positive" : "negative";
    return `<tr><td>${formatTime(match.time)}</td><td>${match.aggregateId}</td><td>${match.availableCount}/${match.expectedCount}</td><td>${(match.coverage * 100).toFixed(1)}%</td><td class="${leadClass}">${signedMs(match.rawFirstLeadMs)}</td><td>${signedMs(match.rawCompleteLeadMs)}</td><td class="${paintClass}">${signedMs(match.rawFirstPaintLeadMs)}</td><td>${Number.isFinite(match.volumeDifferencePercent) ? `${match.volumeDifferencePercent.toFixed(4)}%` : "—"}</td></tr>`;
  }).join("");
}

function exportCsv() {
  const validity = currentValidity();
  const stats = comparisonStats();
  const invalidEvents = SOURCES.reduce((sum, source) => sum + runtime.streams[source].invalidEvents, 0);
  const paintDrops = SOURCES.reduce((sum, source) => sum + runtime.streams[source].paintDrops, 0);
  const rows = [[
    "record_type", "symbol", "timestamp_iso", "elapsed_ms", "run_phase", "run_valid", "invalid_reasons",
    "endpoint", "warmup_ms", "shared_reconnects", "invalid_events", "paint_drops", "agg_id", "first_trade_id",
    "last_trade_id", "expected_raw", "available_raw", "rendered_raw", "coverage_pct", "render_coverage_pct",
    "raw_first_receive_lead_ms", "raw_complete_receive_lead_ms", "raw_first_paint_lead_ms", "raw_complete_paint_lead_ms",
    "agg_quantity", "raw_quantity", "volume_difference_pct",
  ]];
  rows.push([
    "run", runtime.symbol, new Date(runtime.stoppedAt || epochNow()).toISOString(), runtime.startedAt ? Math.max(0, (runtime.stoppedAt || epochNow()) - runtime.startedAt).toFixed(3) : "0",
    runtime.phase, validity.valid === null ? "" : String(validity.valid), validity.reasons.join("; "), runtime.endpoint, WARMUP_MS,
    runtime.sharedReconnects, invalidEvents, paintDrops, "", "", "", "", stats.complete.length, "", "", "", "", "", "", "", "", "", "",
  ]);
  for (const match of runtime.matches) {
    rows.push([
      "match", match.symbol, new Date(match.time).toISOString(), Math.max(0, match.aggregateReceiveAt - runtime.startedAt).toFixed(3),
      runtime.phase, validity.valid === null ? "" : String(validity.valid), validity.reasons.join("; "), match.endpoint, WARMUP_MS,
      runtime.sharedReconnects, invalidEvents, paintDrops, match.aggregateId, match.firstTradeId, match.lastTradeId,
      match.expectedCount, match.availableCount, match.renderedCount, (match.coverage * 100).toFixed(6), (match.renderCoverage * 100).toFixed(6),
      csvNumber(match.rawFirstLeadMs), csvNumber(match.rawCompleteLeadMs), csvNumber(match.rawFirstPaintLeadMs), csvNumber(match.rawCompletePaintLeadMs),
      csvNumber(match.aggregateQuantity), csvNumber(match.rawQuantity), csvNumber(match.volumeDifferencePercent),
    ]);
  }
  for (const marker of runtime.markers) {
    rows.push(["marker", marker.symbol, new Date(marker.time).toISOString(), marker.elapsedMs.toFixed(3), marker.phase, "", "", runtime.endpoint, WARMUP_MS, runtime.sharedReconnects, invalidEvents, paintDrops, "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = `inpuls-latency-v2-${runtime.symbol}-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function csvNumber(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(6) : ""; }
function formatMs(value) { return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} мс` : "—"; }
function metricMs(value) { return formatMs(value); }
function signedMs(value) { return Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)} мс` : "—"; }
function formatDuration(ms) { const total = Math.max(0, Math.floor((Number(ms) || 0) / 1_000)); return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
const TIME_FORMATTER = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hour12: false });
function formatTime(time) { return TIME_FORMATTER.format(new Date(time)); }
function formatPrice(value) { return Number(value).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: Number(value) >= 100 ? 2 : 6 }); }
function formatCompact(value) { const number = Number(value) || 0; if (number >= 1e9) return `${(number / 1e9).toFixed(2)}B`; if (number >= 1e6) return `${(number / 1e6).toFixed(2)}M`; if (number >= 1e3) return `${(number / 1e3).toFixed(1)}K`; return number.toFixed(0); }

els.start.addEventListener("click", startTest);
els.stop.addEventListener("click", stopTest);
els.marker.addEventListener("click", addVideoMarker);
els.export.addEventListener("click", exportCsv);
els.symbol.addEventListener("input", () => {
  els.symbol.value = els.symbol.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  els.symbol.setCustomValidity("");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && ["warming", "measuring"].includes(runtime.phase)) {
    runtime.hiddenDuringMeasurement = true;
    invalidateRun("Вкладка была скрыта во время прогрева или измерения");
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "m" && !event.ctrlKey && !event.metaKey && document.activeElement !== els.symbol) addVideoMarker();
});
window.addEventListener("beforeunload", () => runtime.probe?.stop());

const initialSymbol = new URL(location.href).searchParams.get("symbol");
if (initialSymbol && /^[A-Z0-9]{5,20}$/i.test(initialSymbol)) els.symbol.value = initialSymbol.toUpperCase();
runtime.durationMs = Number(els.duration.value) * 1_000;
updateUI();
