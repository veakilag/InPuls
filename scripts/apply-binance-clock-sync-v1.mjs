import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BUILD = "26-101-binance-clock-sync-v1";

function file(name) {
  return path.join(ROOT, name);
}

function read(name) {
  return fs.readFileSync(file(name), "utf8");
}

function write(name, content) {
  fs.writeFileSync(file(name), content);
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, after, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`Expected one regex anchor for ${label}, got ${matches.length}`);
  return source.replace(pattern, after);
}

function replaceAllTextFiles(before, after) {
  const names = fs.readdirSync(ROOT).filter((name) => /\.(?:js|mjs|html)$/.test(name));
  for (const name of names) {
    const current = read(name);
    if (!current.includes(before)) continue;
    write(name, current.replaceAll(before, after));
  }
}

function patchBrowserClock() {
  let source = read("binance-clock.js");
  source = replaceOnce(
    source,
    "    const seconds = options.seconds !== false;\n    const zone = this.setTimeZone(options.timeZone ?? this.selectedTimeZone);",
    "    const seconds = options.seconds !== false;\n    const requestedZone = String(options.timeZone ?? this.selectedTimeZone);\n    const zone = requestedZone === this.selectedTimeZone\n      ? this.selectedTimeZone\n      : this.setTimeZone(requestedZone);",
    "binance-clock hot-path timezone cache",
  );
  write("binance-clock.js", source);
}

function patchApp() {
  let source = read("app.js");
  source = replaceOnce(
    source,
    "import { buildBinanceChannelStreams, buildBinanceChannelTransports, isBinanceSubscriptionError, isCoreMiniTickerPacket, nextBinanceTransportIndex, normalizeBinanceRestMiniTicker } from \"./binance-stream-routing.js?v=26-91-runtime-boot-cache-feed-v1\";",
    "import { buildBinanceChannelStreams, buildBinanceChannelTransports, isBinanceSubscriptionError, isCoreMiniTickerPacket, nextBinanceTransportIndex, normalizeBinanceRestMiniTicker } from \"./binance-stream-routing.js?v=26-91-runtime-boot-cache-feed-v1\";\nimport { binanceClock } from \"./binance-clock.js?v=26-101-binance-clock-sync-v1\";",
    "app Binance clock import",
  );
  source = source.replaceAll(
    "./orderbook.js?v=26-100-tape-heartbeat-isolation-v1",
    `./orderbook.js?v=${BUILD}`,
  );
  source = replaceOnce(
    source,
    "function formatTradeClock(time, duration) {\n  return new Intl.DateTimeFormat(\"ru-RU\", { hour: \"2-digit\", minute: \"2-digit\", second: duration <= 2 * 60_000 ? \"2-digit\" : undefined }).format(new Date(time));\n}\n\nfunction formatTradeAge(time) {\n  const age = Math.max(0, Date.now() - Number(time));",
    "function formatTradeClock(time, duration) {\n  return binanceClock.formatTime(time, { seconds: duration <= 2 * 60_000 });\n}\n\nfunction formatTradeAge(time) {\n  const age = Math.max(0, binanceClock.now() - Number(time));",
    "app trade clock formatting",
  );
  source = replaceOnce(
    source,
    "  const window = tradeTimeWindow(Date.now(), panel.model.tradeWindowMs, panel.tradeOffsetMs);",
    "  const window = tradeTimeWindow(binanceClock.now(), panel.model.tradeWindowMs, panel.tradeOffsetMs);",
    "app flow window clock",
  );
  source = replaceOnce(
    source,
    "  state.timeZone = zone;\n  state.selectedTimeZoneCity = city || state.selectedTimeZoneCity || cityForZone(zone);",
    "  state.timeZone = zone;\n  binanceClock.setTimeZone(zone);\n  state.selectedTimeZoneCity = city || state.selectedTimeZoneCity || cityForZone(zone);",
    "app selected timezone sync",
  );
  source = replaceOnce(
    source,
    `function updateClock(date = new Date()) {
  const zone = state.timeZone === "local"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : state.timeZone;
  const nextText = timeZoneClock(zone, date, true);
  if (nextText !== updateClock.lastText) {
    updateClock.lastText = nextText;
    els.clock.textContent = nextText;
  }
  updateTimeZoneClocks(date);
}
function scheduleClockTick() {
  clearTimeout(scheduleClockTick.timer);
  const delay = Math.max(40, 1_000 - (Date.now() % 1_000) + 12);
  scheduleClockTick.timer = setTimeout(() => {
    requestAnimationFrame(() => {
      updateClock(new Date());
      scheduleClockTick();
    });
  }, delay);
}
updateClock();
scheduleClockTick();
render();

const INPULS_RUNTIME_BUILD = "26-91-runtime-boot-cache-feed-v1";`,
    `function updateClock(date = new Date(binanceClock.now())) {
  const zone = state.timeZone === "local"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : state.timeZone;
  binanceClock.setTimeZone(zone);
  const nextText = timeZoneClock(zone, date, true);
  if (nextText !== updateClock.lastText) {
    updateClock.lastText = nextText;
    els.clock.textContent = nextText;
  }
  const clockState = binanceClock.snapshot();
  els.clock.dataset.source = clockState.status;
  if (clockState.status === "live") {
    const rtt = Number.isFinite(clockState.rttMs) ? Math.round(clockState.rttMs) : null;
    const offset = Number.isFinite(clockState.offsetMs) ? Math.round(clockState.offsetMs) : null;
    els.clock.title = \`Время Binance Futures · \${rtt === null ? "RTT —" : \`RTT \${rtt} мс\`} · \${offset === null ? "поправка —" : \`поправка \${offset >= 0 ? "+" : ""}\${offset} мс\`}\`;
  } else if (clockState.status === "syncing") {
    els.clock.title = "Синхронизация времени с Binance Futures…";
  } else if (clockState.status === "stale") {
    els.clock.title = "Время Binance Futures · калибровка устарела, выполняется повторная синхронизация";
  } else {
    els.clock.title = "Локальное резервное время · Binance Futures пока недоступен";
  }
  updateTimeZoneClocks(date);
}
function scheduleClockTick() {
  clearTimeout(scheduleClockTick.timer);
  const delay = binanceClock.delayToNextSecond(12);
  scheduleClockTick.timer = setTimeout(() => {
    requestAnimationFrame(() => {
      updateClock(new Date(binanceClock.now()));
      scheduleClockTick();
    });
  }, delay);
}
binanceClock.setTimeZone(state.timeZone === "local"
  ? Intl.DateTimeFormat().resolvedOptions().timeZone
  : state.timeZone);
binanceClock.addEventListener("statechange", () => {
  updateClock(new Date(binanceClock.now()));
  scheduleClockTick();
});
binanceClock.start();
updateClock(new Date(binanceClock.now()));
scheduleClockTick();
render();

const INPULS_RUNTIME_BUILD = "${BUILD}";`,
    "app shared Binance clock runtime",
  );
  write("app.js", source);
}

