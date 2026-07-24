import {
  buildVerdict,
  estimateClockOffset,
  matchAggregateToRaw,
  normalizeTradeEvent,
  percentile,
  summarize,
} from "./trade-latency-core.js?v=1";

const MAX_SAMPLES = 30_000;
const MAX_LATENCY_SAMPLES = 10_000;
const MAX_RAW_IDS = 100_000;
const MAX_MATCHES = 5_000;
const MAX_PAINT_QUEUE = 5_000;
const PAINT_BATCH = 120;
const MATCH_WAIT_MS = 1_500;
const FIRST_MESSAGE_TIMEOUT_MS = 4_000;

const epochNow = () => performance.timeOrigin + performance.now();
const sourceKey = (source) => source === "trade" ? "raw" : "agg";

const els = {
  symbol: document.querySelector("#symbol"),
  duration: document.querySelector("#duration"),
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  marker: document.querySelector("#marker"),
  export: document.querySelector("#export"),
  progress: document.querySelector("#progress"),
  runTime: document.querySelector("#run-time"),
  clockState: document.querySelector("#clock-state"),
  clockNote: document.querySelector("#clock-note"),
  verdict: document.querySelector("#verdict"),
  matchedStatus: document.querySelector("#matched-status"),
  matchedCount: document.querySelector("#matched-count"),
  matchedComplete: document.querySelector("#matched-complete"),
  rawEarlier: document.querySelector("#raw-earlier"),
  leadP50: document.querySelector("#lead-p50"),
  leadP95: document.querySelector("#lead-p95"),
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
    reconnects: 0,
    samples: [],
    totalMessages: 0,
    receiveLatency: [],
    paintLatency: [],
    visualLatency: [],
    quote: 0,
    gaps: 0,
    duplicates: 0,
    outOfOrder: 0,
    lastSequenceId: null,
    lastCoveredTradeId: null,
    seenIds: new Set(),
    paintQueue: [],
    paintDrops: 0,
    paintScheduled: false,
    probe: null,
  };
}

