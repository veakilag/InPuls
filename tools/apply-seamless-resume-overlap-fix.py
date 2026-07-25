from __future__ import annotations

from pathlib import Path

ROOT = Path.cwd()
WORKER = ROOT / "orderbook-worker.js"
WORKFLOW = ROOT / ".github/workflows/apply-seamless-resume-overlap-fix.yml"
SELF = ROOT / "tools/apply-seamless-resume-overlap-fix.py"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, got {count}")
    return source.replace(old, new, 1)


def main() -> None:
    source = WORKER.read_text(encoding="utf-8")

    source = replace_once(
        source,
        '''    this.syncing = false;
    this.tradeBootstrapLoading = false;
    this.tradeLive = false;''',
        '''    this.syncing = false;
    this.tradeBootstrapRequest = 0;
    this.tradeLive = false;''',
        "bootstrap request state",
    )

    source = replace_once(
        source,
        '''  async loadRecentTrades(generation, { resume = false } = {}) {
    if (generation !== this.generation || this.tradeBootstrapLoading) return;
    this.tradeBootstrapLoading = true;
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];''',
        '''  async loadRecentTrades(generation, { resume = false } = {}) {
    if (generation !== this.generation) return;
    const requestId = ++this.tradeBootstrapRequest;
    const hosts = ["fapi.binance.com", "fapi1.binance.com", "fapi2.binance.com"];''',
        "bootstrap request start",
    )

    source = replace_once(
        source,
        '''    } catch {}
    this.tradeBootstrapLoading = false;
    if (generation !== this.generation || !Array.isArray(rows)) return;

    const addedTrades = [];''',
        '''    } catch {}
    if (
      generation !== this.generation
      || requestId !== this.tradeBootstrapRequest
      || !Array.isArray(rows)
    ) return;

    const addedTrades = [];''',
        "bootstrap request completion",
    )

    source = replace_once(
        source,
        '''  insertTrade(trade, newestFirst = true) {
    if (!trade) return false;''',
        '''  tradeRangeOverlaps(firstTradeId, lastTradeId) {
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

  insertTrade(trade, newestFirst = true) {
    if (!trade) return false;''',
        "trade range overlap helper",
    )

    source = replace_once(
        source,
        '''    const key = `${firstTradeId}:${lastTradeId}:${trade.time}:${trade.price}:${trade.quantity}`;
    if (hasRawRange) this.tapeGuard.advanceBoundary(lastTradeId);
    if (this.tradeIds.has(key)) return false;
    this.tradeIds.add(key);''',
        '''    const key = `${firstTradeId}:${lastTradeId}:${trade.time}:${trade.price}:${trade.quantity}`;
    if (this.tradeIds.has(key)) return false;
    if (hasRawRange && this.tradeRangeOverlaps(firstTradeId, lastTradeId)) return false;
    if (hasRawRange) this.tapeGuard.advanceBoundary(lastTradeId);
    this.tradeIds.add(key);''',
        "range-aware trade insertion",
    )

    required = (
        "this.tradeBootstrapRequest = 0;",
        "const requestId = ++this.tradeBootstrapRequest;",
        "requestId !== this.tradeBootstrapRequest",
        "tradeRangeOverlaps(firstTradeId, lastTradeId)",
        "if (hasRawRange && this.tradeRangeOverlaps(firstTradeId, lastTradeId)) return false;",
    )
    missing = [anchor for anchor in required if anchor not in source]
    if missing:
        raise RuntimeError("Generated worker is incomplete: " + ", ".join(missing))
    if "tradeBootstrapLoading" in source:
        raise RuntimeError("Old bootstrap lock remains in worker")

    overlap_index = source.index(
        "if (hasRawRange && this.tradeRangeOverlaps(firstTradeId, lastTradeId)) return false;"
    )
    boundary_index = source.index(
        "if (hasRawRange) this.tapeGuard.advanceBoundary(lastTradeId);",
        overlap_index,
    )
    if boundary_index <= overlap_index:
        raise RuntimeError("Tape boundary advances before overlap rejection")

    WORKER.write_text(source, encoding="utf-8")
    SELF.unlink(missing_ok=True)
    WORKFLOW.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
