from pathlib import Path

OLD_BUILD = "26-82-smooth-live-clock-series-v1"
NEW_BUILD = "26-83-arrival-clock-render-decouple-v1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, got {count}")
    return text.replace(old, new, 1)


# Atomic runtime/cache build bump. Do not rewrite this migration or workflow
# scaffolding while it is executing.
for path in Path(".").rglob("*"):
    if not path.is_file():
        continue
    if any(part in {".git", "tools", ".github", "node_modules"} for part in path.parts):
        continue
    if path.suffix.lower() not in {".js", ".mjs", ".html", ".txt"}:
        continue
    text = path.read_text(encoding="utf-8")
    if OLD_BUILD in text:
        path.write_text(text.replace(OLD_BUILD, NEW_BUILD), encoding="utf-8")

# ---------------------------------------------------------------------------
# Main app: stop rebuilding the complete market UI from high-rate book/trade
# streams and remove the redundant one-second full render heartbeat.
# ---------------------------------------------------------------------------
app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")

old_array_tail = '''      if (hasMarketTicker) collectSignalMemoryFromFeed(Date.now());
      scheduleRender();
      return;'''
new_array_tail = '''      if (hasMarketTicker) {
        collectSignalMemoryFromFeed(Date.now());
        scheduleRender();
      }
      return;'''
app = replace_once(app, old_array_tail, new_array_tail, "market ticker render routing")

old_book_block = '''    if (data.e === "bookTicker" && isUsdtPerpetualSymbol(data.s)) {
      marketSizeScanner.ingestBookTicker(data);
      if (this.trackedAggTrades.has(data.s)) {
        getSymbol(data.s, Number(data.E) || Date.now())?.updateBookTicker(data);
      }
      scheduleRender();
      return;
    }'''
new_book_block = '''    if (data.e === "bookTicker" && isUsdtPerpetualSymbol(data.s)) {
      marketSizeScanner.ingestBookTicker(data);
      if (this.trackedAggTrades.has(data.s)) {
        getSymbol(data.s, Number(data.E) || Date.now())?.updateBookTicker(data);
      }
      // bookTicker can arrive many times per second across the market. It updates
      // state immediately, but the next miniTicker frame owns the expensive DOM
      // refresh. Order-book/Tape rendering has its own event-driven scheduler.
      return;
    }'''
app = replace_once(app, old_book_block, new_book_block, "bookTicker render routing")

old_trade_block = '''    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data) && this.trackedAggTrades.has(data.s)) {
      getSymbol(data.s)?.updateTrade(data);
      scheduleRender();
      return;
    }'''
new_trade_block = '''    if (data.e === "aggTrade" && filterUsdtPerpetualTicker(data) && this.trackedAggTrades.has(data.s)) {
      getSymbol(data.s)?.updateTrade(data);
      // Trade statistics remain live in SymbolState. The market table consumes
      // them on the next miniTicker frame instead of rebuilding the whole app for
      // every execution. The dedicated Tape stream is not delayed by this path.
      return;
    }'''
app = replace_once(app, old_trade_block, new_trade_block, "aggTrade render routing")

old_scheduler = '''let scheduledMarketRender = null;
function scheduleRender() {
  if (scheduledMarketRender !== null) return;
  scheduledMarketRender = setTimeout(() => {
    scheduledMarketRender = null;
    render();
  }, 180);
}'''
new_scheduler = '''let scheduledMarketRender = null;
function scheduleRender() {
  if (scheduledMarketRender !== null) return;
  const run = () => {
    scheduledMarketRender = null;
    render();
  };
  // The radar is a secondary workload while the Tape paints at animation-frame
  // cadence. Run the full market DOM refresh in browser idle time, with a bounded
  // fallback so values still update promptly on busy pages.
  if (typeof window.requestIdleCallback === "function") {
    scheduledMarketRender = window.requestIdleCallback(run, { timeout: 450 });
  } else {
    scheduledMarketRender = setTimeout(run, 180);
  }
}'''
app = replace_once(app, old_scheduler, new_scheduler, "idle market render scheduler")

