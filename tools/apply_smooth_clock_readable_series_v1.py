from pathlib import Path

OLD_BUILD = "26-81-compact-series-trade-edge-v1"
NEW_BUILD = "26-82-smooth-live-clock-series-v1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, got {count}")
    return text.replace(old, new, 1)


# Bump the runtime/cache build everywhere it is referenced, but never rewrite
# this migration or workflow scaffolding while it is executing.
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

path = Path("orderbook.js")
text = path.read_text(encoding="utf-8")

text = replace_once(
    text,
    "const TAPE_STATE_REFRESH_MS = 1_000;",
    "const TAPE_STATUS_IDLE_REFRESH_MS = 5_000;",
    "status refresh constant",
)
text = replace_once(
    text,
    "export const TAPE_LIVE_EDGE_MAX_LEAD_MS = 1_200;\nexport const TAPE_SWEEP_MIN_AGGREGATES = 2;\nconst TAPE_SWEEP_MAX_DIRECTION_SPAN_PX = 34;",
    "export const TAPE_CLOCK_FUTURE_TOLERANCE_MS = 250;\n"
    "// Backward-compatible export for existing consumers; the clock is no longer\n"
    "// anchored to the last trade.\n"
    "export const TAPE_LIVE_EDGE_MAX_LEAD_MS = TAPE_CLOCK_FUTURE_TOLERANCE_MS;\n"
    "export const TAPE_SWEEP_MIN_AGGREGATES = 2;\n"
    "const TAPE_SWEEP_MAX_DIRECTION_SPAN_PX = 52;",
    "clock and Series constants",
)

old_clock = '''export function advanceTapeDisplayClock(
  previousEnd,
  previousAt,
  latestTradeTime,
  wallNow,
  nowPerf,
) {
  const latest = Number(latestTradeTime);
  const wall = Number(wallNow);
  const now = Number(nowPerf);
  if (![latest, wall, now].every(Number.isFinite)) return null;
  const desired = Math.max(
    latest + 1,
    Math.min(wall, latest + TAPE_LIVE_EDGE_MAX_LEAD_MS),
  );
  const hasPrevious = previousEnd !== null
    && previousEnd !== undefined
    && Number.isFinite(Number(previousEnd));
  if (!hasPrevious) return desired;
  const previous = Number(previousEnd);
  if (Math.abs(desired - previous) > TAPE_LIVE_EDGE_MAX_LEAD_MS * 2) return desired;
  const previousPerf = Number(previousAt);
  const elapsed = Number.isFinite(previousPerf)
    ? Math.max(0, Math.min(250, now - previousPerf))
    : 0;
  if (elapsed <= 0 || Math.abs(desired - previous) <= .5) return desired;
  const alpha = 1 - Math.exp(-elapsed / 90);
  const next = previous + (desired - previous) * alpha;
  return desired >= previous
    ? Math.min(desired, Math.max(previous, next))
    : Math.max(desired, Math.min(previous, next));
}'''
new_clock = '''export function advanceTapeDisplayClock(
  previousEnd,
  previousAt,
  latestTradeTime,
  wallNow,
  nowPerf,
) {
  const latest = Number(latestTradeTime);
  const wall = Number(wallNow);
  const now = Number(nowPerf);
  if (![latest, wall, now].every(Number.isFinite)) return null;

  // performance.timeOrigin + performance.now() is a smooth epoch clock. Keep it
  // aligned with Date.now(), which also drives the site header, and fall back to
  // the wall clock when a test/runtime supplies an unrelated performance epoch.
  const origin = Number(globalThis.performance?.timeOrigin);
  const monotonicWall = Number.isFinite(origin) ? origin + now : wall;
  const displayWall = Math.abs(monotonicWall - wall) <= 1_500 ? monotonicWall : wall;
  const desired = Math.max(
    displayWall,
    Math.min(latest + 1, displayWall + TAPE_CLOCK_FUTURE_TOLERANCE_MS),
  );

  const hasPrevious = previousEnd !== null
    && previousEnd !== undefined
    && Number.isFinite(Number(previousEnd));
  if (!hasPrevious) return desired;
  const previous = Number(previousEnd);

  // Never lag behind the site clock. A small previous lead can remain until the
  // wall clock catches up, preventing a backward visual step after clock jitter.
  if (desired >= previous) return desired;
  return previous - desired <= TAPE_CLOCK_FUTURE_TOLERANCE_MS ? previous : desired;
}'''
text = replace_once(text, old_clock, new_clock, "display clock")

