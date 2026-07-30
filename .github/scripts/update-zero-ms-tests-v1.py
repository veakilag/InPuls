from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise AssertionError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


core = read("test-orderbook-tape-v2-core.mjs")
core = replace_once(
    core,
    '  assert.match(orderbook, /TAPE_AGGREGATION_LEVELS/);\n',
    '  assert.match(orderbook, /TAPE_AGGREGATION_PERIOD_MS = 0/);\n'
    '  assert.doesNotMatch(orderbook, /TAPE_AGGREGATION_LEVELS|data-inpuls-agg-step/);\n',
    "core AGG contract",
)
write("test-orderbook-tape-v2-core.mjs", core)

lifecycle = read("test-tape-cluster-lifecycle-v1.mjs")
lifecycle = replace_once(
    lifecycle,
    '''  TAPE_AGGREGATION_LEVELS,
  aggregateTapeBuckets,
  bookDistancePercentLabel,
''',
    '''  TAPE_AGGREGATION_PERIOD_MS,
  aggregateTapeZeroMs,
  materializeZeroMsAggregates,
  bookDistancePercentLabel,
''',
    "lifecycle imports",
)
lifecycle = replace_once(
    lifecycle,
    '''test("deterministic AGG keeps closed bucket identity and coordinates", () => {
  const trades = [
    { time: 1_010, price: 100.01, quote: 10, side: "buy" },
    { time: 1_090, price: 100.02, quote: 20, side: "sell" },
  ];
  const first = aggregateTapeBuckets(trades, .01, 2)[0];
  const next = aggregateTapeBuckets([...trades, { time: 4_000, price: 101, quote: 15, side: "buy" }], .01, 2)
    .find((item) => item.key === first.key);
  assert.equal(next.time, first.time);
  assert.equal(next.price, first.price);
  assert.equal(next.key, first.key);
  assert.equal(TAPE_AGGREGATION_LEVELS.length, 5);
});
''',
    '''test("zero-ms AGG keeps sealed identity while only the newest group stays open", () => {
  assert.equal(TAPE_AGGREGATION_PERIOD_MS, 0);
  const state = { aggSnapshots: new Map() };
  const trades = [
    { id: 1, time: 1_010, price: 100.01, quote: 10, quantity: .1, side: "buy" },
    { id: 2, time: 1_010, price: 100.02, quote: 20, quantity: .2, side: "buy" },
    { id: 3, time: 1_011, price: 100.03, quote: 30, quantity: .3, side: "sell" },
  ];
  const firstView = materializeZeroMsAggregates(state, aggregateTapeZeroMs(trades), []);
  const sealed = firstView[0];
  assert.equal(sealed.status, "sealed");
  assert.equal(firstView[1].status, "open");
  assert.equal(sealed.price, 100.01);

  const nextView = materializeZeroMsAggregates(state, aggregateTapeZeroMs([
    ...trades,
    { id: 4, time: 1_011, price: 100.04, quote: 40, quantity: .4, side: "sell" },
  ]), []);
  assert.equal(nextView[0], sealed);
  assert.equal(nextView[1].quote, 70);
});
''',
    "lifecycle AGG test",
)
lifecycle = replace_once(
    lifecycle,
    '''test("runtime ships aggregation controls, synchronized canvas and density age toggle", () => {
  assert.match(runtime, /desynchronized: false/);
  assert.match(runtime, /data-inpuls-agg-step/);
  assert.match(runtime, /data-inpuls-density-age/);
''',
    '''test("runtime ships zero-ms RAW/AGG control, synchronized canvas and density age toggle", () => {
  assert.match(runtime, /desynchronized: false/);
  assert.match(runtime, /button\.textContent = aggregated \? "AGG" : "RAW"/);
  assert.doesNotMatch(runtime, /data-inpuls-agg-step|TAPE_AGGREGATION_LEVELS/);
  assert.match(runtime, /data-inpuls-density-age/);
''',
    "lifecycle runtime control test",
)
write("test-tape-cluster-lifecycle-v1.mjs", lifecycle)

followup = read("test-tape-stability-followup-v1.mjs")
followup = replace_once(
    followup,
    '''  aggregateTapeBuckets,
  bookPriceEmphasis,
''',
    '''  aggregateTapeZeroMs,
  materializeZeroMsAggregates,
  bookPriceEmphasis,
''',
    "followup imports",
)
followup = replace_once(
    followup,
    '''test("AGG buckets include the complete intersecting bucket", () => {
  const buckets = aggregateTapeBuckets([
    { id: 1, time: 920, price: 10, quote: 100, side: "buy" },
    { id: 2, time: 1_000, price: 10, quote: 200, side: "sell" },
  ], .01, 0, { startTime: 970, endTime: 1_100 });
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].quote, 300);
  assert.match(orderbook, /snapshot = Object\.freeze/);
  assert.match(orderbook, /state\.aggSourceBuckets/);
});
''',
    '''test("zero-ms AGG groups exact event time and freezes completed history", () => {
  const groups = aggregateTapeZeroMs([
    { id: 1, time: 1_000, price: 10, quote: 100, quantity: 10, side: "buy" },
    { id: 2, time: 1_000, price: 10.1, quote: 202, quantity: 20, side: "buy" },
    { id: 3, time: 1_001, price: 10.2, quote: 204, quantity: 20, side: "sell" },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].quote, 302);
  assert.equal(groups[0].price, 10);
  const view = materializeZeroMsAggregates({ aggSnapshots: new Map() }, groups, []);
  assert.equal(view[0].status, "sealed");
  assert.equal(view[1].status, "open");
  assert.match(orderbook, /state\.aggSourceBuckets = aggregateTapeZeroMs/);
});
''',
    "followup AGG test",
)
write("test-tape-stability-followup-v1.mjs", followup)

for path in [
    "test-orderbook-tape-v2-core.mjs",
    "test-tape-cluster-lifecycle-v1.mjs",
    "test-tape-stability-followup-v1.mjs",
]:
    text = read(path)
    assert "TAPE_AGGREGATION_LEVELS" not in text
    assert "aggregateTapeBuckets" not in text
