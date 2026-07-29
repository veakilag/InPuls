import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildInPulsNavigationUrl,
  parseInPulsNavigation,
} from "../owner-navigation.js";

test("owner dashboard creates a safe same-origin InPuls orderbook link", () => {
  const url = new URL(buildInPulsNavigationUrl(
    "https://veakilag.github.io/InPuls/owner-signal-lab.html",
    { symbol: "ethusdt" },
  ));
  assert.equal(url.origin, "https://veakilag.github.io");
  assert.equal(url.pathname, "/InPuls/");
  assert.equal(url.searchParams.get("symbol"), "ETHUSDT");
  assert.equal(url.searchParams.get("open"), "orderbook");
  assert.equal(url.searchParams.get("source"), "signal-lab");
});

test("owner navigation rejects invalid symbols and unknown actions", () => {
  assert.equal(buildInPulsNavigationUrl("https://example.com/InPuls/", {
    symbol: "BTC/USDT",
  }), null);
  assert.deepEqual(
    parseInPulsNavigation("?symbol=%3Cscript%3E&open=orderbook&source=signal-lab"),
    { symbol: null, open: "orderbook", source: "signal-lab" },
  );
  assert.deepEqual(
    parseInPulsNavigation("?symbol=solusdt&open=chart&source=other"),
    { symbol: "SOLUSDT", open: null, source: null },
  );
});

test("owner dashboard stays unlinked, local-only and exposes no destructive history controls", async () => {
  const [html, guard, script, app, worker] = await Promise.all([
    readFile(new URL("../owner-signal-lab.html", import.meta.url), "utf8"),
    readFile(new URL("../owner-signal-lab-guard.js", import.meta.url), "utf8"),
    readFile(new URL("../owner-signal-lab.js", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(html, /script-src 'self'/);
  assert.match(script, /SignalLabLocalStore/);
  assert.match(script, /buildInPulsNavigationUrl/);
  assert.doesNotMatch(script, /^import\s/m);
  assert.match(script, /signal-lab-module-timeout/);
  assert.match(script, /signal-lab-storage-timeout/);
  assert.match(script, /serviceWorker\.register/);
  assert.match(script, /Нажми «Повторить»/);
  assert.match(html, /owner-signal-lab-guard\.js/);
  assert.match(guard, /owner-signal-lab-module-did-not-settle/);
  assert.match(guard, /Локальная история останется на устройстве/);
  assert.doesNotMatch(script, /\.(?:clear|delete)\(/);
  assert.doesNotMatch(app, /href=["']\.\/owner-signal-lab\.html/);
  assert.match(app, /parseInPulsNavigation/);
  assert.match(app, /openOrderBookForSymbol/);
  assert.match(worker, /owner-signal-lab\.html/);
  assert.match(worker, /owner-signal-lab-guard\.js\?v=26-64-signal-lab-without-impulse-v1/);
  assert.match(worker, /owner-signal-lab\.js\?v=26-64-signal-lab-without-impulse-v1/);
});