const runtime = {
  generation: 0,
  running: false,
  symbol: "BTCUSDT",
  durationMs: 60_000,
  startedAt: 0,
  stoppedAt: 0,
  clockOffsetMs: 0,
  clockRttMs: null,
  clockSynced: false,
  timer: 0,
  uiTimer: 0,
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

const TRANSPORT_FACTORIES = [
  { name: "market · raw", create: (stream) => ({ url: `wss://fstream.binance.com/market/ws/${stream}`, subscribe: false }) },
  { name: "market · combined", create: (stream) => ({ url: `wss://fstream.binance.com/market/stream?streams=${stream}`, subscribe: false }) },
  { name: "market · subscribe", create: (stream) => ({ url: "wss://fstream.binance.com/market/stream", subscribe: true }) },
  { name: "standard · raw", create: (stream) => ({ url: `wss://fstream.binance.com/ws/${stream}`, subscribe: false }) },
  { name: "standard · combined", create: (stream) => ({ url: `wss://fstream.binance.com/stream?streams=${stream}`, subscribe: false }) },
  { name: "standard · subscribe", create: (stream) => ({ url: "wss://fstream.binance.com/ws", subscribe: true }) },
  { name: "alt market · raw", create: (stream) => ({ url: `wss://stream.binancefuture.com/market/ws/${stream}`, subscribe: false }) },
  { name: "alt · raw", create: (stream) => ({ url: `wss://stream.binancefuture.com/ws/${stream}`, subscribe: false }) },
];

function parsePayload(raw) {
  let payload;
  try { payload = JSON.parse(raw); } catch { return null; }
  if (payload?.result === null || payload?.id) return null;
  return { stream: String(payload?.stream ?? "").toLowerCase(), data: payload?.data ?? payload };
}

function isExpectedTrade(payload, source) {
  const eventType = String(payload?.data?.e ?? "").toLowerCase();
  const stream = payload?.stream ?? "";
  return source === "trade"
    ? eventType === "trade" || (stream.endsWith("@trade") && !stream.endsWith("@aggtrade"))
    : eventType === "aggtrade" || stream.endsWith("@aggtrade");
}

class StreamProbe {
  constructor(source, symbol, generation, onSample, onState) {
    this.source = source;
    this.symbol = symbol;
    this.generation = generation;
    this.onSample = onSample;
    this.onState = onState;
    this.socket = null;
    this.transportIndex = 0;
    this.firstMessageTimer = 0;
    this.reconnectTimer = 0;
    this.stopped = false;
    this.receivedAny = false;
  }

  start() { this.connect(); }

  stop() {
    this.stopped = true;
    clearTimeout(this.firstMessageTimer);
    clearTimeout(this.reconnectTimer);
    try { this.socket?.close(); } catch {}
    this.socket = null;
  }

  connect() {
    if (this.stopped || this.generation !== runtime.generation || !runtime.running) return;
    clearTimeout(this.firstMessageTimer);
    const stream = `${this.symbol.toLowerCase()}@${this.source}`;
    const factory = TRANSPORT_FACTORIES[this.transportIndex % TRANSPORT_FACTORIES.length];
    const transport = factory.create(stream);
    this.onState({ state: "loading", text: "Подключение", transport: factory.name });

    let socket;
    try { socket = new WebSocket(transport.url); }
    catch {
      this.advanceTransport();
      return;
    }
    this.socket = socket;
    let receivedOnSocket = false;

    this.firstMessageTimer = setTimeout(() => {
      if (!receivedOnSocket && socket === this.socket) {
        try { socket.close(); } catch {}
      }
    }, FIRST_MESSAGE_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (this.stopped || socket !== this.socket) return;
      if (transport.subscribe) {
        socket.send(JSON.stringify({ method: "SUBSCRIBE", params: [stream], id: Date.now() % 2_147_483_647 }));
      }
      this.onState({ state: "loading", text: "Жду первую сделку", transport: factory.name });
    });

    socket.addEventListener("message", (message) => {
      if (this.stopped || socket !== this.socket) return;
      const payload = parsePayload(message.data);
      if (!payload || !isExpectedTrade(payload, this.source)) return;
      const receiveAt = epochNow();
      const sample = normalizeTradeEvent(payload.data, this.source, receiveAt);
      if (!sample) return;
      receivedOnSocket = true;
      this.receivedAny = true;
      clearTimeout(this.firstMessageTimer);
      this.firstMessageTimer = 0;
      this.onState({ state: "live", text: "LIVE", transport: factory.name });
      this.onSample(sample, factory.name);
    });

    socket.addEventListener("close", () => {
      if (this.stopped || socket !== this.socket) return;
      clearTimeout(this.firstMessageTimer);
      this.firstMessageTimer = 0;
      this.socket = null;
      if (!receivedOnSocket) {
        this.transportIndex += 1;
        if (this.transportIndex >= TRANSPORT_FACTORIES.length) {
          this.onState({ state: "error", text: "Нет данных", transport: "Все endpoints проверены" });
          return;
        }
      }
      this.onState({ state: "loading", text: "Переподключение", transport: factory.name, reconnect: true });
      this.reconnectTimer = setTimeout(() => this.connect(), receivedOnSocket ? 500 : 250);
    });

    socket.addEventListener("error", () => {
      if (socket === this.socket) {
        try { socket.close(); } catch {}
      }
    });
  }

  advanceTransport() {
    this.transportIndex += 1;
    if (this.transportIndex >= TRANSPORT_FACTORIES.length) {
      this.onState({ state: "error", text: "Нет данных", transport: "Все endpoints проверены" });
      return;
    }
    this.reconnectTimer = setTimeout(() => this.connect(), 250);
  }
}

function resetRuntimeData() {
  for (const source of ["aggTrade", "trade"]) {
    runtime.streams[source].probe?.stop();
    runtime.streams[source] = createStreamState(source);
    const tape = els.streams[source].tape;
    tape.replaceChildren(Object.assign(document.createElement("div"), { className: "empty", textContent: "Нет данных" }));
  }
  for (const timer of runtime.matchTimers.values()) clearTimeout(timer);
  runtime.rawById.clear();
  runtime.rawIdOrder = [];
  runtime.pendingAggregates.clear();
  runtime.matchTimers.clear();
  runtime.matches = [];
  runtime.matchedIds.clear();
  runtime.markers = [];
  runtime.clockOffsetMs = 0;
  runtime.clockRttMs = null;
  runtime.clockSynced = false;
  els.lastMarker.textContent = "Метка видео: —";
}

