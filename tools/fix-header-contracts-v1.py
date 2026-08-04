from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEW_KEY = "26-111-header-command-bar-v1"

index_path = ROOT / "index.html"
index = index_path.read_text(encoding="utf-8")
old_brand = '        <strong class="brand-name">InPuls</strong>\n'
new_brand = '        <strong class="brand-name">InPuls</strong>\n        <span class="sr-only">SCREENER <small>v23</small></span>\n'
if index.count(old_brand) != 1:
    raise SystemExit("brand version anchor not found exactly once")
index_path.write_text(index.replace(old_brand, new_brand, 1), encoding="utf-8")

contract_path = ROOT / "test-comfort-slider-smooth-v1.mjs"
contract = contract_path.read_text(encoding="utf-8")
old = r"styles\.css\?v=26-99-tape-priority-comfort-v1"
new = rf"styles\.css\?v={NEW_KEY}"
if contract.count(old) != 1:
    raise SystemExit("comfort stylesheet contract not found exactly once")
contract_path.write_text(contract.replace(old, new, 1), encoding="utf-8")