old_timeline_end = '''  for (let time = firstTick; time < window.endTime; time += stepMs) {
    const x = tapeTimeX(time, window, rect.width);
    if (x < 20 || x > right - 20) continue;
    context.beginPath();
    context.moveTo(x, rect.height - 4);
    context.lineTo(x, rect.height);
    context.stroke();
    context.fillText(cachedTapeClockLabel(state, time), x, rect.height - 5);
  }

  context.restore();'''
new_timeline_end = '''  for (let time = firstTick; time < window.endTime; time += stepMs) {
    const x = tapeTimeX(time, window, rect.width);
    if (x < 20 || x > right - 54) continue;
    context.beginPath();
    context.moveTo(x, rect.height - 4);
    context.lineTo(x, rect.height);
    context.stroke();
    context.fillText(cachedTapeClockLabel(state, time), x, rect.height - 5);
  }

  // The right edge is the same live epoch clock as the header, not the time of
  // the last trade. This makes genuine market silence visible instead of faking
  // a delayed timeline.
  context.textAlign = "right";
  context.fillStyle = "rgba(84, 227, 194, .92)";
  context.font = "800 7px Inter, system-ui, sans-serif";
  context.fillText(`${cachedTapeClockLabel(state, window.endTime)} LIVE`, right - 3, rect.height - 5);

  context.restore();'''
text = replace_once(text, old_timeline_end, new_timeline_end, "live timeline label")

text = replace_once(
    text,
    '''    current.labelPrice = current.lastPrice;
    current.price = current.lastPrice;''',
    '''    current.labelPrice = (current.firstPrice + current.lastPrice) / 2;
    current.price = current.labelPrice;''',
    "Series midpoint label",
)
text = text.replace(
    "showLabel: stableTapeQuoteStrength(group.quote) >= .66 || Number(group.aggregateCount) >= 4,",
    "showLabel: stableTapeQuoteStrength(group.quote) >= .58 || Number(group.aggregateCount) >= 3,",
)
if text.count("showLabel: stableTapeQuoteStrength(group.quote) >= .58 || Number(group.aggregateCount) >= 3,") != 2:
    raise RuntimeError("Series label threshold: expected 2 updated branches")

