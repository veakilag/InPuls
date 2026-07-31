import { readFile, writeFile } from "node:fs/promises";

async function patchFile(path, transforms) {
  let source = await readFile(path, "utf8");
  for (const [label, before, after] of transforms) {
    const count = source.split(before).length - 1;
    if (count !== 1) {
      throw new Error(`${path}: expected exactly one ${label} match, found ${count}`);
    }
    source = source.replace(before, after);
  }
  await writeFile(path, source);
}

const BUILD_OLD = "26-81-signal-lab-collector-status-v1";
const BUILD_NEW = "26-82-signal-lab-event-driven-collector-v1";

await patchFile("app.js", [
  [
    "market ticker batch flag",
    "    if (Array.isArray(data)) {\n      for (const ticker of data) {",
    "    if (Array.isArray(data)) {\n      let hasMarketTicker = false;\n      for (const ticker of data) {",
  ],
  [
    "event-driven collection call",
    "        getSymbol(ticker.s, Number(ticker.E) || Date.now())?.updateTicker(ticker);\n      }\n      scheduleRender();",
    "        getSymbol(ticker.s, Number(ticker.E) || Date.now())?.updateTicker(ticker);\n        hasMarketTicker = true;\n      }\n      if (hasMarketTicker) collectSignalMemoryFromFeed(Date.now());\n      scheduleRender();",
  ],
  [
    "collector health state",
    "const signalMemory = new SignalMemoryTracker();\nconst signalLab = new SignalLabLocalStore();\nsignalLab.initialize().then((status) => {",
    `const signalMemory = new SignalMemoryTracker();\nconst signalLab = new SignalLabLocalStore();\nconst SIGNAL_LAB_COLLECTOR_HEALTH_KEY = "inpuls-signal-lab-collector-health-v1";\nconst signalLabCollectorHealth = {\n  schemaVersion: 1,\n  mode: "websocket-event-driven",\n  startedAt: Date.now(),\n  publishedAt: null,\n  lastMarketAt: null,\n  lastCheckAt: null,\n  lastPersistAt: null,\n  checks: 0,\n  signalEvents: 0,\n  observations: 0,\n  symbols: 0,\n  storageState: "initializing",\n  visibilityState: document.visibilityState,\n  lastError: null,\n};\n\nfunction publishSignalLabCollectorHealth(patch = {}) {\n  Object.assign(signalLabCollectorHealth, patch, {\n    publishedAt: Date.now(),\n    visibilityState: document.visibilityState,\n  });\n  try {\n    localStorage.setItem(\n      SIGNAL_LAB_COLLECTOR_HEALTH_KEY,\n      JSON.stringify(signalLabCollectorHealth),\n    );\n  } catch {\n    // The collector remains functional when localStorage is unavailable.\n  }\n}\n\npublishSignalLabCollectorHealth();\ndocument.addEventListener("visibilitychange", () => {\n  publishSignalLabCollectorHealth();\n});\n\nsignalLab.initialize().then((status) => {`,
  ],
  [
    "storage initialize heartbeat",
    "  if (status.recoveredObservations) {\n    observability.increment(\n      \"signal-lab.recovered-observations\",\n      status.recoveredObservations,\n    );\n  }\n}).catch(() => {\n  observability.increment(\"signal-lab.storage-errors\");\n});",
    "  if (status.recoveredObservations) {\n    observability.increment(\n      \"signal-lab.recovered-observations\",\n      status.recoveredObservations,\n    );\n  }\n  publishSignalLabCollectorHealth({\n    storageState: status.state || \"available\",\n    lastError: null,\n  });\n}).catch((error) => {\n  observability.increment(\"signal-lab.storage-errors\");\n  publishSignalLabCollectorHealth({\n    storageState: \"error\",\n    lastError: String(error?.message || error).slice(0, 160),\n  });\n});",
  ],
  [
    "public collector health",
    "    report: (options = {}) => signalLab.report(options),\n    status: () => signalLab.status(),",
    "    report: (options = {}) => signalLab.report(options),\n    status: () => ({ ...signalLab.status(), collector: { ...signalLabCollectorHealth } }),",
  ],
  [
    "persist heartbeat",
    "    signalLab.persist(created, { now }).catch(() => {\n      observability.increment(\"signal-lab.storage-errors\");\n    });",
    "    signalLab.persist(created, { now }).then((persisted) => {\n      if (persisted) {\n        publishSignalLabCollectorHealth({\n          lastPersistAt: Date.now(),\n          storageState: \"available\",\n          lastError: null,\n        });\n      }\n    }).catch((error) => {\n      observability.increment(\"signal-lab.storage-errors\");\n      publishSignalLabCollectorHealth({\n        storageState: \"error\",\n        lastError: String(error?.message || error).slice(0, 160),\n      });\n    });",
  ],
  [
    "return created batch and event-driven collector",
    "    if (unavailable) {\n      observability.increment(\"market-memory.signal-observations-unavailable\", unavailable);\n    }\n  }\n}\n\nasync function warmupRadarHistory() {",
    `    if (unavailable) {\n      observability.increment("market-memory.signal-observations-unavailable", unavailable);\n    }\n  }\n  return created;\n}\n\nfunction collectSignalMemoryFromFeed(now = Date.now()) {\n  const checkedAt = Date.now();\n  const metrics = getMetrics(now);\n  const created = updateSignalMemory(metrics, now);\n  publishSignalLabCollectorHealth({\n    lastMarketAt: now,\n    lastCheckAt: checkedAt,\n    checks: signalLabCollectorHealth.checks + 1,\n    signalEvents: signalLabCollectorHealth.signalEvents + created.events.length,\n    observations: signalLabCollectorHealth.observations\n      + created.observations.length\n      + created.resolvedObservations.length,\n    symbols: metrics.length,\n  });\n  return created;\n}\n\nasync function warmupRadarHistory() {`,
  ],
  [
    "remove render-driven collection",
    "  updateSignalMemory(marketwideMetrics, now);\n  updateAlerts(metrics, now);",
    "  updateAlerts(metrics, now);",
  ],
]);