app = replace_once(
    app,
    '''setInterval(render, 1000);
setInterval(updateTrackedSymbols, 15_000);''',
    '''// Rendering is driven by market packets and explicit UI actions. A fixed
// one-second full-app render caused a visible main-thread stall in the Tape.
setInterval(updateTrackedSymbols, 15_000);''',
    "remove global render heartbeat",
)

app_path.write_text(app, encoding="utf-8")

# ---------------------------------------------------------------------------
# Tape: preserve exchange clocks for facts/aggregation, but use packet arrival
# time for the visual X axis so a newly received execution enters at LIVE.
# ---------------------------------------------------------------------------
orderbook_path = Path("orderbook.js")
orderbook = orderbook_path.read_text(encoding="utf-8")

normalize_start = orderbook.index("function normalizeTapeTrade(")
normalize_end = orderbook.index("\nfunction tapeTradeKey", normalize_start)
new_normalize = '''export function resolveTapeVisualTime(sourceTime, receivedAt) {
  const source = Number(sourceTime);
  const received = receivedAt === null || receivedAt === undefined
    ? Number.NaN
    : Number(receivedAt);
  return Number.isFinite(received) && received > 0 ? received : source;
}

function normalizeTapeTrade(trade) {
  const price = Number(trade?.price);
  const quantity = Number(trade?.quantity);
  const quote = Number(trade?.quote);
  const sourceTime = Number(trade?.tradeTime ?? trade?.time);
  const eventTime = Number(trade?.eventTime ?? sourceTime);
  const receivedAt = trade?.receivedAt === null || trade?.receivedAt === undefined
    ? null
    : Number(trade.receivedAt);
  const visualTime = resolveTapeVisualTime(sourceTime, receivedAt);
  const rxLatencyMs = Number(trade?.rxLatencyMs);
  if (![price, quantity, quote, sourceTime, eventTime, visualTime].every(Number.isFinite) || quote <= 0) return null;
  return {
    id: trade?.id ?? `${sourceTime}-${price}-${quantity}`,
    firstTradeId: Number.isInteger(Number(trade?.firstTradeId)) ? Number(trade.firstTradeId) : null,
    lastTradeId: Number.isInteger(Number(trade?.lastTradeId)) ? Number(trade.lastTradeId) : null,
    source: trade?.source === "raw" ? "raw" : "agg",
    price,
    quantity,
    quote,
    // Visual arrival clock. A packet received now must enter at the LIVE edge.
    time: visualTime,
    // Source clocks remain immutable facts for diagnostics, Replay and formulas.
    tradeTime: sourceTime,
    eventTime,
    receivedAt: Number.isFinite(receivedAt) ? receivedAt : null,
    rxLatencyMs: Number.isFinite(rxLatencyMs) ? rxLatencyMs : null,
    side: trade?.side === "sell" ? "sell" : "buy",
  };
}
'''
orderbook = orderbook[:normalize_start] + new_normalize + orderbook[normalize_end:]