start = text.index("function drawSweepDirection(")
end = text.index("\nfunction drawAggregateMotion(", start)
old_sweep_draw = text[start:end]
new_sweep_draw = '''function drawSweepDirection(
  context,
  viewport,
  item,
  x,
  buy,
  stroke,
  strength,
  openAggregate = false,
) {
  const lowPrice = Number(viewport?.lowPrice);
  const highPrice = Number(viewport?.highPrice);
  const firstPrice = Number(item?.firstPrice);
  const lastPrice = Number(item?.lastPrice);
  if (![lowPrice, highPrice, firstPrice, lastPrice].every(Number.isFinite)) return false;
  const start = projectTapePrice(viewport, clampTape(firstPrice, lowPrice, highPrice));
  const end = projectTapePrice(viewport, clampTape(lastPrice, lowPrice, highPrice));
  if (!start || !end) return false;

  const rawDelta = end.y - start.y;
  const maximumSpan = clampTape(
    (Number(viewport?.rowHeight) || 1) * 6,
    18,
    TAPE_SWEEP_MAX_DIRECTION_SPAN_PX,
  );
  const fromY = Math.abs(rawDelta) > maximumSpan
    ? end.y - Math.sign(rawDelta) * maximumSpan
    : start.y;
  const toY = end.y;
  const delta = toY - fromY;
  const bodyWidth = clampTape(4.8 + strength * 2.6, 4.8, 8.4);

  context.save();
  context.strokeStyle = stroke;
  context.fillStyle = buy
    ? `rgba(42, 191, 137, ${openAggregate ? .25 : .38})`
    : `rgba(222, 70, 87, ${openAggregate ? .26 : .40})`;
  context.lineWidth = clampTape(.85 + strength * .35, .85, 1.35);

  if (Math.abs(delta) < 3) {
    roundedRectPath(context, x - 5, toY - 2.5, 10, 5, 2.5);
    context.fill();
    context.stroke();
    context.restore();
    return true;
  }

  const top = Math.min(fromY, toY);
  const height = Math.max(6, Math.abs(delta));
  roundedRectPath(context, x - bodyWidth / 2, top, bodyWidth, height, bodyWidth / 2);
  context.fill();
  context.stroke();

  const direction = Math.sign(delta);
  context.globalAlpha = openAggregate ? .62 : .88;
  context.beginPath();
  context.arc(x, fromY, Math.max(1.4, bodyWidth * .24), 0, Math.PI * 2);
  context.fillStyle = stroke;
  context.fill();
  context.beginPath();
  context.moveTo(x, toY + direction * 1.2);
  context.lineTo(x - bodyWidth * .62, toY - direction * 4.6);
  context.lineTo(x + bodyWidth * .62, toY - direction * 4.6);
  context.closePath();
  context.fill();
  context.restore();
  return true;
}
'''
text = text[:start] + new_sweep_draw + text[end:]

text = replace_once(
    text,
    "  const maximumLabels = Math.max(4, Math.min(22, Math.floor(right / 38)));",
    "  const maximumLabels = Math.max(3, Math.min(10, Math.floor(right / 72)));",
    "Series label cap",
)

old_stale = '''function staleTradeSuffix(symbol) {
  const meta = symbol ? tapeMetaBySymbol.get(symbol) : null;
  const lastAt = Number(meta?.lastPacketAt) || 0;
  if (!lastAt) return "";
  const age = Date.now() - lastAt;
  if (age < TAPE_STALE_NOTICE_MS) return "";
  return ` · данные ${Math.max(1, Math.floor(age / 1_000))}с назад`;
}'''
new_stale = '''function staleTradeSuffix(symbol) {
  const meta = symbol ? tapeMetaBySymbol.get(symbol) : null;
  const lastAt = Number(meta?.lastPacketAt) || 0;
  if (!lastAt) return "";
  const age = Date.now() - lastAt;
  if (age < TAPE_STALE_NOTICE_MS) return "";
  // Keep the status stable. A changing "N seconds ago" DOM string caused a
  // synchronous style/layout update on every exact second boundary.
  return " · поток без новых сделок";
}'''
text = replace_once(text, old_stale, new_stale, "stable stale status")

old_timer = '''  clearInterval(tapeStateTimer);
  tapeStateTimer = setInterval(() => {
    if (tapeDocumentHidden) return;
    document.querySelectorAll(".orderbook-card").forEach((card) => {
      const state = tapeCardStates.get(card);
      if (!state) return;
      if (state.densityAgeVisible) decorateDensityAges(card, state);
      const symbol = cardSymbol(card);
      const suffix = staleTradeSuffix(symbol);
      if (suffix) setTapeState(state, `НЕТ НОВЫХ СДЕЛОК${suffix}`, "attention");
      else if (state.status?.textContent?.startsWith("НЕТ НОВЫХ СДЕЛОК")) setTapeState(state, "");
    });
  }, TAPE_STATE_REFRESH_MS);'''
new_timer = '''  // No fixed one-second DOM heartbeat. Density ages already update from book
  // events, while stale state is evaluated by the existing Canvas render loop
  // and mutates the DOM only when the stable state actually changes.
  clearTimeout(tapeStateTimer);
  tapeStateTimer = 0;
  void TAPE_STATUS_IDLE_REFRESH_MS;'''
text = replace_once(text, old_timer, new_timer, "remove second-boundary heartbeat")

