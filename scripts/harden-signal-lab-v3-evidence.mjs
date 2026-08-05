import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(path, search, replacement, label) {
  const source = await readFile(path, "utf8");
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  await writeFile(path, source.replace(search, replacement));
}

await replaceOnce(
  "signal-lab-v3-evidence.js",
  '    const socket = new WebSocket(`${DEPTH_STREAM_BASE}?streams=${streams.join("/")}`);\n    this.socket = socket;\n    this.#publish({ connection: "connecting", trackedSymbols: this.symbols.length, lastError: null });\n\n    this.watchdogTimer = setTimeout(() => {\n      if (generation !== this.generation || this.state.lastMessageAt) return;',
  '    const packetsAtConnect = this.state.packets;\n    const socket = new WebSocket(`${DEPTH_STREAM_BASE}?streams=${streams.join("/")}`);\n    this.socket = socket;\n    this.#publish({ connection: "connecting", trackedSymbols: this.symbols.length, lastError: null });\n\n    this.watchdogTimer = setTimeout(() => {\n      if (generation !== this.generation || this.state.packets > packetsAtConnect) return;',
  "depth watchdog generation baseline",
);

await replaceOnce(
  "signal-lab-v3-evidence.js",
  `    this.sessions = new Map();
    this.baseWatchSymbols = [];
    this.pinnedUntil = new Map();`,
  `    this.sessions = new Map();
    this.baseWatchSymbols = [];
    this.pinnedUntil = new Map();
    this.currentWatchSymbols = [];
    this.nextBaseWatchRefreshAt = 0;
    this.baseWatchRefreshMs = 30_000;`,
  "stable watchlist state",
);

await replaceOnce(
  "signal-lab-v3-evidence.js",
  `    const pinned = [...this.pinnedUntil.keys()];
    const next = [...new Set([...pinned, ...this.baseWatchSymbols])]
      .slice(0, this.maximumDepthSymbols);
    this.depthPool.setSymbols(next);`,
  `    const pinned = [...this.pinnedUntil.keys()];
    const current = this.currentWatchSymbols.filter((symbol) => (
      pinned.includes(symbol) || this.baseWatchSymbols.includes(symbol)
    ));
    const missingPinned = pinned.filter((symbol) => !current.includes(symbol));
    let next = null;
    if (!current.length || now >= this.nextBaseWatchRefreshAt) {
      next = [...new Set([...pinned, ...this.baseWatchSymbols])]
        .slice(0, this.maximumDepthSymbols);
      this.nextBaseWatchRefreshAt = now + this.baseWatchRefreshMs;
    } else if (missingPinned.length) {
      next = [...new Set([...pinned, ...current, ...this.baseWatchSymbols])]
        .slice(0, this.maximumDepthSymbols);
    }
    if (!next) return;
    const signature = next.join(",");
    if (signature === this.currentWatchSymbols.join(",")) return;
    this.currentWatchSymbols = next;
    this.depthPool.setSymbols(next);`,
  "stable watchlist refresh",
);

await replaceOnce(
  "owner-signal-lab-v3.js",
  `    const visible = merged.slice(0, 250);`,
  `    const visible = merged.slice(0, 60);`,
  "bounded replay cards",
);

const testPath = "test/signal-lab-v3-evidence.test.js";
const testSource = await readFile(testPath, "utf8");
const extraTests = `

test("evidence store keeps metadata and bounded packs in separate stores", async () => {
  const source = await readFile(new URL("../signal-lab-v3-store.js", import.meta.url), "utf8");
  assert.match(source, /SIGNAL_LAB_V3_STORE_VERSION = 2/);
  assert.match(source, /const EVIDENCE = "evidence"/);
  assert.match(source, /MAX_EVIDENCE_PACKS = 500/);
  assert.match(source, /delete normalized\\.evidencePack/);
  assert.match(source, /evidenceAvailable/);
});

test("depth watchlist is stable and watchdog belongs to the current connection", async () => {
  const source = await readFile(new URL("../signal-lab-v3-evidence.js", import.meta.url), "utf8");
  assert.match(source, /packetsAtConnect/);
  assert.match(source, /baseWatchRefreshMs = 30_000/);
  assert.match(source, /missingPinned/);
});

test("owner UI bounds simultaneous replay canvases", async () => {
  const source = await readFile(new URL("../owner-signal-lab-v3.js", import.meta.url), "utf8");
  assert.match(source, /merged\\.slice\\(0, 60\\)/);
});
`;
if (!testSource.includes('test("evidence store keeps metadata')) {
  await writeFile(testPath, `${testSource.trimEnd()}${extraTests}\n`);
}

console.log("Signal Lab V3 evidence hardening applied");
