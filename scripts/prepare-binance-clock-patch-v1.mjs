import fs from "node:fs";

const path = "scripts/apply-binance-clock-sync-v1.mjs";
let source = fs.readFileSync(path, "utf8");
const anchor = `  let sw = read("sw.js");
  sw = replaceOnce(
    sw,
    'const BUILD = "26-95-stable-network-only-sw-v1";',`;
const replacement = `  let sw = read("sw.js");
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
    'const BUILD = "26-95-stable-network-only-sw-v1";',`;
if (!source.includes(anchor)) throw new Error("Service Worker patch anchor not found");
source = source.replace(anchor, replacement);
fs.writeFileSync(path, source);
