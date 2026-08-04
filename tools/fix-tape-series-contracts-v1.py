from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new):
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected 1 stale assertion, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "test-sealed-agg-round-levels-v1.mjs",
    '''test("Tape UI keeps zero-ms RAW/AGG and restores the marker threshold", () => {\n  assert.doesNotMatch(orderbook, /TAPE_AGGREGATION_LEVELS|data-inpuls-agg-step|AGG ×/);\n  assert.doesNotMatch(orderbook, /TAPE_AGG_EVENT_GRACE_MS|TAPE_AGG_WALL_CLOCK_GRACE_MS/);\n  assert.match(orderbook, /data-inpuls-trade-min|TAPE_MIN_FILTER_KEY/);\n  assert.match(orderbook, /button\\.textContent = aggregated \\? "AGG" : "RAW"/);\n  assert.match(orderbook, /AGG 0 мс/);\n  assert.match(orderbook, /status: "open"/);\n  assert.match(orderbook, /status: "sealed"/);\n});''',
    '''test("Tape UI keeps zero-ms AGG, adds SERIES and restores the marker threshold", () => {\n  assert.doesNotMatch(orderbook, /TAPE_AGGREGATION_LEVELS|data-inpuls-agg-step|AGG ×/);\n  assert.doesNotMatch(orderbook, /TAPE_AGG_EVENT_GRACE_MS|TAPE_AGG_WALL_CLOCK_GRACE_MS/);\n  assert.match(orderbook, /data-inpuls-trade-min|TAPE_MIN_FILTER_KEY/);\n  assert.match(orderbook, /button\\.textContent = mode === "series" \\? "СЕРИЯ" : mode\\.toUpperCase\\(\\)/);\n  assert.match(orderbook, /TAPE_SERIES_MAX_GAP_MS = 500/);\n  assert.match(orderbook, /AGG 0 мс/);\n  assert.match(orderbook, /status: "open"/);\n  assert.match(orderbook, /status: "sealed"/);\n});''',
)

replace_once(
    "test-tape-cluster-lifecycle-v1.mjs",
    '''test("runtime ships zero-ms RAW/AGG control, synchronized canvas and density age toggle", () => {\n  assert.match(runtime, /desynchronized: false/);\n  assert.match(runtime, /button\\.textContent = aggregated \\? "AGG" : "RAW"/);\n  assert.doesNotMatch(runtime, /data-inpuls-agg-step|TAPE_AGGREGATION_LEVELS/);\n  assert.match(runtime, /data-inpuls-density-age/);\n  assert.match(runtime, /densityLifecycle\\?\\.densities/);\n  assert.match(workspace, /data-footprint-favorite/);\n  assert.match(workspace, /FOOTPRINT_MAX_RETAINED_CELLS/);\n  assert.match(workspace, /retainedFromAt/);\n  assert.match(workspace, /LIVE\\$\\{sessionPartial \\? " · PARTIAL"/);\n});''',
    '''test("runtime ships RAW, zero-ms AGG, SERIES, synchronized canvas and density age toggle", () => {\n  assert.match(runtime, /desynchronized: false/);\n  assert.match(runtime, /TAPE_MODES = Object\\.freeze\\(\\["raw", "agg", "series"\\]\\)/);\n  assert.match(runtime, /button\\.textContent = mode === "series" \\? "СЕРИЯ" : mode\\.toUpperCase\\(\\)/);\n  assert.doesNotMatch(runtime, /data-inpuls-agg-step|TAPE_AGGREGATION_LEVELS/);\n  assert.match(runtime, /data-inpuls-density-age/);\n  assert.match(runtime, /densityLifecycle\\?\\.densities/);\n  assert.match(workspace, /data-footprint-favorite/);\n  assert.match(workspace, /FOOTPRINT_MAX_RETAINED_CELLS/);\n  assert.match(workspace, /retainedFromAt/);\n  assert.match(workspace, /LIVE\\$\\{sessionPartial \\? " · PARTIAL"/);\n});''',
)
