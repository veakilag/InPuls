from pathlib import Path
import re

path = Path("app.js")
source = path.read_text(encoding="utf-8")

helper_pattern = re.compile(
    r"(?m)^function patchBookLadderRows\(body, rows, middle, maxSize, anomalyThreshold, baseTick\) \{$"
)
helper = '''function anomalyTierForQuote(quote, threshold) {
  const amount = Math.max(0, Number(quote) || 0);
  const base = Math.max(1, Number(threshold) || 1);
  if (amount < base) return 0;
  if (amount >= base * 3.5) return 3;
  if (amount >= base * 2) return 2;
  return 1;
}

function patchBookLadderRows(body, rows, middle, maxSize, anomalyThreshold, baseTick) {'''
source, count = helper_pattern.subn(helper, source, count=1)
if count != 1:
    raise RuntimeError(f"Expected one ladder helper anchor, got {count}")

class_pattern = re.compile(r'''(?m)^    const anomalous = source\.quote >= anomalyThreshold && source\.quote > 0;
    const className = \[
      "book-ladder-row",
      `is-\$\{side\}`,
      anomalous \? "is-anomaly" : "",
      source\.isMarket \? "is-market" : "",
      source\.isRound \? "is-price-round" : "",
      source\.isHalfRound \? "is-price-half" : "",
    \]\.filter\(Boolean\)\.join\(" "\);$''')
classes = '''    const anomalyTier = anomalyTierForQuote(source.quote, anomalyThreshold);
    const className = [
      "book-ladder-row",
      `is-${side}`,
      anomalyTier ? "is-anomaly" : "",
      anomalyTier ? `is-anomaly-tier-${anomalyTier}` : "",
      source.isMarket ? "is-market" : "",
      source.isRound ? "is-price-round" : "",
      source.isHalfRound ? "is-price-half" : "",
    ].filter(Boolean).join(" ");'''
source, count = class_pattern.subn(classes, source, count=1)
if count != 1:
    raise RuntimeError(f"Expected one ladder class block, got {count}")

path.write_text(source, encoding="utf-8")
