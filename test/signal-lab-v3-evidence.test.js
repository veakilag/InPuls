import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildTraderExplanation } from "../signal-lab-v3-explainer.js";
import {
  normalizeDepthPayload,
  SignalLabV3EvidenceRecorder,
} from "../signal-lab-v3-evidence.js";
import { aggregatePricePoints } from "../signal-lab-v3-replay-ui.js";

function fakeDepthPool(rows = []) {
  return {
    symbols: [],
    setSymbols(symbols) { this.symbols = [...symbols]; },
    snapshots(symbol, since) { return rows.filter((row) => row.symbol === symbol && row.at >= since); },
    latest(symbol) { return [...rows].reverse().find((row) => row.symbol === symbol) ?? null; },
    disconnect() {},
    status() {
      return {
        connection: this.symbols.length ? "live" : "idle",
        trackedSymbols: this.symbols.length,
        packets: rows.length,
        snapshots: rows.length,
      };
    },
  };
}

function episode(now) {
  return {
    id: `BICOUSDT:up_displacement:${now}:1`,
    symbol: "BICOUSDT",
    candidateType: "up_displacement",
    label: "Резкий вынос вверх",
    direction: "up",
    stage: "observed",
    firstSeenAt: now,
    lastSeenAt: now,
    observations: 1,
    peakEvidenceScore: 48,
    reviewState: "unreviewed",
    latest: {
      candidateType: "up_displacement",
      direction: "up",
      observedAt: now,
      price: 0.241,
      evidence: {
        move15sPercent: 0.55,
        range60sPercent: 0.81,
        volumeBoost: 1.9,
      },
      facts: ["движение за 15с +0.55%", "ускорение объёма ×1.9"],
      patternHypotheses: ["sharpening_rejection", "continuation_breakout"],
    },
  };
}

function metrics(now, price = 0.241) {
  return {
    symbol: "BICOUSDT",
    price,
    priceHistory: [
      { at: now - 30_000, price: 0.238 },
      { at: now - 15_000, price: 0.239 },
      { at: now, price },
    ],
    minuteCandles: [
      { time: now - 60_000, open: 0.237, high: 0.239, low: 0.236, close: 0.238 },
      { time: now, open: 0.238, high: price, low: 0.238, close: price },
    ],
    trades: { tps: 4.2, buyShare: 68 },
    volumeBoost: 1.9,
    liquidation: { total: 0 },
  };
}

test("depth20 payload is normalized into compact replay snapshots", () => {
  const row = normalizeDepthPayload({
    stream: "bicousdt@depth20@100ms",
    data: {
      e: "depthUpdate",
      E: 1_000,
      s: "BICOUSDT",
      U: 10,
      u: 12,
      pu: 9,
      b: [["0.240", "1000"], ["0.239", "800"]],
      a: [["0.241", "900"], ["0.242", "700"]],
    },
  }, 1_010);
  assert.equal(row.symbol, "BICOUSDT");
  assert.equal(row.bids.length, 2);
  assert.equal(row.asks[0][0], 0.241);
  assert.equal(row.previousFinalUpdateId, 9);
});

test("evidence recorder attaches chart, book, outcomes and trader explanation", () => {
  const now = 1_800_000;
  const depth = normalizeDepthPayload({
    data: {
      E: now - 2_000,
      s: "BICOUSDT",
      b: [["0.240", "1000"]],
      a: [["0.241", "900"]],
    },
  }, now - 2_000);
  const recorder = new SignalLabV3EvidenceRecorder({ depthPool: fakeDepthPool([depth]) });
  const sourceEpisode = episode(now);
  const first = recorder.ingest({
    metricsRows: [metrics(now)],
    result: { created: [sourceEpisode], updated: [], expired: [] },
    now,
  });
  assert.equal(first.created.length, 1);
  assert.equal(first.created[0].schemaVersion, 2);
  assert.ok(first.created[0].evidencePack.pricePoints.length >= 3);
  assert.equal(first.created[0].evidencePack.bookSnapshots.length, 1);
  assert.equal(first.created[0].evidencePack.traderExplanation.primaryHypothesis, "continuation_breakout");

  const laterEpisode = { ...sourceEpisode, lastSeenAt: now + 16_000, observations: 2 };
  const later = recorder.ingest({
    metricsRows: [metrics(now + 16_000, 0.244)],
    result: { created: [], updated: [laterEpisode], expired: [] },
    now: now + 16_000,
  });
  assert.ok(later.updated[0].evidencePack.outcomes["15000"]);
  assert.ok(later.updated[0].evidencePack.outcomes["15000"].movePercent > 0);
});

test("trader explanation separates hypothesis, confirmation and invalidation", () => {
  const explanation = buildTraderExplanation(episode(1000).latest, {
    coverage: { pricePoints: 30, bookSnapshots: 4 },
  }, 1000);
  assert.equal(explanation.primaryLabel, "Продолжение вверх");
  assert.ok(explanation.reasoning.length > 0);
  assert.ok(explanation.confirmation.length > 0);
  assert.ok(explanation.invalidation.length > 0);
  assert.match(explanation.disclaimer, /не команда на сделку/i);
});

test("replay chart aggregates price points into OHLC candles", () => {
  const rows = aggregatePricePoints([
    { at: 1_000, price: 10 },
    { at: 2_000, price: 12 },
    { at: 4_000, price: 9 },
    { at: 6_000, price: 11 },
  ], 5_000);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { time: 0, open: 10, high: 12, low: 9, close: 9 });
  assert.equal(rows[1].open, 11);
});

test("owner Signal Lab V3 exposes chart, book, replay and explanation controls", async () => {
  const html = await readFile(new URL("../owner-signal-lab-v3.html", import.meta.url), "utf8");
  assert.match(html, /data-field="chart"/);
  assert.match(html, /data-field="book"/);
  assert.match(html, /data-field="replay-slider"/);
  assert.match(html, /Почему я выбрал гипотезу/);
  assert.match(html, /sampled depth20/i);
});

test("evidence store keeps metadata and bounded packs in separate stores", async () => {
  const source = await readFile(new URL("../signal-lab-v3-store.js", import.meta.url), "utf8");
  assert.match(source, /SIGNAL_LAB_V3_STORE_VERSION = 2/);
  assert.match(source, /const EVIDENCE = "evidence"/);
  assert.match(source, /MAX_EVIDENCE_PACKS = 500/);
  assert.match(source, /delete normalized\.evidencePack/);
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
  assert.match(source, /merged\.slice\(0, 60\)/);
});

test("legacy episodes show an explicit no-evidence state", async () => {
  const source = await readFile(new URL("../signal-lab-v3-replay-ui.js", import.meta.url), "utf8");
  assert.match(source, /Эпизод собран до V3\.1/);
  assert.match(source, /Стакан задним числом восстановить нельзя/);
  assert.match(source, /historical price points|исторических price points/i);
});
