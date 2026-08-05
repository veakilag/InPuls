import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, search, replacement, label) {
  const source = await readFile(path, "utf8");
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  await writeFile(path, source.replace(search, replacement));
}

await replaceOnce(
  "signal-lab-v3-collector.js",
  `import {
  CandidateEpisodeTracker,
  candidateWatchScore,
  DEFAULT_CANDIDATE_SETTINGS,
  SIGNAL_LAB_V3_FORMULA_VERSION,
} from "./signal-lab-v3-candidates.js";`,
  `import {
  CandidateEpisodeTracker,
  candidateWatchScore,
  DEFAULT_CANDIDATE_SETTINGS,
  SIGNAL_LAB_V3_FORMULA_VERSION,
} from "./signal-lab-v3-candidates.js";
import { SignalLabV3EvidenceRecorder } from "./signal-lab-v3-evidence.js";`,
  "collector evidence import",
);

await replaceOnce(
  "signal-lab-v3-collector.js",
  `    this.bookTracker = new ExpertBookCandidateTracker(this.settings);
    this.episodes = new CandidateEpisodeTracker(this.settings);
    this.trackedAggTrades = new Set();`,
  `    this.bookTracker = new ExpertBookCandidateTracker(this.settings);
    this.episodes = new CandidateEpisodeTracker(this.settings);
    this.evidence = new SignalLabV3EvidenceRecorder({ maximumDepthSymbols: 10 });
    this.trackedAggTrades = new Set();`,
  "collector evidence recorder",
);

await replaceOnce(
  "signal-lab-v3-collector.js",
  `      warmupLoaded: 0,
      warmupLoading: 0,
      lastError: null,`,
  `      warmupLoaded: 0,
      warmupLoading: 0,
      evidencePacks: 0,
      depthTracked: 0,
      depthState: "idle",
      lastError: null,`,
  "collector evidence status fields",
);

await replaceOnce(
  "signal-lab-v3-collector.js",
  `    this.socket = null;
    this.bookSocket = null;
    this.#publish({ connection: "stopped" });`,
  `    this.socket = null;
    this.bookSocket = null;
    this.evidence.disconnect();
    this.#publish({ connection: "stopped", depthState: "stopped", depthTracked: 0 });`,
  "collector evidence disconnect",
);

await replaceOnce(
  "signal-lab-v3-collector.js",
  `  #check(now) {
    const metrics = this.#metrics(now);
    const result = this.episodes.ingest(metrics, now);
    this.onEpisodes(result, metrics);
    this.#publish({
      lastCheckAt: now,
      checks: this.statusState.checks + 1,
      createdEpisodes: this.statusState.createdEpisodes + result.created.length,
      updatedEpisodes: this.statusState.updatedEpisodes + result.updated.length,
      expiredEpisodes: this.statusState.expiredEpisodes + result.expired.length,
      symbols: metrics.length,
    });
    this.#refreshTrackedTrades(metrics, now);
    this.#queueWarmup(metrics);
  }`,
  `  #check(now) {
    const metrics = this.#metrics(now);
    const result = this.episodes.ingest(metrics, now);
    const evidenceResult = this.evidence.ingest({ metricsRows: metrics, result, now });
    this.onEpisodes(evidenceResult, metrics);
    this.#refreshTrackedTrades(metrics, now);
    const evidenceStatus = this.evidence.status();
    this.#publish({
      lastCheckAt: now,
      checks: this.statusState.checks + 1,
      createdEpisodes: this.statusState.createdEpisodes + result.created.length,
      updatedEpisodes: this.statusState.updatedEpisodes + result.updated.length,
      expiredEpisodes: this.statusState.expiredEpisodes + result.expired.length,
      symbols: metrics.length,
      evidencePacks: evidenceStatus.evidencePacks,
      depthTracked: evidenceStatus.depth.trackedSymbols ?? 0,
      depthState: evidenceStatus.depth.connection ?? "idle",
    });
    this.#queueWarmup(metrics);
  }`,
  "collector evidence ingest",
);

await replaceOnce(
  "signal-lab-v3-collector.js",
  `    this.trackedAggTrades = next;
    if (unsubscribe.length) {`,
  `    this.trackedAggTrades = next;
    this.evidence.setWatchSymbols([
      ...activeSymbols,
      ...ranked.slice(0, 10).map((row) => row.symbol),
    ], now);
    if (unsubscribe.length) {`,
  "collector depth watchlist",
);

await replaceOnce(
  "signal-lab-v3-evidence.js",
  `    this.socket?.close();
    this.socket = null;
    this.#publish({ connection: "stopped" });`,
  `    this.socket?.close();
    this.socket = null;
    this.symbols = [];
    this.signature = "";
    this.#publish({ connection: "stopped", trackedSymbols: 0 });`,
  "depth pool restart state",
);

await replaceOnce(
  "owner-signal-lab-v3.html",
  `    <link rel="stylesheet" href="./owner-signal-lab-v3.css?v=signal-lab-v3-evidence-replay-v1" />`,
  `    <link rel="stylesheet" href="./owner-signal-lab-v3.css?v=signal-lab-v3-evidence-replay-v1" />
    <link rel="stylesheet" href="./owner-signal-lab-v3-evidence.css?v=signal-lab-v3-evidence-replay-v1" />`,
  "owner evidence stylesheet",
);

await replaceOnce(
  "sw.js",
  `const BUILD = "26-95-stable-network-only-sw-v1";`,
  `const BUILD = "26-96-signal-lab-v3-evidence-replay-v1";`,
  "service worker build",
);

await replaceOnce(
  "sw.js",
  `  "./owner-signal-lab-v2.css?v=26-82-signal-lab-event-driven-collector-v1",
  "./owner-navigation.js?v=owner-signal-lab-v1",`,
  `  "./owner-signal-lab-v2.css?v=26-82-signal-lab-event-driven-collector-v1",
  "./owner-signal-lab-v3.html",
  "./owner-signal-lab-v3.js?v=signal-lab-v3-evidence-replay-v1",
  "./owner-signal-lab-v3.css?v=signal-lab-v3-evidence-replay-v1",
  "./owner-signal-lab-v3-evidence.css?v=signal-lab-v3-evidence-replay-v1",
  "./signal-lab-v3-evidence.js?v=signal-lab-v3-evidence-replay-v1",
  "./signal-lab-v3-explainer.js?v=signal-lab-v3-evidence-replay-v1",
  "./signal-lab-v3-replay-ui.js?v=signal-lab-v3-evidence-replay-v1",
  "./owner-navigation.js?v=owner-signal-lab-v1",`,
  "service worker evidence assets",
);

console.log("Signal Lab V3 evidence replay integration applied");
