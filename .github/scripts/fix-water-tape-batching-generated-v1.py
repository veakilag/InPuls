from pathlib import Path
import re

path = Path("orderbook.js")
text = path.read_text(encoding="utf-8")
replacement = '''function finalizedAggregateTapeBuckets(state, buckets, closedBefore, output = []) {
  if (!(state.aggSnapshots instanceof Map)) state.aggSnapshots = new Map();
  output.length = 0;
  for (const bucket of buckets ?? []) {
    let snapshot = state.aggSnapshots.get(bucket.key);
    if (!snapshot && bucket.bucketEnd <= closedBefore) {
      snapshot = Object.freeze({
        ...bucket,
        showLabel: stableTapeQuoteStrength(bucket.quote) >= .62,
      });
      state.aggSnapshots.set(bucket.key, snapshot);
    }
    if (snapshot) output.push(snapshot);
  }
  while (state.aggSnapshots.size > 1_800) {
    state.aggSnapshots.delete(state.aggSnapshots.keys().next().value);
  }
  return output;
}

function positionAggregateTapeBuckets'''
text, count = re.subn(
    r'function finalizedAggregateTapeBuckets\([\s\S]*?\n\}\n\nfunction positionAggregateTapeBuckets',
    lambda _: replacement,
    text,
    count=1,
)
if count != 1:
    raise SystemExit(f"finalized AGG repair: expected 1 match, got {count}")
path.write_text(text, encoding="utf-8")
