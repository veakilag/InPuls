from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, got {count}")
    return text.replace(old, new, 1)


app_path = Path("app.js")
app = app_path.read_text(encoding="utf-8")
app = replace_once(
    app,
    '''      if (hasMarketTicker) {
        collectSignalMemoryFromFeed(Date.now());
        scheduleRender();
      }
      return;''',
    '''      if (hasMarketTicker) collectSignalMemoryFromFeed(Date.now());
      if (hasMarketTicker) scheduleRender();
      return;''',
    "event-driven Signal Lab collector",
)
app_path.write_text(app, encoding="utf-8")

orderbook_path = Path("orderbook.js")
orderbook = orderbook_path.read_text(encoding="utf-8")
orderbook = replace_once(
    orderbook,
    '''  const sourceTime = Number(trade?.tradeTime ?? trade?.time);
  const tradeTime = Number(trade?.tradeTime ?? sourceTime);
  const eventTime = Number(trade?.eventTime ?? sourceTime);''',
    '''  const time = Number(trade?.tradeTime ?? trade?.time);
  const tradeTime = Number(trade?.tradeTime ?? time);
  const eventTime = Number(trade?.eventTime ?? time);''',
    "source timing aliases",
)
orderbook = replace_once(
    orderbook,
    '''  const visualTime = resolveTapeVisualTime(sourceTime, receivedAt);
  const rxLatencyMs = Number(trade?.rxLatencyMs);
  if (![price, quantity, quote, sourceTime, visualTime].every(Number.isFinite) || quote <= 0) return null;
  return {
    id: trade?.id ?? `${sourceTime}-${price}-${quantity}`,''',
    '''  const visualTime = resolveTapeVisualTime(time, receivedAt);
  const rxLatencyMs = Number(trade?.rxLatencyMs);
  if (![price, quantity, quote, time, visualTime].every(Number.isFinite) || quote <= 0) return null;
  return {
    id: trade?.id ?? `${time}-${price}-${quantity}`,''',
    "visual timing source",
)
orderbook = replace_once(
    orderbook,
    '''    tradeTime: Number.isFinite(tradeTime) ? tradeTime : sourceTime,
    eventTime: Number.isFinite(eventTime) ? eventTime : sourceTime,''',
    '''    tradeTime: Number.isFinite(tradeTime) ? tradeTime : time,
    eventTime: Number.isFinite(eventTime) ? eventTime : time,''',
    "timing field preservation",
)
orderbook_path.write_text(orderbook, encoding="utf-8")
