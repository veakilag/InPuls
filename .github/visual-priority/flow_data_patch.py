from pathlib import Path
import re

path = Path("orderbook-flow-workspace.js")
source = path.read_text(encoding="utf-8")

def sub_once(pattern, replacement, label):
    global source
    source, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"Expected one {label}, got {count}")

sub_once(
    r'''export function footprintTone\(cell\) \{
  const buy = Math\.max\(0, Number\(cell\?\.buyQuote\) \|\| 0\);
  const sell = Math\.max\(0, Number\(cell\?\.sellQuote\) \|\| 0\);
  const total = Math\.max\(1, buy \+ sell\);
  return clamp\(\(buy - sell\) / total, -1, 1\);
\}''',
    '''export function footprintTone(cell) {
  const buy = Math.max(0, Number(cell?.buyQuote) || 0);
  const sell = Math.max(0, Number(cell?.sellQuote) || 0);
  const total = Math.max(1, buy + sell);
  return clamp((buy - sell) / total, -1, 1);
}

export function footprintCellIntensity(value, maximum) {
  const amount = Math.max(0, Number(value) || 0);
  const peak = Math.max(1, Number(maximum) || 1);
  return clamp(Math.sqrt(amount / peak), 0, 1);
}''',
    "footprint intensity helper",
)
sub_once(
    r'''  const bucket = accumulator\.minutes\.get\(startTime\) \?\? \{
    startTime,
    endTime: startTime \+ FOOTPRINT_MINUTE_MS,
    count: 0,
    quote: 0,
    cells: new Map\(\),
  \};''',
    '''  const bucket = accumulator.minutes.get(startTime) ?? {
    startTime,
    endTime: startTime + FOOTPRINT_MINUTE_MS,
    count: 0,
    quote: 0,
    firstTradeTime: Infinity,
    lastTradeTime: -Infinity,
    openPrice: null,
    closePrice: null,
    highPrice: null,
    lowPrice: null,
    cells: new Map(),
  };''',
    "minute OHLC fields",
)
sub_once(
    r'''    bucket\.cells\.set\(priceKey, cell\);
    bucket\.quote \+= trade\.quote;
    bucket\.count \+= 1;''',
    '''    bucket.cells.set(priceKey, cell);
    bucket.quote += trade.quote;
    bucket.count += 1;
    if (trade.time < bucket.firstTradeTime) {
      bucket.firstTradeTime = trade.time;
      bucket.openPrice = trade.price;
    }
    if (trade.time >= bucket.lastTradeTime) {
      bucket.lastTradeTime = trade.time;
      bucket.closePrice = trade.price;
    }
    bucket.highPrice = bucket.highPrice === null
      ? trade.price
      : Math.max(bucket.highPrice, trade.price);
    bucket.lowPrice = bucket.lowPrice === null
      ? trade.price
      : Math.min(bucket.lowPrice, trade.price);''',
    "minute OHLC ingest",
)
sub_once(
    r'''  const cells = new Map\(\);
  let count = 0;
  let quote = 0;

  for \(const bucket of accumulator\?\.minutes\?\.values\?\.\(\) \?\? \[\]\) \{''',
    '''  const cells = new Map();
  let count = 0;
  let quote = 0;
  let firstTradeTime = Infinity;
  let lastTradeTime = -Infinity;
  let openPrice = null;
  let closePrice = null;
  let highPrice = null;
  let lowPrice = null;

  for (const bucket of accumulator?.minutes?.values?.() ?? []) {''',
    "snapshot OHLC variables",
)
sub_once(
    r'''    count \+= bucket\.count;
    quote \+= bucket\.quote;
    for \(const source of bucket\.cells\.values\(\)\) \{''',
    '''    count += bucket.count;
    quote += bucket.quote;
    if (Number.isFinite(bucket.firstTradeTime) && bucket.firstTradeTime < firstTradeTime) {
      firstTradeTime = bucket.firstTradeTime;
      openPrice = bucket.openPrice;
    }
    if (Number.isFinite(bucket.lastTradeTime) && bucket.lastTradeTime >= lastTradeTime) {
      lastTradeTime = bucket.lastTradeTime;
      closePrice = bucket.closePrice;
    }
    if (Number.isFinite(bucket.highPrice)) {
      highPrice = highPrice === null ? bucket.highPrice : Math.max(highPrice, bucket.highPrice);
    }
    if (Number.isFinite(bucket.lowPrice)) {
      lowPrice = lowPrice === null ? bucket.lowPrice : Math.min(lowPrice, bucket.lowPrice);
    }
    for (const source of bucket.cells.values()) {''',
    "snapshot OHLC merge",
)
sub_once(
    r'''    partial: Number\(now\) < endTime,
    count,
    quote,
    cells: \[\.\.\.cells\.values\(\)\]\.sort\(\(left, right\) => right\.price - left\.price\),''',
    '''    partial: Number(now) < endTime,
    count,
    quote,
    openPrice,
    closePrice,
    highPrice,
    lowPrice,
    cells: [...cells.values()].sort((left, right) => right.price - left.price),''',
    "snapshot OHLC return",
)

path.write_text(source, encoding="utf-8")