agg_start = orderbook.index("export function aggregateTapeZeroMs(")
agg_end = orderbook.index("\nexport function materializeZeroMsAggregates", agg_start)
new_agg = '''export function aggregateTapeZeroMs(trades) {
  const ordered = [...(trades ?? [])]
    .filter((trade) => {
      const visualTime = Number(trade?.time);
      const eventTime = Number(trade?.eventTime ?? trade?.tradeTime ?? trade?.time);
      const price = Number(trade?.price);
      const quote = Number(trade?.quote);
      return [visualTime, eventTime, price, quote].every(Number.isFinite) && quote > 0;
    })
    .sort((left, right) => {
      const sourceTimeDelta = Number(left.eventTime ?? left.tradeTime ?? left.time)
        - Number(right.eventTime ?? right.tradeTime ?? right.time);
      if (sourceTimeDelta) return sourceTimeDelta;
      const leftId = Number(left.id);
      const rightId = Number(right.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
        return leftId - rightId;
      }
      return String(left.id).localeCompare(String(right.id));
    });

  const groups = [];
  const ordinalByTime = new Map();
  let current = null;
  const finish = () => {
    if (!current) return;
    const timeOrdinal = ordinalByTime.get(current.eventTime) ?? 0;
    current.timeOrdinal = timeOrdinal;
    ordinalByTime.set(current.eventTime, timeOrdinal + 1);
    current.vwapPrice = current.quantity > 0
      ? current.quote / current.quantity
      : current.firstPrice;
    // The marker stays at the first received X coordinate while OPEN. Exchange
    // eventTime is retained separately and never rewritten as arrival time.
    current.price = current.firstPrice;
    current.bucketStart = current.eventTime;
    current.bucketEnd = current.eventTime;
    current.bucketMs = TAPE_AGGREGATION_PERIOD_MS;
    groups.push(current);
    current = null;
  };

  for (const trade of ordered) {
    const eventTime = Number(trade.eventTime ?? trade.tradeTime ?? trade.time);
    const visualTime = Number(trade.time);
    const side = trade.side === "sell" ? "sell" : "buy";
    const price = Number(trade.price);
    const quote = Number(trade.quote);
    const quantity = Number.isFinite(Number(trade.quantity)) && Number(trade.quantity) > 0
      ? Number(trade.quantity)
      : quote / price;
    const rawFirstId = trade.firstTradeId ?? trade.id;
    const rawLastId = trade.lastTradeId ?? trade.id;
    const firstTradeId = Number.isInteger(Number(rawFirstId)) ? Number(rawFirstId) : null;
    const lastTradeId = Number.isInteger(Number(rawLastId)) ? Number(rawLastId) : firstTradeId;
    const continues = current
      && current.eventTime === eventTime
      && current.side === side;

    if (!continues) {
      finish();
      current = {
        key: `agg0:${eventTime}:${side}:${tapeTradeKey(trade)}`,
        time: visualTime,
        lastTime: visualTime,
        eventTime,
        side,
        firstTradeId,
        lastTradeId,
        firstPrice: price,
        lastPrice: price,
        minPrice: price,
        maxPrice: price,
        price,
        vwapPrice: price,
        quantity: 0,
        quote: 0,
        buyQuote: 0,
        sellQuote: 0,
        count: 0,
      };
    }

    current.lastTime = Math.max(current.lastTime, visualTime);
    current.lastPrice = price;
    if (Number.isInteger(lastTradeId)) current.lastTradeId = lastTradeId;
    current.minPrice = Math.min(current.minPrice, price);
    current.maxPrice = Math.max(current.maxPrice, price);
    current.quantity += quantity;
    current.quote += quote;
    current[side === "sell" ? "sellQuote" : "buyQuote"] += quote;
    current.count += 1;
  }
  finish();
  return groups;
}
'''
orderbook = orderbook[:agg_start] + new_agg + orderbook[agg_end:]