await patchFile("owner-signal-lab-v2.js", [
  ["build version", `const BUILD = "${BUILD_OLD}";`, `const BUILD = "${BUILD_NEW}";`],
  [
    "heartbeat constants",
    "const COLLECTOR_STATUS_POLL_MS = 5_000;",
    `const COLLECTOR_STATUS_POLL_MS = 5_000;\nconst COLLECTOR_HEALTH_KEY = "inpuls-signal-lab-collector-health-v1";\nconst COLLECTOR_HEARTBEAT_STALE_MS = 15_000;`,
  ],
  [
    "initial heartbeat",
    "  clients: [],\n  reason: \"not-checked\",",
    "  clients: [],\n  heartbeat: null,\n  reason: \"not-checked\",",
  ],
  [
    "heartbeat helpers",
    "function collectorWindow() {\n  return collectorStatus.clients?.find((client) => client.visibilityState === \"visible\")\n    ?? collectorStatus.clients?.[0]\n    ?? null;\n}\n\nfunction renderRuntimeStatus() {",
    `function collectorWindow() {\n  return collectorStatus.clients?.find((client) => client.visibilityState === "visible")\n    ?? collectorStatus.clients?.[0]\n    ?? null;\n}\n\nfunction readCollectorHeartbeat() {\n  try {\n    const value = JSON.parse(localStorage.getItem(COLLECTOR_HEALTH_KEY) || "null");\n    return value && typeof value === "object" ? value : null;\n  } catch {\n    return null;\n  }\n}\n\nfunction collectorHeartbeatAge(now = Date.now()) {\n  const publishedAt = finite(collectorStatus.heartbeat?.publishedAt);\n  return publishedAt === null ? null : Math.max(0, now - publishedAt);\n}\n\nfunction formatAgeMs(value) {\n  const age = finite(value);\n  if (age === null) return "—";\n  if (age < 1_000) return "<1с";\n  if (age < 60_000) return \\`${Math.round(age / 1_000)}с\\`;\n  return \\`${Math.round(age / 60_000)}м\\`;\n}\n\nfunction renderRuntimeStatus() {`,
  ],
  [
    "active collector status",
    `  const eventCount = totalStoredEvents();\n  if (collectorStatus.active) {\n    const client = collectorWindow();\n    const inBackground = client?.visibilityState === "hidden";\n    elements.storage.dataset.state = inBackground ? "warning" : "available";\n    elements.storage.textContent = inBackground\n      ? \\`Сборщик открыт в фоне · история: ${formatInteger(eventCount)} событий\\`\n      : \\`Сборщик активен · история: ${formatInteger(eventCount)} событий\\`;\n    elements.storage.title = inBackground\n      ? "Основной InPuls открыт в фоновой вкладке. Браузер может замедлять WebSocket и таймеры."\n      : "Основной InPuls открыт и записывает найденные события в локальную историю.";\n    if (elements.collectorOpen) elements.collectorOpen.textContent = "Открыть InPuls";\n    return;\n  }`,
    `  const eventCount = totalStoredEvents();\n  if (collectorStatus.active) {\n    const client = collectorWindow();\n    const inBackground = client?.visibilityState === "hidden";\n    const heartbeat = collectorStatus.heartbeat;\n    const heartbeatAge = collectorHeartbeatAge();\n    const heartbeatLive = heartbeatAge !== null && heartbeatAge <= COLLECTOR_HEARTBEAT_STALE_MS;\n    if (!heartbeatLive) {\n      elements.storage.dataset.state = "error";\n      elements.storage.textContent = heartbeatAge === null\n        ? "Вкладка InPuls открыта, но живой сбор не подтверждён"\n        : \\`Сбор замер · последнее обновление ${formatAgeMs(heartbeatAge)} назад\\`;\n      elements.storage.title = "Открытая вкладка не гарантирует работу детектора. Проверь соединение основного InPuls и верни вкладку на экран.";\n      if (elements.collectorOpen) elements.collectorOpen.textContent = "Открыть InPuls";\n      return;\n    }\n    const checks = formatInteger(heartbeat?.checks ?? 0);\n    const sessionEvents = formatInteger(heartbeat?.signalEvents ?? 0);\n    elements.storage.dataset.state = inBackground ? "warning" : "available";\n    elements.storage.textContent = inBackground\n      ? \\`Поток LIVE в фоне · проверок: ${checks} · новых событий: ${sessionEvents}\\`\n      : \\`Поток LIVE · проверок: ${checks} · новых событий: ${sessionEvents}\\`;\n    elements.storage.title = \\`Последняя проверка ${formatAgeMs(heartbeatAge)} назад · символов: ${formatInteger(heartbeat?.symbols ?? 0)} · история: ${formatInteger(eventCount)}\\`;\n    if (elements.collectorOpen) elements.collectorOpen.textContent = "Открыть InPuls";\n    return;\n  }`,
  ],
  [
    "empty state heartbeat",
    `  if (collectorStatus.active && eventCount === 0) {\n    elements.empty.textContent = "Сборщик работает. Подходящий паттерн появится здесь после первого реального срабатывания.";\n    return;\n  }`,
    `  if (collectorStatus.active && eventCount === 0) {\n    const age = collectorHeartbeatAge();\n    if (age === null || age > COLLECTOR_HEARTBEAT_STALE_MS) {\n      elements.empty.textContent = "Вкладка InPuls открыта, но поток детектора не обновляется. Открой основной InPuls и проверь статус Binance.";\n      return;\n    }\n    elements.empty.textContent = \\`Поток LIVE: выполнено ${formatInteger(collectorStatus.heartbeat?.checks ?? 0)} проверок. Подходящих паттернов пока не зафиксировано.\\`;\n    return;\n  }`,
  ],
  [
    "inactive heartbeat response",
    "        clients: [],\n        reason: \"service-worker-unavailable\",",
    "        clients: [],\n        heartbeat: readCollectorHeartbeat(),\n        reason: \"service-worker-unavailable\",",
  ],
  [
    "timeout heartbeat response",
    "        clients: [],\n        reason: \"collector-status-timeout\",",
    "        clients: [],\n        heartbeat: readCollectorHeartbeat(),\n        reason: \"collector-status-timeout\",",
  ],
  [
    "success heartbeat response",
    "          clients: Array.isArray(payload.clients) ? payload.clients : [],\n          reason: payload.active === true ? \"collector-client-found\" : \"collector-client-missing\",",
    "          clients: Array.isArray(payload.clients) ? payload.clients : [],\n          heartbeat: readCollectorHeartbeat(),\n          reason: payload.active === true ? \"collector-client-found\" : \"collector-client-missing\",",
  ],
  [
    "error heartbeat response",
    "      clients: [],\n      reason: String(error?.message || error).slice(0, 120),",
    "      clients: [],\n      heartbeat: readCollectorHeartbeat(),\n      reason: String(error?.message || error).slice(0, 120),",
  ],
]);