path.write_text(text, encoding="utf-8")

# Update the focused Series/clock regression contract.
test_path = Path("test-sweep-tape-clock-v1.mjs")
test_text = test_path.read_text(encoding="utf-8")
test_text = test_text.replace(
    "  TAPE_LIVE_EDGE_MAX_LEAD_MS,\n",
    "  TAPE_CLOCK_FUTURE_TOLERANCE_MS,\n",
)
test_text = test_text.replace("  assert.equal(sweeps[0].labelPrice, 101);", "  assert.equal(sweeps[0].labelPrice, 100.5);")
old_clock_test = '''test("Tape edge stays near the latest trade instead of creating a large empty future", () => {
  const first = advanceTapeDisplayClock(null, null, 10_000, 20_000, 0);
  assert.equal(first, 10_000 + TAPE_LIVE_EDGE_MAX_LEAD_MS);
  const idle = advanceTapeDisplayClock(first, 0, 10_000, 20_016, 16);
  assert.equal(idle, first);
  const nextTrade = advanceTapeDisplayClock(idle, 16, 10_050, 20_032, 32);
  assert.ok(nextTrade > idle);
  assert.ok(nextTrade <= 10_050 + TAPE_LIVE_EDGE_MAX_LEAD_MS);
});'''
new_clock_test = '''test("Tape live edge follows the site clock even when the market is silent", () => {
  const first = advanceTapeDisplayClock(null, null, 10_000, 20_000, 0);
  assert.equal(first, 20_000);
  const next = advanceTapeDisplayClock(first, 0, 10_000, 20_016, 16);
  assert.equal(next, 20_016);
  const futureTrade = advanceTapeDisplayClock(next, 16, 20_500, 20_032, 32);
  assert.ok(futureTrade >= 20_032);
  assert.ok(futureTrade <= 20_032 + TAPE_CLOCK_FUTURE_TOLERANCE_MS);
});'''
test_text = replace_once(test_text, old_clock_test, new_clock_test, "clock regression test")
old_runtime_assertions = '''  assert.match(source, /function drawSweepDirection\(/);
  assert.match(source, /function selectSweepLabelKeys\(/);
  assert.match(source, /const showLabel = sweepMode\s*\? Boolean\(sweepLabelKeys\?\.has\(item\.key\)\)/);
  assert.match(source, /advanceTapeDisplayClock\(\s*state\.clockEndTime,\s*state\.clockPerfAt,\s*latestTime,/);
  const timerBlock = source.match(/tapeStateTimer = setInterval\(\(\) => \{[\s\S]*?\}, TAPE_STATE_REFRESH_MS\);/)?.[0] ?? "";
  assert.ok(timerBlock.length > 0);
  assert.doesNotMatch(timerBlock, /scanTapeCards\(document\)/);
  assert.match(timerBlock, /if \(state\.densityAgeVisible\) decorateDensityAges/);'''
new_runtime_assertions = '''  assert.match(source, /function drawSweepDirection\(/[\s\S]*roundedRectPath\(context, x - bodyWidth \/ 2/);
  assert.match(source, /function selectSweepLabelKeys\(/);
  assert.match(source, /const maximumLabels = Math\.max\(3, Math\.min\(10, Math\.floor\(right \/ 72\)\)\)/);
  assert.match(source, /const showLabel = sweepMode\s*\? Boolean\(sweepLabelKeys\?\.has\(item\.key\)\)/);
  assert.match(source, /advanceTapeDisplayClock\(\s*state\.clockEndTime,\s*state\.clockPerfAt,\s*latestTime,/);
  assert.match(source, /cachedTapeClockLabel\(state, window\.endTime\).*LIVE/);
  assert.doesNotMatch(source, /tapeStateTimer = setInterval/);
  assert.doesNotMatch(source, /Math\.floor\(age \/ 1_000\)/);'''
test_text = replace_once(test_text, old_runtime_assertions, new_runtime_assertions, "runtime regression assertions")
test_path.write_text(test_text, encoding="utf-8")

print(f"Applied {NEW_BUILD}")