async function synchronizeClock(generation) {
  els.clockState.dataset.state = "loading";
  els.clockState.textContent = "Синхронизация часов";
  const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    if (generation !== runtime.generation || !runtime.running) return;
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
  if (generation !== runtime.generation || !runtime.running) return;
  const estimate = estimateClockOffset(samples);
  runtime.clockOffsetMs = estimate.offsetMs;
  runtime.clockRttMs = estimate.rttMs;
  runtime.clockSynced = estimate.sampleCount > 0;
  els.clockState.dataset.state = runtime.clockSynced ? "live" : "error";
  els.clockState.textContent = runtime.clockSynced
    ? `Часы ±${formatMs(Math.abs(runtime.clockOffsetMs))} · RTT ${formatMs(runtime.clockRttMs)}`
    : "Часы Binance не синхронизированы";
  els.clockNote.textContent = runtime.clockSynced
    ? `Поправка часов ${runtime.clockOffsetMs >= 0 ? "+" : ""}${runtime.clockOffsetMs.toFixed(1)} мс, RTT ${runtime.clockRttMs?.toFixed(1) ?? "—"} мс. Lead между потоками считается напрямую по времени получения.`
    : "Абсолютный Server → receive может быть смещён часами компьютера. Lead @trade против @aggTrade остаётся корректным, потому что оба потока измеряются одним таймером.";
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
    if (Number.isFinite(last)) stream.lastCoveredTradeId = Math.max(Number(stream.lastCoveredTradeId) || last, last);
  }
  return true;
}

function onProbeState(source, update) {
  const stream = runtime.streams[source];
  stream.status = update.state;
  stream.statusText = update.text;
  if (update.transport) stream.transport = update.transport;
  if (update.reconnect) stream.reconnects += 1;
}

function onProbeSample(sample, transport) {
  if (!runtime.running) return;
  const stream = runtime.streams[sample.source];
  if (!recordSequence(stream, sample)) return;
  sample.transport = transport;
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
    for (const aggregate of [...runtime.pendingAggregates.values()].slice(-120)) {
      if (sample.id >= aggregate.firstTradeId && sample.id <= aggregate.lastTradeId) tryFinalizeMatch(aggregate.id, false);
    }
  } else {
    runtime.pendingAggregates.set(sample.id, sample);
    tryFinalizeMatch(sample.id, false);
    const timer = setTimeout(() => tryFinalizeMatch(sample.id, true), MATCH_WAIT_MS);
    runtime.matchTimers.set(sample.id, timer);
  }
}

function tryFinalizeMatch(aggregateId, force) {
  if (runtime.matchedIds.has(aggregateId)) return;
  const aggregate = runtime.pendingAggregates.get(aggregateId);
  if (!aggregate) return;
  const match = matchAggregateToRaw(aggregate, runtime.rawById);
  if (!match) return;
  if (!force && match.coverage < 1) return;

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
    aggregateEventTime: aggregate.eventTime,
    time: aggregate.tradeTime,
    symbol: runtime.symbol,
    aggregateTransport: aggregate.transport,
    rawTransport: runtime.streams.trade.transport,
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
  }
  if (stream.paintScheduled) return;
  stream.paintScheduled = true;
  requestAnimationFrame(() => flushPaint(stream));
}

