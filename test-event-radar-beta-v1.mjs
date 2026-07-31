import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_RADAR_BETA_VERSION,
  eventRadarDataState,
  eventRadarFeedState,
  eventRadarGroup,
  eventRadarStatus,
  mergeEventRadarEntries,
  summarizeEventRadarFeed,
} from "./event-radar-beta.js";

test("event radar groups current signal types without changing signal formulas", () => {
  assert.equal(EVENT_RADAR_BETA_VERSION, "event-radar-beta-v1");
  assert.equal(eventRadarGroup("impulse"), "movement");
  assert.equal(eventRadarGroup("knife"), "reversal");
  assert.equal(eventRadarGroup("breakout_resistance"), "breakout");
  assert.equal(eventRadarGroup("liquidation_cascade"), "cascade");
  assert.equal(eventRadarGroup("rearranger"), "algorithm");
});

test("event radar remembers first seen time and restarts after a real gap", () => {
  const store = new Map();
  const metric = {
    symbol: "BTCUSDT",
    updatedAt: 10_000,
    lastTradeAt: 10_000,
    change15s: 0.8,
    change1m: 1.2,
    volumeBoost: 3.4,
    score: 82,
    trades: { tps: 42, buyShare: 71 },
    signals: [{ type: "impulse", label: "ИМПУЛЬС", direction: "up", reason: "Тест" }],
  };
  mergeEventRadarEntries(store, [metric], 10_000);
  const first = store.get("BTCUSDT:impulse:up");
  assert.equal(first.firstSeen, 10_000);
  mergeEventRadarEntries(store, [{ ...metric, score: 86 }], 12_000);
  assert.equal(store.get("BTCUSDT:impulse:up").firstSeen, 10_000);
  mergeEventRadarEntries(store, [{ ...metric, score: 75 }], 17_000);
  assert.equal(store.get("BTCUSDT:impulse:up").firstSeen, 17_000);
});

test("event radar reports lifecycle and data quality honestly", () => {
  const entry = {
    firstSeen: 1_000,
    lastSeen: 12_000,
    updatedAt: 12_000,
    lastTradeAt: 12_000,
    score: 80,
    peakScore: 80,
    volumeBoost: 3,
    peakBoost: 3,
  };
  assert.equal(eventRadarStatus(entry, 12_500), "active");
  assert.equal(eventRadarDataState(entry, 12_500), "live");
  assert.equal(eventRadarStatus({ ...entry, score: 62 }, 12_500), "weakening");
  assert.equal(eventRadarStatus(entry, 14_000), "finished");
  assert.equal(eventRadarDataState({ ...entry, updatedAt: 1_000 }, 12_500), "stale");
});


test("event radar distinguishes waiting, warmup, live and stale feed states", () => {
  assert.equal(eventRadarFeedState(null, 10_000), "waiting");
  const warming = summarizeEventRadarFeed([{ symbol: "BTCUSDT", warmupSeconds: 30, signals: [] }], 10_000);
  assert.equal(warming.symbolCount, 1);
  assert.equal(warming.signalCount, 0);
  assert.equal(warming.historyPercent, 10);
  assert.equal(eventRadarFeedState(warming, 10_500), "warming");
  const live = summarizeEventRadarFeed([{ symbol: "BTCUSDT", warmupSeconds: 90, signals: [{ type: "impulse" }] }], 20_000);
  assert.equal(live.signalCount, 1);
  assert.equal(eventRadarFeedState(live, 20_500), "live");
  assert.equal(eventRadarFeedState(live, 26_000), "stale");
});
