import { readFile, writeFile } from "node:fs/promises";

const lines = (...items) => items.join("\n");

async function patchFile(path, transforms) {
  let source = await readFile(path, "utf8");
  for (const [label, before, after] of transforms) {
    const count = source.split(before).length - 1;
    if (count !== 1) throw new Error(`${path}: expected one ${label} match, found ${count}`);
    source = source.replace(before, after);
  }
  await writeFile(path, source);
}

const BUILD_OLD = "26-81-signal-lab-collector-status-v1";
const BUILD_NEW = "26-82-signal-lab-event-driven-collector-v1";

await patchFile("app.js", [
  [
    "market ticker batch flag",
    lines("    if (Array.isArray(data)) {", "      for (const ticker of data) {"),
    lines("    if (Array.isArray(data)) {", "      let hasMarketTicker = false;", "      for (const ticker of data) {"),
  ],
  [
    "event-driven collection call",
    lines(
      "        getSymbol(ticker.s, Number(ticker.E) || Date.now())?.updateTicker(ticker);",
      "      }",
      "      scheduleRender();",
    ),
    lines(
      "        getSymbol(ticker.s, Number(ticker.E) || Date.now())?.updateTicker(ticker);",
      "        hasMarketTicker = true;",
      "      }",
      "      if (hasMarketTicker) collectSignalMemoryFromFeed(Date.now());",
      "      scheduleRender();",
    ),
  ],
  [
    "collector health state",
    lines(
      "const signalMemory = new SignalMemoryTracker();",
      "const signalLab = new SignalLabLocalStore();",
      "signalLab.initialize().then((status) => {",
    ),
    lines(
      "const signalMemory = new SignalMemoryTracker();",
      "const signalLab = new SignalLabLocalStore();",
      "const SIGNAL_LAB_COLLECTOR_HEALTH_KEY = \"inpuls-signal-lab-collector-health-v1\";",
      "const signalLabCollectorHealth = {",
      "  schemaVersion: 1,",
      "  mode: \"websocket-event-driven\",",
      "  startedAt: Date.now(),",
      "  publishedAt: null,",
      "  lastMarketAt: null,",
      "  lastCheckAt: null,",
      "  lastPersistAt: null,",
      "  checks: 0,",
      "  signalEvents: 0,",
      "  observations: 0,",
      "  symbols: 0,",
      "  storageState: \"initializing\",",
      "  visibilityState: document.visibilityState,",
      "  lastError: null,",
      "};",
      "",
      "function publishSignalLabCollectorHealth(patch = {}) {",
      "  Object.assign(signalLabCollectorHealth, patch, {",
      "    publishedAt: Date.now(),",
      "    visibilityState: document.visibilityState,",
      "  });",
      "  try {",
      "    localStorage.setItem(",
      "      SIGNAL_LAB_COLLECTOR_HEALTH_KEY,",
      "      JSON.stringify(signalLabCollectorHealth),",
      "    );",
      "  } catch {",
      "    // The collector remains functional when localStorage is unavailable.",
      "  }",
      "}",
      "",
      "publishSignalLabCollectorHealth();",
      "document.addEventListener(\"visibilitychange\", () => {",
      "  publishSignalLabCollectorHealth();",
      "});",
      "",
      "signalLab.initialize().then((status) => {",
    ),
  ],
  [
    "storage initialize heartbeat",
    lines(
      "  if (status.recoveredObservations) {",
      "    observability.increment(",
      "      \"signal-lab.recovered-observations\",",
      "      status.recoveredObservations,",
      "    );",
      "  }",
      "}).catch(() => {",
      "  observability.increment(\"signal-lab.storage-errors\");",
      "});",
    ),
    lines(
      "  if (status.recoveredObservations) {",
      "    observability.increment(",
      "      \"signal-lab.recovered-observations\",",
      "      status.recoveredObservations,",
      "    );",
      "  }",
      "  publishSignalLabCollectorHealth({",
      "    storageState: status.state || \"available\",",
      "    lastError: null,",
      "  });",
      "}).catch((error) => {",
      "  observability.increment(\"signal-lab.storage-errors\");",
      "  publishSignalLabCollectorHealth({",
      "    storageState: \"error\",",
      "    lastError: String(error?.message || error).slice(0, 160),",
      "  });",
      "});",
    ),
  ],
  [
    "public collector health",
    lines(
      "    report: (options = {}) => signalLab.report(options),",
      "    status: () => signalLab.status(),",
    ),
    lines(
      "    report: (options = {}) => signalLab.report(options),",
      "    status: () => ({ ...signalLab.status(), collector: { ...signalLabCollectorHealth } }),",
    ),
  ],
  [
    "persist heartbeat",
    lines(
      "    signalLab.persist(created, { now }).catch(() => {",
      "      observability.increment(\"signal-lab.storage-errors\");",
      "    });",
    ),
    lines(
      "    signalLab.persist(created, { now }).then((persisted) => {",
      "      if (persisted) {",
      "        publishSignalLabCollectorHealth({",
      "          lastPersistAt: Date.now(),",
      "          storageState: \"available\",",
      "          lastError: null,",
      "        });",
      "      }",
      "    }).catch((error) => {",
      "      observability.increment(\"signal-lab.storage-errors\");",
      "      publishSignalLabCollectorHealth({",
      "        storageState: \"error\",",
      "        lastError: String(error?.message || error).slice(0, 160),",
      "      });",
      "    });",
    ),
  ],
  [
    "return created batch and collector",
    lines(
      "    if (unavailable) {",
      "      observability.increment(\"market-memory.signal-observations-unavailable\", unavailable);",
      "    }",
      "  }",
      "}",
      "",
      "async function warmupRadarHistory() {",
    ),
    lines(
      "    if (unavailable) {",
      "      observability.increment(\"market-memory.signal-observations-unavailable\", unavailable);",
      "    }",
      "  }",
      "  return created;",
      "}",
      "",
      "function collectSignalMemoryFromFeed(now = Date.now()) {",
      "  const checkedAt = Date.now();",
      "  const metrics = getMetrics(now);",
      "  const created = updateSignalMemory(metrics, now);",
      "  publishSignalLabCollectorHealth({",
      "    lastMarketAt: now,",
      "    lastCheckAt: checkedAt,",
      "    checks: signalLabCollectorHealth.checks + 1,",
      "    signalEvents: signalLabCollectorHealth.signalEvents + created.events.length,",
      "    observations: signalLabCollectorHealth.observations",
      "      + created.observations.length",
      "      + created.resolvedObservations.length,",
      "    symbols: metrics.length,",
      "  });",
      "  return created;",
      "}",
      "",
      "async function warmupRadarHistory() {",
    ),
  ],
  [
    "remove render-driven collection",
    lines("  updateSignalMemory(marketwideMetrics, now);", "  updateAlerts(metrics, now);"),
    "  updateAlerts(metrics, now);",
  ],
]);