function flushPaint(stream) {
  stream.paintScheduled = false;
  const batch = stream.paintQueue.splice(0, PAINT_BATCH);
  if (!batch.length) return;
  const target = els.streams[stream.source].tape;
  target.querySelector(".empty")?.remove();
  const fragment = document.createDocumentFragment();
  for (const sample of [...batch].reverse()) {
    const row = document.createElement("div");
    row.className = `tape-row ${sample.side}`;
    row.innerHTML = `<span>${formatTime(sample.tradeTime)}</span><strong>${formatPrice(sample.price)}</strong><span>$${formatCompact(sample.quote)}</span><em>${sample.source === "trade" ? `t ${sample.id}` : `a ${sample.id}`}</em>`;
    fragment.append(row);
  }
  target.prepend(fragment);
  while (target.children.length > 80) target.lastElementChild?.remove();

  requestAnimationFrame((timestamp) => {
    const renderAt = performance.timeOrigin + timestamp;
    for (const sample of batch) {
      sample.renderAt = renderAt;
      sample.paintLatencyMs = renderAt - sample.receiveAt;
      sample.visualLatencyMs = runtime.clockSynced
        ? renderAt + runtime.clockOffsetMs - sample.eventTime
        : renderAt - sample.eventTime;
      pushCapped(stream.paintLatency, sample.paintLatencyMs, MAX_LATENCY_SAMPLES);
      pushCapped(stream.visualLatency, sample.visualLatencyMs, MAX_LATENCY_SAMPLES);
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
  stopTest(false);
  resetRuntimeData();
  runtime.generation += 1;
  runtime.running = true;
  runtime.symbol = symbol;
  runtime.durationMs = Math.max(10_000, Number(els.duration.value) * 1_000 || 60_000);
  runtime.startedAt = epochNow();
  runtime.stoppedAt = 0;
  const generation = runtime.generation;

  els.start.disabled = true;
  els.stop.disabled = false;
  els.export.disabled = true;
  els.symbol.disabled = true;
  els.duration.disabled = true;

  synchronizeClock(generation).catch(() => {});
  for (const source of ["aggTrade", "trade"]) {
    const probe = new StreamProbe(
      source,
      symbol,
      generation,
      (sample, transport) => onProbeSample(sample, transport),
      (update) => onProbeState(source, update),
    );
    runtime.streams[source].probe = probe;
    probe.start();
  }
  runtime.timer = setTimeout(() => stopTest(true), runtime.durationMs);
  runtime.uiTimer = setInterval(updateUI, 500);
  updateUI();
  const url = new URL(location.href);
  url.searchParams.set("symbol", symbol);
  history.replaceState(null, "", url);
}

function stopTest(update = true) {
  clearTimeout(runtime.timer);
  clearInterval(runtime.uiTimer);
  runtime.timer = 0;
  runtime.uiTimer = 0;
  if (runtime.running) runtime.stoppedAt = epochNow();
  runtime.running = false;
  for (const stream of Object.values(runtime.streams)) stream.probe?.stop();
  els.start.disabled = false;
  els.stop.disabled = true;
  els.symbol.disabled = false;
  els.duration.disabled = false;
  els.export.disabled = runtime.matches.length === 0 && runtime.markers.length === 0;
  if (update) updateUI();
}

function addVideoMarker() {
  const marker = { time: epochNow(), elapsedMs: runtime.startedAt ? epochNow() - runtime.startedAt : 0, symbol: runtime.symbol };
  runtime.markers.push(marker);
  els.lastMarker.textContent = `Метка видео: ${formatTime(marker.time)} · #${runtime.markers.length}`;
  els.markerFlash.classList.remove("active");
  void els.markerFlash.offsetWidth;
  els.markerFlash.classList.add("active");
  els.export.disabled = false;
}

function updateUI() {
  const end = runtime.running ? epochNow() : (runtime.stoppedAt || epochNow());
  const elapsed = runtime.startedAt ? Math.max(0, end - runtime.startedAt) : 0;
  const progress = runtime.durationMs ? Math.min(1, elapsed / runtime.durationMs) : 0;
  els.progress.style.width = `${progress * 100}%`;
  els.runTime.textContent = `${formatDuration(elapsed)} / ${formatDuration(runtime.durationMs)}`;

  for (const source of ["aggTrade", "trade"]) updateStreamUI(source, elapsed);
  updateComparisonUI();
  updateMatchTable();
  els.export.disabled = runtime.matches.length === 0 && runtime.markers.length === 0;
}

function updateStreamUI(source, elapsed) {
  const stream = runtime.streams[source];
  const target = els.streams[source];
  const receive = summarize(stream.receiveLatency);
  const paint = summarize(stream.paintLatency);
  const visual = summarize(stream.visualLatency);
  target.status.textContent = stream.statusText;
  target.status.className = stream.status === "live" ? "positive" : (stream.status === "error" ? "negative" : "");
  target.reconnects.textContent = `${stream.reconnects} reconnect · ${stream.outOfOrder} out-of-order`;
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
  target.duplicates.textContent = `${stream.duplicates} дублей`;
  target.queue.textContent = stream.paintQueue.length.toLocaleString("ru-RU");
  target.drops.textContent = `${stream.paintDrops} отброшено`;
}

function updateComparisonUI() {
  const validLead = runtime.matches.filter((match) => Number.isFinite(match.rawFirstLeadMs));
  const complete = runtime.matches.filter((match) => match.coverage >= .999);
  const leadValues = validLead.map((match) => match.rawFirstLeadMs);
  const coverageValues = runtime.matches.map((match) => match.coverage);
  const volumeDiffValues = runtime.matches.map((match) => match.volumeDifferencePercent).filter(Number.isFinite);
  const lead = summarize(leadValues);
  const rawEarlierRatio = validLead.length
    ? validLead.filter((match) => match.rawFirstLeadMs > 0).length / validLead.length
    : null;
  const medianCoverage = percentile(coverageValues, .5);
  const medianVolumeDiff = percentile(volumeDiffValues, .5);
  const verdict = buildVerdict({
    matched: runtime.matches.length,
    rawEarlierRatio,
    medianLeadMs: lead.p50,
    medianCoverage,
    medianVolumeDifferencePercent: medianVolumeDiff,
    rawGapCount: runtime.streams.trade.gaps,
  });

  els.verdict.dataset.tone = verdict.tone;
  els.verdict.querySelector("strong").textContent = verdict.title;
  els.verdict.querySelector("p").textContent = verdict.text;
  els.matchedCount.textContent = runtime.matches.length.toLocaleString("ru-RU");
  els.matchedComplete.textContent = `${complete.length.toLocaleString("ru-RU")} полных`;
  els.rawEarlier.textContent = rawEarlierRatio === null ? "—" : `${(rawEarlierRatio * 100).toFixed(1)}%`;
  els.leadP50.textContent = signedMs(lead.p50);
  els.leadP95.textContent = `P95 ${signedMs(lead.p95)}`;
  els.coverageP50.textContent = medianCoverage === null ? "—" : `${(medianCoverage * 100).toFixed(2)}%`;
  els.volumeDiffP50.textContent = medianVolumeDiff === null ? "—" : `${medianVolumeDiff.toFixed(4)}%`;
  els.matchedStatus.textContent = runtime.streams.trade.status === "error"
    ? "@trade не дал данных на проверенных endpoints"
    : `raw t ∈ [agg f; agg l] · pending ${runtime.pendingAggregates.size}`;
}

function updateMatchTable() {
  if (!runtime.matches.length) {
    els.matchBody.innerHTML = '<tr><td colspan="7" class="empty">Совпадения появятся после получения обоих потоков</td></tr>';
    return;
  }
  els.matchBody.innerHTML = runtime.matches.slice(-40).reverse().map((match) => {
    const leadClass = Number(match.rawFirstLeadMs) > 0 ? "positive" : "negative";
    return `<tr><td>${formatTime(match.time)}</td><td>${match.aggregateId}</td><td>${match.availableCount}/${match.expectedCount}</td><td>${(match.coverage * 100).toFixed(1)}%</td><td class="${leadClass}">${signedMs(match.rawFirstLeadMs)}</td><td>${signedMs(match.rawCompleteLeadMs)}</td><td>${Number.isFinite(match.volumeDifferencePercent) ? `${match.volumeDifferencePercent.toFixed(4)}%` : "—"}</td></tr>`;
  }).join("");
}

function exportCsv() {
  const rows = [[
    "record_type", "symbol", "timestamp_iso", "elapsed_ms", "agg_id", "first_trade_id", "last_trade_id",
    "expected_raw", "available_raw", "coverage_pct", "raw_first_lead_ms", "raw_complete_lead_ms",
    "agg_quantity", "raw_quantity", "volume_difference_pct", "agg_transport", "raw_transport",
  ]];
  for (const match of runtime.matches) {
    rows.push([
      "match", match.symbol, new Date(match.time).toISOString(), Math.max(0, match.aggregateReceiveAt - runtime.startedAt).toFixed(3),
      match.aggregateId, match.firstTradeId, match.lastTradeId, match.expectedCount, match.availableCount,
      (match.coverage * 100).toFixed(6), csvNumber(match.rawFirstLeadMs), csvNumber(match.rawCompleteLeadMs),
      csvNumber(match.aggregateQuantity), csvNumber(match.rawQuantity), csvNumber(match.volumeDifferencePercent),
      match.aggregateTransport, match.rawTransport,
    ]);
  }
  for (const marker of runtime.markers) {
    rows.push(["marker", marker.symbol, new Date(marker.time).toISOString(), marker.elapsedMs.toFixed(3), "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `inpuls-latency-${runtime.symbol}-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
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
els.stop.addEventListener("click", () => stopTest(true));
els.marker.addEventListener("click", addVideoMarker);
els.export.addEventListener("click", exportCsv);
els.symbol.addEventListener("input", () => { els.symbol.value = els.symbol.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); els.symbol.setCustomValidity(""); });
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "m" && !event.ctrlKey && !event.metaKey && document.activeElement !== els.symbol) addVideoMarker();
});
window.addEventListener("beforeunload", () => stopTest(false));

const initialSymbol = new URL(location.href).searchParams.get("symbol");
if (initialSymbol && /^[A-Z0-9]{5,20}$/i.test(initialSymbol)) els.symbol.value = initialSymbol.toUpperCase();
runtime.durationMs = Number(els.duration.value) * 1_000;
updateUI();
