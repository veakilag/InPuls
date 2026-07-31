import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Missing integration point: ${label}`);
  return source.replace(before, after);
}

async function patchEventRadar() {
  const path = "event-radar-beta.js";
  let source = await readFile(path, "utf8");

  source = replaceOnce(
    source,
    "const RETENTION_MS = 90_000;\nconst PINNED_RETENTION_MS = 10 * 60_000;",
    "const RETENTION_MS = 15 * 60_000;\nconst PINNED_RETENTION_MS = 60 * 60_000;\nconst FEED_STALE_MS = 5_000;\nconst FEED_WARMUP_SECONDS = 60;\nconst HISTORY_READY_SECONDS = 5 * 60;",
    "retention and feed thresholds",
  );

  const dataStateBlock = `export function eventRadarDataState(entry, now = Date.now()) {\n  const updatedAge = now - (finite(entry?.updatedAt) ?? 0);\n  if (updatedAge > 5_000) return "stale";\n  const tradeAge = now - (finite(entry?.lastTradeAt) ?? 0);\n  return tradeAge <= 3_000 ? "live" : "light";\n}\n`;
  const feedHelpers = `\nfunction median(values) {\n  if (!values.length) return 0;\n  const ordered = [...values].sort((left, right) => left - right);\n  const middle = Math.floor(ordered.length / 2);\n  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;\n}\n\nexport function summarizeEventRadarFeed(metrics, receivedAt = Date.now()) {\n  const list = Array.isArray(metrics) ? metrics : [];\n  const warmups = list.map((item) => finite(item?.warmupSeconds)).filter((value) => value !== null);\n  const medianWarmupSeconds = median(warmups);\n  const signalCount = list.reduce((total, item) => total + (Array.isArray(item?.signals) ? item.signals.length : 0), 0);\n  return {\n    receivedAt,\n    symbolCount: list.length,\n    signalCount,\n    medianWarmupSeconds,\n    historyPercent: Math.min(100, Math.max(0, Math.round((medianWarmupSeconds / HISTORY_READY_SECONDS) * 100))),\n  };\n}\n\nexport function eventRadarFeedState(snapshot, now = Date.now()) {\n  if (!snapshot?.receivedAt) return "waiting";\n  if (now - snapshot.receivedAt > FEED_STALE_MS) return "stale";\n  if ((finite(snapshot.medianWarmupSeconds) ?? 0) < FEED_WARMUP_SECONDS) return "warming";\n  return "live";\n}\n`;
  source = replaceOnce(source, dataStateBlock, `${dataStateBlock}${feedHelpers}`, "feed helpers");

  source = replaceOnce(
    source,
    "    this.newCounter = null;\n    this.resizeObserver = null;",
    "    this.newCounter = null;\n    this.feedStatus = null;\n    this.feedSnapshot = null;\n    this.feedTimer = null;\n    this.resizeObserver = null;",
    "widget feed state",
  );

  source = replaceOnce(
    source,
    "      </div>\n      <div class=\"event-radar-beta__columns\" aria-hidden=\"true\"><span>Событие</span><span>15с / 1м</span><span>Поток</span><span>Приоритет</span></div>",
    "      </div>\n      <div class=\"event-radar-beta__feed\" data-feed-state=\"waiting\" role=\"status\" aria-live=\"polite\">\n        <strong data-feed-label>ОЖИДАНИЕ ПОТОКА</strong>\n        <span data-feed-symbols>0 монет</span>\n        <span data-feed-signals>0 сигналов</span>\n        <span data-feed-age>обновлений нет</span>\n        <span data-feed-history>история 0%</span>\n      </div>\n      <div class=\"event-radar-beta__columns\" aria-hidden=\"true\"><span>Событие</span><span>15с / 1м</span><span>Поток</span><span>Приоритет</span></div>",
    "feed status markup",
  );

  source = replaceOnce(
    source,
    "    this.newCounter = panel.querySelector(\".event-radar-beta__new\");\n    this.applyGeometry();",
    "    this.newCounter = panel.querySelector(\".event-radar-beta__new\");\n    this.feedStatus = panel.querySelector(\".event-radar-beta__feed\");\n    this.applyGeometry();",
    "feed status element",
  );

  source = replaceOnce(
    source,
    "    this.resizeObserver = new ResizeObserver(() => this.persistGeometry());\n    this.resizeObserver.observe(panel);\n  }",
    "    this.resizeObserver = new ResizeObserver(() => this.persistGeometry());\n    this.resizeObserver.observe(panel);\n    this.feedTimer = window.setInterval(() => {\n      this.now = Date.now();\n      this.renderFeedStatus();\n      if (!this.entries.size) this.render();\n    }, 1_000);\n  }",
    "feed status timer",
  );

  source = replaceOnce(
    source,
    "  ingest(detail = {}) {\n    this.now = finite(detail.now) ?? Date.now();\n    this.favorites = new Set(Array.isArray(detail.favorites) ? detail.favorites : []);",
    "  ingest(detail = {}) {\n    const receivedAt = Date.now();\n    this.now = finite(detail.now) ?? receivedAt;\n    this.feedSnapshot = summarizeEventRadarFeed(detail.metrics, receivedAt);\n    this.favorites = new Set(Array.isArray(detail.favorites) ? detail.favorites : []);",
    "feed snapshot ingestion",
  );

  source = replaceOnce(
    source,
    "    }\n    this.render();\n  }\n\n  toggleFreeze() {",
    `    }\n    this.renderFeedStatus();\n    this.render();\n  }\n\n  renderFeedStatus() {\n    if (!this.feedStatus) return;\n    const state = eventRadarFeedState(this.feedSnapshot, this.now);\n    const snapshot = this.feedSnapshot || { symbolCount: 0, signalCount: 0, historyPercent: 0, receivedAt: null };\n    const labels = {\n      waiting: "ОЖИДАНИЕ ПОТОКА",\n      warming: "СБОР ИСТОРИИ",\n      live: "ПОТОК LIVE",\n      stale: "НЕТ ДАННЫХ · STALE",\n    };\n    this.feedStatus.dataset.feedState = state;\n    this.feedStatus.querySelector("[data-feed-label]").textContent = labels[state];\n    this.feedStatus.querySelector("[data-feed-symbols]").textContent = \`${"${snapshot.symbolCount}"} монет\`;\n    this.feedStatus.querySelector("[data-feed-signals]").textContent = \`${"${snapshot.signalCount}"} сигналов\`;\n    this.feedStatus.querySelector("[data-feed-age]").textContent = snapshot.receivedAt\n      ? \`обновлено ${"${formatAge(Math.max(0, this.now - snapshot.receivedAt))}"} назад\`\n      : "обновлений нет";\n    this.feedStatus.querySelector("[data-feed-history]").textContent = \`история ${"${snapshot.historyPercent}"}%\`;\n  }\n\n  emptyStateMarkup() {\n    const state = eventRadarFeedState(this.feedSnapshot, this.now);\n    if (state === "waiting") return ["Ожидаю рыночный поток", "Binance ещё не передал первый набор метрик в этот виджет."];\n    if (state === "stale") return ["Данные перестали обновляться", "Проверь соединение: последний пакет старше 5 секунд."];\n    if (state === "warming") return ["Собираю историю", "Поток уже работает, но формулам нужно накопить контекст."];\n    return ["Поток LIVE · сигналов нет", "Рынок обновляется, но условия реальных сигналов сейчас не выполнены."];\n  }\n\n  toggleFreeze() {`,
    "feed status methods",
  );

  source = replaceOnce(
    source,
    "    if (!entries.length) {\n      this.list.innerHTML = `<div class=\"event-radar-beta__empty\"><strong>Свежих событий пока нет</strong><span>Радар получает только реальные сигналы текущего main.</span></div>`;\n      return;\n    }",
    "    if (!entries.length) {\n      const [title, description] = this.emptyStateMarkup();\n      this.list.innerHTML = `<div class=\"event-radar-beta__empty\"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></div>`;\n      return;\n    }",
    "diagnostic empty state",
  );

  await writeFile(path, source);
}

