from __future__ import annotations

from pathlib import Path

ROOT = Path.cwd()
WORKER = ROOT / "orderbook-worker.js"
TEST = ROOT / "test-orderbook-seamless-resume.mjs"

HELPERS = 'function mergeTradeCoverage(trades) {\n  const ranges = [];\n  for (const trade of trades ?? []) {\n    const first = Number(trade?.firstTradeId);\n    const last = Number(trade?.lastTradeId);\n    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first) continue;\n    ranges.push([first, last]);\n  }\n  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);\n\n  const merged = [];\n  for (const [first, last] of ranges) {\n    const previous = merged.at(-1);\n    if (!previous || first > previous[1] + 1) merged.push([first, last]);\n    else previous[1] = Math.max(previous[1], last);\n  }\n  return merged;\n}\n\nfunction tradeCoverageOverlaps(ranges, firstTradeId, lastTradeId) {\n  const first = Number(firstTradeId);\n  const last = Number(lastTradeId);\n  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first) return false;\n\n  let low = 0;\n  let high = (ranges?.length ?? 0) - 1;\n  while (low <= high) {\n    const middle = Math.floor((low + high) / 2);\n    const range = ranges[middle];\n    if (last < range[0]) high = middle - 1;\n    else if (first > range[1]) low = middle + 1;\n    else return true;\n  }\n  return false;\n}\n\nfunction addTradeCoverage(ranges, firstTradeId, lastTradeId) {\n  let first = Number(firstTradeId);\n  let last = Number(lastTradeId);\n  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first) return ranges;\n\n  let index = 0;\n  while (index < ranges.length && ranges[index][1] + 1 < first) index += 1;\n  while (index < ranges.length && ranges[index][0] <= last + 1) {\n    first = Math.min(first, ranges[index][0]);\n    last = Math.max(last, ranges[index][1]);\n    ranges.splice(index, 1);\n  }\n  ranges.splice(index, 0, [first, last]);\n  return ranges;\n}\n\n'


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, got {count}")
    return source.replace(old, new, 1)


def transform_worker(source: str) -> str:
    if "function mergeTradeCoverage(" in source:
        raise RuntimeError("Trade coverage helpers already exist")

    source = replace_once(
        source,
        "async function fetchJson(url, timeoutMs = SNAPSHOT_TIMEOUT_MS) {",
        HELPERS + "async function fetchJson(url, timeoutMs = SNAPSHOT_TIMEOUT_MS) {",
        "trade coverage helper insertion",
    )

    source = replace_once(
        source,
        """  tradeRangeOverlaps(firstTradeId, lastTradeId) {
    const first = Number(firstTradeId);
    const last = Number(lastTradeId);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first) return false;
    return this.trades.some((item) => {
      const itemFirst = Number(item?.firstTradeId);
      const itemLast = Number(item?.lastTradeId);
      return Number.isInteger(itemFirst)
        && Number.isInteger(itemLast)
        && itemFirst <= last
        && itemLast >= first;
    });
  }

""",
        "",
        "per-trade history scan",
    )

    source = replace_once(
        source,
        """    const addedTrades = [];
    for (const row of rows) {
      const trade = normalizeTrade(row, "agg");
      if (this.insertTrade(trade, true)) addedTrades.push(trade);
    }""",
        """    const coveredRanges = resume ? mergeTradeCoverage(this.trades) : null;
    const addedTrades = [];
    for (const row of rows) {
      const trade = normalizeTrade(row, "agg");
      if (
        resume
        && trade
        && tradeCoverageOverlaps(coveredRanges, trade.firstTradeId, trade.lastTradeId)
      ) continue;
      if (this.insertTrade(trade, true)) {
        addedTrades.push(trade);
        if (resume) addTradeCoverage(coveredRanges, trade.firstTradeId, trade.lastTradeId);
      }
    }""",
        "resume overlap filter",
    )

    source = replace_once(
        source,
        """    if (this.tradeIds.has(key)) return false;
    if (hasRawRange && this.tradeRangeOverlaps(firstTradeId, lastTradeId)) return false;
    if (hasRawRange) this.tapeGuard.advanceBoundary(lastTradeId);""",
        """    if (this.tradeIds.has(key)) return false;
    if (hasRawRange) this.tapeGuard.advanceBoundary(lastTradeId);""",
        "live insert overlap scan",
    )

    required = (
        "function mergeTradeCoverage(trades)",
        "function tradeCoverageOverlaps(ranges, firstTradeId, lastTradeId)",
        "function addTradeCoverage(ranges, firstTradeId, lastTradeId)",
        "const coveredRanges = resume ? mergeTradeCoverage(this.trades) : null;",
        "tradeCoverageOverlaps(coveredRanges, trade.firstTradeId, trade.lastTradeId)",
        "if (resume) addTradeCoverage(coveredRanges, trade.firstTradeId, trade.lastTradeId);",
    )
    missing = [anchor for anchor in required if anchor not in source]
    if missing:
        raise RuntimeError("Performance-safe overlap fix is incomplete: " + ", ".join(missing))
    if "return this.trades.some" in source:
        raise RuntimeError("Per-trade full history scan remains")
    if "this.tradeRangeOverlaps(" in source:
        raise RuntimeError("Old overlap method call remains")
    return source


def main() -> None:
    worker_source = WORKER.read_text(encoding="utf-8")
    updated_worker = transform_worker(worker_source)
    if updated_worker == worker_source:
        raise RuntimeError("orderbook-worker.js was not changed")
    WORKER.write_text(updated_worker, encoding="utf-8")

    test_source = TEST.read_text(encoding="utf-8")
    required_test = (
        'test("resume overlap filtering stays off the live trade hot path"',
        "mergeTradeCoverage",
        "tradeCoverageOverlaps",
        "addTradeCoverage",
    )
    missing_test = [anchor for anchor in required_test if anchor not in test_source]
    if missing_test:
        raise RuntimeError("Updated performance regression test is missing: " + ", ".join(missing_test))

    (ROOT / "tools/apply-seamless-resume-performance-fix.py").unlink(missing_ok=True)
    (ROOT / ".github/workflows/apply-seamless-resume-performance-fix.yml").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