function patchOrderBook() {
  let source = read("orderbook.js");
  source = replaceOnce(
    source,
    "import {\n  adaptiveRawDiameter,",
    `import { binanceClock } from "./binance-clock.js?v=${BUILD}";\nimport {\n  adaptiveRawDiameter,`,
    "orderbook Binance clock import",
  );
  source = source.replaceAll(
    "./orderbook-worker.js?v=26-91-runtime-boot-cache-feed-v1",
    `./orderbook-worker.js?v=${BUILD}`,
  );
  source = replaceOnce(
    source,
    "export function resolveTapeWindowEnd(latestTime, frozen, now = Date.now()) {",
    "export function resolveTapeWindowEnd(latestTime, frozen, now = binanceClock.now()) {",
    "Tape window fallback clock",
  );
  source = replaceOnce(
    source,
    "  const safeNow = Number.isFinite(requestedNow) ? requestedNow : Date.now();",
    "  const safeNow = Number.isFinite(requestedNow) ? requestedNow : binanceClock.now();",
    "trade window fallback clock",
  );
  source = replaceOnce(
    source,
    `function formatTapeClock(time) {
  const date = new Date(Number(time));
  const pad = (value) => String(value).padStart(2, "0");
  return \`\${pad(date.getHours())}:\${pad(date.getMinutes())}:\${pad(date.getSeconds())}\`;
}`,
    `function formatTapeClock(time) {
  return binanceClock.formatTime(time, { seconds: true });
}`,
    "Tape timezone formatting",
  );
  source = replaceOnce(
    source,
    `export function advanceWaterTapeClock(
  previousEnd,
  previousAt,
  latestTradeTime,
  packetAt,
  nowPerf,
  frozen = false,
) {
  const latest = Number(latestTradeTime);
  const now = Number(nowPerf);
  const packet = Number(packetAt);
  if (!Number.isFinite(latest) || !Number.isFinite(now)) return null;
  const hasPrevious = previousEnd !== null
    && previousEnd !== undefined
    && Number.isFinite(Number(previousEnd));
  if (frozen) return hasPrevious ? Number(previousEnd) : latest + 1;
  const packetAge = Number.isFinite(packet) ? Math.max(0, now - packet) : 0;
  const desired = latest + packetAge + TAPE_LIVE_EDGE_LEAD_MS;
  if (!hasPrevious) return desired;
  const previous = Number(previousEnd);
  const previousTime = Number(previousAt);
  const elapsed = Number.isFinite(previousTime)
    ? Math.max(0, Math.min(250, now - previousTime))
    : 0;
  const base = previous + elapsed;
  const alpha = 1 - Math.exp(-elapsed / TAPE_CLOCK_CORRECTION_TAU_MS);
  const corrected = base + (desired - base) * alpha;
  return Math.max(previous, corrected);
}`,
    `export function advanceWaterTapeClock(
  previousEnd,
  previousAt,
  latestTradeTime,
  packetAt,
  nowPerf,
  frozen = false,
  exchangeNow = null,
) {
  const latest = Number(latestTradeTime);
  const now = Number(nowPerf);
  const packet = Number(packetAt);
  const exchange = Number(exchangeNow);
  if (!Number.isFinite(latest) || !Number.isFinite(now)) return null;
  const hasPrevious = previousEnd !== null
    && previousEnd !== undefined
    && Number.isFinite(Number(previousEnd));
  if (frozen) return hasPrevious ? Number(previousEnd) : latest + 1;
  const packetAge = Number.isFinite(packet) ? Math.max(0, now - packet) : 0;
  const packetAdvanced = latest + packetAge;
  const target = Number.isFinite(exchange)
    ? Math.max(exchange, packetAdvanced)
    : packetAdvanced;
  const desired = target + TAPE_LIVE_EDGE_LEAD_MS;
  if (!hasPrevious) return desired;
  const previous = Number(previousEnd);
  const previousTime = Number(previousAt);
  const elapsed = Number.isFinite(previousTime)
    ? Math.max(0, Math.min(250, now - previousTime))
    : 0;
  const base = previous + elapsed;
  if (desired - base > 500) return Math.max(previous, desired);
  const alpha = 1 - Math.exp(-elapsed / TAPE_CLOCK_CORRECTION_TAU_MS);
  const corrected = base + (desired - base) * alpha;
  return Math.max(previous, corrected);
}`,
    "Tape shared live edge clock",
  );
  source = replaceOnce(
    source,
    "  const latest = Number(latestTime) || Date.now();",
    "  const latest = Number(latestTime) || binanceClock.now();",
    "continuous Tape window fallback",
  );
  source = replaceOnce(
    source,
    `  const latestTime = Number(meta.lastTradeTime)
    || Number(stored[0]?.time)
    || Number(aggregationStored[0]?.time)
    || Date.now();
  const endTime = advanceWaterTapeClock(
    state.clockEndTime,
    state.clockPerfAt,
    latestTime,
    meta.lastPacketPerfAt,
    perfNow,
    frozen,
  );`,
    `  const exchangeNow = binanceClock.now(perfNow);
  const latestTime = Number(meta.lastTradeTime)
    || Number(stored[0]?.time)
    || Number(aggregationStored[0]?.time)
    || exchangeNow;
  const endTime = advanceWaterTapeClock(
    state.clockEndTime,
    state.clockPerfAt,
    latestTime,
    meta.lastPacketPerfAt,
    perfNow,
    frozen,
    exchangeNow,
  );`,
    "Tape render shared exchange clock",
  );
  write("orderbook.js", source);
}

