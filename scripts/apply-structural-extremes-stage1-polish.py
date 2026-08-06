from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence of {old!r}, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


engine = ROOT / "signal-lab-v7-structural-extremes.js"
text = engine.read_text(encoding="utf-8")
text = text.replace(
    "  tickSizeBufferTicks: 3,\n  touchZoneTicks: 1,",
    "  tickSizeBufferTicks: 3,\n  crossingToleranceTicks: 1,\n  touchZoneTicks: 1,",
    1,
)
text = text.replace(
    '''    touchZoneTicks: Math.max(
      0,
      Math.round(finite(config.touchZoneTicks) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.touchZoneTicks),
    ),''',
    '''    crossingToleranceTicks: Math.max(
      0,
      Math.round(
        finite(config.crossingToleranceTicks)
        ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.crossingToleranceTicks,
      ),
    ),
    touchZoneTicks: Math.max(
      0,
      Math.round(finite(config.touchZoneTicks) ?? DEFAULT_STRUCTURAL_EXTREME_CONFIG.touchZoneTicks),
    ),''',
    1,
)
text = text.replace(
    '''    const highTicks = toTicks(candle.high, this.tickSize);
    const toleranceTicks = this.config.tickSizeBufferTicks;''',
    '''    const highTicks = toTicks(candle.high, this.tickSize);''',
    1,
)
text = text.replace(
    "    if (highTicks > this.candidate.priceTicks + toleranceTicks) {",
    "    if (highTicks > this.candidate.priceTicks) {",
    1,
)
text = text.replace(
    '''    const lowTicks = toTicks(candle.low, this.tickSize);
    const toleranceTicks = this.config.tickSizeBufferTicks;''',
    '''    const lowTicks = toTicks(candle.low, this.tickSize);''',
    1,
)
text = text.replace(
    "    if (lowTicks < this.candidate.priceTicks - toleranceTicks) {",
    "    if (lowTicks < this.candidate.priceTicks) {",
    1,
)
text = text.replace(
    "    const tolerance = this.config.tickSizeBufferTicks;",
    "    const tolerance = this.config.crossingToleranceTicks;",
    1,
)
text = text.replace(
    '''        minimumBarsAfterCandidate: this.config.minimumBarsAfterCandidate,
        tickSizeBufferTicks: this.config.tickSizeBufferTicks,''',
    '''        minimumBarsAfterCandidate: this.config.minimumBarsAfterCandidate,
        tickSizeBufferTicks: this.config.tickSizeBufferTicks,
        crossingToleranceTicks: this.config.crossingToleranceTicks,''',
    1,
)
engine.write_text(text, encoding="utf-8")

# Make the calibration page open quickly on 1h; 1m remains one click away and
# still loads all 30 days when selected.
replace_once(
    "owner-signal-lab-structural-extremes-review.html",
    '<button type="button" data-timeframe="1m" class="is-active">1м</button>\n        <button type="button" data-timeframe="5m">5м</button>\n        <button type="button" data-timeframe="15m">15м</button>\n        <button type="button" data-timeframe="1h">1ч</button>',
    '<button type="button" data-timeframe="1m">1м</button>\n        <button type="button" data-timeframe="5m">5м</button>\n        <button type="button" data-timeframe="15m">15м</button>\n        <button type="button" data-timeframe="1h" class="is-active">1ч</button>',
)

review = ROOT / "owner-signal-lab-structural-extremes-review.js"
text = review.read_text(encoding="utf-8")
text = text.replace('let timeframe = "1m";', 'let timeframe = "1h";', 1)
old_annotations = '''    rows.push({
      type: extreme.active ? "ray" : "line",
      startAt: extreme.extremeAt,
      endAt: extreme.crossedAt,
      price: extreme.price,
      label: `${extreme.side === "HIGH" ? "H" : "L"} ${snapshot.timeframe} ×${extreme.touchCount}`,
      tone: extreme.side === "HIGH" ? "danger" : "success",
      state: extreme.status,
    });'''
new_annotations = '''    const endAt = extreme.active
      ? current?.loaded?.endAt
      : extreme.crossedAt ?? current?.loaded?.endAt;
    rows.push({
      type: "segment",
      a: { time: extreme.extremeAt, price: extreme.price },
      b: { time: endAt, price: extreme.price },
      label: `${extreme.side === "HIGH" ? "H" : "L"} ${snapshot.timeframe} · атак ${extreme.touchCount}`,
      tone: extreme.side === "HIGH" ? "danger" : "success",
      state: extreme.status,
    });'''
if text.count(old_annotations) != 1:
    raise RuntimeError("review annotations block not found")
text = text.replace(old_annotations, new_annotations, 1)
review.write_text(text, encoding="utf-8")

unit = ROOT / "test/signal-lab-v7-structural-extremes.test.js"
text = unit.read_text(encoding="utf-8")
insert_at = '''test("small pullback does not confirm an extreme", () => {
'''
new_test = '''test("candidate moves on every new traded tick even when reversal buffer is wider", () => {
  const subject = engine({ tickSizeBufferTicks: 3, crossingToleranceTicks: 1 });
  subject.ingestCandle(candle(0, 100, 100, 100, 100));
  subject.ingestCandle(candle(1, 100, 101.0, 100, 100.8));
  const snapshot = subject.ingestCandle(candle(2, 100.8, 101.1, 100.7, 101.0));
  assert.equal(snapshot.direction, STRUCTURAL_DIRECTIONS.TRACKING_UP);
  assert.equal(snapshot.candidate.price, 101.1);
  assert.equal(snapshot.diagnostics.reason, "HIGH_CANDIDATE_MOVED");
});

test("crossing tolerance is independent from the wider reversal tick buffer", () => {
  const subject = engine({ tickSizeBufferTicks: 3, crossingToleranceTicks: 1 });
  subject.ingestCandles(risingToConfirmedHigh());
  subject.ingestCandle(candle(7, 104.3, 104.5, 103.0, 103.5));
  let snapshot = subject.ingestCandle(candle(8, 103.5, 105.1, 103.4, 105.0));
  assert.equal(snapshot.active.length, 1);
  snapshot = subject.ingestCandle(candle(9, 105.0, 105.2, 104.8, 105.1));
  assert.equal(snapshot.active.length, 0);
  assert.equal(snapshot.history[0].status, STRUCTURAL_EXTREME_STATUSES.CROSSED);
});

test("small pullback does not confirm an extreme", () => {
'''
if text.count(insert_at) != 1:
    raise RuntimeError("unit test insertion point not found")
text = text.replace(insert_at, new_test, 1)
unit.write_text(text, encoding="utf-8")

isolation = ROOT / "test/signal-lab-v7-structural-extremes-isolation.test.js"
text = isolation.read_text(encoding="utf-8")
text = text.replace(
    '  assert.match(review, /new StructuralExtremeEngine/);',
    '  assert.match(review, /new StructuralExtremeEngine/);\n'
    '  assert.match(review, /let timeframe = "1h"/);\n'
    '  assert.match(review, /type: "segment"/);',
    1,
)
text = text.replace(
    '  assert.match(html, /Candidate/);',
    '  assert.match(html, /Candidate/);\n'
    '  assert.match(html, /data-timeframe="1h" class="is-active"/);',
    1,
)
isolation.write_text(text, encoding="utf-8")

print("Structural extrema stage 1 polish applied")