for (const path of ["owner-signal-lab.html", "sw.js"]) {
  const source = await readFile(path, "utf8");
  if (!source.includes(BUILD_OLD)) throw new Error(`${path}: old build marker missing`);
  await writeFile(path, source.replaceAll(BUILD_OLD, BUILD_NEW));
}

await patchFile("test/signal-lab-collector-status.test.js", [
  [
    "collector contract test",
    `  const [html, script] = await Promise.all([\n    source("owner-signal-lab.html"),\n    source("owner-signal-lab-v2.js"),\n  ]);`,
    `  const [html, script, app] = await Promise.all([\n    source("owner-signal-lab.html"),\n    source("owner-signal-lab-v2.js"),\n    source("app.js"),\n  ]);`,
  ],
  [
    "collector assertions",
    "  assert.match(script, /dispatchEvent\\(new CustomEvent/);\n});",
    `  assert.match(script, /dispatchEvent\\(new CustomEvent/);\n  assert.match(script, /inpuls-signal-lab-collector-health-v1/);\n  assert.match(script, /Сбор замер/);\n  assert.match(script, /Поток LIVE/);\n  assert.match(app, /let hasMarketTicker = false/);\n  assert.match(app, /if \\(hasMarketTicker\\) collectSignalMemoryFromFeed\\(Date\\.now\\(\\)\\)/);\n  assert.match(app, /function collectSignalMemoryFromFeed/);\n  const renderStart = app.indexOf("function render() {");\n  const renderEnd = app.indexOf("function renderInPlay", renderStart);\n  assert.ok(renderStart >= 0 && renderEnd > renderStart);\n  assert.doesNotMatch(app.slice(renderStart, renderEnd), /updateSignalMemory\\(/);\n});`,
  ],
  [
    "worker build expectation",
    `/owner-signal-lab-v2\\.js\\?v=${BUILD_OLD}/`,
    `/owner-signal-lab-v2\\.js\\?v=${BUILD_NEW}/`,
  ],
]);

console.log("Signal Lab event-driven collector patch applied");