async function patchStyles() {
  const path = "event-radar-beta.css";
  let source = await readFile(path, "utf8");
  source = replaceOnce(
    source,
    "  grid-template-rows: 38px auto 24px minmax(0, 1fr) 24px;",
    "  grid-template-rows: 38px auto 28px 24px minmax(0, 1fr) 24px;",
    "status grid row",
  );

  const marker = ".event-radar-beta__feed {";
  if (!source.includes(marker)) {
    const anchor = ".event-radar-beta__filters button:hover,\n.event-radar-beta__filters button.is-active { color: var(--text); border-color: var(--violet); background: rgba(170, 134, 255, .1); }\n\n";
    if (!source.includes(anchor)) throw new Error("Missing integration point: status styles");
    const styles = `.event-radar-beta__feed {\n  min-width: 0;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 0 8px;\n  overflow-x: auto;\n  border-bottom: 1px solid var(--line-soft);\n  background: color-mix(in srgb, var(--panel-2) 78%, transparent);\n  color: var(--muted);\n  scrollbar-width: none;\n  white-space: nowrap;\n}\n.event-radar-beta__feed strong {\n  flex: 0 0 auto;\n  color: var(--blue);\n  font-size: calc(7 * var(--font-scale));\n  letter-spacing: .05em;\n}\n.event-radar-beta__feed span { flex: 0 0 auto; font-size: calc(6.5 * var(--font-scale)); }\n.event-radar-beta__feed span + span::before { content: "·"; margin-right: 8px; color: var(--line); }\n.event-radar-beta__feed[data-feed-state="live"] strong { color: var(--green); }\n.event-radar-beta__feed[data-feed-state="warming"] strong { color: var(--amber); }\n.event-radar-beta__feed[data-feed-state="stale"] strong { color: var(--red); }\n\n`;
    source = source.replace(anchor, `${anchor}${styles}`);
  }
  await writeFile(path, source);
}