function patchWorker() {
  let source = read("orderbook-worker.js");
  source = replaceOnce(
    source,
    "importScripts(\"./orderbook-tape-guard.js?v=worker-bp-v1\");",
    `importScripts("./binance-clock-core.js?v=${BUILD}");\nimportScripts("./orderbook-tape-guard.js?v=worker-bp-v1");`,
    "worker Binance clock core import",
  );
  source = replaceRegexOnce(
    source,
    /async function syncServerClock\(force = false\) \{[\s\S]*?\n\}\n\nfunction depthTransports/,
    `async function syncServerClock(force = false) {
  const now = Date.now();
  if (
    !force
    && Number.isFinite(serverClockOffsetMs)
    && now - serverClockSyncAt < CLOCK_SYNC_INTERVAL_MS
  ) return serverClockOffsetMs;
  if (serverClockSyncPromise) return serverClockSyncPromise;

  serverClockSyncPromise = (async () => {
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];
    const samples = [];
    diagnose("", "clock.rest", { state: "scheduled", hosts: hosts.length, requestedSamples: 3 });
    for (let index = 0; index < 3; index += 1) {
      const targets = hosts.slice(index).concat(hosts.slice(0, index));
      try {
        const result = await self.InPulsOrderBookNetwork.firstSuccessful(
          targets,
          async (host, { signal }) => {
            const sentAt = Date.now();
            const data = await fetchJson(\`https://\${host}/fapi/v1/time\`, 1_800, signal);
            const receivedAt = Date.now();
            const serverTime = Number(data?.serverTime);
            if (!Number.isFinite(serverTime)) throw new Error("invalid server time");
            return { sentAt, receivedAt, serverTime, host };
          },
          {
            onAttempt: (event) => diagnose("", "clock.rest.host", {
              ...event,
              sample: index + 1,
              host: event.target,
              target: undefined,
            }),
          },
        );
        if (result?.value) samples.push(result.value);
      } catch {}
    }
    const estimate = self.InPulsBinanceClockCore?.estimateClockOffset?.(samples, 3) ?? null;
    if (estimate && Number.isFinite(Number(estimate.offsetMs))) {
      serverClockOffsetMs = Number(estimate.offsetMs);
      serverClockRttMs = Number.isFinite(Number(estimate.rttMs)) ? Number(estimate.rttMs) : null;
      serverClockSyncAt = Date.now();
      diagnose("", "clock.rest", {
        state: "succeeded",
        rttMs: serverClockRttMs,
        offsetMs: serverClockOffsetMs,
        sampleCount: estimate.sampleCount,
        totalSampleCount: estimate.totalSampleCount,
      });
    } else {
      diagnose("", "clock.rest", { state: "failed", sampleCount: samples.length });
    }
    return serverClockOffsetMs;
  })().finally(() => {
    serverClockSyncPromise = null;
  });
  return serverClockSyncPromise;
}

function depthTransports`,
    "worker multi-sample clock calibration",
  );
  source = replaceOnce(
    source,
    "syncServerClock(true).catch(() => {});\nscheduleWatchdog();",
    "syncServerClock(true).catch(() => {});\nsetInterval(() => syncServerClock(true).catch(() => {}), CLOCK_SYNC_INTERVAL_MS);\nscheduleWatchdog();",
    "worker periodic clock calibration",
  );
  write("orderbook-worker.js", source);
}

