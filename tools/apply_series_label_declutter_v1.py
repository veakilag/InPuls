from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORDERBOOK = ROOT / "orderbook.js"
TEST_FILE = ROOT / "test-sweep-tape-clock-v1.mjs"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)


text = ORDERBOOK.read_text(encoding="utf-8")

text = replace_once(
    text,
    '''const TAPE_SWEEP_MAX_DIRECTION_SPAN_PX = 34;
const TAPE_TIMELINE_CACHE_LIMIT = 240;''',
    '''const TAPE_SWEEP_MAX_DIRECTION_SPAN_PX = 34;
const TAPE_SWEEP_LABEL_MIN_GAP_X = 6;
const TAPE_SWEEP_LABEL_MIN_GAP_Y = 4;
const TAPE_TIMELINE_CACHE_LIMIT = 240;''',
    "Series label spacing constants",
)

text = replace_once(
    text,
    '''function drawRawTapeMarkerBatches(context, batches) {''',
    '''export function selectSweepLabelKeys(
  projectedItems,
  window,
  plotRight,
  measureText = (label) => String(label).length * 5,
) {
  const right = Math.max(1, Number(plotRight) || 1);
  const candidates = [];
  for (const projected of projectedItems ?? []) {
    const item = projected?.source;
    const y = Number(projected?.position?.y);
    if (!item?.showLabel || !Number.isFinite(y)) continue;
    const label = formatTapeUsd(item.quote);
    const measured = Math.max(0, Number(measureText(label)) || 0);
    const strength = stableTapeQuoteStrength(item.quote);
    const height = clampTape(7 + strength * 5, 7, 14);
    const width = clampTape(measured + 10, 20, Math.min(84, right * .28));
    const baseX = tapeTimeX(item.time, window, right);
    const x = aggregateStableX(baseX, item.timeOrdinal, width, right);
    candidates.push({
      key: item.key,
      x,
      y,
      width,
      height,
      quote: Number(item.quote) || 0,
      aggregateCount: Number(item.aggregateCount) || 0,
      time: Number(item.time) || 0,
      open: item.status === "open",
    });
  }

  candidates.sort((left, rightItem) => {
    if (left.open !== rightItem.open) return left.open ? -1 : 1;
    if (left.quote !== rightItem.quote) return rightItem.quote - left.quote;
    if (left.aggregateCount !== rightItem.aggregateCount) {
      return rightItem.aggregateCount - left.aggregateCount;
    }
    return rightItem.time - left.time;
  });

  const maximumLabels = Math.max(4, Math.min(22, Math.floor(right / 38)));
  const accepted = [];
  const keys = new Set();
  for (const candidate of candidates) {
    if (accepted.length >= maximumLabels) break;
    const overlaps = accepted.some((placed) => (
      Math.abs(candidate.x - placed.x)
        < (candidate.width + placed.width) / 2 + TAPE_SWEEP_LABEL_MIN_GAP_X
      && Math.abs(candidate.y - placed.y)
        < (candidate.height + placed.height) / 2 + TAPE_SWEEP_LABEL_MIN_GAP_Y
    ));
    if (overlaps) continue;
    accepted.push(candidate);
    keys.add(candidate.key);
  }
  return keys;
}

function drawRawTapeMarkerBatches(context, batches) {''',
    "Series label collision selector",
)

text = replace_once(
    text,
    '''  const rawMarkerBatches = state.mode === "raw" && minQuote === 0
    ? prepareRawTapeMarkerBatches(state)
    : null;

  for (const projected of items) {''',
    '''  const rawMarkerBatches = state.mode === "raw" && minQuote === 0
    ? prepareRawTapeMarkerBatches(state)
    : null;
  const sweepLabelKeys = state.mode === "sweep"
    ? selectSweepLabelKeys(
      items,
      window,
      window.plotRight,
      (label) => context.measureText(label).width,
    )
    : null;

  for (const projected of items) {''',
    "Series label selection per frame",
)

text = replace_once(
    text,
    '''    const showLabel = sweepMode
      ? Boolean(item.showLabel)
      : minQuote > 0 || Boolean(item.showLabel);''',
    '''    const showLabel = sweepMode
      ? Boolean(sweepLabelKeys?.has(item.key))
      : minQuote > 0 || Boolean(item.showLabel);''',
    "Series non-overlapping labels",
)

ORDERBOOK.write_text(text, encoding="utf-8")

test = TEST_FILE.read_text(encoding="utf-8")
test = replace_once(
    test,
    '''  materializeTapeSweeps,
  aggregateVisibleLabelPrice,
  advanceTapeDisplayClock,''',
    '''  materializeTapeSweeps,
  aggregateVisibleLabelPrice,
  advanceTapeDisplayClock,
  selectSweepLabelKeys,''',
    "declutter test import",
)

test = replace_once(
    test,
    '''test("Runtime exposes compact Series and avoids per-second card rescans", () => {''',
    '''test("Series labels keep the larger volume when visual boxes collide", () => {
  const window = { startTime: 0, endTime: 2_000, duration: 2_000, plotRight: 200 };
  const labels = selectSweepLabelKeys([
    {
      source: { key: "small", time: 1_000, timeOrdinal: 0, quote: 1_000, aggregateCount: 2, showLabel: true, status: "sealed" },
      position: { y: 50 },
    },
    {
      source: { key: "large", time: 1_001, timeOrdinal: 0, quote: 8_000, aggregateCount: 5, showLabel: true, status: "sealed" },
      position: { y: 51 },
    },
  ], window, 200, () => 24);
  assert.deepEqual([...labels], ["large"]);
});

test("Current open Series label wins a collision so the live event remains readable", () => {
  const window = { startTime: 0, endTime: 2_000, duration: 2_000, plotRight: 200 };
  const labels = selectSweepLabelKeys([
    {
      source: { key: "old-large", time: 1_000, timeOrdinal: 0, quote: 20_000, aggregateCount: 8, showLabel: true, status: "sealed" },
      position: { y: 50 },
    },
    {
      source: { key: "live", time: 1_001, timeOrdinal: 0, quote: 3_000, aggregateCount: 3, showLabel: true, status: "open" },
      position: { y: 51 },
    },
  ], window, 200, () => 24);
  assert.deepEqual([...labels], ["live"]);
});

test("Runtime exposes compact Series and avoids per-second card rescans", () => {''',
    "declutter functional tests",
)

test = replace_once(
    test,
    '''  assert.match(source, /const showLabel = sweepMode\\s*\\? Boolean\\(item\\.showLabel\\)/);''',
    '''  assert.match(source, /function selectSweepLabelKeys\\(/);
  assert.match(source, /const showLabel = sweepMode\\s*\\? Boolean\\(sweepLabelKeys\\?\\.has\\(item\\.key\\)\\)/);''',
    "declutter runtime assertion",
)

TEST_FILE.write_text(test, encoding="utf-8")
print("Applied Series label declutter v1")
