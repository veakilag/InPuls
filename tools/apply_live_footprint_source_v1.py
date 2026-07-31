from pathlib import Path

OLD_BUILD = "26-84-readable-flow-smooth-charts-v1"
NEW_BUILD = "26-85-live-footprint-source-v1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, got {count}")
    return text.replace(old, new, 1)


path = Path("orderbook-flow-workspace.js")
source = path.read_text(encoding="utf-8")

source = replace_once(
    source,
    '''export function normalizeFlowTrade(trade) {
  const price = Number(trade?.price);
  const quantity = Number(trade?.quantity);
  const quote = Number(trade?.quote ?? price * quantity);
  const time = Number(trade?.time ?? trade?.tradeTime ?? trade?.eventTime);
  if (![price, quantity, quote, time].every(Number.isFinite) || price <= 0 || quantity <= 0 || quote <= 0) {
    return null;
  }
  return {
    id: trade?.id ?? `${time}:${price}:${quantity}`,
    price,
    quantity,
    quote,
    time,
    side: trade?.side === "sell" ? "sell" : "buy",
  };
}''',
    '''export function normalizeFlowTrade(trade) {
  const price = Number(trade?.price);
  const quantity = Number(trade?.quantity);
  const quote = Number(trade?.quote ?? price * quantity);
  const sourceTime = Number(trade?.tradeTime ?? trade?.eventTime ?? trade?.time);
  const receivedAt = trade?.receivedAt === null || trade?.receivedAt === undefined
    ? Number.NaN
    : Number(trade.receivedAt);
  const time = Number.isFinite(receivedAt) && receivedAt > 0
    ? receivedAt
    : Number(trade?.time ?? sourceTime);
  if (![price, quantity, quote, time].every(Number.isFinite) || price <= 0 || quantity <= 0 || quote <= 0) {
    return null;
  }
  return {
    id: trade?.id ?? `${sourceTime}:${price}:${quantity}`,
    price,
    quantity,
    quote,
    time,
    sourceTime: Number.isFinite(sourceTime) ? sourceTime : time,
    side: trade?.side === "sell" ? "sell" : "buy",
  };
}''',
    "arrival-time footprint normalization",
)

source = replace_once(
    source,
    '''function acceptTape(event) {
  const detail = event?.detail;
  const symbol = String(detail?.symbol ?? "").toUpperCase();
  if (!symbol.endsWith("USDT")) return;
  if (!detail?.replace && !detail?.live) return;
  const incoming = detail?.live && Array.isArray(detail?.trades) ? detail.trades : [];
  const accumulator = footprintBySymbol.get(symbol) ?? createFootprintAccumulator();''',
    '''export function selectFootprintTapeTrades(detail) {
  if (!detail?.live) return [];
  // The guarded aggregation channel is continuous: it starts on @aggTrade,
  // promotes to individual @trade only after validation and falls back without
  // overlaps. Never mix both arrays in one footprint accumulator.
  if (Array.isArray(detail?.aggregationTrades)) return detail.aggregationTrades;
  return Array.isArray(detail?.trades) ? detail.trades : [];
}

function acceptTape(event) {
  const detail = event?.detail;
  const symbol = String(detail?.symbol ?? "").toUpperCase();
  if (!symbol.endsWith("USDT")) return;
  if (!detail?.replace && !detail?.live) return;
  const incoming = selectFootprintTapeTrades(detail);
  const accumulator = footprintBySymbol.get(symbol) ?? createFootprintAccumulator();''',
    "guarded footprint source",
)

path.write_text(source, encoding="utf-8")

# Regression coverage for the live footprint source and clock.
test = Path("test-footprint-live-source-v1.mjs")
test.write_text(r'''import assert from "node:assert/strict";
import test from "node:test";
import {
  createFootprintAccumulator,
  footprintIntervalSnapshot,
  ingestFootprintTrades,
  normalizeFlowTrade,
  selectFootprintTapeTrades,
} from "./orderbook-flow-workspace.js?v=26-85-live-footprint-source-v1";

test("footprint buckets live trades by browser arrival time", () => {
  const normalized = normalizeFlowTrade({
    id: 1,
    price: 100,
    quantity: 2,
    quote: 200,
    time: 1_000,
    tradeTime: 1_000,
    eventTime: 1_010,
    receivedAt: 9_000,
    side: "buy",
  });
  assert.equal(normalized.time, 9_000);
  assert.equal(normalized.sourceTime, 1_000);
});

test("footprint uses the guarded aggregation stream without mixing RAW arrays", () => {
  const stable = [{ id: "stable" }];
  const guarded = [{ id: "guarded" }];
  assert.equal(selectFootprintTapeTrades({ live: true, trades: stable, aggregationTrades: guarded }), guarded);
  assert.deepEqual(selectFootprintTapeTrades({ live: true, trades: stable, aggregationTrades: [] }), []);
  assert.equal(selectFootprintTapeTrades({ live: true, trades: stable }), stable);
  assert.deepEqual(selectFootprintTapeTrades({ live: false, trades: stable, aggregationTrades: guarded }), []);
});

test("current footprint interval accumulates repeated live packets", () => {
  const now = 10_500;
  const accumulator = createFootprintAccumulator();
  ingestFootprintTrades(accumulator, [
    { id: 1, price: 100, quantity: 1, quote: 100, tradeTime: 1_000, receivedAt: 10_100, side: "buy" },
  ]);
  ingestFootprintTrades(accumulator, [
    { id: 2, price: 100, quantity: 2, quote: 200, tradeTime: 1_010, receivedAt: 10_200, side: "sell" },
  ]);
  const snapshot = footprintIntervalSnapshot(accumulator, "1s", now);
  assert.equal(snapshot.count, 2);
  assert.equal(snapshot.quote, 300);
  assert.equal(snapshot.cells[0].buyQuote, 100);
  assert.equal(snapshot.cells[0].sellQuote, 200);
});
''', encoding="utf-8")

# Bump every existing cache/build reference atomically. VERSION.txt keeps its
# v23 label and feature identities; only the Build value is replaced here too.
for candidate in Path(".").rglob("*"):
    if not candidate.is_file():
        continue
    if any(part in {".git", "node_modules"} for part in candidate.parts):
        continue
    if candidate == Path(__file__) or candidate == test:
        continue
    if candidate.suffix.lower() not in {".js", ".mjs", ".html", ".txt", ".json"}:
        continue
    text = candidate.read_text(encoding="utf-8")
    if OLD_BUILD not in text:
        continue
    candidate.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

print(f"Applied {NEW_BUILD}")