function patchReleaseFiles() {
  replaceAllTextFiles(
    "./app.js?v=26-100-tape-heartbeat-isolation-v1",
    `./app.js?v=${BUILD}`,
  );
  replaceAllTextFiles(
    "./orderbook.js?v=26-100-tape-heartbeat-isolation-v1",
    `./orderbook.js?v=${BUILD}`,
  );
  replaceAllTextFiles(
    "./orderbook-worker.js?v=26-91-runtime-boot-cache-feed-v1",
    `./orderbook-worker.js?v=${BUILD}`,
  );

  let index = read("index.html");
  index = replaceOnce(
    index,
    '<meta name="inpuls-build" content="26-91-runtime-boot-cache-feed-v1" />',
    `<meta name="inpuls-build" content="${BUILD}" />`,
    "index build marker",
  );
  write("index.html", index);

  let sw = read("sw.js");
  sw = replaceOnce(
    sw,
    'const BUILD = "26-95-stable-network-only-sw-v1";',
    `const BUILD = "${BUILD}";`,
    "service worker build",
  );
  sw = replaceOnce(
    sw,
    `  "./app.js?v=${BUILD}",`,
    `  "./app.js?v=${BUILD}",\n  "./binance-clock-core.js?v=${BUILD}",\n  "./binance-clock.js?v=${BUILD}",`,
    "service worker Binance clock assets",
  );
  write("sw.js", sw);
}

patchBrowserClock();
patchApp();
patchOrderBook();
patchWorker();
patchReleaseFiles();

console.log("Applied Binance clock synchronization patch.");
