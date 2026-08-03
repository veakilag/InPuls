import fs from "node:fs";
import path from "node:path";

const BUILD = "26-101-binance-clock-sync-v1";
const patchPath = "scripts/apply-binance-clock-sync-v1.mjs";

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing preparation anchor: ${label}`);
  return source.replace(before, after);
}

function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(next));
    else result.push(next);
  }
  return result;
}

let patch = fs.readFileSync(patchPath, "utf8");
const oldServiceWorkerBlock = `  let sw = read("sw.js");
  sw = replaceOnce(
    sw,
    'const BUILD = "26-95-stable-network-only-sw-v1";',
    \`const BUILD = "\${BUILD}";\`,
    "service worker build",
  );
  sw = replaceOnce(
    sw,
    \`  "./app.js?v=\${BUILD}",\`,
    \`  "./app.js?v=\${BUILD}",\\n  "./binance-clock-core.js?v=\${BUILD}",\\n  "./binance-clock.js?v=\${BUILD}",\`,
    "service worker Binance clock assets",
  );`;
const newServiceWorkerBlock = `  let sw = read("sw.js");
  sw = replaceOnce(
    sw,
    '  "./app.js?v=26-91-runtime-boot-cache-feed-v1",',
    \`  "./app.js?v=\${BUILD}",\`,
    "service worker app asset",
  );
  sw = replaceOnce(
    sw,
    '  "./orderbook.js?v=26-91-runtime-boot-cache-feed-v1",',
    \`  "./orderbook.js?v=\${BUILD}",\`,
    "service worker orderbook asset",
  );
  sw = replaceOnce(
    sw,
    \`  "./app.js?v=\${BUILD}",\`,
    \`  "./app.js?v=\${BUILD}",\\n  "./binance-clock-core.js?v=\${BUILD}",\\n  "./binance-clock.js?v=\${BUILD}",\`,
    "service worker Binance clock assets",
  );`;
patch = replaceRequired(
  patch,
  oldServiceWorkerBlock,
  newServiceWorkerBlock,
  "Service Worker release block",
);
patch = replaceRequired(
  patch,
  "patchBrowserClock();\npatchApp();",
  "patchApp();",
  "already-normalized Binance clock module",
);
fs.writeFileSync(patchPath, patch);

const testFiles = walk(".").filter((name) => {
  const normalized = name.replaceAll("\\", "/");
  return /(?:^|\/)test[^/]*\.(?:mjs|js)$/.test(normalized)
    || /^test\/.*\.js$/.test(normalized);
});

const replacements = [
  ["26-100-tape-heartbeat-isolation-v1", BUILD],
  ["app.js?v=26-91-runtime-boot-cache-feed-v1", `app.js?v=${BUILD}`],
  ["app\\.js\\?v=26-91-runtime-boot-cache-feed-v1", `app\\.js\\?v=${BUILD}`],
  ["orderbook.js?v=26-91-runtime-boot-cache-feed-v1", `orderbook.js?v=${BUILD}`],
  ["orderbook\\.js\\?v=26-91-runtime-boot-cache-feed-v1", `orderbook\\.js\\?v=${BUILD}`],
  ["orderbook-worker.js?v=26-91-runtime-boot-cache-feed-v1", `orderbook-worker.js?v=${BUILD}`],
  ["orderbook-worker\\.js\\?v=26-91-runtime-boot-cache-feed-v1", `orderbook-worker\\.js\\?v=${BUILD}`],
  ['inpuls-build" content="26-91-runtime-boot-cache-feed-v1', `inpuls-build" content="${BUILD}`],
];

for (const name of testFiles) {
  let source = fs.readFileSync(name, "utf8");
  for (const [before, after] of replacements) source = source.replaceAll(before, after);
  if (name.replaceAll("\\", "/").endsWith("test-orderbook-visual-priority.mjs")) {
    source = source.replace(
      "assert.match(index, /26-91-runtime-boot-cache-feed-v1/);",
      `assert.match(index, /${BUILD}/);`,
    );
  }
  fs.writeFileSync(name, source);
}

console.log(`Prepared Binance clock patch and ${testFiles.length} release tests.`);
