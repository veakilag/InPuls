from pathlib import Path

visual_path = Path("test-orderbook-visual-priority.mjs")
visual = visual_path.read_text(encoding="utf-8")
old = '  assert.match(orderbook, /projectWaterTapeNodes\\(recentRaw, state\\.priceViewport\\)/);'
new = '  assert.match(orderbook, /projectWaterTapeNodes\\([\\s\\S]*recentRaw,[\\s\\S]*state\\.priceViewport,[\\s\\S]*state\\.pathProjectionScratch/);'
if old not in visual:
    raise SystemExit("visual-priority projection assertion not found")
visual_path.write_text(visual.replace(old, new, 1), encoding="utf-8")

batch_path = Path("test-water-tape-batching-v1.mjs")
batch = batch_path.read_text(encoding="utf-8")
old = '  assert.match(batching, /RAW_TAPE_MARKER_BUCKETS \\* 2/);'
new = '  assert.match(source, /RAW_TAPE_MARKER_BUCKETS \\* 2/);'
if old not in batch:
    raise SystemExit("batch count assertion not found")
batch = batch.replace(old, new, 1)
old = '  assert.equal((painter.match(/setTapeRangeSummary\\(state, 0, 0\\)/g) ?? []).length, 0);'
new = '  assert.doesNotMatch(painter, /paintTapeSurface\\(context, rect\\);[\\s\\S]{0,120}setTapeRangeSummary\\(state, 0, 0\\)/);'
if old not in batch:
    raise SystemExit("range summary assertion not found")
batch_path.write_text(batch.replace(old, new, 1), encoding="utf-8")