sweep_start = orderbook.index("export function aggregateTapeSweeps(")
sweep_end = orderbook.index("\nexport function materializeTapeSweeps", sweep_start)
new_sweep = '''export function aggregateTapeSweeps(
  groups,
  {
    maxGapMs = TAPE_SWEEP_MAX_GAP_MS,
    maxReverseTicks = TAPE_SWEEP_MAX_REVERSE_TICKS,
    tick = null,
  } = {},
) {
  const ordered = [...(groups ?? [])]
    .filter((group) => Number.isFinite(Number(group?.eventTime ?? group?.time)))
    .sort((left, right) => {
      const timeDelta = Number(left.eventTime ?? left.time) - Number(right.eventTime ?? right.time);
      if (timeDelta) return timeDelta;
      return Number(left.timeOrdinal) - Number(right.timeOrdinal);
    });
  const priceTick = Math.max(Number.EPSILON, Number(tick) || inferSweepTick(ordered) || Number.EPSILON);
  const allowedReverse = priceTick * Math.max(0, Number(maxReverseTicks) || 0) + Number.EPSILON;
  const groupsOut = [];
  const ordinalByTime = new Map();
  let current = null;

  const finish = () => {
    if (!current) return;
    current.vwapPrice = current.quantity > 0 ? current.quote / current.quantity : current.firstPrice;
    current.durationMs = Math.max(0, current.lastTime - current.firstTime);
    current.time = current.firstTime + current.durationMs / 2;
    const sourceDuration = Math.max(0, current.lastEventTime - current.firstEventTime);
    current.eventTime = current.firstEventTime + sourceDuration / 2;
    current.labelPrice = (current.firstPrice + current.lastPrice) / 2;
    current.price = current.labelPrice;
    current.kind = "sweep";
    const ordinalKey = Math.round(current.time);
    current.timeOrdinal = ordinalByTime.get(ordinalKey) ?? 0;
    ordinalByTime.set(ordinalKey, current.timeOrdinal + 1);
    if (current.aggregateCount >= TAPE_SWEEP_MIN_AGGREGATES) groupsOut.push(current);
    current = null;
  };

  for (const group of ordered) {
    const eventTime = Number(group.eventTime ?? group.time);
    const visualTime = Number(group.time ?? eventTime);
    const visualLastTime = Number(group.lastTime ?? visualTime);
    const side = group.side === "sell" ? "sell" : "buy";
    const firstPrice = Number(group.firstPrice ?? group.price);
    const lastPrice = Number(group.lastPrice ?? group.price);
    const firstId = Number.isInteger(Number(group.firstTradeId)) ? Number(group.firstTradeId) : null;
    const lastId = Number.isInteger(Number(group.lastTradeId)) ? Number(group.lastTradeId) : firstId;
    const gap = current ? eventTime - current.lastEventTime : Infinity;
    const idsContinuous = !current
      || !Number.isInteger(current.lastTradeId)
      || !Number.isInteger(firstId)
      || firstId === current.lastTradeId + 1;
    const directionContinuous = !current || (side === "buy"
      ? firstPrice >= current.lastPrice - allowedReverse
      : firstPrice <= current.lastPrice + allowedReverse);
    const continues = current
      && current.side === side
      && gap >= 0
      && gap <= Math.max(0, Number(maxGapMs) || 0)
      && idsContinuous
      && directionContinuous;

    if (!continues) {
      finish();
      current = {
        key: `sweep:${eventTime}:${side}:${group.key}`,
        side,
        firstTime: visualTime,
        lastTime: visualLastTime,
        firstEventTime: eventTime,
        lastEventTime: Number(group.eventTime ?? eventTime),
        firstTradeId: firstId,
        lastTradeId: lastId,
        firstPrice,
        lastPrice,
        minPrice: Number(group.minPrice ?? firstPrice),
        maxPrice: Number(group.maxPrice ?? firstPrice),
        price: firstPrice,
        vwapPrice: firstPrice,
        quantity: 0,
        quote: 0,
        buyQuote: 0,
        sellQuote: 0,
        count: 0,
        aggregateCount: 0,
      };
    }

    current.lastTime = Math.max(current.lastTime, visualLastTime);
    current.lastEventTime = eventTime;
    current.lastPrice = lastPrice;
    if (Number.isInteger(lastId)) current.lastTradeId = lastId;
    current.minPrice = Math.min(current.minPrice, Number(group.minPrice ?? firstPrice));
    current.maxPrice = Math.max(current.maxPrice, Number(group.maxPrice ?? firstPrice));
    current.quantity += Number(group.quantity) || 0;
    current.quote += Number(group.quote) || 0;
    current.buyQuote += Number(group.buyQuote) || 0;
    current.sellQuote += Number(group.sellQuote) || 0;
    current.count += Number(group.count) || 0;
    current.aggregateCount += 1;
  }
  finish();
  return groupsOut;
}
'''
orderbook = orderbook[:sweep_start] + new_sweep + orderbook[sweep_end:]