async function patchTests() {
  const path = "test-event-radar-beta-v1.mjs";
  let source = await readFile(path, "utf8");
  source = replaceOnce(
    source,
    "  eventRadarGroup,\n  eventRadarStatus,\n  mergeEventRadarEntries,",
    "  eventRadarFeedState,\n  eventRadarGroup,\n  eventRadarStatus,\n  mergeEventRadarEntries,\n  summarizeEventRadarFeed,",
    "test imports",
  );

  const testMarker = "event radar distinguishes waiting, warmup, live and stale feed states";
  if (!source.includes(testMarker)) {
    source += `\n\ntest("${testMarker}", () => {\n  assert.equal(eventRadarFeedState(null, 10_000), "waiting");\n  const warming = summarizeEventRadarFeed([{ symbol: "BTCUSDT", warmupSeconds: 30, signals: [] }], 10_000);\n  assert.equal(warming.symbolCount, 1);\n  assert.equal(warming.signalCount, 0);\n  assert.equal(warming.historyPercent, 10);\n  assert.equal(eventRadarFeedState(warming, 10_500), "warming");\n  const live = summarizeEventRadarFeed([{ symbol: "BTCUSDT", warmupSeconds: 90, signals: [{ type: "impulse" }] }], 20_000);\n  assert.equal(live.signalCount, 1);\n  assert.equal(eventRadarFeedState(live, 20_500), "live");\n  assert.equal(eventRadarFeedState(live, 26_000), "stale");\n});\n`;
  }
  await writeFile(path, source);
}

await patchEventRadar();
await patchStyles();
await patchTests();