await patchFile("owner-signal-lab-v2.js", [
  ["build version", `const BUILD = "${BUILD_OLD}";`, `const BUILD = "${BUILD_NEW}";`],
  [
    "heartbeat constants",
    "const COLLECTOR_STATUS_POLL_MS = 5_000;",
    lines(
      "const COLLECTOR_STATUS_POLL_MS = 5_000;",
      "const COLLECTOR_HEALTH_KEY = \"inpuls-signal-lab-collector-health-v1\";",
      "const COLLECTOR_HEARTBEAT_STALE_MS = 15_000;",
    ),
  ],
  [
    "initial heartbeat",
    lines("  clients: [],", "  reason: \"not-checked\","),
    lines("  clients: [],", "  heartbeat: null,", "  reason: \"not-checked\","),
  ],
  [
    "heartbeat helpers",
    lines(
      "function collectorWindow() {",
      "  return collectorStatus.clients?.find((client) => client.visibilityState === \"visible\")",
      "    ?? collectorStatus.clients?.[0]",
      "    ?? null;",
      "}",
      "",
      "function renderRuntimeStatus() {",
    ),
    lines(
      "function collectorWindow() {",
      "  return collectorStatus.clients?.find((client) => client.visibilityState === \"visible\")",
      "    ?? collectorStatus.clients?.[0]",
      "    ?? null;",
      "}",
      "",
      "function readCollectorHeartbeat() {",
      "  try {",
      "    const value = JSON.parse(localStorage.getItem(COLLECTOR_HEALTH_KEY) || \"null\");",
      "    return value && typeof value === \"object\" ? value : null;",
      "  } catch {",
      "    return null;",
      "  }",
      "}",
      "",
      "function collectorHeartbeatAge(now = Date.now()) {",
      "  const publishedAt = finite(collectorStatus.heartbeat?.publishedAt);",
      "  return publishedAt === null ? null : Math.max(0, now - publishedAt);",
      "}",
      "",
      "function formatAgeMs(value) {",
      "  const age = finite(value);",
      "  if (age === null) return \"—\";",
      "  if (age < 1_000) return \"<1с\";",
      "  if (age < 60_000) return `${Math.round(age / 1_000)}с`;",
      "  return `${Math.round(age / 60_000)}м`;",
      "}",
      "",
      "function renderRuntimeStatus() {",
    ),
  ],
  [
    "active collector status",
    lines(
      "  const eventCount = totalStoredEvents();",
      "  if (collectorStatus.active) {",
      "    const client = collectorWindow();",
      "    const inBackground = client?.visibilityState === \"hidden\";",
      "    elements.storage.dataset.state = inBackground ? \"warning\" : \"available\";",
      "    elements.storage.textContent = inBackground",
      "      ? `Сборщик открыт в фоне · история: ${formatInteger(eventCount)} событий`",
      "      : `Сборщик активен · история: ${formatInteger(eventCount)} событий`;",
      "    elements.storage.title = inBackground",
      "      ? \"Основной InPuls открыт в фоновой вкладке. Браузер может замедлять WebSocket и таймеры.\"",
      "      : \"Основной InPuls открыт и записывает найденные события в локальную историю.\";",
      "    if (elements.collectorOpen) elements.collectorOpen.textContent = \"Открыть InPuls\";",
      "    return;",
      "  }",
    ),
    lines(
      "  const eventCount = totalStoredEvents();",
      "  if (collectorStatus.active) {",
      "    const client = collectorWindow();",
      "    const inBackground = client?.visibilityState === \"hidden\";",
      "    const heartbeat = collectorStatus.heartbeat;",
      "    const heartbeatAge = collectorHeartbeatAge();",
      "    const heartbeatLive = heartbeatAge !== null && heartbeatAge <= COLLECTOR_HEARTBEAT_STALE_MS;",
      "    if (!heartbeatLive) {",
      "      elements.storage.dataset.state = \"error\";",
      "      elements.storage.textContent = heartbeatAge === null",
      "        ? \"Вкладка InPuls открыта, но живой сбор не подтверждён\"",
      "        : `Сбор замер · последнее обновление ${formatAgeMs(heartbeatAge)} назад`;",
      "      elements.storage.title = \"Открытая вкладка не гарантирует работу детектора. Проверь соединение основного InPuls и верни вкладку на экран.\";",
      "      if (elements.collectorOpen) elements.collectorOpen.textContent = \"Открыть InPuls\";",
      "      return;",
      "    }",
      "    const checks = formatInteger(heartbeat?.checks ?? 0);",
      "    const sessionEvents = formatInteger(heartbeat?.signalEvents ?? 0);",
      "    elements.storage.dataset.state = inBackground ? \"warning\" : \"available\";",
      "    elements.storage.textContent = inBackground",
      "      ? `Поток LIVE в фоне · проверок: ${checks} · новых событий: ${sessionEvents}`",
      "      : `Поток LIVE · проверок: ${checks} · новых событий: ${sessionEvents}`;",
      "    elements.storage.title = `Последняя проверка ${formatAgeMs(heartbeatAge)} назад · символов: ${formatInteger(heartbeat?.symbols ?? 0)} · история: ${formatInteger(eventCount)}`;",
      "    if (elements.collectorOpen) elements.collectorOpen.textContent = \"Открыть InPuls\";",
      "    return;",
      "  }",
    ),
  ],
  [
    "empty state heartbeat",
    lines(
      "  if (collectorStatus.active && eventCount === 0) {",
      "    elements.empty.textContent = \"Сборщик работает. Подходящий паттерн появится здесь после первого реального срабатывания.\";",
      "    return;",
      "  }",
    ),
    lines(
      "  if (collectorStatus.active && eventCount === 0) {",
      "    const age = collectorHeartbeatAge();",
      "    if (age === null || age > COLLECTOR_HEARTBEAT_STALE_MS) {",
      "      elements.empty.textContent = \"Вкладка InPuls открыта, но поток детектора не обновляется. Открой основной InPuls и проверь статус Binance.\";",
      "      return;",
      "    }",
      "    elements.empty.textContent = `Поток LIVE: выполнено ${formatInteger(collectorStatus.heartbeat?.checks ?? 0)} проверок. Подходящих паттернов пока не зафиксировано.`;",
      "    return;",
      "  }",
    ),
  ],
  [
    "service worker unavailable heartbeat",
    lines("        clients: [],", "        reason: \"service-worker-unavailable\","),
    lines("        clients: [],", "        heartbeat: readCollectorHeartbeat(),", "        reason: \"service-worker-unavailable\","),
  ],
  [
    "timeout heartbeat",
    lines("        clients: [],", "        reason: \"collector-status-timeout\","),
    lines("        clients: [],", "        heartbeat: readCollectorHeartbeat(),", "        reason: \"collector-status-timeout\","),
  ],
  [
    "success heartbeat",
    lines(
      "          clients: Array.isArray(payload.clients) ? payload.clients : [],",
      "          reason: payload.active === true ? \"collector-client-found\" : \"collector-client-missing\","),
    lines(
      "          clients: Array.isArray(payload.clients) ? payload.clients : [],",
      "          heartbeat: readCollectorHeartbeat(),",
      "          reason: payload.active === true ? \"collector-client-found\" : \"collector-client-missing\","),
  ],
  [
    "error heartbeat",
    lines("      clients: [],", "      reason: String(error?.message || error).slice(0, 120),"),
    lines("      clients: [],", "      heartbeat: readCollectorHeartbeat(),", "      reason: String(error?.message || error).slice(0, 120),"),
  ],
]);

