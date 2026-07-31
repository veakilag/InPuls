from pathlib import Path

path = Path(__file__).with_name("apply-core-feed-footprint-runtime-v1.py")
text = path.read_text(encoding="utf-8")
old = '''app = replace_once(
    app,
    "  const fragment = document.createDocumentFragment();\\n"
    "  for (const item of filtered) fragment.append(createRow(item));\\n",
    "  const activeRowSymbols = new Set();\\n"
    "  const fragment = document.createDocumentFragment();\\n"
    "  for (const item of filtered) {\\n"
    "    activeRowSymbols.add(item.symbol);\\n"
    "    let row = marketRowsBySymbol.get(item.symbol);\\n"
    "    if (!row) {\\n"
    "      row = createRow(item);\\n"
    "      marketRowsBySymbol.set(item.symbol, row);\\n"
    "    } else {\\n"
    "      updateRow(row, item);\\n"
    "    }\\n"
    "    fragment.append(row);\\n"
    "  }\\n"
    "  for (const symbol of marketRowsBySymbol.keys()) {\\n"
    "    if (!activeRowSymbols.has(symbol)) marketRowsBySymbol.delete(symbol);\\n"
    "  }\\n",
    "keyed market rows",
)
'''
new = '''market_rows_pattern = re.compile(
    r"(?m)^\\s{2}const fragment = document\\.createDocumentFragment\\(\\);\\n"
    r"\\s{2}for \\(const item of filtered\\) fragment\\.append\\(createRow\\(item\\)\\);\\n"
)
market_rows_replacement = """  const activeRowSymbols = new Set();
  const fragment = document.createDocumentFragment();
  for (const item of filtered) {
    activeRowSymbols.add(item.symbol);
    let row = marketRowsBySymbol.get(item.symbol);
    if (!row) {
      row = createRow(item);
      marketRowsBySymbol.set(item.symbol, row);
    } else {
      updateRow(row, item);
    }
    fragment.append(row);
  }
  for (const symbol of marketRowsBySymbol.keys()) {
    if (!activeRowSymbols.has(symbol)) marketRowsBySymbol.delete(symbol);
  }
"""
app, market_rows_count = market_rows_pattern.subn(
    lambda _match: market_rows_replacement,
    app,
    count=1,
)
if market_rows_count != 1:
    raise RuntimeError(f"keyed market rows: expected one renderer anchor, got {market_rows_count}")
'''
if old not in text:
    raise RuntimeError("migration anchor block was not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
