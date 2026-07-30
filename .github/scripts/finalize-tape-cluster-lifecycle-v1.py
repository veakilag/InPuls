from pathlib import Path


def update(path, transform):
    file = Path(path)
    source = file.read_text(encoding="utf-8")
    next_source = transform(source)
    if next_source == source:
        raise SystemExit(f"{path}: no changes applied")
    file.write_text(next_source, encoding="utf-8")


def once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)


def patch_orderbook(text):
    text = once(
        text,
        ".orderbook-card .inpuls-density-age-toggle {\n      min-width: 38px;",
        ".orderbook-card .inpuls-density-age-toggle {\n      min-width: 42px;",
        "density age button width",
    )
    return once(
        text,
        '      densityButton.textContent = "ВОЗР";',
        '      densityButton.textContent = "ВРЕМЯ";',
        "density age button label",
    )


def patch_footprint(text):
    text = once(
        text,
        "const FOOTPRINT_RETAIN_MS = 30 * 60_000;\n",
        "const FOOTPRINT_RETAIN_MS = 30 * 60_000;\nconst FOOTPRINT_MAX_RETAINED_CELLS = 40_000;\n",
        "footprint cell cap",
    )
    text = once(
        text,
        "export function createFootprintAccumulator() {\n  return { seconds: new Map(), firstObservedAt: null, lastObservedAt: null };\n}",
        '''export function createFootprintAccumulator() {
  return {
    seconds: new Map(),
    firstObservedAt: null,
    lastObservedAt: null,
    retainedFromAt: null,
    cellCount: 0,
  };
}''',
        "bounded footprint accumulator",
    )
    text = once(
        text,
        '''function pruneFootprintAccumulator(accumulator, referenceTime = Date.now()) {
  const cutoff = Number(referenceTime) - FOOTPRINT_RETAIN_MS;
  for (const startTime of accumulator.seconds.keys()) {
    if (startTime < cutoff || startTime > Number(referenceTime) + FOOTPRINT_BASE_BUCKET_MS) {
      accumulator.seconds.delete(startTime);
    }
  }
}''',
        '''function removeFootprintBucket(accumulator, startTime) {
  const bucket = accumulator.seconds.get(startTime);
  if (!bucket) return false;
  accumulator.cellCount = Math.max(0, Number(accumulator.cellCount) - bucket.cells.size);
  accumulator.seconds.delete(startTime);
  return true;
}

function pruneFootprintAccumulator(accumulator, referenceTime = Date.now()) {
  const cutoff = Number(referenceTime) - FOOTPRINT_RETAIN_MS;
  for (const startTime of [...accumulator.seconds.keys()]) {
    if (startTime < cutoff || startTime > Number(referenceTime) + FOOTPRINT_BASE_BUCKET_MS) {
      removeFootprintBucket(accumulator, startTime);
    }
  }
  while (
    Number(accumulator.cellCount) > FOOTPRINT_MAX_RETAINED_CELLS
    && accumulator.seconds.size
  ) {
    const oldest = accumulator.seconds.keys().next().value;
    if (!removeFootprintBucket(accumulator, oldest)) break;
  }
  const retained = accumulator.seconds.keys().next().value;
  accumulator.retainedFromAt = Number.isFinite(Number(retained)) ? Number(retained) : null;
}''',
        "footprint bounded pruning",
    )
    text = once(
        text,
        '''  if (replace) {
    target.seconds.clear();
    target.firstObservedAt = null;
    target.lastObservedAt = null;
  }''',
        '''  if (replace) {
    target.seconds.clear();
    target.firstObservedAt = null;
    target.lastObservedAt = null;
    target.retainedFromAt = null;
    target.cellCount = 0;
  }''',
        "footprint reset counters",
    )
    text = once(
        text,
        '''    const priceKey = Number(trade.price).toPrecision(15);
    const cell = bucket.cells.get(priceKey) ?? {
      price: trade.price,
      buyQuote: 0,
      sellQuote: 0,
      quote: 0,
      count: 0,
    };''',
        '''    const priceKey = Number(trade.price).toPrecision(15);
    const existingCell = bucket.cells.get(priceKey);
    const cell = existingCell ?? {
      price: trade.price,
      buyQuote: 0,
      sellQuote: 0,
      quote: 0,
      count: 0,
    };
    if (!existingCell) target.cellCount = Math.max(0, Number(target.cellCount) || 0) + 1;''',
        "footprint cell counter",
    )
    return once(
        text,
        '''  const firstObservedAt = Number(accumulator?.firstObservedAt);
  return {
    timeframe,
    startTime,
    endTime,
    partial: Number(now) < endTime,
    sessionPartial: !Number.isFinite(firstObservedAt) || firstObservedAt > startTime + FOOTPRINT_BASE_BUCKET_MS,''',
        '''  const firstObservedAt = Number(accumulator?.firstObservedAt);
  const retainedFromAt = Number(accumulator?.retainedFromAt);
  return {
    timeframe,
    startTime,
    endTime,
    partial: Number(now) < endTime,
    sessionPartial: !Number.isFinite(firstObservedAt)
      || firstObservedAt > startTime + FOOTPRINT_BASE_BUCKET_MS
      || (Number.isFinite(retainedFromAt) && retainedFromAt > startTime),''',
        "footprint retained completeness",
    )


def patch_test(text):
    anchor = '''  assert.match(workspace, /data-footprint-favorite/);
  assert.match(workspace, /LIVE\\$\\{sessionPartial \\? " · PARTIAL"/);'''
    replacement = '''  assert.match(workspace, /data-footprint-favorite/);
  assert.match(workspace, /FOOTPRINT_MAX_RETAINED_CELLS/);
  assert.match(workspace, /retainedFromAt/);
  assert.match(workspace, /LIVE\\$\\{sessionPartial \\? " · PARTIAL"/);'''
    return once(text, anchor, replacement, "bounded footprint assertions")


update("orderbook.js", patch_orderbook)
update("orderbook-flow-workspace.js", patch_footprint)
update("test-tape-cluster-lifecycle-v1.mjs", patch_test)