for (const path of ["owner-signal-lab.html", "sw.js"]) {
  const source = await readFile(path, "utf8");
  if (!source.includes(BUILD_OLD)) throw new Error(`${path}: old build marker missing`);
  await writeFile(path, source.replaceAll(BUILD_OLD, BUILD_NEW));
}

await patchFile("test/signal-lab-collector-status.test.js", [
  [
    "read app in test",
    lines(
      "  const [html, script] = await Promise.all([",
      "    source(\"owner-signal-lab.html\"),",
      "    source(\"owner-signal-lab-v2.js\"),",
      "  ]);",
    ),
    lines(
      "  const [html, script, app] = await Promise.all([",
      "    source(\"owner-signal-lab.html\"),",
      "    source(\"owner-signal-lab-v2.js\"),",
      "    source(\"app.js\"),",
      "  ]);",
    ),
  ],
  [
    "collector assertions",
    lines("  assert.match(script, /dispatchEvent\\(new CustomEvent/);", "});"),
    lines(
      "  assert.match(script, /dispatchEvent\\(new CustomEvent/);",
      "  assert.match(script, /inpuls-signal-lab-collector-health-v1/);",
      "  assert.match(script, /Сбор замер/);",
      "  assert.match(script, /Поток LIVE/);",
      "  assert.match(app, /let hasMarketTicker = false/);",
      "  assert.match(app, /if \\(hasMarketTicker\\) collectSignalMemoryFromFeed\\(Date\\.now\\(\\)\\)/);",
      "  assert.match(app, /function collectSignalMemoryFromFeed/);",
      "  const renderStart = app.indexOf(\"function render() {\");",
      "  const renderEnd = app.indexOf(\"function renderInPlay\", renderStart);",
      "  assert.ok(renderStart >= 0 && renderEnd > renderStart);",
      "  assert.doesNotMatch(app.slice(renderStart, renderEnd), /updateSignalMemory\\(/);",
      "});",
    ),
  ],
]);

for (const path of ["test/signal-lab-collector-status.test.js"]) {
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replaceAll(BUILD_OLD, BUILD_NEW));
}

console.log("Signal Lab event-driven collector patch applied");