orderbook_path.write_text(orderbook, encoding="utf-8")

# Focused regression contract.
test_path = Path("test-arrival-clock-render-decouple-v1.mjs")
test_path.write_text(f'''import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {{
  aggregateTapeSweeps,
  aggregateTapeZeroMs,
  resolveTapeVisualTime,
}} from "./orderbook.js?v={NEW_BUILD}";

const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
const orderbook = fs.readFileSync(new URL("./orderbook.js", import.meta.url), "utf8");

test("newly received trades use arrival time for visual X without rewriting source clocks", () => {{
  assert.equal(resolveTapeVisualTime(1_000, 9_000), 9_000);
  assert.equal(resolveTapeVisualTime(1_000, null), 1_000);
  const groups = aggregateTapeZeroMs([
    {{ id: 1, firstTradeId: 1, lastTradeId: 1, price: 100, quantity: 1, quote: 100, side: "buy", time: 9_000, tradeTime: 1_000, eventTime: 1_000 }},
    {{ id: 2, firstTradeId: 2, lastTradeId: 2, price: 101, quantity: 1, quote: 101, side: "buy", time: 9_001, tradeTime: 1_000, eventTime: 1_000 }},
    {{ id: 3, firstTradeId: 3, lastTradeId: 3, price: 102, quantity: 1, quote: 102, side: "buy", time: 9_020, tradeTime: 1_020, eventTime: 1_020 }},
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].eventTime, 1_000);
  assert.equal(groups[0].time, 9_000);
  assert.equal(groups[0].lastTime, 9_001);
  const sweeps = aggregateTapeSweeps(groups, {{ maxGapMs: 35, tick: 1 }});
  assert.equal(sweeps.length, 1);
  assert.equal(sweeps[0].eventTime, 1_010);
  assert.ok(sweeps[0].time >= 9_000 && sweeps[0].time <= 9_020);
}});

test("high-rate market streams do not trigger full-app DOM renders", () => {{
  assert.doesNotMatch(app, /setInterval\\(render,\\s*1_?000\\)/);
  assert.match(app, /requestIdleCallback\\(run, \\{{ timeout: 450 \\}}\\)/);
  const bookBlock = app.match(/if \\(data\\.e === "bookTicker"[\\s\\S]*?return;\\n    \\}}/)?.[0] ?? "";
  const tradeBlock = app.match(/if \\(data\\.e === "aggTrade"[\\s\\S]*?return;\\n    \\}}/)?.[0] ?? "";
  assert.ok(bookBlock.length > 0);
  assert.ok(tradeBlock.length > 0);
  assert.doesNotMatch(bookBlock, /scheduleRender\\(/);
  assert.doesNotMatch(tradeBlock, /scheduleRender\\(/);
  assert.match(app, /if \\(hasMarketTicker\\) \\{{[\\s\\S]*collectSignalMemoryFromFeed[\\s\\S]*scheduleRender\\(\\);[\\s\\S]*\\}}/);
}});

test("runtime carries separate arrival and exchange clocks", () => {{
  assert.match(orderbook, /time: visualTime/);
  assert.match(orderbook, /tradeTime: sourceTime/);
  assert.match(orderbook, /eventTime,/);
  assert.match(orderbook, /const eventTime = Number\\(trade\\.eventTime \\?\\? trade\\.tradeTime \\?\\? trade\\.time\\)/);
}});
''', encoding="utf-8")

print(f"Applied {NEW_BUILD}")
